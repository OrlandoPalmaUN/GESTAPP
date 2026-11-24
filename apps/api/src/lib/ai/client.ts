import Groq from 'groq-sdk'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions.js'

/**
 * Groq retira modelos sin avisar y sin período de gracia: el día que apagaron
 * la familia llama-3.x, TODAS las respuestas del agente (web y WhatsApp)
 * empezaron a fallar con 404 model_not_found. Si vuelve a pasar, la lista viva
 * está en `GET https://api.groq.com/openai/v1/models` con la misma API key —
 * ahí se ve qué hay hoy, no qué había cuando se escribió esto.
 *
 * Los dos modelos de abajo soportan tool use, que es el requisito duro: el
 * agente tiene 26 herramientas y sin ellas no puede escribir en la base.
 */
export const AI_MODEL          = 'openai/gpt-oss-120b'
export const AI_MODEL_FALLBACK = 'openai/gpt-oss-20b'
export const GEMINI_MODEL      = 'gemini-2.0-flash'   // 1500 req/día gratis

/**
 * Cliente AI con cadena de fallback automática:
 *
 *   Groq Key 1 (AI_MODEL)
 *     → rate limit → Gemini Flash      (si GOOGLE_AI_KEY configurado)
 *     → rate limit → Groq Key 2        (si GROQ_API_KEY_2 configurado)
 *     → rate limit → AI_MODEL_FALLBACK (misma key, sin tools, último recurso)
 *
 * OJO: la cadena sólo cubre RATE LIMIT. Cualquier otro error (modelo retirado,
 * key inválida, 500 de Groq) se propaga a propósito, para que se vea en el log
 * en vez de quedar enmascarado como una respuesta degradada.
 */
export class AiClient {
  private groq1: Groq
  private groq2: Groq | null
  private gemini: OpenAI | null  // OpenAI SDK apuntando a la API de Google

  constructor(groqKey1: string, groqKey2?: string, googleKey?: string) {
    this.groq1  = new Groq({ apiKey: groqKey1 })
    this.groq2  = groqKey2  ? new Groq({ apiKey: groqKey2 }) : null
    this.gemini = googleKey
      ? new OpenAI({
          apiKey: googleKey,
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        })
      : null
  }

  async chat(
    params: ChatCompletionCreateParamsNonStreaming,
  ): Promise<Groq.Chat.ChatCompletion> {
    // Por qué se acumulan en vez de lanzarse: un eslabón caído no es motivo
    // para abandonar los que siguen. Pasó en producción — Gemini respondía 404
    // porque su modelo también fue retirado, y ese 404 tumbaba la respuesta
    // entera aunque todavía quedaran dos alternativas por probar.
    const fallos: string[] = []

    // 1. Primary — Groq, AI_MODEL. Acá sí: cualquier error que no sea cupo se
    //    propaga tal cual, porque es la señal de que algo está roto de verdad.
    try {
      return await this.groq1.chat.completions.create(params)
    } catch (err) {
      if (!isRateLimit(err)) throw err
      fallos.push(`groq-1: sin cupo`)
    }

    // 2. Fallback — Gemini (OpenAI-compatible, soporta tools)
    if (this.gemini) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (this.gemini.chat.completions.create as any)({
          ...params,
          model: GEMINI_MODEL,
        })
        return res as Groq.Chat.ChatCompletion
      } catch (err) {
        fallos.push(`gemini (${GEMINI_MODEL}): ${describir(err)}`)
      }
    }

    // 3. Fallback — segunda key de Groq (mismo modelo, cupo aparte)
    if (this.groq2) {
      try {
        return await this.groq2.chat.completions.create(params)
      } catch (err) {
        fallos.push(`groq-2: ${describir(err)}`)
      }
    }

    // 4. Último recurso: modelo pequeño SIN herramientas.
    //
    //    Solo vale cuando la petición original tampoco traía herramientas. Si
    //    las traía, el usuario está pidiendo una acción — registrar un gasto,
    //    crear un pedido — y un modelo sin herramientas no puede ejecutarla
    //    pero sí puede redactar un "listo, ya lo registré" perfectamente
    //    convincente. En un CRM eso es peor que no responder: queda plata sin
    //    registrar y el dueño creyendo que sí quedó.
    const pedíaHerramientas = Array.isArray(params.tools) && params.tools.length > 0
    if (pedíaHerramientas) {
      throw new SinCupoError(fallos)
    }

    try {
      const result = await this.groq1.chat.completions.create({
        ...params,
        model: AI_MODEL_FALLBACK,
        tools: undefined,
        tool_choice: undefined,
      })
      if (result.choices[0]?.message) {
        const original = result.choices[0].message.content ?? ''
        result.choices[0].message.content =
          `⚠ Límite alcanzado, usando modelo de respaldo.\n\n${original}`
      }
      return result
    } catch (err) {
      fallos.push(`groq-1 (${AI_MODEL_FALLBACK}): ${describir(err)}`)
      throw new SinCupoError(fallos)
    }
  }
}

/**
 * Se agotó la cadena entera. Lleva el detalle de cada eslabón para que el log
 * diga por qué falló cada uno, en vez de un único error que esconde el resto.
 */
export class SinCupoError extends Error {
  readonly fallos: string[]
  constructor(fallos: string[]) {
    super(`sin cupo de IA — ${fallos.join(' | ')}`)
    this.name = 'SinCupoError'
    this.fallos = fallos
  }
}

function describir(err: unknown): string {
  if (err instanceof Error) {
    const status = 'status' in err ? (err as { status?: number }).status : undefined
    return status ? `${status} ${err.message.slice(0, 80)}` : err.message.slice(0, 80)
  }
  return String(err).slice(0, 80)
}

export function isRateLimit(err: unknown): boolean {
  // Quedarse sin cupo en toda la cadena es un caso de límite, no un fallo
  // raro: quien lo reciba debe decir "intentá en un rato", no "algo se rompió".
  if (err instanceof SinCupoError) return true
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('rate limit') ||
      msg.includes('rate_limit') ||
      msg.includes('quota') ||
      msg.includes('429') ||
      ('status' in err && (err as { status: number }).status === 429)
    )
  }
  return false
}

// Para /ai/notas (modelo pequeño directo, sin fallback necesario)
export function getGroq(apiKey: string): Groq {
  return new Groq({ apiKey })
}

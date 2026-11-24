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
    // 1. Primary — Groq, AI_MODEL
    try {
      return await this.groq1.chat.completions.create(params)
    } catch (err) {
      if (!isRateLimit(err)) throw err
    }

    // 2. Fallback — Gemini 2.0 Flash (OpenAI-compatible, full tool use)
    if (this.gemini) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (this.gemini.chat.completions.create as any)({
          ...params,
          model: GEMINI_MODEL,
        })
        return res as Groq.Chat.ChatCompletion
      } catch (err) {
        if (!isRateLimit(err)) throw err
      }
    }

    // 3. Fallback — segunda key de Groq (mismo modelo)
    if (this.groq2) {
      try {
        return await this.groq2.chat.completions.create(params)
      } catch (err) {
        if (!isRateLimit(err)) throw err
      }
    }

    // 4. Último recurso — modelo pequeño sin tools en Key 1
    const fallbackParams = {
      ...params,
      model: AI_MODEL_FALLBACK,
      tools: undefined,
      tool_choice: undefined,
    }
    const result = await this.groq1.chat.completions.create(fallbackParams)
    if (result.choices[0]?.message) {
      const original = result.choices[0].message.content ?? ''
      result.choices[0].message.content =
        `⚠ Límite diario alcanzado, usando modelo de respaldo.\n\n${original}`
    }
    return result
  }
}

export function isRateLimit(err: unknown): boolean {
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

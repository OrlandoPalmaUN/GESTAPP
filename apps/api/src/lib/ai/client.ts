import Groq from 'groq-sdk'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions.js'

export const AI_MODEL          = 'llama-3.3-70b-versatile'
export const AI_MODEL_FALLBACK = 'llama-3.1-8b-instant'
export const GEMINI_MODEL      = 'gemini-2.0-flash'   // 1500 req/día gratis

/**
 * Cliente AI con cadena de fallback automática:
 *
 *   Groq Key 1 (llama-3.3-70b)
 *     → rate limit → Gemini Flash  (si GOOGLE_AI_KEY configurado)
 *     → rate limit → Groq Key 2    (si GROQ_API_KEY_2 configurado)
 *     → rate limit → llama-3.1-8b  (misma key, sin tools, último recurso)
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
    // 1. Primary — Groq llama-3.3-70b
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

function isRateLimit(err: unknown): boolean {
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

import Groq from 'groq-sdk'
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions.js'

export const AI_MODEL = 'llama-3.3-70b-versatile'
export const AI_MODEL_FALLBACK = 'llama-3.1-8b-instant' // más rápido, menor capacidad

/**
 * Cliente con fallback automático.
 * - Si hay GROQ_API_KEY_2: intenta con la segunda key ante rate limit (429)
 * - Si no: degrada al modelo pequeño en la misma key (llama-3.1-8b)
 */
export class AiClient {
  private primary: Groq
  private fallback: Groq | null

  constructor(primaryKey: string, fallbackKey?: string) {
    this.primary = new Groq({ apiKey: primaryKey })
    this.fallback = fallbackKey ? new Groq({ apiKey: fallbackKey }) : null
  }

  async chat(
    params: ChatCompletionCreateParamsNonStreaming,
  ): Promise<Groq.Chat.ChatCompletion> {
    try {
      return await this.primary.chat.completions.create(params)
    } catch (err) {
      if (!isRateLimit(err)) throw err

      // Rate limit alcanzado — intentar fallback
      if (this.fallback) {
        // Segunda key: mismo modelo
        return await this.fallback.chat.completions.create(params)
      }

      // Sin segunda key: degradar al modelo pequeño (sin tool use)
      const fallbackParams = {
        ...params,
        model: AI_MODEL_FALLBACK,
        tools: undefined,
        tool_choice: undefined,
      }
      const result = await this.primary.chat.completions.create(fallbackParams)

      // Marcar la respuesta para que el frontend sepa que fue el fallback
      if (result.choices[0]?.message) {
        const original = result.choices[0].message.content ?? ''
        result.choices[0].message.content =
          `⚠ Límite diario alcanzado, usando modelo de respaldo.\n\n${original}`
      }
      return result
    }
  }
}

function isRateLimit(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('rate limit') ||
      msg.includes('rate_limit') ||
      msg.includes('429') ||
      ('status' in err && (err as { status: number }).status === 429)
    )
  }
  return false
}

// Backward-compat para el notas route que usa Groq directamente
export function getGroq(apiKey: string): Groq {
  return new Groq({ apiKey })
}

/**
 * POST /ai/chat   — Agente principal con tool use
 * POST /ai/notas  — Mejorar texto de notas (sin tools, rápido)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type Groq from 'groq-sdk'
import { AiClient, getGroq, AI_MODEL, AI_MODEL_FALLBACK, isRateLimit } from '../../lib/ai/client.js'
import { getToolsForContext } from '../../lib/ai/tools.js'
import { executeTool } from '../../lib/ai/executor.js'
import { buildSystemPrompt, buildNotasPrompt } from '../../lib/ai/prompts.js'
import { cargarContextoNegocio } from '../../lib/ai/contexto.js'

function exigirTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest('Esta operación requiere una empresa asociada.')
    return false
  }
  return true
}

export async function aiChatRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  if (!fastify.config.GROQ_API_KEY) {
    fastify.log.warn('GROQ_API_KEY no configurada — rutas /ai/* deshabilitadas')
    fastify.post('/ai/chat', async (_req, reply) => reply.serviceUnavailable('IA no configurada: falta GROQ_API_KEY'))
    fastify.post('/ai/notas', async (_req, reply) => reply.serviceUnavailable('IA no configurada: falta GROQ_API_KEY'))
    return
  }

  const aiClient = new AiClient(
    fastify.config.GROQ_API_KEY,
    fastify.config.GROQ_API_KEY_2 || undefined,
    fastify.config.GOOGLE_AI_KEY  || undefined,
  )
  const groq = getGroq(fastify.config.GROQ_API_KEY) // solo para /ai/notas

  // ─────────────────────────────────────────────────────────────────────────
  // POST /ai/chat
  // Body: { messages: [{role, content}], context?: string }
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/ai/chat', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { messages, context = 'general' } = request.body as {
      messages: Groq.Chat.ChatCompletionMessageParam[]
      context?: string
    }

    if (!messages?.length) return reply.badRequest('messages requerido')

    // Limitar historial a los últimos 12 mensajes para contener uso de tokens
    const recentMessages = messages.slice(-12)

    const tenantName = request.tenant.name ?? request.tenant.slug

    const biz = await cargarContextoNegocio(request.tenantDb, tenantName, context, fastify.log)

    const systemPrompt = buildSystemPrompt(biz)

    const tools = getToolsForContext(context)

    const allMessages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...recentMessages,
    ]

    // Loop de tool calls — máximo 5 iteraciones para evitar ciclos infinitos
    try {
    for (let i = 0; i < 5; i++) {
      const completion = await aiClient.chat({
        model: AI_MODEL,
        messages: allMessages,
        tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 1024,
      })

      const msg = completion.choices[0]?.message
      if (!msg) break

      // Sin tool calls → respuesta final
      if (!msg.tool_calls?.length) {
        return reply.send({
          response: msg.content ?? '',
          actions: [],
        })
      }

      // Ejecutar herramientas
      allMessages.push(msg)

      const toolResults: Groq.Chat.ChatCompletionToolMessageParam[] = []
      const actions: { tool: string; result: unknown }[] = []

      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
        fastify.log.info({ tool: tc.function.name, args }, 'ai:tool_call')

        const result = await executeTool(tc.function.name, args, request.tenantDb)
        actions.push({ tool: tc.function.name, result: result.data })

        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result.success ? result.data : { error: result.error }),
        })
      }

      allMessages.push(...toolResults)

      // Si fue solo una acción, hacer una última vuelta para generar confirmación en lenguaje natural
    }

    // Fallback — pedir confirmación final
    const finalCompletion = await aiClient.chat({
      model: AI_MODEL,
      messages: allMessages,
      temperature: 0.3,
      max_tokens: 512,
    })

    return reply.send({
      response: finalCompletion.choices[0]?.message?.content ?? 'Listo.',
      actions: [],
    })
    } catch (err) {
      fastify.log.error({ err }, 'ai:chat error')
      if (isRateLimit(err)) {
        return reply.send({
          response: '⏳ Límite diario de IA alcanzado. Intenta de nuevo en unos minutos.',
          actions: [],
        })
      }
      return reply.send({
        response: '⚠ Error al procesar tu mensaje. Intenta de nuevo.',
        actions: [],
      })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // POST /ai/notas
  // Body: { texto: string, instruccion: 'mejorar' | 'formal' | 'resumir' | 'bullet' | 'custom', customPrompt?: string }
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/ai/notas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { texto, instruccion = 'mejorar', customPrompt } = request.body as {
      texto: string
      instruccion?: string
      customPrompt?: string
    }

    if (!texto?.trim()) return reply.badRequest('texto requerido')

    const instrucciones: Record<string, string> = {
      mejorar: 'Mejora la redacción manteniendo el mismo significado y tono.',
      formal: 'Reescribe el texto en un tono más formal y profesional.',
      resumir: 'Resume el texto en 2-3 oraciones clave.',
      bullet: 'Convierte el texto en una lista de puntos claros con viñetas (•).',
      custom: customPrompt ?? 'Mejora el texto.',
    }

    const systemPrompt = buildNotasPrompt(instrucciones[instruccion] ?? instrucciones.mejorar ?? 'Mejora el texto.')

    const completion = await groq.chat.completions.create({
      model: AI_MODEL_FALLBACK, // modelo más pequeño y rápido para texto simple
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: texto },
      ],
      temperature: 0.4,
      max_tokens: 512,
    })

    return reply.send({
      resultado: completion.choices[0]?.message?.content ?? texto,
    })
  })
}

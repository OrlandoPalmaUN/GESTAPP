/**
 * POST /ai/chat   — Agente principal con tool use
 * POST /ai/notas  — Mejorar texto de notas (sin tools, rápido)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type Groq from 'groq-sdk'
import { AiClient, getGroq, AI_MODEL, isRateLimit } from '../../lib/ai/client.js'
import { getToolsForContext } from '../../lib/ai/tools.js'
import { executeTool } from '../../lib/ai/executor.js'
import { buildSystemPrompt, buildNotasPrompt, type BusinessContext } from '../../lib/ai/prompts.js'

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

    // ── Cargar datos reales del negocio para enriquecer el system prompt ─────
    const biz: BusinessContext = { tenantName, context }
    try {
      const db = request.tenantDb

      const [productos, stockCrit, ventas, pendientes, clientes, vencidas, saldos] = await Promise.all([
        db.query<{ nombre: string; precio: number; stock: number }>(
          `SELECT p.nombre, p.precio_venta::numeric AS precio,
                  COALESCE((SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva') THEN cantidad ELSE -cantidad END) FROM movimientos_inventario WHERE producto_id = p.id),0) AS stock
           FROM productos p WHERE p.deleted_at IS NULL ORDER BY stock DESC LIMIT 5`,
        ),
        db.query<{ nombre: string; stock: number; minimo: number }>(
          `SELECT p.nombre,
                  COALESCE((SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva') THEN cantidad ELSE -cantidad END) FROM movimientos_inventario WHERE producto_id = p.id),0) AS stock,
                  p.stock_minimo AS minimo
           FROM productos p
           WHERE p.stock_minimo > 0 AND p.deleted_at IS NULL
             AND COALESCE((SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva') THEN cantidad ELSE -cantidad END) FROM movimientos_inventario WHERE producto_id = p.id),0) <= p.stock_minimo
           LIMIT 5`,
        ),
        db.query<{ total: number; pedidos: number }>(
          `SELECT COALESCE(SUM(total),0)::int AS total, COUNT(*)::int AS pedidos
           FROM pedidos
           WHERE created_at >= date_trunc('month', NOW())
             AND estado != 'cancelado'
             AND deleted_at IS NULL`,
        ),
        db.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total FROM pedidos
           WHERE estado IN ('borrador','confirmado','en_preparacion') AND deleted_at IS NULL`,
        ),
        db.query<{ nombre: string }>(
          `SELECT nombre FROM clientes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`,
        ),
        // Facturas vencidas (CxC y CxP con saldo > 0 y fecha_vencimiento pasada)
        db.query<{ total: number }>(`
          SELECT (
            (SELECT COUNT(*) FROM facturas_venta fv
             WHERE fv.deleted_at IS NULL
               AND fv.fecha_vencimiento < CURRENT_DATE
               AND fv.total > COALESCE((SELECT SUM(monto) FROM abonos
                                        WHERE tipo_documento = 'factura_venta'
                                          AND documento_id = fv.id AND deleted_at IS NULL), 0))
            +
            (SELECT COUNT(*) FROM facturas_compra fc
             WHERE fc.deleted_at IS NULL
               AND fc.fecha_vencimiento < CURRENT_DATE
               AND fc.total > COALESCE((SELECT SUM(monto) FROM abonos
                                        WHERE tipo_documento = 'factura_compra'
                                          AND documento_id = fc.id AND deleted_at IS NULL), 0))
          )::int AS total
        `),
        db.query<{ saldo: number }>(`
          SELECT COALESCE(SUM(saldo), 0)::numeric AS saldo
          FROM cuentas_bancarias WHERE deleted_at IS NULL
        `),
      ])

      biz.topProductos    = productos.rows
      biz.stockCritico    = stockCrit.rows
      biz.ventasMes       = ventas.rows[0]
      biz.pedidosPendientes = pendientes.rows[0]?.total ?? 0
      biz.topClientes     = clientes.rows
      biz.facturasVencidas = vencidas.rows[0]?.total ?? 0
      biz.saldoCuentas    = Number(saldos.rows[0]?.saldo ?? 0)

      // Datos de IG solo en contexto redes
      if (context === 'redes') {
        const [igCuenta, igHashtags, igHeatmap] = await Promise.all([
          db.query<{ handle: string; seguidores: number }>(
            `SELECT c.handle, s.seguidores
             FROM ig_cuentas c
             LEFT JOIN ig_cuenta_snapshots s ON s.cuenta_id = c.id
             ORDER BY c.created_at ASC, s.fecha DESC LIMIT 1`,
          ),
          db.query<{ hashtag: string }>(
            `SELECT hashtag FROM (
               SELECT UNNEST(hashtags) AS hashtag, AVG(likes + comentarios) AS eng
               FROM ig_posts WHERE publicado_en >= NOW() - INTERVAL '30 days'
               GROUP BY hashtag ORDER BY eng DESC LIMIT 6
             ) t`,
          ),
          db.query<{ dia: number; hora: number; eng: number }>(
            `SELECT EXTRACT(DOW FROM publicado_en)::int AS dia,
                    EXTRACT(HOUR FROM publicado_en)::int AS hora,
                    AVG(likes + comentarios) AS eng
             FROM ig_posts GROUP BY 1,2 ORDER BY eng DESC LIMIT 1`,
          ),
        ])

        biz.igHandle      = igCuenta.rows[0]?.handle ?? null
        biz.igSeguidores  = igCuenta.rows[0]?.seguidores ?? null
        biz.igTopHashtags = igHashtags.rows.map(r => r.hashtag)

        const mejor = igHeatmap.rows[0]
        if (mejor) {
          const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
          biz.igMejorHora = `${dias[mejor.dia] ?? 'día'} a las ${mejor.hora}:00`
        }
      }
    } catch (err) {
      fastify.log.warn({ err }, 'ai: no se pudo cargar contexto del negocio')
      // No bloqueamos — el chat funciona con datos vacíos
    }

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
      model: 'llama-3.1-8b-instant', // modelo más pequeño y rápido para texto simple
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

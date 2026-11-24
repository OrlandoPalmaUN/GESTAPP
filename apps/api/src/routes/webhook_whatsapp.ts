/**
 * Webhook de la WhatsApp Business Cloud API.
 *
 *   GET  /webhooks/whatsapp  → verificación: devuelve `hub.challenge` en texto
 *                              plano si el verify token coincide. Meta lo pega
 *                              una vez, al suscribir la URL.
 *   POST /webhooks/whatsapp  → notificaciones. Valida la firma, responde 200
 *                              INMEDIATAMENTE y procesa después.
 *
 * El 200 inmediato no es una optimización: si Meta no lo recibe a tiempo
 * reintenta el mismo evento, y con un agente detrás eso significa contestar
 * dos veces (o dos veces registrar un pedido). Responder primero y trabajar
 * después es lo que hace que el reintento no exista; el dedupe por
 * `message.id` es la segunda red, para cuando el 200 se pierda en la red.
 *
 * Una app de Meta solo admite UN webhook, así que dev y prod necesitan dos
 * apps distintas — no se puede apuntar la misma a localhost y a producción.
 */

import type { FastifyInstance } from 'fastify'

import { AiClient } from '../lib/ai/client.js'
import { crearAgenteWhatsapp } from '../lib/whatsapp/agente.js'
import { validarFirmaMeta } from '../lib/whatsapp/webhook.js'

interface VerificacionQuery {
  'hub.mode'?: string
  'hub.verify_token'?: string
  'hub.challenge'?: string
}

export async function webhookWhatsappRoutes(fastify: FastifyInstance): Promise<void> {
  const { WHATSAPP_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, GROQ_API_KEY } =
    fastify.config

  // Las tres credenciales son indivisibles: sin token no se puede contestar,
  // sin app secret no se puede confiar en lo que llega, y sin verify token Meta
  // no deja suscribir la URL. Falta una → el canal no existe, y se dice por qué
  // en el log en vez de fallar en el primer mensaje real.
  const faltantes = [
    !WHATSAPP_TOKEN && 'WHATSAPP_TOKEN',
    !WHATSAPP_APP_SECRET && 'WHATSAPP_APP_SECRET',
    !WHATSAPP_VERIFY_TOKEN && 'WHATSAPP_VERIFY_TOKEN',
    !GROQ_API_KEY && 'GROQ_API_KEY',
  ].filter((v): v is string => typeof v === 'string')

  if (faltantes.length > 0) {
    fastify.log.warn(
      { faltantes },
      'whatsapp: canal deshabilitado — faltan variables de entorno',
    )
    return
  }

  const agente = crearAgenteWhatsapp(
    fastify,
    new AiClient(
      GROQ_API_KEY,
      fastify.config.GROQ_API_KEY_2 || undefined,
      fastify.config.GOOGLE_AI_KEY || undefined,
    ),
  )

  // Body crudo, solo en este scope. La firma de Meta es un HMAC sobre los BYTES
  // exactos que llegaron: si se valida contra el JSON reparseado y
  // reserializado, el orden de claves y los espacios cambian y la firma nunca
  // coincide. `register` encapsula, así que esto no altera el parser del resto
  // de la app — pero el scope hereda una copia del parser del padre, y hay que
  // quitarla antes de poner la propia.
  fastify.removeContentTypeParser(['application/json'])
  fastify.addContentTypeParser<Buffer>(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      ;(request as { rawBody?: Buffer }).rawBody = body
      if (body.length === 0) return done(null, {})
      try {
        done(null, JSON.parse(body.toString('utf8')))
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  // ── Verificación ──────────────────────────────────────────────────────────
  fastify.get<{ Querystring: VerificacionQuery }>('/webhooks/whatsapp', async (request, reply) => {
    const modo = request.query['hub.mode']
    const token = request.query['hub.verify_token']
    const challenge = request.query['hub.challenge']

    if (modo !== 'subscribe' || token !== WHATSAPP_VERIFY_TOKEN) {
      fastify.log.warn({ modo }, 'whatsapp: verificación rechazada')
      return reply.forbidden('Verificación inválida.')
    }

    // Texto plano, no JSON: Meta compara el cuerpo literal con el challenge
    // que mandó. Un `"123"` con comillas no le sirve.
    return reply.type('text/plain').send(challenge ?? '')
  })

  // ── Notificaciones ────────────────────────────────────────────────────────
  fastify.post('/webhooks/whatsapp', async (request, reply) => {
    const firma = request.headers['x-hub-signature-256'] as string | undefined
    const rawBody = (request as { rawBody?: Buffer }).rawBody

    if (!rawBody) {
      fastify.log.error('whatsapp: sin rawBody — el content-type parser no corrió')
      return reply.code(400).send({ error: 'rawBody no disponible.' })
    }

    if (!validarFirmaMeta(rawBody, firma, WHATSAPP_APP_SECRET)) {
      // Este endpoint es público. Sin esta validación, cualquiera puede inyectar
      // mensajes falsos, hacer que el agente le escriba a números arbitrarios y
      // quemar la cuota diaria de LLM.
      fastify.log.warn({ firma: firma ? 'presente' : 'ausente' }, 'whatsapp: firma inválida')
      return reply.code(401).send({ error: 'Firma inválida.' })
    }

    const body = request.body

    // 200 primero. `setImmediate` para que la respuesta salga antes de empezar
    // a trabajar: dentro del mismo tick, un `await` largo retrasaría el flush
    // y Meta reintentaría igual.
    reply.code(200).send({ ok: true })
    setImmediate(() => {
      void agente.procesarPayload(body).catch((err) => {
        fastify.log.error({ err }, 'whatsapp: fallo procesando el payload')
      })
    })
  })
}

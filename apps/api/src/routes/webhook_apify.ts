/**
 * Webhook de Apify — recibe notificaciones cuando un run async termina.
 * Valida la firma HMAC antes de tocar cualquier dato.
 *
 * Usado por runs de backfill largos (>120s). El run síncrono del cron diario
 * y el refresh manual no pasan por aquí — bloquean directamente.
 */

import type { FastifyInstance } from 'fastify'
import { validarHmacApify } from '../lib/apify/webhook.js'
import { apifyGetDataset } from '../lib/apify/client.js'
import { persistIgScrape } from '../lib/apify/persistor.js'
import type { ApifyIgPost } from '../lib/apify/types.js'

interface ApifyWebhookBody {
  runId: string
  status: 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED-OUT'
  datasetId: string
  /** Datos extra que inyectamos al crear el run async. */
  tenantId?: string
  tenantSchemaName?: string
}

export async function webhookApifyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: ApifyWebhookBody }>(
    '/webhooks/apify',
    {
      config: { rawBody: true }, // requiere @fastify/rawbody para el HMAC
    },
    async (request, reply) => {
      // ── 1. Validar firma HMAC ─────────────────────────────────────────────
      const signature = request.headers['x-apify-webhook-signature'] as string | undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawBody = (request as any).rawBody as Buffer | undefined

      if (!rawBody) {
        fastify.log.warn('webhook apify sin rawBody — ¿falta @fastify/rawbody?')
        return reply.code(400).send({ error: 'rawBody no disponible.' })
      }

      const esValido = validarHmacApify(rawBody, signature, fastify.config.APIFY_WEBHOOK_SECRET)
      if (!esValido) {
        fastify.log.warn({ signature }, 'webhook apify: firma inválida')
        return reply.code(401).send({ error: 'Firma inválida.' })
      }

      const { runId, status, datasetId, tenantId, tenantSchemaName } = request.body

      // ── 2. Actualizar estado del run en la tabla pública ─────────────────
      await fastify.prisma.apifyScrapeRun.updateMany({
        where: { apifyRunId: runId },
        data: {
          status: status === 'SUCCEEDED' ? 'succeeded' : 'failed',
          finishedAt: new Date(),
        },
      })

      if (status !== 'SUCCEEDED') {
        fastify.log.warn({ runId, status }, 'webhook apify: run no exitoso')
        return reply.send({ ok: true })
      }

      if (!tenantSchemaName) {
        fastify.log.error({ runId }, 'webhook apify: falta tenantSchemaName en payload')
        return reply.send({ ok: true })
      }

      // ── 3. Descargar dataset y persistir ──────────────────────────────────
      try {
        const items = await apifyGetDataset<ApifyIgPost>(datasetId, fastify.config.APIFY_TOKEN)

        if (!items.length) {
          fastify.log.info({ runId, tenantSchemaName }, 'webhook apify: dataset vacío')
          return reply.send({ ok: true })
        }

        // Reconectar al schema del tenant
        const client = await fastify.pg.connect()
        try {
          await client.query(`SET search_path TO "${tenantSchemaName}", public`)

          const profile = items[0]
            ? {
                handle: items[0].ownerUsername,
                igUserId: null,
                displayName: items[0].ownerFullName ?? null,
                bio: null,
                avatarUrl: null,
                verified: items[0].ownerVerified,
                categoria: null,
                sitioWeb: null,
                followersCount: items[0].ownerFollowersCount ?? 0,
                followingCount: 0,
                postsCount: 0,
                isPrivate: false,
              }
            : null

          await persistIgScrape(client, { profile, posts: items })

          fastify.log.info(
            { runId, tenantSchemaName, posts: items.length },
            'webhook apify: backfill persistido',
          )
        } finally {
          await client.query('RESET search_path')
          client.release()
        }
      } catch (err) {
        fastify.log.error({ err, runId, tenantSchemaName }, 'webhook apify: error persistiendo')
      }

      return reply.send({ ok: true })
    },
  )
}

/**
 * Plugin de Fastify: cron diario de scraping de Instagram.
 *
 * Ejecuta a las 03:00 (hora Colombia, UTC-5 → 08:00 UTC) todos los días.
 * Por cada tenant activo con una cuenta IG configurada y cron_activado = true,
 * lanza scrapeIgProfile y persiste los resultados.
 *
 * Para activar: APIFY_TOKEN debe estar en las variables de entorno.
 * Para desactivar en dev sin token: el plugin se registra pero no programa nada.
 */

import fp from 'fastify-plugin'
import cron from 'node-cron'
import type { FastifyInstance } from 'fastify'
import { executeIgScrapeRun } from '../lib/apify/runs.js'

export const igCronPlugin = fp(async (fastify: FastifyInstance) => {
  const { APIFY_TOKEN, APIFY_DEFAULT_ACTOR } = fastify.config

  if (!APIFY_TOKEN) {
    fastify.log.warn('igCron: APIFY_TOKEN no configurado — cron desactivado')
    return
  }

  // 08:00 UTC = 03:00 Colombia (UTC-5)
  cron.schedule('0 8 * * *', async () => {
    fastify.log.info('igCron: iniciando scrape diario de Instagram')

    let tenants: { tenantId: string; schemaName: string }[]
    try {
      const { rows } = await fastify.pg.query<{
        tenantId: string
        schemaName: string
      }>(`
        SELECT
          t.id          AS "tenantId",
          t.schema_name AS "schemaName"
        FROM public.tenants t
        WHERE t.status = 'active'
      `)
      tenants = rows
    } catch (err) {
      fastify.log.error({ err }, 'igCron: error consultando tenants')
      return
    }

    for (const tenant of tenants) {
      // Solo necesitamos una conexión para leer el handle + config del tenant.
      // El scrape real reabre su propia conexión vía executeIgScrapeRun para
      // no mantener el search_path setteado durante el HTTP call a Apify.
      const client = await fastify.pg.connect()
      let cfg: { handle: string; postsRun: number; comentariosRun: number } | null = null
      try {
        await client.query(`SET search_path TO "${tenant.schemaName}", public`)
        const { rows: cfgRows } = await client.query<{
          handle: string
          postsRun: number
          comentariosRun: number
        }>(`
          SELECT c.handle, cfg.posts_por_run AS "postsRun", cfg.comentarios_por_post AS "comentariosRun"
          FROM ig_config cfg
          JOIN ig_cuentas c ON c.id = cfg.cuenta_id
          WHERE cfg.cron_activado = TRUE
          LIMIT 1
        `)
        cfg = cfgRows[0] ?? null
      } catch (err) {
        fastify.log.error({ err, schema: tenant.schemaName }, 'igCron: error leyendo config')
      } finally {
        await client.query('RESET search_path').catch(() => undefined)
        client.release()
      }

      if (!cfg) continue

      fastify.log.info({ schema: tenant.schemaName, handle: cfg.handle }, 'igCron: scraping')
      const outcome = await executeIgScrapeRun({
        prisma: fastify.prisma,
        pgConnect: () => fastify.pg.connect(),
        tenantId: tenant.tenantId,
        schemaName: tenant.schemaName,
        handle: cfg.handle,
        apifyToken: APIFY_TOKEN,
        apifyActor: APIFY_DEFAULT_ACTOR,
        trigger: 'cron',
        opts: {
          postsLimit: cfg.postsRun,
          comentariosLimit: cfg.comentariosRun,
        },
      })

      if (outcome.status === 'failed') {
        fastify.log.error(
          { schema: tenant.schemaName, runId: outcome.runId, error: outcome.error },
          'igCron: tenant fallido',
        )
      } else {
        fastify.log.info(
          { schema: tenant.schemaName, runId: outcome.runId, posts: outcome.postsUpserted },
          'igCron: tenant ok',
        )
      }
    }

    fastify.log.info('igCron: scrape diario finalizado')
  }, {
    timezone: 'UTC',
  })

  fastify.log.info('igCron: cron diario registrado (08:00 UTC = 03:00 Colombia)')
})

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
import { scrapeIgProfile } from '../lib/apify/scraper.js'
import { persistIgScrape } from '../lib/apify/persistor.js'

export const igCronPlugin = fp(async (fastify: FastifyInstance) => {
  const { APIFY_TOKEN, APIFY_DEFAULT_ACTOR } = fastify.config

  if (!APIFY_TOKEN) {
    fastify.log.warn('igCron: APIFY_TOKEN no configurado — cron desactivado')
    return
  }

  // 08:00 UTC = 03:00 Colombia (UTC-5)
  cron.schedule('0 8 * * *', async () => {
    fastify.log.info('igCron: iniciando scrape diario de Instagram')

    // Obtener todos los tenants activos con cuenta IG y cron activado
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
      const client = await fastify.pg.connect()
      try {
        await client.query(`SET search_path TO "${tenant.schemaName}", public`)

        // ¿Existe cuenta IG con cron activo?
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

        if (!cfgRows[0]) {
          fastify.log.debug({ schema: tenant.schemaName }, 'igCron: sin cuenta IG o cron desactivado, saltando')
          continue
        }

        const { handle, postsRun, comentariosRun } = cfgRows[0]
        fastify.log.info({ schema: tenant.schemaName, handle }, 'igCron: scraping')

        const result = await scrapeIgProfile(handle, APIFY_TOKEN, APIFY_DEFAULT_ACTOR, {
          postsLimit: postsRun,
          comentariosLimit: comentariosRun,
        })

        const { postsUpserted, comentariosUpserted } = await persistIgScrape(client, result)
        fastify.log.info(
          { schema: tenant.schemaName, handle, postsUpserted, comentariosUpserted },
          'igCron: scrape completado',
        )
      } catch (err) {
        fastify.log.error({ err, schema: tenant.schemaName }, 'igCron: error en tenant')
      } finally {
        await client.query('RESET search_path')
        client.release()
      }
    }

    fastify.log.info('igCron: scrape diario finalizado')
  }, {
    timezone: 'UTC',
  })

  fastify.log.info('igCron: cron diario registrado (08:00 UTC = 03:00 Colombia)')
})

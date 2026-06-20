/**
 * Plugin de Fastify: cron mensual de análisis IA de reportes.
 *
 * Ejecuta a las 05:10 UTC (00:10 Colombia, UTC-5) del día 1 de cada mes —
 * cuando el mes anterior ya cerró por completo. Por cada tenant activo,
 * genera (y guarda) el análisis IA del mes que recién terminó, así el
 * usuario lo encuentra ya listo en Reportes sin tener que pedirlo
 * manualmente — solo "Re-analizar" si quiere refrescarlo.
 *
 * Por qué regenerar siempre (no solo si falta): si alguien generó el
 * análisis a mitad del mes con datos incompletos, el cron lo sobrescribe
 * con la versión final del mes ya cerrado (mismo UPSERT por periodo_key
 * que usa la generación manual).
 */

import fp from 'fastify-plugin'
import cron from 'node-cron'
import type { FastifyInstance } from 'fastify'
import { getGroq } from '../lib/ai/client.js'
import { generarAnalisisIA, rangoMes } from '../routes/tenant/reportes.js'

export const reportesCronPlugin = fp(async (fastify: FastifyInstance) => {
  const { GROQ_API_KEY } = fastify.config

  if (!GROQ_API_KEY) {
    fastify.log.warn('reportesCron: GROQ_API_KEY no configurado — cron desactivado')
    return
  }

  const groq = getGroq(GROQ_API_KEY)

  cron.schedule('10 5 1 * *', async () => {
    fastify.log.info('reportesCron: iniciando análisis IA mensual')

    // Mes que recién cerró: si hoy es 1 de enero, el mes cerrado es diciembre del año anterior.
    const ahora = new Date()
    const mesCerrado = ahora.getUTCMonth() === 0 ? 12 : ahora.getUTCMonth()
    const añoCerrado = ahora.getUTCMonth() === 0 ? ahora.getUTCFullYear() - 1 : ahora.getUTCFullYear()
    const rango = rangoMes(añoCerrado, mesCerrado)

    let tenants: { tenantId: string; schemaName: string }[]
    try {
      const { rows } = await fastify.pg.query<{ tenantId: string; schemaName: string }>(`
        SELECT id AS "tenantId", schema_name AS "schemaName"
        FROM public.tenants WHERE status = 'active'
      `)
      tenants = rows
    } catch (err) {
      fastify.log.error({ err }, 'reportesCron: error consultando tenants')
      return
    }

    for (const tenant of tenants) {
      const client = await fastify.pg.connect()
      try {
        await client.query(`SET search_path TO "${tenant.schemaName}", public`)
        const { postsAnalizados } = await generarAnalisisIA(client, groq, rango)
        fastify.log.info(
          { schema: tenant.schemaName, periodo: rango.label, postsAnalizados },
          'reportesCron: análisis mensual generado y guardado',
        )
      } catch (err) {
        fastify.log.error({ err, schema: tenant.schemaName }, 'reportesCron: tenant fallido')
      } finally {
        await client.query('RESET search_path').catch(() => undefined)
        client.release()
      }
    }

    fastify.log.info('reportesCron: análisis IA mensual finalizado')
  }, {
    timezone: 'UTC',
  })

  fastify.log.info('reportesCron: cron mensual registrado (05:10 UTC del día 1 = 00:10 Colombia)')
})

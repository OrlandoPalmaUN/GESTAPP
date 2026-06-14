/**
 * Wrapper de scrapeIgProfile que registra cada ejecución en `public.apify_scrape_runs`
 * para tener trazabilidad: cuándo se intentó, si falló y por qué, cuántos posts trajo.
 *
 * Sin esto, una falla del scraper (timeout, perfil privado nuevo, rate limit de Apify)
 * es invisible — el usuario ve "actualización en proceso" y nunca sabe que no llegó.
 *
 * Se usa desde:
 *   - el refresh manual (POST /redes/ig/refresh)
 *   - el cron diario (igCronPlugin)
 *   - el backfill de onboarding (POST /redes/ig/cuenta)
 */

import type { PoolClient } from 'pg'
import type { PrismaClient } from '@antigravity/db'
import { scrapeIgProfile, type IgScrapeResult } from './scraper.js'
import { persistIgScrape } from './persistor.js'

export type IgRunTrigger = 'cron' | 'manual' | 'backfill'

export interface IgRunOptions {
  postsLimit: number
  comentariosLimit: number
}

export interface IgRunOutcome {
  runId: string
  status: 'succeeded' | 'failed'
  postsUpserted: number
  comentariosUpserted: number
  error?: string
}

/**
 * Ejecuta un scrape + persist + tracking de runs en una sola operación.
 * Garantiza que SIEMPRE se registre el resultado (éxito o fallo) en
 * public.apify_scrape_runs aunque el scrape lance una excepción.
 */
export async function executeIgScrapeRun(deps: {
  prisma: PrismaClient
  pgConnect: () => Promise<PoolClient>
  tenantId: string
  schemaName: string
  handle: string
  apifyToken: string
  apifyActor: string
  trigger: IgRunTrigger
  opts: IgRunOptions
}): Promise<IgRunOutcome> {
  const { prisma, pgConnect, tenantId, schemaName, handle, apifyToken, apifyActor, trigger, opts } = deps

  // Registrar el run como "running" antes de empezar
  const run = await prisma.apifyScrapeRun.create({
    data: {
      tenantId,
      actor: apifyActor,
      trigger,
      status: 'running',
    },
  })

  let result: IgScrapeResult
  try {
    result = await scrapeIgProfile(handle, apifyToken, apifyActor, opts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.apifyScrapeRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: message.slice(0, 500),
      },
    })
    return {
      runId: run.id,
      status: 'failed',
      postsUpserted: 0,
      comentariosUpserted: 0,
      error: message,
    }
  }

  // Persistir en el schema del tenant con conexión dedicada
  let persistencia: { postsUpserted: number; comentariosUpserted: number }
  try {
    const client = await pgConnect()
    try {
      await client.query(`SET search_path TO "${schemaName}", public`)
      persistencia = await persistIgScrape(client, result)
    } finally {
      await client.query('RESET search_path').catch(() => undefined)
      client.release()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.apifyScrapeRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: `Persist: ${message.slice(0, 480)}`,
      },
    })
    return {
      runId: run.id,
      status: 'failed',
      postsUpserted: 0,
      comentariosUpserted: 0,
      error: message,
    }
  }

  await prisma.apifyScrapeRun.update({
    where: { id: run.id },
    data: {
      status: 'succeeded',
      finishedAt: new Date(),
      itemsCount: persistencia.postsUpserted,
    },
  })

  return {
    runId: run.id,
    status: 'succeeded',
    postsUpserted: persistencia.postsUpserted,
    comentariosUpserted: persistencia.comentariosUpserted,
  }
}

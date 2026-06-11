/**
 * HTTP wrapper sobre la API de Apify.
 * Sin dependencias extra — usa fetch nativo (Node 18+).
 */

const APIFY_BASE = 'https://api.apify.com/v2'

export interface ApifyRunResult<T> {
  runId: string
  items: T[]
}

/**
 * Lanza un actor en modo SÍNCRONO y devuelve los items del dataset.
 * Bloquea hasta que el run termina (o hasta el timeout).
 *
 * Timeout: 130 s en el cliente → Apify corta el run a 120 s internamente.
 * Para runs más largos (backfill) usar apifyRunAsync + webhook.
 */
export async function apifyRunSync<T>(
  actor: string,
  input: Record<string, unknown>,
  token: string,
  timeoutSec = 120,
): Promise<ApifyRunResult<T>> {
  const slug = actor.replace('/', '~')
  const url = `${APIFY_BASE}/acts/${slug}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSec}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((timeoutSec + 10) * 1000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '(sin cuerpo)')
    throw new Error(`Apify ${res.status}: ${text}`)
  }

  const runId = res.headers.get('x-apify-run-id') ?? 'unknown'
  const items = (await res.json()) as T[]

  return { runId, items }
}

/**
 * Lanza un actor en modo ASÍNCRONO y devuelve el runId inmediatamente.
 * Apify notificará al webhookUrl cuando el run termine.
 * Útil para backfills largos que superarían el timeout síncrono.
 */
export async function apifyRunAsync(
  actor: string,
  input: Record<string, unknown>,
  token: string,
  webhookUrl: string,
  /** Datos extras que Apify incluirá en el payload del webhook */
  webhookMeta: Record<string, unknown> = {},
): Promise<string> {
  const slug = actor.replace('/', '~')
  const url = `${APIFY_BASE}/acts/${slug}/runs?token=${token}`

  const body = {
    ...input,
    webhooks: [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
        requestUrl: webhookUrl,
        payloadTemplate: JSON.stringify({
          runId: '{{runId}}',
          status: '{{status}}',
          datasetId: '{{defaultDatasetId}}',
          ...webhookMeta,
        }),
      },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '(sin cuerpo)')
    throw new Error(`Apify async ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { data: { id: string } }
  return data.data.id
}

/**
 * Descarga los items de un dataset ya existente (resultado de un run async).
 */
export async function apifyGetDataset<T>(
  datasetId: string,
  token: string,
): Promise<T[]> {
  const url = `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })

  if (!res.ok) {
    const text = await res.text().catch(() => '(sin cuerpo)')
    throw new Error(`Apify dataset ${res.status}: ${text}`)
  }

  return res.json() as Promise<T[]>
}

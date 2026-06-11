/**
 * Upserts transaccionales en las tablas del tenant (ig_cuentas, ig_posts, etc.)
 * a partir del resultado normalizado del scraper.
 * Todos los INSERTs usan ON CONFLICT DO UPDATE → idempotente ante re-runs.
 */

import type { PoolClient } from 'pg'
import type { IgScrapeResult } from './scraper.js'
import type { ApifyIgComment } from './types.js'

/** Convierte conteos de Apify a entero — pueden venir como "89.093" (locale es) */
function toInt(v: number | string | null | undefined): number {
  if (v == null) return 0
  if (typeof v === 'number') return Math.round(v)
  const clean = String(v).replace(/[.,]/g, '')
  const n = parseInt(clean, 10)
  return isNaN(n) ? 0 : n
}

function toPostTipo(apifyType: string): string {
  const t = apifyType.toLowerCase()
  if (t === 'sidecar') return 'carousel'
  if (t === 'video') return 'video'
  if (t.includes('reel')) return 'reel'
  return 'image'
}

function extractHashtags(caption: string | null): string[] {
  if (!caption) return []
  return [...caption.matchAll(/#(\w+)/g)]
    .map((m) => m[1])
    .filter((t): t is string => t !== undefined)
    .map((t) => t.toLowerCase())
}

function extractMentions(caption: string | null): string[] {
  if (!caption) return []
  return [...caption.matchAll(/@(\w+)/g)]
    .map((m) => m[1])
    .filter((t): t is string => t !== undefined)
    .map((t) => t.toLowerCase())
}

export async function persistIgScrape(
  db: PoolClient,
  result: IgScrapeResult,
): Promise<{ cuentaId: string; postsUpserted: number; comentariosUpserted: number }> {
  const { profile, posts } = result
  if (!profile) return { cuentaId: '', postsUpserted: 0, comentariosUpserted: 0 }

  const today = new Date().toISOString().slice(0, 10)

  // ── 1. UPSERT ig_cuentas ──────────────────────────────────────────────────
  const { rows: cuentaRows } = await db.query<{ id: string }>(
    `INSERT INTO ig_cuentas
       (handle, ig_user_id, display_name, bio, avatar_url,
        es_verificada, categoria, sitio_web, last_scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (handle) DO UPDATE SET
       ig_user_id      = COALESCE(EXCLUDED.ig_user_id,      ig_cuentas.ig_user_id),
       display_name    = COALESCE(EXCLUDED.display_name,    ig_cuentas.display_name),
       bio             = COALESCE(EXCLUDED.bio,             ig_cuentas.bio),
       avatar_url      = COALESCE(EXCLUDED.avatar_url,      ig_cuentas.avatar_url),
       es_verificada   = EXCLUDED.es_verificada,
       categoria       = COALESCE(EXCLUDED.categoria,       ig_cuentas.categoria),
       sitio_web       = COALESCE(EXCLUDED.sitio_web,       ig_cuentas.sitio_web),
       last_scraped_at = NOW()
     RETURNING id`,
    [
      profile.handle,
      profile.igUserId ?? null,
      profile.displayName ?? null,
      profile.bio ?? null,
      profile.avatarUrl ?? null,
      profile.verified ?? false,   // Apify no siempre devuelve este campo
      profile.categoria ?? null,
      profile.sitioWeb,
    ],
  )
  const cuentaId = cuentaRows[0]!.id

  // ── 2. Snapshot diario del perfil ─────────────────────────────────────────
  await db.query(
    `INSERT INTO ig_cuenta_snapshots
       (cuenta_id, fecha, seguidores, seguidos, posts_total)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (cuenta_id, fecha) DO UPDATE SET
       seguidores  = EXCLUDED.seguidores,
       seguidos    = EXCLUDED.seguidos,
       posts_total = EXCLUDED.posts_total`,
    [cuentaId, today, toInt(profile.followersCount), toInt(profile.followingCount), toInt(profile.postsCount)],
  )

  // ── 3. Posts ──────────────────────────────────────────────────────────────
  let postsUpserted = 0
  let comentariosUpserted = 0

  for (const post of posts) {
    const hashtags = extractHashtags(post.caption)
    const menciones = extractMentions(post.caption)

    const { rows: postRows } = await db.query<{ id: string }>(
      `INSERT INTO ig_posts
         (cuenta_id, ig_shortcode, tipo, caption, url, thumbnail_url,
          publicado_en, hashtags, menciones, ubicacion, duracion_seg,
          likes, comentarios, reproducciones, last_scraped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (cuenta_id, ig_shortcode) DO UPDATE SET
         tipo            = EXCLUDED.tipo,
         caption         = EXCLUDED.caption,
         thumbnail_url   = COALESCE(EXCLUDED.thumbnail_url, ig_posts.thumbnail_url),
         hashtags        = EXCLUDED.hashtags,
         menciones       = EXCLUDED.menciones,
         ubicacion       = COALESCE(EXCLUDED.ubicacion, ig_posts.ubicacion),
         likes           = EXCLUDED.likes,
         comentarios     = EXCLUDED.comentarios,
         reproducciones  = COALESCE(EXCLUDED.reproducciones, ig_posts.reproducciones),
         last_scraped_at = NOW()
       RETURNING id`,
      [
        cuentaId,
        post.shortCode,
        toPostTipo(post.type),
        post.caption,
        post.url,
        post.displayUrl,
        post.timestamp,
        hashtags,
        menciones,
        post.locationName,
        post.videoDuration != null ? toInt(post.videoDuration) : null,
        Math.max(0, toInt(post.likesCount)),
        Math.max(0, toInt(post.commentsCount)),
        post.videoViewCount != null ? Math.max(0, toInt(post.videoViewCount)) : null,
      ],
    )
    const postId = postRows[0]!.id
    postsUpserted++

    // ── 3a. Snapshot diario del post ────────────────────────────────────────
    await db.query(
      `INSERT INTO ig_post_snapshots
         (post_id, fecha, likes, comentarios, reproducciones)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (post_id, fecha) DO UPDATE SET
         likes          = EXCLUDED.likes,
         comentarios    = EXCLUDED.comentarios,
         reproducciones = COALESCE(EXCLUDED.reproducciones, ig_post_snapshots.reproducciones)`,
      [postId, today, Math.max(0, toInt(post.likesCount)), Math.max(0, toInt(post.commentsCount)), post.videoViewCount != null ? Math.max(0, toInt(post.videoViewCount)) : null],
    )

    // ── 3b. Comentarios ─────────────────────────────────────────────────────
    for (const c of post.latestComments ?? []) {
      await upsertComentario(db, postId, c, false)
      comentariosUpserted++
      for (const reply of c.replies ?? []) {
        await upsertComentario(db, postId, reply, true, c.id)
        comentariosUpserted++
      }
    }
  }

  return { cuentaId, postsUpserted, comentariosUpserted }
}

async function upsertComentario(
  db: PoolClient,
  postId: string,
  c: ApifyIgComment,
  esRespuesta: boolean,
  parentId?: string,
): Promise<void> {
  await db.query(
    `INSERT INTO ig_comentarios
       (post_id, ig_comment_id, autor_handle, autor_verificado,
        texto, likes, publicado_en, es_respuesta, parent_comment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (post_id, ig_comment_id) DO UPDATE SET
       likes = EXCLUDED.likes`,
    [
      postId,
      c.id,
      c.ownerUsername,
      c.ownerVerified ?? false,
      c.text,
      toInt(c.likesCount),
      c.timestamp,
      esRespuesta,
      parentId ?? null,
    ],
  )
}

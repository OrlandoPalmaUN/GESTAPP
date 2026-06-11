/**
 * Lógica de scraping de Instagram via Apify.
 * Construye los inputs del actor y normaliza el output a tipos propios.
 */

import { apifyRunSync } from './client.js'
import type { ApifyIgPost, ApifyIgProfileDetail } from './types.js'

/**
 * Parsea un conteo de Apify que puede venir como:
 *   - number: 89093          → 89093
 *   - string: "89.093"       → 89093  (punto = separador de miles en locale es)
 *   - string: "89,093"       → 89093  (coma = separador de miles en locale en)
 *   - null / undefined       → 0
 */
export function parseCount(v: number | string | null | undefined): number {
  if (v == null) return 0
  if (typeof v === 'number') return Math.round(v)
  // Quitar puntos y comas usados como separadores de miles, luego parsear
  const clean = String(v).replace(/[.,]/g, '')
  const n = parseInt(clean, 10)
  return isNaN(n) ? 0 : n
}

export interface IgProfileSnapshot {
  handle: string
  igUserId: string | null
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  verified: boolean
  categoria: string | null
  sitioWeb: string | null
  followersCount: number
  followingCount: number
  postsCount: number
  isPrivate: boolean
}

export interface IgScrapeResult {
  profile: IgProfileSnapshot | null
  posts: ApifyIgPost[]
}

/**
 * Trae el perfil + últimos N posts + M comentarios por post.
 * Ejecuta en paralelo:
 *   1) Posts (addParentData: true) — para las publicaciones y comentarios
 *   2) Details (1 item) — para followersCount fiable (addParentData no siempre lo incluye)
 */
export async function scrapeIgProfile(
  handle: string,
  token: string,
  actor: string,
  opts: { postsLimit: number; comentariosLimit: number },
): Promise<IgScrapeResult> {
  const cleanHandle = handle.replace(/^@/, '')
  const profileUrl = `https://www.instagram.com/${cleanHandle}/`

  // Ambas llamadas en paralelo — la de detalles es barata (1 item)
  const [postsRes, detailsRes] = await Promise.allSettled([
    apifyRunSync<ApifyIgPost>(
      actor,
      {
        directUrls: [profileUrl],
        resultsType: 'posts',
        resultsLimit: opts.postsLimit,
        addParentData: true,
        scrapeComments: opts.comentariosLimit > 0,
        maxComments: opts.comentariosLimit,
      },
      token,
    ),
    apifyRunSync<ApifyIgProfileDetail>(
      actor,
      {
        directUrls: [profileUrl],
        resultsType: 'details',
        resultsLimit: 1,
      },
      token,
    ),
  ])

  const posts = postsRes.status === 'fulfilled' ? postsRes.value.items : []
  const detail = detailsRes.status === 'fulfilled' ? (detailsRes.value.items[0] ?? null) : null
  const first = posts[0]

  // Mezcla: detalle (preciso) > addParentData (fallback)
  const profile: IgProfileSnapshot | null = first || detail
    ? {
        handle:         detail?.username        ?? first?.ownerUsername  ?? cleanHandle,
        igUserId:       detail?.id              ?? null,
        displayName:    detail?.fullName        ?? first?.ownerFullName  ?? null,
        bio:            detail?.biography       ?? null,
        avatarUrl:      detail?.profilePicUrl   ?? null,
        verified:       detail?.verified        ?? first?.ownerVerified  ?? false,
        categoria:      detail?.businessCategoryName ?? null,
        sitioWeb:       detail?.externalUrl     ?? null,
        followersCount: parseCount(detail?.followersCount ?? first?.ownerFollowersCount),
        followingCount: parseCount(detail?.followingCount),
        postsCount:     parseCount(detail?.postsCount),
        isPrivate:      detail?.private         ?? false,
      }
    : null

  return { profile, posts }
}

/**
 * Solo el perfil — run barato (1 item, type=details).
 * Usado en el onboarding para validar que el handle existe y es público.
 */
export async function scrapeIgProfileOnly(
  handle: string,
  token: string,
  actor: string,
): Promise<IgProfileSnapshot | null> {
  const cleanHandle = handle.replace(/^@/, '')
  const profileUrl = `https://www.instagram.com/${cleanHandle}/`

  const { items } = await apifyRunSync<ApifyIgProfileDetail>(
    actor,
    {
      directUrls: [profileUrl],
      resultsType: 'details',
      resultsLimit: 1,
    },
    token,
  )

  const p = items[0]
  if (!p) return null

  if (p.private) {
    throw new Error('PRIVATE_ACCOUNT')
  }

  return {
    handle: p.username,
    igUserId: p.id,
    displayName: p.fullName,
    bio: p.biography,
    avatarUrl: p.profilePicUrl,
    verified: p.verified ?? false,
    categoria: p.businessCategoryName,
    sitioWeb: p.externalUrl,
    followersCount: parseCount(p.followersCount),
    followingCount: parseCount(p.followingCount),
    postsCount: parseCount(p.postsCount),
    isPrivate: p.private,
  }
}

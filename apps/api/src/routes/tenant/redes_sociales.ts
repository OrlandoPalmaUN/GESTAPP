import {
  diasMejoresHorasQuerySchema,
  diasQuerySchema,
  diasSeguidoresQuerySchema,
  listarComentariosQuerySchema,
  listarPostsQuerySchema,
  listarRunsQuerySchema,
  vincularIgCuentaSchema,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { scrapeIgProfile, scrapeIgProfileOnly } from '../../lib/apify/scraper.js'
import { persistIgScrape } from '../../lib/apify/persistor.js'

/** Igual que en el resto de rutas de tenant. */
function exigirTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest(
      'Esta operación requiere una empresa (tenant) asociada a tu usuario.',
    )
    return false
  }
  return true
}

export async function redesSocialesRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }
  const { APIFY_TOKEN, APIFY_DEFAULT_ACTOR, IG_REFRESH_COOLDOWN_HOURS } = fastify.config

  // ─────────────────────────────────────────────────────────────────────────
  // CUENTA
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /redes/ig/cuenta
   * Devuelve la cuenta configurada para este tenant + datos del último snapshot.
   */
  fastify.get('/redes/ig/cuenta', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { rows } = await request.tenantDb.query(`
      SELECT
        c.id, c.handle, c.ig_user_id AS "igUserId",
        c.display_name AS "displayName", c.bio,
        c.avatar_url AS "avatarUrl",
        c.es_verificada AS "esVerificada",
        c.es_business AS "esBusiness",
        c.categoria, c.sitio_web AS "sitioWeb",
        c.last_scraped_at AS "lastScrapedAt",
        c.created_at AS "createdAt",
        s.seguidores, s.seguidos,
        s.posts_total AS "postsTotal",
        s.fecha AS "snapshotFecha"
      FROM ig_cuentas c
      LEFT JOIN ig_cuenta_snapshots s
        ON s.cuenta_id = c.id
        AND s.fecha = (
          SELECT MAX(fecha) FROM ig_cuenta_snapshots WHERE cuenta_id = c.id
        )
      ORDER BY c.created_at ASC
      LIMIT 1
    `)

    return reply.send({ cuenta: rows[0] ?? null })
  })

  /**
   * POST /redes/ig/cuenta
   * Vincula un handle de Instagram: valida que sea público, persiste y
   * dispara un primer scrape con los últimos 30 posts.
   */
  fastify.post('/redes/ig/cuenta', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const body = vincularIgCuentaSchema.safeParse(request.body)
    if (!body.success) {
      return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    }

    // Validar handle antes de persistir
    let profile
    try {
      profile = await scrapeIgProfileOnly(body.data.handle, APIFY_TOKEN, APIFY_DEFAULT_ACTOR)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'PRIVATE_ACCOUNT') {
        return reply.badRequest('La cuenta de Instagram es privada — el scraper no puede acceder a sus datos.')
      }
      return reply.internalServerError(`Error al validar el handle: ${msg}`)
    }

    if (!profile) {
      return reply.badRequest('No se encontró la cuenta. Verifica que el handle sea correcto.')
    }

    // Upsert cuenta
    const { rows } = await request.tenantDb.query<{ id: string }>(`
      INSERT INTO ig_cuentas
        (handle, ig_user_id, display_name, bio, avatar_url,
         es_verificada, categoria, sitio_web)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (handle) DO UPDATE SET
        ig_user_id    = COALESCE(EXCLUDED.ig_user_id,   ig_cuentas.ig_user_id),
        display_name  = COALESCE(EXCLUDED.display_name, ig_cuentas.display_name),
        bio           = COALESCE(EXCLUDED.bio,          ig_cuentas.bio),
        avatar_url    = COALESCE(EXCLUDED.avatar_url,   ig_cuentas.avatar_url),
        es_verificada = EXCLUDED.es_verificada,
        categoria     = COALESCE(EXCLUDED.categoria,    ig_cuentas.categoria),
        sitio_web     = COALESCE(EXCLUDED.sitio_web,    ig_cuentas.sitio_web)
      RETURNING id
    `, [
      profile.handle, profile.igUserId, profile.displayName, profile.bio,
      profile.avatarUrl, profile.verified, profile.categoria, profile.sitioWeb,
    ])

    const cuentaId = rows[0]!.id

    // Config por defecto si no existe
    await request.tenantDb.query(`
      INSERT INTO ig_config (cuenta_id) VALUES ($1)
      ON CONFLICT (cuenta_id) DO NOTHING
    `, [cuentaId])

    // Backfill inicial: últimos 30 posts (async — no bloquea la respuesta).
    // IMPORTANTE: usamos una conexión PROPIA del pool (no request.tenantDb)
    // porque la conexión del request se libera en onResponse, antes de que
    // el scrape async termine — si reutilizáramos esa conexión el search_path
    // ya habría sido reseteado y las queries irían al schema público.
    const schemaName = request.tenant!.schemaName
    const handle = profile.handle
    scrapeIgProfile(handle, APIFY_TOKEN, APIFY_DEFAULT_ACTOR, {
      postsLimit: 30,
      comentariosLimit: 50,
    })
      .then(async (result) => {
        const client = await fastify.pg.connect()
        try {
          await client.query(`SET search_path TO "${schemaName}", public`)
          await persistIgScrape(client, result)
        } finally {
          await client.query('RESET search_path')
          client.release()
        }
      })
      .catch((err) => fastify.log.error({ err, handle }, 'ig backfill error'))

    return reply.code(201).send({
      cuenta: { id: cuentaId, handle: profile.handle, displayName: profile.displayName },
      mensaje: 'Cuenta vinculada. Estamos trayendo los primeros datos, estarán listos en unos minutos.',
    })
  })

  /**
   * DELETE /redes/ig/cuenta
   * Desvincula la cuenta y borra todos sus datos del tenant.
   */
  fastify.delete('/redes/ig/cuenta', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    await request.tenantDb.query('DELETE FROM ig_cuentas')
    return reply.code(204).send()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /redes/ig/resumen?dias=30
   * KPIs del período: seguidores, Δ, engagement rate, posts, comentarios.
   */
  fastify.get('/redes/ig/resumen', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const query = diasQuerySchema.safeParse(request.query)
    if (!query.success) return reply.badRequest('Parámetro dias inválido.')
    const { dias } = query.data

    const { rows } = await request.tenantDb.query(`
      WITH cuenta AS (
        SELECT id, handle, display_name FROM ig_cuentas ORDER BY created_at LIMIT 1
      ),
      hoy AS (
        SELECT s.seguidores, s.seguidos, s.posts_total
        FROM ig_cuenta_snapshots s
        JOIN cuenta ON s.cuenta_id = cuenta.id
        ORDER BY s.fecha DESC LIMIT 1
      ),
      antes AS (
        SELECT s.seguidores
        FROM ig_cuenta_snapshots s
        JOIN cuenta ON s.cuenta_id = cuenta.id
        WHERE s.fecha <= (CURRENT_DATE - $1::int)
        ORDER BY s.fecha DESC LIMIT 1
      ),
      posts_periodo AS (
        SELECT
          COUNT(*)::int                                                          AS total_posts,
          COALESCE(
            AVG((p.likes + p.comentarios)::float
                / NULLIF(hoy.seguidores, 0) * 100), 0
          )                                                                      AS er_promedio
        FROM ig_posts p
        JOIN cuenta   ON p.cuenta_id = cuenta.id
        CROSS JOIN hoy
        WHERE p.publicado_en >= NOW() - ($1::int || ' days')::interval
      ),
      coms_periodo AS (
        SELECT COUNT(*)::int AS total
        FROM ig_comentarios c
        JOIN ig_posts p ON c.post_id = p.id
        JOIN cuenta    ON p.cuenta_id = cuenta.id
        WHERE c.publicado_en >= NOW() - ($1::int || ' days')::interval
      )
      SELECT
        cuenta.handle,
        cuenta.display_name      AS "displayName",
        hoy.seguidores,
        hoy.seguidos,
        hoy.posts_total          AS "postsTotal",
        (hoy.seguidores - COALESCE(antes.seguidores, hoy.seguidores))
                                 AS "deltaSeguidores",
        ROUND(posts_periodo.er_promedio::numeric, 2)
                                 AS "erPromedio",
        posts_periodo.total_posts AS "totalPosts",
        coms_periodo.total        AS "totalComentarios"
      FROM cuenta, hoy, posts_periodo, coms_periodo
      LEFT JOIN antes ON TRUE
    `, [dias])

    return reply.send({ resumen: rows[0] ?? null })
  })

  /**
   * GET /redes/ig/seguidores?dias=90
   * Serie temporal de seguidores para la gráfica de crecimiento.
   */
  fastify.get('/redes/ig/seguidores', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const query = diasSeguidoresQuerySchema.safeParse(request.query)
    if (!query.success) return reply.badRequest('Parámetro dias inválido.')

    const { rows } = await request.tenantDb.query(`
      SELECT
        s.fecha,
        s.seguidores,
        s.seguidos,
        s.posts_total AS "postsTotal",
        s.alcance,
        s.impresiones,
        s.profile_views AS "profileViews"
      FROM ig_cuenta_snapshots s
      JOIN ig_cuentas c ON s.cuenta_id = c.id
      WHERE s.fecha >= CURRENT_DATE - $1::int
      ORDER BY s.fecha ASC
    `, [query.data.dias])

    return reply.send({ serie: rows })
  })

  /**
   * GET /redes/ig/posts?limit=30&order=engagement|fecha
   * Lista de posts ordenados por engagement o fecha.
   */
  fastify.get('/redes/ig/posts', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const query = listarPostsQuerySchema.safeParse(request.query)
    if (!query.success) return reply.badRequest('Parámetros inválidos.')

    const order = query.data.order === 'engagement'
      ? '(p.likes + p.comentarios) DESC'
      : 'p.publicado_en DESC'

    const { rows } = await request.tenantDb.query(`
      SELECT
        p.id,
        p.ig_shortcode    AS "igShortcode",
        p.tipo,
        p.caption,
        p.url,
        p.thumbnail_url   AS "thumbnailUrl",
        p.publicado_en    AS "publicadoEn",
        p.likes,
        p.comentarios,
        p.reproducciones,
        p.hashtags,
        p.last_scraped_at AS "lastScrapedAt"
      FROM ig_posts p
      JOIN ig_cuentas c ON p.cuenta_id = c.id
      ORDER BY ${order}
      LIMIT $1
    `, [query.data.limit])

    return reply.send({ posts: rows })
  })

  /**
   * GET /redes/ig/posts/:id
   * Detalle de un post + serie histórica de likes/comentarios.
   */
  fastify.get<{ Params: { id: string } }>('/redes/ig/posts/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const [postRes, serieRes] = await Promise.all([
      request.tenantDb.query(`
        SELECT
          p.id,
          p.ig_shortcode    AS "igShortcode",
          p.tipo,
          p.caption,
          p.url,
          p.thumbnail_url   AS "thumbnailUrl",
          p.publicado_en    AS "publicadoEn",
          p.likes,
          p.comentarios,
          p.reproducciones,
          p.hashtags,
          p.menciones,
          p.ubicacion,
          p.duracion_seg    AS "duracionSeg",
          p.guardados,
          p.alcance,
          p.impresiones,
          p.last_scraped_at AS "lastScrapedAt"
        FROM ig_posts p
        JOIN ig_cuentas c ON p.cuenta_id = c.id
        WHERE p.id = $1
      `, [request.params.id]),
      request.tenantDb.query(`
        SELECT
          fecha,
          likes,
          comentarios,
          reproducciones
        FROM ig_post_snapshots
        WHERE post_id = $1
        ORDER BY fecha ASC
      `, [request.params.id]),
    ])

    if (!postRes.rows[0]) return reply.notFound('Post no encontrado.')

    return reply.send({ post: postRes.rows[0], serie: serieRes.rows })
  })

  /**
   * GET /redes/ig/posts/:id/comentarios?page=1&filter=todos|sin-responder|preguntas
   * Comentarios paginados de un post (50 por página, sin respuestas anidadas).
   */
  fastify.get<{ Params: { id: string } }>(
    '/redes/ig/posts/:id/comentarios',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const query = listarComentariosQuerySchema.safeParse(request.query)
      if (!query.success) return reply.badRequest('Parámetros inválidos.')

      const { page, filter } = query.data
      const offset = (page - 1) * 50

      const filterClause =
        filter === 'sin-responder' ? 'AND c.respondido = FALSE'
        : filter === 'preguntas'  ? 'AND c.es_pregunta = TRUE'
        : ''

      const { rows } = await request.tenantDb.query(`
        SELECT
          c.id,
          c.post_id            AS "postId",
          c.ig_comment_id      AS "igCommentId",
          c.autor_handle       AS "autorHandle",
          c.autor_verificado   AS "autorVerificado",
          c.texto,
          c.likes,
          c.publicado_en       AS "publicadoEn",
          c.es_respuesta       AS "esRespuesta",
          c.respondido,
          c.sentimiento,
          c.es_pregunta        AS "esPregunta"
        FROM ig_comentarios c
        WHERE c.post_id = $1
          AND c.es_respuesta = FALSE
          ${filterClause}
        ORDER BY c.publicado_en DESC
        LIMIT 50 OFFSET $2
      `, [request.params.id, offset])

      return reply.send({ comentarios: rows, page, porPagina: 50 })
    },
  )

  /**
   * GET /redes/ig/hashtags?dias=30
   * Top 20 hashtags por engagement promedio del post donde se usaron.
   */
  fastify.get('/redes/ig/hashtags', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const query = diasQuerySchema.safeParse(request.query)
    if (!query.success) return reply.badRequest('Parámetro dias inválido.')

    const { rows } = await request.tenantDb.query(`
      SELECT
        ht                                              AS hashtag,
        COUNT(*)::int                                   AS frecuencia,
        ROUND(AVG(p.likes + p.comentarios)::numeric, 1) AS "engagementPromedio"
      FROM ig_posts p
      JOIN ig_cuentas c ON p.cuenta_id = c.id
      CROSS JOIN UNNEST(p.hashtags) AS ht
      WHERE p.publicado_en >= NOW() - ($1::int || ' days')::interval
      GROUP BY ht
      ORDER BY "engagementPromedio" DESC
      LIMIT 20
    `, [query.data.dias])

    return reply.send({ hashtags: rows })
  })

  /**
   * GET /redes/ig/mejores-horas?dias=90
   * Heatmap día×hora con engagement promedio — para saber cuándo publicar.
   */
  fastify.get('/redes/ig/mejores-horas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const query = diasMejoresHorasQuerySchema.safeParse(request.query)
    if (!query.success) return reply.badRequest('Parámetro dias inválido.')

    const { rows } = await request.tenantDb.query(`
      SELECT
        EXTRACT(DOW  FROM p.publicado_en)::int          AS "diaSemana",
        EXTRACT(HOUR FROM p.publicado_en)::int          AS hora,
        COUNT(*)::int                                   AS posts,
        ROUND(AVG(p.likes + p.comentarios)::numeric, 1) AS "engagementPromedio"
      FROM ig_posts p
      JOIN ig_cuentas c ON p.cuenta_id = c.id
      WHERE p.publicado_en >= NOW() - ($1::int || ' days')::interval
      GROUP BY "diaSemana", hora
      ORDER BY "diaSemana", hora
    `, [query.data.dias])

    const tienePocosDatos = rows.length < 10
    return reply.send({
      heatmap: rows,
      disclaimer: tienePocosDatos
        ? 'Se necesitan al menos 30 posts para que este análisis sea confiable.'
        : null,
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // REFRESH MANUAL
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /redes/ig/refresh
   * Dispara un scrape manual. Rate-limited: 1 vez cada N horas por tenant.
   */
  fastify.post('/redes/ig/refresh', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { rows: configRows } = await request.tenantDb.query<{
      handle: string
      posts_por_run: number
      comentarios_por_post: number
      ultimo_refresh_manual: Date | null
    }>(`
      SELECT
        c.handle,
        cfg.posts_por_run,
        cfg.comentarios_por_post,
        cfg.ultimo_refresh_manual
      FROM ig_config cfg
      JOIN ig_cuentas c ON cfg.cuenta_id = c.id
      LIMIT 1
    `)

    if (!configRows[0]) {
      return reply.badRequest('No hay cuenta de Instagram configurada. Vincula un handle primero.')
    }

    const cfg = configRows[0]

    // Cooldown
    if (cfg.ultimo_refresh_manual) {
      const diffHoras = (Date.now() - cfg.ultimo_refresh_manual.getTime()) / 3_600_000
      if (diffHoras < IG_REFRESH_COOLDOWN_HOURS) {
        const retryAfterSeg = Math.ceil((IG_REFRESH_COOLDOWN_HOURS - diffHoras) * 3600)
        reply.header('Retry-After', String(retryAfterSeg))
        return reply.code(429).send({
          error: `Próximo refresh disponible en ${Math.ceil(IG_REFRESH_COOLDOWN_HOURS - diffHoras)}h.`,
          retryAfterSeg,
        })
      }
    }

    // Marcar cooldown antes del scrape para evitar doble-click
    await request.tenantDb.query(`
      UPDATE ig_config SET ultimo_refresh_manual = NOW()
      WHERE cuenta_id = (SELECT id FROM ig_cuentas LIMIT 1)
    `)

    // Scrape
    let postsActualizados = 0
    let comentariosActualizados = 0
    try {
      const result = await scrapeIgProfile(cfg.handle, APIFY_TOKEN, APIFY_DEFAULT_ACTOR, {
        postsLimit: cfg.posts_por_run,
        comentariosLimit: cfg.comentarios_por_post,
      })
      const stats = await persistIgScrape(request.tenantDb, result)
      postsActualizados = stats.postsUpserted
      comentariosActualizados = stats.comentariosUpserted
    } catch (err) {
      // Revertir cooldown si el scrape falló para no bloquear al usuario
      await request.tenantDb.query(`
        UPDATE ig_config SET ultimo_refresh_manual = NULL
        WHERE cuenta_id = (SELECT id FROM ig_cuentas LIMIT 1)
      `)
      const msg = err instanceof Error ? err.message : String(err)
      return reply.internalServerError(`El scrape falló: ${msg}`)
    }

    return reply.send({ ok: true, postsActualizados, comentariosActualizados })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // LOG DE RUNS (debug / superadmin)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /redes/ig/runs?limit=20
   * Historial de runs de Apify para este tenant.
   */
  fastify.get('/redes/ig/runs', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const query = listarRunsQuerySchema.safeParse(request.query)
    if (!query.success) return reply.badRequest('Parámetros inválidos.')

    const runs = await fastify.prisma.apifyScrapeRun.findMany({
      where: { tenantId: request.tenant!.id },
      orderBy: { startedAt: 'desc' },
      take: query.data.limit,
    })

    return reply.send({ runs })
  })
}

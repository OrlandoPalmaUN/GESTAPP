/**
 * Historial de auditoría ("footsteps") — lee lo que escribe el trigger
 * `public.fn_auditoria()` (ver packages/db/tenant-migrations/019_auditoria.sql).
 * No hay lógica de negocio aquí: cada crear/editar/eliminar/restaurar en las
 * tablas auditadas ya quedó registrado solo, este módulo solo lo expone.
 *
 * GET /auditoria                                  ← timeline general, paginado y filtrable
 * GET /auditoria/usuarios                          ← usuarios distintos que aparecen en el timeline (para el filtro)
 * GET /auditoria/:entidadTipo/:entidadId           ← historial de un objeto puntual (embebido en su detalle)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

function exigirTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest('Esta operación requiere una empresa asociada.')
    return false
  }
  return true
}

type FilaAuditoria = {
  id: string
  usuario_id: string | null
  usuario_nombre: string | null
  accion: string
  entidad_tipo: string
  entidad_id: string
  etiqueta: string | null
  cambios: Record<string, { antes: unknown; despues: unknown }>
  created_at: string
}

function aCable(row: FilaAuditoria) {
  return {
    id: row.id,
    usuarioId: row.usuario_id,
    usuarioNombre: row.usuario_nombre,
    accion: row.accion,
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    etiqueta: row.etiqueta,
    cambios: row.cambios,
    creadoEn: row.created_at,
  }
}

export async function auditoriaRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /auditoria?entidadTipo=&usuarioId=&accion=&desde=&hasta=&page=&pageSize=
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/auditoria', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '30', 10) || 30))
    const offset = (page - 1) * pageSize

    const condiciones: string[] = []
    const params: unknown[] = []

    if (q.entidadTipo) { params.push(q.entidadTipo); condiciones.push(`entidad_tipo = $${params.length}`) }
    if (q.usuarioId) { params.push(q.usuarioId); condiciones.push(`usuario_id = $${params.length}`) }
    if (q.accion) { params.push(q.accion); condiciones.push(`accion = $${params.length}`) }
    if (q.desde) { params.push(q.desde); condiciones.push(`created_at >= $${params.length}`) }
    if (q.hasta) { params.push(q.hasta); condiciones.push(`created_at < $${params.length}`) }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : ''

    const db = request.tenantDb
    const [{ rows }, { rows: countRows }] = await Promise.all([
      db.query<FilaAuditoria>(
        `SELECT id, usuario_id, usuario_nombre, accion, entidad_tipo, entidad_id, etiqueta, cambios, created_at
         FROM auditoria ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset],
      ),
      db.query<{ total: string }>(`SELECT COUNT(*) AS total FROM auditoria ${where}`, params),
    ])

    return reply.send({
      entradas: rows.map(aCable),
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /auditoria/usuarios — usuarios distintos que aparecen en el timeline,
  // para poblar el filtro sin depender del endpoint admin de usuarios.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/auditoria/usuarios', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { rows } = await request.tenantDb.query<{ usuario_id: string; usuario_nombre: string | null }>(
      `SELECT DISTINCT usuario_id, usuario_nombre FROM auditoria
       WHERE usuario_id IS NOT NULL
       ORDER BY usuario_nombre`,
    )
    return reply.send({
      usuarios: rows.map((r) => ({ usuarioId: r.usuario_id, usuarioNombre: r.usuario_nombre })),
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /auditoria/:entidadTipo/:entidadId — historial de UN objeto puntual
  // (para el mini-historial embebido en el detalle de un pedido/producto/etc.)
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { entidadTipo: string; entidadId: string } }>(
    '/auditoria/:entidadTipo/:entidadId',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const { entidadTipo, entidadId } = request.params
      const { rows } = await request.tenantDb.query<FilaAuditoria>(
        `SELECT id, usuario_id, usuario_nombre, accion, entidad_tipo, entidad_id, etiqueta, cambios, created_at
         FROM auditoria
         WHERE entidad_tipo = $1 AND entidad_id = $2
         ORDER BY created_at DESC`,
        [entidadTipo, entidadId],
      )
      return reply.send({ entradas: rows.map(aCable) })
    },
  )
}

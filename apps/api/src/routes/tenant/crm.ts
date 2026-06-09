import { crearNotaCrmSchema, entidadCrmSchema, type EntidadCrm, type NotaCrm } from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

interface FilaNotaCrm {
  id: string
  entidad_tipo: string
  entidad_id: string
  nota: string
  usuario_id: string | null
  created_at: Date
}

function aNotaCrm(row: FilaNotaCrm): NotaCrm {
  return {
    id: row.id,
    entidadTipo: row.entidad_tipo as EntidadCrm,
    entidadId: row.entidad_id,
    nota: row.nota,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

/** Igual que en `clientes.ts`/`inventario.ts` — sin tenant resuelto no hay schema contra el cual operar (caso superadmin). */
function exigirTenant(request: FastifyRequest, reply: FastifyReply): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest(
      'Esta operación requiere una empresa (tenant) asociada a tu usuario — el superadmin no opera sobre datos de negocio.',
    )
    return false
  }
  return true
}

/**
 * Valida que la entidad referenciada (cliente o proveedor) exista en el
 * tenant — `entidad_id` es una FK polimórfica (no hay constraint en BD, ver
 * migración 003), así que la validación de existencia vive aquí.
 */
async function existeEntidad(
  tenantDb: FastifyRequest['tenantDb'] & {},
  tipo: EntidadCrm,
  id: string,
): Promise<boolean> {
  const tabla = tipo === 'cliente' ? 'clientes' : 'proveedores'
  const { rowCount } = await tenantDb.query(`SELECT 1 FROM ${tabla} WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

/**
 * Rutas de CRM — bitácora de interacciones (notas) sobre clientes y
 * proveedores. Antes vivía como estado local del frontend (`crmTimeline`);
 * ahora persiste por tenant (tabla `notas_crm`, migración 003).
 */
export async function crmRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /crm/notas?entidadTipo=cliente|proveedor&entidadId=<uuid>
  fastify.get<{ Querystring: { entidadTipo?: string; entidadId?: string } }>(
    '/crm/notas',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const tipoParsed = entidadCrmSchema.safeParse(request.query.entidadTipo)
      if (!tipoParsed.success) {
        return reply.badRequest('El parámetro "entidadTipo" debe ser "cliente" o "proveedor".')
      }
      const idParsed = z.uuid().safeParse(request.query.entidadId)
      if (!idParsed.success) {
        return reply.badRequest('El parámetro "entidadId" debe ser un UUID válido.')
      }

      const { rows } = await request.tenantDb.query<FilaNotaCrm>(
        `SELECT id, entidad_tipo, entidad_id, nota, usuario_id, created_at
         FROM notas_crm WHERE entidad_tipo = $1 AND entidad_id = $2
         ORDER BY created_at DESC`,
        [tipoParsed.data, idParsed.data],
      )
      return reply.send({ notas: rows.map(aNotaCrm) })
    },
  )

  // POST /crm/notas
  fastify.post('/crm/notas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearNotaCrmSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const existe = await existeEntidad(request.tenantDb, body.data.entidadTipo, body.data.entidadId)
    if (!existe) {
      return reply.badRequest(
        `No existe ${body.data.entidadTipo === 'cliente' ? 'el cliente' : 'el proveedor'} indicado.`,
      )
    }

    const { rows } = await request.tenantDb.query<FilaNotaCrm>(
      `INSERT INTO notas_crm (entidad_tipo, entidad_id, nota, usuario_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, entidad_tipo, entidad_id, nota, usuario_id, created_at`,
      [body.data.entidadTipo, body.data.entidadId, body.data.nota, request.user.sub],
    )
    return reply.status(201).send({ nota: aNotaCrm(rows[0]!) })
  })
}

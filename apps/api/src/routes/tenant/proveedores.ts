import { actualizarProveedorSchema, crearProveedorSchema, type Proveedor } from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface FilaProveedor {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  contacto: string | null
  activo: boolean
  created_at: Date
}

function aProveedor(row: FilaProveedor): Proveedor {
  return {
    id: row.id,
    nombre: row.nombre,
    nit: row.nit,
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
    contacto: row.contacto,
    activo: row.activo,
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
 * Rutas de Proveedores — catálogo simple del tenant, espejo de Clientes,
 * usado por el módulo CRM. Mismo patrón: SQL parametrizado sobre `request.tenantDb`.
 */
export async function proveedoresRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /proveedores — solo activos (no borrados); lo borrado vive en /papelera.
  fastify.get('/proveedores', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaProveedor>(
      'SELECT id, nombre, nit, email, telefono, direccion, contacto, activo, created_at FROM proveedores WHERE deleted_at IS NULL ORDER BY nombre ASC',
    )
    return reply.send({ proveedores: rows.map(aProveedor) })
  })

  // POST /proveedores
  fastify.post('/proveedores', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearProveedorSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    try {
      const { rows } = await request.tenantDb.query<FilaProveedor>(
        `INSERT INTO proveedores (nombre, nit, email, telefono, direccion, contacto)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, nombre, nit, email, telefono, direccion, contacto, activo, created_at`,
        [
          body.data.nombre,
          body.data.nit ?? null,
          body.data.email ?? null,
          body.data.telefono ?? null,
          body.data.direccion ?? null,
          body.data.contacto ?? null,
        ],
      )
      return reply.status(201).send({ proveedor: aProveedor(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe un proveedor con el NIT "${body.data.nit}".`)
      }
      throw error
    }
  })

  // PATCH /proveedores/:id
  fastify.patch<{ Params: { id: string } }>('/proveedores/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarProveedorSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      nombre: body.data.nombre,
      nit: body.data.nit,
      email: body.data.email,
      telefono: body.data.telefono,
      direccion: body.data.direccion,
      contacto: body.data.contacto,
      activo: body.data.activo,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
    const valores = entradas.map(([, v]) => v)

    try {
      const { rows, rowCount } = await request.tenantDb.query<FilaProveedor>(
        `UPDATE proveedores SET ${sets} WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, nombre, nit, email, telefono, direccion, contacto, activo, created_at`,
        [request.params.id, ...valores],
      )
      if (rowCount === 0) return reply.notFound('Proveedor no encontrado.')
      return reply.send({ proveedor: aProveedor(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe un proveedor con el NIT "${String(body.data.nit)}".`)
      }
      throw error
    }
  })

  // DELETE /proveedores/:id — borrado suave: queda en /papelera y se puede deshacer.
  fastify.delete<{ Params: { id: string } }>('/proveedores/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rowCount } = await request.tenantDb.query(
      'UPDATE proveedores SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (rowCount === 0) return reply.notFound('Proveedor no encontrado.')
    return reply.status(204).send()
  })
}

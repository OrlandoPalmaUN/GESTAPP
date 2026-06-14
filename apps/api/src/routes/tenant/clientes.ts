import { actualizarClienteSchema, crearClienteSchema, type Cliente } from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface FilaCliente {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  activo: boolean
  created_at: Date
}

function aCliente(row: FilaCliente): Cliente {
  return {
    id: row.id,
    nombre: row.nombre,
    nit: row.nit,
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
    ciudad: row.ciudad,
    activo: row.activo,
    createdAt: row.created_at.toISOString(),
  }
}

/** Igual que en `inventario.ts` — sin tenant resuelto no hay schema contra el cual operar (caso superadmin). */
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
 * Rutas de Clientes — catálogo simple del tenant, usado por Pedidos y CRM.
 * Mismo patrón que Inventario: SQL parametrizado sobre `request.tenantDb`.
 */
export async function clientesRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /clientes — solo activos (no borrados); lo borrado vive en /papelera.
  fastify.get('/clientes', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaCliente>(
      'SELECT id, nombre, nit, email, telefono, direccion, ciudad, activo, created_at FROM clientes WHERE deleted_at IS NULL ORDER BY nombre ASC',
    )
    return reply.send({ clientes: rows.map(aCliente) })
  })

  // POST /clientes
  fastify.post('/clientes', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearClienteSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    try {
      const { rows } = await request.tenantDb.query<FilaCliente>(
        `INSERT INTO clientes (nombre, nit, email, telefono, direccion, ciudad)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, nombre, nit, email, telefono, direccion, ciudad, activo, created_at`,
        [
          body.data.nombre,
          body.data.nit ?? null,
          body.data.email ?? null,
          body.data.telefono ?? null,
          body.data.direccion ?? null,
          body.data.ciudad ?? null,
        ],
      )
      return reply.status(201).send({ cliente: aCliente(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe un cliente con el NIT "${body.data.nit}".`)
      }
      throw error
    }
  })

  // PATCH /clientes/:id — edición parcial, mismo modal/patrón que crear.
  fastify.patch<{ Params: { id: string } }>('/clientes/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarClienteSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      nombre: body.data.nombre,
      nit: body.data.nit,
      email: body.data.email,
      telefono: body.data.telefono,
      direccion: body.data.direccion,
      ciudad: body.data.ciudad,
      activo: body.data.activo,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
    const valores = entradas.map(([, v]) => v)

    try {
      const { rows, rowCount } = await request.tenantDb.query<FilaCliente>(
        `UPDATE clientes SET ${sets} WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, nombre, nit, email, telefono, direccion, ciudad, activo, created_at`,
        [request.params.id, ...valores],
      )
      if (rowCount === 0) return reply.notFound('Cliente no encontrado.')
      return reply.send({ cliente: aCliente(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe un cliente con el NIT "${String(body.data.nit)}".`)
      }
      throw error
    }
  })

  // DELETE /clientes/:id — borrado suave: queda en /papelera y se puede deshacer.
  // Bloqueamos cuando el cliente tiene pedidos vivos o facturas con saldo pendiente:
  // eliminarlo dejaría referencias huérfanas que distorsionan reportes y
  // saldos. El usuario puede pasar ?force=true para borrar de todas formas
  // (todo se restaura junto desde papelera con el handler de pedidos).
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/clientes/:id',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const force = request.query.force === 'true'

      if (!force) {
        const { rows } = await request.tenantDb.query<{
          pedidos_activos: number
          facturas_abiertas: number
          saldo_pendiente: string
        }>(
          `SELECT
             (SELECT COUNT(*) FROM pedidos
              WHERE cliente_id = $1 AND deleted_at IS NULL
                AND estado IN ('borrador','confirmado','en_preparacion','despachado'))::int AS pedidos_activos,
             (SELECT COUNT(*) FROM facturas_venta fv
              WHERE fv.cliente_id = $1 AND fv.deleted_at IS NULL
                AND fv.total > COALESCE((
                  SELECT SUM(monto) FROM abonos
                  WHERE tipo_documento = 'factura_venta'
                    AND documento_id = fv.id AND deleted_at IS NULL
                ), 0))::int AS facturas_abiertas,
             COALESCE((
               SELECT SUM(fv.total) - COALESCE(SUM(ab.monto), 0)
               FROM facturas_venta fv
               LEFT JOIN abonos ab ON ab.tipo_documento = 'factura_venta'
                 AND ab.documento_id = fv.id AND ab.deleted_at IS NULL
               WHERE fv.cliente_id = $1 AND fv.deleted_at IS NULL
             ), 0)::text AS saldo_pendiente`,
          [request.params.id],
        )
        const dep = rows[0]!
        if (dep.pedidos_activos > 0 || dep.facturas_abiertas > 0) {
          return reply.code(409).send({
            error: 'No se puede eliminar el cliente: tiene dependencias activas.',
            dependencias: {
              pedidosActivos: dep.pedidos_activos,
              facturasAbiertas: dep.facturas_abiertas,
              saldoPendiente: Number(dep.saldo_pendiente),
            },
            sugerencia: 'Cancela los pedidos y salda las facturas primero. O agrega ?force=true para borrar de todas formas.',
          })
        }
      }

      const { rowCount } = await request.tenantDb.query(
        'UPDATE clientes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [request.params.id],
      )
      if (rowCount === 0) return reply.notFound('Cliente no encontrado.')
      return reply.status(204).send()
    },
  )

  // GET /clientes/:id/pedidos — historial de pedidos del cliente.
  // Habilita la navegación "click en cliente → ver sus pedidos" desde la UI
  // y reemplaza el filtrado en el cliente con una query indexada.
  fastify.get<{ Params: { id: string } }>('/clientes/:id/pedidos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query(
      `SELECT id, numero, estado, total, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM pedidos
       WHERE cliente_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [request.params.id],
    )
    return reply.send({ pedidos: rows })
  })

  // GET /clientes/:id/facturas — facturas del cliente con saldo y estado.
  fastify.get<{ Params: { id: string } }>('/clientes/:id/facturas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query(
      `SELECT
         fv.id, fv.numero, fv.total::numeric AS total,
         fv.fecha_vencimiento AS "fechaVencimiento",
         (fv.total - COALESCE((
           SELECT SUM(monto) FROM abonos
           WHERE tipo_documento = 'factura_venta'
             AND documento_id = fv.id AND deleted_at IS NULL
         ), 0))::numeric AS saldo,
         fv.created_at AS "createdAt"
       FROM facturas_venta fv
       WHERE fv.cliente_id = $1 AND fv.deleted_at IS NULL
       ORDER BY fv.created_at DESC`,
      [request.params.id],
    )
    return reply.send({ facturas: rows })
  })
}

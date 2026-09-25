import {
  actualizarCampanaSchema,
  crearCampanaSchema,
  type Campana,
  type ConsolidadoCampana,
  type LineaConsolidado,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface FilaCampana {
  id: string
  nombre: string
  fecha_entrega: Date
  estado: string
  notas: string | null
  usuario_id: string | null
  created_at: Date
  pedidos?: number
}

function aCampana(row: FilaCampana): Campana {
  return {
    id: row.id,
    nombre: row.nombre,
    fechaEntrega: row.fecha_entrega.toISOString().slice(0, 10),
    estado: row.estado as Campana['estado'],
    notas: row.notas,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
    pedidos: Number(row.pedidos ?? 0),
  }
}

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
 * Campañas de preventa (migración 031).
 *
 * Agrupan pedidos normales de una entrega puntual — "los pasteles del domingo
 * 12". No son un tipo de venta distinto: el valor está en el consolidado, que
 * contesta de una la pregunta que hoy se resuelve sumando a mano pedido por
 * pedido ("¿cuántos de cada sabor le pido a la cocinera?").
 */
export async function campanasRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /campanas — con la cuenta de pedidos de cada una.
  fastify.get('/campanas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaCampana>(
      `SELECT c.id, c.nombre, c.fecha_entrega, c.estado, c.notas, c.usuario_id, c.created_at,
              (SELECT COUNT(*) FROM pedidos p
               WHERE p.campana_id = c.id AND p.deleted_at IS NULL AND p.estado <> 'cancelado')::int AS pedidos
       FROM campanas c
       WHERE c.deleted_at IS NULL
       ORDER BY c.fecha_entrega DESC, c.created_at DESC`,
    )
    return reply.send({ campanas: rows.map(aCampana) })
  })

  // GET /campanas/:id/consolidado — el número que se le pasa a quien cocina,
  // más el estado de cobro y a quién falta cobrarle.
  fastify.get<{ Params: { id: string } }>('/campanas/:id/consolidado', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const db = request.tenantDb

    const { rows: cab } = await db.query<FilaCampana>(
      `SELECT c.id, c.nombre, c.fecha_entrega, c.estado, c.notas, c.usuario_id, c.created_at,
              (SELECT COUNT(*) FROM pedidos p
               WHERE p.campana_id = c.id AND p.deleted_at IS NULL AND p.estado <> 'cancelado')::int AS pedidos
       FROM campanas c WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [request.params.id],
    )
    if (cab.length === 0) return reply.notFound('Campaña no encontrada.')

    // Los pedidos cancelados NO cuentan: pedirle a la cocinera un pastel que se
    // canceló es exactamente el error que esta pantalla existe para evitar.
    const { rows: lineas } = await db.query<{
      producto_id: string
      producto_nombre: string
      variante_id: string | null
      variante_valores: Record<string, string> | null
      cantidad: string
      total: string
    }>(
      `SELECT pi.producto_id, pr.nombre AS producto_nombre, pi.variante_id,
              v.valores AS variante_valores,
              SUM(pi.cantidad)::text AS cantidad,
              SUM(pi.subtotal)::text AS total
       FROM pedido_items pi
       JOIN pedidos p   ON p.id = pi.pedido_id
       JOIN productos pr ON pr.id = pi.producto_id
       LEFT JOIN variantes_producto v ON v.id = pi.variante_id
       WHERE p.campana_id = $1 AND p.deleted_at IS NULL AND p.estado <> 'cancelado'
         AND pi.producto_id IS NOT NULL
       GROUP BY pi.producto_id, pr.nombre, pi.variante_id, v.valores
       ORDER BY pr.nombre, v.valores`,
      [request.params.id],
    )

    // Cobro: total facturado vs. abonado, por las CxC de los pedidos de la campaña.
    const { rows: cobro } = await db.query<{ total: string; cobrado: string }>(
      `SELECT COALESCE(SUM(fv.total), 0)::text AS total,
              COALESCE(SUM((
                SELECT COALESCE(SUM(a.monto), 0) FROM abonos a
                WHERE a.tipo_documento = 'factura_venta' AND a.documento_id = fv.id AND a.deleted_at IS NULL
              )), 0)::text AS cobrado
       FROM facturas_venta fv
       JOIN pedidos p ON p.id = fv.pedido_id
       WHERE p.campana_id = $1 AND p.deleted_at IS NULL AND p.estado <> 'cancelado'
         AND fv.deleted_at IS NULL`,
      [request.params.id],
    )

    const { rows: pendientes } = await db.query<{
      cliente_id: string | null
      nombre: string | null
      apartamento: string | null
      pendiente: string
    }>(
      `SELECT cl.id AS cliente_id, cl.nombre, cl.apartamento,
              SUM(fv.total - COALESCE((
                SELECT COALESCE(SUM(a.monto), 0) FROM abonos a
                WHERE a.tipo_documento = 'factura_venta' AND a.documento_id = fv.id AND a.deleted_at IS NULL
              ), 0))::text AS pendiente
       FROM facturas_venta fv
       JOIN pedidos p ON p.id = fv.pedido_id
       LEFT JOIN clientes cl ON cl.id = fv.cliente_id
       WHERE p.campana_id = $1 AND p.deleted_at IS NULL AND p.estado <> 'cancelado'
         AND fv.deleted_at IS NULL
       GROUP BY cl.id, cl.nombre, cl.apartamento
       HAVING SUM(fv.total - COALESCE((
                SELECT COALESCE(SUM(a.monto), 0) FROM abonos a
                WHERE a.tipo_documento = 'factura_venta' AND a.documento_id = fv.id AND a.deleted_at IS NULL
              ), 0)) > 0
       ORDER BY cl.apartamento NULLS LAST, cl.nombre`,
      [request.params.id],
    )

    const totalAVender = Number(cobro[0]?.total ?? 0)
    const totalCobrado = Number(cobro[0]?.cobrado ?? 0)

    const consolidado: ConsolidadoCampana = {
      campana: aCampana(cab[0]!),
      lineas: lineas.map(
        (l): LineaConsolidado => ({
          productoId: l.producto_id,
          productoNombre: l.producto_nombre,
          varianteId: l.variante_id,
          // `valores` es JSONB {"Sabor":"Pollo"} — se aplana a "Sabor: Pollo"
          // para que el front no tenga que saber la forma del atributo.
          varianteEtiqueta: l.variante_valores
            ? Object.entries(l.variante_valores)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')
            : null,
          cantidad: Number(l.cantidad),
          total: Number(l.total),
        }),
      ),
      totalAVender,
      totalCobrado,
      totalPendiente: totalAVender - totalCobrado,
      clientesPendientes: pendientes.map((p) => ({
        clienteId: p.cliente_id,
        nombre: p.nombre ?? 'Sin cliente',
        apartamento: p.apartamento,
        pendiente: Number(p.pendiente),
      })),
    }
    return reply.send(consolidado)
  })

  // POST /campanas
  fastify.post('/campanas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearCampanaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const { rows } = await request.tenantDb.query<FilaCampana>(
      `INSERT INTO campanas (nombre, fecha_entrega, notas, usuario_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, fecha_entrega, estado, notas, usuario_id, created_at`,
      [body.data.nombre, body.data.fechaEntrega, body.data.notas ?? null, request.user.sub],
    )
    return reply.status(201).send({ campana: aCampana(rows[0]!) })
  })

  // PATCH /campanas/:id — renombrar, mover la fecha o cambiar el estado.
  fastify.patch<{ Params: { id: string } }>('/campanas/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarCampanaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      nombre: body.data.nombre,
      fecha_entrega: body.data.fechaEntrega,
      estado: body.data.estado,
      notas: body.data.notas,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')

    const { rows, rowCount } = await request.tenantDb.query<FilaCampana>(
      `UPDATE campanas SET ${sets} WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, nombre, fecha_entrega, estado, notas, usuario_id, created_at`,
      [request.params.id, ...entradas.map(([, v]) => v)],
    )
    if (rowCount === 0) return reply.notFound('Campaña no encontrada.')
    return reply.send({ campana: aCampana(rows[0]!) })
  })

  // DELETE /campanas/:id — borrado suave. Los pedidos NO se borran: quedan como
  // pedidos normales sin campaña, porque son ventas reales que ya ocurrieron.
  fastify.delete<{ Params: { id: string } }>('/campanas/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const client = request.tenantDb
    try {
      await client.query('BEGIN')
      const { rowCount } = await client.query(
        'UPDATE campanas SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [request.params.id],
      )
      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Campaña no encontrada.')
      }
      await client.query('UPDATE pedidos SET campana_id = NULL WHERE campana_id = $1', [request.params.id])
      await client.query('COMMIT')
      return reply.status(204).send()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

import {
  actualizarPedidoProveedorSchema,
  crearPedidoProveedorSchema,
  TRANSICIONES_VALIDAS_PROVEEDOR,
  transicionarPedidoProveedorSchema,
  type EstadoPedidoProveedor,
  type PedidoProveedor,
  type PedidoProveedorItem,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

interface FilaPedidoProveedor {
  id: string
  numero: string
  proveedor_id: string | null
  estado: string
  fecha_esperada: Date | null
  notas: string | null
  total: string
  factura_compra_id: string | null
  usuario_id: string | null
  created_at: Date
  updated_at: Date
}

interface FilaPedidoProveedorItem {
  id: string
  pedido_proveedor_id: string
  producto_id: string | null
  concepto: string | null
  cantidad: string
  precio_unitario: string
  subtotal: string
}

function aItem(row: FilaPedidoProveedorItem): PedidoProveedorItem {
  return {
    id: row.id,
    pedidoProveedorId: row.pedido_proveedor_id,
    productoId: row.producto_id,
    concepto: row.concepto,
    cantidad: Number(row.cantidad),
    precioUnitario: Number(row.precio_unitario),
    subtotal: Number(row.subtotal),
  }
}

function aPedido(row: FilaPedidoProveedor, items: PedidoProveedorItem[]): PedidoProveedor {
  return {
    id: row.id,
    numero: row.numero,
    proveedorId: row.proveedor_id,
    estado: row.estado as EstadoPedidoProveedor,
    fechaEsperada: row.fecha_esperada ? row.fecha_esperada.toISOString().slice(0, 10) : null,
    notas: row.notas,
    total: Number(row.total),
    facturaCompraId: row.factura_compra_id,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    items,
  }
}

function exigirTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest(
      'Esta operación requiere una empresa asociada a tu usuario — el superadmin no opera sobre datos de negocio.',
    )
    return false
  }
  return true
}

async function generarNumeroOC(tenantDb: NonNullable<FastifyRequest['tenantDb']>): Promise<string> {
  const anio = new Date().getFullYear()
  const { rows } = await tenantDb.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM pedidos_proveedor WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [anio],
  )
  const n = Number(rows[0]?.total ?? 0) + 1
  return `OC-${anio}-${String(n).padStart(4, '0')}`
}

async function generarNumeroFacturaCompra(tenantDb: NonNullable<FastifyRequest['tenantDb']>): Promise<string> {
  const anio = new Date().getFullYear()
  const { rows } = await tenantDb.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM facturas_compra WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [anio],
  )
  const n = Number(rows[0]?.total ?? 0) + 1
  return `FC-${anio}-${String(n).padStart(4, '0')}`
}

export async function pedidosProveedorRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /compras — lista todos los pedidos a proveedores
  fastify.get('/compras', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { rows: pedidos } = await request.tenantDb.query<FilaPedidoProveedor>(
      `SELECT id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
       FROM pedidos_proveedor
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`,
    )

    if (pedidos.length === 0) return reply.send({ pedidos: [] })

    const ids = pedidos.map((p) => p.id)
    const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
      `SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario, subtotal
       FROM pedidos_proveedor_items
       WHERE pedido_proveedor_id = ANY($1::uuid[])`,
      [ids],
    )

    return reply.send({
      pedidos: pedidos.map((p) =>
        aPedido(
          p,
          items.filter((i) => i.pedido_proveedor_id === p.id).map(aItem),
        ),
      ),
    })
  })

  // GET /compras/:id — detalle de un pedido
  fastify.get<{ Params: { id: string } }>('/compras/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de pedido no válido.')

    const { rows } = await request.tenantDb.query<FilaPedidoProveedor>(
      `SELECT id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
       FROM pedidos_proveedor WHERE id = $1 AND deleted_at IS NULL`,
      [idParsed.data],
    )
    if (rows.length === 0) return reply.notFound('Pedido a proveedor no encontrado.')

    const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
      `SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario, subtotal
       FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1`,
      [idParsed.data],
    )

    return reply.send({ pedido: aPedido(rows[0]!, items.map(aItem)) })
  })

  // POST /compras — crear pedido a proveedor
  fastify.post('/compras', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const body = crearPedidoProveedorSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const numero = await generarNumeroOC(request.tenantDb)

    await request.tenantDb.query('BEGIN')
    try {
      const { rows: [pedido] } = await request.tenantDb.query<FilaPedidoProveedor>(
        `INSERT INTO pedidos_proveedor (numero, proveedor_id, fecha_esperada, notas, usuario_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [
          numero,
          body.data.proveedorId ?? null,
          body.data.fechaEsperada ?? null,
          body.data.notas ?? null,
          request.user.sub,
        ],
      )

      const insertedItems: PedidoProveedorItem[] = []
      let total = 0

      for (const item of body.data.items) {
        let productoId: string | null = null
        let concepto: string | null = null
        let precio = item.precioUnitario ?? 0

        if ('productoId' in item) {
          productoId = item.productoId
          // Usar precio de costo del producto si no se especificó precio
          if (!item.precioUnitario) {
            const { rows: prod } = await request.tenantDb.query<{ precio_costo: string | null }>(
              'SELECT precio_costo FROM productos WHERE id = $1',
              [item.productoId],
            )
            precio = Number(prod[0]?.precio_costo ?? 0)
          }
        } else {
          concepto = item.concepto
        }

        const { rows: [itemRow] } = await request.tenantDb.query<FilaPedidoProveedorItem>(
          `INSERT INTO pedidos_proveedor_items (pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario, subtotal`,
          [pedido!.id, productoId, concepto, item.cantidad, precio],
        )
        total += Number(itemRow!.subtotal)
        insertedItems.push(aItem(itemRow!))
      }

      // Actualizar el total del pedido
      const { rows: [pedidoFinal] } = await request.tenantDb.query<FilaPedidoProveedor>(
        `UPDATE pedidos_proveedor SET total = $1, updated_at = NOW() WHERE id = $2
         RETURNING id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [total, pedido!.id],
      )

      await request.tenantDb.query('COMMIT')
      return reply.status(201).send({ pedido: aPedido(pedidoFinal!, insertedItems) })
    } catch (err) {
      await request.tenantDb.query('ROLLBACK')
      throw err
    }
  })

  // PATCH /compras/:id — editar cabecera y/o ítems (si se mandan items, se reemplazan todos y se recalcula el total)
  fastify.patch<{ Params: { id: string } }>('/compras/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de pedido no válido.')

    const body = actualizarPedidoProveedorSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No hay campos para actualizar.')

    // Verificar que existe y no está eliminado
    const { rows: actual, rowCount: existe } = await request.tenantDb.query<FilaPedidoProveedor>(
      `SELECT id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
       FROM pedidos_proveedor WHERE id = $1 AND deleted_at IS NULL`,
      [idParsed.data],
    )
    if (existe === 0) return reply.notFound('Pedido a proveedor no encontrado.')

    // Si la OC ya está recibida o cancelada, solo se permiten editar notas
    const estadoActual = actual[0]!.estado as EstadoPedidoProveedor
    if (['recibido', 'cancelado'].includes(estadoActual) && body.data.items) {
      return reply.badRequest(`No se pueden editar los ítems de una OC en estado "${estadoActual}".`)
    }

    await request.tenantDb.query('BEGIN')
    try {
      // Actualizar cabecera
      const sets: string[] = ['updated_at = NOW()']
      const valores: unknown[] = []
      const ag = (col: string, val: unknown) => { valores.push(val); sets.push(`${col} = $${valores.length}`) }

      if (body.data.proveedorId !== undefined) ag('proveedor_id', body.data.proveedorId)
      if (body.data.fechaEsperada !== undefined) ag('fecha_esperada', body.data.fechaEsperada)
      if (body.data.notas !== undefined) ag('notas', body.data.notas)

      let nuevoTotal = Number(actual[0]!.total)

      // Si vienen ítems: borrar los actuales e insertar los nuevos
      if (body.data.items) {
        await request.tenantDb.query(
          'DELETE FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
          [idParsed.data],
        )

        nuevoTotal = 0
        for (const item of body.data.items) {
          let productoId: string | null = null
          let concepto: string | null = null
          let precio = item.precioUnitario ?? 0

          if ('productoId' in item) {
            productoId = item.productoId
            if (!item.precioUnitario) {
              const { rows: prod } = await request.tenantDb.query<{ precio_costo: string | null }>(
                'SELECT precio_costo FROM productos WHERE id = $1',
                [item.productoId],
              )
              precio = Number(prod[0]?.precio_costo ?? 0)
            }
          } else {
            concepto = item.concepto
          }

          const { rows: [itemRow] } = await request.tenantDb.query<FilaPedidoProveedorItem>(
            `INSERT INTO pedidos_proveedor_items (pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario, subtotal`,
            [idParsed.data, productoId, concepto, item.cantidad, precio],
          )
          nuevoTotal += Number(itemRow!.subtotal)
        }

        ag('total', nuevoTotal)
      }

      valores.push(idParsed.data)
      const { rows } = await request.tenantDb.query<FilaPedidoProveedor>(
        `UPDATE pedidos_proveedor SET ${sets.join(', ')}
         WHERE id = $${valores.length} AND deleted_at IS NULL
         RETURNING id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        valores,
      )

      await request.tenantDb.query('COMMIT')

      const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
        'SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario, subtotal FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
        [idParsed.data],
      )

      return reply.send({ pedido: aPedido(rows[0]!, items.map(aItem)) })
    } catch (err) {
      await request.tenantDb.query('ROLLBACK')
      throw err
    }
  })

  // PATCH /compras/:id/estado — cambiar estado (con posible generación de CxP)
  fastify.patch<{ Params: { id: string } }>('/compras/:id/estado', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de pedido no válido.')

    const body = transicionarPedidoProveedorSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const { rows: actual } = await request.tenantDb.query<FilaPedidoProveedor>(
      `SELECT id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
       FROM pedidos_proveedor WHERE id = $1 AND deleted_at IS NULL`,
      [idParsed.data],
    )
    if (actual.length === 0) return reply.notFound('Pedido a proveedor no encontrado.')

    const estadoActual = actual[0]!.estado as EstadoPedidoProveedor
    const estadoNuevo = body.data.estado
    const transicionesValidas = TRANSICIONES_VALIDAS_PROVEEDOR[estadoActual]
    if (!transicionesValidas.includes(estadoNuevo)) {
      return reply.badRequest(
        `Transición no permitida: ${estadoActual} → ${estadoNuevo}. Transiciones válidas: ${transicionesValidas.join(', ') || 'ninguna (estado terminal)'}`,
      )
    }

    await request.tenantDb.query('BEGIN')
    try {
      // Al recibir (total o parcial) — generar CxP si tiene proveedor y no tiene ya una
      let facturaCompraId = actual[0]!.factura_compra_id
      if ((estadoNuevo === 'recibido' || estadoNuevo === 'recibido_parcial') && !facturaCompraId && actual[0]!.proveedor_id) {
        const numeroFC = await generarNumeroFacturaCompra(request.tenantDb)
        const fechaVenc = body.data.fechaVencimientoCxP ?? (() => {
          const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10)
        })()

        const { rows: [fc] } = await request.tenantDb.query<{ id: string }>(
          `INSERT INTO facturas_compra (numero, proveedor_id, fecha_vencimiento, total, notas, pedido_proveedor_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            numeroFC,
            actual[0]!.proveedor_id,
            fechaVenc,
            actual[0]!.total,
            `Generada automáticamente al recibir OC ${actual[0]!.numero}`,
            idParsed.data,
          ],
        )
        facturaCompraId = fc!.id
      }

      const { rows: [pedidoActualizado] } = await request.tenantDb.query<FilaPedidoProveedor>(
        `UPDATE pedidos_proveedor SET estado = $1, factura_compra_id = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, numero, proveedor_id, estado, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [estadoNuevo, facturaCompraId, idParsed.data],
      )

      await request.tenantDb.query('COMMIT')

      const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
        'SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario, subtotal FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
        [idParsed.data],
      )

      return reply.send({ pedido: aPedido(pedidoActualizado!, items.map(aItem)) })
    } catch (err) {
      await request.tenantDb.query('ROLLBACK')
      throw err
    }
  })

  // DELETE /compras/:id — borrado suave
  fastify.delete<{ Params: { id: string } }>('/compras/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de pedido no válido.')

    const { rowCount } = await request.tenantDb.query(
      'UPDATE pedidos_proveedor SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [idParsed.data],
    )
    if (rowCount === 0) return reply.notFound('Pedido a proveedor no encontrado.')
    return reply.status(204).send()
  })
}

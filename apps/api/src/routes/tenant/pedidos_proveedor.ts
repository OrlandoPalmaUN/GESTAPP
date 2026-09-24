import {
  actualizarPedidoProveedorSchema,
  calcularStockDisponible,
  crearCompraDirectaSchema,
  crearPedidoProveedorSchema,
  TRANSICIONES_VALIDAS_PROVEEDOR,
  transicionarPedidoProveedorSchema,
  type EstadoPedidoProveedor,
  type MovimientoInventario,
  type PedidoProveedor,
  type PedidoProveedorItem,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { registrarAbonoEnTx } from '../../lib/abonos.js'
import { generarNumeroFacturaCompra, generarNumeroOC } from '../../lib/numeracion.js'

interface FilaPedidoProveedor {
  id: string
  numero: string
  proveedor_id: string | null
  estado: string
  fecha: Date
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
  cantidad_recibida: string
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
    cantidadRecibida: Number(row.cantidad_recibida ?? 0),
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
    fecha: row.fecha.toISOString().slice(0, 10),
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

function redondearMoneda(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

function calcularTotalRecibido(items: FilaPedidoProveedorItem[], totalOrden: number): number {
  const totalItems = items.reduce((acc, item) => acc + Number(item.subtotal), 0)
  const totalRecibidoPorPrecio = items.reduce(
    (acc, item) => acc + Number(item.cantidad_recibida) * Number(item.precio_unitario),
    0,
  )

  const todoRecibido = items.every((item) => Number(item.cantidad_recibida) >= Number(item.cantidad))
  if (todoRecibido) return redondearMoneda(totalOrden)

  if (totalItems > 0) {
    return redondearMoneda(totalOrden * (totalRecibidoPorPrecio / totalItems))
  }

  const cantidadTotal = items.reduce((acc, item) => acc + Number(item.cantidad), 0)
  const cantidadRecibida = items.reduce((acc, item) => acc + Number(item.cantidad_recibida), 0)
  if (cantidadTotal === 0) return 0
  return redondearMoneda(totalOrden * (cantidadRecibida / cantidadTotal))
}

export async function pedidosProveedorRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }
  // Acciones sensibles (destructivas o de dinero/visibilidad financiera): solo
  // admin del tenant. Antes TODO endpoint de negocio usaba solo `conSesion`,
  // así que cualquier empleado con login podía borrar facturas o cuentas.
  const soloAdmin = { preHandler: [fastify.requireRole('admin', 'superadmin')] }

  // GET /compras — lista todos los pedidos a proveedores
  fastify.get('/compras', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { rows: pedidos } = await request.tenantDb.query<FilaPedidoProveedor>(
      `SELECT id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
       FROM pedidos_proveedor
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`,
    )

    if (pedidos.length === 0) return reply.send({ pedidos: [] })

    const ids = pedidos.map((p) => p.id)
    const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
      `SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal
       FROM pedidos_proveedor_items
       WHERE pedido_proveedor_id = ANY($1::uuid[]) ORDER BY id`,
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
      `SELECT id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
       FROM pedidos_proveedor WHERE id = $1 AND deleted_at IS NULL`,
      [idParsed.data],
    )
    if (rows.length === 0) return reply.notFound('Pedido a proveedor no encontrado.')

    const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
      `SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal
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

    await request.tenantDb.query('BEGIN')
    try {
      const numero = await generarNumeroOC(request.tenantDb)

      const { rows: [pedido] } = await request.tenantDb.query<FilaPedidoProveedor>(
        `INSERT INTO pedidos_proveedor (numero, proveedor_id, fecha, fecha_esperada, notas, usuario_id)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6)
         RETURNING id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [
          numero,
          body.data.proveedorId ?? null,
          body.data.fecha ?? null,
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
           RETURNING id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal`,
          [pedido!.id, productoId, concepto, item.cantidad, precio],
        )
        total += Number(itemRow!.subtotal)
        insertedItems.push(aItem(itemRow!))
      }

      // Si el usuario indicó un total manual (precio real negociado), usarlo.
      const totalFinal = body.data.totalManual ?? total

      const { rows: [pedidoFinal] } = await request.tenantDb.query<FilaPedidoProveedor>(
        `UPDATE pedidos_proveedor SET total = $1, updated_at = NOW() WHERE id = $2
         RETURNING id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [totalFinal, pedido!.id],
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
      `SELECT id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
       FROM pedidos_proveedor WHERE id = $1 AND deleted_at IS NULL`,
      [idParsed.data],
    )
    if (existe === 0) return reply.notFound('Pedido a proveedor no encontrado.')

    // Si la OC ya empezó a recibir mercancía o generó CxP, no se reemplazan ítems:
    // hacerlo desbalancearía inventario, CxP y cantidades recibidas.
    const estadoActual = actual[0]!.estado as EstadoPedidoProveedor
    if ((!['borrador', 'enviado'].includes(estadoActual) || actual[0]!.factura_compra_id) && body.data.items) {
      return reply.badRequest(`No se pueden editar los ítems de una OC en estado "${estadoActual}".`)
    }
    if (actual[0]!.factura_compra_id && body.data.proveedorId !== undefined) {
      return reply.badRequest('No se puede cambiar el proveedor de una OC que ya generó una cuenta por pagar.')
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
             RETURNING id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal`,
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
         RETURNING id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        valores,
      )

      await request.tenantDb.query('COMMIT')

      const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
        'SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
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
      `SELECT id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
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
    if (estadoNuevo === 'recibido_parcial' && (!body.data.cantidades || body.data.cantidades.length === 0)) {
      return reply.badRequest('Para marcar una OC como recibida parcialmente debes indicar las cantidades recibidas.')
    }
    // Sin proveedor no hay a quién registrarle la deuda: antes esto se dejaba
    // pasar en silencio (se recibía el inventario pero la CxP nunca se creaba,
    // sin ningún aviso) — ahora se bloquea la recepción hasta asignar proveedor.
    if ((estadoNuevo === 'recibido' || estadoNuevo === 'recibido_parcial') && !actual[0]!.proveedor_id) {
      return reply.badRequest(
        'Esta OC no tiene proveedor asignado — asígnalo antes de recibirla, o no se generará la cuenta por pagar.',
      )
    }

    const db = request.tenantDb
    await db.query('BEGIN')
    try {
      const esRecepcion = estadoNuevo === 'recibido' || estadoNuevo === 'recibido_parcial'
      const oc = actual[0]!

      // Cargar ítems actuales con sus cantidades ya recibidas
      const { rows: itemsActuales } = await db.query<FilaPedidoProveedorItem>(
        `SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal
         FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1`,
        [idParsed.data],
      )

      // Guardar valores anteriores para calcular el delta de movimientos de inventario
      const cantidadAnteriorPorItem = new Map(itemsActuales.map((i) => [i.id, Number(i.cantidad_recibida)]))

      // --- Actualizar cantidad_recibida si aplica ---
      if (esRecepcion && body.data.cantidades) {
        const mapa = new Map(body.data.cantidades.map((c) => [c.itemId, c.cantidadRecibida]))
        const idsValidos = new Set(itemsActuales.map((item) => item.id))
        const itemDesconocido = body.data.cantidades.find((cantidad) => !idsValidos.has(cantidad.itemId))
        if (itemDesconocido) {
          await db.query('ROLLBACK')
          return reply.badRequest('Una de las cantidades recibidas no corresponde a esta orden de compra.')
        }
        for (const item of itemsActuales) {
          const nueva = mapa.get(item.id)
          if (nueva === undefined) continue
          const cantMax = Number(item.cantidad)
          const cantValida = Math.min(Math.max(0, nueva), cantMax)
          await db.query(
            'UPDATE pedidos_proveedor_items SET cantidad_recibida = $1 WHERE id = $2',
            [cantValida, item.id],
          )
          item.cantidad_recibida = String(cantValida)
        }
      } else if (esRecepcion) {
        // Sin cantidades explícitas → se recibe todo lo pendiente
        for (const item of itemsActuales) {
          if (Number(item.cantidad_recibida) < Number(item.cantidad)) {
            await db.query(
              'UPDATE pedidos_proveedor_items SET cantidad_recibida = cantidad WHERE id = $1',
              [item.id],
            )
            item.cantidad_recibida = item.cantidad
          }
        }
      }

      if (esRecepcion) {
        const algunoRecibido = itemsActuales.some((item) => Number(item.cantidad_recibida) > 0)
        const todosRecibidos = itemsActuales.every((item) => Number(item.cantidad_recibida) >= Number(item.cantidad))

        if (!algunoRecibido) {
          await db.query('ROLLBACK')
          return reply.badRequest('Registra al menos una cantidad recibida para generar inventario y CxP.')
        }
        if (estadoNuevo === 'recibido' && !todosRecibidos) {
          await db.query('ROLLBACK')
          return reply.badRequest('Para marcar la OC como recibida, todas las cantidades deben estar recibidas.')
        }
        if (estadoNuevo === 'recibido_parcial' && todosRecibidos) {
          await db.query('ROLLBACK')
          return reply.badRequest('Todas las cantidades están recibidas; marca la OC como "recibido".')
        }
      }

      // --- CxP: crear o actualizar según lo recibido ---
      let facturaCompraId = oc.factura_compra_id
      if (esRecepcion && oc.proveedor_id) {
        // La CxP refleja lo recibido acumulado, no el total completo de la OC.
        // Si la OC tiene total manual, se prorratea contra el avance recibido.
        const totalRecibido = calcularTotalRecibido(itemsActuales, Number(oc.total))
        const fechaVenc = body.data.fechaVencimientoCxP ?? (() => {
          const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10)
        })()

        if (!facturaCompraId) {
          // Primera recepción: crear la CxP con lo recibido hasta ahora
          const numeroFC = await generarNumeroFacturaCompra(db)
          const { rows: [fc] } = await db.query<{ id: string }>(
            `INSERT INTO facturas_compra (numero, proveedor_id, fecha_vencimiento, total, notas, pedido_proveedor_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              numeroFC,
              oc.proveedor_id,
              fechaVenc,
              totalRecibido,
              `Generada automáticamente al recibir OC ${oc.numero}`,
              idParsed.data,
            ],
          )
          facturaCompraId = fc!.id
        } else {
          // Recepciones sucesivas: actualizar el total de la CxP existente para
          // que SIEMPRE refleje lo recibido hasta ahora. Antes el código creaba
          // una "CxP complementaria" cuando ya había abonos — fragmentaba la
          // deuda en múltiples facturas sin relación clara, dificultando
          // reconciliación y abriendo riesgo de pago doble.
          //
          // Ahora: siempre actualizamos el total. La invariante "total >=
          // sum(abonos)" se preserva validando antes del UPDATE; si el nuevo
          // total resultara menor que lo ya abonado (caso raro: el usuario
          // reduce manualmente cantidades recibidas), bloqueamos para que el
          // usuario revierta los abonos primero.
          const abonosRes = await db.query<{ pagado: string }>(
            `SELECT COALESCE(SUM(monto), 0)::numeric AS pagado FROM abonos
             WHERE tipo_documento = 'factura_compra' AND documento_id = $1 AND deleted_at IS NULL`,
            [facturaCompraId],
          )
          const pagado = Number(abonosRes.rows[0]?.pagado ?? 0)
          if (totalRecibido < pagado) {
            await db.query('ROLLBACK')
            return reply.badRequest(
              `No se puede ajustar la CxP: el total recibido actualizado ($${totalRecibido.toLocaleString('es-CO')}) ` +
              `sería menor que lo ya abonado ($${pagado.toLocaleString('es-CO')}). ` +
              `Reversa los abonos correspondientes primero.`,
            )
          }
          await db.query(
            'UPDATE facturas_compra SET total = $1 WHERE id = $2',
            [totalRecibido, facturaCompraId],
          )
        }
      }

      // --- Movimientos de inventario: solo el delta de lo recibido en ESTA transición ---
      if (esRecepcion) {
        for (const item of itemsActuales) {
          if (item.producto_id === null) continue
          const anterior = cantidadAnteriorPorItem.get(item.id) ?? 0
          const delta = Number(item.cantidad_recibida) - anterior
          if (delta <= 0) continue
          await db.query(
            `INSERT INTO movimientos_inventario
               (producto_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id)
             VALUES ($1, 'entrada_compra', $2, $3, 'factura_compra', $4, $5, $6)`,
            [
              item.producto_id,
              delta,
              item.precio_unitario,
              facturaCompraId ?? idParsed.data,
              `Recepción OC ${oc.numero}`,
              request.user.sub,
            ],
          )
        }
      }

      const { rows: [pedidoActualizado] } = await db.query<FilaPedidoProveedor>(
        `UPDATE pedidos_proveedor SET estado = $1, factura_compra_id = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [estadoNuevo, facturaCompraId, idParsed.data],
      )

      await db.query('COMMIT')

      const { rows: items } = await request.tenantDb.query<FilaPedidoProveedorItem>(
        'SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
        [idParsed.data],
      )

      return reply.send({ pedido: aPedido(pedidoActualizado!, items.map(aItem)) })
    } catch (err) {
      await request.tenantDb.query('ROLLBACK')
      throw err
    }
  })

  /**
   * POST /compras/directa — compra de mercancía YA RECIBIDA, registrada desde Gastos.
   *
   * Es el camino normal desde que Compras dejó de ser un módulo aparte: el
   * usuario registra algo que ya pasó. Nace en `recibido` y NO atraviesa la
   * máquina de estados — que de hecho no permite `borrador → recibido`.
   *
   * TODO ocurre en una sola transacción (OC + ítems + CxP + movimientos de
   * inventario + abono si se pagó). Hacerlo en varias llamadas dejaría OCs
   * huérfanas en borrador que el usuario cree registradas pero que no movieron
   * ni stock ni plata — peor que un error, porque se ve bien.
   */
  fastify.post('/compras/directa', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const body = crearCompraDirectaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const db = request.tenantDb
    await db.query('BEGIN')
    try {
      const proveedorRes = await db.query<{ id: string }>(
        'SELECT id FROM proveedores WHERE id = $1 AND deleted_at IS NULL',
        [body.data.proveedorId],
      )
      if (proveedorRes.rowCount === 0) {
        await db.query('ROLLBACK')
        return reply.badRequest('El proveedor indicado no existe.')
      }

      // Los ítems de compra no guardan `variante_id` (la migración 020 lo agregó
      // a movimientos_inventario y pedido_items, no acá). El stock de un producto
      // con variantes se cuenta por variante, así que una entrada sin variante
      // NO le sumaría a ninguna y el producto quedaría en cero sin explicación.
      // Mejor rechazar de frente que dejar stock silenciosamente perdido.
      for (const item of body.data.items) {
        if (!('productoId' in item)) continue
        const { rows } = await db.query<{ nombre: string; tiene_variantes: boolean }>(
          'SELECT nombre, tiene_variantes FROM productos WHERE id = $1 AND deleted_at IS NULL',
          [item.productoId],
        )
        if (rows.length === 0) {
          await db.query('ROLLBACK')
          return reply.badRequest('Uno de los productos seleccionados no existe.')
        }
        if (rows[0]!.tiene_variantes) {
          await db.query('ROLLBACK')
          return reply.badRequest(
            `"${rows[0]!.nombre}" se maneja por variantes (talla, color, etc.), y todavía no se puede cargar su stock desde acá. ` +
            `Registrá la entrada desde Inventario, en la variante correspondiente.`,
          )
        }
      }

      const numero = await generarNumeroOC(db)
      const { rows: [pedido] } = await db.query<FilaPedidoProveedor>(
        `INSERT INTO pedidos_proveedor (numero, proveedor_id, estado, fecha, notas, usuario_id)
         VALUES ($1, $2, 'recibido', COALESCE($3::date, CURRENT_DATE), $4, $5)
         RETURNING id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [numero, body.data.proveedorId, body.data.fecha ?? null, body.data.descripcion, request.user.sub],
      )

      const itemsInsertados: FilaPedidoProveedorItem[] = []
      let suma = 0
      for (const item of body.data.items) {
        let productoId: string | null = null
        let concepto: string | null = null
        let precio = item.precioUnitario ?? 0

        if ('productoId' in item) {
          productoId = item.productoId
          if (!item.precioUnitario) {
            const { rows: prod } = await db.query<{ precio_costo: string | null }>(
              'SELECT precio_costo FROM productos WHERE id = $1',
              [item.productoId],
            )
            precio = Number(prod[0]?.precio_costo ?? 0)
          }
        } else {
          concepto = item.concepto
        }

        // `cantidad_recibida = cantidad`: la mercancía ya llegó, por definición.
        const { rows: [itemRow] } = await db.query<FilaPedidoProveedorItem>(
          `INSERT INTO pedidos_proveedor_items (pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario)
           VALUES ($1, $2, $3, $4, $4, $5)
           RETURNING id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal`,
          [pedido!.id, productoId, concepto, item.cantidad, precio],
        )
        suma += Number(itemRow!.subtotal)
        itemsInsertados.push(itemRow!)
      }

      const totalFinal = redondearMoneda(body.data.totalManual ?? suma)
      await db.query('UPDATE pedidos_proveedor SET total = $1, updated_at = NOW() WHERE id = $2', [totalFinal, pedido!.id])

      // La CxP se emite con la fecha de la COMPRA, no la de hoy: registrar el
      // lunes una compra del viernes pasado no puede correrle el vencimiento
      // tres días. Mismo criterio que el gasto a crédito en finanzas.ts.
      const fechaCompra = pedido!.fecha.toISOString().slice(0, 10)
      const fechaVenc = body.data.fechaVencimientoCxP ?? (() => {
        const d = new Date(fechaCompra); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10)
      })()
      const numeroFC = await generarNumeroFacturaCompra(db)
      const { rows: [fc] } = await db.query<{ id: string; total: string }>(
        `INSERT INTO facturas_compra (numero, proveedor_id, fecha_emision, fecha_vencimiento, total, notas, pedido_proveedor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, total`,
        [numeroFC, body.data.proveedorId, fechaCompra, fechaVenc, totalFinal, `Compra ${numero} — ${body.data.descripcion}`, pedido!.id],
      )

      await db.query('UPDATE pedidos_proveedor SET factura_compra_id = $1 WHERE id = $2', [fc!.id, pedido!.id])

      for (const item of itemsInsertados) {
        if (item.producto_id === null) continue
        await db.query(
          `INSERT INTO movimientos_inventario
             (producto_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id)
           VALUES ($1, 'entrada_compra', $2, $3, 'factura_compra', $4, $5, $6)`,
          [item.producto_id, Number(item.cantidad), item.precio_unitario, fc!.id, `Compra ${numero}`, request.user.sub],
        )
      }

      if (body.data.pagado) {
        // El monto sale del total que quedó GUARDADO en la factura, no del que
        // calculamos en JS: NUMERIC(12,2) redondea, y un centavo de diferencia
        // haría que el abono "exceda el saldo pendiente".
        const resultado = await registrarAbonoEnTx(
          db,
          {
            tipo: 'cxp',
            facturaId: fc!.id,
            monto: Number(fc!.total),
            medioPago: body.data.medioPago ?? null,
            referencia: `Pago de contado ${numero}`,
            cuentaBancariaId: body.data.cuentaBancariaId ?? null,
          },
          request.user.sub,
        )
        if (!resultado.ok) {
          await db.query('ROLLBACK')
          return resultado.motivo === 'no_encontrado'
            ? reply.notFound(resultado.mensaje)
            : reply.badRequest(resultado.mensaje)
        }
      }

      const { rows: [pedidoFinal] } = await db.query<FilaPedidoProveedor>(
        `SELECT id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
         FROM pedidos_proveedor WHERE id = $1`,
        [pedido!.id],
      )

      await db.query('COMMIT')
      return reply.status(201).send({ pedido: aPedido(pedidoFinal!, itemsInsertados.map(aItem)) })
    } catch (err) {
      await db.query('ROLLBACK').catch(() => undefined)
      throw err
    }
  })

  /**
   * POST /compras/:id/revertir-recepcion — deshacer una compra ya recibida.
   *
   * Sin esto, registrar una compra sería irreversible: `recibido` no tiene
   * transiciones de salida, `DELETE /compras/:id` se niega cuando hay CxP o
   * cantidades recibidas, y `movimientos_inventario` NO tiene `deleted_at`, así
   * que borrar la OC dejaría el stock inflado para siempre. Un typo en el monto
   * de una compra no puede ser permanente.
   *
   * El stock se corrige con movimientos compensatorios (`ajuste_negativo`), no
   * borrando los originales: el ledger de inventario es append-only y esa
   * historia es justamente lo que permite auditar de dónde salió cada unidad.
   */
  fastify.post<{ Params: { id: string } }>('/compras/:id/revertir-recepcion', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de compra no válido.')

    const db = request.tenantDb
    await db.query('BEGIN')
    try {
      const { rows: [oc] } = await db.query<FilaPedidoProveedor>(
        `SELECT id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at
         FROM pedidos_proveedor WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [idParsed.data],
      )
      if (!oc) {
        await db.query('ROLLBACK')
        return reply.notFound('La compra indicada no existe.')
      }
      if (oc.estado !== 'recibido' && oc.estado !== 'recibido_parcial') {
        await db.query('ROLLBACK')
        return reply.badRequest('Esta compra no tiene mercancía recibida para revertir.')
      }

      // Los abonos se revierten primero y por su propia vía, que es la que
      // devuelve la plata a la cuenta bancaria.
      if (oc.factura_compra_id) {
        const { rows: [ab] } = await db.query<{ total: string }>(
          `SELECT COALESCE(SUM(monto), 0)::text AS total FROM abonos
           WHERE tipo_documento = 'factura_compra' AND documento_id = $1 AND deleted_at IS NULL`,
          [oc.factura_compra_id],
        )
        if (Number(ab?.total ?? 0) > 0) {
          await db.query('ROLLBACK')
          return reply.badRequest(
            'Esta compra ya tiene pagos registrados. Eliminá primero los abonos (eso devuelve la plata a la cuenta) y después revertí la compra.',
          )
        }
      }

      const { rows: items } = await db.query<FilaPedidoProveedorItem>(
        'SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
        [idParsed.data],
      )

      // La mercancía de esta compra pudo haberse vendido ya. Sacarla igual
      // dejaría el stock en negativo — el mismo estado imposible que
      // `POST /inventario/movimientos` y `ajustar_stock` bloquean. Se valida
      // ANTES de insertar nada: revertir a medias sería peor que no revertir.
      for (const item of items) {
        if (item.producto_id === null) continue
        const recibida = Number(item.cantidad_recibida)
        if (recibida <= 0) continue
        const { rows: movs } = await db.query<{ tipo: string; cantidad: string }>(
          'SELECT tipo, cantidad FROM movimientos_inventario WHERE producto_id = $1',
          [item.producto_id],
        )
        const disponible = calcularStockDisponible(
          movs.map((m) => ({ tipo: m.tipo as MovimientoInventario['tipo'], cantidad: Number(m.cantidad) })),
        )
        if (recibida > disponible) {
          const { rows: [prod] } = await db.query<{ nombre: string }>(
            'SELECT nombre FROM productos WHERE id = $1',
            [item.producto_id],
          )
          await db.query('ROLLBACK')
          return reply.badRequest(
            `No se puede revertir: de "${prod?.nombre ?? 'este producto'}" entraron ${recibida} unidades pero solo quedan ${disponible} disponibles (el resto ya salió en ventas). Anulá primero los pedidos que las consumieron.`,
          )
        }
      }

      for (const item of items) {
        if (item.producto_id === null) continue
        const recibida = Number(item.cantidad_recibida)
        if (recibida <= 0) continue
        await db.query(
          `INSERT INTO movimientos_inventario
             (producto_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id)
           VALUES ($1, 'ajuste_negativo', $2, $3, 'factura_compra', $4, $5, $6)`,
          [
            item.producto_id,
            recibida,
            item.precio_unitario,
            oc.factura_compra_id ?? oc.id,
            `Reversión de la compra ${oc.numero}`,
            request.user.sub,
          ],
        )
      }

      await db.query('UPDATE pedidos_proveedor_items SET cantidad_recibida = 0 WHERE pedido_proveedor_id = $1', [idParsed.data])

      if (oc.factura_compra_id) {
        await db.query('UPDATE facturas_compra SET deleted_at = NOW() WHERE id = $1', [oc.factura_compra_id])
      }

      const { rows: [pedidoActualizado] } = await db.query<FilaPedidoProveedor>(
        `UPDATE pedidos_proveedor SET estado = 'cancelado', factura_compra_id = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id, numero, proveedor_id, estado, fecha, fecha_esperada, notas, total, factura_compra_id, usuario_id, created_at, updated_at`,
        [idParsed.data],
      )

      await db.query('COMMIT')

      const { rows: itemsFinal } = await db.query<FilaPedidoProveedorItem>(
        'SELECT id, pedido_proveedor_id, producto_id, concepto, cantidad, cantidad_recibida, precio_unitario, subtotal FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
        [idParsed.data],
      )
      return reply.send({ pedido: aPedido(pedidoActualizado!, itemsFinal.map(aItem)) })
    } catch (err) {
      await db.query('ROLLBACK').catch(() => undefined)
      throw err
    }
  })

  // DELETE /compras/:id — borrado suave
  // Solo se permite si la OC no ha recibido inventario ni generado CxP.
  fastify.delete<{ Params: { id: string } }>('/compras/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de pedido no válido.')

    const db = request.tenantDb
    await db.query('BEGIN')
    try {
      const actual = await db.query<{ factura_compra_id: string | null }>(
        'SELECT factura_compra_id FROM pedidos_proveedor WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [idParsed.data],
      )
      if (actual.rowCount === 0) {
        await db.query('ROLLBACK')
        return reply.notFound('Pedido a proveedor no encontrado.')
      }
      const recibidaRes = await db.query<{ recibida: string }>(
        'SELECT COALESCE(SUM(cantidad_recibida), 0)::text AS recibida FROM pedidos_proveedor_items WHERE pedido_proveedor_id = $1',
        [idParsed.data],
      )

      const oc = actual.rows[0]!
      if (oc.factura_compra_id || Number(recibidaRes.rows[0]?.recibida ?? 0) > 0) {
        await db.query('ROLLBACK')
        return reply.badRequest('No se puede eliminar una OC que ya recibió inventario o generó una cuenta por pagar.')
      }

      await db.query('UPDATE pedidos_proveedor SET deleted_at = NOW() WHERE id = $1', [idParsed.data])
      await db.query('COMMIT')
      return reply.status(204).send()
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

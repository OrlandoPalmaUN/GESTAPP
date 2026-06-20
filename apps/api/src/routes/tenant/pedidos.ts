import {
  actualizarPedidoSchema,
  crearPedidoSchema,
  MOVIMIENTOS_POR_TRANSICION,
  transicionarPedidoSchema,
  TRANSICIONES_VALIDAS,
  type EstadoPedido,
  type Pedido,
  type PedidoItem,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface FilaPedido {
  id: string
  numero: string
  cliente_id: string | null
  estado: string
  total: string
  notas: string | null
  usuario_id: string | null
  created_at: Date
  updated_at: Date
}

interface FilaPedidoItem {
  id: string
  pedido_id: string
  producto_id: string | null
  variante_id: string | null
  concepto: string | null
  cantidad: string
  precio_unitario: string
  precio_costo: string | null
  subtotal: string
}

function aPedidoItem(row: FilaPedidoItem): PedidoItem {
  return {
    id: row.id,
    productoId: row.producto_id,
    varianteId: row.variante_id,
    concepto: row.concepto,
    cantidad: Number(row.cantidad),
    precioUnitario: Number(row.precio_unitario),
    precioCosto: row.precio_costo === null ? null : Number(row.precio_costo),
    subtotal: Number(row.subtotal),
  }
}

function aPedido(row: FilaPedido, items: PedidoItem[]): Pedido {
  return {
    id: row.id,
    numero: row.numero,
    clienteId: row.cliente_id,
    estado: row.estado as EstadoPedido,
    total: Number(row.total),
    notas: row.notas,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    items,
  }
}

/** Igual que en `inventario.ts`/`clientes.ts` — sin tenant resuelto no hay schema contra el cual operar. */
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

/** `PED-<año>-<consecutivo>` — consecutivo por año, basado en el conteo actual de pedidos de ese año. */
async function generarNumeroPedido(tenantDb: FastifyRequest['tenantDb'] & {}): Promise<string> {
  const anio = new Date().getFullYear()
  // Advisory lock por tipo de secuencia — previene colisiones entre requests concurrentes.
  // Se libera automáticamente al COMMIT/ROLLBACK de la transacción.
  await tenantDb.query("SELECT pg_advisory_xact_lock(hashtext('numero_pedido'))")
  const { rows } = await tenantDb.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM pedidos WHERE numero LIKE $1`,
    [`PED-${anio}-%`],
  )
  const consecutivo = Number(rows[0]?.total ?? '0') + 1
  return `PED-${anio}-${String(consecutivo).padStart(4, '0')}`
}

/** `FV-<año>-<consecutivo>` — mismo esquema que `generarNumeroFactura` en finanzas.ts (no se exporta de allá, así que lo replicamos acá para la cxc automática). */
async function generarNumeroFacturaVenta(tenantDb: FastifyRequest['tenantDb'] & {}): Promise<string> {
  const anio = new Date().getFullYear()
  await tenantDb.query("SELECT pg_advisory_xact_lock(hashtext('numero_factura_venta'))")
  const { rows } = await tenantDb.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM facturas_venta WHERE numero LIKE $1`,
    [`FV-${anio}-%`],
  )
  const consecutivo = Number(rows[0]?.total ?? '0') + 1
  return `FV-${anio}-${String(consecutivo).padStart(4, '0')}`
}

/**
 * Al confirmar un pedido, se instancia automáticamente su cuenta por cobrar
 * (factura de venta) — así el módulo de Finanzas siempre refleja lo que hay
 * que cobrar sin que alguien tenga que acordarse de crearla a mano. Plazo de
 * pago por defecto: 30 días desde la confirmación (ajustable luego desde el
 * propio módulo de Finanzas, que sí permite editar la fecha de vencimiento).
 */
async function crearCxcAutomaticaSiAplica(
  client: FastifyRequest['tenantDb'] & {},
  pedido: Pick<FilaPedido, 'id' | 'numero' | 'cliente_id' | 'total'>,
): Promise<void> {
  if (pedido.cliente_id === null) return // sin cliente no hay a quién cobrarle — el usuario puede crearla manual si hace falta

  const existente = await client.query('SELECT id FROM facturas_venta WHERE pedido_id = $1 AND deleted_at IS NULL', [pedido.id])
  if ((existente.rowCount ?? 0) > 0) return // ya tiene su cxc activa — no crear duplicada

  const numero = await generarNumeroFacturaVenta(client)
  const fechaVencimiento = new Date()
  fechaVencimiento.setDate(fechaVencimiento.getDate() + 30)

  await client.query(
    `INSERT INTO facturas_venta (numero, cliente_id, pedido_id, fecha_vencimiento, total, notas)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      numero,
      pedido.cliente_id,
      pedido.id,
      fechaVencimiento.toISOString().slice(0, 10),
      pedido.total,
      `Generada automáticamente al confirmar el Pedido ${pedido.numero}.`,
    ],
  )
}

async function cargarItemsDePedidos(
  tenantDb: FastifyRequest['tenantDb'] & {},
  pedidoIds: string[],
): Promise<Map<string, PedidoItem[]>> {
  if (pedidoIds.length === 0) return new Map()
  const { rows } = await tenantDb.query<FilaPedidoItem>(
    `SELECT id, pedido_id, producto_id, variante_id, concepto, cantidad, precio_unitario, precio_costo, subtotal
     FROM pedido_items WHERE pedido_id = ANY($1::uuid[])`,
    [pedidoIds],
  )
  const porPedido = new Map<string, PedidoItem[]>()
  for (const row of rows) {
    const lista = porPedido.get(row.pedido_id) ?? []
    lista.push(aPedidoItem(row))
    porPedido.set(row.pedido_id, lista)
  }
  return porPedido
}

/**
 * Rutas de Pedidos — orquestan la máquina de estados (plan §5.2) y, vía esa
 * máquina, las reglas de inventario (plan §5.1: "el stock nunca se escribe
 * directo"). Cada transición que mueve stock genera sus `movimientos_inventario`
 * dentro de la MISMA transacción que actualiza el pedido — así nunca queda un
 * pedido en un estado sin su movimiento correspondiente, o viceversa.
 *
 * `TRANSICIONES_VALIDAS` y `MOVIMIENTO_POR_TRANSICION` viven en `shared` para
 * que la API (autoridad) y el frontend (UX: qué botones mostrar) coincidan.
 */
export async function pedidosRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /pedidos
  fastify.get('/pedidos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaPedido>(
      `SELECT id, numero, cliente_id, estado, total, notas, usuario_id, created_at, updated_at
       FROM pedidos WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    )
    const itemsPorPedido = await cargarItemsDePedidos(request.tenantDb, rows.map((r) => r.id))
    const pedidos = rows.map((row) => aPedido(row, itemsPorPedido.get(row.id) ?? []))
    return reply.send({ pedidos })
  })

  // POST /pedidos — crea en estado 'borrador'. El precio de cada ítem lo fija
  // el SERVIDOR desde el catálogo (no el cliente) — es la fuente de verdad del precio de venta.
  fastify.post('/pedidos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearPedidoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      if (body.data.clienteId) {
        const cli = await client.query('SELECT id FROM clientes WHERE id = $1', [body.data.clienteId])
        if (cli.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('El cliente seleccionado no existe.')
        }
      }

      // Resolver precios/costos reales del catálogo y validar existencia de cada producto
      // — solo para los ítems que SÍ referencian un producto (los "cargos
      // libres" como Envío no tienen `productoId`, ver `crearPedidoItemSchema`).
      const productoIds = body.data.items
        .map((i) => ('productoId' in i ? i.productoId : null))
        .filter((id): id is string => id !== null)
      const productosRes = await client.query<{ id: string; precio_venta: string | null; precio_costo: string | null; nombre: string; tiene_variantes: boolean }>(
        'SELECT id, precio_venta, precio_costo, nombre, tiene_variantes FROM productos WHERE id = ANY($1::uuid[])',
        [productoIds],
      )
      const catalogo = new Map(productosRes.rows.map((p) => [p.id, p]))

      // Validar de una sola consulta TODAS las variantes referenciadas — más
      // simple que una query por ítem dentro del loop.
      const varianteIds = body.data.items
        .map((i) => ('productoId' in i ? i.varianteId : null))
        .filter((id): id is string => id != null)
      const variantesRes = varianteIds.length > 0
        ? await client.query<{ id: string; producto_id: string; precio_venta: string | null }>(
            'SELECT id, producto_id, precio_venta FROM variantes_producto WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
            [varianteIds],
          )
        : { rows: [] as { id: string; producto_id: string; precio_venta: string | null }[] }
      const variantesCatalogo = new Map(variantesRes.rows.map((v) => [v.id, v]))

      let total = 0
      const itemsAInsertar: {
        productoId: string | null
        varianteId: string | null
        concepto: string | null
        cantidad: number
        precioUnitario: number
        precioCosto: number | null
      }[] = []
      for (const item of body.data.items) {
        if ('productoId' in item) {
          const producto = catalogo.get(item.productoId)
          if (!producto) {
            await client.query('ROLLBACK')
            return reply.badRequest(`Uno de los productos del pedido no existe (id ${item.productoId}).`)
          }
          let variante: { id: string; producto_id: string; precio_venta: string | null } | undefined
          if (producto.tiene_variantes) {
            if (!item.varianteId) {
              await client.query('ROLLBACK')
              return reply.badRequest(`"${producto.nombre}" tiene variantes — indica cuál (talla/color/etc.) para cada ítem.`)
            }
            variante = variantesCatalogo.get(item.varianteId)
            if (!variante || variante.producto_id !== item.productoId) {
              await client.query('ROLLBACK')
              return reply.badRequest(`La variante elegida para "${producto.nombre}" no existe o no le pertenece.`)
            }
          }
          // Precio "excepcional": si el cliente lo manda, sobreescribe el
          // precio de catálogo para este ítem puntual (p.ej. un descuento
          // negociado). Si no, el precio de la variante (si tiene override)
          // o el del producto-modelo es la fuente de verdad, en ese orden.
          const precioCatalogo = variante?.precio_venta ?? producto.precio_venta
          const precioUnitario =
            item.precioUnitario !== undefined
              ? item.precioUnitario
              : precioCatalogo === null
                ? 0
                : Number(precioCatalogo)
          const precioCosto = producto.precio_costo === null ? null : Number(producto.precio_costo)
          total += precioUnitario * item.cantidad
          itemsAInsertar.push({ productoId: item.productoId, varianteId: item.varianteId ?? null, concepto: null, cantidad: item.cantidad, precioUnitario, precioCosto })
        } else {
          // Cargo libre (p.ej. "Envío"): no está en el catálogo, así que el
          // precio lo manda el cliente y el costo se IGUALA al precio — se
          // cobra "a costo" (margen cero) pero el cliente igual debe pagarlo.
          total += item.precioUnitario * item.cantidad
          itemsAInsertar.push({
            productoId: null,
            varianteId: null,
            concepto: item.concepto,
            cantidad: item.cantidad,
            precioUnitario: item.precioUnitario,
            precioCosto: item.precioUnitario,
          })
        }
      }

      const numero = await generarNumeroPedido(client)
      const insertPedido = await client.query<FilaPedido>(
        `INSERT INTO pedidos (numero, cliente_id, estado, total, notas, usuario_id)
         VALUES ($1, $2, 'borrador', $3, $4, $5)
         RETURNING id, numero, cliente_id, estado, total, notas, usuario_id, created_at, updated_at`,
        [numero, body.data.clienteId ?? null, total, body.data.notas ?? null, request.user.sub],
      )
      const pedido = insertPedido.rows[0]!

      const itemsInsertados: PedidoItem[] = []
      for (const item of itemsAInsertar) {
        const { rows } = await client.query<FilaPedidoItem>(
          `INSERT INTO pedido_items (pedido_id, producto_id, variante_id, concepto, cantidad, precio_unitario, precio_costo)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, pedido_id, producto_id, variante_id, concepto, cantidad, precio_unitario, precio_costo, subtotal`,
          [pedido.id, item.productoId, item.varianteId, item.concepto, item.cantidad, item.precioUnitario, item.precioCosto],
        )
        itemsInsertados.push(aPedidoItem(rows[0]!))
      }

      // CxC automática: se crea junto con el pedido para que desde el
      // primer momento quede registrada la obligación de cobro. Si no hay
      // cliente, no se crea (no hay a quién facturar).
      await crearCxcAutomaticaSiAplica(client, pedido)

      await client.query('COMMIT')
      return reply.status(201).send({ pedido: aPedido(pedido, itemsInsertados) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // PATCH /pedidos/:id/estado — única forma de cambiar el estado; valida la
  // transición y aplica (transaccionalmente) los movimientos de inventario que correspondan.
  fastify.patch<{ Params: { id: string } }>('/pedidos/:id/estado', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = transicionarPedidoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const actual = await client.query<FilaPedido>(
        `SELECT id, numero, cliente_id, estado, total, notas, usuario_id, created_at, updated_at
         FROM pedidos WHERE id = $1 FOR UPDATE`,
        [request.params.id],
      )
      if (actual.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Pedido no encontrado.')
      }
      const pedido = actual.rows[0]!
      const estadoActual = pedido.estado as EstadoPedido
      const estadoDestino = body.data.estado

      if (estadoActual === estadoDestino) {
        await client.query('ROLLBACK')
        return reply.badRequest(`El pedido ya está en estado "${estadoActual}".`)
      }
      if (!TRANSICIONES_VALIDAS[estadoActual].includes(estadoDestino)) {
        await client.query('ROLLBACK')
        return reply.badRequest(`No se puede pasar de "${estadoActual}" a "${estadoDestino}".`)
      }

      const itemsRes = await client.query<FilaPedidoItem>(
        `SELECT id, pedido_id, producto_id, variante_id, concepto, cantidad, precio_unitario, precio_costo, subtotal
         FROM pedido_items WHERE pedido_id = $1`,
        [pedido.id],
      )
      const items = itemsRes.rows.map(aPedidoItem)

      const tiposMovimiento = MOVIMIENTOS_POR_TRANSICION[`${estadoActual}->${estadoDestino}`] ?? []
      const detallePorTipo: Record<(typeof tiposMovimiento)[number], string> = {
        reserva: `Reserva por confirmación de Pedido ${pedido.numero}`,
        liberacion_reserva:
          estadoDestino === 'despachado'
            ? `Liberación de reserva por despacho de Pedido ${pedido.numero} (pasa a salida real)`
            : `Liberación de stock por cancelación de Pedido ${pedido.numero}`,
        salida_venta: `Salida definitiva por despacho de Pedido ${pedido.numero}`,
      }

      for (const tipo of tiposMovimiento) {
        for (const item of items) {
          // Los "cargos libres" (p.ej. Envío) no son productos del catálogo
          // — no tienen stock que reservar/liberar/despachar.
          if (item.productoId === null) continue
          await client.query(
            `INSERT INTO movimientos_inventario
               (producto_id, variante_id, tipo, cantidad, referencia_tipo, referencia_id, notas, usuario_id)
             VALUES ($1, $2, $3, $4, 'pedido', $5, $6, $7)`,
            [item.productoId, item.varianteId, tipo, item.cantidad, pedido.id, detallePorTipo[tipo], request.user.sub],
          )
        }
      }

      const actualizado = await client.query<FilaPedido>(
        `UPDATE pedidos SET estado = $2, updated_at = NOW() WHERE id = $1
         RETURNING id, numero, cliente_id, estado, total, notas, usuario_id, created_at, updated_at`,
        [pedido.id, estadoDestino],
      )

      await client.query('COMMIT')
      return reply.send({ pedido: aPedido(actualizado.rows[0]!, items) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // PATCH /pedidos/:id — edición "administrativa" (cliente, notas). Cambiar
  // ítems/total/estado sigue yendo por sus propios flujos (ver arriba):
  // tocarlos aquí desbalancearía reservas e inventario ya aplicados.
  // Si se asigna un clienteId y el pedido no tiene CxC activa, se genera automáticamente.
  fastify.patch<{ Params: { id: string } }>('/pedidos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarPedidoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      if (body.data.clienteId) {
        const cli = await client.query('SELECT id FROM clientes WHERE id = $1 AND deleted_at IS NULL', [body.data.clienteId])
        if (cli.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('El cliente seleccionado no existe.')
        }
      }

      const campos: Record<string, unknown> = {
        cliente_id: body.data.clienteId,
        notas: body.data.notas,
      }
      const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
      const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      const valores = entradas.map(([, v]) => v)

      const { rows, rowCount } = await client.query<FilaPedido>(
        `UPDATE pedidos SET ${sets}, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, numero, cliente_id, estado, total, notas, usuario_id, created_at, updated_at`,
        [request.params.id, ...valores],
      )
      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Pedido no encontrado.')
      }

      // Si se asignó un cliente, asegurarse de que exista la CxC correspondiente.
      if (body.data.clienteId) {
        await crearCxcAutomaticaSiAplica(client, rows[0]!)
      }

      await client.query('COMMIT')

      const itemsRes = await client.query<FilaPedidoItem>(
        `SELECT id, pedido_id, producto_id, variante_id, concepto, cantidad, precio_unitario, precio_costo, subtotal FROM pedido_items WHERE pedido_id = $1`,
        [request.params.id],
      )
      return reply.send({ pedido: aPedido(rows[0]!, itemsRes.rows.map(aPedidoItem)) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // DELETE /pedidos/:id — borrado suave, recuperable desde /papelera.
  // Si el pedido tiene una CxC sin abonos, se borra en cascada.
  // Si la CxC ya tiene abonos, se bloquea (los pagos registrados no se pueden huerfanar).
  fastify.delete<{ Params: { id: string } }>('/pedidos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const actual = await client.query<{ estado: string; numero: string }>(
        'SELECT estado, numero FROM pedidos WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [request.params.id],
      )
      if (actual.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Pedido no encontrado.')
      }
      const estadoActual = actual.rows[0]!.estado as EstadoPedido
      const numeroPedido = actual.rows[0]!.numero

      // Buscar la CxC activa asociada
      const cxcRes = await client.query<{ id: string; numero: string }>(
        'SELECT id, numero FROM facturas_venta WHERE pedido_id = $1 AND deleted_at IS NULL',
        [request.params.id],
      )
      const cxc = cxcRes.rows[0]

      if (cxc) {
        const conAbonos = await client.query(
          'SELECT id FROM abonos WHERE tipo_documento = $1 AND documento_id = $2 AND deleted_at IS NULL LIMIT 1',
          ['factura_venta', cxc.id],
        )
        if ((conAbonos.rowCount ?? 0) > 0) {
          await client.query('ROLLBACK')
          return reply.badRequest(
            `No se puede eliminar el pedido: la factura ${cxc.numero} ya tiene abonos registrados. Elimínalos primero desde Finanzas.`,
          )
        }
        // Cascada: borrar la CxC junto con el pedido
        await client.query('UPDATE facturas_venta SET deleted_at = NOW() WHERE id = $1', [cxc.id])
      }

      // Si el pedido tenía movimientos de reserva activos (estado confirmado o en_preparacion),
      // crearlos compensatorios para liberar el stock — de lo contrario quedarían reservados
      // para siempre aunque el pedido ya no exista.
      if (estadoActual === 'confirmado' || estadoActual === 'en_preparacion') {
        const itemsRes = await client.query<FilaPedidoItem>(
          'SELECT id, pedido_id, producto_id, variante_id, concepto, cantidad, precio_unitario, precio_costo, subtotal FROM pedido_items WHERE pedido_id = $1',
          [request.params.id],
        )
        for (const item of itemsRes.rows) {
          if (item.producto_id === null) continue // cargos libres no tienen stock
          await client.query(
            `INSERT INTO movimientos_inventario
               (producto_id, variante_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id)
             VALUES ($1, $2, 'liberacion_reserva', $3, $4, 'pedido', $5, $6, $7)`,
            [
              item.producto_id,
              item.variante_id,
              item.cantidad,
              item.precio_unitario,
              request.params.id,
              `Liberación de reserva por eliminación de Pedido ${numeroPedido}`,
              request.user.sub,
            ],
          )
        }
      }

      await client.query('UPDATE pedidos SET deleted_at = NOW() WHERE id = $1', [request.params.id])
      await client.query('COMMIT')
      return reply.status(204).send()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

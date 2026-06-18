/**
 * Ejecuta las tool calls del LLM contra la base de datos del tenant.
 *
 * Reglas obligatorias para cada tool:
 *  - El connection pool client llega con el search_path ya apuntando al
 *    schema del tenant (ver tenant-resolver) — JAMÁS hacer cross-schema queries.
 *  - Las write-tools deben mantener INVARIANTES de negocio:
 *      • stock nunca queda negativo
 *      • saldo de cuenta bancaria nunca queda negativo en transferencias/gastos
 *      • transiciones de estado de pedidos pasan por TRANSICIONES_VALIDAS y
 *        disparan los mismos side effects que la ruta HTTP
 *      • toda operación multi-paso va en BEGIN/COMMIT
 *  - El executor NUNCA borra. Eliminar es del usuario.
 */
import type { PoolClient } from 'pg'
import {
  MOVIMIENTOS_POR_TRANSICION,
  TRANSICIONES_VALIDAS,
  type EstadoPedido,
} from '@antigravity/shared'

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  db: PoolClient,
): Promise<ToolResult> {
  try {
    switch (name) {
      // ── Clientes ────────────────────────────────────────────────────────
      case 'buscar_cliente':
        return await buscarCliente(args.nombre as string, db)
      case 'crear_cliente':
        return await crearCliente(args as { nombre: string; email?: string; telefono?: string; nit?: string }, db)
      case 'ver_historial_cliente':
        return await verHistorialCliente(args.cliente_id as string, db)

      // ── Proveedores ─────────────────────────────────────────────────────
      case 'buscar_proveedor':
        return await buscarProveedor(args.nombre as string, db)
      case 'crear_proveedor':
        return await crearProveedor(args as { nombre: string; email?: string; telefono?: string; nit?: string }, db)

      // ── Productos / Inventario ──────────────────────────────────────────
      case 'buscar_producto':
        return await buscarProducto(args.query as string, db)
      case 'crear_producto':
        return await crearProducto(args as unknown as CrearProductoArgs, db)
      case 'ajustar_stock':
        return await ajustarStock(args as unknown as AjustarStockArgs, db)
      case 'consultar_stock_bajo':
        return await consultarStockBajo(db)

      // ── Pedidos ─────────────────────────────────────────────────────────
      case 'crear_pedido':
        return await crearPedido(args as unknown as CrearPedidoArgs, db)
      case 'actualizar_estado_pedido':
        return await actualizarEstadoPedido(args as unknown as ActualizarEstadoArgs, db)
      case 'buscar_pedido':
        return await buscarPedido(args.query as string, db)
      case 'consultar_pedidos_pendientes':
        return await consultarPedidosPendientes(db)

      // ── Compras (OC al proveedor) ───────────────────────────────────────
      case 'crear_compra':
        return await crearCompra(args as unknown as CrearCompraArgs, db)
      case 'consultar_compras_pendientes':
        return await consultarComprasPendientes(db)

      // ── Finanzas ────────────────────────────────────────────────────────
      case 'registrar_abono':
        return await registrarAbono(args as unknown as RegistrarAbonoArgs, db)
      case 'registrar_gasto':
        return await registrarGasto(args as unknown as RegistrarGastoArgs, db)
      case 'registrar_ingreso_manual':
        return await registrarIngresoManual(args as unknown as RegistrarIngresoArgs, db)
      case 'consultar_cuentas_bancarias':
        return await consultarCuentasBancarias(db)
      case 'consultar_facturas_vencidas':
        return await consultarFacturasVencidas((args.tipo as string | undefined) ?? 'todas', db)

      // ── Dashboard / KPIs ────────────────────────────────────────────────
      case 'consultar_resumen_negocio':
        return await consultarResumenNegocio(db)
      case 'consultar_kpis_dashboard':
        return await consultarKpisDashboard(db)

      // ── Notas / Calendario ──────────────────────────────────────────────
      case 'crear_nota':
        return await crearNota(args as unknown as { titulo: string; contenido?: string }, db)
      case 'crear_evento_calendario':
        return await crearEventoCalendario(args as unknown as CrearEventoArgs, db)

      // ── Instagram ───────────────────────────────────────────────────────
      case 'consultar_posts_ig':
        return await consultarPostsIg(
          (args.limite as number | undefined) ?? 10,
          (args.tipo as string | undefined) ?? null,
          db,
        )
      case 'consultar_metricas_ig':
        return await consultarMetricasIg(db)

      default:
        return { success: false, error: `Herramienta desconocida: ${name}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

/** Subquery SQL para calcular stock disponible — mismo cálculo que packages/shared. */
const STOCK_SUBQUERY = `
  COALESCE((
    SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                    THEN cantidad ELSE -cantidad END)
    FROM movimientos_inventario WHERE producto_id = p.id
  ), 0)`

async function generarNumeroFacturaVenta(db: PoolClient): Promise<string> {
  const anio = new Date().getFullYear()
  await db.query("SELECT pg_advisory_xact_lock(hashtext('numero_factura_venta'))")
  const { rows } = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM facturas_venta WHERE numero LIKE $1`,
    [`FV-${anio}-%`],
  )
  const n = Number(rows[0]?.total ?? 0) + 1
  return `FV-${anio}-${String(n).padStart(4, '0')}`
}

async function generarNumeroPedido(db: PoolClient): Promise<string> {
  const anio = new Date().getFullYear()
  await db.query("SELECT pg_advisory_xact_lock(hashtext('numero_pedido'))")
  const { rows } = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM pedidos WHERE numero LIKE $1`,
    [`PED-${anio}-%`],
  )
  const n = Number(rows[0]?.total ?? 0) + 1
  return `PED-${anio}-${String(n).padStart(4, '0')}`
}

async function generarNumeroOC(db: PoolClient): Promise<string> {
  const anio = new Date().getFullYear()
  await db.query("SELECT pg_advisory_xact_lock(hashtext('numero_oc'))")
  const { rows } = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM pedidos_proveedor WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [anio],
  )
  const n = Number(rows[0]?.total ?? 0) + 1
  return `OC-${anio}-${String(n).padStart(4, '0')}`
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENTES
// ════════════════════════════════════════════════════════════════════════════

async function buscarCliente(nombre: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT id, nombre, email, telefono, nit
     FROM clientes
     WHERE nombre ILIKE $1 AND deleted_at IS NULL
     ORDER BY nombre LIMIT 5`,
    [`%${nombre}%`],
  )
  return { success: true, data: rows }
}

async function crearCliente(
  args: { nombre: string; email?: string; telefono?: string; nit?: string },
  db: PoolClient,
): Promise<ToolResult> {
  const { rows } = await db.query<{ id: string; nombre: string }>(
    `INSERT INTO clientes (nombre, email, telefono, nit)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre`,
    [args.nombre, args.email ?? null, args.telefono ?? null, args.nit ?? null],
  )
  return { success: true, data: rows[0] }
}

async function verHistorialCliente(clienteId: string, db: PoolClient): Promise<ToolResult> {
  const [info, pedidos, saldo, facturasAbiertas] = await Promise.all([
    db.query(`SELECT nombre, email, telefono, nit FROM clientes WHERE id = $1`, [clienteId]),
    db.query(
      `SELECT numero, estado, total, created_at::date AS fecha
       FROM pedidos WHERE cliente_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 10`,
      [clienteId],
    ),
    db.query(
      `SELECT
         COALESCE(SUM(fv.total), 0) -
         COALESCE((
           SELECT SUM(a.monto) FROM abonos a
           WHERE a.tipo_documento = 'factura_venta'
             AND a.documento_id IN (SELECT id FROM facturas_venta WHERE cliente_id = $1 AND deleted_at IS NULL)
             AND a.deleted_at IS NULL
         ), 0) AS saldo_pendiente
       FROM facturas_venta fv
       WHERE fv.cliente_id = $1 AND fv.deleted_at IS NULL`,
      [clienteId],
    ),
    db.query(
      `SELECT fv.numero, fv.total,
              fv.total - COALESCE((SELECT SUM(monto) FROM abonos
                                   WHERE tipo_documento = 'factura_venta'
                                     AND documento_id = fv.id AND deleted_at IS NULL), 0) AS saldo,
              fv.fecha_vencimiento
       FROM facturas_venta fv
       WHERE fv.cliente_id = $1 AND fv.deleted_at IS NULL
         AND fv.total > COALESCE((SELECT SUM(monto) FROM abonos
                                  WHERE tipo_documento = 'factura_venta'
                                    AND documento_id = fv.id AND deleted_at IS NULL), 0)
       ORDER BY fv.fecha_vencimiento ASC LIMIT 10`,
      [clienteId],
    ),
  ])
  return {
    success: true,
    data: {
      cliente: info.rows[0] ?? null,
      pedidos: pedidos.rows,
      saldoPendiente: Number(saldo.rows[0]?.saldo_pendiente ?? 0),
      facturasAbiertas: facturasAbiertas.rows,
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROVEEDORES
// ════════════════════════════════════════════════════════════════════════════

async function buscarProveedor(nombre: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT id, nombre, email, telefono, nit
     FROM proveedores
     WHERE nombre ILIKE $1 AND deleted_at IS NULL
     ORDER BY nombre LIMIT 5`,
    [`%${nombre}%`],
  )
  return { success: true, data: rows }
}

async function crearProveedor(
  args: { nombre: string; email?: string; telefono?: string; nit?: string },
  db: PoolClient,
): Promise<ToolResult> {
  const { rows } = await db.query<{ id: string; nombre: string }>(
    `INSERT INTO proveedores (nombre, email, telefono, nit)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre`,
    [args.nombre, args.email ?? null, args.telefono ?? null, args.nit ?? null],
  )
  return { success: true, data: rows[0] }
}

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTOS / INVENTARIO
// ════════════════════════════════════════════════════════════════════════════

interface CrearProductoArgs {
  nombre: string
  precio_venta: number
  precio_costo?: number
  stock_inicial?: number
  stock_minimo?: number
  unidad?: string
  sku?: string
  descripcion?: string
}

interface AjustarStockArgs {
  producto_id: string
  producto_nombre: string
  cantidad: number
  tipo: 'ajuste_positivo' | 'ajuste_negativo'
  notas?: string
}

async function buscarProducto(query: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT p.id, p.nombre, p.precio_venta AS precio, ${STOCK_SUBQUERY} AS stock,
            p.unidad, p.stock_minimo
     FROM productos p
     WHERE (p.nombre ILIKE $1 OR p.descripcion ILIKE $1) AND p.deleted_at IS NULL
     LIMIT 5`,
    [`%${query}%`],
  )
  return { success: true, data: rows }
}

async function crearProducto(args: CrearProductoArgs, db: PoolClient): Promise<ToolResult> {
  await db.query('BEGIN')
  try {
    const { rows } = await db.query<{ id: string; nombre: string }>(
      `INSERT INTO productos (nombre, precio_venta, precio_costo, stock_minimo, unidad, sku, descripcion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nombre`,
      [
        args.nombre,
        args.precio_venta,
        args.precio_costo ?? null,
        args.stock_minimo ?? 0,
        args.unidad ?? 'unidad',
        args.sku ?? null,
        args.descripcion ?? null,
      ],
    )
    const producto = rows[0]!
    const stock = args.stock_inicial ?? 0
    if (stock > 0) {
      await db.query(
        `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, notas)
         VALUES ($1, 'ajuste_positivo', $2, 'Inventario inicial')`,
        [producto.id, stock],
      )
    }
    await db.query('COMMIT')
    return { success: true, data: { ...producto, stock } }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

async function ajustarStock(args: AjustarStockArgs, db: PoolClient): Promise<ToolResult> {
  // Validar que un ajuste_negativo no deje el stock negativo
  if (args.tipo === 'ajuste_negativo') {
    const { rows: stockRow } = await db.query<{ stock: string }>(
      `SELECT ${STOCK_SUBQUERY} AS stock FROM productos p WHERE p.id = $1`,
      [args.producto_id],
    )
    const stockActual = Number(stockRow[0]?.stock ?? 0)
    if (args.cantidad > stockActual) {
      return {
        success: false,
        error: `No se puede restar ${args.cantidad} unidades de ${args.producto_nombre} — stock actual: ${stockActual}.`,
      }
    }
  }

  await db.query(
    `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, notas)
     VALUES ($1, $2, $3, $4)`,
    [args.producto_id, args.tipo, args.cantidad, args.notas ?? 'Ajuste manual desde IA'],
  )
  const { rows } = await db.query(
    `SELECT ${STOCK_SUBQUERY} AS stock FROM productos p WHERE p.id = $1`,
    [args.producto_id],
  )
  return {
    success: true,
    data: {
      producto: args.producto_nombre,
      tipo: args.tipo,
      cantidad: args.cantidad,
      stockResultante: Number(rows[0]?.stock ?? 0),
    },
  }
}

async function consultarStockBajo(db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(`
    SELECT p.id, p.nombre, p.sku,
           ${STOCK_SUBQUERY} AS stock_actual,
           p.stock_minimo AS stock_minimo
    FROM productos p
    WHERE p.deleted_at IS NULL
      AND p.stock_minimo > 0
      AND ${STOCK_SUBQUERY} <= p.stock_minimo
    ORDER BY (${STOCK_SUBQUERY}::float / NULLIF(p.stock_minimo, 0)) ASC
    LIMIT 20
  `)
  return { success: true, data: rows }
}

// ════════════════════════════════════════════════════════════════════════════
// PEDIDOS DE VENTA
// ════════════════════════════════════════════════════════════════════════════

interface CrearPedidoArgs {
  cliente_id: string
  cliente_nombre: string
  items: Array<{
    producto_id: string
    producto_nombre: string
    cantidad: number
    precio_unitario?: number
  }>
  notas?: string
}

interface ActualizarEstadoArgs {
  pedido_id: string
  nuevo_estado: EstadoPedido
  notas?: string
}

async function crearPedido(args: CrearPedidoArgs, db: PoolClient): Promise<ToolResult> {
  await db.query('BEGIN')
  try {
    // Verificar que el cliente existe
    const cli = await db.query('SELECT id FROM clientes WHERE id = $1 AND deleted_at IS NULL', [args.cliente_id])
    if (cli.rowCount === 0) {
      await db.query('ROLLBACK')
      return { success: false, error: `Cliente ${args.cliente_nombre} no existe o fue eliminado.` }
    }

    // Cargar precios/costos del catálogo
    const productoIds = args.items.map((i) => i.producto_id)
    const { rows: productos } = await db.query<{ id: string; precio_venta: string | null; precio_costo: string | null }>(
      'SELECT id, precio_venta, precio_costo FROM productos WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
      [productoIds],
    )
    const catalogo = new Map(productos.map((p) => [p.id, p]))

    let total = 0
    const items: { productoId: string; cantidad: number; precioUnitario: number; precioCosto: number | null }[] = []
    for (const it of args.items) {
      const prod = catalogo.get(it.producto_id)
      if (!prod) {
        await db.query('ROLLBACK')
        return { success: false, error: `El producto "${it.producto_nombre}" no existe.` }
      }
      const precio = it.precio_unitario ?? (prod.precio_venta === null ? 0 : Number(prod.precio_venta))
      const costo = prod.precio_costo === null ? null : Number(prod.precio_costo)
      total += precio * it.cantidad
      items.push({ productoId: it.producto_id, cantidad: it.cantidad, precioUnitario: precio, precioCosto: costo })
    }

    const numero = await generarNumeroPedido(db)
    const { rows: pedidoRows } = await db.query<{ id: string }>(
      `INSERT INTO pedidos (numero, cliente_id, estado, total, notas)
       VALUES ($1, $2, 'borrador', $3, $4)
       RETURNING id`,
      [numero, args.cliente_id, total, args.notas ?? null],
    )
    const pedidoId = pedidoRows[0]!.id

    for (const it of items) {
      await db.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_costo)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedidoId, it.productoId, it.cantidad, it.precioUnitario, it.precioCosto],
      )
    }

    await db.query('COMMIT')
    return {
      success: true,
      data: {
        pedidoId,
        numero,
        estado: 'borrador',
        cliente: args.cliente_nombre,
        items: items.length,
        total,
        siguiente_paso: 'Para descontar stock y generar la cuenta por cobrar, confirma el pedido con actualizar_estado_pedido.',
      },
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

async function actualizarEstadoPedido(args: ActualizarEstadoArgs, db: PoolClient): Promise<ToolResult> {
  await db.query('BEGIN')
  try {
    const { rows: pedidoRows } = await db.query<{
      id: string
      numero: string
      cliente_id: string | null
      estado: string
      total: string
    }>(
      `SELECT id, numero, cliente_id, estado, total
       FROM pedidos WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [args.pedido_id],
    )
    if (pedidoRows.length === 0) {
      await db.query('ROLLBACK')
      return { success: false, error: 'Pedido no encontrado.' }
    }
    const pedido = pedidoRows[0]!
    const estadoActual = pedido.estado as EstadoPedido
    const estadoNuevo = args.nuevo_estado

    if (estadoActual === estadoNuevo) {
      await db.query('ROLLBACK')
      return { success: false, error: `El pedido ya está en estado "${estadoActual}".` }
    }
    if (!TRANSICIONES_VALIDAS[estadoActual]?.includes(estadoNuevo)) {
      await db.query('ROLLBACK')
      return {
        success: false,
        error: `Transición inválida: ${estadoActual} → ${estadoNuevo}. Válidas: ${TRANSICIONES_VALIDAS[estadoActual]?.join(', ') ?? 'ninguna'}.`,
      }
    }

    // Movimientos de inventario para esta transición
    const movimientos = MOVIMIENTOS_POR_TRANSICION[`${estadoActual}->${estadoNuevo}`] ?? []
    if (movimientos.length > 0) {
      const { rows: items } = await db.query<{ producto_id: string | null; cantidad: string }>(
        'SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = $1',
        [pedido.id],
      )
      for (const tipo of movimientos) {
        for (const item of items) {
          if (item.producto_id === null) continue
          await db.query(
            `INSERT INTO movimientos_inventario
               (producto_id, tipo, cantidad, referencia_tipo, referencia_id, notas)
             VALUES ($1, $2, $3, 'pedido', $4, $5)`,
            [item.producto_id, tipo, item.cantidad, pedido.id, `IA: ${estadoActual}→${estadoNuevo} pedido ${pedido.numero}`],
          )
        }
      }
    }

    // Si la transición es a 'confirmado' y hay cliente_id → crear CxC automática
    if (estadoNuevo === 'confirmado' && pedido.cliente_id) {
      const existente = await db.query(
        'SELECT id FROM facturas_venta WHERE pedido_id = $1 AND deleted_at IS NULL',
        [pedido.id],
      )
      if ((existente.rowCount ?? 0) === 0) {
        const numeroFV = await generarNumeroFacturaVenta(db)
        const fechaVenc = new Date()
        fechaVenc.setDate(fechaVenc.getDate() + 30)
        await db.query(
          `INSERT INTO facturas_venta (numero, cliente_id, pedido_id, fecha_vencimiento, total, notas)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            numeroFV,
            pedido.cliente_id,
            pedido.id,
            fechaVenc.toISOString().slice(0, 10),
            Number(pedido.total),
            `Generada automáticamente al confirmar pedido ${pedido.numero} desde IA.`,
          ],
        )
      }
    }

    await db.query(
      `UPDATE pedidos SET estado = $1, notas = COALESCE($2, notas), updated_at = NOW() WHERE id = $3`,
      [estadoNuevo, args.notas ?? null, pedido.id],
    )

    await db.query('COMMIT')
    return {
      success: true,
      data: {
        pedido: pedido.numero,
        estadoAnterior: estadoActual,
        estadoNuevo,
        movimientos: movimientos.length > 0 ? `${movimientos.join('+')} aplicados` : 'sin efecto en stock',
        cxcGenerada: estadoNuevo === 'confirmado' && pedido.cliente_id !== null,
      },
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

async function buscarPedido(query: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.estado, p.total, c.nombre AS cliente, p.created_at::date AS fecha
     FROM pedidos p
     LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE p.deleted_at IS NULL
       AND (p.numero ILIKE $1 OR c.nombre ILIKE $1)
     ORDER BY p.created_at DESC LIMIT 10`,
    [`%${query}%`],
  )
  return { success: true, data: rows }
}

async function consultarPedidosPendientes(db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(`
    SELECT p.id, p.numero, p.estado, p.total, c.nombre AS cliente, p.created_at::date AS fecha
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.deleted_at IS NULL
      AND p.estado IN ('borrador', 'confirmado', 'en_preparacion')
    ORDER BY p.created_at DESC LIMIT 30
  `)
  return { success: true, data: rows }
}

// ════════════════════════════════════════════════════════════════════════════
// COMPRAS (OC al proveedor)
// ════════════════════════════════════════════════════════════════════════════

interface CrearCompraArgs {
  proveedor_id: string
  proveedor_nombre: string
  items: Array<{
    producto_id?: string
    concepto?: string
    cantidad: number
    precio_unitario?: number
  }>
  fecha_esperada?: string
  notas?: string
}

async function crearCompra(args: CrearCompraArgs, db: PoolClient): Promise<ToolResult> {
  await db.query('BEGIN')
  try {
    const prov = await db.query(
      'SELECT id FROM proveedores WHERE id = $1 AND deleted_at IS NULL',
      [args.proveedor_id],
    )
    if (prov.rowCount === 0) {
      await db.query('ROLLBACK')
      return { success: false, error: `Proveedor ${args.proveedor_nombre} no existe.` }
    }

    const numero = await generarNumeroOC(db)
    const { rows: ocRows } = await db.query<{ id: string }>(
      `INSERT INTO pedidos_proveedor (numero, proveedor_id, fecha_esperada, notas)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [numero, args.proveedor_id, args.fecha_esperada ?? null, args.notas ?? null],
    )
    const ocId = ocRows[0]!.id

    let total = 0
    for (const it of args.items) {
      let precio = it.precio_unitario ?? 0
      let productoId: string | null = null
      let concepto: string | null = null

      if (it.producto_id) {
        productoId = it.producto_id
        if (!it.precio_unitario) {
          const { rows: prod } = await db.query<{ precio_costo: string | null }>(
            'SELECT precio_costo FROM productos WHERE id = $1',
            [it.producto_id],
          )
          precio = Number(prod[0]?.precio_costo ?? 0)
        }
      } else if (it.concepto) {
        concepto = it.concepto
      } else {
        await db.query('ROLLBACK')
        return { success: false, error: 'Cada item debe tener producto_id o concepto.' }
      }

      const { rows: [itemRow] } = await db.query<{ subtotal: string }>(
        `INSERT INTO pedidos_proveedor_items (pedido_proveedor_id, producto_id, concepto, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING subtotal`,
        [ocId, productoId, concepto, it.cantidad, precio],
      )
      total += Number(itemRow!.subtotal)
    }

    await db.query('UPDATE pedidos_proveedor SET total = $1 WHERE id = $2', [total, ocId])

    await db.query('COMMIT')
    return {
      success: true,
      data: { ocId, numero, proveedor: args.proveedor_nombre, items: args.items.length, total },
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

async function consultarComprasPendientes(db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(`
    SELECT pp.id, pp.numero, pp.estado, pp.total, p.nombre AS proveedor,
           pp.fecha_esperada, pp.created_at::date AS fecha
    FROM pedidos_proveedor pp
    LEFT JOIN proveedores p ON p.id = pp.proveedor_id
    WHERE pp.deleted_at IS NULL
      AND pp.estado IN ('borrador', 'enviado', 'recibido_parcial')
    ORDER BY pp.fecha_esperada NULLS LAST, pp.created_at DESC LIMIT 30
  `)
  return { success: true, data: rows }
}

// ════════════════════════════════════════════════════════════════════════════
// FINANZAS
// ════════════════════════════════════════════════════════════════════════════

interface RegistrarAbonoArgs {
  cliente_id: string
  cliente_nombre: string
  monto: number
  medio_pago?: string
  cuenta_bancaria_id?: string
  referencia?: string
}

interface RegistrarGastoArgs {
  descripcion: string
  monto: number
  categoria?: string
  cuenta_bancaria_id?: string
  fecha?: string
}

interface RegistrarIngresoArgs {
  descripcion: string
  monto: number
  cuenta_bancaria_id: string
  fecha?: string
}

async function registrarAbono(args: RegistrarAbonoArgs, db: PoolClient): Promise<ToolResult> {
  await db.query('BEGIN')
  try {
    // Buscar la factura abierta más antigua con FOR UPDATE para evitar race conditions
    const { rows: facturas } = await db.query<{ id: string; total: string; numero: string; saldo: string }>(
      `SELECT fv.id, fv.total, fv.numero,
              fv.total - COALESCE((SELECT SUM(a.monto) FROM abonos a
                                   WHERE a.tipo_documento = 'factura_venta'
                                     AND a.documento_id = fv.id AND a.deleted_at IS NULL), 0) AS saldo
       FROM facturas_venta fv
       WHERE fv.cliente_id = $1 AND fv.deleted_at IS NULL
         AND fv.total > COALESCE((SELECT SUM(a.monto) FROM abonos a
                                  WHERE a.tipo_documento = 'factura_venta'
                                    AND a.documento_id = fv.id AND a.deleted_at IS NULL), 0)
       ORDER BY fv.created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [args.cliente_id],
    )
    if (!facturas.length) {
      await db.query('ROLLBACK')
      return { success: false, error: `${args.cliente_nombre} no tiene facturas con saldo pendiente.` }
    }
    const factura = facturas[0]!
    if (args.monto > Number(factura.saldo)) {
      await db.query('ROLLBACK')
      return {
        success: false,
        error: `El monto ($${args.monto.toLocaleString('es-CO')}) excede el saldo pendiente ($${Number(factura.saldo).toLocaleString('es-CO')}) de la factura ${factura.numero}.`,
      }
    }

    if (args.cuenta_bancaria_id) {
      const cuenta = await db.query(
        'SELECT id FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [args.cuenta_bancaria_id],
      )
      if (cuenta.rowCount === 0) {
        await db.query('ROLLBACK')
        return { success: false, error: 'Cuenta bancaria no encontrada.' }
      }
    }

    await db.query(
      `INSERT INTO abonos (tipo_documento, documento_id, monto, medio_pago, referencia, cuenta_bancaria_id)
       VALUES ('factura_venta', $1, $2, $3, $4, $5)`,
      [factura.id, args.monto, args.medio_pago ?? 'efectivo', args.referencia ?? null, args.cuenta_bancaria_id ?? null],
    )

    // Side effect: sumar al saldo de la cuenta bancaria si se especificó
    if (args.cuenta_bancaria_id) {
      await db.query(
        `UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2 AND deleted_at IS NULL`,
        [args.monto, args.cuenta_bancaria_id],
      )
    }

    await db.query('COMMIT')
    return {
      success: true,
      data: {
        cliente: args.cliente_nombre,
        factura: factura.numero,
        abono: args.monto,
        saldoRestante: Number(factura.saldo) - args.monto,
        medioPago: args.medio_pago ?? 'efectivo',
      },
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

async function registrarGasto(args: RegistrarGastoArgs, db: PoolClient): Promise<ToolResult> {
  await db.query('BEGIN')
  try {
    const categoriasPermitidas = new Set(['arriendo', 'servicios', 'nomina', 'comisiones', 'marketing', 'otros'])
    const categoria = args.categoria && categoriasPermitidas.has(args.categoria) ? args.categoria : 'otros'

    // Si tiene cuenta, validar saldo suficiente
    if (args.cuenta_bancaria_id) {
      const { rows } = await db.query<{ saldo: string }>(
        'SELECT saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [args.cuenta_bancaria_id],
      )
      if (!rows.length) {
        await db.query('ROLLBACK')
        return { success: false, error: 'Cuenta bancaria no encontrada.' }
      }
      if (Number(rows[0]!.saldo) < args.monto) {
        await db.query('ROLLBACK')
        return {
          success: false,
          error: `Saldo insuficiente. Saldo: $${Number(rows[0]!.saldo).toLocaleString('es-CO')}, gasto: $${args.monto.toLocaleString('es-CO')}.`,
        }
      }
    }

    const { rows: gasto } = await db.query<{ id: string }>(
      `INSERT INTO gastos_operativos (descripcion, monto, categoria, cuenta_bancaria_id, fecha)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))
       RETURNING id`,
      [args.descripcion, args.monto, categoria, args.cuenta_bancaria_id ?? null, args.fecha ?? null],
    )

    if (args.cuenta_bancaria_id) {
      await db.query(
        `UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2`,
        [args.monto, args.cuenta_bancaria_id],
      )
    }

    await db.query('COMMIT')
    return {
      success: true,
      data: { gastoId: gasto[0]!.id, descripcion: args.descripcion, monto: args.monto, categoria },
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

async function registrarIngresoManual(args: RegistrarIngresoArgs, db: PoolClient): Promise<ToolResult> {
  await db.query('BEGIN')
  try {
    const cuenta = await db.query(
      'SELECT id FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [args.cuenta_bancaria_id],
    )
    if (cuenta.rowCount === 0) {
      await db.query('ROLLBACK')
      return { success: false, error: 'Cuenta bancaria no encontrada.' }
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO ingresos_bancarios (descripcion, monto, cuenta_bancaria_id, fecha)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))
       RETURNING id`,
      [args.descripcion, args.monto, args.cuenta_bancaria_id, args.fecha ?? null],
    )
    await db.query(
      `UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2`,
      [args.monto, args.cuenta_bancaria_id],
    )

    await db.query('COMMIT')
    return { success: true, data: { ingresoId: rows[0]!.id, descripcion: args.descripcion, monto: args.monto } }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

async function consultarCuentasBancarias(db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(`
    SELECT id, banco, numero, tipo, saldo
    FROM cuentas_bancarias
    WHERE deleted_at IS NULL
    ORDER BY banco, numero
  `)
  return { success: true, data: rows }
}

async function consultarFacturasVencidas(tipo: string, db: PoolClient): Promise<ToolResult> {
  const incluyeCxC = tipo === 'cxc' || tipo === 'todas'
  const incluyeCxP = tipo === 'cxp' || tipo === 'todas'

  const promises: Array<Promise<{ rows: unknown[] }>> = []
  if (incluyeCxC) {
    promises.push(db.query(`
      SELECT 'CxC' AS tipo, fv.numero, c.nombre AS contraparte,
             fv.total, fv.fecha_vencimiento,
             fv.total - COALESCE((SELECT SUM(monto) FROM abonos
                                  WHERE tipo_documento = 'factura_venta'
                                    AND documento_id = fv.id AND deleted_at IS NULL), 0) AS saldo,
             (CURRENT_DATE - fv.fecha_vencimiento)::int AS dias_vencido
      FROM facturas_venta fv
      LEFT JOIN clientes c ON c.id = fv.cliente_id
      WHERE fv.deleted_at IS NULL
        AND fv.fecha_vencimiento < CURRENT_DATE
        AND fv.total > COALESCE((SELECT SUM(monto) FROM abonos
                                 WHERE tipo_documento = 'factura_venta'
                                   AND documento_id = fv.id AND deleted_at IS NULL), 0)
      ORDER BY fv.fecha_vencimiento ASC LIMIT 20
    `))
  }
  if (incluyeCxP) {
    promises.push(db.query(`
      SELECT 'CxP' AS tipo, fc.numero, p.nombre AS contraparte,
             fc.total, fc.fecha_vencimiento,
             fc.total - COALESCE((SELECT SUM(monto) FROM abonos
                                  WHERE tipo_documento = 'factura_compra'
                                    AND documento_id = fc.id AND deleted_at IS NULL), 0) AS saldo,
             (CURRENT_DATE - fc.fecha_vencimiento)::int AS dias_vencido
      FROM facturas_compra fc
      LEFT JOIN proveedores p ON p.id = fc.proveedor_id
      WHERE fc.deleted_at IS NULL
        AND fc.fecha_vencimiento < CURRENT_DATE
        AND fc.total > COALESCE((SELECT SUM(monto) FROM abonos
                                 WHERE tipo_documento = 'factura_compra'
                                   AND documento_id = fc.id AND deleted_at IS NULL), 0)
      ORDER BY fc.fecha_vencimiento ASC LIMIT 20
    `))
  }
  const resultados = await Promise.all(promises)
  return { success: true, data: resultados.flatMap((r) => r.rows) }
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD / KPIs
// ════════════════════════════════════════════════════════════════════════════

async function consultarResumenNegocio(db: PoolClient): Promise<ToolResult> {
  const [ventas, stockBajo, pedidosPendientes] = await Promise.all([
    db.query(`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(total),0)::numeric AS monto
      FROM pedidos
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND estado != 'cancelado'
        AND deleted_at IS NULL
    `),
    db.query(`
      SELECT p.nombre, ${STOCK_SUBQUERY} AS stock_actual, p.stock_minimo
      FROM productos p
      WHERE p.deleted_at IS NULL
        AND p.stock_minimo > 0
        AND ${STOCK_SUBQUERY} <= p.stock_minimo
      LIMIT 5
    `),
    db.query(`
      SELECT COUNT(*)::int AS total FROM pedidos
      WHERE estado IN ('borrador','confirmado','en_preparacion') AND deleted_at IS NULL
    `),
  ])
  return {
    success: true,
    data: {
      ventas30d: ventas.rows[0],
      stockBajo: stockBajo.rows,
      pedidosPendientes: pedidosPendientes.rows[0]?.total ?? 0,
    },
  }
}

async function consultarKpisDashboard(db: PoolClient): Promise<ToolResult> {
  const [topProductos, topClientes, ocPendientes, sinDespacho, saldoCuentas, cxcCxp] = await Promise.all([
    db.query(`
      SELECT pr.nombre, SUM(pi.cantidad)::int AS unidades, SUM(pi.subtotal)::numeric AS ingresos
      FROM pedido_items pi
      JOIN pedidos p ON p.id = pi.pedido_id
      JOIN productos pr ON pr.id = pi.producto_id
      WHERE p.estado IN ('confirmado','en_preparacion','despachado','entregado')
        AND p.created_at >= NOW() - INTERVAL '30 days'
        AND p.deleted_at IS NULL
      GROUP BY pr.id, pr.nombre
      ORDER BY ingresos DESC LIMIT 5
    `),
    db.query(`
      SELECT c.nombre, COUNT(p.id)::int AS pedidos, COALESCE(SUM(p.total),0)::numeric AS monto
      FROM clientes c
      JOIN pedidos p ON p.cliente_id = c.id
      WHERE p.estado != 'cancelado' AND p.deleted_at IS NULL
        AND p.created_at >= NOW() - INTERVAL '90 days'
      GROUP BY c.id, c.nombre
      ORDER BY monto DESC LIMIT 5
    `),
    db.query(`
      SELECT COUNT(*)::int AS total
      FROM pedidos_proveedor
      WHERE estado IN ('borrador','enviado','recibido_parcial') AND deleted_at IS NULL
    `),
    db.query(`
      SELECT COUNT(*)::int AS total
      FROM pedidos
      WHERE estado IN ('confirmado','en_preparacion') AND deleted_at IS NULL
    `),
    db.query(`
      SELECT COALESCE(SUM(saldo),0)::numeric AS total
      FROM cuentas_bancarias WHERE deleted_at IS NULL
    `),
    db.query(`
      SELECT
        COALESCE((
          SELECT SUM(GREATEST(fv.total - COALESCE((
            SELECT SUM(ab.monto)
            FROM abonos ab
            WHERE ab.tipo_documento = 'factura_venta'
              AND ab.documento_id = fv.id
              AND ab.deleted_at IS NULL
          ), 0), 0))
          FROM facturas_venta fv
          WHERE fv.deleted_at IS NULL
        ), 0) AS cxc_pendiente,
        COALESCE((
          SELECT SUM(GREATEST(fc.total - COALESCE((
            SELECT SUM(ab.monto)
            FROM abonos ab
            WHERE ab.tipo_documento = 'factura_compra'
              AND ab.documento_id = fc.id
              AND ab.deleted_at IS NULL
          ), 0), 0))
          FROM facturas_compra fc
          WHERE fc.deleted_at IS NULL
        ), 0) AS cxp_pendiente
    `),
  ])
  return {
    success: true,
    data: {
      topProductos: topProductos.rows,
      topClientes: topClientes.rows,
      ocPendientes: ocPendientes.rows[0]?.total ?? 0,
      pedidosSinDespacho: sinDespacho.rows[0]?.total ?? 0,
      saldoCuentas: Number(saldoCuentas.rows[0]?.total ?? 0),
      cxcPendiente: Number((cxcCxp.rows[0] as { cxc_pendiente: string })?.cxc_pendiente ?? 0),
      cxpPendiente: Number((cxcCxp.rows[0] as { cxp_pendiente: string })?.cxp_pendiente ?? 0),
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// NOTAS / CALENDARIO
// ════════════════════════════════════════════════════════════════════════════

interface CrearEventoArgs {
  titulo: string
  tipo?: string
  fecha: string
  descripcion?: string
}

async function crearNota(args: { titulo: string; contenido?: string }, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query<{ id: string; titulo: string }>(
    `INSERT INTO notas_internas (titulo, contenido)
     VALUES ($1, $2)
     RETURNING id, titulo`,
    [args.titulo, args.contenido ?? null],
  )
  return { success: true, data: rows[0] }
}

async function crearEventoCalendario(args: CrearEventoArgs, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO eventos_calendario (titulo, tipo, fecha, descripcion)
     VALUES ($1, $2, $3::date, $4)
     RETURNING id`,
    [args.titulo, args.tipo ?? 'recordatorio', args.fecha, args.descripcion ?? null],
  )
  return { success: true, data: { id: rows[0]!.id, titulo: args.titulo, fecha: args.fecha } }
}

// ════════════════════════════════════════════════════════════════════════════
// INSTAGRAM
// ════════════════════════════════════════════════════════════════════════════

async function consultarPostsIg(
  limite: number,
  tipo: string | null,
  db: PoolClient,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(1, limite), 20)
  const tipoNormalizado = tipo ? tipo.toLowerCase() : null
  const { rows } = await db.query(
    `SELECT
       tipo,
       caption,
       likes,
       comentarios,
       reproducciones AS vistas,
       TO_CHAR(publicado_en, 'YYYY-MM-DD') AS fecha,
       hashtags,
       url
     FROM ig_posts
     WHERE ($1::text IS NULL OR tipo = $1)
     ORDER BY publicado_en DESC
     LIMIT $2`,
    [tipoNormalizado, limit],
  )
  return { success: true, data: rows }
}

async function consultarMetricasIg(db: PoolClient): Promise<ToolResult> {
  const [cuenta, hashtags, heatmap, resumen] = await Promise.all([
    db.query(`
      SELECT
        c.handle,
        s.seguidores,
        s.seguidos,
        s.posts_total AS publicaciones,
        ROUND(
          COALESCE(
            (SELECT AVG((p.likes + p.comentarios)::float / NULLIF(s.seguidores, 0) * 100)
             FROM ig_posts p
             WHERE p.cuenta_id = c.id
               AND p.publicado_en >= NOW() - INTERVAL '30 days'),
            0
          )::numeric, 2
        ) AS engagement_rate
      FROM ig_cuentas c
      LEFT JOIN ig_cuenta_snapshots s ON s.cuenta_id = c.id
        AND s.fecha = (SELECT MAX(fecha) FROM ig_cuenta_snapshots WHERE cuenta_id = c.id)
      ORDER BY c.created_at LIMIT 1
    `),
    db.query(`
      SELECT hashtag, ROUND(AVG(likes + comentarios)) AS eng_promedio
      FROM (
        SELECT UNNEST(hashtags) AS hashtag, likes, comentarios
        FROM ig_posts WHERE publicado_en >= NOW() - INTERVAL '30 days'
      ) t
      GROUP BY hashtag ORDER BY eng_promedio DESC LIMIT 8
    `),
    db.query(`
      SELECT
        EXTRACT(DOW FROM publicado_en)::int AS dia,
        EXTRACT(HOUR FROM publicado_en)::int AS hora,
        ROUND(AVG(likes + comentarios)) AS eng
      FROM ig_posts
      GROUP BY 1,2 ORDER BY eng DESC LIMIT 3
    `),
    db.query(`
      SELECT
        COUNT(*) AS total_posts,
        ROUND(AVG(likes)) AS avg_likes,
        ROUND(AVG(comentarios)) AS avg_comentarios,
        ROUND(AVG(reproducciones)) AS avg_vistas,
        MAX(likes) AS mejor_post_likes
      FROM ig_posts
      WHERE publicado_en >= NOW() - INTERVAL '30 days'
    `),
  ])

  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const mejoresHoras = heatmap.rows.map((r) => ({
    dia: dias[r.dia as number] ?? 'día',
    hora: `${r.hora}:00`,
    engagement: r.eng,
  }))

  return {
    success: true,
    data: {
      cuenta: cuenta.rows[0] ?? null,
      mejoresHashtags: hashtags.rows,
      mejoresHorasPublicacion: mejoresHoras,
      resumen30d: resumen.rows[0] ?? null,
    },
  }
}

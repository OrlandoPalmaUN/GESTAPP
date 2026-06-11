/**
 * Ejecuta las tool calls del LLM contra la base de datos del tenant.
 * Cada función recibe el cliente PG con search_path ya configurado.
 */
import type { PoolClient } from 'pg'

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
      case 'buscar_producto':
        return await buscarProducto(args.query as string, db)
      case 'buscar_cliente':
        return await buscarCliente(args.nombre as string, db)
      case 'buscar_proveedor':
        return await buscarProveedor(args.nombre as string, db)
      case 'crear_cliente':
        return await crearCliente(args as { nombre: string; email?: string; telefono?: string }, db)
      case 'crear_proveedor':
        return await crearProveedor(args as { nombre: string; email?: string; telefono?: string; nit?: string }, db)
      case 'crear_pedido':
        return await crearPedido(args as unknown as CrearPedidoArgs, db)
      case 'consultar_resumen_negocio':
        return await consultarResumenNegocio(db)
      case 'consultar_posts_ig':
        return await consultarPostsIg(
          (args.limite as number | undefined) ?? 10,
          (args.tipo as string | undefined) ?? null,
          db,
        )
      case 'consultar_metricas_ig':
        return await consultarMetricasIg(db)
      case 'crear_producto':
        return await crearProducto(args as unknown as CrearProductoArgs, db)
      case 'ajustar_stock':
        return await ajustarStock(args as unknown as AjustarStockArgs, db)
      case 'registrar_abono':
        return await registrarAbono(args as unknown as RegistrarAbonoArgs, db)
      case 'crear_nota':
        return await crearNota(args as unknown as { titulo: string; contenido?: string }, db)
      case 'actualizar_estado_pedido':
        return await actualizarEstadoPedido(args as unknown as ActualizarEstadoArgs, db)
      case 'ver_historial_cliente':
        return await verHistorialCliente(args.cliente_id as string, db)
      default:
        return { success: false, error: `Herramienta desconocida: ${name}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Implementaciones ────────────────────────────────────────────────────────

// SQL helper: stock real calculado de movimientos_inventario
const STOCK_SUBQUERY = `
  COALESCE((
    SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                    THEN cantidad ELSE -cantidad END)
    FROM movimientos_inventario WHERE producto_id = p.id
  ), 0)`

async function buscarProducto(query: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT p.id, p.nombre, p.precio_venta AS precio, ${STOCK_SUBQUERY} AS stock, p.unidad
     FROM productos p
     WHERE (p.nombre ILIKE $1 OR p.descripcion ILIKE $1) AND p.deleted_at IS NULL
     LIMIT 5`,
    [`%${query}%`],
  )
  return { success: true, data: rows }
}

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

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

interface RegistrarAbonoArgs {
  cliente_id: string
  cliente_nombre: string
  monto: number
  medio_pago?: string
  referencia?: string
}

interface ActualizarEstadoArgs {
  pedido_id: string
  nuevo_estado: string
  notas?: string
}

async function buscarProveedor(nombre: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT id, nombre, email, telefono, nit
     FROM proveedores
     WHERE nombre ILIKE $1
     LIMIT 5`,
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

async function buscarCliente(nombre: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT id, nombre, email, telefono
     FROM clientes
     WHERE nombre ILIKE $1
     LIMIT 5`,
    [`%${nombre}%`],
  )
  return { success: true, data: rows }
}

async function crearCliente(
  args: { nombre: string; email?: string; telefono?: string },
  db: PoolClient,
): Promise<ToolResult> {
  const { rows } = await db.query<{ id: string; nombre: string }>(
    `INSERT INTO clientes (nombre, email, telefono)
     VALUES ($1, $2, $3)
     RETURNING id, nombre`,
    [args.nombre, args.email ?? null, args.telefono ?? null],
  )
  return { success: true, data: rows[0] }
}

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

async function crearPedido(args: CrearPedidoArgs, db: PoolClient): Promise<ToolResult> {
  // Obtener precios reales si no vienen en los args
  const itemsConPrecio = await Promise.all(
    args.items.map(async (item) => {
      if (item.precio_unitario) return item
      const { rows } = await db.query(
        `SELECT precio_venta FROM productos WHERE id = $1`,
        [item.producto_id],
      )
      return { ...item, precio_unitario: rows[0]?.precio_venta ?? 0 }
    }),
  )

  const total = itemsConPrecio.reduce(
    (sum, i) => sum + i.cantidad * (i.precio_unitario ?? 0),
    0,
  )

  // Generar número de pedido PED-YYYY-XXXX
  const anio = new Date().getFullYear()
  const { rows: cntRows } = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM pedidos WHERE numero LIKE $1`,
    [`PED-${anio}-%`],
  )
  const consecutivo = Number(cntRows[0]?.total ?? '0') + 1
  const numero = `PED-${anio}-${String(consecutivo).padStart(4, '0')}`

  // Crear pedido
  const { rows: pedidoRows } = await db.query<{ id: string }>(
    `INSERT INTO pedidos (numero, cliente_id, total, estado, notas)
     VALUES ($1, $2, $3, 'pendiente', $4)
     RETURNING id`,
    [numero, args.cliente_id, total, args.notas ?? null],
  )
  const pedidoId = pedidoRows[0]!.id

  // Insertar items (subtotal es columna GENERATED, no se inserta)
  for (const item of itemsConPrecio) {
    await db.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)`,
      [pedidoId, item.producto_id, item.cantidad, item.precio_unitario ?? 0],
    )
  }

  return {
    success: true,
    data: {
      pedidoId,
      numero,
      clienteNombre: args.cliente_nombre,
      items: itemsConPrecio.length,
      total,
    },
  }
}

async function consultarPostsIg(
  limite: number,
  tipo: string | null,
  db: PoolClient,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(1, limite), 20)
  const { rows } = await db.query(
    `SELECT
       tipo_contenido AS tipo,
       caption,
       likes,
       comentarios,
       reproducciones AS vistas,
       TO_CHAR(publicado_en, 'YYYY-MM-DD') AS fecha,
       hashtags,
       url
     FROM ig_posts
     WHERE ($1::text IS NULL OR tipo_contenido = $1)
     ORDER BY publicado_en DESC
     LIMIT $2`,
    [tipo, limit],
  )
  return { success: true, data: rows }
}

async function consultarMetricasIg(db: PoolClient): Promise<ToolResult> {
  const [cuenta, hashtags, heatmap, resumen] = await Promise.all([
    db.query(`
      SELECT c.handle, s.seguidores, s.seguidos, s.publicaciones,
             s.er_promedio AS engagement_rate
      FROM ig_cuentas c
      LEFT JOIN ig_cuenta_snapshots s ON s.cuenta_id = c.id
      ORDER BY s.fecha DESC LIMIT 1
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

  const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  const mejoresHoras = heatmap.rows.map(r => ({
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

async function crearProducto(args: CrearProductoArgs, db: PoolClient): Promise<ToolResult> {
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
  if (args.stock_inicial && args.stock_inicial > 0) {
    await db.query(
      `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, notas)
       VALUES ($1, 'ajuste_positivo', $2, 'Inventario inicial')`,
      [producto.id, args.stock_inicial],
    )
  }
  return { success: true, data: { ...producto, stock: args.stock_inicial ?? 0 } }
}

async function ajustarStock(args: AjustarStockArgs, db: PoolClient): Promise<ToolResult> {
  await db.query(
    `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, notas)
     VALUES ($1, $2, $3, $4)`,
    [args.producto_id, args.tipo, args.cantidad, args.notas ?? `Ajuste manual`],
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
      stockResultante: rows[0]?.stock ?? 0,
    },
  }
}

async function registrarAbono(args: RegistrarAbonoArgs, db: PoolClient): Promise<ToolResult> {
  // Buscar la factura con saldo pendiente más antigua del cliente
  const { rows: facturas } = await db.query<{ id: string; total: string; numero: string }>(
    `SELECT fv.id, fv.total, fv.numero
     FROM facturas_venta fv
     WHERE fv.cliente_id = $1
       AND fv.total > COALESCE((
         SELECT SUM(a.monto) FROM abonos a
         WHERE a.tipo_documento = 'factura_venta' AND a.documento_id = fv.id
       ), 0)
     ORDER BY fv.created_at ASC
     LIMIT 1`,
    [args.cliente_id],
  )
  if (!facturas.length) {
    return { success: false, error: `${args.cliente_nombre} no tiene facturas con saldo pendiente.` }
  }
  const factura = facturas[0]!
  await db.query(
    `INSERT INTO abonos (tipo_documento, documento_id, monto, medio_pago, referencia)
     VALUES ('factura_venta', $1, $2, $3, $4)`,
    [factura.id, args.monto, args.medio_pago ?? 'efectivo', args.referencia ?? null],
  )
  return {
    success: true,
    data: {
      cliente: args.cliente_nombre,
      factura: factura.numero,
      abono: args.monto,
      medioPago: args.medio_pago ?? 'efectivo',
    },
  }
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

async function actualizarEstadoPedido(args: ActualizarEstadoArgs, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query<{ id: string; numero: string; estado: string }>(
    `UPDATE pedidos
     SET estado = $1, notas = COALESCE($2, notas), updated_at = NOW()
     WHERE id = $3
     RETURNING id, numero, estado`,
    [args.nuevo_estado, args.notas ?? null, args.pedido_id],
  )
  if (!rows.length) return { success: false, error: 'Pedido no encontrado.' }
  return { success: true, data: rows[0] }
}

async function verHistorialCliente(clienteId: string, db: PoolClient): Promise<ToolResult> {
  const [info, pedidos, saldo] = await Promise.all([
    db.query(
      `SELECT nombre, email, telefono FROM clientes WHERE id = $1`,
      [clienteId],
    ),
    db.query(
      `SELECT numero, estado, total, created_at::date AS fecha
       FROM pedidos WHERE cliente_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [clienteId],
    ),
    db.query(
      `SELECT COALESCE(SUM(fv.total),0) - COALESCE(SUM(ab.monto),0) AS saldo_pendiente
       FROM facturas_venta fv
       LEFT JOIN abonos ab ON ab.tipo_documento = 'factura_venta' AND ab.documento_id = fv.id
       WHERE fv.cliente_id = $1`,
      [clienteId],
    ),
  ])
  return {
    success: true,
    data: {
      cliente: info.rows[0] ?? null,
      pedidos: pedidos.rows,
      saldoPendiente: saldo.rows[0]?.saldo_pendiente ?? 0,
    },
  }
}

async function consultarResumenNegocio(db: PoolClient): Promise<ToolResult> {
  const [ventas, stockBajo, pedidosPendientes] = await Promise.all([
    db.query(`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(total),0)::numeric AS monto
      FROM pedidos
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND estado NOT IN ('cancelado')
    `),
    db.query(`
      SELECT p.nombre,
             ${STOCK_SUBQUERY} AS stock_actual,
             p.stock_minimo
      FROM productos p
      WHERE p.stock_minimo IS NOT NULL
        AND p.deleted_at IS NULL
        AND ${STOCK_SUBQUERY} <= p.stock_minimo
      LIMIT 5
    `),
    db.query(`
      SELECT COUNT(*)::int AS total FROM pedidos WHERE estado = 'pendiente'
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

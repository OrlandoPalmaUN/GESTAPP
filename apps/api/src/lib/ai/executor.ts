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
      case 'crear_cliente':
        return await crearCliente(args as { nombre: string; email?: string; telefono?: string }, db)
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
      default:
        return { success: false, error: `Herramienta desconocida: ${name}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Implementaciones ────────────────────────────────────────────────────────

async function buscarProducto(query: string, db: PoolClient): Promise<ToolResult> {
  const { rows } = await db.query(
    `SELECT id, nombre, precio_venta AS precio, stock_actual AS stock, unidad
     FROM productos
     WHERE nombre ILIKE $1 OR descripcion ILIKE $1
     LIMIT 5`,
    [`%${query}%`],
  )
  return { success: true, data: rows }
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

async function consultarResumenNegocio(db: PoolClient): Promise<ToolResult> {
  const [ventas, stockBajo, pedidosPendientes] = await Promise.all([
    db.query(`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(total),0)::numeric AS monto
      FROM pedidos
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND estado NOT IN ('cancelado')
    `),
    db.query(`
      SELECT nombre, stock_actual, stock_minimo
      FROM productos
      WHERE stock_minimo IS NOT NULL AND stock_actual <= stock_minimo
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

import type { PoolClient } from 'pg'

import type { BusinessContext } from './prompts.js'

/** Lo mínimo que se necesita del logger de Fastify — evita acoplar esto a la instancia. */
interface LoggerMinimo {
  warn: (obj: unknown, msg?: string) => void
}

/**
 * Carga del schema del tenant los datos con los que `buildSystemPrompt`
 * enriquece el system prompt: top de productos, stock crítico, ventas del mes,
 * pedidos pendientes, clientes recientes, facturas vencidas y saldos.
 *
 * Vivía dentro de `POST /ai/chat`. Se extrajo cuando el canal de WhatsApp pasó
 * a necesitar exactamente el mismo contexto: son ~80 líneas de SQL con las
 * reglas de cómo se calcula el stock a partir de `movimientos_inventario` y
 * cómo se mide una factura vencida contra sus abonos. Duplicarlas habría
 * garantizado que las dos copias se desincronizaran — y que el agente
 * contestara distinto según el canal por el que le preguntaran.
 *
 * Nunca lanza: si el negocio todavía no tiene datos, o una query falla, el
 * agente igual tiene que poder contestar. Devuelve el contexto que haya.
 */
export async function cargarContextoNegocio(
  db: PoolClient,
  tenantName: string,
  context: string,
  log?: LoggerMinimo,
): Promise<BusinessContext> {
  const biz: BusinessContext = { tenantName, context }
  try {
    const [productos, stockCrit, ventas, pendientes, clientes, vencidas, saldos] = await Promise.all([
      db.query<{ nombre: string; precio: number; stock: number }>(
        `SELECT p.nombre, p.precio_venta::numeric AS precio,
                COALESCE((SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva') THEN cantidad ELSE -cantidad END) FROM movimientos_inventario WHERE producto_id = p.id),0) AS stock
         FROM productos p WHERE p.deleted_at IS NULL ORDER BY stock DESC LIMIT 5`,
      ),
      db.query<{ nombre: string; stock: number; minimo: number }>(
        `SELECT p.nombre,
                COALESCE((SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva') THEN cantidad ELSE -cantidad END) FROM movimientos_inventario WHERE producto_id = p.id),0) AS stock,
                p.stock_minimo AS minimo
         FROM productos p
         WHERE p.stock_minimo > 0 AND p.deleted_at IS NULL
           AND COALESCE((SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva') THEN cantidad ELSE -cantidad END) FROM movimientos_inventario WHERE producto_id = p.id),0) <= p.stock_minimo
         LIMIT 5`,
      ),
      db.query<{ total: number; pedidos: number }>(
        `SELECT COALESCE(SUM(total),0)::int AS total, COUNT(*)::int AS pedidos
         FROM pedidos
         WHERE created_at >= date_trunc('month', NOW())
           AND estado != 'cancelado'
           AND deleted_at IS NULL`,
      ),
      db.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM pedidos
         WHERE estado IN ('borrador','confirmado','en_preparacion') AND deleted_at IS NULL`,
      ),
      db.query<{ nombre: string }>(
        `SELECT nombre FROM clientes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`,
      ),
      // Facturas vencidas (CxC y CxP con saldo > 0 y fecha_vencimiento pasada)
      db.query<{ total: number }>(`
        SELECT (
          (SELECT COUNT(*) FROM facturas_venta fv
           WHERE fv.deleted_at IS NULL
             AND fv.fecha_vencimiento < CURRENT_DATE
             AND fv.total > COALESCE((SELECT SUM(monto) FROM abonos
                                      WHERE tipo_documento = 'factura_venta'
                                        AND documento_id = fv.id AND deleted_at IS NULL), 0))
          +
          (SELECT COUNT(*) FROM facturas_compra fc
           WHERE fc.deleted_at IS NULL
             AND fc.fecha_vencimiento < CURRENT_DATE
             AND fc.total > COALESCE((SELECT SUM(monto) FROM abonos
                                      WHERE tipo_documento = 'factura_compra'
                                        AND documento_id = fc.id AND deleted_at IS NULL), 0))
        )::int AS total
      `),
      db.query<{ saldo: number }>(`
        SELECT COALESCE(SUM(saldo), 0)::numeric AS saldo
        FROM cuentas_bancarias WHERE deleted_at IS NULL
      `),
    ])

    biz.topProductos    = productos.rows
    biz.stockCritico    = stockCrit.rows
    biz.ventasMes       = ventas.rows[0]
    biz.pedidosPendientes = pendientes.rows[0]?.total ?? 0
    biz.topClientes     = clientes.rows
    biz.facturasVencidas = vencidas.rows[0]?.total ?? 0
    biz.saldoCuentas    = Number(saldos.rows[0]?.saldo ?? 0)

    // Datos de IG solo en contexto redes
    if (context === 'redes') {
      const [igCuenta, igHashtags, igHeatmap] = await Promise.all([
        db.query<{ handle: string; seguidores: number }>(
          `SELECT c.handle, s.seguidores
           FROM ig_cuentas c
           LEFT JOIN ig_cuenta_snapshots s ON s.cuenta_id = c.id
           ORDER BY c.created_at ASC, s.fecha DESC LIMIT 1`,
        ),
        db.query<{ hashtag: string }>(
          `SELECT hashtag FROM (
             SELECT UNNEST(hashtags) AS hashtag, AVG(likes + comentarios) AS eng
             FROM ig_posts WHERE publicado_en >= NOW() - INTERVAL '30 days'
             GROUP BY hashtag ORDER BY eng DESC LIMIT 6
           ) t`,
        ),
        db.query<{ dia: number; hora: number; eng: number }>(
          `SELECT EXTRACT(DOW FROM publicado_en)::int AS dia,
                  EXTRACT(HOUR FROM publicado_en)::int AS hora,
                  AVG(likes + comentarios) AS eng
           FROM ig_posts GROUP BY 1,2 ORDER BY eng DESC LIMIT 1`,
        ),
      ])

      biz.igHandle      = igCuenta.rows[0]?.handle ?? null
      biz.igSeguidores  = igCuenta.rows[0]?.seguidores ?? null
      biz.igTopHashtags = igHashtags.rows.map(r => r.hashtag)

      const mejor = igHeatmap.rows[0]
      if (mejor) {
        const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
        biz.igMejorHora = `${dias[mejor.dia] ?? 'día'} a las ${mejor.hora}:00`
      }
    }
  } catch (err) {
    log?.warn({ err }, 'ai: no se pudo cargar contexto del negocio')
    // No bloqueamos — el chat funciona con datos vacíos
  }

  return biz
}

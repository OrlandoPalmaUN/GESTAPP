/**
 * Endpoints cross-módulo para dashboard global y búsqueda unificada.
 *
 * - GET /dashboard/kpis      → KPIs de ventas, compras, finanzas, inventario.
 * - GET /buscar?q=texto      → busca clientes, productos, pedidos, facturas
 *                              en paralelo y devuelve resultados con su tipo.
 *
 * El frontend usa `tipo` para construir el link correcto al elemento.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

function exigirTenant(request: FastifyRequest, reply: FastifyReply): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest('Esta operación requiere una empresa asociada a tu usuario.')
    return false
  }
  return true
}

const STOCK_SUBQUERY = `
  COALESCE((
    SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                    THEN cantidad ELSE -cantidad END)
    FROM movimientos_inventario WHERE producto_id = p.id
  ), 0)`

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /dashboard/kpis
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { dias?: string } }>(
    '/dashboard/kpis',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const diasNum = Math.min(Math.max(Number(request.query.dias ?? 30), 1), 365)

      const [
        ventas,
        topProductos,
        topClientes,
        ocPendientes,
        pedidosSinDespacho,
        stockBajoCount,
        cuentasSaldo,
        cxcPendiente,
        cxpPendiente,
        cxcVencidas,
        cxpVencidas,
      ] = await Promise.all([
        // Ventas del período: monto y cantidad
        request.tenantDb.query<{ total: string; cantidad: number }>(`
          SELECT COALESCE(SUM(total), 0)::numeric AS total, COUNT(*)::int AS cantidad
          FROM pedidos
          WHERE created_at >= NOW() - ($1::int || ' days')::interval
            AND estado != 'cancelado'
            AND deleted_at IS NULL
        `, [diasNum]),
        // Top 5 productos por ingresos
        request.tenantDb.query(`
          SELECT pr.id, pr.nombre,
                 SUM(pi.cantidad)::int AS unidades,
                 SUM(pi.subtotal)::numeric AS ingresos
          FROM pedido_items pi
          JOIN pedidos p ON p.id = pi.pedido_id
          JOIN productos pr ON pr.id = pi.producto_id
          WHERE p.estado IN ('confirmado','en_preparacion','despachado','entregado')
            AND p.deleted_at IS NULL
            AND p.created_at >= NOW() - ($1::int || ' days')::interval
          GROUP BY pr.id, pr.nombre
          ORDER BY ingresos DESC LIMIT 5
        `, [diasNum]),
        // Top 5 clientes por monto
        request.tenantDb.query(`
          SELECT c.id, c.nombre,
                 COUNT(p.id)::int AS pedidos,
                 COALESCE(SUM(p.total), 0)::numeric AS monto
          FROM clientes c
          JOIN pedidos p ON p.cliente_id = c.id
          WHERE p.estado != 'cancelado'
            AND p.deleted_at IS NULL
            AND c.deleted_at IS NULL
            AND p.created_at >= NOW() - ($1::int || ' days')::interval
          GROUP BY c.id, c.nombre
          ORDER BY monto DESC LIMIT 5
        `, [diasNum]),
        // OCs pendientes (no recibidas)
        request.tenantDb.query<{ total: number }>(`
          SELECT COUNT(*)::int AS total FROM pedidos_proveedor
          WHERE estado IN ('borrador','enviado','recibido_parcial') AND deleted_at IS NULL
        `),
        // Pedidos confirmados sin despachar
        request.tenantDb.query<{ total: number }>(`
          SELECT COUNT(*)::int AS total FROM pedidos
          WHERE estado IN ('confirmado','en_preparacion') AND deleted_at IS NULL
        `),
        // Stock bajo
        request.tenantDb.query<{ total: number }>(`
          SELECT COUNT(*)::int AS total
          FROM productos p
          WHERE p.deleted_at IS NULL AND p.activo = TRUE AND p.stock_minimo > 0
            AND ${STOCK_SUBQUERY} <= p.stock_minimo
        `),
        // Saldo total en cuentas activas
        request.tenantDb.query<{ saldo: string }>(`
          SELECT COALESCE(SUM(saldo), 0)::numeric AS saldo
          FROM cuentas_bancarias WHERE deleted_at IS NULL AND activa = TRUE
        `),
        // CxC pendiente
        request.tenantDb.query<{ pendiente: string }>(`
          SELECT COALESCE(SUM(
            fv.total - COALESCE((SELECT SUM(monto) FROM abonos
              WHERE tipo_documento = 'factura_venta'
                AND documento_id = fv.id AND deleted_at IS NULL), 0)
          ), 0)::numeric AS pendiente
          FROM facturas_venta fv WHERE fv.deleted_at IS NULL
        `),
        // CxP pendiente
        request.tenantDb.query<{ pendiente: string }>(`
          SELECT COALESCE(SUM(
            fc.total - COALESCE((SELECT SUM(monto) FROM abonos
              WHERE tipo_documento = 'factura_compra'
                AND documento_id = fc.id AND deleted_at IS NULL), 0)
          ), 0)::numeric AS pendiente
          FROM facturas_compra fc WHERE fc.deleted_at IS NULL
        `),
        // CxC vencidas (count + monto)
        request.tenantDb.query<{ cantidad: number; monto: string }>(`
          SELECT
            COUNT(*)::int AS cantidad,
            COALESCE(SUM(
              fv.total - COALESCE((SELECT SUM(monto) FROM abonos
                WHERE tipo_documento = 'factura_venta'
                  AND documento_id = fv.id AND deleted_at IS NULL), 0)
            ), 0)::numeric AS monto
          FROM facturas_venta fv
          WHERE fv.deleted_at IS NULL
            AND fv.fecha_vencimiento < CURRENT_DATE
            AND fv.total > COALESCE((SELECT SUM(monto) FROM abonos
                WHERE tipo_documento = 'factura_venta'
                  AND documento_id = fv.id AND deleted_at IS NULL), 0)
        `),
        // CxP vencidas (count + monto)
        request.tenantDb.query<{ cantidad: number; monto: string }>(`
          SELECT
            COUNT(*)::int AS cantidad,
            COALESCE(SUM(
              fc.total - COALESCE((SELECT SUM(monto) FROM abonos
                WHERE tipo_documento = 'factura_compra'
                  AND documento_id = fc.id AND deleted_at IS NULL), 0)
            ), 0)::numeric AS monto
          FROM facturas_compra fc
          WHERE fc.deleted_at IS NULL
            AND fc.fecha_vencimiento < CURRENT_DATE
            AND fc.total > COALESCE((SELECT SUM(monto) FROM abonos
                WHERE tipo_documento = 'factura_compra'
                  AND documento_id = fc.id AND deleted_at IS NULL), 0)
        `),
      ])

      return reply.send({
        ventanaDias: diasNum,
        ventas: {
          monto: Number(ventas.rows[0]?.total ?? 0),
          cantidad: ventas.rows[0]?.cantidad ?? 0,
        },
        topProductos: topProductos.rows,
        topClientes: topClientes.rows,
        alertas: {
          ocPendientes: ocPendientes.rows[0]?.total ?? 0,
          pedidosSinDespacho: pedidosSinDespacho.rows[0]?.total ?? 0,
          stockBajo: stockBajoCount.rows[0]?.total ?? 0,
          facturasVencidasCxc: cxcVencidas.rows[0]?.cantidad ?? 0,
          facturasVencidasCxp: cxpVencidas.rows[0]?.cantidad ?? 0,
        },
        finanzas: {
          saldoCuentas: Number(cuentasSaldo.rows[0]?.saldo ?? 0),
          cxcPendiente: Number(cxcPendiente.rows[0]?.pendiente ?? 0),
          cxpPendiente: Number(cxpPendiente.rows[0]?.pendiente ?? 0),
          montoVencidoCxc: Number(cxcVencidas.rows[0]?.monto ?? 0),
          montoVencidoCxp: Number(cxpVencidas.rows[0]?.monto ?? 0),
        },
      })
    },
  )

  // ─────────────────────────────────────────────────────────────────────────
  // GET /buscar?q=...
  // Búsqueda global cross-módulo. Devuelve resultados con su tipo y un id
  // para que el frontend pueda navegar al detalle.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { q?: string } }>(
    '/buscar',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const q = (request.query.q ?? '').trim()
      if (q.length < 2) {
        return reply.send({ resultados: [], total: 0 })
      }
      const pat = `%${q}%`

      const [clientes, productos, proveedores, pedidos, ocs, facturasVenta, facturasCompra] = await Promise.all([
        request.tenantDb.query<{ id: string; nombre: string; nit: string | null; telefono: string | null }>(
          `SELECT id, nombre, nit, telefono FROM clientes
           WHERE deleted_at IS NULL
             AND (nombre ILIKE $1 OR nit ILIKE $1 OR email ILIKE $1 OR telefono ILIKE $1)
           ORDER BY nombre LIMIT 10`,
          [pat],
        ),
        request.tenantDb.query<{ id: string; nombre: string; sku: string | null; stock: string }>(
          `SELECT p.id, p.nombre, p.sku, ${STOCK_SUBQUERY}::text AS stock
           FROM productos p
           WHERE p.deleted_at IS NULL
             AND (p.nombre ILIKE $1 OR p.sku ILIKE $1 OR p.descripcion ILIKE $1)
           ORDER BY p.nombre LIMIT 10`,
          [pat],
        ),
        request.tenantDb.query<{ id: string; nombre: string; nit: string | null }>(
          `SELECT id, nombre, nit FROM proveedores
           WHERE deleted_at IS NULL
             AND (nombre ILIKE $1 OR nit ILIKE $1 OR email ILIKE $1)
           ORDER BY nombre LIMIT 10`,
          [pat],
        ),
        request.tenantDb.query<{ id: string; numero: string; estado: string; total: string; cliente: string | null }>(
          `SELECT p.id, p.numero, p.estado, p.total::text AS total, c.nombre AS cliente
           FROM pedidos p
           LEFT JOIN clientes c ON c.id = p.cliente_id
           WHERE p.deleted_at IS NULL
             AND (p.numero ILIKE $1 OR c.nombre ILIKE $1)
           ORDER BY p.created_at DESC LIMIT 10`,
          [pat],
        ),
        request.tenantDb.query<{ id: string; numero: string; estado: string; total: string; proveedor: string | null }>(
          `SELECT pp.id, pp.numero, pp.estado, pp.total::text AS total, p.nombre AS proveedor
           FROM pedidos_proveedor pp
           LEFT JOIN proveedores p ON p.id = pp.proveedor_id
           WHERE pp.deleted_at IS NULL
             AND (pp.numero ILIKE $1 OR p.nombre ILIKE $1)
           ORDER BY pp.created_at DESC LIMIT 10`,
          [pat],
        ),
        request.tenantDb.query<{ id: string; numero: string; total: string; cliente: string | null }>(
          `SELECT fv.id, fv.numero, fv.total::text AS total, c.nombre AS cliente
           FROM facturas_venta fv
           LEFT JOIN clientes c ON c.id = fv.cliente_id
           WHERE fv.deleted_at IS NULL
             AND (fv.numero ILIKE $1 OR c.nombre ILIKE $1)
           ORDER BY fv.created_at DESC LIMIT 10`,
          [pat],
        ),
        request.tenantDb.query<{ id: string; numero: string; total: string; proveedor: string | null }>(
          `SELECT fc.id, fc.numero, fc.total::text AS total, p.nombre AS proveedor
           FROM facturas_compra fc
           LEFT JOIN proveedores p ON p.id = fc.proveedor_id
           WHERE fc.deleted_at IS NULL
             AND (fc.numero ILIKE $1 OR p.nombre ILIKE $1)
           ORDER BY fc.created_at DESC LIMIT 10`,
          [pat],
        ),
      ])

      const resultados = [
        ...clientes.rows.map((r) => ({
          tipo: 'cliente' as const,
          id: r.id,
          etiqueta: r.nombre,
          subtitulo: r.nit ? `NIT ${r.nit}` : (r.telefono ?? ''),
        })),
        ...productos.rows.map((r) => ({
          tipo: 'producto' as const,
          id: r.id,
          etiqueta: r.nombre,
          subtitulo: `${r.sku ? `SKU ${r.sku} · ` : ''}stock ${r.stock}`,
        })),
        ...proveedores.rows.map((r) => ({
          tipo: 'proveedor' as const,
          id: r.id,
          etiqueta: r.nombre,
          subtitulo: r.nit ? `NIT ${r.nit}` : '',
        })),
        ...pedidos.rows.map((r) => ({
          tipo: 'pedido' as const,
          id: r.id,
          etiqueta: `${r.numero} · ${r.cliente ?? 'sin cliente'}`,
          subtitulo: `${r.estado} · $${Number(r.total).toLocaleString('es-CO')}`,
        })),
        ...ocs.rows.map((r) => ({
          tipo: 'compra' as const,
          id: r.id,
          etiqueta: `${r.numero} · ${r.proveedor ?? 'sin proveedor'}`,
          subtitulo: `${r.estado} · $${Number(r.total).toLocaleString('es-CO')}`,
        })),
        ...facturasVenta.rows.map((r) => ({
          tipo: 'factura_venta' as const,
          id: r.id,
          etiqueta: `${r.numero} · ${r.cliente ?? 'sin cliente'}`,
          subtitulo: `CxC · $${Number(r.total).toLocaleString('es-CO')}`,
        })),
        ...facturasCompra.rows.map((r) => ({
          tipo: 'factura_compra' as const,
          id: r.id,
          etiqueta: `${r.numero} · ${r.proveedor ?? 'sin proveedor'}`,
          subtitulo: `CxP · $${Number(r.total).toLocaleString('es-CO')}`,
        })),
      ]

      return reply.send({ resultados, total: resultados.length })
    },
  )
}

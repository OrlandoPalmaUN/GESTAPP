/**
 * Módulo de Reportes — estadísticas de negocio por período (mes o semana).
 *
 * GET /reportes/periodo?tipo=mes&año=2026&mes=6
 * GET /reportes/periodo?tipo=semana&año=2026&semana=24
 *
 * GET /reportes/ia?tipo=mes&año=2026&mes=6          ← análisis con Groq
 * GET /reportes/ia?tipo=semana&año=2026&semana=24
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getGroq } from '../../lib/ai/client.js'

function exigirTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest('Esta operación requiere una empresa asociada.')
    return false
  }
  return true
}

/** Devuelve el número de semana ISO del año para una fecha dada. */
function isoWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

/** Lunes de la semana ISO N del año Y (en UTC). */
function mondayOfISOWeek(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4)) // 4 de enero siempre es semana 1
  const day4 = jan4.getUTCDay() || 7 // lunes=1…domingo=7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - day4 + 1 + (week - 1) * 7)
  return monday
}

type RangoFechas = {
  desde: string  // YYYY-MM-DD
  hasta: string  // YYYY-MM-DD  (exclusive: el primer día fuera del período)
  label: string
  desdePrev: string
  hastaPrev: string
}

function rangoMes(año: number, mes: number): RangoFechas {
  const desde = new Date(Date.UTC(año, mes - 1, 1))
  const hasta = new Date(Date.UTC(año, mes, 1))   // primer día del mes siguiente
  const desdePrev = new Date(Date.UTC(año, mes - 2, 1))
  const hastaPrev = desde

  const mesNombre = desde.toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const label = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1)

  return {
    desde: desde.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
    label,
    desdePrev: desdePrev.toISOString().slice(0, 10),
    hastaPrev: hastaPrev.toISOString().slice(0, 10),
  }
}

function rangoSemana(año: number, semana: number): RangoFechas {
  const monday = mondayOfISOWeek(año, semana)
  const nextMonday = new Date(monday)
  nextMonday.setUTCDate(monday.getUTCDate() + 7)
  const prevMonday = new Date(monday)
  prevMonday.setUTCDate(monday.getUTCDate() - 7)

  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const fmt = (d: Date) =>
    d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  const label = `Sem ${semana} · ${fmt(monday)} – ${fmt(sunday)} ${año}`

  return {
    desde: monday.toISOString().slice(0, 10),
    hasta: nextMonday.toISOString().slice(0, 10),
    label,
    desdePrev: prevMonday.toISOString().slice(0, 10),
    hastaPrev: monday.toISOString().slice(0, 10),
  }
}

function parseQuery(q: Record<string, string | string[] | undefined>): RangoFechas {
  // Rango directo — usado para semanas dentro de un mes
  if (q.desde && q.hasta) {
    const desde = String(q.desde)
    const hasta = String(q.hasta)   // exclusive (día siguiente al último)
    const label = String(q.label ?? `${desde} – ${hasta}`)
    // Período anterior: misma duración, justo antes
    const durMs = new Date(hasta).getTime() - new Date(desde).getTime()
    const desdePrev = new Date(new Date(desde).getTime() - durMs).toISOString().slice(0, 10)
    const hastaPrev = desde
    return { desde, hasta, label, desdePrev, hastaPrev }
  }

  const tipo = String(q.tipo ?? 'mes')
  const now = new Date()
  const año = parseInt(String(q.año ?? now.getFullYear()), 10)

  if (tipo === 'semana' || tipo === 'semanas') {
    const semana = parseInt(String(q.semana ?? isoWeek(now)), 10)
    return rangoSemana(año, semana)
  }

  const mes = parseInt(String(q.mes ?? (now.getMonth() + 1)), 10)
  return rangoMes(año, mes)
}

/** Retorna cuántas semanas ISO tiene un año (52 o 53). */
function semanasEnAño(año: number): number {
  // La semana 53 existe si el 28 de diciembre cae en semana 53
  return isoWeek(new Date(Date.UTC(año, 11, 28))) === 53 ? 53 : 52
}

export async function reportesRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /reportes/periodo
  // Estadísticas del período: ventas, pedidos, compras, gastos, top productos
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/reportes/periodo', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const rango = parseQuery(request.query as Record<string, string>)
    const db = request.tenantDb

    // ── Ventas (pedidos no cancelados) ────────────────────────────────────
    const ventasQ = await db.query<{
      totalPedidos: string; totalVentas: string; ticketPromedio: string;
      totalPedidosPrev: string; totalVentasPrev: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)            AS "totalPedidos",
        COALESCE(SUM(total) FILTER (WHERE created_at >= $1 AND created_at < $2), 0)  AS "totalVentas",
        COALESCE(AVG(total) FILTER (WHERE created_at >= $1 AND created_at < $2), 0)  AS "ticketPromedio",
        COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4)            AS "totalPedidosPrev",
        COALESCE(SUM(total) FILTER (WHERE created_at >= $3 AND created_at < $4), 0)  AS "totalVentasPrev"
      FROM pedidos
      WHERE estado != 'cancelado' AND deleted_at IS NULL
    `, [rango.desde, rango.hasta, rango.desdePrev, rango.hastaPrev])

    // ── Compras / OC ──────────────────────────────────────────────────────
    const comprasQ = await db.query<{
      totalOC: string; totalCompras: string; totalComprasPrev: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)                 AS "totalOC",
        COALESCE(SUM(total) FILTER (WHERE created_at >= $1 AND created_at < $2), 0)  AS "totalCompras",
        COALESCE(SUM(total) FILTER (WHERE created_at >= $3 AND created_at < $4), 0)  AS "totalComprasPrev"
      FROM pedidos_proveedor
      WHERE estado != 'cancelado' AND deleted_at IS NULL
    `, [rango.desde, rango.hasta, rango.desdePrev, rango.hastaPrev])

    // ── Gastos operativos ─────────────────────────────────────────────────
    const gastosQ = await db.query<{
      totalGastos: string; totalGastosPrev: string;
    }>(`
      SELECT
        COALESCE(SUM(monto) FILTER (WHERE fecha >= $1 AND fecha < $2), 0) AS "totalGastos",
        COALESCE(SUM(monto) FILTER (WHERE fecha >= $3 AND fecha < $4), 0) AS "totalGastosPrev"
      FROM gastos_operativos
      WHERE deleted_at IS NULL
    `, [rango.desde, rango.hasta, rango.desdePrev, rango.hastaPrev])

    // ── CxC cobrada (abonos a facturas de venta) ──────────────────────────
    const cxcQ = await db.query<{ cxcCobrada: string; cxcCobradaPrev: string }>(`
      SELECT
        COALESCE(SUM(a.monto) FILTER (WHERE a.fecha >= $1 AND a.fecha < $2), 0) AS "cxcCobrada",
        COALESCE(SUM(a.monto) FILTER (WHERE a.fecha >= $3 AND a.fecha < $4), 0) AS "cxcCobradaPrev"
      FROM abonos a
      JOIN facturas_venta fv
        ON a.tipo_documento = 'factura_venta'
       AND a.documento_id = fv.id
      WHERE a.deleted_at IS NULL AND fv.deleted_at IS NULL
    `, [rango.desde, rango.hasta, rango.desdePrev, rango.hastaPrev])

    // ── Top 5 productos ───────────────────────────────────────────────────
    const topQ = await db.query<{
      nombre: string; unidades: string; ventasTotal: string; categoria: string | null
    }>(`
      SELECT
        p.nombre,
        c.nombre AS categoria,
        SUM(pi.cantidad)  AS unidades,
        SUM(pi.subtotal)  AS "ventasTotal"
      FROM pedido_items pi
      JOIN productos p   ON pi.producto_id = p.id
      LEFT JOIN categorias c ON c.id = p.categoria_id
      JOIN pedidos pe    ON pi.pedido_id   = pe.id
      WHERE pe.created_at >= $1 AND pe.created_at < $2
        AND pe.estado != 'cancelado'
        AND pe.deleted_at IS NULL
        AND pi.producto_id IS NOT NULL
      GROUP BY p.id, p.nombre, c.nombre
      ORDER BY "ventasTotal" DESC
      LIMIT 5
    `, [rango.desde, rango.hasta])

    // ── Ingresos manuales ─────────────────────────────────────────────────
    const ingresosQ = await db.query<{ totalIngresos: string }>(`
      SELECT COALESCE(SUM(monto), 0) AS "totalIngresos"
      FROM ingresos_bancarios
      WHERE fecha >= $1 AND fecha < $2 AND deleted_at IS NULL
    `, [rango.desde, rango.hasta])

    const v = ventasQ.rows[0]!
    const c = comprasQ.rows[0]!
    const g = gastosQ.rows[0]!
    const cxc = cxcQ.rows[0]!
    const ing = ingresosQ.rows[0]!

    const totalVentas = Number(v.totalVentas)
    const totalVentasPrev = Number(v.totalVentasPrev)
    const totalCompras = Number(c.totalCompras)
    const totalComprasPrev = Number(c.totalComprasPrev)
    const totalGastos = Number(g.totalGastos)
    const totalGastosPrev = Number(g.totalGastosPrev)
    const margenBruto = totalVentas - totalCompras
    const margenBrutoPrev = totalVentasPrev - totalComprasPrev
    const utilidadNeta = margenBruto - totalGastos
    const totalPedidos = Number(v.totalPedidos)
    const totalPedidosPrev = Number(v.totalPedidosPrev)

    function delta(actual: number, prev: number): number | null {
      if (prev === 0) return null
      return Math.round(((actual - prev) / prev) * 100)
    }

    return reply.send({
      periodo: {
        label: rango.label,
        desde: rango.desde,
        hasta: rango.hasta,
      },
      ventas: {
        total: totalVentas,
        pedidos: totalPedidos,
        ticketPromedio: Number(v.ticketPromedio),
        delta: delta(totalVentas, totalVentasPrev),
        deltaPedidos: totalPedidosPrev > 0 ? totalPedidos - totalPedidosPrev : null,
      },
      compras: {
        total: totalCompras,
        oc: Number(c.totalOC),
        delta: delta(totalCompras, totalComprasPrev),
      },
      gastos: {
        total: totalGastos,
        delta: delta(totalGastos, totalGastosPrev),
      },
      ingresosManuales: Number(ing.totalIngresos),
      cxcCobrada: Number(cxc.cxcCobrada),
      margenBruto: {
        total: margenBruto,
        porcentaje: totalVentas > 0 ? Math.round((margenBruto / totalVentas) * 100) : 0,
        delta: delta(margenBruto, margenBrutoPrev),
      },
      utilidadNeta,
      topProductos: topQ.rows.map((r) => ({
        nombre: r.nombre,
        categoria: r.categoria,
        unidades: Number(r.unidades),
        ventasTotal: Number(r.ventasTotal),
      })),
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /reportes/overview?tipo=meses&año=2026
  // Resumen rápido de todos los meses o semanas del año — una sola query.
  // Usado para la vista de tarjetas en el frontend.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/reportes/overview', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const q = request.query as Record<string, string>
    const tipo = q.tipo === 'semanas' ? 'semanas' : 'meses'
    const now = new Date()
    const año = parseInt(q.año ?? String(now.getFullYear()), 10)
    const db = request.tenantDb

    if (tipo === 'meses') {
      const desdeAño = `${año}-01-01`
      const hastaAño = `${año + 1}-01-01`

      const [ventasQ, gastosQ] = await Promise.all([
        db.query<{ mes: string; pedidos: string; ventas: string }>(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM-DD') AS mes,
            COUNT(*) FILTER (WHERE estado != 'cancelado')                         AS pedidos,
            COALESCE(SUM(total) FILTER (WHERE estado != 'cancelado'), 0)          AS ventas
          FROM pedidos
          WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY DATE_TRUNC('month', created_at)
        `, [desdeAño, hastaAño]),

        db.query<{ mes: string; gastos: string }>(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', fecha), 'YYYY-MM-DD') AS mes,
            COALESCE(SUM(monto), 0) AS gastos
          FROM gastos_operativos
          WHERE fecha >= $1 AND fecha < $2 AND deleted_at IS NULL
          GROUP BY DATE_TRUNC('month', fecha)
        `, [desdeAño, hastaAño]),
      ])

      const gastosPorMes = new Map(gastosQ.rows.map((r) => [r.mes, Number(r.gastos)]))
      const ventasPorMes = new Map(ventasQ.rows.map((r) => [r.mes, r]))

      const periodos = Array.from({ length: 12 }, (_, i) => {
        const mes = i + 1
        const key = `${año}-${String(mes).padStart(2, '0')}-01`
        const v = ventasPorMes.get(key)
        const gastos = gastosPorMes.get(key) ?? 0
        const ventas = Number(v?.ventas ?? 0)
        const r = rangoMes(año, mes)
        return {
          label: r.label,
          desde: r.desde,
          hasta: r.hasta,
          mes,
          año,
          pedidos: Number(v?.pedidos ?? 0),
          ventas,
          gastos,
          gananciaAprox: ventas - gastos,
          tieneDatos: !!v,
        }
      })

      return reply.send({ tipo: 'meses', año, periodos })
    }

    // ── Semanas ───────────────────────────────────────────────────────────
    const totalSemanas = semanasEnAño(año)
    const desdeAño = mondayOfISOWeek(año, 1).toISOString().slice(0, 10)
    const hastaAño = mondayOfISOWeek(año + 1, 1).toISOString().slice(0, 10)

    const [ventasQ, gastosQ] = await Promise.all([
      db.query<{ semana: string; añoiso: string; pedidos: string; ventas: string }>(`
        SELECT
          EXTRACT(WEEK FROM created_at)::text     AS semana,
          EXTRACT(ISOYEAR FROM created_at)::text  AS añoiso,
          COUNT(*) FILTER (WHERE estado != 'cancelado')                AS pedidos,
          COALESCE(SUM(total) FILTER (WHERE estado != 'cancelado'), 0) AS ventas
        FROM pedidos
        WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL
        GROUP BY EXTRACT(WEEK FROM created_at), EXTRACT(ISOYEAR FROM created_at)
      `, [desdeAño, hastaAño]),

      db.query<{ semana: string; añoiso: string; gastos: string }>(`
        SELECT
          EXTRACT(WEEK FROM fecha)::text     AS semana,
          EXTRACT(ISOYEAR FROM fecha)::text  AS añoiso,
          COALESCE(SUM(monto), 0)            AS gastos
        FROM gastos_operativos
        WHERE fecha >= $1 AND fecha < $2 AND deleted_at IS NULL
        GROUP BY EXTRACT(WEEK FROM fecha), EXTRACT(ISOYEAR FROM fecha)
      `, [desdeAño, hastaAño]),
    ])

    const ventasMap = new Map(ventasQ.rows.map((r) => [`${r.añoiso}-${r.semana}`, r]))
    const gastosMap = new Map(gastosQ.rows.map((r) => [`${r.añoiso}-${r.semana}`, Number(r.gastos)]))

    const periodos = Array.from({ length: totalSemanas }, (_, i) => {
      const sem = i + 1
      const key = `${año}-${sem}`
      const v = ventasMap.get(key)
      const gastos = gastosMap.get(key) ?? 0
      const ventas = Number(v?.ventas ?? 0)
      const r = rangoSemana(año, sem)
      return {
        label: r.label,
        desde: r.desde,
        hasta: r.hasta,
        semana: sem,
        año,
        pedidos: Number(v?.pedidos ?? 0),
        ventas,
        gastos,
        gananciaAprox: ventas - gastos,
        tieneDatos: !!v,
      }
    })

    return reply.send({ tipo: 'semanas', año, periodos })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /reportes/ia
  // Análisis de IA del período: negocio + redes sociales con Groq
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/reportes/ia', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    if (!fastify.config.GROQ_API_KEY) {
      return reply.serviceUnavailable('Análisis IA no disponible: falta GROQ_API_KEY')
    }

    const rango = parseQuery(request.query as Record<string, string>)
    const db = request.tenantDb
    const groq = getGroq(fastify.config.GROQ_API_KEY)

    type IgPostRow = {
      tipo: string; caption: string | null; publicadoEn: string;
      likes: number; comentarios: number; reproducciones: number | null; hashtags: string[]
    }
    type VentasRow = {
      totalPedidos: string; totalVentas: string; ticketPromedio: string;
      totalVentasPrev: string; totalPedidosPrev: string;
    }
    type TopRow = { nombre: string; unidades: string; ventasTotal: string }
    type GastosRow = { totalGastos: string }

    // ── Datos de negocio del período ──────────────────────────────────────
    const [ventasQ, topQ, gastosQ, igResultado] = await Promise.all([
      db.query<VentasRow>(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)                 AS "totalPedidos",
          COALESCE(SUM(total) FILTER (WHERE created_at >= $1 AND created_at < $2), 0)  AS "totalVentas",
          COALESCE(AVG(total) FILTER (WHERE created_at >= $1 AND created_at < $2), 0)  AS "ticketPromedio",
          COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4)                 AS "totalPedidosPrev",
          COALESCE(SUM(total) FILTER (WHERE created_at >= $3 AND created_at < $4), 0)  AS "totalVentasPrev"
        FROM pedidos
        WHERE estado != 'cancelado' AND deleted_at IS NULL
      `, [rango.desde, rango.hasta, rango.desdePrev, rango.hastaPrev]),

      db.query<TopRow>(`
        SELECT p.nombre, SUM(pi.cantidad) AS unidades, SUM(pi.subtotal) AS "ventasTotal"
        FROM pedido_items pi
        JOIN productos p ON pi.producto_id = p.id
        JOIN pedidos pe  ON pi.pedido_id  = pe.id
        WHERE pe.created_at >= $1 AND pe.created_at < $2
          AND pe.estado != 'cancelado' AND pe.deleted_at IS NULL AND pi.producto_id IS NOT NULL
        GROUP BY p.id, p.nombre
        ORDER BY "ventasTotal" DESC LIMIT 5
      `, [rango.desde, rango.hasta]),

      db.query<GastosRow>(`
        SELECT COALESCE(SUM(monto), 0) AS "totalGastos"
        FROM gastos_operativos WHERE fecha >= $1 AND fecha < $2 AND deleted_at IS NULL
      `, [rango.desde, rango.hasta]),

      // Posts de Instagram del período — puede fallar si ig_posts no existe aún
      db.query<IgPostRow>(`
        SELECT tipo, caption, publicado_en AS "publicadoEn",
               likes, comentarios, reproducciones, hashtags
        FROM ig_posts
        WHERE publicado_en >= $1 AND publicado_en < $2
          AND cuenta_id = (SELECT id FROM ig_cuentas ORDER BY created_at LIMIT 1)
        ORDER BY (likes + comentarios) DESC
        LIMIT 20
      `, [rango.desde, rango.hasta]).catch((): { rows: IgPostRow[] } => ({ rows: [] })),
    ])

    const igPosts: IgPostRow[] = igResultado.rows

    const v = ventasQ.rows[0]!
    const g = gastosQ.rows[0]!
    const tops = topQ.rows

    const totalVentas = Number(v.totalVentas)
    const totalVentasPrev = Number(v.totalVentasPrev)
    const cambioVentas = totalVentasPrev > 0
      ? ((totalVentas - totalVentasPrev) / totalVentasPrev * 100).toFixed(1)
      : null
    const totalGastos = Number(g.totalGastos)

    // ── Construir prompt ──────────────────────────────────────────────────
    const negocioCtx = `
PERÍODO ANALIZADO: ${rango.label}

VENTAS:
- Total: $${totalVentas.toLocaleString('es-CO')} COP
- Pedidos: ${v.totalPedidos}
- Ticket promedio: $${Number(v.ticketPromedio).toLocaleString('es-CO')} COP
${cambioVentas !== null ? `- Variación vs período anterior: ${Number(cambioVentas) >= 0 ? '+' : ''}${cambioVentas}%` : ''}

TOP PRODUCTOS VENDIDOS:
${tops.map((p, i) => `${i + 1}. ${p.nombre} — ${p.unidades} unidades, $${Number(p.ventasTotal).toLocaleString('es-CO')} COP`).join('\n') || '(Sin datos)'}

GASTOS OPERATIVOS: $${totalGastos.toLocaleString('es-CO')} COP
MARGEN BRUTO ESTIMADO: $${(totalVentas - totalGastos).toLocaleString('es-CO')} COP`.trim()

    const igLineas = igPosts.map((p: IgPostRow, i: number): string => {
      const fecha = new Date(p.publicadoEn).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
      const caption = p.caption?.slice(0, 120).replace(/\n/g, ' ') ?? '(sin caption)'
      const tags = p.hashtags?.slice(0, 5).map((h: string) => `#${h}`).join(' ') ?? ''
      return `${i + 1}. [${p.tipo.toUpperCase()}] ${fecha} · ❤${p.likes} 💬${p.comentarios}${p.reproducciones ? ` 👁${p.reproducciones}` : ''} · "${caption}" ${tags}`
    })

    const igCtx = igPosts.length > 0
      ? `\nPUBLICACIONES DE INSTAGRAM EN EL PERÍODO (${igPosts.length} posts, ordenados por engagement):\n${igLineas.join('\n')}`
      : '\nINSTAGRAM: Sin publicaciones en este período.'

    const prompt = `Eres un analista de negocio experto para pequeñas empresas colombianas. Analiza los datos del período y entrega un reporte en español conciso, directo y accionable.

${negocioCtx}
${igCtx}

Responde en formato markdown con estas secciones (máximo 200 palabras en total):

## 📊 Resumen del período
(2-3 frases con lo más importante del negocio)

## 🛒 Ventas y Productos
(1-2 insights accionables sobre qué vendió bien, qué no, y por qué)

## 📱 Redes Sociales
(Solo si hay datos de Instagram: qué formato funcionó mejor, qué tono generó más interacción, qué días/contenido recomiendas)

## ⚡ Recomendaciones
(2-3 acciones concretas para el siguiente período)`

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.6,
    })

    const analisis = completion.choices[0]?.message.content ?? 'No se pudo generar el análisis.'

    return reply.send({
      periodo: { label: rango.label, desde: rango.desde, hasta: rango.hasta },
      analisis,
      postsAnalizados: igPosts.length,
    })
  })
}

import {
  actualizarAbonoSchema,
  actualizarCuentaBancariaSchema,
  actualizarFacturaSchema,
  actualizarCategoriaMovimientoSchema,
  actualizarGastoOperativoSchema,
  actualizarMovimientoSocioSchema,
  actualizarIngresoBancarioSchema,
  calcularEstadoFactura,
  calcularSaldoPendiente,
  crearAbonoSchema,
  crearCategoriaMovimientoSchema,
  crearCuentaBancariaSchema,
  crearFacturaSchema,
  crearGastoOperativoSchema,
  crearIngresoBancarioSchema,
  crearMovimientoSocioSchema,
  crearTransferenciaSchema,
  TIPO_DOCUMENTO_POR_TIPO_FACTURA,
  tipoFacturaSchema,
  type Abono,
  type CategoriaMovimiento,
  type CuentaBancaria,
  type Factura,
  type GastoOperativo,
  type CapitalReal,
  type IngresoBancario,
  type MovimientoSocio,
  type ResumenFinanciero,
  type TipoFactura,
  type TransferenciaBancaria,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { aAbono, registrarAbonoEnTx, type FilaAbono } from '../../lib/abonos.js'
import { generarNumeroFacturaCompra } from '../../lib/numeracion.js'

interface FilaFacturaVenta {
  id: string
  numero: string
  cliente_id: string | null
  pedido_id: string | null
  fecha_emision: Date
  fecha_vencimiento: Date
  total: string
  notas: string | null
  created_at: Date
}

interface FilaFacturaCompra {
  id: string
  numero: string
  proveedor_id: string | null
  fecha_emision: Date
  fecha_vencimiento: Date
  total: string
  notas: string | null
  created_at: Date
}


interface FilaCuentaBancaria {
  id: string
  banco: string
  numero: string
  tipo: string
  saldo: string
  created_at: Date
}

interface FilaTransferencia {
  id: string
  cuenta_origen_id: string
  cuenta_destino_id: string
  monto: string
  descripcion: string | null
  fecha: Date
  usuario_id: string | null
  created_at: Date
}

interface FilaGasto {
  id: string
  descripcion: string
  categoria: string
  categoria_id: string | null
  categoria_nombre: string | null
  afecta_utilidad: boolean | null
  monto: string
  fecha: Date
  medio_pago: string | null
  cuenta_bancaria_id: string | null
  notas: string | null
  proveedor_id: string | null
  factura_compra_id: string | null
  usuario_id: string | null
  created_at: Date
}

interface FilaIngreso {
  id: string
  descripcion: string
  categoria: string
  categoria_id: string | null
  categoria_nombre: string | null
  afecta_utilidad: boolean | null
  monto: string
  fecha: Date
  medio_pago: string | null
  cuenta_bancaria_id: string
  notas: string | null
  usuario_id: string | null
  created_at: Date
}

function aCuentaBancaria(row: FilaCuentaBancaria): CuentaBancaria {
  return {
    id: row.id,
    banco: row.banco,
    numero: row.numero,
    tipo: row.tipo as CuentaBancaria['tipo'],
    saldo: Number(row.saldo),
    createdAt: row.created_at.toISOString(),
  }
}

function aTransferencia(row: FilaTransferencia): TransferenciaBancaria {
  return {
    id: row.id,
    cuentaOrigenId: row.cuenta_origen_id,
    cuentaDestinoId: row.cuenta_destino_id,
    monto: Number(row.monto),
    descripcion: row.descripcion,
    fecha: row.fecha.toISOString().slice(0, 10),
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * Columnas de un gasto con su categoría ya resuelta. `categoria_nombre` y
 * `afecta_utilidad` salen de `categorias_gasto` (migración 027) por LEFT JOIN y
 * no por subconsulta, para no pagar una query por fila en el listado. LEFT y no
 * INNER: una fila cuya categoría se desactivó debe seguir apareciendo.
 */
interface FilaCategoria {
  id: string
  nombre: string
  flujo: string
  slug: string | null
  afecta_utilidad: boolean
  orden: number
  activo: boolean
  created_at: Date
}

function aCategoria(row: FilaCategoria): CategoriaMovimiento {
  return {
    id: row.id,
    nombre: row.nombre,
    flujo: row.flujo as CategoriaMovimiento['flujo'],
    slug: row.slug,
    afectaUtilidad: row.afecta_utilidad,
    orden: row.orden,
    activo: row.activo,
    createdAt: row.created_at.toISOString(),
  }
}

interface FilaMovimientoSocio {
  id: string
  tipo: string
  socio: string
  monto: string
  fecha: Date
  cuenta_bancaria_id: string
  retiro_id: string | null
  notas: string | null
  usuario_id: string | null
  created_at: Date
  devuelto?: string | null
}

function aMovimientoSocio(row: FilaMovimientoSocio): MovimientoSocio {
  const monto = Number(row.monto)
  const base: MovimientoSocio = {
    id: row.id,
    tipo: row.tipo as MovimientoSocio['tipo'],
    socio: row.socio,
    monto,
    fecha: row.fecha.toISOString().slice(0, 10),
    cuentaBancariaId: row.cuenta_bancaria_id,
    retiroId: row.retiro_id,
    notas: row.notas,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
  // Solo los retiros llevan saldo: una devolución no se "devuelve".
  if (row.tipo === 'retiro' && row.devuelto !== undefined) {
    const devuelto = Number(row.devuelto ?? 0)
    base.devuelto = devuelto
    base.saldoPendiente = Math.max(0, monto - devuelto)
  }
  return base
}

const COLS_GASTO = `g.id, g.descripcion, g.categoria, g.categoria_id,
         c.nombre AS categoria_nombre, c.afecta_utilidad,
         g.monto, g.fecha, g.medio_pago, g.cuenta_bancaria_id, g.notas,
         g.proveedor_id, g.factura_compra_id, g.usuario_id, g.created_at`

const COLS_INGRESO = `i.id, i.descripcion, i.categoria, i.categoria_id,
         c.nombre AS categoria_nombre, c.afecta_utilidad,
         i.monto, i.fecha, i.medio_pago, i.cuenta_bancaria_id, i.notas,
         i.usuario_id, i.created_at`

/**
 * Deja coherentes las DOS formas de decir la categoría mientras conviven: la
 * columna `categoria` TEXT (histórica, con el slug) y `categoria_id` (la tabla
 * del tenant). Ver migración 027.
 *
 * Se acepta cualquiera de las dos desde el cliente y se completa la otra:
 * mandar solo `categoriaId` es lo nuevo; mandar solo `categoria` es lo que
 * hacía el front viejo y tiene que seguir funcionando. Si no llega ninguna, cae
 * en la categoría por defecto del flujo para no dejar el movimiento sin
 * clasificar (desaparecería de los reportes agrupados).
 */
async function resolverCategoria(
  db: NonNullable<FastifyRequest['tenantDb']>,
  flujo: 'egreso' | 'ingreso',
  categoriaId: string | undefined,
  categoriaSlug: string | undefined,
): Promise<{ categoriaId: string | null; categoria: string }> {
  const slugPorDefecto = flujo === 'egreso' ? 'otros' : 'otro'

  if (categoriaId) {
    const { rows } = await db.query<{ id: string; slug: string | null; flujo: string }>(
      'SELECT id, slug, flujo FROM categorias_gasto WHERE id = $1',
      [categoriaId],
    )
    const cat = rows[0]
    if (!cat) throw new Error('La categoría indicada no existe.')
    // Un gasto con categoría de ingreso (o al revés) rompería todo agrupado
    // por flujo; es más útil fallar que guardarlo torcido.
    if (cat.flujo !== flujo) {
      throw new Error(`Esa categoría es de ${cat.flujo}, no se puede usar en un movimiento de ${flujo}.`)
    }
    return { categoriaId: cat.id, categoria: cat.slug ?? slugPorDefecto }
  }

  const slug = categoriaSlug ?? slugPorDefecto
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM categorias_gasto WHERE flujo = $1 AND slug = $2',
    [flujo, slug],
  )
  return { categoriaId: rows[0]?.id ?? null, categoria: slug }
}

function aGasto(row: FilaGasto): GastoOperativo {
  return {
    id: row.id,
    descripcion: row.descripcion,
    categoria: row.categoria,
    categoriaId: row.categoria_id,
    categoriaNombre: row.categoria_nombre,
    afectaUtilidad: row.afecta_utilidad,
    monto: Number(row.monto),
    fecha: row.fecha.toISOString().slice(0, 10),
    medioPago: row.medio_pago,
    cuentaBancariaId: row.cuenta_bancaria_id,
    notas: row.notas,
    proveedorId: row.proveedor_id,
    facturaCompraId: row.factura_compra_id,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

function aIngreso(row: FilaIngreso): IngresoBancario {
  return {
    id: row.id,
    descripcion: row.descripcion,
    categoria: row.categoria,
    categoriaId: row.categoria_id,
    categoriaNombre: row.categoria_nombre,
    afectaUtilidad: row.afecta_utilidad,
    monto: Number(row.monto),
    fecha: row.fecha.toISOString().slice(0, 10),
    medioPago: row.medio_pago,
    cuentaBancariaId: row.cuenta_bancaria_id,
    notas: row.notas,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

/** Forma común mínima de una fila de `facturas_venta`/`facturas_compra` — lo que `aFactura` necesita para calcular el resto. */
interface FilaFacturaBase {
  id: string
  numero: string
  fecha_emision: Date
  fecha_vencimiento: Date
  total: string
  notas: string | null
  created_at: Date
}

/** Arma una `Factura` (forma única para CxC/CxP) calculando saldo y estado a partir de sus abonos — nunca se leen de columnas guardadas. */
function aFactura(
  tipo: TipoFactura,
  row: FilaFacturaBase,
  referencias: { clienteId: string | null; proveedorId: string | null; pedidoId: string | null },
  abonos: Pick<Abono, 'monto'>[],
): Factura {
  const total = Number(row.total)
  const fechaVencimiento = row.fecha_vencimiento.toISOString().slice(0, 10)
  const saldoPendiente = calcularSaldoPendiente(total, abonos)
  return {
    id: row.id,
    numero: row.numero,
    tipo,
    clienteId: referencias.clienteId,
    proveedorId: referencias.proveedorId,
    pedidoId: referencias.pedidoId,
    fechaEmision: row.fecha_emision.toISOString().slice(0, 10),
    fechaVencimiento,
    total,
    notas: row.notas,
    saldoPendiente,
    estado: calcularEstadoFactura(saldoPendiente, fechaVencimiento),
    createdAt: row.created_at.toISOString(),
  }
}

/** Igual que en el resto de rutas de tenant — sin tenant resuelto no hay schema contra el cual operar. */
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

/** `<prefijo>-<año>-<consecutivo>` — mismo esquema que `generarNumeroPedido`, consecutivo por año y por tipo de documento. */
async function generarNumeroFactura(tenantDb: FastifyRequest['tenantDb'] & {}, tipo: TipoFactura): Promise<string> {
  const tabla = tipo === 'cxc' ? 'facturas_venta' : 'facturas_compra'
  const prefijo = tipo === 'cxc' ? 'FV' : 'FC'
  const lockKey = tipo === 'cxc' ? 'numero_factura_venta' : 'numero_factura_compra'
  const anio = new Date().getFullYear()
  // Advisory lock por tipo — previene colisiones bajo carga concurrente.
  await tenantDb.query(`SELECT pg_advisory_xact_lock(hashtext('${lockKey}'))`)
  const { rows } = await tenantDb.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM ${tabla} WHERE numero LIKE $1`,
    [`${prefijo}-${anio}-%`],
  )
  const consecutivo = Number(rows[0]?.total ?? '0') + 1
  return `${prefijo}-${anio}-${String(consecutivo).padStart(4, '0')}`
}

/** Carga todos los abonos de un conjunto de facturas (de un solo tipo de documento), agrupados por `documento_id`. */
async function cargarAbonosPorFactura(
  tenantDb: FastifyRequest['tenantDb'] & {},
  tipoDocumento: 'factura_venta' | 'factura_compra',
  facturaIds: string[],
): Promise<Map<string, Abono[]>> {
  if (facturaIds.length === 0) return new Map()
  const { rows } = await tenantDb.query<FilaAbono>(
    `SELECT id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at
     FROM abonos WHERE tipo_documento = $1 AND documento_id = ANY($2::uuid[]) AND deleted_at IS NULL
     ORDER BY fecha DESC, created_at DESC`,
    [tipoDocumento, facturaIds],
  )
  const porFactura = new Map<string, Abono[]>()
  for (const row of rows) {
    const abono = aAbono(row)
    const lista = porFactura.get(abono.facturaId) ?? []
    lista.push(abono)
    porFactura.set(abono.facturaId, lista)
  }
  return porFactura
}

async function listarFacturas(
  tenantDb: FastifyRequest['tenantDb'] & {},
  tipo: TipoFactura,
): Promise<Factura[]> {
  if (tipo === 'cxc') {
    const { rows } = await tenantDb.query<FilaFacturaVenta>(
      `SELECT id, numero, cliente_id, pedido_id, fecha_emision, fecha_vencimiento, total, notas, created_at
       FROM facturas_venta WHERE deleted_at IS NULL ORDER BY fecha_emision DESC, created_at DESC`,
    )
    const abonosPorFactura = await cargarAbonosPorFactura(tenantDb, 'factura_venta', rows.map((r) => r.id))
    return rows.map((row) =>
      aFactura(
        'cxc',
        row,
        { clienteId: row.cliente_id, proveedorId: null, pedidoId: row.pedido_id },
        abonosPorFactura.get(row.id) ?? [],
      ),
    )
  }

  const { rows } = await tenantDb.query<FilaFacturaCompra>(
    `SELECT id, numero, proveedor_id, fecha_emision, fecha_vencimiento, total, notas, created_at
     FROM facturas_compra WHERE deleted_at IS NULL ORDER BY fecha_emision DESC, created_at DESC`,
  )
  const abonosPorFactura = await cargarAbonosPorFactura(tenantDb, 'factura_compra', rows.map((r) => r.id))
  return rows.map((row) =>
    aFactura(
      'cxp',
      row,
      { clienteId: null, proveedorId: row.proveedor_id, pedidoId: null },
      abonosPorFactura.get(row.id) ?? [],
    ),
  )
}

/**
 * Rutas de Finanzas — facturas (CxC/CxP) y abonos. El saldo y el estado de
 * cada factura NUNCA se guardan: se derivan de `total - Σ(abonos)` y de la
 * fecha de vencimiento (mismo principio que "el stock nunca se escribe
 * directo" en Inventario — ver `calcularSaldoPendiente`/`calcularEstadoFactura`
 * en `shared`). Registrar un abono es, por tanto, la ÚNICA forma de mover el
 * saldo — y se hace transaccionalmente con un `SELECT ... FOR UPDATE` sobre la
 * factura para que dos abonos concurrentes no la sobregiren.
 */
export async function finanzasRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }
  // Acciones sensibles (destructivas o de dinero/visibilidad financiera): solo
  // admin del tenant. Antes TODO endpoint de negocio usaba solo `conSesion`,
  // así que cualquier empleado con login podía borrar facturas o cuentas.
  const soloAdmin = { preHandler: [fastify.requireRole('admin', 'superadmin')] }

  // GET /finanzas/facturas?tipo=cxc|cxp
  fastify.get<{ Querystring: { tipo?: string } }>('/finanzas/facturas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const tipoParsed = tipoFacturaSchema.safeParse(request.query.tipo)
    if (!tipoParsed.success) return reply.badRequest('El parámetro "tipo" debe ser "cxc" o "cxp".')

    const facturas = await listarFacturas(request.tenantDb, tipoParsed.data)
    return reply.send({ facturas })
  })

  // GET /finanzas/facturas/vencidas — CxC y CxP con fecha_vencimiento pasada y saldo > 0.
  // Endpoint dedicado para el dashboard y alertas. Calcula el saldo on-the-fly
  // y los días vencidos para que el frontend no tenga que cruzarlo después.
  fastify.get<{ Querystring: { tipo?: string } }>(
    '/finanzas/facturas/vencidas',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const tipoQ = request.query.tipo ?? 'todas'
      if (!['cxc', 'cxp', 'todas'].includes(tipoQ)) {
        return reply.badRequest('El parámetro "tipo" debe ser "cxc", "cxp" o "todas".')
      }

      const promesas: Array<Promise<{ rows: unknown[] }>> = []
      if (tipoQ === 'cxc' || tipoQ === 'todas') {
        promesas.push(request.tenantDb.query(`
          SELECT
            'cxc'                                                AS "tipo",
            fv.id, fv.numero,
            c.nombre                                             AS contraparte,
            fv.total::numeric                                    AS total,
            (fv.total - COALESCE((
              SELECT SUM(monto) FROM abonos
              WHERE tipo_documento = 'factura_venta'
                AND documento_id = fv.id AND deleted_at IS NULL
            ), 0))::numeric                                       AS saldo,
            fv.fecha_vencimiento                                 AS "fechaVencimiento",
            (CURRENT_DATE - fv.fecha_vencimiento)::int           AS "diasVencido"
          FROM facturas_venta fv
          LEFT JOIN clientes c ON c.id = fv.cliente_id
          WHERE fv.deleted_at IS NULL
            AND fv.fecha_vencimiento < CURRENT_DATE
            AND fv.total > COALESCE((
              SELECT SUM(monto) FROM abonos
              WHERE tipo_documento = 'factura_venta'
                AND documento_id = fv.id AND deleted_at IS NULL
            ), 0)
          ORDER BY fv.fecha_vencimiento ASC
        `))
      }
      if (tipoQ === 'cxp' || tipoQ === 'todas') {
        promesas.push(request.tenantDb.query(`
          SELECT
            'cxp'                                                AS "tipo",
            fc.id, fc.numero,
            p.nombre                                             AS contraparte,
            fc.total::numeric                                    AS total,
            (fc.total - COALESCE((
              SELECT SUM(monto) FROM abonos
              WHERE tipo_documento = 'factura_compra'
                AND documento_id = fc.id AND deleted_at IS NULL
            ), 0))::numeric                                       AS saldo,
            fc.fecha_vencimiento                                 AS "fechaVencimiento",
            (CURRENT_DATE - fc.fecha_vencimiento)::int           AS "diasVencido"
          FROM facturas_compra fc
          LEFT JOIN proveedores p ON p.id = fc.proveedor_id
          WHERE fc.deleted_at IS NULL
            AND fc.fecha_vencimiento < CURRENT_DATE
            AND fc.total > COALESCE((
              SELECT SUM(monto) FROM abonos
              WHERE tipo_documento = 'factura_compra'
                AND documento_id = fc.id AND deleted_at IS NULL
            ), 0)
          ORDER BY fc.fecha_vencimiento ASC
        `))
      }

      const resultados = await Promise.all(promesas)
      return reply.send({ facturas: resultados.flatMap((r) => r.rows) })
    },
  )

  // GET /finanzas/cartera?tipo=cxc|cxp — cartera por edades.
  //
  // Es la vista con la que efectivamente se cobra: quién debe, cuánto, y hace
  // cuánto. Distinto de `/facturas/vencidas`, que solo trae lo ya vencido —
  // acá entra también lo que está POR vencer, porque para llamar a un cliente
  // hay que ver su saldo completo, no solo la parte atrasada.
  //
  // Las cubetas 0-30 / 31-60 / 61-90 / +90 son el estándar contable: mientras
  // más vieja la deuda, menos probable es cobrarla, y el corte de 90 días es
  // donde normalmente se decide escalar o castigar la cartera.
  fastify.get<{ Querystring: { tipo?: string } }>(
    '/finanzas/cartera',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const tipo = request.query.tipo === 'cxp' ? 'cxp' : 'cxc'

      const esCxc = tipo === 'cxc'
      const tabla = esCxc ? 'facturas_venta' : 'facturas_compra'
      const tablaContraparte = esCxc ? 'clientes' : 'proveedores'
      const fkContraparte = esCxc ? 'cliente_id' : 'proveedor_id'
      const tipoDocumento = esCxc ? 'factura_venta' : 'factura_compra'

      const { rows } = await request.tenantDb.query<{
        contraparteId: string | null; contraparte: string | null;
        porVencer: string; d1a30: string; d31a60: string; d61a90: string; dMas90: string;
        total: string; facturas: string; masVieja: number | null;
      }>(`
        WITH saldos AS (
          SELECT
            f.${fkContraparte}                                   AS contraparte_id,
            (CURRENT_DATE - f.fecha_vencimiento)::int            AS dias,
            f.total - COALESCE((
              SELECT SUM(a.monto) FROM abonos a
              WHERE a.tipo_documento = '${tipoDocumento}'
                AND a.documento_id = f.id AND a.deleted_at IS NULL
            ), 0)                                                AS saldo
          FROM ${tabla} f
          WHERE f.deleted_at IS NULL
        )
        SELECT
          s.contraparte_id                                              AS "contraparteId",
          cp.nombre                                                     AS contraparte,
          COALESCE(SUM(s.saldo) FILTER (WHERE s.dias <= 0), 0)::text    AS "porVencer",
          COALESCE(SUM(s.saldo) FILTER (WHERE s.dias BETWEEN 1 AND 30), 0)::text  AS "d1a30",
          COALESCE(SUM(s.saldo) FILTER (WHERE s.dias BETWEEN 31 AND 60), 0)::text AS "d31a60",
          COALESCE(SUM(s.saldo) FILTER (WHERE s.dias BETWEEN 61 AND 90), 0)::text AS "d61a90",
          COALESCE(SUM(s.saldo) FILTER (WHERE s.dias > 90), 0)::text    AS "dMas90",
          COALESCE(SUM(s.saldo), 0)::text                               AS total,
          COUNT(*)::text                                                AS facturas,
          MAX(s.dias)                                                   AS "masVieja"
        FROM saldos s
        LEFT JOIN ${tablaContraparte} cp ON cp.id = s.contraparte_id
        WHERE s.saldo > 0
        GROUP BY s.contraparte_id, cp.nombre
        ORDER BY SUM(s.saldo) DESC
      `)

      const filas = rows.map((r) => ({
        contraparteId: r.contraparteId,
        contraparte: r.contraparte ?? (esCxc ? 'Sin cliente' : 'Sin proveedor'),
        porVencer: Number(r.porVencer),
        d1a30: Number(r.d1a30),
        d31a60: Number(r.d31a60),
        d61a90: Number(r.d61a90),
        dMas90: Number(r.dMas90),
        total: Number(r.total),
        facturas: Number(r.facturas),
        diasMasVieja: r.masVieja ?? 0,
      }))

      const suma = (k: 'porVencer' | 'd1a30' | 'd31a60' | 'd61a90' | 'dMas90' | 'total') =>
        filas.reduce((acc, f) => acc + f[k], 0)

      return reply.send({
        tipo,
        filas,
        totales: {
          porVencer: suma('porVencer'),
          d1a30: suma('d1a30'),
          d31a60: suma('d31a60'),
          d61a90: suma('d61a90'),
          dMas90: suma('dMas90'),
          total: suma('total'),
        },
      })
    },
  )

  // ─────────────────────────────────────────────────────────────────────────
  // GET /finanzas/flujo-caja — ingresos y egresos por período quincenal,
  // separando lo YA CONFIRMADO (actual) de lo TODAVÍA PENDIENTE (proyectado).
  //
  // "Proyectado" viene únicamente de CxC/CxP con saldo pendiente, bucketeado
  // por su fecha_vencimiento (mismo criterio que /finanzas/cartera) — no
  // inventa datos: si no hay una factura pendiente, no hay proyección. Un
  // gasto o ingreso manual con fecha futura también cuenta como proyectado
  // hasta que su fecha llega; ningún campo de estado se guarda para eso, se
  // deriva de comparar la fecha contra CURRENT_DATE en cada consulta — mismo
  // principio que calcularEstadoFactura (nunca persistir estado derivado).
  //
  // Dos renglones corridos:
  //   saldoEnBanco    — anclado al saldo bancario REAL de hoy, y de ahí en
  //                      adelante solo se mueve con columnas "actual" (nunca
  //                      con lo proyectado) — es lo que de verdad hay en el banco.
  //   flujoAcumulado  — suma corrida de "saldo del período" (actual+proyectado)
  //                      desde el primer período visible — la proyección hacia
  //                      adelante si todo lo pendiente se cobra/paga en fecha.
  interface FilaFlujoCaja { fecha: string; monto: number }

  interface FilaFlujoConCategoria {
    fecha: string
    monto: string
    categoria_id: string | null
    categoria_nombre: string
    afecta_utilidad: boolean
  }

  /** Una fila del desglose: una categoría del tenant con su monto por período. */
  interface DesgloseCategoria {
    categoriaId: string | null
    nombre: string
    flujo: 'egreso' | 'ingreso'
    afectaUtilidad: boolean
    /** Un valor por período, en el mismo orden que `periodos`. */
    actual: number[]
    proyectado: number[]
  }

  /**
   * Agrupa los movimientos por categoría y los bucketea por período, separando
   * actual de proyectado con el mismo criterio que el resto del endpoint (fecha
   * contra hoy, nada persistido).
   *
   * Devuelve una fila POR CATEGORÍA con presencia real en el rango — no el
   * catálogo completo: mostrar 16 renglones en cero para un negocio que usa
   * tres haría la tabla ilegible.
   */
  function desglosarPorCategoria(
    filas: FilaFlujoConCategoria[],
    periodos: { desde: string; hasta: string }[],
    flujo: 'egreso' | 'ingreso',
    hoy: string,
  ): DesgloseCategoria[] {
    const porCategoria = new Map<string, DesgloseCategoria>()
    for (const f of filas) {
      const clave = f.categoria_id ?? '__sin__'
      let entrada = porCategoria.get(clave)
      if (!entrada) {
        entrada = {
          categoriaId: f.categoria_id,
          nombre: f.categoria_nombre,
          flujo,
          afectaUtilidad: f.afecta_utilidad,
          actual: periodos.map(() => 0),
          proyectado: periodos.map(() => 0),
        }
        porCategoria.set(clave, entrada)
      }
      const idx = periodos.findIndex((p) => f.fecha >= p.desde && f.fecha <= p.hasta)
      if (idx === -1) continue
      const balde = f.fecha <= hoy ? entrada.actual : entrada.proyectado
      balde[idx] = balde[idx]! + Number(f.monto)
    }
    // Mayor primero: lo que más pesa se lee arriba.
    return [...porCategoria.values()].sort((a, b) => {
      const sa = a.actual.reduce((x, y) => x + y, 0) + a.proyectado.reduce((x, y) => x + y, 0)
      const sb = b.actual.reduce((x, y) => x + y, 0) + b.proyectado.reduce((x, y) => x + y, 0)
      return sb - sa
    })
  }

  function generarPeriodosQuincenales(
    desdeStr: string,
    cantidad: number,
  ): { label: string; desde: string; hasta: string }[] {
    const periodos: { label: string; desde: string; hasta: string }[] = []
    const inicial = new Date(`${desdeStr}T00:00:00Z`)
    let year = inicial.getUTCFullYear()
    let month = inicial.getUTCMonth()
    let day: 1 | 16 = inicial.getUTCDate() <= 15 ? 1 : 16

    for (let i = 0; i < cantidad; i++) {
      let desde: Date, hasta: Date
      if (day === 1) {
        desde = new Date(Date.UTC(year, month, 1))
        hasta = new Date(Date.UTC(year, month, 15))
      } else {
        desde = new Date(Date.UTC(year, month, 16))
        hasta = new Date(Date.UTC(year, month + 1, 0)) // día 0 del mes siguiente = último día de este mes
      }
      const mesNombre = desde.toLocaleDateString('es-CO', { month: 'short', timeZone: 'UTC' })
      periodos.push({
        label: `${hasta.getUTCDate()} de ${mesNombre}`,
        desde: desde.toISOString().slice(0, 10),
        hasta: hasta.toISOString().slice(0, 10),
      })
      if (day === 1) {
        day = 16
      } else {
        day = 1
        month += 1
        if (month > 11) { month = 0; year += 1 }
      }
    }
    return periodos
  }

  /** Índice del período que contiene la fecha `hoy` (YYYY-MM-DD), o -1 si ninguno la contiene. */
  function indicePeriodoDeHoy(periodos: { desde: string; hasta: string }[], hoy: string): number {
    return periodos.findIndex((p) => hoy >= p.desde && hoy <= p.hasta)
  }

  /** Suma, por período, los montos cuya fecha cae dentro de [periodo.desde, periodo.hasta]. */
  function bucketearPorPeriodo(
    filas: FilaFlujoCaja[],
    periodos: { desde: string; hasta: string }[],
  ): number[] {
    const totales = periodos.map(() => 0)
    for (const fila of filas) {
      const idx = periodos.findIndex((p) => fila.fecha >= p.desde && fila.fecha <= p.hasta)
      if (idx !== -1) totales[idx] = totales[idx]! + fila.monto
    }
    return totales
  }

  fastify.get<{ Querystring: { desde?: string; periodos?: string } }>(
    '/finanzas/flujo-caja',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const hoy = new Date().toISOString().slice(0, 10)
      const desdeParam = request.query.desde ?? hoy
      const cantidadParam = Math.min(Math.max(Number(request.query.periodos) || 8, 1), 24)
      const periodos = generarPeriodosQuincenales(desdeParam, cantidadParam)
      const rangoDesde = periodos[0]!.desde
      const rangoHasta = periodos[periodos.length - 1]!.hasta
      const db = request.tenantDb

      const [
        abonosCxpRes, pendienteCxpRes,
        gastosRes,
        abonosCxcRes, pendienteCxcRes,
        ingresosRes,
      ] = await Promise.all([
        // Costos operativos — actual: plata que ya se pagó a proveedores.
        db.query<{ fecha: string; monto: string }>(
          `SELECT a.fecha::text AS fecha, a.monto::text AS monto
           FROM abonos a
           JOIN facturas_compra fc ON fc.id = a.documento_id
           WHERE a.tipo_documento = 'factura_compra' AND a.deleted_at IS NULL
             AND fc.deleted_at IS NULL AND a.fecha BETWEEN $1 AND $2`,
          [rangoDesde, rangoHasta],
        ),
        // Costos operativos — proyectado: saldo pendiente de CxP por su vencimiento (igual que /cartera).
        db.query<{ fecha: string; monto: string }>(
          `SELECT fc.fecha_vencimiento::text AS fecha,
                  (fc.total - COALESCE((
                    SELECT SUM(a.monto) FROM abonos a
                    WHERE a.tipo_documento = 'factura_compra' AND a.documento_id = fc.id AND a.deleted_at IS NULL
                  ), 0))::text AS monto
           FROM facturas_compra fc
           WHERE fc.deleted_at IS NULL AND fc.fecha_vencimiento BETWEEN $1 AND $2
             AND (fc.total - COALESCE((
                    SELECT SUM(a.monto) FROM abonos a
                    WHERE a.tipo_documento = 'factura_compra' AND a.documento_id = fc.id AND a.deleted_at IS NULL
                  ), 0)) > 0`,
          [rangoDesde, rangoHasta],
        ),
        // Gastos administrativos — actual y proyectado se separan después por fecha vs. hoy.
        db.query<FilaFlujoConCategoria>(
          `SELECT g.fecha::text AS fecha, g.monto::text AS monto, g.categoria_id,
                  COALESCE(c.nombre, 'Sin categoría') AS categoria_nombre,
                  COALESCE(c.afecta_utilidad, true) AS afecta_utilidad
           FROM gastos_operativos g
           LEFT JOIN categorias_gasto c ON c.id = g.categoria_id
           WHERE g.deleted_at IS NULL AND g.fecha BETWEEN $1 AND $2`,
          [rangoDesde, rangoHasta],
        ),
        // Ingresos — actual: cobros ya recibidos de clientes.
        db.query<{ fecha: string; monto: string }>(
          `SELECT a.fecha::text AS fecha, a.monto::text AS monto
           FROM abonos a
           JOIN facturas_venta fv ON fv.id = a.documento_id
           WHERE a.tipo_documento = 'factura_venta' AND a.deleted_at IS NULL
             AND fv.deleted_at IS NULL AND a.fecha BETWEEN $1 AND $2`,
          [rangoDesde, rangoHasta],
        ),
        // Ingresos — proyectado: saldo pendiente de CxC por su vencimiento.
        db.query<{ fecha: string; monto: string }>(
          `SELECT fv.fecha_vencimiento::text AS fecha,
                  (fv.total - COALESCE((
                    SELECT SUM(a.monto) FROM abonos a
                    WHERE a.tipo_documento = 'factura_venta' AND a.documento_id = fv.id AND a.deleted_at IS NULL
                  ), 0))::text AS monto
           FROM facturas_venta fv
           WHERE fv.deleted_at IS NULL AND fv.fecha_vencimiento BETWEEN $1 AND $2
             AND (fv.total - COALESCE((
                    SELECT SUM(a.monto) FROM abonos a
                    WHERE a.tipo_documento = 'factura_venta' AND a.documento_id = fv.id AND a.deleted_at IS NULL
                  ), 0)) > 0`,
          [rangoDesde, rangoHasta],
        ),
        // Ingresos manuales — actual y proyectado se separan después por fecha vs. hoy.
        db.query<FilaFlujoConCategoria>(
          `SELECT i.fecha::text AS fecha, i.monto::text AS monto, i.categoria_id,
                  COALESCE(c.nombre, 'Sin categoría') AS categoria_nombre,
                  COALESCE(c.afecta_utilidad, true) AS afecta_utilidad
           FROM ingresos_bancarios i
           LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
           WHERE i.deleted_at IS NULL AND i.fecha BETWEEN $1 AND $2`,
          [rangoDesde, rangoHasta],
        ),
      ])

      const aFilas = (rows: { fecha: string; monto: string }[]): FilaFlujoCaja[] =>
        rows.map((r) => ({ fecha: r.fecha, monto: Number(r.monto) }))

      const gastosFilas = aFilas(gastosRes.rows)
      const ingresosFilas = aFilas(ingresosRes.rows)

      // Desglose por categoría del tenant (migración 027). Se calcula aparte de
      // los totales para no cambiar el contrato existente: `gastosAdministrativos`
      // e `ingresos` siguen siendo la suma, y esto es el detalle.
      const desgloseEgresos = desglosarPorCategoria(gastosRes.rows, periodos, 'egreso', hoy)
      const desgloseIngresos = desglosarPorCategoria(ingresosRes.rows, periodos, 'ingreso', hoy)

      const costosOpActual = bucketearPorPeriodo(aFilas(abonosCxpRes.rows), periodos)
      const costosOpProyectado = bucketearPorPeriodo(aFilas(pendienteCxpRes.rows), periodos)
      const gastosActual = bucketearPorPeriodo(gastosFilas.filter((f) => f.fecha <= hoy), periodos)
      const gastosProyectado = bucketearPorPeriodo(gastosFilas.filter((f) => f.fecha > hoy), periodos)
      const ingresosCxcActual = bucketearPorPeriodo(aFilas(abonosCxcRes.rows), periodos)
      const ingresosCxcProyectado = bucketearPorPeriodo(aFilas(pendienteCxcRes.rows), periodos)
      const ingresosManualActual = bucketearPorPeriodo(ingresosFilas.filter((f) => f.fecha <= hoy), periodos)
      const ingresosManualProyectado = bucketearPorPeriodo(ingresosFilas.filter((f) => f.fecha > hoy), periodos)

      const { rows: saldoRows } = await db.query<{ total: string }>(
        `SELECT COALESCE(SUM(saldo), 0)::text AS total FROM cuentas_bancarias WHERE deleted_at IS NULL`,
      )
      const saldoBancarioHoy = Number(saldoRows[0]!.total)
      const idxHoy = indicePeriodoDeHoy(periodos, hoy)

      const resultado = periodos.map((p, i) => {
        const ingresosActual = ingresosCxcActual[i]! + ingresosManualActual[i]!
        const ingresosProyectado = ingresosCxcProyectado[i]! + ingresosManualProyectado[i]!
        const gAdminActual = gastosActual[i]!
        const gAdminProyectado = gastosProyectado[i]!
        const cOpActual = costosOpActual[i]!
        const cOpProyectado = costosOpProyectado[i]!

        const totalIngresos = ingresosActual + ingresosProyectado
        const totalEgresos = cOpActual + cOpProyectado + gAdminActual + gAdminProyectado
        const saldoDelPeriodo = totalIngresos - totalEgresos
        const netoActual = ingresosActual - cOpActual - gAdminActual

        return {
          label: p.label, desde: p.desde, hasta: p.hasta,
          costosOperativos: { actual: cOpActual, proyectado: cOpProyectado },
          gastosAdministrativos: { actual: gAdminActual, proyectado: gAdminProyectado },
          ingresos: { actual: ingresosActual, proyectado: ingresosProyectado },
          totalEgresos, totalIngresos, saldoDelPeriodo, netoActual,
        }
      })

      // Saldo en banco: anclado al saldo real de HOY, y de ahí para adelante y
      // para atrás se mueve solo con lo "actual" — nunca con lo proyectado.
      const saldoEnBanco = resultado.map(() => 0)
      const flujoAcumulado = resultado.map(() => 0)
      if (idxHoy !== -1) {
        saldoEnBanco[idxHoy] = saldoBancarioHoy
        for (let i = idxHoy + 1; i < resultado.length; i++) saldoEnBanco[i] = saldoEnBanco[i - 1]! + resultado[i]!.netoActual
        for (let i = idxHoy - 1; i >= 0; i--) saldoEnBanco[i] = saldoEnBanco[i + 1]! - resultado[i + 1]!.netoActual
      } else {
        // La ventana pedida no incluye hoy (ej. `desde` en el pasado o muy en
        // el futuro) — se ancla en el primer período como aproximación.
        saldoEnBanco[0] = saldoBancarioHoy
        for (let i = 1; i < resultado.length; i++) saldoEnBanco[i] = saldoEnBanco[i - 1]! + resultado[i]!.netoActual
      }
      for (let i = 0; i < resultado.length; i++) {
        flujoAcumulado[i] = (i === 0 ? 0 : flujoAcumulado[i - 1]!) + resultado[i]!.saldoDelPeriodo
      }

      return reply.send({
        periodos: resultado.map((r, i) => ({
          label: r.label, desde: r.desde, hasta: r.hasta,
          costosOperativos: r.costosOperativos,
          gastosAdministrativos: r.gastosAdministrativos,
          ingresos: r.ingresos,
          totalEgresos: r.totalEgresos,
          totalIngresos: r.totalIngresos,
          saldoDelPeriodo: r.saldoDelPeriodo,
          saldoEnBanco: saldoEnBanco[i],
          flujoAcumulado: flujoAcumulado[i],
        })),
        // El desglose va FUERA del array de períodos: una categoría es una fila
        // de la tabla con un valor por columna/período, así que anidarla dentro
        // de cada período obligaría al front a recomponerla. Cada entrada trae
        // sus arrays alineados al índice de `periodos`.
        desglose: {
          egresos: desgloseEgresos,
          ingresos: desgloseIngresos,
        },
      })
    },
  )

  // POST /finanzas/facturas — registro manual (compras a proveedores, ventas de mostrador, etc.)
  fastify.post('/finanzas/facturas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearFacturaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    const { tipo } = body.data
    try {
      await client.query('BEGIN')

      if (tipo === 'cxc' && body.data.clienteId) {
        const cli = await client.query('SELECT id FROM clientes WHERE id = $1', [body.data.clienteId])
        if (cli.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('El cliente seleccionado no existe.')
        }
      }
      if (tipo === 'cxp' && body.data.proveedorId) {
        const prov = await client.query('SELECT id FROM proveedores WHERE id = $1', [body.data.proveedorId])
        if (prov.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('El proveedor seleccionado no existe.')
        }
      }

      const numero = await generarNumeroFactura(client, tipo)
      let creada: Factura
      if (tipo === 'cxc') {
        const { rows } = await client.query<FilaFacturaVenta>(
          `INSERT INTO facturas_venta (numero, cliente_id, pedido_id, fecha_vencimiento, total, notas)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, numero, cliente_id, pedido_id, fecha_emision, fecha_vencimiento, total, notas, created_at`,
          [numero, body.data.clienteId ?? null, body.data.pedidoId ?? null, body.data.fechaVencimiento, body.data.total, body.data.notas ?? null],
        )
        const row = rows[0]!
        creada = aFactura('cxc', row, { clienteId: row.cliente_id, proveedorId: null, pedidoId: row.pedido_id }, [])
      } else {
        const { rows } = await client.query<FilaFacturaCompra>(
          `INSERT INTO facturas_compra (numero, proveedor_id, fecha_vencimiento, total, notas)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, numero, proveedor_id, fecha_emision, fecha_vencimiento, total, notas, created_at`,
          [numero, body.data.proveedorId ?? null, body.data.fechaVencimiento, body.data.total, body.data.notas ?? null],
        )
        const row = rows[0]!
        creada = aFactura('cxp', row, { clienteId: null, proveedorId: row.proveedor_id, pedidoId: null }, [])
      }

      await client.query('COMMIT')
      return reply.status(201).send({ factura: creada })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // GET /finanzas/abonos — bitácora de recaudos/pagos (alimenta el resumen y el listado "últimos abonos").
  fastify.get('/finanzas/abonos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaAbono>(
      `SELECT id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at
       FROM abonos WHERE deleted_at IS NULL ORDER BY fecha DESC, created_at DESC`,
    )
    return reply.send({ abonos: rows.map(aAbono) })
  })

  // POST /finanzas/abonos — registra un abono y, transaccionalmente, recalcula
  // (vía lock) que no exceda el saldo pendiente actual de la factura.
  fastify.post('/finanzas/abonos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearAbonoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb

    try {
      await client.query('BEGIN')

      const resultado = await registrarAbonoEnTx(client, body.data, request.user.sub)
      if (!resultado.ok) {
        await client.query('ROLLBACK')
        return resultado.motivo === 'no_encontrado'
          ? reply.notFound(resultado.mensaje)
          : reply.badRequest(resultado.mensaje)
      }

      await client.query('COMMIT')
      return reply.status(201).send({ abono: aAbono(resultado.fila) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // PATCH /finanzas/facturas/:id?tipo=cxc|cxp — edición administrativa (ver `actualizarFacturaSchema`).
  fastify.patch<{ Params: { id: string }; Querystring: { tipo?: string } }>(
    '/finanzas/facturas/:id',
    soloAdmin,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const tipoParsed = tipoFacturaSchema.safeParse(request.query.tipo)
      if (!tipoParsed.success) return reply.badRequest('El parámetro "tipo" debe ser "cxc" o "cxp".')
      const body = actualizarFacturaSchema.safeParse(request.body)
      if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
      if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

      const tabla = tipoParsed.data === 'cxc' ? 'facturas_venta' : 'facturas_compra'
      const campos: Record<string, unknown> = {
        fecha_vencimiento: body.data.fechaVencimiento,
        notas: body.data.notas,
      }
      const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
      const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      const valores = entradas.map(([, v]) => v)

      const { rowCount } = await request.tenantDb.query(
        `UPDATE ${tabla} SET ${sets} WHERE id = $1 AND deleted_at IS NULL`,
        [request.params.id, ...valores],
      )
      if (rowCount === 0) return reply.notFound('Factura no encontrada.')

      const facturas = await listarFacturas(request.tenantDb, tipoParsed.data)
      const factura = facturas.find((f) => f.id === request.params.id)
      return reply.send({ factura })
    },
  )

  // DELETE /finanzas/facturas/:id?tipo=cxc|cxp — borrado suave, recuperable desde /papelera.
  // No se permite si la factura ya tiene abonos: borrarla "ocultaría" pagos
  // ya recibidos/hechos — primero hay que revertir esos abonos (que también son reversibles).
  fastify.delete<{ Params: { id: string }; Querystring: { tipo?: string } }>(
    '/finanzas/facturas/:id',
    soloAdmin,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const tipoParsed = tipoFacturaSchema.safeParse(request.query.tipo)
      if (!tipoParsed.success) return reply.badRequest('El parámetro "tipo" debe ser "cxc" o "cxp".')

      const tabla = tipoParsed.data === 'cxc' ? 'facturas_venta' : 'facturas_compra'
      const tipoDocumento = TIPO_DOCUMENTO_POR_TIPO_FACTURA[tipoParsed.data]

      const conAbonos = await request.tenantDb.query(
        'SELECT id FROM abonos WHERE tipo_documento = $1 AND documento_id = $2 AND deleted_at IS NULL LIMIT 1',
        [tipoDocumento, request.params.id],
      )
      if ((conAbonos.rowCount ?? 0) > 0) {
        return reply.badRequest('No puedes eliminar esta factura: ya tiene abonos registrados. Elimínalos primero.')
      }

      const { rowCount } = await request.tenantDb.query(
        `UPDATE ${tabla} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        [request.params.id],
      )
      if (rowCount === 0) return reply.notFound('Factura no encontrada.')
      return reply.status(204).send()
    },
  )

  // PATCH /finanzas/abonos/:id — solo metadatos (ver `actualizarAbonoSchema`); el monto no se toca por aquí.
  fastify.patch<{ Params: { id: string } }>('/finanzas/abonos/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarAbonoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      medio_pago: body.data.medioPago,
      referencia: body.data.referencia,
      fecha: body.data.fecha,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
    const valores = entradas.map(([, v]) => v)

    const { rows, rowCount } = await request.tenantDb.query<FilaAbono>(
      `UPDATE abonos SET ${sets} WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at`,
      [request.params.id, ...valores],
    )
    if (rowCount === 0) return reply.notFound('Abono no encontrado.')
    return reply.send({ abono: aAbono(rows[0]!) })
  })

  // DELETE /finanzas/abonos/:id — borrado suave: el saldo de la factura se
  // recalcula automáticamente al excluir este abono (nunca se guarda, ver
  // `calcularSaldoPendiente`) — deshacerlo desde /papelera revierte el efecto al instante.
  // Si el abono tenía cuenta bancaria asociada, se revierte el movimiento de saldo en la misma tx.
  fastify.delete<{ Params: { id: string } }>('/finanzas/abonos/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const { rows, rowCount } = await client.query<{ tipo_documento: string; monto: string; cuenta_bancaria_id: string | null }>(
        'SELECT tipo_documento, monto, cuenta_bancaria_id FROM abonos WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [request.params.id],
      )
      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Abono no encontrado.')
      }

      await client.query('UPDATE abonos SET deleted_at = NOW() WHERE id = $1', [request.params.id])

      const abono = rows[0]!
      if (abono.cuenta_bancaria_id) {
        // Al crear: CxC suma (+), CxP resta (-). Al eliminar: operación inversa.
        const operacion = abono.tipo_documento === 'factura_venta' ? '-' : '+'
        await client.query(
          `UPDATE cuentas_bancarias SET saldo = saldo ${operacion} $1 WHERE id = $2 AND deleted_at IS NULL`,
          [abono.monto, abono.cuenta_bancaria_id],
        )
      }

      await client.query('COMMIT')
      return reply.status(204).send()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // --- Cuentas bancarias (antes hardcodeadas como `INITIAL_BANK_ACCOUNTS`) ---

  // GET /finanzas/cuentas
  fastify.get('/finanzas/cuentas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaCuentaBancaria>(
      'SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias WHERE deleted_at IS NULL ORDER BY created_at ASC',
    )
    return reply.send({ cuentas: rows.map(aCuentaBancaria) })
  })

  // POST /finanzas/cuentas
  fastify.post('/finanzas/cuentas', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearCuentaBancariaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const { rows } = await request.tenantDb.query<FilaCuentaBancaria>(
      `INSERT INTO cuentas_bancarias (banco, numero, tipo, saldo) VALUES ($1, $2, $3, $4)
       RETURNING id, banco, numero, tipo, saldo, created_at`,
      [body.data.banco, body.data.numero, body.data.tipo, body.data.saldo ?? 0],
    )
    return reply.status(201).send({ cuenta: aCuentaBancaria(rows[0]!) })
  })

  // PATCH /finanzas/cuentas/:id
  fastify.patch<{ Params: { id: string } }>('/finanzas/cuentas/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarCuentaBancariaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      banco: body.data.banco,
      numero: body.data.numero,
      tipo: body.data.tipo,
      saldo: body.data.saldo,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
    const valores = entradas.map(([, v]) => v)

    const { rows, rowCount } = await request.tenantDb.query<FilaCuentaBancaria>(
      `UPDATE cuentas_bancarias SET ${sets} WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, banco, numero, tipo, saldo, created_at`,
      [request.params.id, ...valores],
    )
    if (rowCount === 0) return reply.notFound('Cuenta no encontrada.')
    return reply.send({ cuenta: aCuentaBancaria(rows[0]!) })
  })

  // DELETE /finanzas/cuentas/:id — borrado suave, recuperable desde /papelera.
  fastify.delete<{ Params: { id: string } }>('/finanzas/cuentas/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const usos = await request.tenantDb.query<{
      abonos: number
      gastos: number
      ingresos: number
      transferencias: number
    }>(
      `SELECT
         (SELECT COUNT(*) FROM abonos WHERE cuenta_bancaria_id = $1 AND deleted_at IS NULL)::int AS abonos,
         (SELECT COUNT(*) FROM gastos_operativos WHERE cuenta_bancaria_id = $1 AND deleted_at IS NULL)::int AS gastos,
         (SELECT COUNT(*) FROM ingresos_bancarios WHERE cuenta_bancaria_id = $1 AND deleted_at IS NULL)::int AS ingresos,
         (SELECT COUNT(*) FROM transferencias_bancarias WHERE cuenta_origen_id = $1 OR cuenta_destino_id = $1)::int AS transferencias`,
      [request.params.id],
    )
    const uso = usos.rows[0]
    if (uso && (uso.abonos > 0 || uso.gastos > 0 || uso.ingresos > 0 || uso.transferencias > 0)) {
      return reply.badRequest('No puedes eliminar esta cuenta bancaria: tiene movimientos financieros asociados.')
    }

    const { rowCount } = await request.tenantDb.query(
      'UPDATE cuentas_bancarias SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (rowCount === 0) return reply.notFound('Cuenta no encontrada.')
    return reply.status(204).send()
  })

  // ─── TRANSFERENCIAS BANCARIAS ─────────────────────────────────────────────

  // GET /finanzas/transferencias — historial de transferencias entre cuentas.
  fastify.get('/finanzas/transferencias', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaTransferencia>(
      `SELECT id, cuenta_origen_id, cuenta_destino_id, monto, descripcion, fecha, usuario_id, created_at
       FROM transferencias_bancarias WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    )
    return reply.send({ transferencias: rows.map(aTransferencia) })
  })

  // POST /finanzas/transferencias — transfiere monto de una cuenta a otra
  // de forma atómica: descuenta del origen, suma al destino, registra el audit.
  fastify.post('/finanzas/transferencias', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearTransferenciaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (body.data.cuentaOrigenId === body.data.cuentaDestinoId) {
      return reply.badRequest('La cuenta de origen y la de destino deben ser distintas.')
    }

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      // Lock ambas cuentas en orden determinístico (menor id primero) para evitar deadlocks.
      const ids = [body.data.cuentaOrigenId, body.data.cuentaDestinoId].sort()
      const cuentasRes = await client.query<FilaCuentaBancaria>(
        `SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
         ORDER BY id FOR UPDATE`,
        [ids],
      )
      if (cuentasRes.rowCount !== 2) {
        await client.query('ROLLBACK')
        return reply.badRequest('Una o ambas cuentas bancarias no existen.')
      }

      const origen = cuentasRes.rows.find((c) => c.id === body.data.cuentaOrigenId)!
      if (Number(origen.saldo) < body.data.monto) {
        await client.query('ROLLBACK')
        return reply.badRequest(
          `Saldo insuficiente en la cuenta de origen ($${Number(origen.saldo).toLocaleString('es-CO')} disponible, se requieren $${body.data.monto.toLocaleString('es-CO')}).`,
        )
      }

      // Descontar del origen y sumar al destino.
      await client.query('UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2', [body.data.monto, body.data.cuentaOrigenId])
      await client.query('UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2', [body.data.monto, body.data.cuentaDestinoId])

      // Registro de auditoría.
      const { rows } = await client.query<FilaTransferencia>(
        `INSERT INTO transferencias_bancarias (cuenta_origen_id, cuenta_destino_id, monto, descripcion, fecha, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, cuenta_origen_id, cuenta_destino_id, monto, descripcion, fecha, usuario_id, created_at`,
        [
          body.data.cuentaOrigenId,
          body.data.cuentaDestinoId,
          body.data.monto,
          body.data.descripcion ?? null,
          body.data.fecha ?? new Date().toISOString().slice(0, 10),
          request.user.sub,
        ],
      )

      // Devolver también las cuentas actualizadas para que el frontend actualice el estado sin refetch.
      const cuentasActualizadasRes = await client.query<FilaCuentaBancaria>(
        'SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [[body.data.cuentaOrigenId, body.data.cuentaDestinoId]],
      )

      await client.query('COMMIT')
      return reply.status(201).send({
        transferencia: aTransferencia(rows[0]!),
        cuentas: cuentasActualizadasRes.rows.map(aCuentaBancaria),
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // DELETE /finanzas/transferencias/:id — revierte una transferencia.
  //
  // Es la única operación de dinero que no tenía vuelta atrás: una
  // transferencia mal hecha movía saldo real en dos cuentas y solo se podía
  // arreglar tocando la base a mano. El borrado es suave (queda la evidencia
  // de que existió) y los saldos vuelven exactos dentro de la misma tx.
  fastify.delete<{ Params: { id: string } }>('/finanzas/transferencias/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const { rows, rowCount } = await client.query<{
        cuenta_origen_id: string; cuenta_destino_id: string; monto: string
      }>(
        `SELECT cuenta_origen_id, cuenta_destino_id, monto FROM transferencias_bancarias
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [request.params.id],
      )
      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Transferencia no encontrada.')
      }
      const tr = rows[0]!
      const monto = Number(tr.monto)

      // Mismo orden determinístico que el POST para no generar deadlocks.
      const ids = [tr.cuenta_origen_id, tr.cuenta_destino_id].sort()
      const cuentasRes = await client.query<FilaCuentaBancaria>(
        `SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
         ORDER BY id FOR UPDATE`,
        [ids],
      )
      if (cuentasRes.rowCount !== 2) {
        await client.query('ROLLBACK')
        return reply.badRequest(
          'No se puede revertir: alguna de las cuentas de la transferencia ya no existe.',
        )
      }

      // Revertir es devolver el monto al origen y quitarlo del destino — pero
      // ese dinero ya pudo haberse gastado. Se bloquea en vez de dejar el
      // saldo en negativo (mismo criterio que el resto del módulo).
      const destino = cuentasRes.rows.find((c) => c.id === tr.cuenta_destino_id)!
      if (Number(destino.saldo) < monto) {
        await client.query('ROLLBACK')
        return reply.badRequest(
          `No se puede revertir: la cuenta destino ya no tiene el monto transferido ` +
          `($${Number(destino.saldo).toLocaleString('es-CO')} disponible, se requieren $${monto.toLocaleString('es-CO')}). ` +
          `Registra una transferencia en sentido contrario por lo que sí esté disponible.`,
        )
      }

      await client.query('UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2', [monto, tr.cuenta_origen_id])
      await client.query('UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2', [monto, tr.cuenta_destino_id])
      await client.query('UPDATE transferencias_bancarias SET deleted_at = NOW() WHERE id = $1', [request.params.id])

      const cuentasActualizadasRes = await client.query<FilaCuentaBancaria>(
        'SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [ids],
      )

      await client.query('COMMIT')
      return reply.send({ cuentas: cuentasActualizadasRes.rows.map(aCuentaBancaria) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // ─── GASTOS OPERATIVOS ────────────────────────────────────────────────────

  // ── Préstamos y retiros del socio (migración 028) ────────────────────────
  //
  // Todo lo de acá es `soloAdmin`: es la plata del dueño y el dato de cuánto le
  // debe al negocio, no algo que deba ver un empleado con login.

  // GET /finanzas/movimientos-socio — con el saldo de cada retiro ya calculado.
  fastify.get('/finanzas/movimientos-socio', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaMovimientoSocio>(
      // `devuelto` se DERIVA sumando las devoluciones imputadas, no se guarda —
      // mismo principio que el saldo de una factura (ver `calcularSaldoPendiente`).
      `SELECT m.id, m.tipo, m.socio, m.monto, m.fecha, m.cuenta_bancaria_id, m.retiro_id,
              m.notas, m.usuario_id, m.created_at,
              COALESCE((
                SELECT SUM(d.monto) FROM movimientos_socio d
                WHERE d.retiro_id = m.id AND d.tipo = 'devolucion' AND d.deleted_at IS NULL
              ), 0)::text AS devuelto
       FROM movimientos_socio m
       WHERE m.deleted_at IS NULL
       ORDER BY m.fecha DESC, m.created_at DESC`,
    )
    return reply.send({ movimientos: rows.map(aMovimientoSocio) })
  })

  // GET /finanzas/movimientos-socio/resumen — el número que el dueño busca:
  // "en banco X + prestado Y = capital real Z".
  fastify.get('/finanzas/movimientos-socio/resumen', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const [saldoRes, porSocioRes] = await Promise.all([
      request.tenantDb.query<{ total: string }>(
        `SELECT COALESCE(SUM(saldo), 0)::text AS total FROM cuentas_bancarias WHERE deleted_at IS NULL`,
      ),
      request.tenantDb.query<{ socio: string; retirado: string; devuelto: string }>(
        `SELECT socio,
                COALESCE(SUM(monto) FILTER (WHERE tipo = 'retiro'), 0)::text     AS retirado,
                COALESCE(SUM(monto) FILTER (WHERE tipo = 'devolucion'), 0)::text AS devuelto
         FROM movimientos_socio
         WHERE deleted_at IS NULL
         GROUP BY socio
         ORDER BY socio`,
      ),
    ])

    const porSocio = porSocioRes.rows.map((r) => {
      const retirado = Number(r.retirado)
      const devuelto = Number(r.devuelto)
      return { socio: r.socio, retirado, devuelto, saldoPendiente: retirado - devuelto }
    })

    const enBanco = Number(saldoRes.rows[0]!.total)
    // Lo prestado se suma al banco, no se resta: es plata del negocio que está
    // afuera. El retiro ya bajó el saldo bancario cuando se registró.
    const prestado = porSocio.reduce((acc, s) => acc + s.saldoPendiente, 0)

    const resumen: CapitalReal = { enBanco, prestado, capitalReal: enBanco + prestado, porSocio }
    return reply.send(resumen)
  })

  // POST /finanzas/movimientos-socio — mueve el saldo bancario en la misma
  // transacción, igual que hace un ingreso/gasto. NO toca `gastos_operativos`:
  // si entrara ahí, la utilidad bajaría por algo que no es un gasto.
  fastify.post('/finanzas/movimientos-socio', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearMovimientoSocioSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    const esRetiro = body.data.tipo === 'retiro'
    try {
      await client.query('BEGIN')

      const cuentaRes = await client.query<{ id: string; saldo: string }>(
        'SELECT id, saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [body.data.cuentaBancariaId],
      )
      if (cuentaRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.badRequest('La cuenta bancaria seleccionada no existe.')
      }

      // Se AVISA, no se bloquea, si el retiro deja la cuenta en negativo: quien
      // decide si saca la plata es el dueño (mismo criterio que el cupo de
      // crédito del cliente en la migración 022). Pero sí se rechaza sacar de
      // una cuenta que no alcanza, porque un saldo negativo descuadra el flujo.
      if (esRetiro && Number(cuentaRes.rows[0]!.saldo) < body.data.monto) {
        await client.query('ROLLBACK')
        return reply.badRequest(
          `La cuenta no tiene saldo suficiente: hay ${cuentaRes.rows[0]!.saldo} y el retiro es de ${body.data.monto}.`,
        )
      }

      // Una devolución imputada no puede exceder lo que ese retiro debe.
      if (body.data.retiroId) {
        const { rows } = await client.query<{ monto: string; devuelto: string; tipo: string }>(
          `SELECT m.monto, m.tipo,
                  COALESCE((
                    SELECT SUM(d.monto) FROM movimientos_socio d
                    WHERE d.retiro_id = m.id AND d.tipo = 'devolucion' AND d.deleted_at IS NULL
                  ), 0)::text AS devuelto
           FROM movimientos_socio m
           WHERE m.id = $1 AND m.deleted_at IS NULL FOR UPDATE OF m`,
          [body.data.retiroId],
        )
        const retiro = rows[0]
        if (!retiro) {
          await client.query('ROLLBACK')
          return reply.badRequest('El retiro al que querés imputar la devolución no existe.')
        }
        if (retiro.tipo !== 'retiro') {
          await client.query('ROLLBACK')
          return reply.badRequest('Solo se puede imputar una devolución a un retiro.')
        }
        const pendiente = Number(retiro.monto) - Number(retiro.devuelto)
        if (body.data.monto > pendiente) {
          await client.query('ROLLBACK')
          return reply.badRequest(
            `Ese retiro solo tiene ${pendiente} pendiente; no se puede devolver ${body.data.monto}.`,
          )
        }
      }

      const fecha = body.data.fecha ?? new Date().toISOString().slice(0, 10)
      const { rows } = await client.query<FilaMovimientoSocio>(
        `INSERT INTO movimientos_socio (tipo, socio, monto, fecha, cuenta_bancaria_id, retiro_id, notas, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, tipo, socio, monto, fecha, cuenta_bancaria_id, retiro_id, notas, usuario_id, created_at`,
        [
          body.data.tipo,
          body.data.socio.trim(),
          body.data.monto,
          fecha,
          body.data.cuentaBancariaId,
          body.data.retiroId ?? null,
          body.data.notas ?? null,
          request.user.sub,
        ],
      )

      // Retiro: sale plata. Devolución: vuelve.
      await client.query(
        `UPDATE cuentas_bancarias SET saldo = saldo ${esRetiro ? '-' : '+'} $1 WHERE id = $2`,
        [body.data.monto, body.data.cuentaBancariaId],
      )

      await client.query('COMMIT')
      return reply.status(201).send({ movimiento: aMovimientoSocio(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // PATCH /finanzas/movimientos-socio/:id — corrige monto/cuenta/fecha
  // revirtiendo el efecto anterior sobre el saldo y aplicando el nuevo, igual
  // que el PATCH de gastos. El `tipo` no se cambia: un retiro que pasa a
  // devolución es otro movimiento, no una corrección.
  fastify.patch<{ Params: { id: string } }>('/finanzas/movimientos-socio/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarMovimientoSocioSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const prevRes = await client.query<{ tipo: string; monto: string; cuenta_bancaria_id: string }>(
        'SELECT tipo, monto, cuenta_bancaria_id FROM movimientos_socio WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [request.params.id],
      )
      if (prevRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Movimiento no encontrado.')
      }
      const prev = prevRes.rows[0]!
      const esRetiro = prev.tipo === 'retiro'
      const montoNuevo = body.data.monto ?? Number(prev.monto)
      const cuentaNueva = body.data.cuentaBancariaId ?? prev.cuenta_bancaria_id

      // Revertir el efecto viejo y aplicar el nuevo. Si no cambió ni el monto ni
      // la cuenta las dos operaciones se cancelan, así que no hace falta
      // detectarlo aparte.
      await client.query(
        `UPDATE cuentas_bancarias SET saldo = saldo ${esRetiro ? '+' : '-'} $1 WHERE id = $2`,
        [Number(prev.monto), prev.cuenta_bancaria_id],
      )
      await client.query(
        `UPDATE cuentas_bancarias SET saldo = saldo ${esRetiro ? '-' : '+'} $1 WHERE id = $2`,
        [montoNuevo, cuentaNueva],
      )

      const campos: Record<string, unknown> = {
        socio: body.data.socio?.trim(),
        monto: body.data.monto,
        fecha: body.data.fecha,
        cuenta_bancaria_id: body.data.cuentaBancariaId,
        notas: body.data.notas,
      }
      const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
      const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')

      const { rows } = await client.query<FilaMovimientoSocio>(
        `UPDATE movimientos_socio SET ${sets} WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, tipo, socio, monto, fecha, cuenta_bancaria_id, retiro_id, notas, usuario_id, created_at`,
        [request.params.id, ...entradas.map(([, v]) => v)],
      )

      await client.query('COMMIT')
      return reply.send({ movimiento: aMovimientoSocio(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // DELETE /finanzas/movimientos-socio/:id — borrado suave que DEVUELVE el
  // efecto sobre el saldo bancario (si no, borrar un retiro dejaría la cuenta
  // descuadrada para siempre).
  fastify.delete<{ Params: { id: string } }>('/finanzas/movimientos-socio/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const prevRes = await client.query<{ tipo: string; monto: string; cuenta_bancaria_id: string }>(
        'SELECT tipo, monto, cuenta_bancaria_id FROM movimientos_socio WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [request.params.id],
      )
      if (prevRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Movimiento no encontrado.')
      }
      const prev = prevRes.rows[0]!

      // Borrar un retiro que ya tiene devoluciones imputadas dejaría esas
      // devoluciones apuntando a algo borrado y el saldo del socio sin sentido.
      if (prev.tipo === 'retiro') {
        const { rows } = await client.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM movimientos_socio
           WHERE retiro_id = $1 AND deleted_at IS NULL`,
          [request.params.id],
        )
        if (rows[0]!.n > 0) {
          await client.query('ROLLBACK')
          return reply.code(409).send({
            error: 'No se puede eliminar el retiro: tiene devoluciones imputadas.',
            devoluciones: rows[0]!.n,
            sugerencia: 'Eliminá primero esas devoluciones.',
          })
        }
      }

      await client.query(
        `UPDATE cuentas_bancarias SET saldo = saldo ${prev.tipo === 'retiro' ? '+' : '-'} $1 WHERE id = $2`,
        [Number(prev.monto), prev.cuenta_bancaria_id],
      )
      await client.query('UPDATE movimientos_socio SET deleted_at = NOW() WHERE id = $1', [request.params.id])

      await client.query('COMMIT')
      return reply.status(204).send()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // ── Categorías de gasto/ingreso del tenant (migración 027) ───────────────

  // GET /finanzas/categorias — el catálogo del negocio. `?incluirInactivas=true`
  // para el administrador; el selector de un formulario solo quiere las activas.
  fastify.get<{ Querystring: { incluirInactivas?: string } }>(
    '/finanzas/categorias',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const todas = request.query.incluirInactivas === 'true'
      const { rows } = await request.tenantDb.query<FilaCategoria>(
        `SELECT id, nombre, flujo, slug, afecta_utilidad, orden, activo, created_at
         FROM categorias_gasto
         ${todas ? '' : 'WHERE activo'}
         ORDER BY flujo, orden, nombre`,
      )
      return reply.send({ categorias: rows.map(aCategoria) })
    },
  )

  // POST /finanzas/categorias — crear un rubro propio. Solo admin: cambiar el
  // plan de cuentas afecta todos los reportes del negocio.
  fastify.post('/finanzas/categorias', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearCategoriaMovimientoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    try {
      const { rows } = await request.tenantDb.query<FilaCategoria>(
        `INSERT INTO categorias_gasto (nombre, flujo, afecta_utilidad, orden)
         VALUES ($1, $2, $3, COALESCE($4, (SELECT COALESCE(MAX(orden), 0) + 10 FROM categorias_gasto WHERE flujo = $2)))
         RETURNING id, nombre, flujo, slug, afecta_utilidad, orden, activo, created_at`,
        [body.data.nombre, body.data.flujo, body.data.afectaUtilidad, body.data.orden ?? null],
      )
      return reply.status(201).send({ categoria: aCategoria(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe una categoría activa llamada "${body.data.nombre}".`)
      }
      throw error
    }
  })

  // PATCH /finanzas/categorias/:id — renombrar, reordenar, marcar si afecta la
  // utilidad, o desactivar. `flujo` y `slug` no se tocan (ver el schema).
  fastify.patch<{ Params: { id: string } }>('/finanzas/categorias/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarCategoriaMovimientoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      nombre: body.data.nombre,
      afecta_utilidad: body.data.afectaUtilidad,
      orden: body.data.orden,
      activo: body.data.activo,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')

    try {
      const { rows, rowCount } = await request.tenantDb.query<FilaCategoria>(
        `UPDATE categorias_gasto SET ${sets} WHERE id = $1
         RETURNING id, nombre, flujo, slug, afecta_utilidad, orden, activo, created_at`,
        [request.params.id, ...entradas.map(([, v]) => v)],
      )
      if (rowCount === 0) return reply.notFound('Categoría no encontrada.')
      return reply.send({ categoria: aCategoria(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe una categoría activa con ese nombre.`)
      }
      throw error
    }
  })

  // DELETE /finanzas/categorias/:id — desactiva, NO borra.
  //
  // Borrar de verdad dejaría los movimientos ya registrados apuntando a la nada
  // (o los arrastraría por CASCADE, perdiendo gastos reales). Desactivar la
  // saca de los selectores y conserva el histórico: un reporte del año pasado
  // sigue mostrando "Arriendo" aunque el negocio ya no lo use.
  fastify.delete<{ Params: { id: string } }>('/finanzas/categorias/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { rows } = await request.tenantDb.query<{ usos: number; slug: string | null }>(
      `SELECT (
         (SELECT COUNT(*) FROM gastos_operativos  WHERE categoria_id = $1 AND deleted_at IS NULL) +
         (SELECT COUNT(*) FROM ingresos_bancarios WHERE categoria_id = $1 AND deleted_at IS NULL)
       )::int AS usos,
       (SELECT slug FROM categorias_gasto WHERE id = $1) AS slug`,
      [request.params.id],
    )
    const info = rows[0]!

    const { rowCount } = await request.tenantDb.query(
      'UPDATE categorias_gasto SET activo = false WHERE id = $1 AND activo',
      [request.params.id],
    )
    if (rowCount === 0) return reply.notFound('Categoría no encontrada o ya estaba inactiva.')

    return reply.send({ desactivada: true, movimientosQueLaUsan: info.usos })
  })

  // GET /finanzas/gastos — listado de gastos operativos.
  fastify.get('/finanzas/gastos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaGasto>(
      `SELECT ${COLS_GASTO}
       FROM gastos_operativos g
       LEFT JOIN categorias_gasto c ON c.id = g.categoria_id
       WHERE g.deleted_at IS NULL ORDER BY g.fecha DESC, g.created_at DESC`,
    )
    return reply.send({ gastos: rows.map(aGasto) })
  })

  // POST /finanzas/gastos — registra un gasto y, si se indicó cuenta bancaria, descuenta el monto.
  fastify.post('/finanzas/gastos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearGastoOperativoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      if (body.data.cuentaBancariaId) {
        const cuentaRes = await client.query<{ id: string; saldo: string }>(
          'SELECT id, saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [body.data.cuentaBancariaId],
        )
        if (cuentaRes.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('La cuenta bancaria seleccionada no existe.')
        }
        if (Number(cuentaRes.rows[0]!.saldo) < body.data.monto) {
          await client.query('ROLLBACK')
          return reply.badRequest(
            `Saldo insuficiente en la cuenta bancaria ($${Number(cuentaRes.rows[0]!.saldo).toLocaleString('es-CO')} disponible, se requieren $${body.data.monto.toLocaleString('es-CO')}).`,
          )
        }
      }

      const fecha = body.data.fecha ?? new Date().toISOString().slice(0, 10)

      // A crédito: en vez de mover el banco, el gasto queda como cuenta por
      // pagar al proveedor y se salda después con abonos. El gasto igual se
      // registra (la contabilidad es por causación: el arriendo de este mes es
      // gasto de este mes, se haya pagado o no); lo que cambia es de dónde sale
      // la plata y cuándo.
      let facturaCompraId: string | null = null
      if (body.data.aCredito) {
        const proveedorRes = await client.query<{ id: string }>(
          'SELECT id FROM proveedores WHERE id = $1 AND deleted_at IS NULL',
          [body.data.proveedorId],
        )
        if (proveedorRes.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('El proveedor indicado no existe.')
        }

        const fechaVenc = body.data.fechaVencimiento ?? (() => {
          const d = new Date(fecha); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10)
        })()
        const numeroFC = await generarNumeroFacturaCompra(client)
        const { rows: [fc] } = await client.query<{ id: string }>(
          `INSERT INTO facturas_compra (numero, proveedor_id, fecha_emision, fecha_vencimiento, total, notas)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [numeroFC, body.data.proveedorId, fecha, fechaVenc, body.data.monto, `Gasto a crédito — ${body.data.descripcion}`],
        )
        facturaCompraId = fc!.id
      }

      const cat = await resolverCategoria(client, 'egreso', body.data.categoriaId, body.data.categoria)

      const { rows } = await client.query<FilaGasto>(
        // CTE y no un RETURNING pelado: RETURNING no admite JOIN, y hace falta
        // devolver el nombre de la categoría ya resuelto.
        `WITH ins AS (
           INSERT INTO gastos_operativos (descripcion, categoria, categoria_id, monto, fecha, medio_pago, cuenta_bancaria_id, notas, proveedor_id, factura_compra_id, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *
         )
         SELECT ${COLS_GASTO} FROM ins g LEFT JOIN categorias_gasto c ON c.id = g.categoria_id`,
        [
          body.data.descripcion,
          cat.categoria,
          cat.categoriaId,
          body.data.monto,
          fecha,
          body.data.medioPago ?? null,
          body.data.cuentaBancariaId ?? null,
          body.data.notas ?? null,
          body.data.proveedorId ?? null,
          facturaCompraId,
          request.user.sub,
        ],
      )

      if (body.data.cuentaBancariaId) {
        await client.query(
          'UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2',
          [body.data.monto, body.data.cuentaBancariaId],
        )
      }

      await client.query('COMMIT')
      return reply.status(201).send({ gasto: aGasto(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // PATCH /finanzas/gastos/:id — corrige un gasto ya registrado.
  //
  // Si cambian el monto o la cuenta, se revierte el efecto anterior sobre el
  // saldo y se aplica el nuevo en la misma transacción. Antes no existía esta
  // ruta: corregir un typo obligaba a borrar y recrear, lo que dejaba en la
  // auditoría un "eliminó" que en realidad fue una corrección.
  fastify.patch<{ Params: { id: string } }>('/finanzas/gastos/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarGastoOperativoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No hay campos para actualizar.')

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const actualRes = await client.query<FilaGasto>(
        // `FOR UPDATE OF g`: con LEFT JOIN, Postgres rechaza bloquear el lado
        // nullable ("cannot be applied to the nullable side of an outer join"),
        // así que se bloquea solo la fila del gasto.
        `SELECT ${COLS_GASTO}
         FROM gastos_operativos g
         LEFT JOIN categorias_gasto c ON c.id = g.categoria_id
         WHERE g.id = $1 AND g.deleted_at IS NULL FOR UPDATE OF g`,
        [request.params.id],
      )
      if (actualRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Gasto no encontrado.')
      }
      const prev = actualRes.rows[0]!
      const montoPrev = Number(prev.monto)
      const cuentaPrev = prev.cuenta_bancaria_id
      const montoNuevo = body.data.monto ?? montoPrev
      const cuentaNueva = body.data.cuentaBancariaId !== undefined ? body.data.cuentaBancariaId : cuentaPrev

      // Un gasto a crédito se paga con abonos contra su CxP, nunca descontando
      // la cuenta acá. Si se permitiera, la plata saldría del banco, la CxP
      // quedaría abierta, y el flujo de caja no vería el egreso por ningún
      // lado: como gasto lo excluye el filtro `factura_compra_id IS NULL`, y
      // como abono nunca existió.
      if (prev.factura_compra_id && cuentaNueva) {
        await client.query('ROLLBACK')
        return reply.badRequest(
          'Este gasto quedó a crédito: se paga registrando un abono contra su cuenta por pagar, no descontándolo de una cuenta bancaria.',
        )
      }

      // El monto del gasto y el total de su CxP son el mismo número visto
      // desde dos lados. Se mueven juntos — y no se mueven si ya hay abonos,
      // porque bajar el total por debajo de lo abonado deja una factura
      // sobrepagada (la invariante que `verificar-integridad` vigila).
      if (prev.factura_compra_id && montoNuevo !== montoPrev) {
        const { rows: [ab] } = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(monto), 0)::text AS total FROM abonos
           WHERE tipo_documento = 'factura_compra' AND documento_id = $1 AND deleted_at IS NULL`,
          [prev.factura_compra_id],
        )
        if (Number(ab?.total ?? 0) > 0) {
          await client.query('ROLLBACK')
          return reply.badRequest(
            'Este gasto ya tiene pagos registrados contra su cuenta por pagar. Eliminá primero los abonos si necesitás corregir el monto.',
          )
        }
        await client.query(
          'UPDATE facturas_compra SET total = $1 WHERE id = $2 AND deleted_at IS NULL',
          [montoNuevo, prev.factura_compra_id],
        )
      }

      if (cuentaNueva !== cuentaPrev || montoNuevo !== montoPrev) {
        // Lock de todas las cuentas involucradas en orden determinístico.
        const involucradas = [...new Set([cuentaPrev, cuentaNueva].filter(Boolean) as string[])].sort()
        if (involucradas.length > 0) {
          await client.query(
            'SELECT id FROM cuentas_bancarias WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
            [involucradas],
          )
        }

        // 1) Revertir el descuento anterior (el gasto había restado del saldo).
        if (cuentaPrev) {
          await client.query(
            'UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2 AND deleted_at IS NULL',
            [montoPrev, cuentaPrev],
          )
        }
        // 2) Aplicar el nuevo descuento — la lectura ya refleja la reversa.
        if (cuentaNueva) {
          const cRes = await client.query<{ saldo: string }>(
            'SELECT saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL',
            [cuentaNueva],
          )
          if (cRes.rowCount === 0) {
            await client.query('ROLLBACK')
            return reply.badRequest('La cuenta bancaria seleccionada no existe.')
          }
          if (Number(cRes.rows[0]!.saldo) < montoNuevo) {
            await client.query('ROLLBACK')
            return reply.badRequest(
              `Saldo insuficiente en la cuenta bancaria ($${Number(cRes.rows[0]!.saldo).toLocaleString('es-CO')} disponible tras revertir el gasto anterior, se requieren $${montoNuevo.toLocaleString('es-CO')}).`,
            )
          }
          await client.query(
            'UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2',
            [montoNuevo, cuentaNueva],
          )
        }
      }

      const sets: string[] = []
      const valores: unknown[] = []
      const ag = (col: string, val: unknown) => { valores.push(val); sets.push(`${col} = $${valores.length}`) }
      if (body.data.descripcion !== undefined) ag('descripcion', body.data.descripcion)
      // Cambiar de categoría actualiza las dos columnas a la vez para que no
      // queden diciendo cosas distintas mientras ambas existan.
      if (body.data.categoriaId !== undefined || body.data.categoria !== undefined) {
        const cat = await resolverCategoria(client, 'egreso', body.data.categoriaId, body.data.categoria)
        ag('categoria', cat.categoria)
        ag('categoria_id', cat.categoriaId)
      }
      if (body.data.monto !== undefined) ag('monto', body.data.monto)
      if (body.data.fecha !== undefined) ag('fecha', body.data.fecha)
      if (body.data.medioPago !== undefined) ag('medio_pago', body.data.medioPago)
      if (body.data.cuentaBancariaId !== undefined) ag('cuenta_bancaria_id', body.data.cuentaBancariaId)
      if (body.data.notas !== undefined) ag('notas', body.data.notas)

      // Corregir la fecha del gasto corrige también la de emisión de su CxP,
      // por el mismo motivo que el monto: son el mismo hecho.
      if (prev.factura_compra_id && body.data.fecha !== undefined) {
        await client.query(
          'UPDATE facturas_compra SET fecha_emision = $1 WHERE id = $2 AND deleted_at IS NULL',
          [body.data.fecha, prev.factura_compra_id],
        )
      }

      valores.push(request.params.id)
      const { rows } = await client.query<FilaGasto>(
        `WITH upd AS (
           UPDATE gastos_operativos SET ${sets.join(', ')}
           WHERE id = $${valores.length} AND deleted_at IS NULL
           RETURNING *
         )
         SELECT ${COLS_GASTO} FROM upd g LEFT JOIN categorias_gasto c ON c.id = g.categoria_id`,
        valores,
      )

      await client.query('COMMIT')
      return reply.send({ gasto: aGasto(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // DELETE /finanzas/gastos/:id — borrado suave.
  // Si el gasto tenía cuenta bancaria, se revierte el descuento del saldo en la misma tx.
  fastify.delete<{ Params: { id: string } }>('/finanzas/gastos/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const { rows, rowCount } = await client.query<{ monto: string; cuenta_bancaria_id: string | null; factura_compra_id: string | null }>(
        'SELECT monto, cuenta_bancaria_id, factura_compra_id FROM gastos_operativos WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [request.params.id],
      )
      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Gasto no encontrado.')
      }

      const gasto = rows[0]!

      // Si el gasto quedó a crédito, borrarlo debe llevarse también su cuenta
      // por pagar — si no, quedaría una deuda sin gasto que la explique. Pero
      // no si ya se abonó: esos pagos salieron de una cuenta bancaria y hay que
      // revertirlos por su propia vía, que es la que devuelve la plata.
      if (gasto.factura_compra_id) {
        const { rows: [ab] } = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(monto), 0)::text AS total FROM abonos
           WHERE tipo_documento = 'factura_compra' AND documento_id = $1 AND deleted_at IS NULL`,
          [gasto.factura_compra_id],
        )
        if (Number(ab?.total ?? 0) > 0) {
          await client.query('ROLLBACK')
          return reply.badRequest(
            'Este gasto quedó a crédito y ya tiene pagos registrados. Eliminá primero los abonos (eso devuelve la plata a la cuenta) y después el gasto.',
          )
        }
        await client.query('UPDATE facturas_compra SET deleted_at = NOW() WHERE id = $1', [gasto.factura_compra_id])
      }

      await client.query('UPDATE gastos_operativos SET deleted_at = NOW() WHERE id = $1', [request.params.id])

      if (gasto.cuenta_bancaria_id) {
        // Al crear: se restó el monto. Al eliminar: se devuelve.
        await client.query(
          'UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2 AND deleted_at IS NULL',
          [gasto.monto, gasto.cuenta_bancaria_id],
        )
      }

      await client.query('COMMIT')
      return reply.status(204).send()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // ─── INGRESOS BANCARIOS ───────────────────────────────────────────────────

  // GET /finanzas/ingresos — historial de ingresos manuales.
  fastify.get('/finanzas/ingresos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaIngreso>(
      `SELECT ${COLS_INGRESO}
       FROM ingresos_bancarios i
       LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
       WHERE i.deleted_at IS NULL ORDER BY i.fecha DESC, i.created_at DESC`,
    )
    return reply.send({ ingresos: rows.map(aIngreso) })
  })

  // POST /finanzas/ingresos — registra un ingreso y suma el monto a la cuenta bancaria.
  fastify.post('/finanzas/ingresos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearIngresoBancarioSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const cuentaRes = await client.query<{ id: string; saldo: string }>(
        'SELECT id, saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [body.data.cuentaBancariaId],
      )
      if (cuentaRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.badRequest('La cuenta bancaria seleccionada no existe.')
      }

      const fecha = body.data.fecha ?? new Date().toISOString().slice(0, 10)
      const cat = await resolverCategoria(client, 'ingreso', body.data.categoriaId, body.data.categoria)
      const { rows } = await client.query<FilaIngreso>(
        `WITH ins AS (
           INSERT INTO ingresos_bancarios (descripcion, categoria, categoria_id, monto, fecha, medio_pago, cuenta_bancaria_id, notas, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *
         )
         SELECT ${COLS_INGRESO} FROM ins i LEFT JOIN categorias_gasto c ON c.id = i.categoria_id`,
        [
          body.data.descripcion,
          cat.categoria,
          cat.categoriaId,
          body.data.monto,
          fecha,
          body.data.medioPago ?? null,
          body.data.cuentaBancariaId,
          body.data.notas ?? null,
          request.user.sub,
        ],
      )

      await client.query(
        'UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2',
        [body.data.monto, body.data.cuentaBancariaId],
      )

      await client.query('COMMIT')
      return reply.status(201).send({ ingreso: aIngreso(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // PATCH /finanzas/ingresos/:id — corrige un ingreso ya registrado.
  // Espejo del PATCH de gastos, con los signos invertidos: el ingreso había
  // SUMADO al saldo, así que revertir es restar.
  fastify.patch<{ Params: { id: string } }>('/finanzas/ingresos/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarIngresoBancarioSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No hay campos para actualizar.')

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const actualRes = await client.query<FilaIngreso>(
        `SELECT ${COLS_INGRESO}
         FROM ingresos_bancarios i
         LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
         WHERE i.id = $1 AND i.deleted_at IS NULL FOR UPDATE OF i`,
        [request.params.id],
      )
      if (actualRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Ingreso no encontrado.')
      }
      const prev = actualRes.rows[0]!
      const montoPrev = Number(prev.monto)
      const cuentaPrev = prev.cuenta_bancaria_id
      const montoNuevo = body.data.monto ?? montoPrev
      const cuentaNueva = body.data.cuentaBancariaId ?? cuentaPrev

      if (cuentaNueva !== cuentaPrev || montoNuevo !== montoPrev) {
        const involucradas = [...new Set([cuentaPrev, cuentaNueva])].sort()
        const lockRes = await client.query<{ id: string; saldo: string }>(
          'SELECT id, saldo FROM cuentas_bancarias WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
          [involucradas],
        )
        if (lockRes.rowCount !== involucradas.length) {
          await client.query('ROLLBACK')
          return reply.badRequest('La cuenta bancaria seleccionada no existe.')
        }

        // Revertir el ingreso anterior es SACAR esa plata de la cuenta — pero
        // pudo haberse gastado ya. Se bloquea en vez de dejar saldo negativo.
        const saldoPrev = Number(lockRes.rows.find((c) => c.id === cuentaPrev)!.saldo)
        if (saldoPrev < montoPrev) {
          await client.query('ROLLBACK')
          return reply.badRequest(
            `No se puede corregir: la cuenta ya no tiene el monto del ingreso original ` +
            `($${saldoPrev.toLocaleString('es-CO')} disponible, el ingreso fue de $${montoPrev.toLocaleString('es-CO')}). ` +
            `Registra el ajuste como un movimiento aparte.`,
          )
        }

        await client.query('UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2', [montoPrev, cuentaPrev])
        await client.query('UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2', [montoNuevo, cuentaNueva])
      }

      const sets: string[] = []
      const valores: unknown[] = []
      const ag = (col: string, val: unknown) => { valores.push(val); sets.push(`${col} = $${valores.length}`) }
      if (body.data.descripcion !== undefined) ag('descripcion', body.data.descripcion)
      // Cambiar de categoría actualiza las dos columnas a la vez para que no
      // queden diciendo cosas distintas mientras ambas existan.
      if (body.data.categoriaId !== undefined || body.data.categoria !== undefined) {
        const cat = await resolverCategoria(client, 'ingreso', body.data.categoriaId, body.data.categoria)
        ag('categoria', cat.categoria)
        ag('categoria_id', cat.categoriaId)
      }
      if (body.data.monto !== undefined) ag('monto', body.data.monto)
      if (body.data.fecha !== undefined) ag('fecha', body.data.fecha)
      if (body.data.medioPago !== undefined) ag('medio_pago', body.data.medioPago)
      if (body.data.cuentaBancariaId !== undefined) ag('cuenta_bancaria_id', body.data.cuentaBancariaId)
      if (body.data.notas !== undefined) ag('notas', body.data.notas)

      valores.push(request.params.id)
      const { rows } = await client.query<FilaIngreso>(
        `WITH upd AS (
           UPDATE ingresos_bancarios SET ${sets.join(', ')}
           WHERE id = $${valores.length} AND deleted_at IS NULL
           RETURNING *
         )
         SELECT ${COLS_INGRESO} FROM upd i LEFT JOIN categorias_gasto c ON c.id = i.categoria_id`,
    
        valores,
      )

      await client.query('COMMIT')
      return reply.send({ ingreso: aIngreso(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // DELETE /finanzas/ingresos/:id — borrado suave; revierte el saldo bancario.
  fastify.delete<{ Params: { id: string } }>('/finanzas/ingresos/:id', soloAdmin, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const { rows, rowCount } = await client.query<{ monto: string; cuenta_bancaria_id: string }>(
        'SELECT monto, cuenta_bancaria_id FROM ingresos_bancarios WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [request.params.id],
      )
      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('Ingreso no encontrado.')
      }

      await client.query('UPDATE ingresos_bancarios SET deleted_at = NOW() WHERE id = $1', [request.params.id])

      const ingreso = rows[0]!
      await client.query(
        'UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2 AND deleted_at IS NULL',
        [ingreso.monto, ingreso.cuenta_bancaria_id],
      )

      await client.query('COMMIT')
      return reply.status(204).send()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // ─── RESUMEN FINANCIERO ───────────────────────────────────────────────────

  // GET /finanzas/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  // Si no se pasan fechas, usa el mes en curso.
  fastify.get<{ Querystring: { desde?: string; hasta?: string } }>('/finanzas/resumen', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const hoy = new Date()
    const desde = request.query.desde ?? new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10)
    const hasta = request.query.hasta ?? new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10)

    const db = request.tenantDb

    const [cxcRes, cxpRes, gastosRes, ingresosRes, saldoRes, facturasCxcRes, facturasCxpRes] = await Promise.all([
      // Abonos CxC cobrados en el periodo
      db.query<{ total: string }>(
        `SELECT COALESCE(SUM(monto), 0)::text AS total FROM abonos
         WHERE tipo_documento = 'factura_venta' AND deleted_at IS NULL AND fecha BETWEEN $1 AND $2`,
        [desde, hasta],
      ),
      // Abonos CxP pagados en el periodo
      db.query<{ total: string }>(
        `SELECT COALESCE(SUM(monto), 0)::text AS total FROM abonos
         WHERE tipo_documento = 'factura_compra' AND deleted_at IS NULL AND fecha BETWEEN $1 AND $2`,
        [desde, hasta],
      ),
      // Gastos operativos del periodo que SALIERON DE CAJA.
      //
      // Se excluyen los que quedaron a crédito (`factura_compra_id IS NOT NULL`):
      // esos todavía no movieron plata, y cuando se paguen van a entrar acá
      // igual por `egresosCxP`, que suma los abonos a facturas de compra.
      // Contarlos en ambos lados inflaría el egreso del flujo de caja al doble.
      //
      // OJO: este filtro va SOLO acá. `reportes.ts` (utilidad neta) es por
      // causación — el arriendo de este mes es gasto de este mes, se haya
      // pagado o no — y ahí el gasto debe contarse una vez, sin filtrar.
      db.query<{ total: string }>(
        `SELECT COALESCE(SUM(monto), 0)::text AS total FROM gastos_operativos
         WHERE deleted_at IS NULL AND factura_compra_id IS NULL AND fecha BETWEEN $1 AND $2`,
        [desde, hasta],
      ),
      // Ingresos manuales del periodo
      db.query<{ total: string }>(
        `SELECT COALESCE(SUM(monto), 0)::text AS total FROM ingresos_bancarios
         WHERE deleted_at IS NULL AND fecha BETWEEN $1 AND $2`,
        [desde, hasta],
      ),
      // Saldo total en cuentas bancarias activas
      db.query<{ total: string }>(
        `SELECT COALESCE(SUM(saldo), 0)::text AS total FROM cuentas_bancarias WHERE deleted_at IS NULL`,
      ),
      // Facturas CxC activas con sus abonos (para calcular saldo pendiente)
      db.query<{ total: string; abonado: string }>(
        `SELECT fv.total::text, COALESCE(SUM(ab.monto), 0)::text AS abonado
         FROM facturas_venta fv
         LEFT JOIN abonos ab ON ab.documento_id = fv.id AND ab.tipo_documento = 'factura_venta' AND ab.deleted_at IS NULL
         WHERE fv.deleted_at IS NULL
         GROUP BY fv.id, fv.total`,
      ),
      // Facturas CxP activas con sus abonos
      db.query<{ total: string; abonado: string }>(
        `SELECT fc.total::text, COALESCE(SUM(ab.monto), 0)::text AS abonado
         FROM facturas_compra fc
         LEFT JOIN abonos ab ON ab.documento_id = fc.id AND ab.tipo_documento = 'factura_compra' AND ab.deleted_at IS NULL
         WHERE fc.deleted_at IS NULL
         GROUP BY fc.id, fc.total`,
      ),
    ])

    const cxcPendiente = facturasCxcRes.rows.reduce((acc, r) => acc + Math.max(0, Number(r.total) - Number(r.abonado)), 0)
    const cxpPendiente = facturasCxpRes.rows.reduce((acc, r) => acc + Math.max(0, Number(r.total) - Number(r.abonado)), 0)

    const ingresosCxC = Number(cxcRes.rows[0]!.total)
    const ingresosManuales = Number(ingresosRes.rows[0]!.total)
    const egresosCxP = Number(cxpRes.rows[0]!.total)
    const egresosGastos = Number(gastosRes.rows[0]!.total)

    const resumen: ResumenFinanciero = {
      periodo: { desde, hasta },
      ingresosCxC,
      ingresosManuales,
      egresosCxP,
      egresosGastos,
      flujoNeto: (ingresosCxC + ingresosManuales) - (egresosCxP + egresosGastos),
      saldoCuentas: Number(saldoRes.rows[0]!.total),
      cxcPendiente,
      cxpPendiente,
    }

    return reply.send({ resumen })
  })
}

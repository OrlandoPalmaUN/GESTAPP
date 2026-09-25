/** `cxc` = cuentas por cobrar (facturas de venta, a clientes); `cxp` = cuentas por pagar (facturas de compra, a proveedores). */
export const TIPOS_FACTURA = ['cxc', 'cxp'] as const
export type TipoFactura = (typeof TIPOS_FACTURA)[number]

export const ESTADOS_FACTURA = ['pagada', 'pendiente', 'vencida'] as const
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number]

/**
 * Factura (de venta o de compra) — el saldo y el estado NUNCA se guardan: se
 * derivan de `total - Σ(abonos)` y de la fecha de vencimiento (mismo principio
 * que "el stock nunca se escribe directo": ver `calcularStockDisponible`).
 * La API siempre los calcula server-side (`calcularSaldoPendiente`/`calcularEstadoFactura`)
 * y los expone ya resueltos — el frontend solo los muestra.
 */
export interface Factura {
  id: string
  numero: string
  tipo: TipoFactura
  clienteId: string | null
  proveedorId: string | null
  pedidoId: string | null
  fechaEmision: string
  fechaVencimiento: string
  total: number
  notas: string | null
  saldoPendiente: number
  estado: EstadoFactura
  createdAt: string
}

/** `tipoDocumento` es la representación interna en BD; `Factura.tipo` ('cxc'/'cxp') es la de cara a la UI — se mapean 1:1. */
export const TIPO_DOCUMENTO_POR_TIPO_FACTURA: Record<TipoFactura, 'factura_venta' | 'factura_compra'> = {
  cxc: 'factura_venta',
  cxp: 'factura_compra',
}

export interface Abono {
  id: string
  facturaId: string
  tipoDocumento: 'factura_venta' | 'factura_compra'
  monto: number
  fecha: string
  medioPago: string | null
  referencia: string | null
  usuarioId: string | null
  createdAt: string
}

export const TIPOS_CUENTA_BANCARIA = ['ahorros', 'corriente'] as const
export type TipoCuentaBancaria = (typeof TIPOS_CUENTA_BANCARIA)[number]

/**
 * Cuenta bancaria del tenant — antes vivía hardcodeada en el frontend
 * (`INITIAL_BANK_ACCOUNTS`); ahora es una tabla real (`cuentas_bancarias`)
 * para que cada empresa registre las suyas.
 */
export interface CuentaBancaria {
  id: string
  banco: string
  numero: string
  tipo: TipoCuentaBancaria
  saldo: number
  createdAt: string
}

/** Transferencia entre dos cuentas bancarias del mismo tenant — registro de auditoría. */
export interface TransferenciaBancaria {
  id: string
  cuentaOrigenId: string
  cuentaDestinoId: string
  monto: number
  descripcion: string | null
  fecha: string
  usuarioId: string | null
  createdAt: string
}

/**
 * Tipos de gasto. FUENTE DE VERDAD — debe coincidir con el CHECK de
 * `gastos_operativos.categoria` (migración 023). Solo se agrega: hay filas
 * vivas con los valores viejos.
 *
 * No existe una categoría de "compra de inventario": esa plata se registra
 * como `pedidos_proveedor` para que entre al stock y genere la CxP. Si se
 * guardara como gasto, los reportes la restarían de la utilidad neta y además
 * volverían a restar el costo de esa misma mercancía al venderla.
 */
export const CATEGORIAS_GASTO = [
  'arriendo',
  'servicios',
  'nomina',
  'comisiones',
  'marketing',
  'transporte',
  'impuestos',
  'mantenimiento',
  'honorarios',
  'financieros',
  'otros',
] as const
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]

/** Egreso o ingreso — de qué lado del flujo clasifica una categoría. */
export const FLUJOS_CATEGORIA = ['egreso', 'ingreso'] as const
export type FlujoCategoria = (typeof FLUJOS_CATEGORIA)[number]

/**
 * Categoría de gasto/ingreso DEFINIDA POR EL TENANT (tabla `categorias_gasto`,
 * migración 027). Reemplaza a `CATEGORIAS_GASTO`/`CATEGORIAS_INGRESO` como
 * fuente de verdad: esos arrays quedan solo como la semilla que la migración
 * inserta y como referencia de los slugs históricos.
 */
export interface CategoriaMovimiento {
  id: string
  nombre: string
  flujo: FlujoCategoria
  /**
   * Slug de las categorías sembradas de fábrica (`'arriendo'`, `'nomina'`…).
   * `null` = la creó el negocio. Sirve para mapear las filas viejas, cuya
   * columna `categoria` TEXT guarda justamente este valor.
   */
  slug: string | null
  /**
   * `false` = mueve plata pero NO es gasto/ingreso del negocio (un aporte de
   * capital, un préstamo al socio). Queda fuera de la utilidad, pero SÍ entra
   * al flujo de caja: la plata se movió de verdad. Ver migración 027.
   */
  afectaUtilidad: boolean
  orden: number
  activo: boolean
  createdAt: string
}

/** Gasto operativo del negocio (arriendo, servicios, nómina, etc.). */
export interface GastoOperativo {
  id: string
  descripcion: string
  /**
   * Slug histórico (columna `categoria` TEXT). Se conserva por compatibilidad
   * mientras la columna exista; para mostrar, usar `categoriaNombre`.
   */
  categoria: string
  /** Categoría del tenant. `null` solo en filas que quedaran sin mapear. */
  categoriaId: string | null
  /** Nombre resuelto de la categoría — evita que el front tenga que cruzar. */
  categoriaNombre: string | null
  /** Del `afecta_utilidad` de su categoría. `null` si no tiene categoría. */
  afectaUtilidad: boolean | null
  monto: number
  fecha: string
  medioPago: string | null
  cuentaBancariaId: string | null
  notas: string | null
  /** Solo en gastos a crédito: a quién se le debe. */
  proveedorId: string | null
  /** CxP generada cuando el gasto quedó debiendo. `null` = se pagó al momento. */
  facturaCompraId: string | null
  usuarioId: string | null
  createdAt: string
}

export const CATEGORIAS_INGRESO = ['capital', 'prestamo', 'devolucion', 'venta_activo', 'otro'] as const
export type CategoriaIngreso = (typeof CATEGORIAS_INGRESO)[number]

/** Ingreso manual a una cuenta bancaria — capital, préstamos, devoluciones, etc. */
export interface IngresoBancario {
  id: string
  descripcion: string
  /** Slug histórico. Para mostrar, usar `categoriaNombre`. Ver `GastoOperativo`. */
  categoria: string
  categoriaId: string | null
  categoriaNombre: string | null
  afectaUtilidad: boolean | null
  monto: number
  fecha: string
  medioPago: string | null
  cuentaBancariaId: string
  notas: string | null
  usuarioId: string | null
  createdAt: string
}

/** Resumen financiero del periodo — ingresos, egresos y flujo neto. */
export interface ResumenFinanciero {
  periodo: { desde: string; hasta: string }
  ingresosCxC: number      // abonos CxC cobrados en el periodo
  ingresosManuales: number // ingresos_bancarios del periodo
  egresosCxP: number       // abonos CxP pagados en el periodo
  egresosGastos: number    // gastos_operativos del periodo
  flujoNeto: number        // (ingresosCxC + ingresosManuales) - (egresosCxP + egresosGastos)
  saldoCuentas: number     // suma actual de saldo en cuentas_bancarias activas
  cxcPendiente: number     // total por cobrar (saldoPendiente CxC no pagadas)
  cxpPendiente: number     // total por pagar (saldoPendiente CxP no pagadas)
}

/** `total - Σ(abonos)`, nunca negativo (un abono no puede exceder el saldo — lo valida la API al crear). */
export function calcularSaldoPendiente(total: number, abonos: Pick<Abono, 'monto'>[]): number {
  const abonado = abonos.reduce((acc, a) => acc + a.monto, 0)
  return Math.max(0, total - abonado)
}

/** `pagada` si el saldo llegó a cero; si no, `vencida` cuando ya pasó la fecha de vencimiento, o `pendiente`. */
export function calcularEstadoFactura(saldoPendiente: number, fechaVencimiento: string, hoy: Date = new Date()): EstadoFactura {
  if (saldoPendiente <= 0) return 'pagada'
  return new Date(fechaVencimiento).getTime() < hoy.getTime() ? 'vencida' : 'pendiente'
}

/** Retiro o devolución — ver `movimientos_socio` (migración 028). */
export const TIPOS_MOVIMIENTO_SOCIO = ['retiro', 'devolucion'] as const
export type TipoMovimientoSocio = (typeof TIPOS_MOVIMIENTO_SOCIO)[number]

/**
 * Plata que el dueño saca del negocio como préstamo (y lo que devuelve).
 *
 * NO es un gasto: es un activo que cambia de forma —plata en banco por derecho
 * de cobro—, así que baja el saldo bancario pero no toca la utilidad. Ver el
 * comentario de la migración 028.
 */
export interface MovimientoSocio {
  id: string
  tipo: TipoMovimientoSocio
  socio: string
  monto: number
  fecha: string
  cuentaBancariaId: string
  /** Solo en devoluciones: a qué retiro abona. `null` = no imputada a uno puntual. */
  retiroId: string | null
  notas: string | null
  usuarioId: string | null
  createdAt: string
  /** Solo en retiros: cuánto de ESTE retiro ya se devolvió. */
  devuelto?: number
  /** Solo en retiros: `monto - devuelto`. */
  saldoPendiente?: number
}

/** Cuánto sacó y cuánto debe cada socio. Ver GET /finanzas/movimientos-socio/resumen. */
export interface ResumenSocio {
  socio: string
  retirado: number
  devuelto: number
  saldoPendiente: number
}

/**
 * El número que el dueño quiere ver de un vistazo: la plata del negocio está
 * partida entre lo que hay en el banco y lo que está prestado afuera.
 */
export interface CapitalReal {
  enBanco: number
  prestado: number
  /** `enBanco + prestado` — el capital que el negocio tiene, esté donde esté. */
  capitalReal: number
  porSocio: ResumenSocio[]
}

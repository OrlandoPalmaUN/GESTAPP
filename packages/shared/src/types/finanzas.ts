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

export const CATEGORIAS_GASTO = ['arriendo', 'servicios', 'nomina', 'comisiones', 'marketing', 'otros'] as const
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]

/** Gasto operativo del negocio (arriendo, servicios, nómina, etc.). */
export interface GastoOperativo {
  id: string
  descripcion: string
  categoria: CategoriaGasto
  monto: number
  fecha: string
  medioPago: string | null
  cuentaBancariaId: string | null
  notas: string | null
  usuarioId: string | null
  createdAt: string
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

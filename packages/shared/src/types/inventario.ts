/**
 * Tipos de movimiento de inventario (plan §5.1). Principio fundamental: el
 * stock nunca se modifica directamente, todo cambio queda registrado como
 * un movimiento — el stock disponible es la suma de estos movimientos.
 */
export const TIPOS_MOVIMIENTO = [
  'entrada_compra', // Recepción de mercancía de proveedor
  'salida_venta', // Venta despachada
  'salida_devolucion', // Devolución a proveedor
  'entrada_devolucion', // Devolución de cliente
  'ajuste_positivo', // Corrección de inventario (diferencia física)
  'ajuste_negativo', // Corrección de inventario (merma)
  'reserva', // Pedido confirmado, aún no despachado
  'liberacion_reserva', // Pedido cancelado, stock reservado liberado
] as const

export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number]

/** Movimientos que SUMAN al stock disponible — el resto resta (ver `calcularStockDisponible`). */
export const MOVIMIENTOS_DE_ENTRADA: readonly TipoMovimiento[] = [
  'entrada_compra',
  'entrada_devolucion',
  'ajuste_positivo',
  'liberacion_reserva',
]

/** Categoría de producto — agrupación simple, sin jerarquía (plan §9). */
export interface Categoria {
  id: string
  nombre: string
  createdAt: string
}

/** Producto del catálogo de un tenant — vive en SU schema, no en el público. */
export interface Producto {
  id: string
  sku: string | null
  nombre: string
  descripcion: string | null
  categoriaId: string | null
  precioCosto: number | null
  precioVenta: number | null
  unidad: string
  stockMinimo: number
  activo: boolean
  createdAt: string
  /** Calculado: suma de movimientos de inventario — no se persiste como columna (fuente de verdad = movimientos). */
  stockDisponible: number
}

/** Movimiento de inventario — registro inmutable, fuente de verdad del stock. */
export interface MovimientoInventario {
  id: string
  productoId: string
  tipo: TipoMovimiento
  cantidad: number
  precioUnitario: number | null
  referenciaTipo: string | null
  referenciaId: string | null
  notas: string | null
  usuarioId: string | null
  createdAt: string
}

/**
 * Calcula el stock disponible de un producto a partir de sus movimientos —
 * la MISMA regla que usa el frontend (mockData) y que debe vivir aquí para
 * que servidor y cliente nunca diverjan en el cálculo.
 */
export function calcularStockDisponible(movimientos: Pick<MovimientoInventario, 'tipo' | 'cantidad'>[]): number {
  return movimientos.reduce((stock, mov) => {
    const esEntrada = MOVIMIENTOS_DE_ENTRADA.includes(mov.tipo)
    return esEntrada ? stock + mov.cantidad : stock - mov.cantidad
  }, 0)
}

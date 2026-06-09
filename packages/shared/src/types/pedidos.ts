// ─────────────────────────────────────────────────
// Pedidos a proveedores (órdenes de compra)
// ─────────────────────────────────────────────────

export const ESTADOS_PEDIDO_PROVEEDOR = [
  'borrador',
  'enviado',
  'recibido_parcial',
  'recibido',
  'cancelado',
] as const

export type EstadoPedidoProveedor = (typeof ESTADOS_PEDIDO_PROVEEDOR)[number]

export const TRANSICIONES_VALIDAS_PROVEEDOR: Record<EstadoPedidoProveedor, EstadoPedidoProveedor[]> = {
  borrador: ['enviado', 'cancelado'],
  enviado: ['recibido_parcial', 'recibido', 'cancelado'],
  recibido_parcial: ['recibido', 'cancelado'],
  recibido: [],
  cancelado: [],
}

export interface PedidoProveedorItem {
  id: string
  pedidoProveedorId: string
  productoId: string | null
  concepto: string | null
  cantidad: number
  precioUnitario: number
  subtotal: number
}

export interface PedidoProveedor {
  id: string
  numero: string
  proveedorId: string | null
  estado: EstadoPedidoProveedor
  fechaEsperada: string | null
  notas: string | null
  total: number
  facturaCompraId: string | null
  usuarioId: string | null
  createdAt: string
  updatedAt: string
  items: PedidoProveedorItem[]
}

// ─────────────────────────────────────────────────
// Pedidos de venta a clientes (original)
// ─────────────────────────────────────────────────

/**
 * Estados de un pedido y su máquina de estados (plan §5.2):
 *
 *   borrador → confirmado → en_preparacion → despachado → entregado
 *                 ↓                                              ↑
 *              cancelado ←─────────────────────────── (solo si no entregado)
 */
export const ESTADOS_PEDIDO = [
  'borrador',
  'confirmado',
  'en_preparacion',
  'despachado',
  'entregado',
  'cancelado',
] as const

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number]

/**
 * Transiciones válidas por estado — lista vacía significa estado terminal.
 * Esta es la regla de negocio que tanto la API (al cambiar el estado de un
 * pedido) como el frontend (al decidir qué acciones mostrar) deben respetar,
 * de ahí que viva en `shared` y no duplicada en cada lado.
 */
export const TRANSICIONES_VALIDAS: Record<EstadoPedido, EstadoPedido[]> = {
  borrador: ['confirmado', 'cancelado'],
  confirmado: ['en_preparacion', 'cancelado'],
  en_preparacion: ['despachado', 'cancelado'],
  despachado: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
}

/** Cliente del tenant — vive en su schema (tabla `clientes`). */
export interface Cliente {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  activo: boolean
  createdAt: string
}

/**
 * Línea de un pedido — normalmente referencia un producto del catálogo, pero
 * también puede ser un "cargo libre" (p.ej. Envío): un ítem dinámico que NO
 * está en el catálogo, identificado por `concepto` en vez de `productoId`.
 * Es exactamente uno de los dos — `productoId` XOR `concepto` (ver
 * `crearPedidoItemSchema`, que valida esa exclusividad).
 */
export interface PedidoItem {
  id: string
  productoId: string | null
  /** Solo presente en cargos libres (`productoId === null`) — p.ej. "Envío". */
  concepto: string | null
  cantidad: number
  precioUnitario: number
  subtotal: number
  /**
   * Snapshot del costo AL MOMENTO de crear el pedido — se copia del catálogo
   * (o, en cargos libres como Envío, se iguala al precio: el envío se cobra
   * "a costo", sin margen, pero igual debe pagarlo el cliente) y queda fijo,
   * así el margen calculado no se mueve si luego cambia el costo del
   * producto en inventario. `null` si el producto no tenía costo cargado.
   */
  precioCosto: number | null
}

/**
 * Margen de una línea de pedido — `precioUnitario` puede ser "excepcional"
 * (un precio puntual distinto al de catálogo, p.ej. por un descuento
 * negociado), así que el margen real solo se puede calcular comparándolo
 * contra el costo. `null` cuando no hay costo cargado (no se puede calcular).
 */
export function calcularMargenItem(item: Pick<PedidoItem, 'precioUnitario' | 'precioCosto'>): {
  margenUnitario: number | null
  margenPorcentaje: number | null
} {
  if (item.precioCosto === null) return { margenUnitario: null, margenPorcentaje: null }
  const margenUnitario = item.precioUnitario - item.precioCosto
  const margenPorcentaje = item.precioUnitario > 0 ? (margenUnitario / item.precioUnitario) * 100 : null
  return { margenUnitario, margenPorcentaje }
}

/** Pedido — cabecera + items, con su máquina de estados (ver `TRANSICIONES_VALIDAS`). */
export interface Pedido {
  id: string
  numero: string
  clienteId: string | null
  estado: EstadoPedido
  total: number
  notas: string | null
  usuarioId: string | null
  createdAt: string
  updatedAt: string
  items: PedidoItem[]
}

/**
 * Movimientos de inventario que cada transición de estado dispara — la misma
 * regla que aplica el servidor (ver `routes/tenant/pedidos.ts`) y que el
 * frontend puede usar para anticipar/explicar el efecto de cada acción.
 * Ausente del mapa = "no genera movimientos automáticos".
 *
 * OJO con `en_preparacion->despachado`: NO basta con un `salida_venta`. La
 * `reserva` registrada al confirmar ya restó esas unidades del disponible —
 * si al despachar solo restamos de nuevo (`salida_venta`), el producto queda
 * descontado DOBLE (reserva + salida) por una sola venta física. La cuenta
 * correcta es: liberar la reserva (+cantidad, ya no está "apartado") y
 * registrar la salida real (-cantidad) — el neto es -cantidad, que es
 * exactamente lo que physically salió del inventario.
 */
export const MOVIMIENTOS_POR_TRANSICION: Partial<Record<`${EstadoPedido}->${EstadoPedido}`, ReadonlyArray<'reserva' | 'liberacion_reserva' | 'salida_venta'>>> = {
  'borrador->confirmado': ['reserva'],
  'confirmado->cancelado': ['liberacion_reserva'],
  'en_preparacion->cancelado': ['liberacion_reserva'],
  'en_preparacion->despachado': ['liberacion_reserva', 'salida_venta'],
}

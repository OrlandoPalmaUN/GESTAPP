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
  cantidadRecibida: number
  precioUnitario: number
  subtotal: number
}

export interface PedidoProveedor {
  id: string
  numero: string
  proveedorId: string | null
  estado: EstadoPedidoProveedor
  /**
   * Fecha de negocio de la compra (`YYYY-MM-DD`). Antes se usaba `createdAt`,
   * que es timestamptz: en UTC-5 el límite del mes se corría ~5 horas respecto
   * de los gastos (que sí usan `fecha`), y no se podía retro-fechar una compra.
   */
  fecha: string
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
 * Transiciones válidas por estado — cualquier estado puede pasar a cualquier
 * otro. Los movimientos de inventario solo se generan para las transiciones
 * definidas en MOVIMIENTOS_POR_TRANSICION; las demás cambian el estado sin
 * efecto en stock (útil para correcciones manuales).
 */
export const TRANSICIONES_VALIDAS: Record<EstadoPedido, EstadoPedido[]> = Object.fromEntries(
  ESTADOS_PEDIDO.map((estado) => [estado, ESTADOS_PEDIDO.filter((e) => e !== estado)]),
) as Record<EstadoPedido, EstadoPedido[]>

/** Cliente del tenant — vive en su schema (tabla `clientes`). */
export interface Cliente {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  /**
   * Apartamento / casa dentro del conjunto. `null` = no aplica.
   *
   * Existe porque un negocio que reparte en su propio edificio identifica al
   * cliente por acá y no por el nombre — y la `direccion` es la misma para
   * todos, así que no distingue. Texto libre: "502", "Torre 3 - 1204", "Casa 2".
   * La interfaz que lo muestra va detrás del tema `8bit` (ver migración 026).
   */
  apartamento: string | null
  ciudad: string | null
  activo: boolean
  /**
   * Días de plazo para pagar. `0` = contado, `null` = usar el default (30).
   * Determina el vencimiento de la CxC que genera cada pedido.
   */
  plazoDias: number | null
  /**
   * Tope de deuda acordado. `null` = sin límite. La app AVISA al superarlo,
   * no bloquea: seguir vendiéndole a alguien que ya debe es una decisión del
   * dueño, no del software.
   */
  cupoCredito: number | null
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
  /** Solo si `productoId` referencia un producto con `tieneVariantes: true`. */
  varianteId: string | null
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
  /**
   * Calculados en vivo desde `movimientos_inventario` (nunca se guardan como
   * columna — son la prueba, no la fuente de verdad): si ya existe una
   * `reserva` sin su `liberacion_reserva` correspondiente, y si ya existe
   * una `salida_venta` real para este ítem en este pedido. Sirven para que
   * el usuario VEA si el stock de esta línea ya se descontó de verdad, y
   * también son el resguardo que usa el servidor para nunca duplicar un
   * movimiento — ver `verificarMovimientosExistentes` en `routes/tenant/pedidos.ts`.
   */
  stockReservado: boolean
  stockDescontado: boolean
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
  /** Campaña de preventa, si el pedido es parte de una (migración 031). */
  campanaId: string | null
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
  // Reserva de stock al confirmar (o al saltar directo a preparación)
  'borrador->confirmado': ['reserva'],
  'borrador->en_preparacion': ['reserva'],
  // Salida directa cuando se salta la fase de confirmación/reserva
  'borrador->despachado': ['salida_venta'],
  'borrador->entregado': ['salida_venta'],
  // Cierre de reserva + registro de salida real
  'confirmado->despachado': ['liberacion_reserva', 'salida_venta'],
  'confirmado->entregado': ['liberacion_reserva', 'salida_venta'],
  'confirmado->cancelado': ['liberacion_reserva'],
  'en_preparacion->despachado': ['liberacion_reserva', 'salida_venta'],
  'en_preparacion->entregado': ['liberacion_reserva', 'salida_venta'],
  'en_preparacion->cancelado': ['liberacion_reserva'],
  // despachado->entregado: la salida ya fue registrada, sin movimiento adicional
}

/** Estado de una campaña de preventa. Ver migración 031. */
export const ESTADOS_CAMPANA = ['abierta', 'cerrada', 'entregada', 'cancelada'] as const
export type EstadoCampana = (typeof ESTADOS_CAMPANA)[number]

/**
 * Campaña de preventa — agrupa los pedidos de una entrega puntual ("los
 * pasteles del domingo 12"). Es solo un agrupador: los encargos siguen siendo
 * pedidos normales y los productos, productos normales.
 */
export interface Campana {
  id: string
  nombre: string
  fechaEntrega: string
  estado: EstadoCampana
  notas: string | null
  usuarioId: string | null
  createdAt: string
  /** Cuántos pedidos tiene asociados. */
  pedidos: number
}

/** Una línea del consolidado: cuánto se encargó de cada producto/variante. */
export interface LineaConsolidado {
  productoId: string
  productoNombre: string
  varianteId: string | null
  /** Etiqueta de la variante, p.ej. "Sabor: Pollo". `null` si el producto no varía. */
  varianteEtiqueta: string | null
  cantidad: number
  /** Lo que se va a cobrar por esta línea en toda la campaña. */
  total: number
}

/**
 * Lo que hace útil a la campaña: el número que se le pasa a quien cocina, más
 * el estado de cobro. Ver GET /campanas/:id/consolidado.
 */
export interface ConsolidadoCampana {
  campana: Campana
  lineas: LineaConsolidado[]
  totalAVender: number
  totalCobrado: number
  /** `totalAVender - totalCobrado`. */
  totalPendiente: number
  /** Clientes con saldo pendiente en esta campaña — a quiénes hay que cobrarles. */
  clientesPendientes: { clienteId: string | null; nombre: string; apartamento: string | null; pendiente: number }[]
}

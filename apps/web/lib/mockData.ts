/**
 * Tipos de vista del frontend (snake_case, como los consume `page.tsx`).
 *
 * El archivo se llamaba así porque además traía datos de ejemplo
 * (`INITIAL_PRODUCTS`, `TENANTS_GLOBAL_METRICS`, …) que alimentaban paneles
 * mostrando cifras inventadas como si fueran reales. Todo eso se eliminó: los
 * datos vienen de la API. De aquí salía también el `producto_id: 'prod-1'` que
 * hacía que el formulario de pedido arrancara con un producto inexistente.
 *
 * Pendiente (deuda conocida): estos tipos deberían vivir en
 * `packages/shared` junto a los del backend, para que una sola definición
 * gobierne API y web.
 */
import type { SpriteProducto } from '@antigravity/shared';

export interface Category {
  id: string;
  nombre: string;
  descripcion: string;
}

export interface Product {
  id: string;
  sku: string;
  nombre: string;
  descripcion: string;
  categoria_id: string;
  /** `true` = materia prima: se compra y se transforma, no se vende (migración 030). */
  es_insumo: boolean;
  /** Costo manual tecleado al crear el producto. */
  precio_costo: number;
  /** Calculado por promedio ponderado de las compras reales. 0 si aún no hay ninguna. */
  costo_promedio: number;
  /** El que se usa para margen: `costo_promedio || precio_costo` (ver migración 029). */
  costo_efectivo: number;
  precio_venta: number;
  stock_minimo: number;
  stock_inicial: number;
  tiene_variantes: boolean;
  /** Cómo se vende: unidad, libra, canasta… (ver `UNIDADES_COMUNES` en shared). */
  unidad: string;
  /** Clave del catálogo de ilustraciones. null = caja genérica. */
  sprite: SpriteProducto | null;
  /** Unidades que representa cada pieza dibujada en la Vitrina. null = 1. */
  sprite_escala: number | null;
}

export interface InventoryMovement {
  id: string;
  producto_id: string;
  tipo:
    | 'entrada_compra'
    | 'salida_venta'
    | 'salida_devolucion'
    | 'entrada_devolucion'
    | 'ajuste_positivo'
    | 'ajuste_negativo'
    | 'consumo_produccion'
    | 'entrada_produccion'
    | 'reserva'
    | 'liberacion_reserva';
  cantidad: number;
  fecha: string;
  detalle: string;
}

export interface CustomerCredito {
  /** Días de plazo para pagar. `0` = contado, `null` = default de 30. */
  plazoDias: number | null;
  /** Tope de deuda acordado. `null` = sin límite. Se avisa, no se bloquea. */
  cupoCredito: number | null;
}

export interface Customer extends CustomerCredito {
  id: string;
  nombre: string;
  nit: string;
  email: string;
  telefono: string;
  direccion: string;
  /** Apartamento/casa del conjunto. Vacío = no aplica (ver migración 026). */
  apartamento: string;
}

export interface Supplier {
  id: string;
  nombre: string;
  nit: string;
  email: string;
  telefono: string;
  direccion: string;
  contacto: string;
}

export interface Invoice {
  id: string;
  numero: string;
  tipo: 'cxc' | 'cxp';
  cliente_id?: string;
  proveedor_id?: string;
  pedido_id?: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  total: number;
  saldo_pendiente: number;
  estado: 'pagada' | 'pendiente' | 'vencida';
}

export interface PaymentAbono {
  id: string;
  factura_id: string;
  monto: number;
  fecha: string;
  referencia: string;
}

export interface OrderItem {
  /** `null` cuando es un "cargo libre" sin producto de catálogo (ver `concepto`) — p.ej. Envío. */
  producto_id: string | null;
  /** Solo si `producto_id` referencia un producto con variantes. */
  variante_id?: string | null;
  /** Solo presente en cargos libres (`producto_id === null`), p.ej. "Envío". */
  concepto?: string | null;
  cantidad: number;
  precio: number;
  /**
   * Calculados en vivo desde el ledger de inventario (no se guardan, son la
   * PRUEBA de que el movimiento ya ocurrió) — ver `PedidoItem` en shared.
   */
  stock_reservado?: boolean;
  stock_descontado?: boolean;
}

export interface Order {
  id: string;
  numero: string;
  cliente_id: string;
  /** Campaña de preventa a la que pertenece, si aplica (migración 031). */
  campana_id: string | null;
  fecha: string;
  total: number;
  estado: 'borrador' | 'confirmado' | 'en_preparacion' | 'despachado' | 'entregado' | 'cancelado';
  items: OrderItem[];
  notas?: string | null;
  guia_despacho?: string;
}

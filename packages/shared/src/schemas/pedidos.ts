import { z } from 'zod'

import { ESTADOS_PEDIDO, ESTADOS_PEDIDO_PROVEEDOR } from '../types/pedidos.js'

// ─────────────────────────────────────────────────
// Pedidos a proveedores (órdenes de compra)
// ─────────────────────────────────────────────────

export const estadoPedidoProveedorSchema = z.enum(ESTADOS_PEDIDO_PROVEEDOR)

const crearPedidoProveedorItemSchema = z.union([
  z.object({
    productoId: z.uuid(),
    cantidad: z.number().positive('La cantidad debe ser mayor que cero.'),
    precioUnitario: z.number().nonnegative('El precio no puede ser negativo.').default(0),
  }),
  z.object({
    concepto: z.string().trim().min(1, 'El concepto es obligatorio.'),
    cantidad: z.number().positive().default(1),
    precioUnitario: z.number().nonnegative().default(0),
  }),
])

export const crearPedidoProveedorSchema = z.object({
  proveedorId: z.uuid().nullable().optional(),
  fechaEsperada: z.string().optional(),
  notas: z.string().optional(),
  /** Total real de la OC — si se proporciona, sobreescribe el calculado (precio puede variar al recibir). */
  totalManual: z.number().nonnegative().optional(),
  items: z.array(crearPedidoProveedorItemSchema).min(1, 'La orden debe tener al menos un ítem.'),
})

export const actualizarPedidoProveedorSchema = z.object({
  proveedorId: z.uuid().nullable().optional(),
  fechaEsperada: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  /** Si se incluye, reemplaza TODOS los ítems actuales y recalcula el total. */
  items: z.array(crearPedidoProveedorItemSchema).min(1).optional(),
})

export const transicionarPedidoProveedorSchema = z.object({
  estado: estadoPedidoProveedorSchema,
  /** Al pasar a recibido/recibido_parcial se puede indicar un vencimiento para la CxP generada. */
  fechaVencimientoCxP: z.string().optional(),
  /**
   * Cantidades recibidas por ítem. Si se omite, se asume recepción total de cada ítem.
   * Solo aplica al transicionar a 'recibido' o 'recibido_parcial'.
   */
  cantidades: z.array(z.object({
    itemId: z.uuid(),
    cantidadRecibida: z.number().nonnegative('La cantidad recibida no puede ser negativa.'),
  })).optional(),
})

export const estadoPedidoSchema = z.enum(ESTADOS_PEDIDO)

export const crearClienteSchema = z.object({
  nombre: z.string().min(1, 'El nombre del cliente es obligatorio.'),
  nit: z.string().trim().min(1).optional(),
  email: z.email().optional(),
  telefono: z.string().optional(),
  direccion: z.string().optional(),
  ciudad: z.string().optional(),
})

/** Editar datos de un cliente ya creado — todos los campos opcionales (PATCH parcial). */
export const actualizarClienteSchema = z.object({
  nombre: z.string().min(1).optional(),
  nit: z.string().trim().min(1).nullable().optional(),
  email: z.email().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  ciudad: z.string().nullable().optional(),
  activo: z.boolean().optional(),
})

/** Línea normal — referencia un producto del catálogo. */
const crearPedidoItemProductoSchema = z.object({
  productoId: z.uuid(),
  cantidad: z.number().positive('La cantidad debe ser mayor que cero.'),
  // Precio "excepcional" — opcional. Si el cliente lo manda, sobreescribe el
  // precio de catálogo para ESTE ítem (p.ej. un descuento puntual negociado
  // con el cliente). Si se omite, el servidor sigue fijando el precio desde
  // el catálogo, que es la fuente de verdad por defecto.
  precioUnitario: z.number().nonnegative('El precio no puede ser negativo.').optional(),
})

/**
 * Línea "cargo libre" — un ítem dinámico que NO está en el catálogo (el
 * ejemplo típico es Envío): se identifica por `concepto` en vez de
 * `productoId`, y el precio es obligatorio porque no hay catálogo del cual
 * tomarlo. El servidor lo registra "a costo" (`precioCosto = precioUnitario`,
 * margen cero) — igual debe pagarlo el cliente, simplemente no deja utilidad.
 */
const crearPedidoItemCargoSchema = z.object({
  concepto: z.string().trim().min(1, 'El concepto del cargo es obligatorio.'),
  cantidad: z.number().positive('La cantidad debe ser mayor que cero.').default(1),
  precioUnitario: z.number().nonnegative('El precio no puede ser negativo.'),
})

export const crearPedidoItemSchema = z.union([crearPedidoItemProductoSchema, crearPedidoItemCargoSchema])

export const crearPedidoSchema = z.object({
  clienteId: z.uuid().nullable().optional(),
  notas: z.string().optional(),
  items: z.array(crearPedidoItemSchema).min(1, 'El pedido debe tener al menos un ítem.'),
})

/** Cambiar el estado de un pedido — la API valida que la transición sea legal según `TRANSICIONES_VALIDAS`. */
export const transicionarPedidoSchema = z.object({
  estado: estadoPedidoSchema,
})

/**
 * Editar un pedido — deliberadamente acotado a campos "administrativos"
 * (notas, guía de despacho, cliente). Cambiar `items`/`total` requeriría
 * recalcular reservas de stock y facturación, así que esos cambios siguen
 * yendo por flujos dedicados (transición de estado, etc.), no por un PATCH genérico.
 */
export const actualizarPedidoSchema = z.object({
  clienteId: z.uuid().nullable().optional(),
  notas: z.string().nullable().optional(),
})

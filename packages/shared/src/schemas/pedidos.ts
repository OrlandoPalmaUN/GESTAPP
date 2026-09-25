import { z } from 'zod'

import { ESTADOS_CAMPANA, ESTADOS_PEDIDO, ESTADOS_PEDIDO_PROVEEDOR } from '../types/pedidos.js'

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
  fecha: z.string().optional(),
  fechaEsperada: z.string().optional(),
  notas: z.string().optional(),
  /** Total real de la OC — si se proporciona, sobreescribe el calculado (precio puede variar al recibir). */
  totalManual: z.number().nonnegative().optional(),
  items: z.array(crearPedidoProveedorItemSchema).min(1, 'La orden debe tener al menos un ítem.'),
})

/**
 * Compra de mercancía YA RECIBIDA, registrada desde Gastos.
 *
 * Es el camino normal ahora que Compras dejó de ser un módulo aparte: el
 * usuario registra algo que ya pasó, no una orden en curso. Por eso nace en
 * estado `recibido` y no atraviesa la máquina de estados — que además no
 * permite `borrador → recibido`.
 *
 * El backend resuelve todo en UNA transacción (OC + ítems + CxP + movimientos
 * de inventario + abono si se pagó). Partirlo en varias llamadas dejaría OCs
 * huérfanas en borrador que el usuario cree registradas pero que no movieron
 * ni stock ni plata.
 */
export const crearCompraDirectaSchema = z
  .object({
    /** Obligatorio: una compra recibida siempre genera CxP, y una CxP sin proveedor no significa nada. */
    proveedorId: z.uuid('Elegí el proveedor al que le compraste.'),
    fecha: z.string().optional(),
    descripcion: z.string().trim().min(1, 'Escribí de qué fue la compra.'),
    items: z.array(crearPedidoProveedorItemSchema).min(1, 'Agregá al menos un producto.'),
    /** `true` = ya salió la plata (se abona la CxP completa). `false` = queda debiendo. */
    pagado: z.boolean().default(false),
    cuentaBancariaId: z.uuid().optional(),
    medioPago: z.string().optional(),
    /** Solo si queda debiendo. Por defecto, 30 días. */
    fechaVencimientoCxP: z.string().optional(),
    /** Total real si difiere de la suma de los ítems (fletes, descuentos). */
    totalManual: z.number().nonnegative().optional(),
  })
  .refine((d) => !d.pagado || !!d.cuentaBancariaId, {
    message: 'Para marcar la compra como ya pagada indicá de qué cuenta salió el dinero.',
    path: ['cuentaBancariaId'],
  })

export const revertirRecepcionSchema = z.object({
  motivo: z.string().trim().min(1).optional(),
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
  /** Apartamento/casa del conjunto — texto libre, cada conjunto numera distinto. */
  apartamento: z.string().trim().min(1).nullable().optional(),
  ciudad: z.string().optional(),
  /** Días para pagar: 0 = contado. Si se omite, la CxC vence a 30 días. */
  plazoDias: z.number().int().min(0, 'El plazo no puede ser negativo.').nullable().optional(),
  /** Tope de deuda acordado. Se avisa al superarlo, no se bloquea. */
  cupoCredito: z.number().min(0, 'El cupo no puede ser negativo.').nullable().optional(),
})

/** Editar datos de un cliente ya creado — todos los campos opcionales (PATCH parcial). */
export const actualizarClienteSchema = z.object({
  nombre: z.string().min(1).optional(),
  nit: z.string().trim().min(1).nullable().optional(),
  email: z.email().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  apartamento: z.string().trim().min(1).nullable().optional(),
  ciudad: z.string().nullable().optional(),
  activo: z.boolean().optional(),
  plazoDias: z.number().int().min(0).nullable().optional(),
  cupoCredito: z.number().min(0).nullable().optional(),
})

/** Línea normal — referencia un producto del catálogo. */
const crearPedidoItemProductoSchema = z.object({
  productoId: z.uuid(),
  /** Obligatorio solo si el producto tiene variantes (`Producto.tieneVariantes`) — la API lo valida contra el catálogo, no este schema. */
  varianteId: z.uuid().nullable().optional(),
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
  /**
   * Campaña de preventa a la que pertenece el encargo (migración 031). Opcional:
   * un pedido sin campaña es un pedido normal y se comporta igual que siempre.
   */
  campanaId: z.uuid().nullable().optional(),
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

/** Crear una campaña de preventa (migración 031). */
export const crearCampanaSchema = z.object({
  nombre: z.string().trim().min(1, 'La campaña necesita un nombre.'),
  fechaEntrega: z.string().min(1, 'Indicá para qué día es la entrega.'),
  notas: z.string().optional(),
})

/**
 * Editar una campaña. El `estado` se cambia por acá: `cerrada` deja de aceptar
 * encargos (lo valida el POST de pedidos), `entregada` la archiva.
 */
export const actualizarCampanaSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  fechaEntrega: z.string().min(1).optional(),
  estado: z.enum(ESTADOS_CAMPANA).optional(),
  notas: z.string().nullable().optional(),
})

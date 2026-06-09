import { z } from 'zod'

import { TIPOS_MOVIMIENTO } from '../types/inventario.js'

export const tipoMovimientoSchema = z.enum(TIPOS_MOVIMIENTO)

export const crearCategoriaSchema = z.object({
  nombre: z.string().min(1, 'El nombre de la categoría es obligatorio.'),
})

export const actualizarCategoriaSchema = z.object({
  nombre: z.string().min(1, 'El nombre de la categoría es obligatorio.'),
})

export const crearProductoSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  nombre: z.string().min(1, 'El nombre del producto es obligatorio.'),
  descripcion: z.string().optional(),
  categoriaId: z.uuid().nullable().optional(),
  precioCosto: z.number().nonnegative().nullable().optional(),
  precioVenta: z.number().nonnegative().nullable().optional(),
  unidad: z.string().min(1).default('unidad'),
  stockMinimo: z.number().nonnegative().default(0),
  /** Stock con el que arranca el producto — genera un `ajuste_positivo` inicial si es > 0. */
  stockInicial: z.number().nonnegative().default(0),
})

export const actualizarProductoSchema = crearProductoSchema
  .omit({ stockInicial: true })
  .partial()
  .extend({
    activo: z.boolean().optional(),
  })

/**
 * Registrar un movimiento de inventario manual (ajustes, entradas de
 * compra). Los movimientos generados automáticamente por el ciclo de vida
 * de un pedido (reserva, salida_venta, etc.) NO pasan por aquí — los crea
 * el propio handler de transición de pedido (ver `schemas/pedidos.ts`).
 */
export const crearMovimientoSchema = z.object({
  productoId: z.uuid(),
  tipo: tipoMovimientoSchema,
  cantidad: z.number().positive('La cantidad debe ser mayor que cero.'),
  precioUnitario: z.number().nonnegative().nullable().optional(),
  notas: z.string().optional(),
})

import { z } from 'zod'

import { SPRITES_PRODUCTO, TIPOS_MOVIMIENTO } from '../types/inventario.js'

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
  unidad: z.string().trim().min(1).default('unidad'),
  stockMinimo: z.number().nonnegative().default(0),
  /** Ilustración del producto — clave de `SPRITES_PRODUCTO`. NULL = caja genérica. */
  sprite: z.enum(SPRITES_PRODUCTO).nullable().optional(),
  /** Unidades por pieza dibujada en la Vitrina. Entero > 0; NULL = 1. */
  spriteEscala: z.number().int().positive().nullable().optional(),
  /** Stock con el que arranca el producto — genera un `ajuste_positivo` inicial si es > 0. Ignorado si `tieneVariantes`: el stock se carga por variante. */
  stockInicial: z.number().nonnegative().default(0),
  /** Opt-in: si es true, el stock y el precio se gestionan por variante (ver crearVarianteProductoSchema), no a nivel de producto. */
  tieneVariantes: z.boolean().default(false),
  /** `true` = materia prima: se compra y se transforma, no se vende (migración 030). */
  esInsumo: z.boolean().default(false),
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
  /** Solo si el producto tiene variantes — identifica cuál varió. */
  varianteId: z.uuid().nullable().optional(),
  tipo: tipoMovimientoSchema,
  cantidad: z.number().positive('La cantidad debe ser mayor que cero.'),
  precioUnitario: z.number().nonnegative().nullable().optional(),
  notas: z.string().optional(),
})

// ── Variantes de producto ───────────────────────────────────────────────────

/** Define (o redefine) los ejes que varían para un producto — ej: ["Talla", "Color"]. */
export const definirAtributosProductoSchema = z.object({
  atributos: z.array(z.string().trim().min(1)).min(1, 'Debes definir al menos un atributo (ej: Talla, Color).'),
})

/**
 * Genera el producto cartesiano de combinaciones a partir de los valores
 * posibles de cada atributo — ej: { Talla: ["S","M","L"], Color: ["Negro"] }
 * genera 3 variantes. Las combinaciones que ya existen para el producto se
 * omiten (no duplica, ver índice único en la migración 020).
 */
export const generarVariantesProductoSchema = z.object({
  combinaciones: z.record(z.string(), z.array(z.string().trim().min(1)).min(1))
    .refine((obj) => Object.keys(obj).length > 0, 'Debes incluir al menos un atributo con sus valores.'),
  /** Stock inicial igual para todas las variantes generadas en esta tanda. */
  stockInicial: z.number().nonnegative().default(0),
})

/** Crea UNA variante puntual (combinación de valores ya elegida a mano). */
export const crearVarianteProductoSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  valores: z.record(z.string(), z.string().trim().min(1)).refine((v) => Object.keys(v).length > 0, 'La variante necesita al menos un valor de atributo.'),
  precioVenta: z.number().nonnegative().nullable().optional(),
  stockInicial: z.number().nonnegative().default(0),
})

export const actualizarVarianteProductoSchema = z.object({
  sku: z.string().trim().min(1).nullable().optional(),
  precioVenta: z.number().nonnegative().nullable().optional(),
  activo: z.boolean().optional(),
})

/**
 * Registrar una producción (migración 030).
 *
 * Se exige al menos un consumo y al menos una salida: sin consumo no hay de qué
 * sacar el costo, y sin salida no se produjo nada. El costo de las salidas lo
 * calcula la API a partir de los insumos — no se acepta del cliente, para que no
 * se pueda inventar un costo que no corresponde a lo que se consumió.
 */
export const crearProduccionSchema = z.object({
  fecha: z.string().optional(),
  notas: z.string().optional(),
  consumos: z
    .array(
      z.object({
        productoId: z.uuid(),
        varianteId: z.uuid().nullable().optional(),
        cantidad: z.number().positive('La cantidad consumida debe ser mayor que cero.'),
      }),
    )
    .min(1, 'Indicá al menos un insumo consumido.'),
  salidas: z
    .array(
      z.object({
        productoId: z.uuid(),
        varianteId: z.uuid().nullable().optional(),
        cantidad: z.number().positive('La cantidad producida debe ser mayor que cero.'),
      }),
    )
    .min(1, 'Indicá al menos un producto obtenido.'),
})

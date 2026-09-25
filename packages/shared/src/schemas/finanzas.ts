import { z } from 'zod'

import { CATEGORIAS_GASTO, CATEGORIAS_INGRESO, FLUJOS_CATEGORIA, TIPOS_MOVIMIENTO_SOCIO, TIPOS_CUENTA_BANCARIA, TIPOS_FACTURA } from '../types/finanzas.js'

export const tipoFacturaSchema = z.enum(TIPOS_FACTURA)
export const tipoCuentaBancariaSchema = z.enum(TIPOS_CUENTA_BANCARIA)

/** Registrar una cuenta bancaria del tenant. */
export const crearCuentaBancariaSchema = z.object({
  banco: z.string().trim().min(1, 'El nombre del banco es obligatorio.'),
  numero: z.string().trim().min(1, 'El número (o alias) de la cuenta es obligatorio.'),
  tipo: tipoCuentaBancariaSchema.default('ahorros'),
  saldo: z.number().optional(),
})

export const actualizarCuentaBancariaSchema = z.object({
  banco: z.string().trim().min(1).optional(),
  numero: z.string().trim().min(1).optional(),
  tipo: tipoCuentaBancariaSchema.optional(),
  saldo: z.number().optional(),
})

/**
 * Crear una factura manual (CxC o CxP). En el plan, las CxC "naturales" salen
 * de Pedidos despachados — pero el negocio también necesita poder registrar
 * facturas sueltas (compras a proveedores, ventas de mostrador, etc.), de ahí
 * que se permita crear directamente con `clienteId`/`proveedorId` según el tipo.
 */
export const crearFacturaSchema = z
  .object({
    tipo: tipoFacturaSchema,
    clienteId: z.uuid().nullable().optional(),
    proveedorId: z.uuid().nullable().optional(),
    pedidoId: z.uuid().nullable().optional(),
    fechaVencimiento: z.string().min(1, 'La fecha de vencimiento es obligatoria.'),
    total: z.number().positive('El total debe ser mayor que cero.'),
    notas: z.string().optional(),
  })
  .refine((data) => (data.tipo === 'cxc' ? !!data.clienteId : !!data.proveedorId), {
    message: 'Una factura CxC requiere clienteId; una CxP requiere proveedorId.',
    path: ['clienteId'],
  })

/**
 * Editar una factura — acotado a campos administrativos (fecha de
 * vencimiento, notas). El `total` no se puede tocar por aquí: cambiarlo
 * afectaría retroactivamente saldo/estado ya calculados a partir de los
 * abonos existentes — eso requeriría una corrección contable explícita,
 * no un PATCH silencioso.
 */
export const actualizarFacturaSchema = z.object({
  fechaVencimiento: z.string().min(1).optional(),
  notas: z.string().nullable().optional(),
})

/**
 * Editar un abono — acotado a metadatos (medio de pago, referencia, fecha).
 * El `monto` no se puede tocar por aquí: es lo único que mueve el saldo de la
 * factura (plan §"el saldo se calcula SIEMPRE en el servidor"), así que
 * cambiarlo requeriría re-validar contra el saldo pendiente con el mismo
 * `FOR UPDATE` que usa la creación — fuera de alcance de una edición simple.
 */
export const actualizarAbonoSchema = z.object({
  medioPago: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  fecha: z.string().min(1).optional(),
})

/** Registrar un abono — la API valida que `monto` no exceda el saldo pendiente actual de la factura. */
export const crearAbonoSchema = z.object({
  facturaId: z.uuid(),
  tipo: tipoFacturaSchema,
  monto: z.number().positive('El monto del abono debe ser mayor que cero.'),
  medioPago: z.string().optional(),
  referencia: z.string().optional(),
  /** Si se provee, el API descuenta el monto de esta cuenta bancaria (atomicamente). */
  cuentaBancariaId: z.uuid().optional(),
})

/** Transferencia entre dos cuentas bancarias del mismo tenant. */
export const crearTransferenciaSchema = z.object({
  cuentaOrigenId: z.uuid('La cuenta de origen no es válida.'),
  cuentaDestinoId: z.uuid('La cuenta de destino no es válida.'),
  monto: z.number().positive('El monto debe ser mayor que cero.'),
  descripcion: z.string().optional(),
  fecha: z.string().optional(),
})

export const categoriaGastoSchema = z.enum(CATEGORIAS_GASTO)
export const categoriaIngresoSchema = z.enum(CATEGORIAS_INGRESO)

export const flujoCategoriaSchema = z.enum(FLUJOS_CATEGORIA)

/**
 * Crear una categoría de gasto/ingreso propia del tenant (migración 027).
 *
 * `afectaUtilidad` por defecto en `true` porque el caso normal es un gasto o
 * ingreso real del negocio; se baja a `false` para lo que mueve plata sin ser
 * operativo (aporte de capital, préstamo al socio).
 */
export const crearCategoriaMovimientoSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre de la categoría es obligatorio.'),
  flujo: flujoCategoriaSchema,
  afectaUtilidad: z.boolean().default(true),
  orden: z.number().int().optional(),
})

/**
 * Editar una categoría. `flujo` y `slug` NO se pueden cambiar: mover una
 * categoría de egreso a ingreso reclasificaría en silencio todos los
 * movimientos ya registrados con ella, y el slug identifica las sembradas.
 * Para desactivarla se usa `activo`, que preserva el histórico.
 */
export const actualizarCategoriaMovimientoSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío.').optional(),
  afectaUtilidad: z.boolean().optional(),
  orden: z.number().int().optional(),
  activo: z.boolean().optional(),
})

/** Registrar un ingreso manual a una cuenta bancaria. */
export const crearIngresoBancarioSchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.'),
  /** Categoría del tenant. Es la forma nueva; `categoria` queda por compatibilidad. */
  categoriaId: z.uuid().optional(),
  categoria: categoriaIngresoSchema.default('otro'),
  monto: z.number().positive('El monto debe ser mayor que cero.'),
  fecha: z.string().optional(),
  medioPago: z.string().optional(),
  /** Cuenta que recibe el ingreso — obligatoria (a diferencia de gastos donde es opcional). */
  cuentaBancariaId: z.uuid('La cuenta bancaria es obligatoria.'),
  notas: z.string().optional(),
})

/** Registrar un gasto operativo. */
export const crearGastoOperativoSchema = z
  .object({
    descripcion: z.string().trim().min(1, 'La descripción es obligatoria.'),
    /** Categoría del tenant. Es la forma nueva; `categoria` queda por compatibilidad. */
    categoriaId: z.uuid().optional(),
    categoria: categoriaGastoSchema.default('otros'),
    monto: z.number().positive('El monto debe ser mayor que cero.'),
    fecha: z.string().optional(),
    medioPago: z.string().optional(),
    /** Si se provee, el API descuenta el monto de esta cuenta bancaria (atomicamente). */
    cuentaBancariaId: z.uuid().optional(),
    notas: z.string().optional(),
    /**
     * `true` = queda debiendo: en vez de mover el banco se genera una cuenta
     * por pagar al proveedor, que después se salda con abonos.
     */
    aCredito: z.boolean().default(false),
    proveedorId: z.uuid().optional(),
    /** Solo aplica a crédito. Por defecto, 30 días. */
    fechaVencimiento: z.string().optional(),
  })
  .refine((d) => !d.aCredito || !!d.proveedorId, {
    message: 'Para dejar el gasto a crédito tenés que indicar a qué proveedor se le debe.',
    path: ['proveedorId'],
  })
  .refine((d) => !d.aCredito || !d.cuentaBancariaId, {
    message: 'Un gasto a crédito no sale de una cuenta bancaria — se paga después con un abono.',
    path: ['cuentaBancariaId'],
  })

/**
 * Corregir un gasto ya registrado. A diferencia de `abonos` —donde el monto es
 * inmutable porque el saldo de la factura se deriva de él— acá sí se permite
 * cambiar `monto` y `cuentaBancariaId`: el API revierte el efecto anterior
 * sobre el saldo y aplica el nuevo dentro de la misma transacción.
 *
 * Antes no existía PATCH y un gasto con un typo obligaba a borrarlo y
 * recrearlo, lo que ensucia la auditoría con un borrado que en realidad
 * fue una corrección.
 */
export const actualizarGastoOperativoSchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripción no puede quedar vacía.').optional(),
  categoriaId: z.uuid().optional(),
  categoria: categoriaGastoSchema.optional(),
  monto: z.number().positive('El monto debe ser mayor que cero.').optional(),
  fecha: z.string().optional(),
  medioPago: z.string().nullable().optional(),
  /** `null` desvincula el gasto de la cuenta (devuelve el saldo descontado). */
  cuentaBancariaId: z.uuid().nullable().optional(),
  notas: z.string().nullable().optional(),
})

/** Corregir un ingreso manual — misma lógica de reversa/aplicación que el gasto. */
export const actualizarIngresoBancarioSchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripción no puede quedar vacía.').optional(),
  categoriaId: z.uuid().optional(),
  categoria: categoriaIngresoSchema.optional(),
  monto: z.number().positive('El monto debe ser mayor que cero.').optional(),
  fecha: z.string().optional(),
  medioPago: z.string().nullable().optional(),
  /** Obligatoria en ingresos (a diferencia de gastos): no puede quedar en null. */
  cuentaBancariaId: z.uuid().optional(),
  notas: z.string().nullable().optional(),
})

/**
 * Registrar un retiro o una devolución del socio (migración 028).
 *
 * `retiroId` solo aplica a devoluciones: imputa el abono a un retiro concreto
 * para poder responder "de lo que saqué en marzo, cuánto queda". El API valida
 * además que no se devuelva más de lo que ese retiro tiene pendiente.
 */
export const crearMovimientoSocioSchema = z
  .object({
    tipo: z.enum(TIPOS_MOVIMIENTO_SOCIO),
    socio: z.string().trim().min(1, 'Indicá de quién es el movimiento.'),
    monto: z.number().positive('El monto debe ser mayor que cero.'),
    fecha: z.string().optional(),
    cuentaBancariaId: z.uuid('La cuenta bancaria es obligatoria.'),
    retiroId: z.uuid().nullable().optional(),
    notas: z.string().optional(),
  })
  .refine((d) => d.tipo === 'devolucion' || !d.retiroId, {
    message: 'Solo una devolución puede imputarse a un retiro.',
    path: ['retiroId'],
  })

/** Corregir un movimiento del socio. El tipo no se cambia: sería otro movimiento. */
export const actualizarMovimientoSocioSchema = z.object({
  socio: z.string().trim().min(1).optional(),
  monto: z.number().positive('El monto debe ser mayor que cero.').optional(),
  fecha: z.string().optional(),
  cuentaBancariaId: z.uuid().optional(),
  notas: z.string().nullable().optional(),
})

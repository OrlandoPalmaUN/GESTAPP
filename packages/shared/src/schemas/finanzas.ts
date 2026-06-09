import { z } from 'zod'

import { CATEGORIAS_GASTO, TIPOS_CUENTA_BANCARIA, TIPOS_FACTURA } from '../types/finanzas.js'

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

/** Registrar un gasto operativo. */
export const crearGastoOperativoSchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.'),
  categoria: categoriaGastoSchema.default('otros'),
  monto: z.number().positive('El monto debe ser mayor que cero.'),
  fecha: z.string().optional(),
  medioPago: z.string().optional(),
  /** Si se provee, el API descuenta el monto de esta cuenta bancaria (atomicamente). */
  cuentaBancariaId: z.uuid().optional(),
  notas: z.string().optional(),
})

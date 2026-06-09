import { z } from 'zod'

import { ENTIDADES_CRM } from '../types/crm.js'

export const entidadCrmSchema = z.enum(ENTIDADES_CRM)

export const crearProveedorSchema = z.object({
  nombre: z.string().min(1, 'El nombre del proveedor es obligatorio.'),
  nit: z.string().trim().min(1).optional(),
  email: z.email().optional(),
  telefono: z.string().optional(),
  direccion: z.string().optional(),
  contacto: z.string().optional(),
})

/** Editar datos de un proveedor ya creado — todos los campos opcionales (PATCH parcial). */
export const actualizarProveedorSchema = z.object({
  nombre: z.string().min(1).optional(),
  nit: z.string().trim().min(1).nullable().optional(),
  email: z.email().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  contacto: z.string().nullable().optional(),
  activo: z.boolean().optional(),
})

export const crearNotaCrmSchema = z.object({
  entidadTipo: entidadCrmSchema,
  entidadId: z.uuid(),
  nota: z.string().trim().min(1, 'La nota no puede estar vacía.'),
})

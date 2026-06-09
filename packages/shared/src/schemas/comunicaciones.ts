import { z } from 'zod'

import {
  CANALES_POST,
  ESTADOS_EVENTO_CALENDARIO,
  TIPOS_EVENTO_CALENDARIO,
} from '../types/comunicaciones.js'

export const tipoEventoCalendarioSchema = z.enum(TIPOS_EVENTO_CALENDARIO)
export const canalPostSchema = z.enum(CANALES_POST)
export const estadoEventoCalendarioSchema = z.enum(ESTADOS_EVENTO_CALENDARIO)

export const crearEventoCalendarioSchema = z
  .object({
    tipo: tipoEventoCalendarioSchema,
    titulo: z.string().min(1, 'El título es obligatorio.'),
    descripcion: z.string().optional(),
    fecha: z.string().min(1, 'La fecha es obligatoria.'),
    canal: canalPostSchema.nullable().optional(),
    estado: estadoEventoCalendarioSchema.optional(),
  })
  .refine((data) => data.tipo !== 'post' || !!data.canal, {
    message: 'Los posts planeados deben indicar a qué red social van dirigidos.',
    path: ['canal'],
  })

export const actualizarEventoCalendarioSchema = z.object({
  titulo: z.string().min(1, 'El título es obligatorio.').optional(),
  descripcion: z.string().nullable().optional(),
  fecha: z.string().min(1, 'La fecha es obligatoria.').optional(),
  canal: canalPostSchema.nullable().optional(),
  estado: estadoEventoCalendarioSchema.optional(),
})

export const listarEventosCalendarioQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
})

// --- Notas internas ---

export const crearNotaInternaSchema = z.object({
  titulo: z.string().min(1, 'El título es obligatorio.'),
  tipoContenido: z.enum(['texto', 'lista']).default('texto'),
  contenido: z.string().optional(),
  tieneCheckbox: z.boolean().default(false),
})

export const actualizarNotaInternaSchema = z.object({
  titulo: z.string().min(1).optional(),
  tipoContenido: z.enum(['texto', 'lista']).optional(),
  contenido: z.string().nullable().optional(),
  tieneCheckbox: z.boolean().optional(),
  completada: z.boolean().optional(),
  orden: z.number().int().nonnegative().optional(),
})

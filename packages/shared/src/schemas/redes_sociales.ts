import { z } from 'zod'

export const vincularIgCuentaSchema = z.object({
  handle: z
    .string()
    .min(1, 'El handle es obligatorio.')
    .transform((h) => h.replace(/^@/, '')), // acepta con o sin @
})

export const listarPostsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30),
  order: z.enum(['engagement', 'fecha']).default('fecha'),
})

export const listarComentariosQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  filter: z.enum(['sin-responder', 'preguntas', 'todos']).default('todos'),
})

export const diasQuerySchema = z.object({
  dias: z.coerce.number().int().positive().max(365).default(30),
})

export const diasSeguidoresQuerySchema = z.object({
  dias: z.coerce.number().int().min(7).max(365).default(90),
})

export const diasMejoresHorasQuerySchema = z.object({
  dias: z.coerce.number().int().min(14).max(365).default(90),
})

export const listarRunsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(20),
})

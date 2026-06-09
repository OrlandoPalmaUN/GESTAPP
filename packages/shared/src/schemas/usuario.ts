import { z } from 'zod'

import { ESTADOS_USUARIO, ROLES_USUARIO, type SesionUsuario, type Usuario } from '../types/usuario.js'

export const rolUsuarioSchema = z.enum(ROLES_USUARIO)
export const estadoUsuarioSchema = z.enum(ESTADOS_USUARIO)

export const usuarioSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  nombre: z.string().min(1),
  rol: rolUsuarioSchema,
  tenantId: z.uuid().nullable(),
  status: estadoUsuarioSchema,
  colorSecundario: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<Usuario>

export const sesionUsuarioSchema = z.object({
  usuario: usuarioSchema,
}) satisfies z.ZodType<SesionUsuario>

/** Body de `POST /auth/login`. */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

/**
 * Body de `POST /admin/usuarios` — crear un usuario nuevo.
 *
 * Regla de negocio (decisión del usuario): "sin tenant no hay usuario" — todo
 * usuario que no sea `superadmin` (que es global, gestiona la plataforma)
 * debe pertenecer a una empresa. Se valida aquí con `superRefine` para que
 * tanto frontend como backend compartan la misma regla.
 */
export const crearUsuarioSchema = z
  .object({
    email: z.email(),
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
    nombre: z.string().min(1),
    rol: rolUsuarioSchema,
    tenantId: z.uuid().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.rol !== 'superadmin' && !data.tenantId) {
      ctx.addIssue({
        code: 'custom',
        path: ['tenantId'],
        message: 'Los usuarios admin/usuario deben pertenecer a una empresa (tenant).',
      })
    }
  })

/**
 * Body de `PATCH /auth/perfil` — autoservicio: cada usuario edita SU PROPIA
 * personalización (de momento, solo el color secundario de la interfaz).
 * Deliberadamente separado de `actualizarUsuarioSchema` (que es para que un
 * admin edite a otros) — un usuario normal no debería poder tocar su propio
 * rol/status/tenant a través de este endpoint.
 */
export const actualizarPerfilSchema = z.object({
  colorSecundario: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser un hex válido, p. ej. "#5092A9".')
    .nullable()
    .optional(),
})

/** Body de `PATCH /admin/usuarios/:id` — editar un usuario existente. */
export const actualizarUsuarioSchema = z.object({
  nombre: z.string().min(1).optional(),
  rol: rolUsuarioSchema.optional(),
  status: estadoUsuarioSchema.optional(),
  tenantId: z.uuid().nullable().optional(),
  password: z.string().min(8).optional(),
})

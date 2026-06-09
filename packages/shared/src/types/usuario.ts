/**
 * Vocabulario de roles y estados de usuario de la plataforma. El `superadmin`
 * es global (sin tenant) y es quien crea/administra al resto — no hay
 * auto-registro (ver "Módulo de comunicaciones", decisión del usuario).
 */
export const ROLES_USUARIO = ['superadmin', 'admin', 'usuario'] as const
export type RolUsuario = (typeof ROLES_USUARIO)[number]

export const ESTADOS_USUARIO = ['active', 'suspended'] as const
export type EstadoUsuario = (typeof ESTADOS_USUARIO)[number]

/**
 * Usuario de la plataforma (tabla `public.usuarios`). Forma "de cable" — sin
 * `passwordHash`, que nunca sale del servidor.
 */
export interface Usuario {
  id: string
  email: string
  nombre: string
  rol: RolUsuario
  tenantId: string | null
  status: EstadoUsuario
  /** Color secundario de la interfaz, elegido por el propio usuario (hex, p. ej. "#5092A9"). `null` = usar el de la plataforma. */
  colorSecundario: string | null
  createdAt: string
  lastLoginAt: string | null
}

/** Sesión autenticada — lo que el cliente recibe tras login/me. */
export interface SesionUsuario {
  usuario: Usuario
}

import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import type { RolUsuario } from '@antigravity/shared'
import fp from 'fastify-plugin'
import type { FastifyReply, FastifyRequest } from 'fastify'

export interface SesionJWT {
  sub: string // usuario.id
  email: string
  rol: RolUsuario
  tenantId: string | null
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SesionJWT
    user: SesionJWT
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Verifica el JWT de la cookie `sesion` y adjunta `request.user`. Responde 401 si falta o es inválido. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** Como `authenticate`, pero además exige que `request.user.rol` esté en la lista dada (403 si no). */
    requireRole: (
      ...roles: RolUsuario[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const COOKIE_NAME = 'sesion'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 días

/**
 * Auth de plataforma vía JWT guardado en cookie httpOnly. Es deliberadamente
 * simple (sin refresh tokens, sin OAuth): no hay auto-registro — todo usuario
 * lo crea un superadmin/admin (ver decisión del usuario sobre el módulo de
 * comunicaciones), así que el flujo es solo login → cookie → logout.
 */
export default fp(
  async (fastify) => {
    await fastify.register(cookie)
    await fastify.register(jwt, {
      secret: fastify.config.JWT_SECRET,
      cookie: { cookieName: COOKIE_NAME, signed: false },
    })

    fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify()
      } catch {
        return reply.unauthorized('Sesión inválida o expirada — inicia sesión de nuevo.')
      }
    })

    fastify.decorate('requireRole', (...roles: RolUsuario[]) => {
      return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          await request.jwtVerify()
        } catch {
          return reply.unauthorized('Sesión inválida o expirada — inicia sesión de nuevo.')
        }
        if (!roles.includes(request.user.rol)) {
          return reply.forbidden('No tienes permisos para realizar esta acción.')
        }
      }
    })
  },
  { name: 'auth-plugin', dependencies: ['db-plugin'] },
)

export const SESION_COOKIE = {
  name: COOKIE_NAME,
  maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
} as const

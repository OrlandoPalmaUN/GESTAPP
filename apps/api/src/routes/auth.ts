import { actualizarPerfilSchema, loginSchema, type Usuario } from '@antigravity/shared'
import type { FastifyInstance } from 'fastify'

import { verifyPassword } from '../lib/password.js'
import { SESION_COOKIE, type SesionJWT } from '../plugins/auth.js'

function aUsuarioDeCable(row: {
  id: string
  email: string
  nombre: string
  rol: string
  tenantId: string | null
  status: string
  colorSecundario: string | null
  createdAt: Date
  lastLoginAt: Date | null
}): Usuario {
  return {
    id: row.id,
    email: row.email,
    nombre: row.nombre,
    rol: row.rol as Usuario['rol'],
    tenantId: row.tenantId,
    status: row.status as Usuario['status'],
    colorSecundario: row.colorSecundario,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  }
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /auth/login — valida credenciales, emite cookie httpOnly con JWT.
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.badRequest('Email o contraseña con formato inválido.')
    }

    const usuario = await fastify.prisma.usuario.findUnique({ where: { email: body.data.email } })
    if (!usuario || usuario.status !== 'active') {
      return reply.unauthorized('Credenciales inválidas.')
    }

    const passwordValida = await verifyPassword(body.data.password, usuario.passwordHash)
    if (!passwordValida) {
      return reply.unauthorized('Credenciales inválidas.')
    }

    await fastify.prisma.usuario.update({
      where: { id: usuario.id },
      data: { lastLoginAt: new Date() },
    })

    const payload: SesionJWT = {
      sub: usuario.id,
      email: usuario.email,
      rol: usuario.rol as SesionJWT['rol'],
      tenantId: usuario.tenantId,
    }
    const token = await reply.jwtSign(payload, { expiresIn: `${SESION_COOKIE.maxAgeSeconds}s` })

    reply.setCookie(SESION_COOKIE.name, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: fastify.config.NODE_ENV === 'production',
      maxAge: SESION_COOKIE.maxAgeSeconds,
    })

    return reply.send({ usuario: aUsuarioDeCable(usuario) })
  })

  // POST /auth/logout — limpia la cookie de sesión.
  fastify.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESION_COOKIE.name, { path: '/' })
    return reply.send({ status: 'ok' })
  })

  // GET /auth/me — usuario autenticado actual (para que el frontend hidrate la sesión).
  // Incluye también el `tenant` ya resuelto por `tenant-resolver` (onRequest,
  // ver app.ts) — así el frontend puede mostrar nombre/slug/plan reales en
  // vez de datos de la maqueta ("// GESTAPP" header, sidebar, etc.).
  fastify.get('/auth/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await fastify.prisma.usuario.findUnique({ where: { id: request.user.sub } })
    if (!usuario || usuario.status !== 'active') {
      reply.clearCookie(SESION_COOKIE.name, { path: '/' })
      return reply.unauthorized('La sesión ya no es válida.')
    }

    const tenant = request.tenant
      ? {
          id: request.tenant.id,
          name: request.tenant.name,
          slug: request.tenant.slug,
          plan: request.tenant.plan,
          status: request.tenant.status,
        }
      : null

    return reply.send({ usuario: aUsuarioDeCable(usuario), tenant })
  })

  // PATCH /auth/perfil — autoservicio: cada usuario personaliza SU PROPIA UI
  // (por ahora, el color secundario). A diferencia de `/admin/usuarios/:id`,
  // nadie necesita ser admin: cada quien edita lo suyo.
  fastify.patch('/auth/perfil', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = actualizarPerfilSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const usuario = await fastify.prisma.usuario.update({
      where: { id: request.user.sub },
      data: { colorSecundario: body.data.colorSecundario },
    })

    return reply.send({ usuario: aUsuarioDeCable(usuario) })
  })
}

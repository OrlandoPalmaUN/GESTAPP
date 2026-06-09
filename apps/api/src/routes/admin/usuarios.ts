import { actualizarUsuarioSchema, crearUsuarioSchema, type Usuario } from '@antigravity/shared'
import type { FastifyInstance } from 'fastify'

import { hashPassword } from '../../lib/password.js'

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

/**
 * Administración de usuarios de la plataforma. Solo `superadmin` y `admin`
 * pueden crear/editar usuarios — no hay auto-registro (decisión del usuario:
 * "lo hace el superadmin").
 *
 * Scoping por tenant (regla de negocio): un `admin` SOLO puede ver/crear/
 * editar/eliminar usuarios de SU PROPIO tenant, y no puede crear ni ascender
 * a nadie a `superadmin` ni mover usuarios fuera de su empresa. El
 * `superadmin` no tiene esas restricciones — ve y gestiona todo.
 */
export async function adminUsuariosRoutes(fastify: FastifyInstance): Promise<void> {
  const soloAdmins = { preHandler: [fastify.requireRole('superadmin', 'admin')] }

  // GET /admin/usuarios — superadmin ve todos; admin solo ve los de su tenant.
  fastify.get('/admin/usuarios', soloAdmins, async (request, reply) => {
    const where = request.user.rol === 'admin' ? { tenantId: request.user.tenantId } : {}
    const usuarios = await fastify.prisma.usuario.findMany({ where, orderBy: { createdAt: 'asc' } })
    return reply.send({ usuarios: usuarios.map(aUsuarioDeCable) })
  })

  // POST /admin/usuarios — crea un usuario nuevo.
  fastify.post('/admin/usuarios', soloAdmins, async (request, reply) => {
    const body = crearUsuarioSchema.safeParse(request.body)
    if (!body.success) {
      return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    }

    // Un `admin` no puede crear superadmins ni asignar usuarios a otra
    // empresa que no sea la suya — siempre queda fijado a su propio tenant.
    let tenantId = body.data.tenantId ?? null
    if (request.user.rol === 'admin') {
      if (body.data.rol === 'superadmin') {
        return reply.forbidden('Un admin no puede crear usuarios con rol de super admin.')
      }
      if (body.data.tenantId && body.data.tenantId !== request.user.tenantId) {
        return reply.forbidden('Un admin solo puede crear usuarios dentro de su propia empresa.')
      }
      tenantId = request.user.tenantId
    }

    const existente = await fastify.prisma.usuario.findUnique({ where: { email: body.data.email } })
    if (existente) {
      return reply.conflict(`Ya existe un usuario con el email "${body.data.email}".`)
    }

    if (tenantId) {
      const tenant = await fastify.prisma.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant) return reply.badRequest('La empresa (tenant) seleccionada no existe.')
    }

    const passwordHash = await hashPassword(body.data.password)
    const usuario = await fastify.prisma.usuario.create({
      data: {
        email: body.data.email,
        passwordHash,
        nombre: body.data.nombre,
        rol: body.data.rol,
        tenantId,
      },
    })

    return reply.status(201).send({ usuario: aUsuarioDeCable(usuario) })
  })

  // PATCH /admin/usuarios/:id — edita nombre/rol/status/tenant/contraseña.
  fastify.patch<{ Params: { id: string } }>('/admin/usuarios/:id', soloAdmins, async (request, reply) => {
    const body = actualizarUsuarioSchema.safeParse(request.body)
    if (!body.success) {
      return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    }

    const usuario = await fastify.prisma.usuario.findUnique({ where: { id: request.params.id } })
    if (!usuario) {
      return reply.notFound('Usuario no encontrado.')
    }

    // Scoping: un `admin` solo puede tocar usuarios de su propio tenant, no
    // puede ascender a nadie a superadmin, y no puede mover a nadie de empresa.
    if (request.user.rol === 'admin') {
      if (usuario.tenantId !== request.user.tenantId) {
        return reply.forbidden('Solo puedes administrar usuarios de tu propia empresa.')
      }
      if (body.data.rol === 'superadmin') {
        return reply.forbidden('Un admin no puede ascender usuarios a super admin.')
      }
      if (body.data.tenantId !== undefined && body.data.tenantId !== request.user.tenantId) {
        return reply.forbidden('No puedes mover usuarios fuera de tu propia empresa.')
      }
    }

    // "Sin tenant no hay usuario": valida el estado RESULTANTE (no solo el
    // patch) — si el rol final no es superadmin, debe quedar con un tenant.
    const rolFinal = body.data.rol ?? usuario.rol
    const tenantIdFinal = body.data.tenantId !== undefined ? body.data.tenantId : usuario.tenantId
    if (rolFinal !== 'superadmin' && !tenantIdFinal) {
      return reply.badRequest('Los usuarios admin/usuario deben pertenecer a una empresa (tenant).')
    }
    if (body.data.tenantId) {
      const tenant = await fastify.prisma.tenant.findUnique({ where: { id: body.data.tenantId } })
      if (!tenant) return reply.badRequest('La empresa (tenant) seleccionada no existe.')
    }

    const { password, ...resto } = body.data
    const actualizado = await fastify.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        ...resto,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      },
    })

    return reply.send({ usuario: aUsuarioDeCable(actualizado) })
  })

  // DELETE /admin/usuarios/:id — elimina un usuario (no permite auto-eliminarse).
  fastify.delete<{ Params: { id: string } }>('/admin/usuarios/:id', soloAdmins, async (request, reply) => {
    if (request.params.id === request.user.sub) {
      return reply.badRequest('No puedes eliminar tu propio usuario.')
    }

    const usuario = await fastify.prisma.usuario.findUnique({ where: { id: request.params.id } })
    if (!usuario) {
      return reply.notFound('Usuario no encontrado.')
    }

    // Scoping: un `admin` solo puede eliminar usuarios de su propio tenant.
    if (request.user.rol === 'admin' && usuario.tenantId !== request.user.tenantId) {
      return reply.forbidden('Solo puedes eliminar usuarios de tu propia empresa.')
    }

    await fastify.prisma.usuario.delete({ where: { id: usuario.id } })
    return reply.send({ status: 'ok' })
  })
}

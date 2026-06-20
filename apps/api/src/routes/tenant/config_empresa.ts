/**
 * Configuración visual de la empresa — nombre a mostrar y slogan en el
 * header de la app (en vez del "EMPRESA: nombre (slug)" genérico).
 *
 * GET   /tenant/config-empresa
 * PATCH /tenant/config-empresa   { nombreDisplay?: string | null; slogan?: string | null }
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

function exigirTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest('Esta operación requiere una empresa asociada.')
    return false
  }
  return true
}

export async function configEmpresaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/tenant/config-empresa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const res = await request.tenantDb.query<{ nombre_display: string | null; slogan: string | null }>(
      'SELECT nombre_display, slogan FROM config_empresa WHERE id = 1',
    )
    const fila = res.rows[0]
    return reply.send({
      nombreDisplay: fila?.nombre_display ?? null,
      slogan: fila?.slogan ?? null,
    })
  })

  fastify.patch(
    '/tenant/config-empresa',
    { preHandler: [fastify.requireRole('admin', 'superadmin')] },
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const body = request.body as { nombreDisplay?: string | null; slogan?: string | null }
      const normalizar = (v: string | null | undefined, maxLen: number): string | null | undefined => {
        if (v === undefined) return undefined
        if (v === null) return null
        return v.trim().slice(0, maxLen) || null
      }
      const nombreDisplay = normalizar(body.nombreDisplay, 80)
      const slogan = normalizar(body.slogan, 140)

      if (nombreDisplay === undefined && slogan === undefined) {
        return reply.badRequest('Debes enviar nombreDisplay y/o slogan.')
      }

      const actual = await request.tenantDb.query<{ nombre_display: string | null; slogan: string | null }>(
        'SELECT nombre_display, slogan FROM config_empresa WHERE id = 1',
      )
      const filaActual = actual.rows[0]
      const nuevoNombre = nombreDisplay !== undefined ? nombreDisplay : filaActual?.nombre_display ?? null
      const nuevoSlogan = slogan !== undefined ? slogan : filaActual?.slogan ?? null

      const res = await request.tenantDb.query<{ nombre_display: string | null; slogan: string | null }>(
        `INSERT INTO config_empresa (id, nombre_display, slogan, updated_at)
         VALUES (1, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
           nombre_display = $1, slogan = $2, updated_at = NOW()
         RETURNING nombre_display, slogan`,
        [nuevoNombre, nuevoSlogan],
      )
      const fila = res.rows[0]
      return reply.send({
        nombreDisplay: fila?.nombre_display ?? null,
        slogan: fila?.slogan ?? null,
      })
    },
  )
}

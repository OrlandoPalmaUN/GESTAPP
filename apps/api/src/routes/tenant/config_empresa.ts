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

/**
 * Temas de interfaz disponibles. Enum cerrado y validado también en el
 * servidor: la base tiene un CHECK, pero preferimos devolver un 400 con
 * mensaje antes que un error de constraint de Postgres.
 */
const TEMAS = ['default', '8bit'] as const
type Tema = (typeof TEMAS)[number]

function esTemaConocido(valor: string | null | undefined): valor is Tema {
  return valor !== null && valor !== undefined && (TEMAS as readonly string[]).includes(valor)
}

export async function configEmpresaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/tenant/config-empresa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const res = await request.tenantDb.query<{ nombre_display: string | null; slogan: string | null; tema: string }>(
      'SELECT nombre_display, slogan, tema FROM config_empresa WHERE id = 1',
    )
    const fila = res.rows[0]
    return reply.send({
      nombreDisplay: fila?.nombre_display ?? null,
      slogan: fila?.slogan ?? null,
      tema: esTemaConocido(fila?.tema) ? fila.tema : 'default',
    })
  })

  fastify.patch(
    '/tenant/config-empresa',
    { preHandler: [fastify.requireRole('admin', 'superadmin')] },
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const body = request.body as { nombreDisplay?: string | null; slogan?: string | null; tema?: string }
      const normalizar = (v: string | null | undefined, maxLen: number): string | null | undefined => {
        if (v === undefined) return undefined
        if (v === null) return null
        return v.trim().slice(0, maxLen) || null
      }
      const nombreDisplay = normalizar(body.nombreDisplay, 80)
      const slogan = normalizar(body.slogan, 140)

      if (body.tema !== undefined && !esTemaConocido(body.tema)) {
        return reply.badRequest(`Tema desconocido: "${body.tema}". Válidos: ${TEMAS.join(', ')}.`)
      }

      if (nombreDisplay === undefined && slogan === undefined && body.tema === undefined) {
        return reply.badRequest('Debes enviar nombreDisplay, slogan y/o tema.')
      }

      const actual = await request.tenantDb.query<{ nombre_display: string | null; slogan: string | null; tema: string }>(
        'SELECT nombre_display, slogan, tema FROM config_empresa WHERE id = 1',
      )
      const filaActual = actual.rows[0]
      const nuevoNombre = nombreDisplay !== undefined ? nombreDisplay : filaActual?.nombre_display ?? null
      const nuevoSlogan = slogan !== undefined ? slogan : filaActual?.slogan ?? null
      const nuevoTema = body.tema !== undefined ? body.tema : filaActual?.tema ?? 'default'

      const res = await request.tenantDb.query<{ nombre_display: string | null; slogan: string | null; tema: string }>(
        `INSERT INTO config_empresa (id, nombre_display, slogan, tema, updated_at)
         VALUES (1, $1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET
           nombre_display = $1, slogan = $2, tema = $3, updated_at = NOW()
         RETURNING nombre_display, slogan, tema`,
        [nuevoNombre, nuevoSlogan, nuevoTema],
      )
      const fila = res.rows[0]
      return reply.send({
        nombreDisplay: fila?.nombre_display ?? null,
        slogan: fila?.slogan ?? null,
        tema: esTemaConocido(fila?.tema) ? fila.tema : 'default',
      })
    },
  )
}

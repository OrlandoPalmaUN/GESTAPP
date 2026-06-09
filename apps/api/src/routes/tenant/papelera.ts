import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { ENTIDADES_PAPELERA_VALIDAS, listarPapelera, restaurarDePapelera, type EntidadPapelera } from '../../lib/papelera.js'

/** Igual que en el resto de rutas de tenant — sin tenant resuelto no hay schema contra el cual operar. */
function exigirTenant(request: FastifyRequest, reply: FastifyReply): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest(
      'Esta operación requiere una empresa (tenant) asociada a tu usuario — el superadmin no opera sobre datos de negocio.',
    )
    return false
  }
  return true
}

function esEntidadValida(valor: string): valor is EntidadPapelera {
  return (ENTIDADES_PAPELERA_VALIDAS as string[]).includes(valor)
}

/**
 * Papelera / deshacer — vista unificada de lo borrado recientemente en
 * cualquier módulo (productos, clientes, pedidos, facturas, abonos, etc.)
 * con la opción de restaurarlo. Ningún DELETE de la API borra de verdad: solo
 * marca `deleted_at`, y esta es la puerta para revertir esa marca.
 */
export async function papeleraRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /papelera — todo lo borrado en los últimos 30 días, más reciente primero.
  fastify.get('/papelera', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const items = await listarPapelera(request.tenantDb)
    return reply.send({ items })
  })

  // POST /papelera/restaurar — { entidad, id } → revierte el borrado (deshacer).
  fastify.post<{ Body: { entidad?: string; id?: string } }>('/papelera/restaurar', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { entidad, id } = request.body ?? {}
    if (!entidad || !id) return reply.badRequest('Debes indicar "entidad" e "id" para restaurar.')
    if (!esEntidadValida(entidad)) return reply.badRequest(`Tipo de elemento desconocido: "${entidad}".`)

    const restaurado = await restaurarDePapelera(request.tenantDb, entidad, id)
    if (!restaurado) return reply.notFound('Ese elemento no está en la papelera (ya fue restaurado o no existe).')

    return reply.send({ status: 'restaurado' })
  })
}

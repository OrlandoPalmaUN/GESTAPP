import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'

export interface TenantContext {
  id: string
  name: string
  slug: string
  schemaName: string
  plan: string
  status: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Presente solo en requests resueltos a un tenant (con subdominio). */
    tenant?: TenantContext
    /**
     * Conexión DEDICADA (no del pool compartido) con el search_path ya
     * apuntando al schema del tenant. Lista para envolver en
     * `createTenantKysely` y hacer queries tipadas (Fase 1+).
     */
    tenantDb?: PoolClient
  }
}

/**
 * Resuelve el tenant a partir del subdominio (plan §4) y deja una conexión
 * lista con el search_path correcto para el resto del request.
 *
 * Por qué `pool.connect()` y NO `pool.query()`:
 * `SET search_path` es una propiedad de la CONEXIÓN, no del query individual.
 * El pool reutiliza conexiones entre requests de tenants distintos — si
 * hiciéramos `SET` sobre una conexión pooled y la devolviéramos sin
 * resetear, el siguiente request (de OTRO tenant) heredaría ese search_path
 * y vería datos ajenos. Por eso: checkout dedicado aquí, RESET + release
 * garantizado en `releaseTenantConnection` (registrado en onResponse/onError).
 *
 * Por qué Prisma para el lookup y no Kysely: el plan (§10) es explícito en
 * que Prisma gestiona el schema público — usar Kysely aquí solo para evitar
 * una import duplicaría el modelo de `tenants` en dos sistemas de tipos.
 */
/** Deja `request.tenant`/`request.tenantDb` listos para `tenant`, con una conexión dedicada y `search_path` ya apuntando a su schema. */
async function asignarTenantAlRequest(
  request: FastifyRequest,
  tenant: { id: string; name: string; slug: string; schemaName: string; plan: string; status: string },
): Promise<void> {
  const fastify = request.server
  const client = await fastify.pg.connect()
  try {
    await client.query(`SET search_path TO "${tenant.schemaName}", public`)
  } catch (error) {
    client.release()
    throw error
  }

  request.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    schemaName: tenant.schemaName,
    plan: tenant.plan,
    status: tenant.status,
  }
  request.tenantDb = client
}

export async function tenantResolver(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const fastify = request.server
  const host = request.headers.host ?? ''
  const slug = host.split('.')[0]

  const isRootDomain = !slug || host === fastify.config.APP_DOMAIN || slug === host
  if (isRootDomain) {
    // Sin subdominio: resolvemos el tenant desde la SESIÓN del usuario (no
    // desde la URL). Es el camino que usa hoy `apps/web` (todo corre en
    // localhost:3000, sin subdominios) — el día que se habiliten subdominios
    // reales por tenant, esta rama deja de ejecutarse para esos requests
    // (entran por la rama de abajo) y queda solo para landing/auth/superadmin.
    //
    // `jwtVerify` es seguro de llamar aquí aunque la ruta no sea protegida:
    // si no hay cookie de sesión o es inválida, simplemente no resuelve nada
    // y el request sigue sin tenant (rutas públicas/superadmin no lo necesitan).
    try {
      await request.jwtVerify()
    } catch {
      return
    }

    if (!request.user?.tenantId) return

    const tenant = await fastify.prisma.tenant.findFirst({
      where: { id: request.user.tenantId, status: 'active' },
    })
    if (!tenant) return

    await asignarTenantAlRequest(request, tenant)
    return
  }

  const tenant = await fastify.prisma.tenant.findFirst({
    where: { slug, status: 'active' },
  })

  if (!tenant) {
    return reply.notFound(`Tenant "${slug}" no encontrado o inactivo`)
  }

  await asignarTenantAlRequest(request, tenant)
}

/**
 * Resetea el search_path y libera la conexión de vuelta al pool. Debe
 * correr SIEMPRE que `tenantResolver` haya hecho checkout — tanto en el
 * camino feliz (onResponse) como en error (onError) — o se filtran
 * conexiones, o peor, connections con search_path "pegado" vuelven al pool.
 */
export async function releaseTenantConnection(request: FastifyRequest): Promise<void> {
  const client = request.tenantDb
  if (!client) return

  request.tenantDb = undefined
  try {
    await client.query('RESET search_path')
  } finally {
    client.release()
  }
}

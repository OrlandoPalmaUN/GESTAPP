import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'

import type { SesionJWT } from '../plugins/auth.js'

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

const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * Abre la conexión sobre la que opera un tenant (plan §4): deja el
 * search_path correcto para el resto del request.
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
/**
 * Abre una conexión DEDICADA con el `search_path` apuntando al schema del
 * tenant. Extraído de `asignarTenantAlRequest` para que lo pueda usar también
 * el trabajo que corre FUERA de un request — el webhook de WhatsApp contesta
 * 200 a Meta y procesa después, cuando el hook `onResponse` ya liberó
 * `request.tenantDb`; usar esa conexión ahí sería usarla después de devolverla
 * al pool, con el search_path de otro tenant encima.
 *
 * El `schemaName` siempre viene de `public.tenants` (lo deriva el servidor del
 * slug, nunca input del cliente), pero igual se valida el formato antes de
 * interpolarlo: un identificador no se puede parametrizar, y es la misma
 * defensa que hace el migration runner.
 */
export async function abrirConexionDeTenant(
  fastify: FastifyInstance,
  schemaName: string,
  usuarioId = '',
): Promise<PoolClient> {
  if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
    throw new Error(`schemaName "${schemaName}" tiene un formato inesperado — no se interpola en SQL.`)
  }

  const client = await fastify.pg.connect()
  try {
    await client.query(`SET search_path TO "${schemaName}", public`)
    // GUC de sesión que lee `public.fn_auditoria()` (migración 019) para saber
    // quién hizo cada cambio. La conexión es dedicada, así que el valor no se
    // filtra a otro tenant/usuario.
    await client.query(`SELECT set_config('app.current_user_id', $1, false)`, [usuarioId])
    return client
  } catch (error) {
    client.release()
    throw error
  }
}

/** Contraparte de `abrirConexionDeTenant` para código fuera de un request. */
export async function cerrarConexionDeTenant(client: PoolClient): Promise<void> {
  try {
    await client.query('RESET search_path')
    await client.query(`SELECT set_config('app.current_user_id', '', false)`)
  } finally {
    client.release()
  }
}

/** Deja `request.tenant`/`request.tenantDb` listos para `tenant`, con una conexión dedicada y `search_path` ya apuntando a su schema. */
async function asignarTenantAlRequest(
  request: FastifyRequest,
  tenant: { id: string; name: string; slug: string; schemaName: string; plan: string; status: string },
): Promise<void> {
  const client = await abrirConexionDeTenant(
    request.server,
    tenant.schemaName,
    request.user?.sub ?? '',
  )

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

/**
 * Intenta hidratar `request.user` sin exigir sesión. El tenant-resolver corre
 * también en rutas públicas/admin, así que si no hay sesión simplemente no
 * resuelve tenant; las rutas protegidas responderán 401 en su preHandler.
 */
async function verificarSesionOpcional(request: FastifyRequest): Promise<boolean> {
  try {
    await request.jwtVerify()
    return true
  } catch {
    const auth = request.headers.authorization
    if (!auth?.startsWith('Bearer ')) return false

    try {
      request.user = request.server.jwt.verify<SesionJWT>(auth.slice(7))
      return true
    } catch {
      return false
    }
  }
}

/**
 * Rutas que resuelven su propio tenant y por eso NO pasan por el resolver de
 * subdominio. Un webhook entra por el host del API (`api.midominio.co`), donde
 * el primer label del host no es el slug de ninguna empresa: sin esta salida
 * temprana el resolver buscaría un tenant llamado "api" y respondería 404
 * antes de que el webhook pudiera leer el payload. Cada webhook sabe de dónde
 * sacar su tenant: Apify lo recibe en el body, y el de WhatsApp lo busca por el
 * `phone_number_id` del número que recibió el mensaje (ver `lib/whatsapp/agente.ts`).
 */
const PREFIJOS_SIN_RESOLVER = ['/webhooks/']

export async function tenantResolver(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const fastify = request.server

  if (PREFIJOS_SIN_RESOLVER.some((prefijo) => request.url.startsWith(prefijo))) return

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
    const tieneSesion = await verificarSesionOpcional(request)
    if (!tieneSesion) return

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
  await cerrarConexionDeTenant(client)
}

import { provisionarSchemaDeTenant } from '@antigravity/db'
import { crearTenantSchema, type Tenant } from '@antigravity/shared'
import type { FastifyInstance } from 'fastify'

function aTenantDeCable(row: {
  id: string
  name: string
  slug: string
  schemaName: string
  plan: string
  status: string
  createdAt: Date
  trialEndsAt: Date | null
}): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    schemaName: row.schemaName,
    plan: row.plan as Tenant['plan'],
    status: row.status as Tenant['status'],
    createdAt: row.createdAt.toISOString(),
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
  }
}

/**
 * Administración de empresas (tenants). Solo `superadmin` — crear una empresa
 * implica reservar su `slug`/`schemaName` (y, en el futuro, provisionar su
 * schema de Postgres vía el migration runner), una operación de plataforma
 * que no le corresponde a un `admin` de tenant.
 *
 * Regla de negocio del usuario: "sin tenant no hay usuario" — un tenant tiene
 * que existir ANTES de poder crear usuarios `admin`/`usuario` dentro de él
 * (ver `crearUsuarioSchema` en packages/shared, que exige `tenantId`).
 */
export async function adminTenantsRoutes(fastify: FastifyInstance): Promise<void> {
  const soloSuperadmin = { preHandler: [fastify.requireRole('superadmin')] }

  // GET /admin/tenants — lista todas las empresas (para elegirlas al crear usuarios).
  fastify.get('/admin/tenants', soloSuperadmin, async (_request, reply) => {
    const tenants = await fastify.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } })
    return reply.send({ tenants: tenants.map(aTenantDeCable) })
  })

  // POST /admin/tenants — crea una empresa nueva.
  fastify.post('/admin/tenants', soloSuperadmin, async (request, reply) => {
    const body = crearTenantSchema.safeParse(request.body)
    if (!body.success) {
      return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    }

    const existente = await fastify.prisma.tenant.findUnique({ where: { slug: body.data.slug } })
    if (existente) {
      return reply.conflict(`Ya existe una empresa con el slug "${body.data.slug}".`)
    }

    // El nombre del schema lo decide el servidor — nunca quien crea el tenant
    // (evita colisiones/inyecciones en `SET search_path`, ver tenant-resolver).
    const schemaName = `tenant_${body.data.slug.replace(/-/g, '_')}`

    const tenant = await fastify.prisma.tenant.create({
      data: {
        name: body.data.name,
        slug: body.data.slug,
        schemaName,
        plan: body.data.plan,
      },
    })

    // Provisiona el schema de Postgres del tenant inline — crea el schema y
    // aplica las migraciones de tenant pendientes (ver
    // packages/db/src/tenant-migrations.ts). Si esto falla, el registro en
    // `public.tenants` ya quedó creado: se loguea el error pero no se revierte
    // la creación — `pnpm migrate:tenants` puede reintentar el provisioning
    // después (es idempotente), sin tener que recrear la empresa.
    try {
      const aplicadas = await provisionarSchemaDeTenant(fastify.pg, tenant.schemaName)
      fastify.log.info({ tenant: tenant.slug, schemaName: tenant.schemaName, aplicadas }, 'schema de tenant provisionado')
    } catch (error) {
      fastify.log.error(
        { tenant: tenant.slug, schemaName: tenant.schemaName, err: error },
        'no se pudo provisionar el schema del tenant — reintentar con `pnpm migrate:tenants`',
      )
    }

    return reply.status(201).send({ tenant: aTenantDeCable(tenant) })
  })
}

import { getPrismaClient, type PrismaClient } from '@antigravity/db'
import fp from 'fastify-plugin'
import { Pool } from 'pg'

declare module 'fastify' {
  interface FastifyInstance {
    pg: Pool
    prisma: PrismaClient
  }
}

/**
 * Decora la app con los dos clientes de datos:
 *  - `prisma`: schema público (tenants, planes, billing) — fuente de verdad
 *    para el tenant-resolver y el futuro flujo de onboarding.
 *  - `pg`: pool crudo de conexiones, usado para abrir conexiones DEDICADAS
 *    por request cuando hay que cambiar el search_path a un schema de tenant
 *    (ver middleware/tenant-resolver.ts — el porqué de "dedicada" importa).
 */
export default fp(
  async (fastify) => {
    const pool = new Pool({ connectionString: fastify.config.DATABASE_URL })
    const prisma = getPrismaClient()

    fastify.decorate('pg', pool)
    fastify.decorate('prisma', prisma)

    fastify.addHook('onClose', async () => {
      await Promise.all([pool.end(), prisma.$disconnect()])
    })
  },
  { name: 'db-plugin' },
)

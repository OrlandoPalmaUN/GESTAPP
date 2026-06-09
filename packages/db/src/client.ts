import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../generated/prisma/client.js'

export { PrismaClient } from '../generated/prisma/client.js'
export * from '../generated/prisma/client.js'

let prisma: PrismaClient | undefined
let pgPool: Pool | undefined

function leerDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL no está definida — copia .env.example a .env y complétala.')
  }
  return connectionString
}

/**
 * Singleton del cliente Prisma para el schema público (tenants, planes,
 * billing, migration_log). Para queries de tenant usar Kysely — ver kysely.ts.
 *
 * Prisma 7 quitó su motor de queries en Rust: ya no abre conexiones por sí
 * mismo, sino que necesita un "driver adapter" que traduzca entre el query
 * compiler y un driver de Node real (aquí, `pg` vía `@prisma/adapter-pg`).
 * Por eso lee `DATABASE_URL` directo de `process.env` — igual que
 * `prisma.config.ts` — en lugar de depender de `loadEnv()` de apps/api,
 * que este paquete no conoce (debe poder usarse desde scripts/, Studio, etc).
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    const adapter = new PrismaPg({ connectionString: leerDatabaseUrl() })
    prisma = new PrismaClient({ adapter })
  }
  return prisma
}

/**
 * Singleton de un pool crudo de `pg` — para operaciones que Prisma no puede
 * hacer (cambiar `search_path`, crear schemas dinámicos de tenant, etc., ver
 * tenant-migrations.ts). Mismo patrón que `getPrismaClient`: lee
 * `DATABASE_URL` directo de `process.env` para poder usarse desde scripts/.
 */
export function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({ connectionString: leerDatabaseUrl() })
  }
  return pgPool
}

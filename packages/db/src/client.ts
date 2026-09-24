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
/**
 * Tamaño del pool. El default de `pg` es 10, y eso hacía cola: el
 * `tenant-resolver` toma una conexión DEDICADA por request (necesario para
 * que `SET search_path` no se filtre entre empresas), y la app dispara ~19
 * peticiones al abrir. Con 10, la mitad de la ráfaga espera turno.
 *
 * Cuánto cuesta esa espera depende de dónde esté la base. Midiendo la misma
 * ráfaga de 18 peticiones:
 *
 *   - API lejos de la base (local → Neon): con 10 la mediana era 1,46× la de
 *     una petición sola; con 20 baja a 1,20×. El tiempo de pared pasa de
 *     1.829 ms a 1.662 ms — mejora real pero chica, porque ahí manda la
 *     latencia de red.
 *   - API junto a la base (producción): la consulta es rápida, así que la
 *     espera por conexión pesa mucho más. Ahí se midió una sola petición en
 *     367 ms y la mediana de la ráfaga en 1.253 ms (3,4×), que es justo el
 *     perfil que este cambio ataca.
 *
 * 20 cubre la ráfaga completa sin cola. Configurable porque el tope real lo
 * pone el proveedor de la base, no nosotros.
 */
const MAX_CONEXIONES = Number(process.env.DB_POOL_MAX ?? 20)

export function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({ connectionString: leerDatabaseUrl(), max: MAX_CONEXIONES })
  }
  return pgPool
}

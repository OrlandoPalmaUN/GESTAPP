/**
 * Migration Runner — aplica migraciones pendientes a TODOS los schemas de
 * tenants activos (plan §4). Se corre manualmente (`pnpm migrate:tenants`)
 * después de agregar una migración nueva al schema de tenant
 * (`packages/db/tenant-migrations/NNN_*.sql`), o desde CI en un futuro
 * pipeline de deploy.
 *
 * Regla de oro del plan: nunca editar el schema de un tenant a mano —
 * todo cambio va como migración versionada y registrada en
 * `public.migration_log` (modelo `MigrationLog` en packages/db).
 *
 * Implementación (decisión tomada — opción (a) del TODO original): SQL plano
 * versionado en `packages/db/tenant-migrations/`, aplicado por
 * `provisionarSchemaDeTenant` (packages/db/src/tenant-migrations.ts), que:
 *   - crea el schema si no existe (`CREATE SCHEMA IF NOT EXISTS`)
 *   - aplica solo las migraciones que no figuren ya en `migration_log` para
 *     ese `schema_name` — correrlo dos veces seguidas no reaplica nada
 *   - cada migración corre en su propia transacción (todo o nada)
 *
 * Nota: en el flujo normal, el schema de un tenant se provisiona AL
 * CREARLO (ver `POST /admin/tenants`, que llama a `provisionarSchemaDeTenant`
 * inline). Este runner existe para el caso de migraciones nuevas que deben
 * propagarse a tenants ya existentes.
 */
import 'dotenv/config'

import { getPgPool, getPrismaClient, provisionarSchemaDeTenant } from '@antigravity/db'

async function main(): Promise<void> {
  const prisma = getPrismaClient()
  const pool = getPgPool()

  try {
    const tenants = await prisma.tenant.findMany({
      where: { status: 'active' },
      select: { slug: true, schemaName: true },
    })

    if (tenants.length === 0) {
      console.log('No hay tenants activos — nada que migrar.')
      return
    }

    console.log(`Migrando ${tenants.length} tenant(s) activo(s)...`)
    for (const tenant of tenants) {
      const aplicadas = await provisionarSchemaDeTenant(pool, tenant.schemaName)
      if (aplicadas.length === 0) {
        console.log(`  → ${tenant.slug} (${tenant.schemaName}): ya estaba al día`)
      } else {
        console.log(`  → ${tenant.slug} (${tenant.schemaName}): aplicadas ${aplicadas.join(', ')}`)
      }
    }
    console.log('Listo.')
  } finally {
    await Promise.all([prisma.$disconnect(), pool.end()])
  }
}

main().catch((error: unknown) => {
  console.error('Error migrando tenants:', error)
  process.exitCode = 1
})

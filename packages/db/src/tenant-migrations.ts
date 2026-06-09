import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Pool, PoolClient } from 'pg'

/**
 * Migration Runner para schemas de tenant (resuelve el TODO de
 * scripts/migrate-tenants.ts — opción (a) del plan: SQL plano versionado).
 *
 * Por qué SQL plano y no Prisma Migrate: Prisma Migrate no soporta aplicar
 * el mismo set de migraciones contra un `search_path` paramétrico dentro de
 * un mismo proceso (cada tenant vive en su propio schema dinámico,
 * `tenant_<slug>`). Archivos `NNN_nombre.sql` numerados, aplicados en orden
 * y registrados uno a uno en `public.migration_log` (schema_name + migration)
 * son agnósticos del schema y perfectamente idempotentes — correrlo dos
 * veces no reaplica lo ya aplicado.
 *
 * Identificador validado en runtime: nunca se interpola un `schemaName` que
 * no haya sido generado por el propio servidor (ver `POST /admin/tenants`,
 * que deriva `schemaName` del slug — nunca confía en input directo del
 * cliente). Aun así, este módulo valida el formato como defensa adicional
 * antes de interpolarlo en SQL (no se puede parametrizar un identificador).
 */

const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

function assertSchemaNameSeguro(schemaName: string): void {
  if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
    throw new Error(
      `schemaName "${schemaName}" tiene un formato inesperado — se esperaba [a-z][a-z0-9_]*. ` +
        'Por seguridad no se interpola en SQL un identificador con este formato.',
    )
  }
}

/** Carpeta donde viven los `NNN_nombre.sql` — junto al `prisma/` de este paquete. */
const TENANT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tenant-migrations')

interface MigracionTenant {
  /** Nombre de archivo (también es la clave registrada en `migration_log`). */
  nombre: string
  sql: string
}

/** Lee y ordena (alfabéticamente, por eso el prefijo `NNN_`) las migraciones disponibles. */
function leerMigracionesDisponibles(): MigracionTenant[] {
  const archivos = readdirSync(TENANT_MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  return archivos.map((nombre) => ({
    nombre,
    sql: readFileSync(join(TENANT_MIGRATIONS_DIR, nombre), 'utf-8'),
  }))
}

/**
 * Aplica las migraciones de tenant pendientes contra `schemaName`, usando
 * una conexión DEDICADA (`pool.connect()`, nunca `pool.query()`): igual que
 * en `tenant-resolver`, `SET search_path`/`CREATE SCHEMA` son operaciones de
 * conexión, no de query — y el pool reutiliza conexiones entre tenants.
 *
 * Cada migración corre en su propia transacción: se registra en
 * `public.migration_log` solo si el SQL completo aplicó sin errores. Si una
 * migración falla, las anteriores quedan aplicadas y registradas (permite
 * reintentar solo la que falló en una corrida posterior).
 */
export async function provisionarSchemaDeTenant(pool: Pool, schemaName: string): Promise<string[]> {
  assertSchemaNameSeguro(schemaName)

  const disponibles = leerMigracionesDisponibles()
  if (disponibles.length === 0) return []

  const client: PoolClient = await pool.connect()
  const aplicadas: string[] = []
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)

    const yaAplicadas = await client.query<{ migration: string }>(
      'SELECT migration FROM public.migration_log WHERE schema_name = $1',
      [schemaName],
    )
    const aplicadasSet = new Set(yaAplicadas.rows.map((r) => r.migration))

    for (const migracion of disponibles) {
      if (aplicadasSet.has(migracion.nombre)) continue

      try {
        await client.query('BEGIN')
        // El search_path es propiedad de ESTA conexión/transacción — se
        // resetea solo al hacer release si el pool lo soporta, pero como
        // esta conexión vive solo durante el provisioning, no hace falta
        // RESET explícito (ver nota de liberación más abajo).
        await client.query(`SET LOCAL search_path TO "${schemaName}", public`)
        await client.query(migracion.sql)
        await client.query(
          'INSERT INTO public.migration_log (schema_name, migration) VALUES ($1, $2)',
          [schemaName, migracion.nombre],
        )
        await client.query('COMMIT')
        aplicadas.push(migracion.nombre)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw new Error(
          `Falló la migración "${migracion.nombre}" para el schema "${schemaName}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    return aplicadas
  } finally {
    // Conexión dedicada que no vuelve a usarse con otro search_path — se
    // descarta del pool en vez de reciclarla (mismo patrón cauteloso que
    // `releaseTenantConnection` en el tenant-resolver, pero aquí ni siquiera
    // hace falta el RESET porque la conexión no vuelve a circular).
    client.release(true)
  }
}

/** Lista los nombres de migración disponibles — usado por el runner para logging/diagnóstico. */
export function listarMigracionesDisponibles(): string[] {
  return leerMigracionesDisponibles().map((m) => m.nombre)
}

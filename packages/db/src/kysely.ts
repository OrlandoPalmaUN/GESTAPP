import { Kysely, PostgresDialect } from 'kysely'
import type { Pool } from 'pg'

/**
 * Tablas del schema de cada TENANT — no del público (eso lo gestiona Prisma,
 * ver prisma/schema.prisma). Estas tablas todavía no existen: llegan con
 * Fase 1 (Inventario: productos, movimientos_inventario, clientes, ...).
 *
 * Punto de extensión: cada vez que se agregue una migración de tenant, su
 * tabla se declara aquí como interfaz y se referencia en `TenantDB`.
 *
 * Por qué Kysely y no Prisma para schemas de tenant: Prisma no soporta
 * cambiar el `search_path` de Postgres en runtime, y cada tenant vive en su
 * propio schema dinámico (`tenant_<slug>_<id>`). Kysely sí permite construir
 * queries tipadas contra cualquier connection/search_path (ver plan §10).
 */
export interface TenantDB {
  [table: string]: Record<string, unknown>
}

/**
 * Crea una instancia de Kysely tipada para queries contra el schema de un
 * tenant. Recibe el `Pool` de pg ya existente — no abre conexiones nuevas.
 *
 * Uso esperado (Fase 1+): el tenant-resolver deja `request.tenantDb` listo
 * con el search_path correcto; los handlers de ruta envuelven ese cliente
 * en `createTenantKysely` para hacer queries tipadas contra sus tablas.
 */
export function createTenantKysely(pool: Pool): Kysely<TenantDB> {
  return new Kysely<TenantDB>({
    dialect: new PostgresDialect({ pool }),
  })
}

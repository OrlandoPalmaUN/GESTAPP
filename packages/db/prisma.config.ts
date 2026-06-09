import { resolve } from 'node:path'

import { config } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

// El `.env` vive en la raíz del monorepo: la CLI de Prisma corre con
// cwd = packages/db (dos niveles bajo la raíz), así que apuntamos ahí
// explícitamente en lugar de `dotenv/config` (que solo mira el cwd).
config({ path: resolve(process.cwd(), '../../.env') })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `env()` (a diferencia de `process.env.X`) devuelve `string` y falla
    // rápido con un mensaje claro si la variable no está definida.
    url: env('DATABASE_URL'),
  },
})

/**
 * Lista todos los schemas del Postgres y los tenants registrados.
 * Uso: cd apps/api && pnpm tsx src/scripts/list-schemas.ts
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pkg from 'pg'

const { Pool } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: resolve(__dirname, '../../../../.env') })

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const client = await pool.connect()

// Schemas
const r1 = await client.query(`
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name NOT IN ('information_schema','pg_catalog','pg_toast')
  ORDER BY schema_name
`)
console.log('📂 Schemas:')
r1.rows.forEach(r => console.log(' -', r.schema_name))

// Tenants en public
const r2 = await client.query(`SELECT id, slug, name, schema_name, is_active FROM public.tenants ORDER BY created_at`)
console.log('\n🏢 Tenants:')
r2.rows.forEach(r => console.log(` - ${r.slug} | schema: ${r.schema_name} | active: ${r.is_active}`))

client.release()
await pool.end()

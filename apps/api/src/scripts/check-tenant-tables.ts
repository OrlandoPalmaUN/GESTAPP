/**
 * Verifica qué tablas y migraciones existen en el schema de un tenant.
 * Uso: cd apps/api && pnpm tsx src/scripts/check-tenant-tables.ts [schema_name]
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pkg from 'pg'

const { Pool } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: resolve(__dirname, '../../../../.env') })

const schemaName = process.argv[2] ?? 'tenant_nalu'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const client = await pool.connect()

const r = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = $1
  ORDER BY table_name
`, [schemaName])

console.log(`📋 Tablas en ${schemaName}:`)
r.rows.forEach(row => console.log(' -', row.table_name))

// Check migrations
try {
  const r2 = await client.query(`
    SELECT filename, applied_at
    FROM "${schemaName}".schema_migrations
    ORDER BY filename
  `)
  console.log('\n🔄 Migraciones aplicadas:')
  r2.rows.forEach(row => console.log(` - ${row.filename} (${row.applied_at})`))
} catch (e) {
  console.log('\n⚠️  No se pudo leer schema_migrations:', e instanceof Error ? e.message : String(e))
}

// Tenants
const r3 = await client.query(`SELECT id, slug, name, schema_name FROM public.tenants ORDER BY created_at`)
console.log('\n🏢 Tenants registrados:')
r3.rows.forEach(r => console.log(` - ${r.slug} | schema: ${r.schema_name} | id: ${r.id}`))

client.release()
await pool.end()

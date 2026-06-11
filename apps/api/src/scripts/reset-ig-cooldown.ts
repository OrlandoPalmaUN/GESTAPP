/**
 * Resetea el cooldown de refresh manual de IG para poder probar.
 * Uso: pnpm --filter @antigravity/api tsx src/scripts/reset-ig-cooldown.ts [schema_name]
 *
 * Ej: pnpm --filter @antigravity/api tsx src/scripts/reset-ig-cooldown.ts tenant_nalu_gems
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pkg from 'pg'

const { Pool } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// apps/api/src/scripts → ../../../../ = monorepo root
config({ path: resolve(__dirname, '../../../../.env') })

const schemaName = process.argv[2] ?? 'tenant_nalu_gems'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const client = await pool.connect()
await client.query(`SET search_path TO "${schemaName}", public`)

const r1 = await client.query('UPDATE ig_config SET ultimo_refresh_manual = NULL RETURNING cuenta_id')
console.log('✅ Cooldown reseteado:', r1.rows)

const r2 = await client.query('SELECT COUNT(*) as total FROM ig_posts')
console.log('📊 Posts en DB:', r2.rows[0])

const r3 = await client.query('SELECT handle, last_scraped_at, es_verificada FROM ig_cuentas LIMIT 1')
console.log('👤 Cuenta:', r3.rows[0])

await client.query('RESET search_path')
client.release()
await pool.end()

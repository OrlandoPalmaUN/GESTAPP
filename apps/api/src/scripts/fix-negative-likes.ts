/**
 * Corrige likes negativos (-1) que Apify devuelve para cuentas con likes ocultos.
 * Uso: cd apps/api && pnpm tsx src/scripts/fix-negative-likes.ts [schema]
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
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const client = await pool.connect()
await client.query(`SET search_path TO "${schemaName}", public`)

const r1 = await client.query('UPDATE ig_posts SET likes = 0 WHERE likes < 0 RETURNING ig_shortcode')
console.log('Posts con likes negativos corregidos:', r1.rows.length, r1.rows.map(r => r.ig_shortcode))

const r2 = await client.query('UPDATE ig_post_snapshots SET likes = 0 WHERE likes < 0')
console.log('Snapshots con likes negativos corregidos:', r2.rowCount)

await client.query('RESET search_path')
client.release()
await pool.end()

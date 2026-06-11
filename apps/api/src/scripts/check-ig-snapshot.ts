import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: resolve(__dirname, '../../../../.env') })
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const client = await pool.connect()
await client.query('SET search_path TO tenant_nalu, public')
const r = await client.query('SELECT fecha, seguidores, seguidos, posts_total FROM ig_cuenta_snapshots ORDER BY fecha DESC LIMIT 5')
console.log('Snapshots:', r.rows)
await client.query('RESET search_path')
client.release()
await pool.end()

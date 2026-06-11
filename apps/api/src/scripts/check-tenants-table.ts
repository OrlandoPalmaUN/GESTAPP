import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: resolve(__dirname, '../../../../.env') })
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const { rows } = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' ORDER BY ordinal_position")
console.log('Columnas de public.tenants:')
rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type}`))
const { rows: data } = await pool.query('SELECT id, slug, name, schema_name FROM public.tenants LIMIT 5')
console.log('\nDatos:', data)
await pool.end()

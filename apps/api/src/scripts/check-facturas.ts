import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const { rows } = await pool.query(`SELECT numero FROM tenant_nalu.facturas_venta ORDER BY created_at DESC LIMIT 3`)
  console.log('Últimas facturas:', rows)
  await pool.end()
}
void main().catch(console.error)

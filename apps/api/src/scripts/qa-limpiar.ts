/** Borra por completo el tenant descartable de QA (schema, usuarios y registro). */
import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await pool.query('DROP SCHEMA IF EXISTS tenant_qa_debug_temp CASCADE')
  await pool.query(`DELETE FROM public.migration_log WHERE schema_name = 'tenant_qa_debug_temp'`)
  await pool.query(`DELETE FROM public.usuarios WHERE email LIKE 'qa-%@example.invalid'`)
  await pool.query(`DELETE FROM public.tenants WHERE slug = 'qa-debug-temp'`)
  console.log('QA limpio')
  await pool.end()
}
void main().catch(console.error)

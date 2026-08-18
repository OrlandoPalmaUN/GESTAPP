import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const { rows } = await pool.query(`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_schema='tenant_nalu' AND table_name='pedidos' 
    ORDER BY ordinal_position
  `)
  console.log('Columnas de tenant_nalu.pedidos:')
  rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type} (default: ${r.column_default})`))
  const { rows: cnt } = await pool.query(`SELECT COUNT(*) FROM tenant_nalu.pedidos`)
  console.log(`Pedidos existentes: ${cnt[0].count}`)
  const { rows: clientes } = await pool.query(`SELECT COUNT(*) FROM tenant_nalu.clientes`)
  console.log(`Clientes existentes: ${clientes[0].count}`)
  
  // Check last pedido numero
  const { rows: last } = await pool.query(`SELECT numero FROM tenant_nalu.pedidos ORDER BY created_at DESC LIMIT 1`)
  console.log(`Último número de pedido:`, last[0])
  
  await pool.end()
}
main().catch(console.error)

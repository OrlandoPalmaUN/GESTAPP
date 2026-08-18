import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

  // PED-2026-0058 a 0062 → confirmado → despachado
  const pedidos = ['PED-2026-0058','PED-2026-0059','PED-2026-0060','PED-2026-0061','PED-2026-0062']

  const { rowCount } = await pool.query(
    `UPDATE tenant_nalu.pedidos SET estado = 'despachado', updated_at = NOW()
     WHERE numero = ANY($1) AND estado = 'confirmado'`,
    [pedidos],
  )
  console.log(`✔ ${rowCount} pedidos actualizados a 'despachado'`)

  // Verificar todos los pedidos de La Tricolor
  const { rows } = await pool.query(
    `SELECT p.numero, p.estado, c.nombre
     FROM tenant_nalu.pedidos p
     JOIN tenant_nalu.clientes c ON c.id = p.cliente_id
     WHERE p.numero >= 'PED-2026-0054' AND p.numero <= 'PED-2026-0064'
       AND p.deleted_at IS NULL
     ORDER BY p.numero`,
  )
  console.log('\nEstado actual:')
  rows.forEach(r => console.log(`  ${r.numero} [${r.estado}] → ${r.nombre}`))

  await pool.end()
}
void main().catch(console.error)

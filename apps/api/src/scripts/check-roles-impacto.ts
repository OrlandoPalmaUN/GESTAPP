import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const { rows } = await pool.query(`
    SELECT t.name AS empresa, t.slug,
           COUNT(u.id)::int AS usuarios,
           STRING_AGG(u.email || ' [' || u.rol || ']', ', ' ORDER BY u.created_at) AS detalle,
           COUNT(*) FILTER (WHERE u.rol = 'admin')::int AS admins
    FROM tenants t LEFT JOIN usuarios u ON u.tenant_id = t.id
    WHERE t.status = 'active'
    GROUP BY t.id, t.name, t.slug ORDER BY t.created_at
  `)
  console.log('\nImpacto de aplicar permisos por rol:\n')
  for (const r of rows) {
    const riesgo = r.admins === 0 && r.usuarios > 0
      ? '  <<< SIN NINGÚN ADMIN — se quedaría sin poder operar'
      : ''
    console.log(`${r.empresa} (${r.slug}) — ${r.usuarios} usuario(s), ${r.admins} admin(s)${riesgo}`)
    console.log(`   ${r.detalle ?? '(sin usuarios)'}\n`)
  }
  await pool.end()
}
void main().catch(console.error)

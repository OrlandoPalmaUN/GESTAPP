import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg

config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

  // Ver estado actual
  const { rows: before } = await pool.query(`
    SELECT
      pp.numero AS oc_numero,
      pp.total  AS oc_total,
      pp.estado AS oc_estado,
      fc.numero AS fc_numero,
      fc.total  AS fc_total,
      COALESCE(SUM(a.monto), 0) AS fc_abonado
    FROM tenant_nalu.pedidos_proveedor pp
    JOIN tenant_nalu.facturas_compra fc ON fc.id = pp.factura_compra_id
    LEFT JOIN tenant_nalu.abonos a
      ON a.documento_id = fc.id AND a.tipo_documento = 'factura_compra' AND a.deleted_at IS NULL
    WHERE pp.deleted_at IS NULL
      AND pp.factura_compra_id IS NOT NULL
      AND pp.total <> fc.total
    GROUP BY pp.numero, pp.total, pp.estado, fc.id, fc.numero, fc.total
    ORDER BY pp.numero
  `)

  if (before.length === 0) {
    console.log('✅ No hay OCs con total distinto al de su FC. Nada que corregir.')
    await pool.end()
    return
  }

  console.log('OCs cuya FC tiene total incorrecto:')
  console.table(before)

  // Corregir: actualizar el total de cada FC para que coincida con el total de la OC
  for (const row of before) {
    const { rowCount } = await pool.query(`
      UPDATE tenant_nalu.facturas_compra fc
      SET total = pp.total
      FROM tenant_nalu.pedidos_proveedor pp
      WHERE pp.factura_compra_id = fc.id
        AND pp.numero = $1
        AND fc.total <> pp.total
    `, [row.oc_numero])

    console.log(`  ${row.oc_numero}: FC total ${row.fc_total} → ${row.oc_total} (rows updated: ${rowCount})`)
  }

  // Verificar resultado
  const { rows: after } = await pool.query(`
    SELECT pp.numero AS oc_numero, pp.total AS oc_total, fc.numero AS fc_numero, fc.total AS fc_total
    FROM tenant_nalu.pedidos_proveedor pp
    JOIN tenant_nalu.facturas_compra fc ON fc.id = pp.factura_compra_id
    WHERE pp.deleted_at IS NULL AND pp.factura_compra_id IS NOT NULL
      AND pp.total::numeric <> fc.total::numeric
  `)

  if (after.length === 0) {
    console.log('\n✅ Todas las FCs ahora coinciden con el total de su OC.')
  } else {
    console.log('\n⚠️ Quedan discrepancias:')
    console.table(after)
  }

  await pool.end()
}

void main().catch(console.error)

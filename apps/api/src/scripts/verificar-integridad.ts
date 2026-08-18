/**
 * Verificación de integridad de los datos de las empresas REALES.
 *
 * Confirma que ninguna sesión de trabajo tocó información de clientes: cuenta
 * filas por tenant y valida las invariantes contables del sistema.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

const TABLAS = [
  'clientes', 'proveedores', 'productos', 'pedidos', 'pedido_items',
  'facturas_venta', 'facturas_compra', 'abonos', 'movimientos_inventario',
  'cuentas_bancarias', 'gastos_operativos', 'ingresos_bancarios',
  'pedidos_proveedor', 'transferencias_bancarias',
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

  const { rows: tenants } = await pool.query<{ name: string; slug: string; schema_name: string }>(
    `SELECT name, slug, schema_name FROM tenants WHERE status = 'active' AND slug NOT LIKE 'qa-%' ORDER BY created_at`,
  )

  console.log('\n═══ DATOS DE LAS EMPRESAS REALES ═══\n')
  let totalFilas = 0
  for (const t of tenants) {
    const partes: string[] = []
    let filasTenant = 0
    for (const tabla of TABLAS) {
      const existe = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2) AS exists`,
        [t.schema_name, tabla],
      )
      if (!existe.rows[0]?.exists) continue
      const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${t.schema_name}".${tabla}`)
      const n = Number(rows[0]!.n)
      filasTenant += n
      if (n > 0) partes.push(`${tabla}=${n}`)
    }
    totalFilas += filasTenant
    console.log(`${t.name} (${t.slug}) — ${filasTenant} filas`)
    console.log(`  ${partes.join('  ') || '(vacío)'}\n`)
  }
  console.log(`TOTAL: ${totalFilas} filas de negocio en ${tenants.length} empresas\n`)

  console.log('═══ INVARIANTES CONTABLES ═══\n')
  let problemas = 0

  for (const t of tenants) {
    const tieneFacturas = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='facturas_venta') AS exists`,
      [t.schema_name],
    )
    if (!tieneFacturas.rows[0]?.exists) continue

    // 1. Ninguna factura puede tener más abonos que su total.
    const { rows: sobrepago } = await pool.query(`
      SELECT f.numero, f.total, SUM(a.monto) AS abonado
      FROM "${t.schema_name}".facturas_venta f
      JOIN "${t.schema_name}".abonos a
        ON a.tipo_documento = 'factura_venta' AND a.documento_id = f.id AND a.deleted_at IS NULL
      WHERE f.deleted_at IS NULL
      GROUP BY f.id, f.numero, f.total
      HAVING SUM(a.monto) > f.total
    `)
    // 2. Ningún producto puede tener stock negativo.
    const { rows: negativos } = await pool.query(`
      SELECT p.nombre, SUM(CASE WHEN m.tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                                THEN m.cantidad ELSE -m.cantidad END) AS stock
      FROM "${t.schema_name}".productos p
      JOIN "${t.schema_name}".movimientos_inventario m ON m.producto_id = p.id
      WHERE p.deleted_at IS NULL
      GROUP BY p.id, p.nombre
      HAVING SUM(CASE WHEN m.tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                      THEN m.cantidad ELSE -m.cantidad END) < 0
    `)
    // 3. Ninguna cuenta bancaria en negativo.
    const { rows: cuentasNeg } = await pool.query(
      `SELECT banco, saldo FROM "${t.schema_name}".cuentas_bancarias WHERE deleted_at IS NULL AND saldo < 0`,
    )

    const fallas = sobrepago.length + negativos.length + cuentasNeg.length
    problemas += fallas
    const marca = fallas === 0 ? 'OK  ' : 'REVISAR'
    console.log(`${marca} ${t.name}: facturas sobrepagadas=${sobrepago.length}, stock negativo=${negativos.length}, cuentas en negativo=${cuentasNeg.length}`)
    for (const r of sobrepago) console.log(`     factura ${r.numero}: total ${r.total}, abonado ${r.abonado}`)
    for (const r of negativos) console.log(`     ${r.nombre}: stock ${r.stock}`)
    for (const r of cuentasNeg) console.log(`     ${r.banco}: saldo ${r.saldo}`)
  }

  console.log(`\n${problemas === 0 ? '✅ Todas las invariantes se cumplen' : `⚠️  ${problemas} problema(s) — revisar arriba`}`)

  const { rows: qa } = await pool.query(`SELECT slug FROM tenants WHERE slug LIKE 'qa-%'`)
  const { rows: schemasQa } = await pool.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_qa%'`)
  console.log(`\nTenants de prueba restantes: ${qa.length === 0 ? 'ninguno ✅' : qa.map(r => r.slug).join(', ')}`)
  console.log(`Schemas de prueba restantes: ${schemasQa.length === 0 ? 'ninguno ✅' : schemasQa.map(r => r.nspname).join(', ')}`)

  await pool.end()
}
void main().catch(console.error)

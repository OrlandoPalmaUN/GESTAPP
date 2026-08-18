/**
 * Crea facturas_venta + abonos para los pedidos La Tricolor de NALÚ.
 *
 * Pagados (✅) — se crea factura + abono completo ($50,000):
 *   0054 Gigi García, 0055 Claudia Linero, 0056-0057 Alexandra Rincón,
 *   0060 Mami, 0061 Mafe Bohórquez, 0062 María Beatriz Quintero,
 *   0063 Ana Sofía Márquez, 0064 Anita Morillo
 *
 * No pagados — solo factura (queda en CxC pendiente):
 *   0058 Margareth, 0059 Diana Jaraba
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

const SCHEMA = 'tenant_nalu'
const HOY = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

const PEDIDOS_PAGADOS = [
  'PED-2026-0054', // Gigi García
  'PED-2026-0055', // Claudia Linero
  'PED-2026-0056', // Alexandra Rincón
  'PED-2026-0057', // Alexandra Rincón
  'PED-2026-0060', // Mami
  'PED-2026-0061', // Mafe Bohórquez
  'PED-2026-0062', // María Beatriz Quintero
  'PED-2026-0063', // Ana Sofía Márquez
  'PED-2026-0064', // Anita Morillo
]

const PEDIDOS_NO_PAGADOS = [
  'PED-2026-0058', // Margareth
  'PED-2026-0059', // Diana Jaraba
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Obtener el último número de factura de venta
    const { rows: lastFv } = await client.query(
      `SELECT numero FROM ${SCHEMA}.facturas_venta ORDER BY created_at DESC LIMIT 1`,
    )
    const lastFvNum = lastFv.length > 0
      ? parseInt(lastFv[0].numero.split('-')[2], 10)
      : 38
    let nextFvNum = lastFvNum + 1

    // Obtener pedidos con su info
    const todosPedidos = [...PEDIDOS_PAGADOS, ...PEDIDOS_NO_PAGADOS]
    const { rows: pedidos } = await client.query(
      `SELECT p.id, p.numero, p.cliente_id, p.total
       FROM ${SCHEMA}.pedidos p
       WHERE p.numero = ANY($1) AND p.deleted_at IS NULL
       ORDER BY p.numero`,
      [todosPedidos],
    )

    for (const pedido of pedidos) {
      // Verificar si ya tiene factura
      const { rows: existing } = await client.query(
        `SELECT id FROM ${SCHEMA}.facturas_venta WHERE pedido_id = $1 LIMIT 1`,
        [pedido.id],
      )
      if (existing.length > 0) {
        console.log(`  ↩  Factura ya existe para ${pedido.numero}`)
        continue
      }

      const numeroFv = `FV-2026-${String(nextFvNum).padStart(4, '0')}`
      nextFvNum++

      const { rows: fvRows } = await client.query(
        `INSERT INTO ${SCHEMA}.facturas_venta
           (numero, cliente_id, pedido_id, fecha_emision, fecha_vencimiento, total, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          numeroFv,
          pedido.cliente_id,
          pedido.id,
          HOY,
          HOY,
          pedido.total,
          `Generada para Pedido ${pedido.numero} — La Tricolor`,
        ],
      )
      const facturaId = fvRows[0].id
      const esPagado = PEDIDOS_PAGADOS.includes(pedido.numero)

      if (esPagado) {
        await client.query(
          `INSERT INTO ${SCHEMA}.abonos
             (tipo_documento, documento_id, monto, fecha, medio_pago)
           VALUES ('factura_venta', $1, $2, $3, 'transferencia')`,
          [facturaId, pedido.total, HOY],
        )
        console.log(`  ✔  ${numeroFv} → Pedido ${pedido.numero} — factura + abono $${pedido.total} ✅`)
      } else {
        console.log(`  ✔  ${numeroFv} → Pedido ${pedido.numero} — factura (pendiente cobro)`)
      }
    }

    await client.query('COMMIT')
    console.log('\n✅ Pagos registrados.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('✗ ROLLBACK:', err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

void main()

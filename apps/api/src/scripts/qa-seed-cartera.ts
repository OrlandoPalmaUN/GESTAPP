/** Siembra facturas de venta con distintas antigüedades para probar la cartera por edades. */
import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })
import { getPgPool } from '@antigravity/db'

async function main(): Promise<void> {
  const pool = getPgPool()
  const client = await pool.connect()
  try {
    await client.query('SET search_path TO tenant_qa_debug_temp, public')

    const clientes = [
      { nombre: 'Almacén El Progreso', dias: -10, monto: 400000 }, // por vencer
      { nombre: 'Distribuidora Luna', dias: 15, monto: 250000 },   // 1-30
      { nombre: 'Tienda Mi Barrio', dias: 45, monto: 180000 },     // 31-60
      { nombre: 'Comercial Andina', dias: 75, monto: 320000 },     // 61-90
      { nombre: 'Surtitodo SAS', dias: 150, monto: 900000 },       // +90 (el peor)
    ]

    let n = 100
    for (const c of clientes) {
      const { rows: [cli] } = await client.query<{ id: string }>(
        `INSERT INTO clientes (nombre) VALUES ($1) RETURNING id`, [c.nombre],
      )
      await client.query(
        `INSERT INTO facturas_venta (numero, cliente_id, fecha_emision, fecha_vencimiento, total)
         VALUES ($1, $2, CURRENT_DATE - $3::int - 30, CURRENT_DATE - $3::int, $4)`,
        [`FV-2026-0${n++}`, cli!.id, c.dias, c.monto],
      )
    }

    // Un cliente con dos facturas en cubetas distintas y un abono parcial.
    const { rows: [multi] } = await client.query<{ id: string }>(
      `INSERT INTO clientes (nombre) VALUES ('Ferretería Central') RETURNING id`,
    )
    const { rows: [f1] } = await client.query<{ id: string }>(
      `INSERT INTO facturas_venta (numero, cliente_id, fecha_emision, fecha_vencimiento, total)
       VALUES ($1, $2, CURRENT_DATE - 50, CURRENT_DATE - 20, 500000) RETURNING id`,
      [`FV-2026-0${n++}`, multi!.id],
    )
    await client.query(
      `INSERT INTO facturas_venta (numero, cliente_id, fecha_emision, fecha_vencimiento, total)
       VALUES ($1, $2, CURRENT_DATE - 130, CURRENT_DATE - 100, 300000)`,
      [`FV-2026-0${n++}`, multi!.id],
    )
    // Abono parcial: la cartera debe mostrar el SALDO, no el total facturado.
    await client.query(
      `INSERT INTO abonos (tipo_documento, documento_id, monto, fecha, medio_pago)
       VALUES ('factura_venta', $1, 200000, CURRENT_DATE, 'efectivo')`,
      [f1!.id],
    )

    console.log('cartera de prueba lista')
  } finally { client.release() }
}
void main().catch((e: unknown) => { console.error(e); process.exitCode = 1 })

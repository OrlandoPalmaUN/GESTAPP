/** Agrega un producto, un cliente y un pedido al tenant de QA, para probar la UI de pedidos. */
import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })
import { getPgPool } from '@antigravity/db'

async function main(): Promise<void> {
  const pool = getPgPool()
  const client = await pool.connect()
  try {
    await client.query('SET search_path TO tenant_qa_debug_temp, public')
    const { rows: [prod] } = await client.query<{ id: string }>(
      `INSERT INTO productos (nombre, sku, precio_venta, precio_costo)
       VALUES ('Producto QA', 'QA-1', 50000, 30000) RETURNING id`,
    )
    const { rows: [cli] } = await client.query<{ id: string }>(
      `INSERT INTO clientes (nombre) VALUES ('Cliente QA') RETURNING id`,
    )
    const { rows: [ped] } = await client.query<{ id: string }>(
      `INSERT INTO pedidos (numero, cliente_id, estado, total, notas)
       VALUES ('PED-2026-0001', $1, 'borrador', 100000, 'nota original') RETURNING id`,
      [cli!.id],
    )
    await client.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_costo)
       VALUES ($1, $2, 2, 50000, 30000)`,
      [ped!.id, prod!.id],
    )
    console.log('pedido de prueba listo')
  } finally { client.release() }
}
void main().catch((e: unknown) => { console.error(e); process.exitCode = 1 })

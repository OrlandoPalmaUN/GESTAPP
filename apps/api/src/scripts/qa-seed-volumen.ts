/** Siembra volumen (60 gastos) para probar la paginación de las tablas. */
import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })
import { getPgPool } from '@antigravity/db'

async function main(): Promise<void> {
  const pool = getPgPool()
  const client = await pool.connect()
  try {
    await client.query('SET search_path TO tenant_qa_debug_temp, public')
    const cats = ['arriendo', 'servicios', 'nomina', 'comisiones', 'marketing', 'otros']
    for (let i = 1; i <= 60; i++) {
      await client.query(
        `INSERT INTO gastos_operativos (descripcion, categoria, monto, fecha)
         VALUES ($1, $2, $3, CURRENT_DATE - $4::int)`,
        [`Gasto de prueba #${i}`, cats[i % cats.length], 10000 * i, i],
      )
    }
    console.log('60 gastos sembrados')
  } finally { client.release() }
}
void main().catch((e: unknown) => { console.error(e); process.exitCode = 1 })

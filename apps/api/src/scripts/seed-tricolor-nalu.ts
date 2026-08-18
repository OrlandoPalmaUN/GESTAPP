/**
 * Seed: ventas confirmadas "La Tricolor" para tenant NALÚ
 *
 * Estado por emojis del usuario:
 *   ✅📦 / 📦✅ → entregado
 *   ✅ (sin 📦)  → confirmado (pagado, pendiente entrega)
 *   sin emoji    → confirmado (venta confirmada, sin pago/entrega aún)
 *   ENVÍO NACIONAL ✅ → despachado (enviado y pagado)
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg

config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

const SCHEMA = 'tenant_nalu'
const PRODUCTO_TRICOLOR_ID = '5dd4aedd-d731-4093-ae73-c9a21c9aa8ed'
const PRECIO_TRICOLOR = 50000

interface ClienteInput {
  nombre: string
}

interface PedidoInput {
  clienteNombre: string
  estado: string
  notas: string
}

const CLIENTES_NUEVOS: ClienteInput[] = [
  { nombre: 'Gigi García' },
  { nombre: 'Claudia Linero' },
  { nombre: 'Alexandra Rincón' },
  { nombre: 'Margareth' },
  { nombre: 'Diana Jaraba' },
  { nombre: 'Mami' },
  { nombre: 'Mafe Bohórquez' },
  { nombre: 'María Beatriz Quintero' },
  { nombre: 'Ana Sofía Márquez' },
  { nombre: 'Anita Morillo' },
]

const PEDIDOS: PedidoInput[] = [
  { clienteNombre: 'Gigi García',            estado: 'entregado',  notas: 'La Tricolor · Instagram · URG' },
  { clienteNombre: 'Claudia Linero',          estado: 'entregado',  notas: 'La Tricolor · USA · referida por Silvana' },
  { clienteNombre: 'Alexandra Rincón',        estado: 'entregado',  notas: 'La Tricolor · Instagram' },
  { clienteNombre: 'Alexandra Rincón',        estado: 'entregado',  notas: 'La Tricolor · Instagram (segundo pedido)' },
  { clienteNombre: 'Margareth',               estado: 'confirmado', notas: 'La Tricolor · Memy' },
  { clienteNombre: 'Diana Jaraba',            estado: 'confirmado', notas: 'La Tricolor · referida por Memy' },
  { clienteNombre: 'Mami',                    estado: 'confirmado', notas: 'La Tricolor' },
  { clienteNombre: 'Mafe Bohórquez',          estado: 'confirmado', notas: 'La Tricolor' },
  { clienteNombre: 'María Beatriz Quintero',  estado: 'confirmado', notas: 'La Tricolor · Instagram' },
  { clienteNombre: 'Ana Sofía Márquez',       estado: 'despachado', notas: 'La Tricolor · Instagram · Envío nacional' },
  { clienteNombre: 'Anita Morillo',           estado: 'despachado', notas: 'La Tricolor · Instagram · Envío nacional' },
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // ── 1. Crear clientes nuevos ──────────────────────────────────────────
    const clienteIds: Record<string, string> = {}

    for (const c of CLIENTES_NUEVOS) {
      // Evitar duplicados si el script se corre dos veces
      const existing = await client.query(
        `SELECT id FROM ${SCHEMA}.clientes WHERE nombre = $1 AND activo = true LIMIT 1`,
        [c.nombre],
      )
      if (existing.rows.length > 0) {
        clienteIds[c.nombre] = existing.rows[0].id
        console.log(`  ↩  Cliente ya existe: ${c.nombre} (${existing.rows[0].id})`)
        continue
      }

      const { rows } = await client.query(
        `INSERT INTO ${SCHEMA}.clientes (nombre) VALUES ($1) RETURNING id`,
        [c.nombre],
      )
      clienteIds[c.nombre] = rows[0].id
      console.log(`  ✔  Cliente creado: ${c.nombre} (${rows[0].id})`)
    }

    // ── 2. Obtener el próximo número de pedido ────────────────────────────
    const { rows: lastRow } = await client.query(
      `SELECT numero FROM ${SCHEMA}.pedidos WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    const lastNum = lastRow.length > 0
      ? parseInt(lastRow[0].numero.split('-')[2], 10)
      : 53
    let nextNum = lastNum + 1

    // ── 3. Crear pedidos + items ──────────────────────────────────────────
    for (const p of PEDIDOS) {
      const numero = `PED-2026-${String(nextNum).padStart(4, '0')}`
      nextNum++

      const clienteId = clienteIds[p.clienteNombre]
      if (!clienteId) {
        throw new Error(`No se encontró ID para cliente: ${p.clienteNombre}`)
      }

      // Verificar si ya existe un pedido con este cliente + notas exactas (idempotencia)
      const dupCheck = await client.query(
        `SELECT id FROM ${SCHEMA}.pedidos WHERE cliente_id = $1 AND notas = $2 AND deleted_at IS NULL LIMIT 1`,
        [clienteId, p.notas],
      )
      if (dupCheck.rows.length > 0) {
        console.log(`  ↩  Pedido ya existe: ${p.clienteNombre} — ${p.notas} (${dupCheck.rows[0].id})`)
        continue
      }

      const { rows: pedRows } = await client.query(
        `INSERT INTO ${SCHEMA}.pedidos (numero, cliente_id, estado, total, notas)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [numero, clienteId, p.estado, PRECIO_TRICOLOR, p.notas],
      )
      const pedidoId = pedRows[0].id

      // Item: 1x LA TRICOLOR
      await client.query(
        `INSERT INTO ${SCHEMA}.pedido_items (pedido_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [pedidoId, PRODUCTO_TRICOLOR_ID, 1, PRECIO_TRICOLOR],
      )

      console.log(`  ✔  Pedido ${numero} [${p.estado}] → ${p.clienteNombre}`)
    }

    await client.query('COMMIT')
    console.log('\n✅ Seed completado.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('✗ Error — se hizo ROLLBACK:', err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

void main()

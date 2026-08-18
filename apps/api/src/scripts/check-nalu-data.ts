import { config } from 'dotenv'
import { resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  
  // Productos
  const { rows: prods } = await pool.query(`SELECT id, sku, nombre, precio_venta FROM tenant_nalu.productos WHERE activo=true ORDER BY nombre`)
  console.log('PRODUCTOS:')
  prods.forEach(r => console.log(` - [${r.id}] ${r.nombre} | SKU: ${r.sku} | Precio: ${r.precio_venta}`))
  
  // Clientes existentes
  const { rows: clts } = await pool.query(`SELECT id, nombre, telefono FROM tenant_nalu.clientes WHERE activo=true ORDER BY nombre`)
  console.log('\nCLIENTES EXISTENTES:')
  clts.forEach(r => console.log(` - [${r.id}] ${r.nombre}`))
  
  // Last pedido numero
  const { rows: last } = await pool.query(`SELECT numero FROM tenant_nalu.pedidos WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)
  console.log(`\nÚLTIMO PEDIDO: ${last[0]?.numero}`)
  
  await pool.end()
}
main().catch(console.error)

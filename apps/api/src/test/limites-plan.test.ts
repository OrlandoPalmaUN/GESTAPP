/**
 * Límites de plan.
 *
 * Lo más importante que verifican estos tests es que la funcionalidad sea
 * INERTE mientras `subscription_plans` esté vacía: hoy hay empresas reales
 * operando y un límite mal aplicado las dejaría sin poder cargar productos.
 * La restricción tiene que ser una decisión explícita (poblar la tabla), no un
 * efecto secundario de desplegar.
 */
import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest'
import { getPrismaClient } from '@antigravity/db'
import { prepararTenant, limpiarTenant, limpiarDatos, sesionAdmin, SLUG, type Sesion } from './apoyo.js'

let admin: Sesion
const prisma = getPrismaClient()

beforeAll(async () => {
  await prepararTenant()
  admin = await sesionAdmin()
})
afterAll(limpiarTenant)

afterEach(async () => {
  // Dejar la tabla de planes como estaba: vacía.
  await prisma.subscriptionPlan.deleteMany({ where: { name: 'basico' } })
  await limpiarDatos()
})

const crearProducto = (n: number) =>
  admin.req('/inventario/productos', {
    method: 'POST',
    body: JSON.stringify({ nombre: `P${n}`, sku: `SKU-${Date.now()}-${n}`, precioVenta: 1000 }),
  })

describe('Sin planes configurados (estado actual de producción)', () => {
  it('no impone ningún tope de productos', async () => {
    const planes = await prisma.subscriptionPlan.count()
    expect(planes).toBe(0)

    for (let i = 0; i < 5; i++) {
      const r = await crearProducto(i)
      expect(r.status).toBe(201)
    }
  })
})

describe('Con un plan que define límites', () => {
  it('bloquea al llegar al tope y explica por qué', async () => {
    await prisma.subscriptionPlan.create({
      data: { name: 'basico', precioCop: 79000, maxUsuarios: 3, maxProductos: 2 },
    })

    expect((await crearProducto(1)).status).toBe(201)
    expect((await crearProducto(2)).status).toBe(201)

    const tercero = await crearProducto(3)
    expect(tercero.status).toBe(400)
    expect(tercero.body.message).toContain('basico')
    expect(tercero.body.message).toContain('2')
  })

  it('un límite nulo significa ilimitado', async () => {
    await prisma.subscriptionPlan.create({
      data: { name: 'basico', precioCop: 79000, maxUsuarios: null, maxProductos: null },
    })
    for (let i = 0; i < 4; i++) {
      expect((await crearProducto(i)).status).toBe(201)
    }
  })

  it('los productos borrados no cuentan para el cupo', async () => {
    await prisma.subscriptionPlan.create({
      data: { name: 'basico', precioCop: 79000, maxUsuarios: 3, maxProductos: 2 },
    })
    const p1 = await crearProducto(1)
    await crearProducto(2)
    expect((await crearProducto(3)).status).toBe(400)

    await admin.req(`/inventario/productos/${p1.body.producto.id}`, { method: 'DELETE' })
    expect((await crearProducto(4)).status).toBe(201)
  })
})

describe('El tenant de pruebas usa el plan básico', () => {
  it('confirma el supuesto de los tests anteriores', async () => {
    const t = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { plan: true } })
    expect(t?.plan).toBe('basico')
  })
})

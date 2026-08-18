/**
 * Permisos por rol.
 *
 * Hasta hace poco NINGÚN endpoint de negocio validaba rol: de ~120 rutas, la
 * única protegida era la que edita el nombre de la empresa. Cualquier empleado
 * con login podía borrar cuentas bancarias, borrar facturas y ver los márgenes.
 *
 * Estos tests fijan la frontera: el empleado hace su trabajo diario, y todo lo
 * destructivo o financieramente sensible queda en manos del admin.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { prepararTenant, limpiarTenant, sesionAdmin, sesionEmpleado, type Sesion } from './apoyo.js'

let admin: Sesion
let empleado: Sesion

beforeAll(async () => {
  await prepararTenant()
  admin = await sesionAdmin()
  empleado = await sesionEmpleado()
})
afterAll(limpiarTenant)

describe('El empleado puede hacer su trabajo', () => {
  it.each([
    ['ver el inventario', '/inventario/productos'],
    ['ver los pedidos', '/pedidos'],
    ['ver los clientes', '/clientes'],
    ['ver los proveedores', '/proveedores'],
    ['ver las cuentas por cobrar', '/finanzas/facturas?tipo=cxc'],
    ['ver las cuentas bancarias', '/finanzas/cuentas'],
    ['ver las compras', '/compras'],
    ['ver la cartera', '/finanzas/cartera?tipo=cxc'],
  ])('%s', async (_nombre, path) => {
    const r = await empleado.req(path)
    expect(r.status).toBe(200)
  })

  it('crear un cliente', async () => {
    const r = await empleado.req('/clientes', {
      method: 'POST', body: JSON.stringify({ nombre: `Cliente ${Date.now()}` }),
    })
    expect(r.status).toBe(201)
  })

  it('crear un pedido', async () => {
    const p = await admin.req('/inventario/productos', {
      method: 'POST',
      body: JSON.stringify({ nombre: 'P', sku: `S-${Date.now()}`, precioVenta: 1000, stockInicial: 10 }),
    })
    const r = await empleado.req('/pedidos', {
      method: 'POST', body: JSON.stringify({ clienteId: null, items: [{ productoId: p.body.producto.id, cantidad: 1 }] }),
    })
    expect(r.status).toBe(201)
  })
})

describe('El empleado NO puede tocar dinero ni borrar', () => {
  it('no puede crear una cuenta bancaria', async () => {
    const r = await empleado.req('/finanzas/cuentas', {
      method: 'POST',
      body: JSON.stringify({ banco: 'X', numero: '1', tipo: 'ahorros', saldo: 0 }),
    })
    expect(r.status).toBe(403)
  })

  it('no puede borrar una cuenta bancaria', async () => {
    const cuenta = (await admin.req('/finanzas/cuentas', {
      method: 'POST', body: JSON.stringify({ banco: 'Y', numero: '2', tipo: 'ahorros', saldo: 100 }),
    })).body.cuenta
    const r = await empleado.req(`/finanzas/cuentas/${cuenta.id}`, { method: 'DELETE' })
    expect(r.status).toBe(403)
  })

  it('no puede borrar un cliente', async () => {
    const cli = (await admin.req('/clientes', {
      method: 'POST', body: JSON.stringify({ nombre: `Borrable ${Date.now()}` }),
    })).body.cliente
    const r = await empleado.req(`/clientes/${cli.id}`, { method: 'DELETE' })
    expect(r.status).toBe(403)
  })

  it.each([
    ['los reportes de margen', '/reportes/periodo?tipo=mes'],
    ['el log de auditoría', '/auditoria'],
    ['la papelera', '/papelera'],
  ])('no puede ver %s', async (_nombre, path) => {
    const r = await empleado.req(path)
    expect(r.status).toBe(403)
  })
})

describe('El admin sí puede', () => {
  it.each([
    ['los reportes de margen', '/reportes/periodo?tipo=mes'],
    ['el log de auditoría', '/auditoria'],
    ['la papelera', '/papelera'],
  ])('ver %s', async (_nombre, path) => {
    const r = await admin.req(path)
    expect(r.status).toBe(200)
  })

  it('crear y borrar una cuenta bancaria', async () => {
    const crear = await admin.req('/finanzas/cuentas', {
      method: 'POST', body: JSON.stringify({ banco: 'Z', numero: '3', tipo: 'corriente', saldo: 0 }),
    })
    expect(crear.status).toBe(201)
    const borrar = await admin.req(`/finanzas/cuentas/${crear.body.cuenta.id}`, { method: 'DELETE' })
    expect(borrar.status).toBe(204)
  })
})

describe('Sin sesión no se entra', () => {
  it('rechaza sin token', async () => {
    const res = await fetch(`${process.env.TEST_API_URL ?? 'http://localhost:4000'}/pedidos`)
    expect(res.status).toBe(401)
  })
})

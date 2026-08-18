/**
 * Lo que mueve plata: cuentas por cobrar y pagar, abonos, saldos bancarios,
 * transferencias y su reversa.
 *
 * Todos estos casos son regresiones de bugs reales o de invariantes que el
 * código documenta explícitamente.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prepararTenant, limpiarTenant, limpiarDatos, sesionAdmin, hoyMas, type Sesion } from './apoyo.js'

let admin: Sesion

beforeAll(async () => {
  await prepararTenant()
  admin = await sesionAdmin()
})
afterAll(limpiarTenant)
beforeEach(limpiarDatos)

async function crearCuenta(saldo: number, banco = 'Banco QA') {
  const r = await admin.req('/finanzas/cuentas', {
    method: 'POST',
    body: JSON.stringify({ banco, numero: String(Math.floor(Math.random() * 1e6)), tipo: 'ahorros', saldo }),
  })
  expect(r.status).toBe(201)
  return r.body.cuenta
}

async function crearProductoYCliente() {
  const p = await admin.req('/inventario/productos', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Producto', sku: `SKU-${Date.now()}`, precioVenta: 50000, precioCosto: 30000, stockInicial: 100 }),
  })
  const c = await admin.req('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Cliente' }) })
  return { producto: p.body.producto, cliente: c.body.cliente }
}

describe('Cuentas por cobrar', () => {
  it('un pedido con cliente genera su CxC automáticamente', async () => {
    const { producto, cliente } = await crearProductoYCliente()
    const ped = await admin.req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 2 }] }),
    })
    expect(ped.status).toBe(201)

    const { body } = await admin.req('/finanzas/facturas?tipo=cxc')
    const cxc = body.facturas.find((f: any) => f.pedidoId === ped.body.pedido.id)
    expect(cxc).toBeDefined()
    expect(cxc.total).toBe(100000)
    expect(cxc.saldoPendiente).toBe(100000)
  })

  it('un pedido SIN cliente no genera CxC — no hay a quién cobrarle', async () => {
    const { producto } = await crearProductoYCliente()
    await admin.req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: null, items: [{ productoId: producto.id, cantidad: 1 }] }),
    })
    const { body } = await admin.req('/finanzas/facturas?tipo=cxc')
    expect(body.facturas).toHaveLength(0)
  })

  it('el vencimiento respeta el plazo del cliente', async () => {
    const { producto } = await crearProductoYCliente()
    for (const [plazo, esperado] of [[0, 0], [60, 60], [null, 30]] as const) {
      const c = await admin.req('/clientes', {
        method: 'POST',
        body: JSON.stringify({ nombre: `Cliente ${plazo}`, ...(plazo !== null ? { plazoDias: plazo } : {}) }),
      })
      const ped = await admin.req('/pedidos', {
        method: 'POST',
        body: JSON.stringify({ clienteId: c.body.cliente.id, items: [{ productoId: producto.id, cantidad: 1 }] }),
      })
      const { body } = await admin.req('/finanzas/facturas?tipo=cxc')
      const cxc = body.facturas.find((f: any) => f.pedidoId === ped.body.pedido.id)
      expect(cxc.fechaVencimiento).toBe(hoyMas(esperado))
    }
  })
})

describe('Abonos y saldos', () => {
  it('el saldo se deriva de total − abonos y nunca se guarda', async () => {
    const { producto, cliente } = await crearProductoYCliente()
    const ped = await admin.req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 2 }] }),
    })
    const { body: f1 } = await admin.req('/finanzas/facturas?tipo=cxc')
    const cxc = f1.facturas.find((f: any) => f.pedidoId === ped.body.pedido.id)

    await admin.req('/finanzas/abonos', {
      method: 'POST',
      body: JSON.stringify({ facturaId: cxc.id, tipo: 'cxc', monto: 30000 }),
    })
    const { body: f2 } = await admin.req('/finanzas/facturas?tipo=cxc')
    const actualizada = f2.facturas.find((f: any) => f.id === cxc.id)
    expect(actualizada.saldoPendiente).toBe(70000)
    expect(actualizada.estado).toBe('pendiente')
  })

  it('rechaza abonar más que el saldo pendiente', async () => {
    const { producto, cliente } = await crearProductoYCliente()
    await admin.req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 1 }] }),
    })
    const { body } = await admin.req('/finanzas/facturas?tipo=cxc')
    const cxc = body.facturas[0]

    const r = await admin.req('/finanzas/abonos', {
      method: 'POST',
      body: JSON.stringify({ facturaId: cxc.id, tipo: 'cxc', monto: cxc.total + 1 }),
    })
    expect(r.status).toBe(400)
  })

  it('una factura pagada por completo queda en estado pagada', async () => {
    const { producto, cliente } = await crearProductoYCliente()
    await admin.req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 1 }] }),
    })
    const { body: f1 } = await admin.req('/finanzas/facturas?tipo=cxc')
    const cxc = f1.facturas[0]
    await admin.req('/finanzas/abonos', {
      method: 'POST', body: JSON.stringify({ facturaId: cxc.id, tipo: 'cxc', monto: cxc.total }),
    })
    const { body: f2 } = await admin.req('/finanzas/facturas?tipo=cxc')
    expect(f2.facturas[0].saldoPendiente).toBe(0)
    expect(f2.facturas[0].estado).toBe('pagada')
  })

  it('no se puede borrar una factura que ya tiene abonos — ocultaría plata recibida', async () => {
    const { producto, cliente } = await crearProductoYCliente()
    await admin.req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 1 }] }),
    })
    const { body } = await admin.req('/finanzas/facturas?tipo=cxc')
    const cxc = body.facturas[0]
    await admin.req('/finanzas/abonos', {
      method: 'POST', body: JSON.stringify({ facturaId: cxc.id, tipo: 'cxc', monto: 10000 }),
    })
    const r = await admin.req(`/finanzas/facturas/${cxc.id}?tipo=cxc`, { method: 'DELETE' })
    expect(r.status).toBe(400)
  })
})

describe('Cuentas bancarias', () => {
  it('un gasto con cuenta descuenta el saldo, y borrarlo lo devuelve', async () => {
    const cuenta = await crearCuenta(1_000_000)
    const g = await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({ descripcion: 'Arriendo', categoria: 'arriendo', monto: 200000, cuentaBancariaId: cuenta.id }),
    })
    expect(g.status).toBe(201)

    let { body } = await admin.req('/finanzas/cuentas')
    expect(body.cuentas[0].saldo).toBe(800000)

    await admin.req(`/finanzas/gastos/${g.body.gasto.id}`, { method: 'DELETE' })
    ;({ body } = await admin.req('/finanzas/cuentas'))
    expect(body.cuentas[0].saldo).toBe(1_000_000)
  })

  it('corregir el monto de un gasto ajusta el saldo por la diferencia', async () => {
    const cuenta = await crearCuenta(1_000_000)
    const g = await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({ descripcion: 'Servicios', categoria: 'servicios', monto: 200000, cuentaBancariaId: cuenta.id }),
    })
    await admin.req(`/finanzas/gastos/${g.body.gasto.id}`, {
      method: 'PATCH', body: JSON.stringify({ monto: 250000 }),
    })
    const { body } = await admin.req('/finanzas/cuentas')
    expect(body.cuentas[0].saldo).toBe(750000)
  })

  it('rechaza un gasto mayor al saldo disponible', async () => {
    const cuenta = await crearCuenta(100000)
    const r = await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({ descripcion: 'Grande', categoria: 'otros', monto: 200000, cuentaBancariaId: cuenta.id }),
    })
    expect(r.status).toBe(400)
  })
})

describe('Transferencias', () => {
  it('mueve el monto entre cuentas y la reversa lo deja exactamente como estaba', async () => {
    const a = await crearCuenta(1_000_000, 'Banco A')
    const b = await crearCuenta(500_000, 'Banco B')

    const tr = await admin.req('/finanzas/transferencias', {
      method: 'POST',
      body: JSON.stringify({ cuentaOrigenId: a.id, cuentaDestinoId: b.id, monto: 300000 }),
    })
    expect(tr.status).toBe(201)

    const saldo = (cuentas: any[], banco: string) => cuentas.find((c: any) => c.banco === banco).saldo
    expect(saldo(tr.body.cuentas, 'Banco A')).toBe(700000)
    expect(saldo(tr.body.cuentas, 'Banco B')).toBe(800000)

    const rev = await admin.req(`/finanzas/transferencias/${tr.body.transferencia.id}`, { method: 'DELETE' })
    expect(rev.status).toBe(200)
    expect(saldo(rev.body.cuentas, 'Banco A')).toBe(1_000_000)
    expect(saldo(rev.body.cuentas, 'Banco B')).toBe(500_000)
  })

  it('revertir dos veces no duplica plata', async () => {
    const a = await crearCuenta(1_000_000, 'Banco A')
    const b = await crearCuenta(0, 'Banco B')
    const tr = await admin.req('/finanzas/transferencias', {
      method: 'POST', body: JSON.stringify({ cuentaOrigenId: a.id, cuentaDestinoId: b.id, monto: 100000 }),
    })
    await admin.req(`/finanzas/transferencias/${tr.body.transferencia.id}`, { method: 'DELETE' })
    const segunda = await admin.req(`/finanzas/transferencias/${tr.body.transferencia.id}`, { method: 'DELETE' })
    expect(segunda.status).toBe(404)

    const { body } = await admin.req('/finanzas/cuentas')
    expect(body.cuentas.find((c: any) => c.banco === 'Banco A').saldo).toBe(1_000_000)
  })

  it('no se puede revertir si el destino ya gastó la plata', async () => {
    const a = await crearCuenta(1_000_000, 'Banco A')
    const b = await crearCuenta(0, 'Banco B')
    const tr = await admin.req('/finanzas/transferencias', {
      method: 'POST', body: JSON.stringify({ cuentaOrigenId: a.id, cuentaDestinoId: b.id, monto: 400000 }),
    })
    await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({ descripcion: 'Vaciar', categoria: 'otros', monto: 400000, cuentaBancariaId: b.id }),
    })
    const rev = await admin.req(`/finanzas/transferencias/${tr.body.transferencia.id}`, { method: 'DELETE' })
    expect(rev.status).toBe(400)
  })

  it('rechaza transferir a la misma cuenta', async () => {
    const a = await crearCuenta(1_000_000)
    const r = await admin.req('/finanzas/transferencias', {
      method: 'POST', body: JSON.stringify({ cuentaOrigenId: a.id, cuentaDestinoId: a.id, monto: 1000 }),
    })
    expect(r.status).toBe(400)
  })
})

describe('Cartera por edades', () => {
  it('reparte el saldo por antigüedad y descuenta los abonos', async () => {
    const cliente = (await admin.req('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Deudor' }) })).body.cliente

    // Factura vencida hace 100 días, con un abono parcial.
    const vieja = await admin.req('/finanzas/facturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'cxc', clienteId: cliente.id, total: 500000, fechaVencimiento: hoyMas(-100) }),
    })
    expect(vieja.status).toBe(201)
    await admin.req('/finanzas/abonos', {
      method: 'POST', body: JSON.stringify({ facturaId: vieja.body.factura.id, tipo: 'cxc', monto: 200000 }),
    })
    // Factura aún no vencida.
    await admin.req('/finanzas/facturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'cxc', clienteId: cliente.id, total: 150000, fechaVencimiento: hoyMas(10) }),
    })

    const { body } = await admin.req('/finanzas/cartera?tipo=cxc')
    const fila = body.filas.find((f: any) => f.contraparte === 'Deudor')
    expect(fila.dMas90).toBe(300000)   // 500.000 − 200.000 de abono
    expect(fila.porVencer).toBe(150000)
    expect(fila.total).toBe(450000)
    expect(fila.facturas).toBe(2)
  })
})

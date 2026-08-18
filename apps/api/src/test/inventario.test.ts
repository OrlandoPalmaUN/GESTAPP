/**
 * Inventario y su interacción con pedidos y órdenes de compra.
 *
 * Casi todos estos casos son regresiones de bugs REALES que ya ocurrieron en
 * producción y están documentados en el historial:
 *
 * - Oscilar el estado de un pedido aplicaba una segunda reserva sin liberar la
 *   primera, dejando unidades "fantasma" descontadas (commit 4ad14e3).
 * - Recibir una OC sin proveedor movía inventario pero NO generaba la cuenta
 *   por pagar, en silencio (commit 311ce22).
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prepararTenant, limpiarTenant, limpiarDatos, sesionAdmin, type Sesion } from './apoyo.js'

let admin: Sesion

beforeAll(async () => {
  await prepararTenant()
  admin = await sesionAdmin()
})
afterAll(limpiarTenant)
beforeEach(limpiarDatos)

async function nuevoProducto(stockInicial = 100) {
  const r = await admin.req('/inventario/productos', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Producto', sku: `SKU-${Date.now()}-${Math.random()}`, precioVenta: 50000, precioCosto: 30000, stockInicial }),
  })
  expect(r.status).toBe(201)
  return r.body.producto
}

async function stockDe(productoId: string): Promise<number> {
  const { body } = await admin.req('/inventario/productos')
  return body.productos.find((p: any) => p.id === productoId).stockDisponible
}

describe('Stock derivado del ledger', () => {
  it('el stock inicial queda registrado como movimiento, no como columna', async () => {
    const p = await nuevoProducto(50)
    expect(await stockDe(p.id)).toBe(50)

    const { body } = await admin.req('/inventario/movimientos')
    const suyos = body.movimientos.filter((m: any) => m.productoId === p.id)
    expect(suyos.length).toBeGreaterThan(0)
  })

  it('no deja que un ajuste manual deje el stock en negativo', async () => {
    const p = await nuevoProducto(10)
    const r = await admin.req('/inventario/movimientos', {
      method: 'POST',
      body: JSON.stringify({ productoId: p.id, tipo: 'ajuste_negativo', cantidad: 11 }),
    })
    expect(r.status).toBe(400)
    expect(await stockDe(p.id)).toBe(10)
  })
})

describe('Pedidos y movimientos de inventario', () => {
  it('confirmar reserva stock y cancelar lo libera', async () => {
    const p = await nuevoProducto(100)
    const cli = (await admin.req('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'C' }) })).body.cliente
    const ped = (await admin.req('/pedidos', {
      method: 'POST', body: JSON.stringify({ clienteId: cli.id, items: [{ productoId: p.id, cantidad: 10 }] }),
    })).body.pedido

    await admin.req(`/pedidos/${ped.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'confirmado' }) })
    expect(await stockDe(p.id)).toBe(90)

    await admin.req(`/pedidos/${ped.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'cancelado' }) })
    expect(await stockDe(p.id)).toBe(100)
  })

  it('oscilar el estado NO descuenta dos veces (regresión del stock fantasma)', async () => {
    const p = await nuevoProducto(100)
    const cli = (await admin.req('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'C' }) })).body.cliente
    const ped = (await admin.req('/pedidos', {
      method: 'POST', body: JSON.stringify({ clienteId: cli.id, items: [{ productoId: p.id, cantidad: 10 }] }),
    })).body.pedido

    // Ir y volver varias veces: antes cada "confirmado" aplicaba una reserva
    // nueva sin liberar la anterior.
    for (const estado of ['confirmado', 'borrador', 'confirmado', 'borrador', 'confirmado']) {
      await admin.req(`/pedidos/${ped.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado }) })
    }
    expect(await stockDe(p.id)).toBe(90)

    // Y al cancelar debe volver exactamente al inicial, sin unidades fantasma.
    await admin.req(`/pedidos/${ped.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'cancelado' }) })
    expect(await stockDe(p.id)).toBe(100)
  })

  it('despachar descuenta una sola vez pese a liberar la reserva previa', async () => {
    const p = await nuevoProducto(100)
    const cli = (await admin.req('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'C' }) })).body.cliente
    const ped = (await admin.req('/pedidos', {
      method: 'POST', body: JSON.stringify({ clienteId: cli.id, items: [{ productoId: p.id, cantidad: 10 }] }),
    })).body.pedido

    await admin.req(`/pedidos/${ped.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'confirmado' }) })
    await admin.req(`/pedidos/${ped.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'despachado' }) })
    // Libera la reserva (+10) y aplica la salida (−10): neto −10, no −20.
    expect(await stockDe(p.id)).toBe(90)

    await admin.req(`/pedidos/${ped.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'entregado' }) })
    expect(await stockDe(p.id)).toBe(90)
  })
})

describe('Órdenes de compra', () => {
  async function nuevaOC(proveedorId: string | null, productoId: string, cantidad = 10) {
    const r = await admin.req('/compras', {
      method: 'POST',
      body: JSON.stringify({ proveedorId, items: [{ productoId, cantidad, precioUnitario: 20000 }] }),
    })
    expect(r.status).toBe(201)
    return r.body.pedido
  }

  it('recibir una OC con proveedor genera la CxP y suma el inventario', async () => {
    const p = await nuevoProducto(0)
    const prov = (await admin.req('/proveedores', { method: 'POST', body: JSON.stringify({ nombre: 'Proveedor' }) })).body.proveedor
    const oc = await nuevaOC(prov.id, p.id, 10)

    await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'enviado' }) })
    const r = await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'recibido' }) })
    expect(r.status).toBe(200)
    expect(r.body.pedido.facturaCompraId).toBeTruthy()
    expect(await stockDe(p.id)).toBe(10)

    const { body } = await admin.req('/finanzas/facturas?tipo=cxp')
    expect(body.facturas).toHaveLength(1)
    expect(body.facturas[0].total).toBe(200000)
  })

  it('recibir SIN proveedor se bloquea — antes movía inventario sin generar CxP', async () => {
    const p = await nuevoProducto(0)
    const oc = await nuevaOC(null, p.id, 10)

    await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'enviado' }) })
    const r = await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'recibido' }) })
    expect(r.status).toBe(400)

    // Y no dejó rastro: ni inventario ni cuenta por pagar.
    expect(await stockDe(p.id)).toBe(0)
    const { body } = await admin.req('/finanzas/facturas?tipo=cxp')
    expect(body.facturas).toHaveLength(0)
  })

  it('la recepción parcial genera CxP solo por lo recibido', async () => {
    const p = await nuevoProducto(0)
    const prov = (await admin.req('/proveedores', { method: 'POST', body: JSON.stringify({ nombre: 'Proveedor' }) })).body.proveedor
    const oc = await nuevaOC(prov.id, p.id, 10)
    await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'enviado' }) })

    const detalle = await admin.req(`/compras/${oc.id}`)
    const itemId = detalle.body.pedido.items[0].id

    const r = await admin.req(`/compras/${oc.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'recibido_parcial', cantidades: [{ itemId, cantidadRecibida: 4 }] }),
    })
    expect(r.status).toBe(200)
    expect(await stockDe(p.id)).toBe(4)

    const { body } = await admin.req('/finanzas/facturas?tipo=cxp')
    expect(body.facturas[0].total).toBe(80000) // 4 × 20.000, no los 10 pedidos
  })

  it('completar la recepción actualiza la MISMA CxP en vez de crear otra', async () => {
    const p = await nuevoProducto(0)
    const prov = (await admin.req('/proveedores', { method: 'POST', body: JSON.stringify({ nombre: 'Proveedor' }) })).body.proveedor
    const oc = await nuevaOC(prov.id, p.id, 10)
    await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'enviado' }) })
    const itemId = (await admin.req(`/compras/${oc.id}`)).body.pedido.items[0].id

    await admin.req(`/compras/${oc.id}/estado`, {
      method: 'PATCH', body: JSON.stringify({ estado: 'recibido_parcial', cantidades: [{ itemId, cantidadRecibida: 4 }] }),
    })
    await admin.req(`/compras/${oc.id}/estado`, {
      method: 'PATCH', body: JSON.stringify({ estado: 'recibido', cantidades: [{ itemId, cantidadRecibida: 10 }] }),
    })

    const { body } = await admin.req('/finanzas/facturas?tipo=cxp')
    expect(body.facturas).toHaveLength(1)      // una sola, no dos
    expect(body.facturas[0].total).toBe(200000)
    expect(await stockDe(p.id)).toBe(10)       // el delta, no 4 + 10
  })

  it('no se puede borrar una OC que ya recibió inventario', async () => {
    const p = await nuevoProducto(0)
    const prov = (await admin.req('/proveedores', { method: 'POST', body: JSON.stringify({ nombre: 'Proveedor' }) })).body.proveedor
    const oc = await nuevaOC(prov.id, p.id, 5)
    await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'enviado' }) })
    await admin.req(`/compras/${oc.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'recibido' }) })

    const r = await admin.req(`/compras/${oc.id}`, { method: 'DELETE' })
    expect(r.status).toBe(400)
  })
})

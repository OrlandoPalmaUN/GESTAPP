/**
 * La fusión de Compras dentro de Gastos.
 *
 * Los dos caminos nuevos (`POST /compras/directa` y el gasto a crédito)
 * escriben en inventario, cartera y saldos bancarios dentro de una sola
 * transacción. Eso es exactamente el tipo de interacción donde aparecieron
 * los bugs históricos de este sistema, así que se verifica el efecto real en
 * la base, no el 201 de la respuesta.
 *
 * Invariantes que se cuidan acá:
 *  - una compra de inventario NUNCA se guarda como gasto operativo (si lo
 *    hiciera, el egreso se restaría dos veces de la utilidad: como gasto y
 *    otra vez como costo de la mercancía al venderla);
 *  - el stock solo se mueve por el ledger de `movimientos_inventario`;
 *  - revertir una recepción compensa con movimientos nuevos, nunca borrando.
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

async function crearCuenta(saldo: number) {
  const r = await admin.req('/finanzas/cuentas', {
    method: 'POST',
    body: JSON.stringify({ banco: 'Banco QA', numero: String(Math.floor(Math.random() * 1e6)), tipo: 'ahorros', saldo }),
  })
  expect(r.status).toBe(201)
  return r.body.cuenta
}

async function crearProveedor(nombre = 'Proveedor QA') {
  const r = await admin.req('/proveedores', { method: 'POST', body: JSON.stringify({ nombre }) })
  expect(r.status).toBe(201)
  return r.body.proveedor
}

async function crearProducto(stockInicial = 0) {
  const r = await admin.req('/inventario/productos', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Producto', sku: `SKU-${Date.now()}-${Math.random()}`, precioVenta: 50000, precioCosto: 30000, stockInicial }),
  })
  expect(r.status).toBe(201)
  return r.body.producto
}

async function stockDe(productoId: string): Promise<number> {
  const { body } = await admin.req('/inventario/productos')
  return body.productos.find((p: { id: string }) => p.id === productoId).stockDisponible
}

async function facturasCxP() {
  const r = await admin.req('/finanzas/facturas?tipo=cxp')
  expect(r.status).toBe(200)
  return r.body.facturas as { id: string; saldoPendiente: number }[]
}

async function saldoDe(cuentaId: string): Promise<number> {
  const r = await admin.req('/finanzas/cuentas')
  return Number(r.body.cuentas.find((c: { id: string }) => c.id === cuentaId).saldo)
}

describe('Compra de inventario registrada desde Gastos', () => {
  it('una compra pagada entra al stock, crea la CxP y la deja saldada', async () => {
    const cuenta = await crearCuenta(1_000_000)
    const proveedor = await crearProveedor()
    const producto = await crearProducto(0)

    const r = await admin.req('/compras/directa', {
      method: 'POST',
      body: JSON.stringify({
        proveedorId: proveedor.id,
        descripcion: 'Compra de mercancía',
        pagado: true,
        cuentaBancariaId: cuenta.id,
        items: [{ productoId: producto.id, cantidad: 10, precioUnitario: 20000 }],
      }),
    })
    expect(r.status).toBe(201)

    // El stock se deriva del ledger: si el movimiento no se insertó, esto falla.
    expect(await stockDe(producto.id)).toBe(10)
    // 10 × 20.000 = 200.000 salieron del banco.
    expect(await saldoDe(cuenta.id)).toBe(800_000)

    // La CxP existe y quedó en cero (el abono automático la saldó).
    const facturas = await facturasCxP()
    expect(facturas).toHaveLength(1)
    expect(Number(facturas[0]!.saldoPendiente)).toBe(0)
  })

  it('una compra a crédito entra al stock pero no toca el banco', async () => {
    const cuenta = await crearCuenta(1_000_000)
    const proveedor = await crearProveedor()
    const producto = await crearProducto(5)

    const r = await admin.req('/compras/directa', {
      method: 'POST',
      body: JSON.stringify({
        proveedorId: proveedor.id,
        descripcion: 'Compra a crédito',
        pagado: false,
        fechaVencimientoCxP: hoyMas(30),
        items: [{ productoId: producto.id, cantidad: 3, precioUnitario: 15000 }],
      }),
    })
    expect(r.status).toBe(201)

    expect(await stockDe(producto.id)).toBe(8)
    expect(await saldoDe(cuenta.id)).toBe(1_000_000)

    const facturas = await facturasCxP()
    expect(facturas).toHaveLength(1)
    expect(Number(facturas[0]!.saldoPendiente)).toBe(45000)
  })

  it('una compra retro-fechada emite su CxP con la fecha de la compra, no la de hoy', async () => {
    const proveedor = await crearProveedor()
    const producto = await crearProducto(0)
    const fechaCompra = hoyMas(-10)

    const r = await admin.req('/compras/directa', {
      method: 'POST',
      body: JSON.stringify({
        proveedorId: proveedor.id,
        fecha: fechaCompra,
        descripcion: 'Compra de la semana pasada',
        pagado: false,
        items: [{ productoId: producto.id, cantidad: 1, precioUnitario: 10000 }],
      }),
    })
    expect(r.status).toBe(201)
    expect(r.body.pedido.fecha).toBe(fechaCompra)

    const cxp = (await facturasCxP())[0] as unknown as { fechaEmision: string; fechaVencimiento: string }
    expect(cxp.fechaEmision).toBe(fechaCompra)
    // El vencimiento por defecto son 30 días desde la compra, no desde hoy.
    const esperado = new Date(fechaCompra)
    esperado.setDate(esperado.getDate() + 30)
    expect(cxp.fechaVencimiento).toBe(esperado.toISOString().slice(0, 10))
  })

  it('NUNCA se guarda como gasto operativo — si lo hiciera, el egreso se restaría dos veces', async () => {
    const proveedor = await crearProveedor()
    const producto = await crearProducto(0)

    await admin.req('/compras/directa', {
      method: 'POST',
      body: JSON.stringify({
        proveedorId: proveedor.id,
        descripcion: 'Compra de mercancía',
        pagado: false,
        items: [{ productoId: producto.id, cantidad: 1, precioUnitario: 10000 }],
      }),
    })

    const gastos = await admin.req('/finanzas/gastos')
    expect(gastos.body.gastos).toHaveLength(0)
  })
})

describe('Revertir la recepción de una compra', () => {
  it('saca del stock lo que había entrado, compensando en vez de borrar', async () => {
    const proveedor = await crearProveedor()
    const producto = await crearProducto(0)

    const r = await admin.req('/compras/directa', {
      method: 'POST',
      body: JSON.stringify({
        proveedorId: proveedor.id,
        descripcion: 'Compra con typo',
        pagado: false,
        items: [{ productoId: producto.id, cantidad: 7, precioUnitario: 1000 }],
      }),
    })
    expect(r.status).toBe(201)
    expect(await stockDe(producto.id)).toBe(7)

    const rev = await admin.req(`/compras/${r.body.pedido.id}/revertir-recepcion`, { method: 'POST' })
    expect(rev.status).toBe(200)

    expect(await stockDe(producto.id)).toBe(0)

    // El ledger es append-only: la entrada original sigue ahí, con su
    // compensación al lado. Esa historia es lo que permite auditar.
    const movs = await admin.req(`/inventario/movimientos?productoId=${producto.id}`)
    const tipos = movs.body.movimientos.map((m: { tipo: string }) => m.tipo)
    expect(tipos).toContain('entrada_compra')
    expect(tipos).toContain('ajuste_negativo')
  })

  it('se niega si la mercancía ya se vendió — el stock no puede quedar negativo', async () => {
    const proveedor = await crearProveedor()
    const producto = await crearProducto(0)
    const cliente = (await admin.req('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Cliente QA' }) })).body.cliente

    const compra = await admin.req('/compras/directa', {
      method: 'POST',
      body: JSON.stringify({
        proveedorId: proveedor.id,
        descripcion: 'Mercancía que se vende rápido',
        pagado: false,
        items: [{ productoId: producto.id, cantidad: 10, precioUnitario: 1000 }],
      }),
    })
    expect(compra.status).toBe(201)
    expect(await stockDe(producto.id)).toBe(10)

    // Se venden 8 de las 10 que entraron.
    const ped = await admin.req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 8 }] }),
    })
    expect(ped.status).toBe(201)
    expect((await admin.req(`/pedidos/${ped.body.pedido.id}/estado`, {
      method: 'PATCH', body: JSON.stringify({ estado: 'confirmado' }),
    })).status).toBe(200)
    expect(await stockDe(producto.id)).toBe(2)

    // Revertir sacaría 10 de un stock de 2.
    const rev = await admin.req(`/compras/${compra.body.pedido.id}/revertir-recepcion`, { method: 'POST' })
    expect(rev.status).toBe(400)

    // Y no debe haber movido nada: revertir a medias es peor que no revertir.
    expect(await stockDe(producto.id)).toBe(2)
  })

  it('se niega si la cuenta por pagar ya recibió abonos', async () => {
    const cuenta = await crearCuenta(1_000_000)
    const proveedor = await crearProveedor()
    const producto = await crearProducto(0)

    const r = await admin.req('/compras/directa', {
      method: 'POST',
      body: JSON.stringify({
        proveedorId: proveedor.id,
        descripcion: 'Compra pagada',
        pagado: true,
        cuentaBancariaId: cuenta.id,
        items: [{ productoId: producto.id, cantidad: 2, precioUnitario: 5000 }],
      }),
    })
    expect(r.status).toBe(201)

    const rev = await admin.req(`/compras/${r.body.pedido.id}/revertir-recepcion`, { method: 'POST' })
    expect(rev.status).toBe(400)
  })
})

describe('Ingresos manuales', () => {
  /**
   * Regresión: al agregar proveedor_id/factura_compra_id a gastos_operativos,
   * esas columnas se colaron en las consultas de ingresos_bancarios, que no
   * las tiene. La ruta devolvía 500 y ningún test lo cubría porque los
   * ingresos no se tocaban en esta tanda.
   */
  it('registrar un ingreso suma al saldo de la cuenta', async () => {
    const cuenta = await crearCuenta(100_000)

    const r = await admin.req('/finanzas/ingresos', {
      method: 'POST',
      body: JSON.stringify({ descripcion: 'Aporte de socio', categoria: 'otro', monto: 400000, cuentaBancariaId: cuenta.id }),
    })
    expect(r.status).toBe(201)
    expect(await saldoDe(cuenta.id)).toBe(500_000)

    const listado = await admin.req('/finanzas/ingresos')
    expect(listado.status).toBe(200)
    expect(listado.body.ingresos).toHaveLength(1)
  })

  it('editar y borrar un ingreso deshacen el movimiento de saldo', async () => {
    const cuenta = await crearCuenta(0)
    const r = await admin.req('/finanzas/ingresos', {
      method: 'POST',
      body: JSON.stringify({ descripcion: 'Venta de contado', categoria: 'otro', monto: 200000, cuentaBancariaId: cuenta.id }),
    })
    expect(r.status).toBe(201)
    expect(await saldoDe(cuenta.id)).toBe(200_000)

    const patch = await admin.req(`/finanzas/ingresos/${r.body.ingreso.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ monto: 250000 }),
    })
    expect(patch.status).toBe(200)
    expect(await saldoDe(cuenta.id)).toBe(250_000)

    const del = await admin.req(`/finanzas/ingresos/${r.body.ingreso.id}`, { method: 'DELETE' })
    expect([200, 204]).toContain(del.status)
    expect(await saldoDe(cuenta.id)).toBe(0)
  })
})

describe('Editar un gasto que quedó a crédito', () => {
  /**
   * El PATCH existía desde antes y era inofensivo mientras ningún gasto tenía
   * CxP. Al permitir gastos a crédito —y al darle por fin una UI de edición—
   * pasó a poder romper dos invariantes de golpe, así que quedan cubiertas.
   */
  async function gastoACredito(monto: number) {
    const proveedor = await crearProveedor(`Proveedor ${Math.random()}`)
    const r = await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({ descripcion: 'Servicio contratado', monto, categoria: 'honorarios', aCredito: true, proveedorId: proveedor.id }),
    })
    expect(r.status).toBe(201)
    return r.body.gasto
  }

  it('no deja pagarlo descontando una cuenta bancaria — para eso está el abono', async () => {
    const cuenta = await crearCuenta(1_000_000)
    const gasto = await gastoACredito(200000)

    const r = await admin.req(`/finanzas/gastos/${gasto.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ cuentaBancariaId: cuenta.id }),
    })
    expect(r.status).toBe(400)
    // Lo importante no es el 400 sino que el banco no se haya movido.
    expect(await saldoDe(cuenta.id)).toBe(1_000_000)
  })

  it('corregir el monto corrige también el total de su cuenta por pagar', async () => {
    const gasto = await gastoACredito(200000)

    const r = await admin.req(`/finanzas/gastos/${gasto.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ monto: 350000 }),
    })
    expect(r.status).toBe(200)

    const cxp = (await facturasCxP()).find(f => f.id === gasto.facturaCompraId)
    expect(Number(cxp!.saldoPendiente)).toBe(350000)
  })

  it('no deja cambiar el monto si la CxP ya recibió abonos', async () => {
    const cuenta = await crearCuenta(1_000_000)
    const gasto = await gastoACredito(200000)

    const abono = await admin.req('/finanzas/abonos', {
      method: 'POST',
      body: JSON.stringify({ facturaId: gasto.facturaCompraId, tipo: 'cxp', monto: 120000, cuentaBancariaId: cuenta.id }),
    })
    expect(abono.status).toBe(201)

    // Bajarlo a 50.000 dejaría una factura con más abonado que su total.
    const r = await admin.req(`/finanzas/gastos/${gasto.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ monto: 50000 }),
    })
    expect(r.status).toBe(400)

    const cxp = (await facturasCxP()).find(f => f.id === gasto.facturaCompraId)
    expect(Number(cxp!.saldoPendiente)).toBe(80000)
  })
})

describe('Gasto a crédito', () => {
  it('no toca el banco y genera una cuenta por pagar', async () => {
    const cuenta = await crearCuenta(500_000)
    const proveedor = await crearProveedor('Arrendador QA')

    const r = await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({
        descripcion: 'Arriendo de octubre',
        monto: 120000,
        categoria: 'arriendo',
        aCredito: true,
        proveedorId: proveedor.id,
        fechaVencimiento: hoyMas(15),
      }),
    })
    expect(r.status).toBe(201)
    expect(r.body.gasto.facturaCompraId).toBeTruthy()

    expect(await saldoDe(cuenta.id)).toBe(500_000)

    const factura = (await facturasCxP()).find(f => f.id === r.body.gasto.facturaCompraId)
    expect(factura).toBeTruthy()
    expect(Number(factura!.saldoPendiente)).toBe(120000)
  })

  it('un gasto pagado sigue descontando del banco, como siempre', async () => {
    const cuenta = await crearCuenta(500_000)

    const r = await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({
        descripcion: 'Servicios públicos',
        monto: 80000,
        categoria: 'servicios',
        cuentaBancariaId: cuenta.id,
      }),
    })
    expect(r.status).toBe(201)
    expect(r.body.gasto.facturaCompraId).toBeFalsy()
    expect(await saldoDe(cuenta.id)).toBe(420_000)
  })

  it('acepta las categorías nuevas que antes rechazaba', async () => {
    for (const categoria of ['transporte', 'impuestos', 'mantenimiento', 'honorarios', 'financieros']) {
      const r = await admin.req('/finanzas/gastos', {
        method: 'POST',
        body: JSON.stringify({ descripcion: `Gasto ${categoria}`, monto: 1000, categoria }),
      })
      expect(r.status, `categoría ${categoria}`).toBe(201)
    }
  })

  it('borrar un gasto a crédito con abonos se rechaza', async () => {
    const cuenta = await crearCuenta(500_000)
    const proveedor = await crearProveedor('Proveedor con abono')

    const gasto = await admin.req('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify({
        descripcion: 'Honorarios contables',
        monto: 200000,
        categoria: 'honorarios',
        aCredito: true,
        proveedorId: proveedor.id,
      }),
    })
    expect(gasto.status).toBe(201)

    const abono = await admin.req('/finanzas/abonos', {
      method: 'POST',
      body: JSON.stringify({
        facturaId: gasto.body.gasto.facturaCompraId,
        tipo: 'cxp',
        monto: 50000,
        medioPago: 'transferencia',
        cuentaBancariaId: cuenta.id,
      }),
    })
    expect(abono.status).toBe(201)

    const del = await admin.req(`/finanzas/gastos/${gasto.body.gasto.id}`, { method: 'DELETE' })
    expect(del.status).toBe(400)
  })
})

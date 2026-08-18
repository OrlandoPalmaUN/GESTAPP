/** Verifica que el plazo de crédito por cliente determine el vencimiento de la CxC. */
const API = 'http://localhost:4000'
let token = ''

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
  })
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) }
}

const fails: string[] = []
function check(nombre: string, cond: boolean, detalle = '') {
  console.log(`${cond ? '  OK  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!cond) fails.push(nombre)
}
const hoyMas = (d: number) => {
  const f = new Date(); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10)
}

async function main() {
  const login = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'qa-debug-temp@example.invalid', password: 'QaDebug1234!' }),
  })
  if (login.status !== 200) { console.error('login falló', login); process.exit(1) }
  token = login.body.token

  const { body: prods } = await req('/inventario/productos')
  const prodId = prods.productos[0]?.id
  if (!prodId) { console.error('falta un producto; corré qa-seed-pedido.ts'); process.exit(1) }

  console.log('\n── El plazo del cliente define el vencimiento de la CxC ──')
  const casos: { nombre: string; plazo: number | null; esperado: number }[] = [
    { nombre: 'Cliente de contado', plazo: 0, esperado: 0 },
    { nombre: 'Cliente a 60 días', plazo: 60, esperado: 60 },
    { nombre: 'Cliente sin plazo definido', plazo: null, esperado: 30 },
  ]

  for (const c of casos) {
    const cli = await req('/clientes', {
      method: 'POST',
      body: JSON.stringify({ nombre: c.nombre, ...(c.plazo !== null ? { plazoDias: c.plazo } : {}) }),
    })
    check(`crear ${c.nombre}`, cli.status === 201, `status ${cli.status}`)
    check(`  plazoDias persiste`, cli.body?.cliente?.plazoDias === c.plazo, `= ${cli.body?.cliente?.plazoDias}`)

    const ped = await req('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ clienteId: cli.body.cliente.id, items: [{ productoId: prodId, cantidad: 1 }] }),
    })
    check(`  pedido creado`, ped.status === 201, `status ${ped.status}`)

    const { body: fact } = await req('/finanzas/facturas?tipo=cxc')
    const cxc = fact.facturas.find((f: any) => f.pedidoId === ped.body.pedido.id)
    check(
      `  CxC vence en ${c.esperado} días`,
      cxc?.fechaVencimiento === hoyMas(c.esperado),
      `vence ${cxc?.fechaVencimiento}, esperado ${hoyMas(c.esperado)}`,
    )
  }

  console.log('\n── El cupo se guarda y se puede corregir ──')
  const conCupo = await req('/clientes', {
    method: 'POST', body: JSON.stringify({ nombre: 'Cliente con cupo', cupoCredito: 500000, plazoDias: 15 }),
  })
  check('cupo persiste', conCupo.body?.cliente?.cupoCredito === 500000, `= ${conCupo.body?.cliente?.cupoCredito}`)
  const patch = await req(`/clientes/${conCupo.body.cliente.id}`, {
    method: 'PATCH', body: JSON.stringify({ cupoCredito: 800000 }),
  })
  check('cupo se puede editar', patch.body?.cliente?.cupoCredito === 800000, `= ${patch.body?.cliente?.cupoCredito}`)
  const quitar = await req(`/clientes/${conCupo.body.cliente.id}`, {
    method: 'PATCH', body: JSON.stringify({ cupoCredito: null }),
  })
  check('cupo se puede quitar (sin límite)', quitar.body?.cliente?.cupoCredito === null, `= ${quitar.body?.cliente?.cupoCredito}`)

  const negativo = await req('/clientes', {
    method: 'POST', body: JSON.stringify({ nombre: 'Inválido', plazoDias: -5 }),
  })
  check('rechaza plazo negativo', negativo.status === 400, `status ${negativo.status}`)

  console.log(`\n${fails.length === 0 ? '✅ TODO PASÓ' : `❌ ${fails.length} FALLA(S): ${fails.join(', ')}`}`)
  process.exitCode = fails.length === 0 ? 0 : 1
}
void main().catch((e) => { console.error(e); process.exitCode = 1 })

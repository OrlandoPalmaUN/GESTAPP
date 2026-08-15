/** Prueba end-to-end contra la API local: transferencia + reversa, y PATCH de gasto/ingreso. */
const API = 'http://localhost:4000'

let token = ''
async function req(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, body }
}

const fails: string[] = []
function check(nombre: string, cond: boolean, detalle = '') {
  console.log(`${cond ? '  OK  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!cond) fails.push(nombre)
}
const saldo = (cuentas: any[], banco: string) => Number(cuentas.find((c: any) => c.banco === banco).saldo)

async function main() {
  const login = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'qa-debug-temp@example.invalid', password: 'QaDebug1234!' }),
  })
  if (login.status !== 200) { console.error('login falló', login); process.exit(1) }
  token = login.body.token

  let { body: c0 } = await req('/finanzas/cuentas')
  const idA = c0.cuentas.find((c: any) => c.banco === 'Banco A').id
  const idB = c0.cuentas.find((c: any) => c.banco === 'Banco B').id
  console.log(`\nSaldos iniciales: A=${saldo(c0.cuentas, 'Banco A')} B=${saldo(c0.cuentas, 'Banco B')}`)

  // ── 1. Transferencia y reversa ──────────────────────────────────────────
  console.log('\n── Transferencia + reversa ──')
  const tr = await req('/finanzas/transferencias', {
    method: 'POST',
    body: JSON.stringify({ cuentaOrigenId: idA, cuentaDestinoId: idB, monto: 300000, descripcion: 'QA' }),
  })
  check('crear transferencia → 201', tr.status === 201, `status ${tr.status}`)
  check('saldo A bajó a 700.000', saldo(tr.body.cuentas, 'Banco A') === 700000, `A=${saldo(tr.body.cuentas, 'Banco A')}`)
  check('saldo B subió a 800.000', saldo(tr.body.cuentas, 'Banco B') === 800000, `B=${saldo(tr.body.cuentas, 'Banco B')}`)

  const rev = await req(`/finanzas/transferencias/${tr.body.transferencia.id}`, { method: 'DELETE' })
  check('revertir transferencia → 200', rev.status === 200, `status ${rev.status}`)
  check('saldo A volvió a 1.000.000', saldo(rev.body.cuentas, 'Banco A') === 1000000, `A=${saldo(rev.body.cuentas, 'Banco A')}`)
  check('saldo B volvió a 500.000', saldo(rev.body.cuentas, 'Banco B') === 500000, `B=${saldo(rev.body.cuentas, 'Banco B')}`)

  const lista = await req('/finanzas/transferencias')
  check('la revertida ya no aparece en el listado', lista.body.transferencias.length === 0, `${lista.body.transferencias.length} en lista`)

  const rev2 = await req(`/finanzas/transferencias/${tr.body.transferencia.id}`, { method: 'DELETE' })
  check('revertir dos veces → 404 (no duplica saldo)', rev2.status === 404, `status ${rev2.status}`)

  // ── 2. Reversa imposible: el destino ya gastó la plata ───────────────────
  console.log('\n── Reversa bloqueada por saldo insuficiente ──')
  const tr2 = await req('/finanzas/transferencias', {
    method: 'POST', body: JSON.stringify({ cuentaOrigenId: idA, cuentaDestinoId: idB, monto: 400000 }),
  })
  // Vaciar Banco B con un gasto para que no pueda revertirse.
  const g0 = await req('/finanzas/gastos', {
    method: 'POST', body: JSON.stringify({ descripcion: 'vaciar B', monto: 800000, cuentaBancariaId: idB, categoria: 'otros' }),
  })
  check('gasto que vacía B → 201', g0.status === 201, `status ${g0.status}`)
  const revImposible = await req(`/finanzas/transferencias/${tr2.body.transferencia.id}`, { method: 'DELETE' })
  check('reversa sin fondos → 400 (no deja saldo negativo)', revImposible.status === 400, `status ${revImposible.status}`)
  await req(`/finanzas/gastos/${g0.body.gasto.id}`, { method: 'DELETE' })
  await req(`/finanzas/transferencias/${tr2.body.transferencia.id}`, { method: 'DELETE' })

  // ── 3. PATCH de gasto con ajuste de saldo ────────────────────────────────
  console.log('\n── PATCH gasto (ajusta saldo) ──')
  const g = await req('/finanzas/gastos', {
    method: 'POST', body: JSON.stringify({ descripcion: 'Arriendo', monto: 200000, cuentaBancariaId: idA, categoria: 'arriendo' }),
  })
  check('crear gasto → 201', g.status === 201, `status ${g.status}`)
  let cs = (await req('/finanzas/cuentas')).body.cuentas
  check('saldo A bajó a 800.000', saldo(cs, 'Banco A') === 800000, `A=${saldo(cs, 'Banco A')}`)

  const gp = await req(`/finanzas/gastos/${g.body.gasto.id}`, {
    method: 'PATCH', body: JSON.stringify({ monto: 250000, descripcion: 'Arriendo corregido' }),
  })
  check('corregir monto → 200', gp.status === 200, `status ${gp.status}`)
  cs = (await req('/finanzas/cuentas')).body.cuentas
  check('saldo A refleja el monto corregido (750.000)', saldo(cs, 'Banco A') === 750000, `A=${saldo(cs, 'Banco A')}`)
  check('la descripción se actualizó', gp.body.gasto.descripcion === 'Arriendo corregido')

  const gp2 = await req(`/finanzas/gastos/${g.body.gasto.id}`, {
    method: 'PATCH', body: JSON.stringify({ cuentaBancariaId: idB }),
  })
  check('mover gasto a otra cuenta → 200', gp2.status === 200, `status ${gp2.status}`)
  cs = (await req('/finanzas/cuentas')).body.cuentas
  check('A recuperó su saldo (1.000.000)', saldo(cs, 'Banco A') === 1000000, `A=${saldo(cs, 'Banco A')}`)
  check('B absorbió el gasto (250.000)', saldo(cs, 'Banco B') === 250000, `B=${saldo(cs, 'Banco B')}`)

  // ── 4. PATCH de ingreso ──────────────────────────────────────────────────
  console.log('\n── PATCH ingreso (ajusta saldo) ──')
  const i = await req('/finanzas/ingresos', {
    method: 'POST', body: JSON.stringify({ descripcion: 'Capital', monto: 100000, cuentaBancariaId: idA, categoria: 'capital' }),
  })
  check('crear ingreso → 201', i.status === 201, `status ${i.status}`)
  cs = (await req('/finanzas/cuentas')).body.cuentas
  check('saldo A subió a 1.100.000', saldo(cs, 'Banco A') === 1100000, `A=${saldo(cs, 'Banco A')}`)

  const ip = await req(`/finanzas/ingresos/${i.body.ingreso.id}`, {
    method: 'PATCH', body: JSON.stringify({ monto: 60000 }),
  })
  check('corregir ingreso → 200', ip.status === 200, `status ${ip.status}`)
  cs = (await req('/finanzas/cuentas')).body.cuentas
  check('saldo A refleja el ingreso corregido (1.060.000)', saldo(cs, 'Banco A') === 1060000, `A=${saldo(cs, 'Banco A')}`)

  console.log(`\n${fails.length === 0 ? '✅ TODO PASÓ' : `❌ ${fails.length} FALLA(S): ${fails.join(', ')}`}`)
  process.exitCode = fails.length === 0 ? 0 : 1
}
void main().catch((e) => { console.error(e); process.exitCode = 1 })

/** Verifica que el rol `usuario` pueda operar el día a día pero NO tocar dinero ni borrar. */
import { resolve } from 'node:path'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import { config } from 'dotenv'
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })
import { getPrismaClient } from '@antigravity/db'

const API = 'http://localhost:4000'
const scrypt = promisify(scryptCallback)

async function hash(p: string) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${((await scrypt(p, salt, 64)) as Buffer).toString('hex')}`
}

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

async function main() {
  // Crear un empleado con rol `usuario` en el tenant de QA.
  const prisma = getPrismaClient()
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'qa-debug-temp' } })
  if (!tenant) { console.error('Falta el tenant QA — corré qa-seed.ts'); process.exit(1) }
  await prisma.usuario.upsert({
    where: { email: 'qa-empleado@example.invalid' },
    create: { email: 'qa-empleado@example.invalid', passwordHash: await hash('QaDebug1234!'), nombre: 'Empleado QA', rol: 'usuario', status: 'active', tenantId: tenant.id },
    update: { passwordHash: await hash('QaDebug1234!'), rol: 'usuario', status: 'active', tenantId: tenant.id },
  })
  await prisma.$disconnect()

  const login = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'qa-empleado@example.invalid', password: 'QaDebug1234!' }),
  })
  if (login.status !== 200) { console.error('login falló', login); process.exit(1) }
  token = login.body.token

  console.log('\n── El empleado SÍ puede hacer su trabajo ──')
  for (const [nombre, path] of [
    ['ver inventario', '/inventario/productos'],
    ['ver pedidos', '/pedidos'],
    ['ver clientes', '/clientes'],
    ['ver cuentas por cobrar', '/finanzas/facturas?tipo=cxc'],
    ['ver cuentas bancarias', '/finanzas/cuentas'],
    ['ver compras', '/compras'],
  ] as const) {
    const r = await req(path)
    check(nombre, r.status === 200, `status ${r.status}`)
  }
  const nuevoCliente = await req('/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Cliente del empleado' }) })
  check('crear un cliente', nuevoCliente.status === 201, `status ${nuevoCliente.status}`)

  console.log('\n── El empleado NO puede tocar dinero ni borrar ──')
  const cuentas = (await req('/finanzas/cuentas')).body.cuentas
  const idCuenta = cuentas[0]?.id
  const casos: [string, string, RequestInit][] = [
    ['crear cuenta bancaria', '/finanzas/cuentas', { method: 'POST', body: JSON.stringify({ banco: 'X', numero: '9', tipo: 'ahorros', saldo: 0 }) }],
    ['borrar cuenta bancaria', `/finanzas/cuentas/${idCuenta}`, { method: 'DELETE' }],
    ['borrar un cliente', `/clientes/${nuevoCliente.body?.cliente?.id}`, { method: 'DELETE' }],
    ['ver reportes de margen', '/reportes/periodo?tipo=mes', {}],
    ['ver el log de auditoría', '/auditoria', {}],
    ['ver la papelera', '/papelera', {}],
  ]
  for (const [nombre, path, init] of casos) {
    const r = await req(path, init)
    check(nombre + ' → 403', r.status === 403, `status ${r.status}`)
  }

  console.log(`\n${fails.length === 0 ? '✅ TODO PASÓ' : `❌ ${fails.length} FALLA(S): ${fails.join(', ')}`}`)
  process.exitCode = fails.length === 0 ? 0 : 1
}
void main().catch((e) => { console.error(e); process.exitCode = 1 })

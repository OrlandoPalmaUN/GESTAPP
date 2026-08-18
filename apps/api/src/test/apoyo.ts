/**
 * Apoyo para los tests de integración.
 *
 * Los tests corren contra la API real y una base de datos real, sobre un tenant
 * DESCARTABLE (`qa-test`). Nunca tocan los schemas de las empresas reales: todo
 * lo que crean vive dentro de `tenant_qa_test` y se elimina al terminar.
 *
 * Se eligió integración por sobre unitario a propósito: los bugs que aparecieron
 * en este sistema (doble descuento de stock, CxP que no se generaba, margen mal
 * calculado) no eran de funciones sueltas sino de la interacción entre ruta,
 * transacción y SQL. Un test unitario con la base mockeada no habría atrapado
 * ninguno.
 */
import { resolve } from 'node:path'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import { config } from 'dotenv'

config({ path: resolve(process.cwd(), '../../.env') })

import { getPrismaClient, getPgPool, provisionarSchemaDeTenant } from '@antigravity/db'

const scrypt = promisify(scryptCallback)

export const API = process.env.TEST_API_URL ?? 'http://localhost:4000'
export const SLUG = 'qa-test'
export const SCHEMA = `tenant_${SLUG.replace(/-/g, '_')}`
const EMAIL_ADMIN = 'qa-test-admin@example.invalid'
const EMAIL_EMPLEADO = 'qa-test-empleado@example.invalid'
const PASSWORD = 'QaTest1234!'

async function hash(p: string): Promise<string> {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${((await scrypt(p, salt, 64)) as Buffer).toString('hex')}`
}

export interface Sesion {
  token: string
  req: (path: string, init?: RequestInit) => Promise<{ status: number; body: any }>
}

function crearSesion(token: string): Sesion {
  return {
    token,
    async req(path, init) {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
        },
      })
      return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) }
    },
  }
}

async function login(email: string): Promise<Sesion> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`No se pudo iniciar sesión como ${email} (${res.status}). ¿Está corriendo la API en ${API}?`)
  return crearSesion(((await res.json()) as { token: string }).token)
}

/** Crea el tenant de pruebas desde cero. Idempotente. */
export async function prepararTenant(): Promise<void> {
  const prisma = getPrismaClient()
  const pool = getPgPool()

  // Partir siempre de cero para que un test no herede datos de otra corrida.
  await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  await pool.query('DELETE FROM public.migration_log WHERE schema_name = $1', [SCHEMA])

  // OJO con el orden: el schema se provisiona ANTES de insertar el tenant.
  // El servidor aplica migraciones a TODOS los tenants activos al arrancar
  // (hook `onReady` en app.ts), y en desarrollo `tsx watch` lo reinicia al
  // guardar cualquier archivo. Si el tenant existiera primero, ese arranque y
  // este setup correrían el mismo `CREATE TABLE` a la vez y uno de los dos
  // fallaría con "ya existe" — que es exactamente lo que pasó al escribir
  // estos tests. Creando el schema primero, el servidor nunca ve un tenant sin
  // provisionar.
  await provisionarSchemaDeTenant(pool, SCHEMA)

  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    create: { name: 'QA Test', slug: SLUG, schemaName: SCHEMA, plan: 'basico' },
    update: {},
  })

  for (const [email, rol] of [[EMAIL_ADMIN, 'admin'], [EMAIL_EMPLEADO, 'usuario']] as const) {
    await prisma.usuario.upsert({
      where: { email },
      create: { email, passwordHash: await hash(PASSWORD), nombre: `QA ${rol}`, rol, status: 'active', tenantId: tenant.id },
      update: { passwordHash: await hash(PASSWORD), rol, status: 'active', tenantId: tenant.id },
    })
  }
}

/** Borra por completo el tenant de pruebas. Solo toca `tenant_qa_test`. */
export async function limpiarTenant(): Promise<void> {
  const prisma = getPrismaClient()
  const pool = getPgPool()
  await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  await pool.query('DELETE FROM public.migration_log WHERE schema_name = $1', [SCHEMA])
  await prisma.usuario.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_EMPLEADO] } } })
  await prisma.tenant.deleteMany({ where: { slug: SLUG } })
  await prisma.$disconnect()
}

export const sesionAdmin = () => login(EMAIL_ADMIN)
export const sesionEmpleado = () => login(EMAIL_EMPLEADO)

/** Vacía los datos de negocio entre tests, sin recrear el schema. */
export async function limpiarDatos(): Promise<void> {
  const pool = getPgPool()
  const client = await pool.connect()
  try {
    await client.query(`SET search_path TO "${SCHEMA}", public`)
    // El orden respeta las llaves foráneas.
    for (const t of [
      'abonos', 'facturas_venta', 'facturas_compra',
      'pedido_items', 'pedidos',
      'pedidos_proveedor_items', 'pedidos_proveedor',
      'movimientos_inventario', 'transferencias_bancarias',
      'gastos_operativos', 'ingresos_bancarios',
      'variantes_producto', 'producto_atributos', 'productos',
      'clientes', 'proveedores', 'cuentas_bancarias',
    ]) {
      await client.query(`DELETE FROM ${t}`)
    }
  } finally {
    client.release()
  }
}

/** Fecha de hoy + n días, en YYYY-MM-DD. */
export const hoyMas = (n: number): string => {
  const f = new Date()
  f.setDate(f.getDate() + n)
  return f.toISOString().slice(0, 10)
}

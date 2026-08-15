import { resolve } from 'node:path'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import { config } from 'dotenv'
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })
import { getPrismaClient, getPgPool, provisionarSchemaDeTenant } from '@antigravity/db'

const scrypt = promisify(scryptCallback)
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`
}

async function main(): Promise<void> {
  const prisma = getPrismaClient()
  const slug = 'qa-debug-temp'
  const schemaName = `tenant_${slug.replace(/-/g, '_')}`

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: { name: 'QA Debug Temp', slug, schemaName, plan: 'basico' },
    update: {},
  })
  const pool = getPgPool()
  await provisionarSchemaDeTenant(pool, schemaName)

  await prisma.usuario.upsert({
    where: { email: 'qa-debug-temp@example.invalid' },
    create: { email: 'qa-debug-temp@example.invalid', passwordHash: await hashPassword('QaDebug1234!'), nombre: 'QA', rol: 'admin', status: 'active', tenantId: tenant.id },
    update: { passwordHash: await hashPassword('QaDebug1234!'), rol: 'admin', status: 'active', tenantId: tenant.id },
  })

  const client = await pool.connect()
  try {
    await client.query(`SET search_path TO "${schemaName}", public`)
    await client.query(`DELETE FROM transferencias_bancarias`)
    await client.query(`DELETE FROM gastos_operativos`)
    await client.query(`DELETE FROM ingresos_bancarios`)
    await client.query(`DELETE FROM cuentas_bancarias`)
    await client.query(
      `INSERT INTO cuentas_bancarias (banco, numero, tipo, saldo)
       VALUES ('Banco A', '001', 'ahorros', 1000000), ('Banco B', '002', 'corriente', 500000)`,
    )
  } finally { client.release() }

  console.log('seed listo')
  await prisma.$disconnect()
}
void main().catch((e: unknown) => { console.error(e); process.exitCode = 1 })

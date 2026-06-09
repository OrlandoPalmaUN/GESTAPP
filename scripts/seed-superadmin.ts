/**
 * Crea (o actualiza la contraseña de) el usuario `superadmin` inicial de la
 * plataforma — no hay auto-registro (decisión del usuario: "lo hace el
 * superadmin"), así que alguien tiene que existir para crear a los demás.
 *
 * Uso: `pnpm seed:superadmin` (lee SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD del
 * `.env` raíz — si no están definidas, usa los defaults de `apps/api/src/config/env.ts`).
 *
 * Idempotente: si el usuario ya existe, solo actualiza nombre/rol/password
 * (útil para "resetear" la contraseña del superadmin sin tocar la DB a mano).
 */
import { resolve } from 'node:path'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'

import { config } from 'dotenv'

config({ path: resolve(process.cwd(), '.env') })

import { getPrismaClient } from '@antigravity/db'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`
}

async function main(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL ?? 'superadmin@gmail.com'
  const password = process.env.SUPERADMIN_PASSWORD ?? 'admin1234'
  const nombre = 'Super Admin'

  const prisma = getPrismaClient()
  const passwordHash = await hashPassword(password)

  const usuario = await prisma.usuario.upsert({
    where: { email },
    create: { email, passwordHash, nombre, rol: 'superadmin', status: 'active' },
    update: { passwordHash, nombre, rol: 'superadmin', status: 'active' },
  })

  console.log(`✔ Superadmin listo: ${usuario.email} (id: ${usuario.id})`)
  console.log(`  Contraseña: la definida en SUPERADMIN_PASSWORD (o el default si no la configuraste).`)

  await prisma.$disconnect()
}

void main().catch((error: unknown) => {
  console.error('✗ No se pudo crear/actualizar el superadmin:', error)
  process.exitCode = 1
})

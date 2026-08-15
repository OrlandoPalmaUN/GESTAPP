/**
 * Promueve a `admin` al dueño de cada empresa que quedó sin ningún admin.
 *
 * Contexto: hasta ahora ningún endpoint de negocio validaba rol, así que daba
 * igual con qué rol quedara registrado cada quien. Al activar los permisos, una
 * empresa cuyo ÚNICO usuario tiene rol `usuario` se queda sin poder ver sus
 * propios reportes, su papelera ni administrar sus cuentas bancarias.
 *
 * Solo toca empresas con exactamente UN usuario: en ese caso esa persona es
 * inequívocamente la dueña. Si una empresa tiene varios usuarios y ninguno es
 * admin, NO adivina — lo reporta para que lo resuelva una persona.
 *
 * Simula por defecto. Para aplicar de verdad:
 *   npx tsx src/scripts/promover-duenos-a-admin.ts --aplicar
 */
import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve('/Users/orlandopalma/Documents/GitHub/GESTAPP', '.env') })
import { getPrismaClient } from '@antigravity/db'

const APLICAR = process.argv.includes('--aplicar')

async function main(): Promise<void> {
  const prisma = getPrismaClient()

  const tenants = await prisma.tenant.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
  })

  console.log(APLICAR ? '\nAPLICANDO CAMBIOS\n' : '\nSIMULACIÓN (nada se modifica) — usá --aplicar para ejecutar\n')

  let promovidos = 0
  let ambiguos = 0

  for (const t of tenants) {
    const usuarios = await prisma.usuario.findMany({
      where: { tenantId: t.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, rol: true },
    })
    if (usuarios.length === 0) continue
    if (usuarios.some((u) => u.rol === 'admin' || u.rol === 'superadmin')) continue

    if (usuarios.length === 1) {
      const u = usuarios[0]!
      console.log(`${t.name}: ${u.email} — '${u.rol}' → 'admin'`)
      if (APLICAR) {
        await prisma.usuario.update({ where: { id: u.id }, data: { rol: 'admin' } })
      }
      promovidos++
    } else {
      console.log(
        `${t.name}: ${usuarios.length} usuarios y ninguno es admin — NO se toca. ` +
        `Definí a mano quién debe serlo: ${usuarios.map((u) => u.email).join(', ')}`,
      )
      ambiguos++
    }
  }

  if (promovidos === 0 && ambiguos === 0) {
    console.log('Todas las empresas activas ya tienen al menos un admin. Nada que hacer.')
  } else {
    console.log(`\n${promovidos} promoción(es)${APLICAR ? ' aplicada(s)' : ' pendiente(s)'}${ambiguos > 0 ? `, ${ambiguos} caso(s) ambiguo(s) sin tocar` : ''}.`)
  }

  await prisma.$disconnect()
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

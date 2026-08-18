/**
 * Límites por plan de suscripción.
 *
 * `subscription_plans` estaba modelada en Prisma con `max_usuarios` y
 * `max_productos` desde el principio, pero no existía ningún endpoint que la
 * leyera ni código que la aplicara: los límites que se mostraban en la interfaz
 * eran literales escritos a mano en el JSX. Es decir, el plan no significaba
 * nada.
 *
 * DISEÑO DELIBERADO: si el plan del tenant no está en `subscription_plans`, o
 * el límite es `NULL`, NO hay tope. La tabla hoy está vacía, así que activar
 * esto no cambia el comportamiento de ninguna empresa en producción — pero la
 * verificación ya queda hecha para cuando se empiece a cobrar. Un límite que
 * bloquea a un negocio de operar es mucho peor que uno que no se aplica: la
 * decisión de restringir tiene que ser explícita, poblando la tabla.
 */
import type { PrismaClient } from '@antigravity/db'

export interface LimitesPlan {
  maxUsuarios: number | null
  maxProductos: number | null
}

const SIN_LIMITE: LimitesPlan = { maxUsuarios: null, maxProductos: null }

/** Límites configurados para un plan. Sin fila en la tabla → sin límite. */
export async function limitesDelPlan(prisma: PrismaClient, plan: string): Promise<LimitesPlan> {
  const fila = await prisma.subscriptionPlan.findFirst({
    where: { name: plan },
    select: { maxUsuarios: true, maxProductos: true },
  })
  return fila ?? SIN_LIMITE
}

/**
 * Verifica si crear un recurso más excedería el plan.
 * Devuelve `null` si se puede, o el mensaje de error si no.
 */
export function verificarCupo(
  actual: number,
  limite: number | null,
  recurso: 'usuarios' | 'productos',
  plan: string,
): string | null {
  if (limite === null) return null
  if (actual < limite) return null
  return (
    `Tu plan ${plan} permite hasta ${limite} ${recurso} y ya tenés ${actual}. ` +
    `Cambiá de plan para agregar más.`
  )
}

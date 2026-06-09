/**
 * Vocabulario de planes y estados de tenant (plan §7 y §9). Se modelan como
 * arrays `as const` — de ahí derivan tanto el tipo unión (abajo) como el
 * `z.enum` espejo en `schemas/tenant.ts`, así nunca quedan desincronizados.
 */
export const PLAN_IDS = ['basico', 'profesional', 'empresarial'] as const
export type PlanId = (typeof PLAN_IDS)[number]

export const TENANT_STATUSES = ['active', 'suspended', 'cancelled'] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

/**
 * Empresa registrada (tabla `public.tenants`, plan §9). `slug` resuelve el
 * subdominio (miempresa.antigravity.co) y `schemaName` apunta al schema de
 * Postgres con sus datos operativos — ver tenant-resolver en `apps/api`.
 *
 * Las fechas viajan como string ISO 8601: este tipo describe la forma "de
 * cable" (lo que la API serializa y el frontend consume), no el `Date` que
 * devuelve Prisma del lado del servidor.
 */
export interface Tenant {
  id: string
  name: string
  slug: string
  schemaName: string
  plan: PlanId
  status: TenantStatus
  createdAt: string
  trialEndsAt: string | null
}

/**
 * Catálogo de planes y precios (tabla `public.subscription_plans`, plan §7 y §9).
 * `maxUsuarios`/`maxProductos` en `null` significa "ilimitado".
 */
export interface SubscriptionPlan {
  id: string
  name: string
  precioCop: number
  maxUsuarios: number | null
  maxProductos: number | null
  features: Record<string, unknown>
}

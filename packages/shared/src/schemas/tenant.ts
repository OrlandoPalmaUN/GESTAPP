import { z } from 'zod'

import { PLAN_IDS, TENANT_STATUSES, type SubscriptionPlan, type Tenant } from '../types/tenant.js'

export const planIdSchema = z.enum(PLAN_IDS)
export const tenantStatusSchema = z.enum(TENANT_STATUSES)

/**
 * Espejo de validación de `Tenant` para datos que cruzan el límite API ⇄
 * frontend (respuestas JSON, formularios). El `satisfies` no liga un tipo al
 * otro — solo verifica en build-time que no se desincronizaron.
 */
export const tenantSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  schemaName: z.string().min(1),
  plan: planIdSchema,
  status: tenantStatusSchema,
  createdAt: z.iso.datetime(),
  trialEndsAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<Tenant>

/**
 * Body de `POST /admin/tenants` — crear una empresa nueva. Solo el
 * `superadmin` puede hacerlo (las empresas no se auto-registran todavía —
 * eso es el futuro flujo de onboarding). `slug` resuelve el subdominio, así
 * que se restringe a un formato seguro para URLs/DNS; `schemaName` lo deriva
 * el servidor a partir del slug — no lo decide quien crea el tenant.
 */
export const crearTenantSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones (sin empezar/terminar en guión).'),
  plan: planIdSchema.default('basico'),
})

export const subscriptionPlanSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  precioCop: z.number().int().nonnegative(),
  maxUsuarios: z.number().int().positive().nullable(),
  maxProductos: z.number().int().positive().nullable(),
  features: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<SubscriptionPlan>

import { z } from 'zod'

/**
 * Variables de entorno del API. Se validan al boot — si falta o está mal
 * formada alguna, el server falla de inmediato con un mensaje claro en vez
 * de fallar más tarde a mitad de un request (ver plan, "Manejo de errores
 * y observabilidad desde el día 1").
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url(),
  APP_DOMAIN: z.string().default('localhost'),

  // --- Auth (login de plataforma — superadmin/admin/usuario) ---------------
  // Secreto para firmar los JWT de sesión (cookie httpOnly). En dev tiene un
  // default razonable; en producción la plataforma debe inyectar uno propio.
  JWT_SECRET: z.string().min(16).default('dev-secret-cambiar-en-produccion-1234'),
  // Credenciales del superadmin inicial — lo crea `scripts/seed-superadmin.ts`
  // si no existe todavía (no hay auto-registro, ver módulo de comunicaciones).
  SUPERADMIN_EMAIL: z.string().email().default('superadmin@gmail.com'),
  SUPERADMIN_PASSWORD: z.string().min(8).default('admin1234'),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) => value?.split(',').map((origin) => origin.trim()) ?? true),

  // --- Apify / Instagram Insights ----------------------------------------
  APIFY_TOKEN: z.string().default(''),
  APIFY_WEBHOOK_SECRET: z.string().min(16).default('dev-apify-webhook-secret-1234'),
  APIFY_DEFAULT_ACTOR: z.string().default('apify/instagram-scraper'),
  IG_REFRESH_COOLDOWN_HOURS: z.coerce.number().int().positive().default(6),

  // --- Groq AI --------------------------------------------------------------
  GROQ_API_KEY: z.string().default(''),
  // Segunda key opcional — se usa como fallback cuando la primera alcanza el rate limit
  GROQ_API_KEY_2: z.string().default(''),
})

export type Env = z.infer<typeof envSchema>

// `app.ts` decora la instancia con `app.decorate('config', env)` directo
// (ver nota en ese archivo sobre por qué no hay un plugin separado para
// esto) — esta augmentation es lo que le permite a TS conocer ese campo.
declare module 'fastify' {
  interface FastifyInstance {
    config: Env
  }
}

let cachedEnv: Env | undefined

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv

  const result = envSchema.safeParse(source)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Variables de entorno inválidas:\n${issues}`)
  }

  cachedEnv = result.data
  return cachedEnv
}

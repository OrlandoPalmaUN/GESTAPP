import { z } from 'zod'

/**
 * Variables de entorno del API. Se validan al boot — si falta o está mal
 * formada alguna, el server falla de inmediato con un mensaje claro en vez
 * de fallar más tarde a mitad de un request (ver plan, "Manejo de errores
 * y observabilidad desde el día 1").
 */
/**
 * Valores por defecto que existen SOLO para que `pnpm dev` arranque sin
 * configurar nada. Están en el repositorio, así que en producción equivalen a
 * no tener secreto: cualquiera que lea el código los conoce. El `superRefine`
 * de abajo impide arrancar con ellos cuando NODE_ENV=production.
 */
const DEFAULT_JWT_SECRET = 'dev-secret-cambiar-en-produccion-1234'
const DEFAULT_SUPERADMIN_PASSWORD = 'admin1234'
const DEFAULT_APIFY_WEBHOOK_SECRET = 'dev-apify-webhook-secret-1234'

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
  JWT_SECRET: z.string().min(16).default(DEFAULT_JWT_SECRET),
  // Credenciales del superadmin inicial — lo crea `scripts/seed-superadmin.ts`
  // si no existe todavía (no hay auto-registro, ver módulo de comunicaciones).
  SUPERADMIN_EMAIL: z.string().email().default('superadmin@gmail.com'),
  SUPERADMIN_PASSWORD: z.string().min(8).default(DEFAULT_SUPERADMIN_PASSWORD),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) => value?.split(',').map((origin) => origin.trim()) ?? true),

  // --- Apify / Instagram Insights ----------------------------------------
  APIFY_TOKEN: z.string().default(''),
  APIFY_WEBHOOK_SECRET: z.string().min(16).default(DEFAULT_APIFY_WEBHOOK_SECRET),
  APIFY_DEFAULT_ACTOR: z.string().default('apify/instagram-scraper'),
  IG_REFRESH_COOLDOWN_HOURS: z.coerce.number().int().positive().default(6),

  // --- Groq AI --------------------------------------------------------------
  GROQ_API_KEY: z.string().default(''),
  // Segunda key opcional — se usa como fallback cuando la primera alcanza el rate limit
  GROQ_API_KEY_2: z.string().default(''),
  // Google AI Studio key — Gemini 2.0 Flash gratis: 1500 req/día
  // Obtener en: aistudio.google.com/apikey
  GOOGLE_AI_KEY: z.string().default(''),
})
  /**
   * Barrera de producción. Todo lo de arriba tiene default para que `pnpm dev`
   * arranque sin configurar nada — pero eso significaba que un deploy al que
   * se le olvidara una variable arrancaba igual, sin error y sin aviso, con
   * el secreto que está publicado en el repositorio.
   *
   * Con NODE_ENV=production preferimos que el servidor NO arranque: un deploy
   * que falla se nota y se arregla; uno que arranca inseguro no se nota hasta
   * que alguien entra a los datos de otro tenant.
   */
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return

    const exigir = (campo: string, inseguro: boolean, motivo: string) => {
      if (!inseguro) return
      ctx.addIssue({ code: 'custom', path: [campo], message: motivo })
    }

    exigir(
      'JWT_SECRET',
      env.JWT_SECRET === DEFAULT_JWT_SECRET,
      'En producción debes definir un JWT_SECRET propio. El valor por defecto está en el repositorio: con él, cualquiera puede firmar un token y entrar como superadmin de cualquier empresa.',
    )
    exigir(
      'SUPERADMIN_PASSWORD',
      env.SUPERADMIN_PASSWORD === DEFAULT_SUPERADMIN_PASSWORD,
      'En producción debes definir un SUPERADMIN_PASSWORD propio — el valor por defecto es público.',
    )
    exigir(
      'APIFY_WEBHOOK_SECRET',
      env.APIFY_WEBHOOK_SECRET === DEFAULT_APIFY_WEBHOOK_SECRET,
      'En producción debes definir un APIFY_WEBHOOK_SECRET propio, o el webhook de Apify queda abierto.',
    )
    // `CORS_ORIGINS` sin definir se transforma en `true` = permitir cualquier
    // origen. Combinado con `credentials: true` (ver app.ts), eso deja que
    // cualquier sitio web haga peticiones autenticadas con la cookie de sesión
    // del usuario. Es la más peligrosa de las cuatro porque no se ve.
    exigir(
      'CORS_ORIGINS',
      env.CORS_ORIGINS === true,
      'En producción debes listar los orígenes permitidos (ej: https://tuapp.vercel.app). Sin esto se acepta CUALQUIER origen con credenciales, que anula el aislamiento entre empresas.',
    )
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

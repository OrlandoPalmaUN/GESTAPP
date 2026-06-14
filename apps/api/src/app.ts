import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import Fastify, { type FastifyInstance } from 'fastify'

import { loadEnv } from './config/env.js'
import { loggerOptions } from './lib/logger.js'
import { releaseTenantConnection, tenantResolver } from './middleware/tenant-resolver.js'
import authPlugin from './plugins/auth.js'
import dbPlugin from './plugins/db.js'
import { igCronPlugin } from './plugins/ig_cron.js'
import { adminTenantsRoutes } from './routes/admin/tenants.js'
import { adminUsuariosRoutes } from './routes/admin/usuarios.js'
import { authRoutes } from './routes/auth.js'
import { healthRoutes } from './routes/health.js'
import { clientesRoutes } from './routes/tenant/clientes.js'
import { comunicacionesRoutes } from './routes/tenant/comunicaciones.js'
import { redesSocialesRoutes } from './routes/tenant/redes_sociales.js'
import { aiChatRoutes } from './routes/tenant/ai_chat.js'
import { webhookApifyRoutes } from './routes/webhook_apify.js'
import { crmRoutes } from './routes/tenant/crm.js'
import { dashboardRoutes } from './routes/tenant/dashboard.js'
import { finanzasRoutes } from './routes/tenant/finanzas.js'
import { inventarioRoutes } from './routes/tenant/inventario.js'
import { papeleraRoutes } from './routes/tenant/papelera.js'
import { pedidosRoutes } from './routes/tenant/pedidos.js'
import { pedidosProveedorRoutes } from './routes/tenant/pedidos_proveedor.js'
import { proveedoresRoutes } from './routes/tenant/proveedores.js'
import { reportesRoutes } from './routes/tenant/reportes.js'

/**
 * Construye (sin levantar) la instancia de Fastify. Separado de `server.ts`
 * para poder testear rutas con `app.inject(...)` sin abrir un puerto real.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv()

  const app = Fastify({
    logger: loggerOptions(env),
  })

  app.decorate('config', env)

  await app.register(sensible)
  // `credentials: true` es necesario para que el navegador envíe/reciba la
  // cookie de sesión httpOnly entre orígenes (web en :3000, api en :4000).
  // Sin `methods` explícito, @fastify/cors solo permite GET/HEAD/POST en el
  // preflight — cualquier PATCH/PUT/DELETE (renombrar/eliminar categorías,
  // actualizar perfil, etc.) queda bloqueado por el navegador antes de
  // siquiera llegar al servidor.
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
  })
  await app.register(dbPlugin)
  await app.register(authPlugin)

  // Tenant resolver (plan §4): corre antes que cualquier ruta de negocio.
  // El release va tanto en onResponse (camino feliz) como en onError —
  // si solo va en uno, una excepción a mitad de request filtra la conexión.
  app.addHook('onRequest', tenantResolver)
  app.addHook('onResponse', releaseTenantConnection)
  app.addHook('onError', async (request) => releaseTenantConnection(request))

  // Log estructurado por request — plan §10: "cada request loguea: tenant,
  // usuario, duración, resultado".
  app.addHook('onResponse', async (request, reply) => {
    app.log.info(
      {
        tenant: request.tenant?.slug,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
      },
      'request completado',
    )
  })

  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(adminUsuariosRoutes)
  await app.register(adminTenantsRoutes)
  await app.register(inventarioRoutes)
  await app.register(clientesRoutes)
  await app.register(proveedoresRoutes)
  await app.register(pedidosRoutes)
  await app.register(pedidosProveedorRoutes)
  await app.register(crmRoutes)
  await app.register(finanzasRoutes)
  await app.register(comunicacionesRoutes)
  await app.register(redesSocialesRoutes)
  await app.register(aiChatRoutes)
  await app.register(webhookApifyRoutes)
  await app.register(igCronPlugin)
  await app.register(papeleraRoutes)
  await app.register(dashboardRoutes)
  await app.register(reportesRoutes)

  return app
}

import { resolve } from 'node:path'

import { config } from 'dotenv'

import { buildApp } from './app.js'

// El `.env` vive en la raíz del monorepo, no en apps/api: pnpm/turbo corren
// el script de cada paquete con cwd = el propio paquete (dos niveles bajo la
// raíz), así que apuntamos ahí explícitamente. Si el archivo no existe (p.ej.
// en producción, donde las env vars las inyecta la plataforma) esto no falla,
// solo no hace nada — `loadEnv()` (llamada dentro de `buildApp`) sigue siendo
// quien valida y falla rápido si de verdad falta algo.
config({ path: resolve(process.cwd(), '../../.env') })

async function main(): Promise<void> {
  const app = await buildApp()

  try {
    await app.listen({ host: app.config.HOST, port: app.config.PORT })
  } catch (error) {
    app.log.error(error, 'no se pudo iniciar el servidor')
    process.exit(1)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info({ signal }, 'apagando servidor')
      void app.close().then(() => process.exit(0))
    })
  }
}

void main()

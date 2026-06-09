import type { FastifyBaseLogger } from 'fastify'
import type { Env } from '../config/env.js'

/**
 * Opciones para el logger de Fastify (pino por debajo). Las pasamos al
 * constructor de Fastify en vez de crear un pino aparte: así `app.log` y
 * `request.log` usan la misma config — nivel configurable + pretty-print
 * en dev — tal como pide el plan §10 ("Manejo de errores y observabilidad
 * desde el día 1").
 */
export function loggerOptions(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>) {
  return {
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  }
}

export type Logger = FastifyBaseLogger

import type { FastifyInstance } from 'fastify'

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async () => ({
    status: 'ok',
    service: '@antigravity/api',
    timestamp: new Date().toISOString(),
  }))
}

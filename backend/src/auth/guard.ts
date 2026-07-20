import type { FastifyInstance } from 'fastify'
import { isAuthenticated } from './session.js'

const PUBLIC_API_PATHS = ['/api/auth/login']

export function registerAuthGuard(app: FastifyInstance, ttlSeconds: number): void {
  app.addHook('onRequest', async (req, reply) => {
    const url = req.raw.url ?? ''
    if (!url.startsWith('/api/')) return
    if (PUBLIC_API_PATHS.some((p) => url === p || url.startsWith(`${p}?`))) return
    if (!isAuthenticated(req, ttlSeconds)) {
      return reply.status(401).send({ message: 'Требуется вход' })
    }
  })
}

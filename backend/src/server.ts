import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { AppConfig } from './config.js'
import { authRoutes } from './auth/routes.js'

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie, { secret: config.sessionSecret })
  await app.register(rateLimit, { global: false })

  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(authRoutes, { config })

  return app
}

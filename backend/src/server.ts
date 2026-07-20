import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { AppConfig } from './config.js'
import { registerAuthGuard } from './auth/guard.js'
import { authRoutes } from './auth/routes.js'

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie, { secret: config.sessionSecret })
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => ({
      message: `Слишком много попыток. Повторите через ${context.after}`,
      statusCode: 429,
    }),
  })

  app.get('/health', async () => ({ status: 'ok' }))

  registerAuthGuard(app, config.sessionTtlSeconds)

  await app.register(authRoutes, { config })

  return app
}

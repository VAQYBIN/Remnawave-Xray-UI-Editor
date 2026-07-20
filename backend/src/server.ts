import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import type { AppConfig } from './config.js'
import { authRoutes } from './auth/routes.js'
import { registerAuthGuard } from './auth/guard.js'
import { RemnawaveClient, RemnawaveError } from './remnawave/client.js'
import type { RemnawavePort } from './remnawave/types.js'
import { profileRoutes } from './routes/profiles.js'
import { panelRoutes } from './routes/panel.js'

declare module 'fastify' {
  interface FastifyInstance {
    remnawave: RemnawavePort
  }
}

export interface ServerDeps {
  remnawave?: RemnawavePort
}

export async function buildServer(
  config: AppConfig,
  deps: ServerDeps = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie, { secret: config.sessionSecret })
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => ({
      message: `Слишком много попыток. Повторите через ${context.after}`,
      statusCode: 429,
    }),
  })

  app.decorate(
    'remnawave',
    deps.remnawave ??
      new RemnawaveClient({ baseUrl: config.remnawaveUrl, token: config.remnawaveToken }),
  )

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof RemnawaveError) {
      return reply.status(err.status).send({ message: err.message, details: err.details })
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ message: 'Некорректный запрос', issues: err.issues })
    }
    req.log.error(err)
    const status =
      'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500
    return reply.status(status).send({ message: err.message || 'Внутренняя ошибка' })
  })

  registerAuthGuard(app, config.sessionTtlSeconds)

  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(authRoutes, { config })
  await app.register(profileRoutes)
  await app.register(panelRoutes)

  return app
}

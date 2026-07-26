import { resolve } from 'node:path'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { ZodError } from 'zod'
import type { AppConfig } from './config.js'
import { authRoutes } from './auth/routes.js'
import { registerAuthGuard } from './auth/guard.js'
import { RemnawaveClient, RemnawaveError } from './remnawave/client.js'
import type { RemnawavePort } from './remnawave/types.js'
import { profileRoutes } from './routes/profiles.js'
import { panelRoutes } from './routes/panel.js'
import { BackupService } from './backups/service.js'
import { backupRoutes } from './routes/backups.js'
import { toolsRoutes } from './routes/tools.js'
import { GeoService } from './geo/service.js'
import { geoRoutes } from './routes/geo.js'
import { XrayService } from './xray/service.js'
import type { RealityProbe } from './tools/realityProbe.js'
import type { WarpRegister } from './tools/warp.js'

declare module 'fastify' {
  interface FastifyInstance {
    remnawave: RemnawavePort
    backups: BackupService
    geo: GeoService
    xray: XrayService
  }
}

export interface ServerDeps {
  remnawave?: RemnawavePort
  backups?: BackupService
  geo?: GeoService
  xray?: XrayService
  /** Подменяется в тестах: настоящая проба открывает TLS-соединение наружу */
  probeReality?: RealityProbe
  /** Подменяется в тестах: настоящая регистрация ходит в Cloudflare */
  registerWarp?: WarpRegister
}

export async function buildServer(
  config: AppConfig,
  deps: ServerDeps = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie, { secret: config.sessionSecret })
  // Глобальный потолок — защита закрытых ручек от перебора cookie и от того,
  // что один клиент займёт собой весь сервер. Он заведомо выше живого
  // сценария (загрузка SPA — десятки запросов, вьюер geo-баз листает
  // страницами), а жёсткий лимит на логине задан отдельно в его роуте.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
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
  app.decorate('backups', deps.backups ?? new BackupService(config.dataDir))
  app.decorate(
    'geo',
    deps.geo ?? new GeoService(config.dataDir, { allowPrivate: config.geoAllowPrivateUrls }),
  )
  app.decorate('xray', deps.xray ?? new XrayService(config.xrayBin, config.dataDir))

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof RemnawaveError) {
      // В лог — обязательно: связь с панелью чинят по логам, а раньше причина
      // уходила только в тело ответа и была видна лишь через DevTools.
      req.log.warn({ status: err.status, details: err.details, hint: err.hint }, err.message)
      return reply
        .status(err.status)
        .send({ message: err.message, details: err.details, hint: err.hint })
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
  await app.register(backupRoutes)
  await app.register(toolsRoutes, {
    probeReality: deps.probeReality,
    registerWarp: deps.registerWarp,
  })
  await app.register(geoRoutes)

  await app.register(fastifyStatic, { root: resolve(config.staticDir) })

  app.setNotFoundHandler((req, reply) => {
    if ((req.raw.url ?? '').startsWith('/api/')) {
      return reply.status(404).send({ message: 'Не найдено' })
    }
    return reply.sendFile('index.html')
  })

  return app
}

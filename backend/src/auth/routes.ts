import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../config.js'
import { verifyPassword } from './password.js'
import { SESSION_COOKIE } from './session.js'

const loginSchema = z.object({ password: z.string().min(1) })

export const authRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (app, opts) => {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { password } = loginSchema.parse(req.body)
      if (!(await verifyPassword(password, opts.config.appPassword))) {
        return reply.status(401).send({ message: 'Неверный пароль' })
      }
      reply.setCookie(SESSION_COOKIE, String(Date.now()), {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: opts.config.sessionTtlSeconds,
      })
      return { ok: true }
    },
  )

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', async () => ({ authenticated: true }))
}

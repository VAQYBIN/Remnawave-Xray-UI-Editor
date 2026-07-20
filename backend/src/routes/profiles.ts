import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const paramsSchema = z.object({ uuid: z.string().uuid() })

const createSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_\s-]+$/, 'Имя: латиница, цифры, пробел, - и _'),
  config: z.record(z.unknown()),
})

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/profiles', async () => ({ profiles: await app.remnawave.listProfiles() }))

  app.get('/api/profiles/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    return { profile: await app.remnawave.getProfile(uuid) }
  })

  app.post('/api/profiles', async (req, reply) => {
    const body = createSchema.parse(req.body)
    const profile = await app.remnawave.createProfile(body.name, body.config)
    reply.status(201)
    return { profile }
  })

  app.delete('/api/profiles/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    await app.remnawave.deleteProfile(uuid)
    return { ok: true }
  })
}

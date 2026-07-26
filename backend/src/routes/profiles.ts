import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const paramsSchema = z.object({ uuid: z.string().uuid() })

const createSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_\s-]+$/, 'Имя: латиница, цифры, пробел, - и _'),
  config: z.record(z.string(), z.unknown()),
})

const updateSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_\s-]+$/, 'Имя: латиница, цифры, пробел, - и _')
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  expectedUpdatedAt: z.string().min(1),
})

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/profiles', async () => ({ profiles: await app.remnawave.listProfiles() }))

  app.get('/api/profiles/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    return { profile: await app.remnawave.getProfile(uuid) }
  })

  app.get('/api/profiles/:uuid/inbounds', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    return { inbounds: await app.remnawave.getProfileInbounds(uuid) }
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

  app.patch('/api/profiles/:uuid', async (req, reply) => {
    const { uuid } = paramsSchema.parse(req.params)
    const body = updateSchema.parse(req.body)
    const current = await app.remnawave.getProfile(uuid)
    if (current.updatedAt !== body.expectedUpdatedAt) {
      return reply.status(409).send({
        message: 'Профиль был изменён в панели после открытия',
        current,
      })
    }
    await app.backups.saveBackup(current)
    const profile = await app.remnawave.updateProfile({
      uuid,
      name: body.name,
      config: body.config,
    })
    return { profile }
  })
}

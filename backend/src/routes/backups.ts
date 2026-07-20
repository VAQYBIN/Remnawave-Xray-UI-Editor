import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const listParams = z.object({ uuid: z.string().uuid() })
const readParams = z.object({ uuid: z.string().uuid(), file: z.string().min(1) })

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/profiles/:uuid/backups', async (req) => {
    const { uuid } = listParams.parse(req.params)
    return { backups: await app.backups.list(uuid) }
  })

  app.get('/api/profiles/:uuid/backups/:file', async (req) => {
    const { uuid, file } = readParams.parse(req.params)
    return await app.backups.read(uuid, file)
  })
}

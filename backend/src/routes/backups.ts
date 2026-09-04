import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const listParams = z.object({ uuid: z.string().uuid() })
const readParams = z.object({ uuid: z.string().uuid(), file: z.string().regex(/^[A-Za-z0-9_-]+\.json$/, 'Некорректное имя файла бэкапа') })

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/profiles/:uuid/backups', async (req) => {
    const { uuid } = listParams.parse(req.params)
    return { backups: await app.backups.list(uuid) }
  })

  app.get('/api/profiles/:uuid/backups/:file', async (req) => {
    const { uuid, file } = readParams.parse(req.params)
    return await app.backups.read(uuid, file)
  })

  // Шаблоны живут в своём пространстве имён (backups/templates/<uuid>): uuid
  // профиля и шаблона могут совпасть, и общий путь вернул бы чужие версии
  app.get('/api/templates/:uuid/backups', async (req) => {
    const { uuid } = listParams.parse(req.params)
    return { backups: await app.backups.listTemplateBackups(uuid) }
  })

  app.get('/api/templates/:uuid/backups/:file', async (req) => {
    const { uuid, file } = readParams.parse(req.params)
    return await app.backups.readTemplateBackup(uuid, file)
  })
}

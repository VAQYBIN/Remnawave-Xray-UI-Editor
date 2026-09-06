import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const querySchema = z.object({ url: z.string().url() })

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/catalog/templates', async (_req, reply) => {
    try {
      return { templates: await app.catalog.list() }
    } catch (error) {
      // 502, а не 500: недоступен внешний источник, а не наш сервер
      return reply.status(502).send({ message: (error as Error).message })
    }
  })

  app.get('/api/catalog/template', async (req, reply) => {
    const { url } = querySchema.parse(req.query)
    try {
      return { content: await app.catalog.fetchTemplate(url) }
    } catch (error) {
      return reply.status(502).send({ message: (error as Error).message })
    }
  })
}

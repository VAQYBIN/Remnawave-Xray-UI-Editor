import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const urlsSchema = z.object({
  geositeUrl: z.string().min(1).optional(),
  geoipUrl: z.string().min(1).optional(),
})

const updateSchema = z.object({
  // .min(1), а не .nonempty(): в проекте zod ^3.25, где nonempty уже помечен устаревшим
  kinds: z.array(z.enum(['geosite', 'geoip'])).min(1).optional(),
})

const matchSchema = z.object({
  domain: z.string().min(1).optional(),
  ip: z.string().min(1).optional(),
  keys: z.array(z.string()),
})

export const geoRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/geo', async () => app.geo.status())

  app.put('/api/geo', async (req, reply) => {
    const urls = urlsSchema.parse(req.body)
    try {
      return await app.geo.setUrls(urls)
    } catch (err) {
      // Некорректная ссылка — вина запроса, а не сервера
      if (err instanceof Error && /http/i.test(err.message)) {
        return reply.status(400).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/api/geo/update', async (req) => {
    const { kinds } = updateSchema.parse(req.body ?? {})
    return app.geo.update(kinds)
  })

  app.post('/api/tools/geo/match', async (req) => app.geo.match(matchSchema.parse(req.body)))
}

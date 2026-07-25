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

const kindSchema = z.enum(['geosite', 'geoip'])
const categoryParams = z.object({ kind: kindSchema, code: z.string().min(1) })
const pageQuery = z.object({
  q: z.string().optional(),
  // Значения приходят строками из query — coerce приводит их к числам
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
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

  app.get('/api/geo/:kind/categories', async (req, reply) => {
    const { kind } = z.object({ kind: kindSchema }).parse(req.params)
    const categories = await app.geo.categories(kind)
    if (categories === null) {
      return reply
        .status(404)
        .send({ message: `База ${kind} не загружена — скачайте её на вкладке «Источники»` })
    }
    return { categories }
  })

  app.get('/api/geo/:kind/categories/:code', async (req, reply) => {
    const { kind, code } = categoryParams.parse(req.params)
    const result = await app.geo.categoryPage(kind, code, pageQuery.parse(req.query))
    if (result.status === 'no-database') {
      return reply
        .status(404)
        .send({ message: `База ${kind} не загружена — скачайте её на вкладке «Источники»` })
    }
    if (result.status === 'no-category') {
      return reply.status(404).send({ message: `В базе ${kind} нет категории «${code}»` })
    }
    return result.page
  })

  app.post('/api/geo/update', async (req) => {
    const { kinds } = updateSchema.parse(req.body ?? {})
    return app.geo.update(kinds)
  })

  app.post('/api/tools/geo/match', async (req) => app.geo.match(matchSchema.parse(req.body)))
}

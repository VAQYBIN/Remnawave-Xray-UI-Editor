import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { hashTemplateJson } from '../templates/hash.js'
import { STARTER_XRAY_TEMPLATE } from '../templates/starter.js'
import { nameSchema } from './nameSchema.js'

const paramsSchema = z.object({ uuid: z.string().uuid() })

const createSchema = z.object({ name: nameSchema })

const updateSchema = z.object({
  name: nameSchema.optional(),
  templateJson: z.record(z.string(), z.unknown()),
  /** Хэш, полученный при чтении; считает и сравнивает только бэкенд */
  expectedHash: z.string().min(1),
})

export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/templates', async () => ({ templates: await app.remnawave.listTemplates() }))

  app.get('/api/templates/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    const template = await app.remnawave.getTemplate(uuid)
    return { template, hash: hashTemplateJson(template.templateJson) }
  })

  // Создание у панели двухшаговое: POST делает пустой шаблон, содержимое
  // заливается отдельным PATCH. Склейка здесь, клиент видит одну операцию.
  app.post('/api/templates', async (req, reply) => {
    const body = createSchema.parse(req.body)
    const created = await app.remnawave.createTemplate(body.name, 'XRAY_JSON')
    const template = await app.remnawave.updateTemplate({
      uuid: created.uuid,
      templateJson: STARTER_XRAY_TEMPLATE,
    })
    reply.status(201)
    return { template }
  })

  app.delete('/api/templates/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    const current = await app.remnawave.getTemplate(uuid)
    await app.backups.saveTemplateBackup(current)
    await app.remnawave.deleteTemplate(uuid)
    return { ok: true }
  })

  // Аналог оптимистической блокировки профилей, но по содержимому: у шаблонов
  // нет updatedAt, сравнивать нечего кроме самого JSON.
  app.patch('/api/templates/:uuid', async (req, reply) => {
    const { uuid } = paramsSchema.parse(req.params)
    const body = updateSchema.parse(req.body)
    const current = await app.remnawave.getTemplate(uuid)
    // Редактор умеет только JSON-содержимое (templateJson); у MIHOMO/CLASH/STASH/
    // SINGBOX-YAML содержимое лежит в encodedTemplateYaml, а templateJson === null —
    // применение JSON-патча к такому шаблону оставило бы в нём мусор
    if (current.templateType !== 'XRAY_JSON') {
      return reply.status(400).send({
        message: `Редактор пока умеет только шаблоны XRAY_JSON, а этот — ${current.templateType}`,
      })
    }
    if (hashTemplateJson(current.templateJson) !== body.expectedHash) {
      return reply.status(409).send({
        message: 'Шаблон был изменён в панели после открытия',
        current,
        hash: hashTemplateJson(current.templateJson),
      })
    }
    await app.backups.saveTemplateBackup(current)
    const template = await app.remnawave.updateTemplate({
      uuid,
      name: body.name,
      templateJson: body.templateJson,
    })
    return { template, hash: hashTemplateJson(template.templateJson) }
  })
}

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { hashTemplate, YAML_TEMPLATE_TYPES } from '../templates/hash.js'
import { STARTER_MIHOMO_TEMPLATE } from '../templates/starterMihomo.js'
import { STARTER_XRAY_TEMPLATE } from '../templates/starter.js'
import { nameSchema } from './nameSchema.js'

const paramsSchema = z.object({ uuid: z.string().uuid() })

const createSchema = z.object({
  name: nameSchema,
  templateType: z.enum(['XRAY_JSON', 'MIHOMO']).default('XRAY_JSON'),
})

// Ровно одно из полей содержимого: applying JSON-патч к YAML-шаблону оставил бы
// в нём мусор, а панель приняла бы это молча
const updateSchema = z.object({
  name: nameSchema.optional(),
  templateJson: z.record(z.string(), z.unknown()).optional(),
  encodedTemplateYaml: z.string().optional(),
  /** Хэш, полученный при чтении; считает и сравнивает только бэкенд */
  expectedHash: z.string().min(1),
})

export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/templates', async () => ({ templates: await app.remnawave.listTemplates() }))

  app.get('/api/templates/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    const template = await app.remnawave.getTemplate(uuid)
    return { template, hash: hashTemplate(template) }
  })

  // Создание у панели двухшаговое: POST делает пустой шаблон, содержимое
  // заливается отдельным PATCH. Склейка здесь, клиент видит одну операцию.
  app.post('/api/templates', async (req, reply) => {
    const body = createSchema.parse(req.body)
    const created = await app.remnawave.createTemplate(body.name, body.templateType)
    const template = await app.remnawave.updateTemplate(
      body.templateType === 'MIHOMO'
        ? {
            uuid: created.uuid,
            encodedTemplateYaml: Buffer.from(STARTER_MIHOMO_TEMPLATE, 'utf8').toString('base64'),
          }
        : { uuid: created.uuid, templateJson: STARTER_XRAY_TEMPLATE },
    )
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
  // нет updatedAt, сравнивать нечего кроме самого содержимого.
  app.patch('/api/templates/:uuid', async (req, reply) => {
    const { uuid } = paramsSchema.parse(req.params)
    const body = updateSchema.parse(req.body)
    const current = await app.remnawave.getTemplate(uuid)
    // Тип шаблона решает, в каком поле лежит содержимое: применение чужого
    // поля оставило бы в документе мусор, а панель приняла бы это молча
    const isYaml = YAML_TEMPLATE_TYPES.includes(current.templateType)
    if (isYaml && body.encodedTemplateYaml === undefined) {
      return reply.status(400).send({
        message: `Шаблон ${current.templateType} хранит содержимое в YAML — нужен encodedTemplateYaml`,
      })
    }
    if (!isYaml && body.templateJson === undefined) {
      return reply.status(400).send({
        message: `Шаблон ${current.templateType} хранит содержимое в JSON — нужен templateJson`,
      })
    }
    if (current.templateType === 'XRAY_BASE64' || current.templateType === 'SINGBOX') {
      return reply.status(400).send({
        message: `Редактор пока не умеет шаблоны ${current.templateType}`,
      })
    }
    if (hashTemplate(current) !== body.expectedHash) {
      return reply.status(409).send({
        message: 'Шаблон был изменён в панели после открытия',
        current,
        hash: hashTemplate(current),
      })
    }
    await app.backups.saveTemplateBackup(current)
    const template = await app.remnawave.updateTemplate({
      uuid,
      name: body.name,
      ...(isYaml
        ? { encodedTemplateYaml: body.encodedTemplateYaml }
        : { templateJson: body.templateJson }),
    })
    return { template, hash: hashTemplate(template) }
  })
}

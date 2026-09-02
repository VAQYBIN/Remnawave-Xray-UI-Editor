import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { hashTemplateJson } from '../templates/hash.js'
import { STARTER_XRAY_TEMPLATE } from '../templates/starter.js'

const paramsSchema = z.object({ uuid: z.string().uuid() })

// Как и у имени профиля, длина 2-30 символов; в отличие от профиля (только
// латиница) панель принимает для шаблона любые буквы, в том числе кириллицу —
// запрещены лишь спецсимволы вроде ✗
const nameSchema = z
  .string()
  .min(2)
  .max(30)
  .regex(/^[\p{L}\p{N}_\s-]+$/u, 'Имя: буквы, цифры, пробел, - и _')

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
    if (hashTemplateJson(current.templateJson) !== body.expectedHash) {
      return reply.status(409).send({
        message: 'Шаблон был изменён в панели после открытия',
        current,
      })
    }
    await app.backups.saveTemplateBackup(current)
    const template = await app.remnawave.updateTemplate({
      uuid,
      name: body.name,
      templateJson: body.templateJson,
    })
    return { template }
  })
}

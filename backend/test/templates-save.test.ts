import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { hashTemplateJson } from '../src/templates/hash.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

async function makeApp(templates = [makeStubTemplate()]) {
  const stub = makeStubRemnawave([], templates)
  const app = await buildServer(makeTestConfig(), { remnawave: stub })
  const cookie = await loginCookie(app)
  return { app, cookie, stub, template: templates[0]! }
}

describe('сохранение шаблона', () => {
  it('с актуальным хэшем сохраняет и пишет бэкап', async () => {
    const { app, cookie, template, stub } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: {
        templateJson: { outbounds: [{ tag: 'direct', protocol: 'freedom' }], dns: {} },
        expectedHash: hashTemplateJson(template.templateJson),
      },
    })
    expect(res.statusCode).toBe(200)
    expect((stub.templates[0]!.templateJson as Record<string, unknown>).dns).toBeDefined()
    expect(await app.backups.listTemplateBackups(template.uuid)).toHaveLength(1)
    // Хэш возвращается сразу, чтобы клиент не делал лишний GET перед следующим PATCH
    const body = res.json()
    expect(body.hash).toBe(hashTemplateJson(stub.templates[0]!.templateJson))
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: {
        templateJson: { outbounds: [{ tag: 'direct', protocol: 'freedom' }], dns: {}, log: {} },
        expectedHash: body.hash,
      },
    })
    expect(second.statusCode).toBe(200)
    await app.close()
  })

  it('с устаревшим хэшем отвечает 409, отдаёт актуальный шаблон и его хэш', async () => {
    const { app, cookie, template, stub } = await makeApp()
    // Снимок ДО запроса и обязательно глубокая копия: стаб хранит тот же объект,
    // что и `template`, поэтому сравнение с ним самим прошло бы всегда и не
    // проверило бы ничего
    const before = structuredClone(template.templateJson)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { a: 1 }, expectedHash: 'устаревший' },
    })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.current.uuid).toBe(template.uuid)
    expect(body.hash).toBe(hashTemplateJson(template.templateJson))
    // Ничего не записано
    expect(stub.templates[0]!.templateJson).toEqual(before)
    expect(await app.backups.listTemplateBackups(template.uuid)).toHaveLength(0)
    await app.close()
  })

  it('шаблон не XRAY_JSON отклоняется 400 и не изменяется', async () => {
    const template = makeStubTemplate({
      templateType: 'MIHOMO',
      templateJson: null,
      encodedTemplateYaml: 'cHJveHk6IFtd',
    })
    const { app, cookie, stub } = await makeApp([template])
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { a: 1 }, expectedHash: 'что-угодно' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('MIHOMO')
    expect(stub.templates[0]!.templateJson).toBeNull()
    expect(stub.templates[0]!.encodedTemplateYaml).toBe('cHJveHk6IFtd')
    expect(await app.backups.listTemplateBackups(template.uuid)).toHaveLength(0)
    await app.close()
  })

  // Порядок ключей в панели мог измениться, а содержимое — нет: это не конфликт
  it('переставленные ключи конфликтом не считаются', async () => {
    const template = makeStubTemplate({ templateJson: { a: 1, b: 2 } })
    const { app, cookie } = await makeApp([template])
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { c: 3 }, expectedHash: hashTemplateJson({ b: 2, a: 1 }) },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('без expectedHash запрос отклоняется', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { a: 1 } },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

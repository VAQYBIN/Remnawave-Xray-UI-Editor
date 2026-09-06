import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { hashTemplate, hashTemplateYaml } from '../src/templates/hash.js'
import { STARTER_MIHOMO_TEMPLATE } from '../src/templates/starterMihomo.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64')

describe('хэш по виду содержимого', () => {
  it('YAML хэшируется по тексту после декода', () => {
    expect(hashTemplateYaml(encode('a: 1\n'))).toBe(hashTemplateYaml(encode('a: 1\n')))
    expect(hashTemplateYaml(encode('a: 1\n'))).not.toBe(hashTemplateYaml(encode('a: 2\n')))
  })

  it('перестановка ключей YAML меняет хэш — текст и есть содержимое', () => {
    expect(hashTemplateYaml(encode('a: 1\nb: 2\n'))).not.toBe(hashTemplateYaml(encode('b: 2\na: 1\n')))
  })

  it('хэш шаблона выбирает способ по типу', () => {
    const yaml = {
      uuid: 'u', viewPosition: 0, name: 'n', templateType: 'MIHOMO' as const,
      templateJson: null, encodedTemplateYaml: encode('a: 1\n'),
    }
    const json = {
      uuid: 'u', viewPosition: 0, name: 'n', templateType: 'XRAY_JSON' as const,
      templateJson: { a: 1 }, encodedTemplateYaml: null,
    }
    expect(hashTemplate(yaml)).toBe(hashTemplateYaml(encode('a: 1\n')))
    expect(hashTemplate(json)).not.toBe(hashTemplate(yaml))
  })
})

describe('каркас нового шаблона Mihomo', () => {
  it('содержит обе роли маркера подстановки', () => {
    expect(STARTER_MIHOMO_TEMPLATE).toContain('proxies: # LEAVE THIS LINE!')
    expect(STARTER_MIHOMO_TEMPLATE.match(/LEAVE THIS LINE!/g)).toHaveLength(2)
  })

  it('заканчивается правилом MATCH', () => {
    expect(STARTER_MIHOMO_TEMPLATE.trimEnd().endsWith('MATCH,→ Remnawave')).toBe(true)
  })
})

describe('PATCH YAML-шаблона', () => {
  const yamlTemplate = () =>
    makeStubTemplate({
      name: 'Mihomo',
      templateType: 'MIHOMO',
      templateJson: null,
      encodedTemplateYaml: encode('a: 1\n'),
    })

  async function makeApp(templates = [yamlTemplate()]) {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave([], templates) })
    return { app, cookie: await loginCookie(app), template: templates[0]! }
  }

  it('сохраняет encodedTemplateYaml и возвращает новый хэш', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: {
        encodedTemplateYaml: encode('a: 2\n'),
        expectedHash: hashTemplateYaml(encode('a: 1\n')),
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().hash).toBe(hashTemplateYaml(encode('a: 2\n')))
    await app.close()
  })

  it('несовпадение хэша даёт 409 с текущим содержимым', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { encodedTemplateYaml: encode('a: 2\n'), expectedHash: 'чужой' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().current.uuid).toBe(template.uuid)
    await app.close()
  })

  it('JSON-поле в YAML-шаблон не принимается', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { a: 2 }, expectedHash: hashTemplateYaml(encode('a: 1\n')) },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('создание с типом MIHOMO заливает YAML-каркас', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { cookie },
      payload: { name: 'Novyy', templateType: 'MIHOMO' },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json().template
    expect(created.templateType).toBe('MIHOMO')
    expect(Buffer.from(created.encodedTemplateYaml, 'base64').toString('utf8')).toContain(
      'LEAVE THIS LINE!',
    )
    await app.close()
  })
})

describe('белый список типов шаблона в PATCH', () => {
  it('CLASH отклоняется с 400 — редактор его не открывает, хотя тип YAML-шаблона', async () => {
    const template = makeStubTemplate({
      name: 'Clash',
      templateType: 'CLASH',
      templateJson: null,
      encodedTemplateYaml: encode('a: 1\n'),
    })
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave([], [template]) })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { encodedTemplateYaml: encode('a: 2\n'), expectedHash: hashTemplateYaml(encode('a: 1\n')) },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('XRAY_BASE64 получает сообщение про неподдерживаемый тип, а не про недостающее поле', async () => {
    const template = makeStubTemplate({
      name: 'Base64',
      templateType: 'XRAY_BASE64',
      templateJson: null,
      encodedTemplateYaml: encode('a: 1\n'),
    })
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave([], [template]) })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { expectedHash: hashTemplateYaml(encode('a: 1\n')) },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/не умеет/i)
    expect(res.json().message).not.toMatch(/templateJson|encodedTemplateYaml/)
    await app.close()
  })
})

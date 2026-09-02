import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

async function makeApp(stub = makeStubRemnawave()) {
  const app = await buildServer(makeTestConfig(), { remnawave: stub })
  const cookie = await loginCookie(app)
  return { app, cookie, stub }
}

describe('роуты шаблонов', () => {
  it('список отдаёт шаблоны панели', async () => {
    const t = makeStubTemplate({ name: 'Default' })
    const { app, cookie } = await makeApp(makeStubRemnawave([], [t]))
    const res = await app.inject({ method: 'GET', url: '/api/templates', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().templates).toHaveLength(1)
    await app.close()
  })

  it('чтение отдаёт шаблон вместе с хэшем содержимого', async () => {
    const t = makeStubTemplate()
    const { app, cookie } = await makeApp(makeStubRemnawave([], [t]))
    const res = await app.inject({ method: 'GET', url: `/api/templates/${t.uuid}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().template.uuid).toBe(t.uuid)
    expect(res.json().hash).toMatch(/^[0-9a-f]{64}$/)
    await app.close()
  })

  // Панель создаёт шаблон в два вызова; клиент обязан видеть одну операцию
  it('создание возвращает готовый каркас, а не пустышку', async () => {
    const { app, cookie, stub } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { cookie },
      payload: { name: 'Мой шаблон' },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json().template
    expect(created.name).toBe('Мой шаблон')
    expect(created.templateType).toBe('XRAY_JSON')
    const json = created.templateJson as Record<string, unknown>
    expect(json.outbounds).toBeDefined()
    expect((json.remnawave as { injectHosts: unknown[] }).injectHosts).toHaveLength(1)
    expect(stub.templates).toHaveLength(1)
    await app.close()
  })

  it('имя шаблона проверяется так же, как имя профиля', async () => {
    const { app, cookie } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { cookie },
      payload: { name: 'плохое имя ✗' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('удаление пишет бэкап и убирает шаблон из панели', async () => {
    const t = makeStubTemplate()
    const { app, cookie, stub } = await makeApp(makeStubRemnawave([], [t]))
    const res = await app.inject({ method: 'DELETE', url: `/api/templates/${t.uuid}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(stub.templates).toHaveLength(0)
    expect(await app.backups.listTemplateBackups(t.uuid)).toHaveLength(1)
    await app.close()
  })

  it('все ручки шаблонов закрыты гардом', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    for (const url of ['/api/templates', '/api/templates/11111111-1111-1111-1111-111111111111']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    }
    await app.close()
  })
})

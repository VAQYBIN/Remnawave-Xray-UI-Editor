import { describe, expect, it } from 'vitest'
import { RemnawaveClient } from '../src/remnawave/client.js'

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  return (async (url: string, init: RequestInit) => {
    const r = handler(String(url), init)
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const template = {
  uuid: 'bc169195-ca14-4e12-904d-c320a9a5e618',
  viewPosition: 0,
  name: 'Default',
  tags: [],
  templateType: 'XRAY_JSON' as const,
  templateJson: { outbounds: [] },
  encodedTemplateYaml: null,
}

describe('RemnawaveClient: шаблоны подписок', () => {
  it('listTemplates разворачивает response.templates', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: { total: 1, templates: [template] } } })),
    })
    expect(await client.listTemplates()).toEqual([template])
  })

  it('getTemplate ходит по uuid в пути', async () => {
    let seen = ''
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((url) => {
        seen = url
        return { status: 200, body: { response: template } }
      }),
    })
    await client.getTemplate(template.uuid)
    expect(seen).toBe(`http://panel.test/api/subscription-templates/${template.uuid}`)
  })

  // Панель ждёт uuid В ТЕЛЕ, а не в пути — как и у config-profiles
  it('updateTemplate шлёт PATCH на коллекцию с uuid в теле', async () => {
    let method = ''
    let url = ''
    let body: unknown
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((u, init) => {
        url = u
        method = String(init.method)
        body = JSON.parse(String(init.body))
        return { status: 200, body: { response: template } }
      }),
    })
    await client.updateTemplate({ uuid: template.uuid, name: 'Новое', templateJson: { a: 1 } })
    expect(method).toBe('PATCH')
    expect(url).toBe('http://panel.test/api/subscription-templates/')
    expect(body).toEqual({ uuid: template.uuid, name: 'Новое', templateJson: { a: 1 } })
  })

  it('createTemplate шлёт POST {name, templateType}', async () => {
    let body: unknown
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((_u, init) => {
        body = JSON.parse(String(init.body))
        return { status: 201, body: { response: template } }
      }),
    })
    await client.createTemplate('Новый', 'XRAY_JSON')
    expect(body).toEqual({ name: 'Новый', templateType: 'XRAY_JSON' })
  })

  it('deleteTemplate переживает и 200 с телом, и 204 без него', async () => {
    for (const r of [{ status: 200, body: { response: { isDeleted: true } } }, { status: 204 }]) {
      const client = new RemnawaveClient({
        baseUrl: 'http://panel.test',
        token: 't',
        fetchImpl: fakeFetch(() => r),
      })
      await expect(client.deleteTemplate(template.uuid)).resolves.toBeUndefined()
    }
  })
})

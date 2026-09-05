import { describe, expect, it, vi } from 'vitest'
import { CatalogService, CATALOG_URL } from '../src/catalog/service.js'

const index = JSON.stringify({
  templates: [
    { name: 'Default Mihomo', type: 'MIHOMO', author: 'remnawave', url: 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml' },
    { name: 'Legacy', type: 'SINGBOX_LEGACY', author: 'remnawave', url: 'https://raw.githubusercontent.com/remnawave/templates/main/b.json' },
  ],
})

function stub(responses: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = responses[url]
    if (body === undefined) throw new Error(`неожиданный запрос: ${url}`)
    return new Response(body, { status: 200 })
  })
}

// Без lookupImpl guard резолвит raw.githubusercontent.com по-настоящему — на
// машине без DNS набор упадёт. Остальные тесты репозитория, идущие через
// fetchExternal, стаб передают (см. geo-service.test.ts), приводим в
// соответствие.
const lookupImpl = async () => [{ address: '185.199.108.133' }]

describe('каталог шаблонов', () => {
  it('читает индекс и отдаёт записи как есть, включая незнакомый тип', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never, lookupImpl })
    const list = await catalog.list()
    expect(list).toHaveLength(2)
    expect(list[1]!.type).toBe('SINGBOX_LEGACY')
  })

  it('индекс кэшируется на час', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    let now = 0
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never, lookupImpl }, () => now)
    await catalog.list()
    await catalog.list()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now = 3_600_001
    await catalog.list()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('содержимое отдаётся только по ссылке из индекса', async () => {
    const url = 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml'
    const fetchImpl = stub({ [CATALOG_URL]: index, [url]: 'proxies: # LEAVE THIS LINE!\n' })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never, lookupImpl })
    await expect(catalog.fetchTemplate(url)).resolves.toContain('LEAVE THIS LINE')
  })

  it('чужая ссылка отклоняется, даже если хост разрешён', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never, lookupImpl })
    await expect(
      catalog.fetchTemplate('https://raw.githubusercontent.com/чужой/репозиторий/x.yaml'),
    ).rejects.toThrow(/каталог/i)
  })

  it('недоступность GitHub — понятная ошибка, а не падение', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never, lookupImpl })
    await expect(catalog.list()).rejects.toThrow(/каталог шаблонов недоступен/i)
  })

  it('200 с HTML вместо JSON (прокси, капча) — русская ошибка, а не английская от движка', async () => {
    const fetchImpl = vi.fn(async () => new Response('<!doctype html><html>error</html>', { status: 200 }))
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never, lookupImpl })
    await expect(catalog.list()).rejects.toThrow(/[а-яё]/i)
    await expect(catalog.list()).rejects.not.toThrow(/unexpected token/i)
  })

  it('кривая ссылка в записи индекса — та же русская ошибка, а не английский TypeError', async () => {
    const badIndex = JSON.stringify({
      templates: [{ name: 'x', type: 'MIHOMO', author: 'a', url: 'не ссылка' }],
    })
    const fetchImpl = stub({ [CATALOG_URL]: badIndex })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never, lookupImpl })
    await expect(catalog.list()).rejects.toThrow(/[а-яё]/i)
  })
})

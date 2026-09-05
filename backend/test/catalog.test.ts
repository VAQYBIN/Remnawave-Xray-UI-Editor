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

describe('каталог шаблонов', () => {
  it('читает индекс и отдаёт записи как есть, включая незнакомый тип', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    const list = await catalog.list()
    expect(list).toHaveLength(2)
    expect(list[1]!.type).toBe('SINGBOX_LEGACY')
  })

  it('индекс кэшируется на час', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    let now = 0
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never }, () => now)
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
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    await expect(catalog.fetchTemplate(url)).resolves.toContain('LEAVE THIS LINE')
  })

  it('чужая ссылка отклоняется, даже если хост разрешён', async () => {
    const fetchImpl = stub({ [CATALOG_URL]: index })
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    await expect(
      catalog.fetchTemplate('https://raw.githubusercontent.com/чужой/репозиторий/x.yaml'),
    ).rejects.toThrow(/каталог/i)
  })

  it('недоступность GitHub — понятная ошибка, а не падение', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
    const catalog = new CatalogService({ fetchImpl: fetchImpl as never })
    await expect(catalog.list()).rejects.toThrow(/каталог шаблонов недоступен/i)
  })
})

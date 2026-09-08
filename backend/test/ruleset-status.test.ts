import { mkdtempSync, readFileSync, utimesSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RuleSetService, type RuleSetDescriptor } from '../src/ruleset/service.js'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'ruleset')
const FACEIT = readFileSync(join(FIXTURES, 'faceit.mrs'))
const PRIVATE = readFileSync(join(FIXTURES, 'geoip-private.mrs'))
const TWITCH = readFileSync(join(FIXTURES, 'twitch-ads.mrs'))

const httpSet = (over: Partial<RuleSetDescriptor> = {}): RuleSetDescriptor => ({
  name: 'faceit',
  kind: 'http',
  url: 'https://example.com/faceit.mrs',
  behavior: 'domain',
  format: 'mrs',
  ...over,
})

/** Сервис с подменённой сетью; счётчик загрузок виден тесту */
function makeService(body: Buffer = FACEIT) {
  const dataDir = mkdtempSync(join(tmpdir(), 'xui-rs-status-'))
  let downloads = 0
  const service = new RuleSetService(dataDir, {
    lookupImpl: async () => [{ address: '93.184.216.34' }],
    fetchImpl: (async () => {
      downloads++
      // Копия ради типа: Buffer из readFileSync — Uint8Array<ArrayBufferLike>,
      // а телу ответа нужен Uint8Array<ArrayBuffer> (как в ruleset-service.test.ts)
      return new Response(new Uint8Array(body))
    }) as unknown as typeof fetch,
  })
  return { service, dataDir, downloads: () => downloads }
}

describe('status', () => {
  it('встроенный набор готов всегда — сеть ему не нужна', async () => {
    const { service, downloads } = makeService()
    const items = await service.status([
      {
        name: 'inline',
        kind: 'inline',
        payload: ['+.example.com', '+.other.com'],
        behavior: 'domain',
        format: 'yaml',
      },
    ])
    expect(items[0]).toMatchObject({ name: 'inline', state: 'ready', count: 2 })
    expect(downloads()).toBe(0)
  })

  it('встроенный набор mrs — ошибка с той же причиной, что у match', async () => {
    // Требование сверх брифа: status обязан повторить запрет, который уже есть
    // в load, — иначе status ответил бы «готов» по набору, который match тут
    // же назовёт недоступным
    const { service, downloads } = makeService()
    const items = await service.status([
      { name: 'inline-mrs', kind: 'inline', payload: [], behavior: 'domain', format: 'mrs' },
    ])
    expect(items[0]).toMatchObject({ name: 'inline-mrs', state: 'error' })
    expect(items[0]?.reason).toMatch(/mrs не бывает встроенным/)
    expect(downloads()).toBe(0)
  })

  it('на пустом кэше отвечает «не загружен» и НИЧЕГО не качает', async () => {
    const { service, downloads } = makeService()
    const items = await service.status([httpSet()])
    expect(items[0]).toMatchObject({ name: 'faceit', state: 'missing' })
    expect(items[0]?.count).toBeUndefined()
    // Смысл всей операции: открытие диалога не должно превращаться в 26 загрузок
    expect(downloads()).toBe(0)
  })

  it('после трассировки отвечает по кэшу: записи, размер, когда загружен', async () => {
    const { service, downloads } = makeService()
    await service.match({ address: 'faceit.com' }, [httpSet()])
    expect(downloads()).toBe(1)
    const items = await service.status([httpSet()])
    expect(items[0]).toMatchObject({ state: 'ready', count: 2, stale: false })
    expect(items[0]!.bytes).toBeGreaterThan(0)
    expect(items[0]!.loadedAt).toBeGreaterThan(0)
    expect(downloads()).toBe(1)
  })

  it('просроченный файл остаётся годным к показу, но помечен', async () => {
    const { service, dataDir } = makeService()
    await service.match({ address: 'faceit.com' }, [httpSet()])
    // Сдвигаем время загрузки на два часа назад: TTL по умолчанию — час
    const dir = join(dataDir, 'rulesets')
    const file = join(dir, readdirSync(dir)[0]!)
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    utimesSync(file, old, old)
    const items = await service.status([httpSet()])
    expect(items[0]).toMatchObject({ state: 'ready', stale: true })
  })

  it('битый файл в кэше — состояние «ошибка» с причиной, а не исключение', async () => {
    const { service, dataDir } = makeService()
    await service.match({ address: 'faceit.com' }, [httpSet()])
    const dir = join(dataDir, 'rulesets')
    writeFileSync(join(dir, readdirSync(dir)[0]!), Buffer.from('не zstd'))
    // Разобранное помнится в памяти — спрашиваем другим сервисом с тем же
    // каталогом данных, иначе тест проверил бы кэш, а не чтение файла
    const second = new RuleSetService(dataDir, {})
    const items = await second.status([httpSet()])
    expect(items[0]?.state).toBe('error')
    expect(items[0]?.reason).toMatch(/не распаковывается/)
  })
})

describe('refresh', () => {
  it('качает заново даже при свежем кэше', async () => {
    const { service, downloads } = makeService()
    await service.match({ address: 'faceit.com' }, [httpSet()])
    expect(downloads()).toBe(1)
    const items = await service.refresh([httpSet()])
    expect(downloads()).toBe(2)
    expect(items[0]).toMatchObject({ state: 'ready', count: 2 })
  })

  it('обновляет только названный набор', async () => {
    const { service, downloads } = makeService()
    const sets = [httpSet(), httpSet({ name: 'second', url: 'https://example.com/2.mrs' })]
    await service.match({ address: 'faceit.com' }, sets)
    expect(downloads()).toBe(2)
    await service.refresh(sets, ['second'])
    expect(downloads()).toBe(3)
  })

  it('неудача загрузки доезжает причиной, а не молчаливым «не загружен»', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'xui-rs-refresh-'))
    const service = new RuleSetService(dataDir, {
      lookupImpl: async () => [{ address: '93.184.216.34' }],
      fetchImpl: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    })
    const items = await service.refresh([httpSet()])
    expect(items[0]?.state).toBe('error')
    expect(items[0]?.reason).toMatch(/503/)
  })
})

describe('page', () => {
  it('отдаёт ключи бора и рядом с ними count из заголовка', async () => {
    const { service } = makeService()
    const page = await service.page(httpSet(), { offset: 0, limit: 200 })
    expect(page.items).toEqual([
      'faceit.com',
      '+.faceit.com',
      'faceit-cdn.net',
      '+.faceit-cdn.net',
    ])
    // Ключей вдвое больше, чем записей: и то и другое правда, и врать нельзя ни
    // одним из чисел
    expect(page.total).toBe(4)
    expect(page.count).toBe(2)
  })

  it('поиск фильтрует и пересчитывает общее число', async () => {
    // Набор нарочно twitch-ads, а не faceit: у faceit найденных по «cdn» ровно
    // столько же, сколько записей в заголовке (2), и подмена total на count
    // прошла бы незамеченной. Здесь 10 ключей, 4 совпадения и count: 5 —
    // ни одно из трёх чисел не равно другому
    const { service } = makeService(TWITCH)
    const page = await service.page(httpSet(), { offset: 0, limit: 200, q: 'ttvnw' })
    expect(page.items).toEqual([
      'usher.ttvnw.net',
      '+.usher.ttvnw.net',
      'playlist.ttvnw.net',
      '+.playlist.ttvnw.net',
    ])
    expect(page.total).toBe(4)
    expect(page.count).toBe(5)
  })

  it('offset и limit режут страницу', async () => {
    const { service } = makeService()
    const page = await service.page(httpSet(), { offset: 1, limit: 2 })
    expect(page.items).toEqual(['+.faceit.com', 'faceit-cdn.net'])
    expect(page.total).toBe(4)
    expect(page.offset).toBe(1)
  })

  it('набор подсетей показывается подсетями', async () => {
    const { service } = makeService(PRIVATE)
    const page = await service.page(httpSet({ behavior: 'ipcidr' }), { offset: 0, limit: 5 })
    expect(page.items[0]).toBe('10.0.0.0/8')
    expect(page.total).toBe(17)
  })

  it('набор classical показывается строками правил', async () => {
    const { service } = makeService()
    const page = await service.page(
      {
        name: 'inline',
        kind: 'inline',
        payload: ['PROCESS-NAME,qbittorrent.exe', 'PROCESS-NAME,transmission'],
        behavior: 'classical',
        format: 'yaml',
      },
      { offset: 0, limit: 200 },
    )
    expect(page.items).toEqual(['PROCESS-NAME,qbittorrent.exe', 'PROCESS-NAME,transmission'])
  })

  it('недоступный набор отказывает с причиной', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'xui-rs-page-'))
    const service = new RuleSetService(dataDir, {
      lookupImpl: async () => [{ address: '93.184.216.34' }],
      fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    })
    await expect(service.page(httpSet(), { offset: 0, limit: 10 })).rejects.toThrow(/404/)
  })
})

describe('match', () => {
  it('в ответе есть время загрузки — без него нечем сказать про давность кэша', async () => {
    const { service } = makeService()
    const answers = await service.match({ address: 'faceit.com' }, [httpSet()])
    expect(answers.faceit).toMatchObject({ state: 'yes', count: 2 })
    expect((answers.faceit as { loadedAt?: number }).loadedAt).toBeGreaterThan(0)
  })
})

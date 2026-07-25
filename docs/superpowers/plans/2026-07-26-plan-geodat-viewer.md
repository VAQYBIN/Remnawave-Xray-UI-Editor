# GeoDat Viewer — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать содержимое geo-баз прямо в редакторе: список категорий `geosite`/`geoip` со счётчиками, постраничный просмотр доменов и подсетей внутри категории и кнопку «В правило», которая переносит найденную категорию в конфиг.

**Architecture:** Бэкенд получает две GET-ручки поверх уже существующего индекса `GeoService` (`код → сырые байты`): список категорий со счётчиками из нового быстрого `countEntries` и постраничное содержимое через уже написанные `parseDomains`/`parseCidrs`. Кэш разобранных категорий ограничивается восемью на вид — вьюер листает категории подряд, а `US` в geoip это 291 507 подсетей. Фронт добавляет вкладку «Просмотр» в существующий диалог «Geo-базы» и чистую мутацию `appendGeoKey` для вставки категории в правило.

**Tech Stack:** Fastify 5 + zod + Node 24 (бэк), React 19 + @tanstack/react-query (фронт), vitest + @testing-library/react, Playwright.

Спека: `docs/superpowers/specs/2026-07-26-geodat-viewer-design.md`.

## Global Constraints

- Язык UI, подсказок, сообщений об ошибках и комментариев — **русский**; коммиты — английский conventional style (`feat(backend): ...`).
- Работаем в ветке `dev`. Мердж в `main` — только по прямой команде пользователя.
- Реальный `.env` не читаем и не коммитим.
- Слоевая чистота фронта: `entities` **не импортирует** из `features`.
- Vitest фронтенда запускается **из каталога `frontend`** (jsdom). Из корня DOM-тесты падают.
- Коды категорий в `.dat` лежат в **ВЕРХНЕМ регистре** (`GOOGLE`, `CATEGORY-ADS-ALL`); в конфиг ключ пишется в нижнем (`geosite:google`) — `parseKey` в `geo/match.ts` апперкейсит код при разборе.
- **Закрытый `<dialog>` всё равно рендерит children** (урок рецептов): содержимое вкладки «Просмотр» рендерится только когда диалог открыт, иначе его поля перехватывают поиск по подписям в других тестах.
- Лимит страницы: по умолчанию 200, максимум 1000.

---

### Task 1: Счётчик записей и обратное преобразование IP

**Files:**
- Modify: `backend/src/geo/dat.ts` (добавить `countEntries`)
- Modify: `backend/src/geo/match.ts` (добавить `bytesToIp`, `formatCidr`)
- Test: `backend/test/geo-dat.test.ts` (дополнить)
- Test: `backend/test/geo-match.test.ts` (дополнить)

**Interfaces:**
- Consumes: `indexEntries`, `encodeGeoSiteList`, `encodeGeoIpList`, тип `GeoCidr` из `dat.ts`.
- Produces: `countEntries(entry: Uint8Array): number`, `bytesToIp(bytes: Uint8Array): string`, `formatCidr(cidr: GeoCidr): string`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `backend/test/geo-dat.test.ts` (импорт `countEntries` добавить к существующим импортам из `../src/geo/dat.js`):

```ts
describe('countEntries', () => {
  it('считает домены и подсети, не разбирая их', () => {
    const site = indexEntries(
      encodeGeoSiteList([
        {
          code: 'GOOGLE',
          domains: [
            { type: 2, value: 'google.com', attributes: [] },
            { type: 3, value: 'www.google.com', attributes: ['cn'] },
          ],
        },
        { code: 'EMPTY', domains: [] },
      ]),
    )
    expect(countEntries(site.get('GOOGLE')!)).toBe(2)
    expect(countEntries(site.get('EMPTY')!)).toBe(0)

    const ip = indexEntries(
      encodeGeoIpList([
        {
          code: 'US',
          cidrs: [
            { ip: new Uint8Array([1, 2, 3, 0]), prefix: 24 },
            { ip: new Uint8Array([8, 8, 8, 8]), prefix: 32 },
          ],
          reverseMatch: true,
        },
      ]),
    )
    // reverseMatch — отдельное поле записи, в счёт подсетей попадать не должно
    expect(countEntries(ip.get('US')!)).toBe(2)
  })
})
```

Дописать в конец `backend/test/geo-match.test.ts` (импорт `bytesToIp`, `formatCidr` добавить к существующим из `../src/geo/match.js`):

```ts
describe('bytesToIp и formatCidr', () => {
  it('IPv4 печатается точками', () => {
    expect(bytesToIp(new Uint8Array([1, 2, 3, 4]))).toBe('1.2.3.4')
    expect(formatCidr({ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 })).toBe('10.0.0.0/8')
  })

  it('IPv6 сжимает самую длинную серию нулей', () => {
    const loopback = new Uint8Array(16)
    loopback[15] = 1
    expect(bytesToIp(loopback)).toBe('::1')

    const cf = new Uint8Array([0x26, 0x06, 0x47, 0, 1, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(bytesToIp(cf)).toBe('2606:4700:110::1')

    expect(bytesToIp(new Uint8Array(16))).toBe('::')
  })

  it('одиночный ноль не сжимается — это не короче', () => {
    const addr = new Uint8Array([0x20, 1, 0x0d, 0xb8, 0, 0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5])
    expect(bytesToIp(addr)).toBe('2001:db8:0:1:2:3:4:5')
  })

  it('непонятная длина даёт пустую строку, а не мусор', () => {
    expect(bytesToIp(new Uint8Array([1, 2, 3]))).toBe('')
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из корня: `npm test -w backend`
Ожидание: FAIL — `countEntries`, `bytesToIp`, `formatCidr` не экспортируются.

- [ ] **Step 3: Реализовать `countEntries`**

В `backend/src/geo/dat.ts` после `parseCidrs` (перед секцией «Кодирование»):

```ts
/**
 * Сколько записей (доменов у GeoSite, подсетей у GeoIP) в категории. Тела записей
 * пропускаются целиком: список категорий показывает размеры, а полный разбор всей
 * базы ради этого — сотни мегабайт объектов.
 */
export function countEntries(entry: Uint8Array): number {
  const r: Reader = { buf: entry, pos: 0 }
  let count = 0
  while (r.pos < entry.length) {
    const key = readVarint(r)
    const wire = key & 7
    if (key >>> 3 === 2 && wire === 2) {
      count += 1
      readBytes(r)
    } else skipField(r, wire)
  }
  return count
}
```

- [ ] **Step 4: Реализовать `bytesToIp` и `formatCidr`**

В `backend/src/geo/match.ts` после `ipToBytes` (сигнатуру `ipToBytes` не трогаем):

```ts
/** Обратное к ipToBytes: 4 байта — точками, 16 — сжатой формой IPv6, иначе пусто */
export function bytesToIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.')
  if (bytes.length !== 16) return ''

  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) {
    groups.push((((bytes[i]! << 8) | bytes[i + 1]!) >>> 0).toString(16))
  }

  // Сжимаем самую длинную серию нулевых групп — как в каноничной записи адреса
  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === '0') {
      if (curStart === -1) {
        curStart = i
        curLen = 0
      }
      curLen += 1
      if (curLen > bestLen) {
        bestStart = curStart
        bestLen = curLen
      }
    } else {
      curStart = -1
      curLen = 0
    }
  }
  // Одиночный ноль сжимать незачем: «::» той же длины, но читается хуже
  if (bestLen < 2) return groups.join(':')
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLen).join(':')}`
}

export function formatCidr(cidr: GeoCidr): string {
  return `${bytesToIp(cidr.ip)}/${cidr.prefix}`
}
```

- [ ] **Step 5: Прогнать тесты**

Из корня: `npm test -w backend` → PASS.
`npm run typecheck -w backend` → без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add backend/src/geo/dat.ts backend/src/geo/match.ts backend/test/geo-dat.test.ts backend/test/geo-match.test.ts
git commit -m "feat(backend): count category entries and format CIDRs back to text"
```

---

### Task 2: Категории и страницы содержимого в GeoService

**Files:**
- Modify: `backend/src/geo/service.ts`
- Test: `backend/test/geo-service.test.ts` (дополнить)

**Interfaces:**
- Consumes: `countEntries` из `./dat.js`, `formatCidr` из `./match.js`.
- Produces: `GeoCategory { code: string; count: number }`, `GeoDomainItem { type: 'keyword' | 'regexp' | 'domain' | 'full'; value: string; attributes: string[] }`, `GeoCategoryPage { code: string; total: number; offset: number; domains?: GeoDomainItem[]; cidrs?: string[]; reverseMatch?: boolean }`, `GeoCategoryResult = { status: 'ok'; page: GeoCategoryPage } | { status: 'no-database' } | { status: 'no-category' }`, методы `GeoService.categories(kind)` и `GeoService.categoryPage(kind, code, opts)`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `backend/test/geo-service.test.ts`. В файле уже импортированы `mkdtempSync`, `mkdir`, `writeFile`, `tmpdir`, `join`, `GeoService`, `encodeGeoSiteList` и `encodeGeoIpList` — новых импортов не требуется:

```ts
describe('просмотр категорий', () => {
  it('список отсортирован и несёт счётчики', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xui-geo-view-'))
    await mkdir(join(dir, 'geodata'), { recursive: true })
    await writeFile(
      join(dir, 'geodata', 'geosite.dat'),
      encodeGeoSiteList([
        { code: 'NETFLIX', domains: [{ type: 2, value: 'netflix.com', attributes: [] }] },
        {
          code: 'GOOGLE',
          domains: [
            { type: 2, value: 'google.com', attributes: [] },
            { type: 3, value: 'api.google.com', attributes: ['cn'] },
          ],
        },
      ]),
    )
    const service = new GeoService(dir)

    expect(await service.categories('geosite')).toEqual([
      { code: 'GOOGLE', count: 2 },
      { code: 'NETFLIX', count: 1 },
    ])
    // Базы geoip в каталоге нет
    expect(await service.categories('geoip')).toBeNull()
  })

  it('страница доменов режется по offset/limit и фильтруется по q', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xui-geo-page-'))
    await mkdir(join(dir, 'geodata'), { recursive: true })
    await writeFile(
      join(dir, 'geodata', 'geosite.dat'),
      encodeGeoSiteList([
        {
          code: 'GOOGLE',
          domains: [
            { type: 2, value: 'google.com', attributes: [] },
            { type: 3, value: 'api.google.com', attributes: ['cn'] },
            { type: 0, value: 'gstatic', attributes: [] },
            { type: 1, value: '.*\\.google\\.dev', attributes: [] },
          ],
        },
      ]),
    )
    const service = new GeoService(dir)

    const first = await service.categoryPage('geosite', 'google', { offset: 0, limit: 2 })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return
    expect(first.page.total).toBe(4)
    expect(first.page.domains).toEqual([
      { type: 'domain', value: 'google.com', attributes: [] },
      { type: 'full', value: 'api.google.com', attributes: ['cn'] },
    ])

    const tail = await service.categoryPage('geosite', 'GOOGLE', { offset: 2, limit: 200 })
    if (tail.status !== 'ok') throw new Error('ожидалась страница')
    expect(tail.page.domains).toEqual([
      { type: 'keyword', value: 'gstatic', attributes: [] },
      { type: 'regexp', value: '.*\\.google\\.dev', attributes: [] },
    ])

    // Фильтр меняет и total — иначе пагинация врёт
    const filtered = await service.categoryPage('geosite', 'GOOGLE', { q: 'API', offset: 0, limit: 200 })
    if (filtered.status !== 'ok') throw new Error('ожидалась страница')
    expect(filtered.page.total).toBe(1)
    expect(filtered.page.domains).toEqual([
      { type: 'full', value: 'api.google.com', attributes: ['cn'] },
    ])

    // offset за концом списка — пустая страница, а не ошибка
    const far = await service.categoryPage('geosite', 'GOOGLE', { offset: 99, limit: 200 })
    if (far.status !== 'ok') throw new Error('ожидалась страница')
    expect(far.page.domains).toEqual([])
    expect(far.page.total).toBe(4)
  })

  it('geoip отдаёт строки подсетей и флаг reverseMatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xui-geo-ip-page-'))
    await mkdir(join(dir, 'geodata'), { recursive: true })
    await writeFile(
      join(dir, 'geodata', 'geoip.dat'),
      encodeGeoIpList([
        {
          code: 'PRIVATE',
          cidrs: [
            { ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 },
            { ip: new Uint8Array([192, 168, 0, 0]), prefix: 16 },
          ],
          reverseMatch: true,
        },
      ]),
    )
    const service = new GeoService(dir)

    const page = await service.categoryPage('geoip', 'private', { offset: 0, limit: 200 })
    if (page.status !== 'ok') throw new Error('ожидалась страница')
    expect(page.page.cidrs).toEqual(['10.0.0.0/8', '192.168.0.0/16'])
    expect(page.page.reverseMatch).toBe(true)

    const filtered = await service.categoryPage('geoip', 'private', { q: '192.', offset: 0, limit: 200 })
    if (filtered.status !== 'ok') throw new Error('ожидалась страница')
    expect(filtered.page.cidrs).toEqual(['192.168.0.0/16'])
  })

  it('нет базы и нет категории — разные ответы', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xui-geo-404-'))
    await mkdir(join(dir, 'geodata'), { recursive: true })
    await writeFile(
      join(dir, 'geodata', 'geosite.dat'),
      encodeGeoSiteList([{ code: 'GOOGLE', domains: [] }]),
    )
    const service = new GeoService(dir)

    expect((await service.categoryPage('geosite', 'nosuch', {})).status).toBe('no-category')
    expect((await service.categoryPage('geoip', 'US', {})).status).toBe('no-database')
  })

  it('кэш разобранных категорий не растёт бесконечно', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xui-geo-cache-'))
    await mkdir(join(dir, 'geodata'), { recursive: true })
    await writeFile(
      join(dir, 'geodata', 'geosite.dat'),
      encodeGeoSiteList(
        Array.from({ length: 12 }, (_, i) => ({
          code: `CAT${i}`,
          domains: [{ type: 2 as const, value: `site${i}.com`, attributes: [] }],
        })),
      ),
    )
    const service = new GeoService(dir)
    for (let i = 0; i < 12; i += 1) {
      await service.categoryPage('geosite', `CAT${i}`, {})
    }

    // Кэш приватный — читаем его напрямую: публичный геттер нужен только тесту
    const cache = (service as unknown as {
      cache: Map<string, { domains: Map<string, unknown> }>
    }).cache
    expect(cache.get('geosite')!.domains.size).toBe(8)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из корня: `npm test -w backend` → FAIL: `service.categories is not a function`.

- [ ] **Step 3: Добавить типы и предел кэша**

В `backend/src/geo/service.ts` расширить импорты и добавить типы рядом с `GeoMatchResult`:

```ts
import { countEntries, indexEntries, parseCidrs, parseDomains, type GeoCidr, type GeoDomain } from './dat.js'
import { domainMatches, formatCidr, ipMatches, parseKey } from './match.js'
```

```ts
export interface GeoCategory {
  code: string
  count: number
}

/** Тип домена словом: цифры из geodat.proto наружу не уходят */
export interface GeoDomainItem {
  type: 'keyword' | 'regexp' | 'domain' | 'full'
  value: string
  attributes: string[]
}

export interface GeoCategoryPage {
  code: string
  total: number
  offset: number
  domains?: GeoDomainItem[]
  cidrs?: string[]
  reverseMatch?: boolean
}

export type GeoCategoryResult =
  | { status: 'ok'; page: GeoCategoryPage }
  | { status: 'no-database' }
  | { status: 'no-category' }

export interface GeoPageOptions {
  q?: string
  offset?: number
  limit?: number
}

const DOMAIN_TYPES = ['keyword', 'regexp', 'domain', 'full'] as const
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000
/** Сколько разобранных категорий держим на вид: US в geoip — 291 507 подсетей */
const MAX_PARSED = 8
```

В интерфейс `Cached` добавить поле счётчиков:

```ts
  /** Размеры категорий: считаются один раз на всю базу, дёшево */
  counts: Map<string, number>
```

и заполнить его пустой картой там, где создаётся `fresh` в `cacheOf`:

```ts
    const fresh: Cached = {
      mtimeMs: info.mtimeMs,
      index: indexEntries(new Uint8Array(buf)),
      counts: new Map(),
      domains: new Map(),
      cidrs: new Map(),
    }
```

Добавить вытеснение и применить его в `domainsOf`/`cidrsOf`:

```ts
  /** Кэш разобранного ограничен: вьюер листает категории подряд, память не резиновая.
   *  Map хранит порядок вставки, поэтому первая пара — самая старая. */
  private remember<T>(store: Map<string, T>, code: string, value: T): T {
    store.set(code, value)
    if (store.size > MAX_PARSED) {
      const oldest = store.keys().next().value
      if (oldest !== undefined) store.delete(oldest)
    }
    return value
  }
```

```ts
  private domainsOf(cached: Cached, code: string): GeoDomain[] | null {
    const hit = cached.domains.get(code)
    if (hit) return hit
    const entry = cached.index.get(code)
    if (!entry) return null
    return this.remember(cached.domains, code, parseDomains(entry))
  }

  private cidrsOf(cached: Cached, code: string): { cidrs: GeoCidr[]; reverseMatch: boolean } | null {
    const hit = cached.cidrs.get(code)
    if (hit) return hit
    const entry = cached.index.get(code)
    if (!entry) return null
    return this.remember(cached.cidrs, code, parseCidrs(entry))
  }
```

- [ ] **Step 4: Добавить публичные методы**

В `backend/src/geo/service.ts` после `status()`:

```ts
  /** Список категорий со счётчиками; null — базы нет на диске */
  async categories(kind: Kind): Promise<GeoCategory[] | null> {
    const cached = await this.cacheOf(kind)
    if (!cached) return null
    if (cached.counts.size !== cached.index.size) {
      for (const [code, entry] of cached.index) cached.counts.set(code, countEntries(entry))
    }
    // Порядок записей в .dat произвольный — сортируем, чтобы список был стабильным
    return [...cached.index.keys()]
      .sort()
      .map((code) => ({ code, count: cached.counts.get(code) ?? 0 }))
  }

  async categoryPage(kind: Kind, code: string, opts: GeoPageOptions): Promise<GeoCategoryResult> {
    const cached = await this.cacheOf(kind)
    if (!cached) return { status: 'no-database' }

    // Коды в .dat лежат в верхнем регистре — поиск по исходной строке промахнётся
    const key = code.toUpperCase()
    if (!cached.index.has(key)) return { status: 'no-category' }

    const offset = Math.max(0, opts.offset ?? 0)
    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
    const q = (opts.q ?? '').trim().toLowerCase()

    if (kind === 'geosite') {
      const all = this.domainsOf(cached, key) ?? []
      const filtered = q === '' ? all : all.filter((d) => d.value.toLowerCase().includes(q))
      return {
        status: 'ok',
        page: {
          code: key,
          total: filtered.length,
          offset,
          domains: filtered.slice(offset, offset + limit).map((d) => ({
            type: DOMAIN_TYPES[d.type] ?? 'keyword',
            value: d.value,
            attributes: d.attributes,
          })),
        },
      }
    }

    const entry = this.cidrsOf(cached, key) ?? { cidrs: [], reverseMatch: false }
    // С фильтром приходится отформатировать все подсети — иначе не с чем сравнивать.
    // Без фильтра форматируется только видимая страница.
    const filtered =
      q === '' ? entry.cidrs : entry.cidrs.filter((c) => formatCidr(c).toLowerCase().includes(q))
    return {
      status: 'ok',
      page: {
        code: key,
        total: filtered.length,
        offset,
        cidrs: filtered.slice(offset, offset + limit).map(formatCidr),
        reverseMatch: entry.reverseMatch,
      },
    }
  }
```

- [ ] **Step 5: Прогнать тесты**

Из корня: `npm test -w backend` → PASS (5 новых тестов).
`npm run typecheck -w backend` → без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add backend/src/geo/service.ts backend/test/geo-service.test.ts
git commit -m "feat(backend): list geo categories and page through their contents"
```

---

### Task 3: Ручки просмотра

**Files:**
- Modify: `backend/src/routes/geo.ts`
- Test: `backend/test/geo-routes.test.ts` (дополнить)

**Interfaces:**
- Consumes: `app.geo.categories(kind)`, `app.geo.categoryPage(kind, code, opts)`.
- Produces: `GET /api/geo/:kind/categories` → `{ categories: GeoCategory[] }`; `GET /api/geo/:kind/categories/:code?q=&offset=&limit=` → `GeoCategoryPage`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `backend/test/geo-routes.test.ts` (фикстура `beforeEach` в этом файле уже кладёт `geosite.dat` с категорией `GOOGLE`):

```ts
describe('GET /api/geo/:kind/categories', () => {
  it('отдаёт список категорий со счётчиками', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/geo/geosite/categories', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ categories: [{ code: 'GOOGLE', count: 1 }] })
  })

  it('незагруженная база — 404 с подсказкой, неизвестный вид — 400', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/geo/geoip/categories', headers: { cookie } })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().message).toMatch(/не загружена/)

    const wrong = await app.inject({ method: 'GET', url: '/api/geo/geodns/categories', headers: { cookie } })
    expect(wrong.statusCode).toBe(400)
  })
})

describe('GET /api/geo/:kind/categories/:code', () => {
  it('отдаёт страницу содержимого; регистр кода не важен', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/geosite/categories/google?limit=10',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      code: 'GOOGLE',
      total: 1,
      offset: 0,
      domains: [{ type: 'domain', value: 'google.com', attributes: [] }],
    })
  })

  it('неизвестная категория — 404 с её именем', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/geosite/categories/nosuch',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().message).toMatch(/nosuch/i)
  })

  it('limit выше максимума не проходит валидацию', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/geo/geosite/categories/google?limit=5000',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из корня: `npm test -w backend` → FAIL: 404 от Fastify на неизвестном маршруте.

- [ ] **Step 3: Реализовать ручки**

В `backend/src/routes/geo.ts` добавить схемы рядом с существующими:

```ts
const kindSchema = z.enum(['geosite', 'geoip'])
const categoryParams = z.object({ kind: kindSchema, code: z.string().min(1) })
const pageQuery = z.object({
  q: z.string().optional(),
  // Значения приходят строками из query — coerce приводит их к числам
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
})
```

и сами маршруты внутри плагина (после `PUT /api/geo`, до `POST /api/geo/update` — порядок значения не имеет, но так читается по возрастанию специфичности):

```ts
  app.get('/api/geo/:kind/categories', async (req, reply) => {
    const { kind } = z.object({ kind: kindSchema }).parse(req.params)
    const categories = await app.geo.categories(kind)
    if (categories === null) {
      return reply
        .status(404)
        .send({ message: `База ${kind} не загружена — скачайте её на вкладке «Источники»` })
    }
    return { categories }
  })

  app.get('/api/geo/:kind/categories/:code', async (req, reply) => {
    const { kind, code } = categoryParams.parse(req.params)
    const result = await app.geo.categoryPage(kind, code, pageQuery.parse(req.query))
    if (result.status === 'no-database') {
      return reply
        .status(404)
        .send({ message: `База ${kind} не загружена — скачайте её на вкладке «Источники»` })
    }
    if (result.status === 'no-category') {
      return reply.status(404).send({ message: `В базе ${kind} нет категории «${code}»` })
    }
    return result.page
  })
```

Ошибки zod превращаются в 400 глобальным обработчиком в `server.ts` — отдельной обработки не требуется.

- [ ] **Step 4: Прогнать тесты**

Из корня: `npm test -w backend` → PASS (5 новых тестов).

- [ ] **Step 5: Коммит**

```bash
git add backend/src/routes/geo.ts backend/test/geo-routes.test.ts
git commit -m "feat(backend): expose geo category listing and paging routes"
```

---

### Task 4: Вставка категории в правило

**Files:**
- Modify: `frontend/src/entities/graph/mutations.ts`
- Test: `frontend/test/graph-mutations.test.ts` (дополнить)

**Interfaces:**
- Consumes: `XrayConfig`.
- Produces: `appendGeoKey(config: XrayConfig, ruleIndex: number | null, key: string): { config: XrayConfig; ruleIndex: number }`.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `frontend/test/graph-mutations.test.ts` (импорт `appendGeoKey` добавить к существующим из `../src/entities/graph/mutations`):

```ts
describe('appendGeoKey', () => {
  const cfg = () => ({
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [{ inboundTag: ['vless-in'], outboundTag: 'direct' }] },
  })

  it('geosite дописывается в domain выбранного правила', () => {
    const res = appendGeoKey(cfg(), 0, 'geosite:google')
    expect(res.ruleIndex).toBe(0)
    expect(res.config.routing!.rules![0]!.domain).toEqual(['geosite:google'])
  })

  it('geoip дописывается в ip, а не в domain', () => {
    const res = appendGeoKey(cfg(), 0, 'geoip:private')
    expect(res.config.routing!.rules![0]!.ip).toEqual(['geoip:private'])
    expect(res.config.routing!.rules![0]!.domain).toBeUndefined()
  })

  it('без выбранного правила создаётся новое в конце списка', () => {
    const res = appendGeoKey(cfg(), null, 'geosite:netflix')
    expect(res.ruleIndex).toBe(1)
    expect(res.config.routing!.rules).toHaveLength(2)
    expect(res.config.routing!.rules![1]).toEqual({ domain: ['geosite:netflix'] })
  })

  it('несуществующий индекс правила тоже даёт новое правило', () => {
    const res = appendGeoKey(cfg(), 7, 'geosite:netflix')
    expect(res.ruleIndex).toBe(1)
  })

  it('повтор ничего не меняет и возвращает тот же config', () => {
    const withKey = appendGeoKey(cfg(), 0, 'geosite:google').config
    const again = appendGeoKey(withKey, 0, 'geosite:google')
    expect(again.config).toBe(withKey)
    expect(again.ruleIndex).toBe(0)
  })

  it('не мутирует входной конфиг', () => {
    const source = cfg()
    const snapshot = structuredClone(source)
    appendGeoKey(source, 0, 'geosite:google')
    expect(source).toEqual(snapshot)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/graph-mutations.test.ts`
Ожидание: FAIL — `appendGeoKey` не экспортируется.

- [ ] **Step 3: Реализовать мутацию**

В конец `frontend/src/entities/graph/mutations.ts`:

```ts
/**
 * Кладёт geo-категорию в правило: geosite — в domain, geoip — в ip.
 * ruleIndex === null (или индекс несуществующего правила) — создаётся новое правило
 * в конце списка, там же, где его создаёт кнопка «+ Правило».
 * Возвращает индекс правила, чтобы вызывающий мог его выделить.
 */
export function appendGeoKey(
  config: XrayConfig,
  ruleIndex: number | null,
  key: string,
): { config: XrayConfig; ruleIndex: number } {
  const field = key.startsWith('geoip:') ? 'ip' : 'domain'
  const rules = config.routing?.rules ?? []
  const exists = ruleIndex !== null ? rules[ruleIndex] : undefined

  // Повтор не добавляем: возвращаем тот же объект, как и прочие мутации
  if (exists && (exists[field] ?? []).includes(key)) return { config, ruleIndex: ruleIndex! }

  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.rules = next.routing.rules ?? []
  let index = ruleIndex
  if (index === null || next.routing.rules[index] === undefined) {
    next.routing.rules.push({})
    index = next.routing.rules.length - 1
  }
  const rule = next.routing.rules[index]!
  rule[field] = [...(rule[field] ?? []), key]
  return { config: next, ruleIndex: index }
}
```

- [ ] **Step 4: Прогнать тест**

Из `frontend`: `npx vitest run test/graph-mutations.test.ts` → PASS (6 новых тестов).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/mutations.ts frontend/test/graph-mutations.test.ts
git commit -m "feat(frontend): append a geo category to a routing rule"
```

---

### Task 5: Типы и хуки просмотра

**Files:**
- Modify: `frontend/src/shared/api/types.ts`
- Modify: `frontend/src/shared/api/hooks.ts`
- Test: `frontend/test/geo-hooks.test.tsx` (дополнить)

**Interfaces:**
- Consumes: `apiFetch` из `./client`.
- Produces: типы `GeoCategory`, `GeoDomainItem`, `GeoCategoryPage`; хуки `useGeoCategories(kind, enabled)`, `useGeoCategory(kind, code, params)`.

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `frontend/test/geo-hooks.test.tsx`. В файле уже есть фабрика обёртки `withClient()` (возвращает компонент с `QueryClientProvider`) и `afterEach(() => vi.unstubAllGlobals())`; `useGeoCategories` и `useGeoCategory` добавить к импорту из `../src/shared/api`:

```tsx
describe('useGeoCategories и useGeoCategory', () => {
  it('список категорий приходит распакованным', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ categories: [{ code: 'GOOGLE', count: 2 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useGeoCategories('geosite'), { wrapper: withClient() })
    await vi.waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual([{ code: 'GOOGLE', count: 2 }])
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/geo/geosite/categories')
  })

  it('страница категории запрашивается с q, offset и limit; без кода запрос не уходит', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ code: 'GOOGLE', total: 1, offset: 0, domains: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const idle = renderHook(() => useGeoCategory('geosite', null, { q: '', offset: 0 }), {
      wrapper: withClient(),
    })
    expect(idle.result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()

    const { result } = renderHook(
      () => useGeoCategory('geosite', 'GOOGLE', { q: 'api', offset: 200 }),
      { wrapper: withClient() },
    )
    await vi.waitFor(() => expect(result.current.data).toBeDefined())
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('/api/geo/geosite/categories/GOOGLE')
    expect(url).toContain('q=api')
    expect(url).toContain('offset=200')
    expect(url).toContain('limit=200')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/geo-hooks.test.tsx` → FAIL: хуки не экспортируются.

- [ ] **Step 3: Добавить типы**

В `frontend/src/shared/api/types.ts` рядом с `GeoStatus`:

```ts
export interface GeoCategory {
  code: string
  count: number
}

export interface GeoDomainItem {
  type: 'keyword' | 'regexp' | 'domain' | 'full'
  value: string
  attributes: string[]
}

export interface GeoCategoryPage {
  code: string
  total: number
  offset: number
  /** geosite */
  domains?: GeoDomainItem[]
  /** geoip */
  cidrs?: string[]
  reverseMatch?: boolean
}

export type GeoKind = 'geosite' | 'geoip'
```

- [ ] **Step 4: Добавить хуки**

В `frontend/src/shared/api/hooks.ts` рядом с `useGeoStatus` (типы `GeoCategory`, `GeoCategoryPage`, `GeoKind` добавить в импорт из `./types`):

```ts
export function useGeoCategories(kind: GeoKind, enabled = true) {
  return useQuery({
    queryKey: ['geo', kind, 'categories'],
    queryFn: () =>
      apiFetch<{ categories: GeoCategory[] }>(`/api/geo/${kind}/categories`).then((r) => r.categories),
    enabled,
    // База на диске сама не меняется — перезапрашивать её при каждом открытии незачем
    staleTime: 60_000,
    retry: false,
  })
}

export function useGeoCategory(
  kind: GeoKind,
  code: string | null,
  params: { q: string; offset: number },
) {
  return useQuery({
    queryKey: ['geo', kind, 'category', code, params.q, params.offset],
    queryFn: () => {
      const query = new URLSearchParams({
        q: params.q,
        offset: String(params.offset),
        limit: '200',
      })
      return apiFetch<GeoCategoryPage>(
        `/api/geo/${kind}/categories/${encodeURIComponent(code!)}?${query.toString()}`,
      )
    },
    enabled: code !== null,
    retry: false,
  })
}
```

- [ ] **Step 5: Прогнать тест**

Из `frontend`: `npx vitest run test/geo-hooks.test.tsx` → PASS.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/shared/api frontend/test/geo-hooks.test.tsx
git commit -m "feat(frontend): hooks for geo categories and category pages"
```

---

### Task 6: Компонент просмотра

**Files:**
- Create: `frontend/src/features/diagnostics/GeoBrowser.tsx`
- Modify: `frontend/src/shared/ui/tokens.css` (стили `.geo-browser*`)
- Test: `frontend/test/geo-browser.test.tsx`

**Interfaces:**
- Consumes: `useGeoCategories`, `useGeoCategory`, `useDebounced` из `shared/lib/useDebounced`, `Button`, `TextInput`, `Select` из `shared/ui`.
- Produces: `GeoBrowser` с пропсами `{ onUseKey?: (key: string) => void; onOpenSources: () => void }`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/geo-browser.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeoBrowser } from '../src/features/diagnostics/GeoBrowser'

afterEach(() => vi.unstubAllGlobals())

const CATEGORIES = {
  categories: [
    { code: 'GOOGLE', count: 2 },
    { code: 'NETFLIX', count: 1 },
  ],
}

const PAGE = {
  code: 'GOOGLE',
  total: 2,
  offset: 0,
  domains: [
    { type: 'domain', value: 'google.com', attributes: [] },
    { type: 'full', value: 'api.google.com', attributes: ['cn'] },
  ],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderBrowser(handler: (url: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)))
  vi.stubGlobal('fetch', fetchMock)
  const onUseKey = vi.fn<(key: string) => void>()
  const onOpenSources = vi.fn<() => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <GeoBrowser onUseKey={onUseKey} onOpenSources={onOpenSources} />
    </QueryClientProvider>,
  )
  return { onUseKey, onOpenSources, fetchMock }
}

const okHandler = (url: string) => {
  if (url.includes('/categories/')) return json(PAGE)
  if (url.includes('/categories')) return json(CATEGORIES)
  throw new Error(`неожиданный запрос: ${url}`)
}

describe('GeoBrowser', () => {
  it('показывает категории со счётчиками и содержимое выбранной', async () => {
    renderBrowser(okHandler)

    const category = await screen.findByRole('button', { name: /GOOGLE/ })
    expect(category).toHaveTextContent('2')
    await userEvent.click(category)

    expect(await screen.findByText('google.com')).toBeInTheDocument()
    expect(screen.getByText('api.google.com')).toBeInTheDocument()
    // Тип и атрибут домена видны: keyword и full матчатся совершенно по-разному
    expect(screen.getByText('full')).toBeInTheDocument()
    expect(screen.getByText('@cn')).toBeInTheDocument()
  })

  it('фильтр категорий сужает список', async () => {
    renderBrowser(okHandler)
    await screen.findByRole('button', { name: /GOOGLE/ })

    await userEvent.type(screen.getByLabelText('Поиск категории'), 'net')
    expect(screen.queryByRole('button', { name: /GOOGLE/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /NETFLIX/ })).toBeInTheDocument()
  })

  it('«В правило» отдаёт ключ в нижнем регистре', async () => {
    const { onUseKey } = renderBrowser(okHandler)
    await userEvent.click(await screen.findByRole('button', { name: /GOOGLE/ }))

    await userEvent.click(await screen.findByRole('button', { name: 'В правило' }))
    expect(onUseKey).toHaveBeenCalledWith('geosite:google')
  })

  it('незагруженная база объясняется и ведёт к источникам', async () => {
    const { onOpenSources } = renderBrowser(() => json({ message: 'База geosite не загружена' }, 404))

    await userEvent.click(await screen.findByRole('button', { name: 'К источникам' }))
    expect(onOpenSources).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из `frontend`: `npx vitest run test/geo-browser.test.tsx` → FAIL: модуля нет.

- [ ] **Step 3: Создать компонент**

Создать `frontend/src/features/diagnostics/GeoBrowser.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useGeoCategories, useGeoCategory, type GeoKind } from '../../shared/api'
import { useDebounced } from '../../shared/lib/useDebounced'
import { Button, Select, TextInput } from '../../shared/ui'

const PAGE_SIZE = 200
/** 1520 категорий в DOM делают диалог вязким — показываем начало списка */
const MAX_ROWS = 300

interface Props {
  /** Не передан — кнопки «В правило» нет (диалог открыт вне редактора) */
  onUseKey?: (key: string) => void
  onOpenSources: () => void
}

export function GeoBrowser({ onUseKey, onOpenSources }: Props) {
  const [kind, setKind] = useState<GeoKind>('geosite')
  const [catQuery, setCatQuery] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [itemQuery, setItemQuery] = useState('')
  const [offset, setOffset] = useState(0)

  const categories = useGeoCategories(kind)
  // Поиск внутри категории идёт на бэкенд: без задержки запрос уходил бы на каждый символ
  const debouncedItemQuery = useDebounced(itemQuery, 600)
  const page = useGeoCategory(kind, code, { q: debouncedItemQuery, offset })

  const filtered = useMemo(() => {
    const q = catQuery.trim().toUpperCase()
    const all = categories.data ?? []
    return q === '' ? all : all.filter((c) => c.code.includes(q))
  }, [categories.data, catQuery])

  function switchKind(next: GeoKind) {
    setKind(next)
    setCode(null)
    setItemQuery('')
    setOffset(0)
  }

  function selectCode(next: string) {
    setCode(next)
    setItemQuery('')
    setOffset(0)
  }

  if (categories.isError) {
    return (
      <div className="geo-empty">
        <p className="field-warning">{(categories.error as Error).message}</p>
        <Button onClick={onOpenSources}>К источникам</Button>
      </div>
    )
  }

  const total = page.data?.total ?? 0
  const shown = page.data ? Math.min(total - page.data.offset, PAGE_SIZE) : 0
  const key = code === null ? null : `${kind}:${code.toLowerCase()}`

  return (
    <div className="geo-browser">
      <div className="geo-browser-head">
        <Select
          aria-label="База"
          value={kind}
          options={[
            { value: 'geosite', label: 'geosite — домены' },
            { value: 'geoip', label: 'geoip — подсети' },
          ]}
          onChange={(v) => switchKind(v as GeoKind)}
        />
        <TextInput
          aria-label="Поиск категории"
          placeholder="google"
          value={catQuery}
          onChange={(e) => setCatQuery(e.target.value)}
        />
      </div>

      <div className="geo-browser-body">
        <div className="geo-cat-list">
          {categories.isPending && <p className="muted">Загрузка…</p>}
          {filtered.slice(0, MAX_ROWS).map((c) => (
            <button
              key={c.code}
              type="button"
              className={c.code === code ? 'geo-cat geo-cat-active' : 'geo-cat'}
              aria-pressed={c.code === code}
              onClick={() => selectCode(c.code)}
            >
              <span className="geo-cat-code">{c.code}</span>
              <span className="geo-cat-count">{c.count}</span>
            </button>
          ))}
          {filtered.length > MAX_ROWS && (
            <p className="muted">Показаны первые {MAX_ROWS} — уточните поиск.</p>
          )}
          {!categories.isPending && filtered.length === 0 && (
            <p className="muted">Ничего не найдено.</p>
          )}
        </div>

        <div className="geo-items">
          {code === null && <p className="muted">Выберите категорию слева.</p>}
          {code !== null && (
            <>
              <TextInput
                aria-label="Поиск внутри категории"
                placeholder={kind === 'geosite' ? 'example.com' : '10.'}
                value={itemQuery}
                onChange={(e) => {
                  setItemQuery(e.target.value)
                  setOffset(0)
                }}
              />
              {page.isError && <p className="field-error">{(page.error as Error).message}</p>}
              {page.data?.reverseMatch === true && (
                <p className="field-warning">
                  У категории включён reverseMatch: правило срабатывает на адресах ВНЕ списка.
                </p>
              )}
              <ul className="geo-item-list" aria-label="Содержимое категории">
                {(page.data?.domains ?? []).map((d) => (
                  <li key={`${d.type}:${d.value}`}>
                    <span className="geo-item-type">{d.type}</span>
                    <span className="mono">{d.value}</span>
                    {d.attributes.map((a) => (
                      <span key={a} className="geo-item-attr">{`@${a}`}</span>
                    ))}
                  </li>
                ))}
                {(page.data?.cidrs ?? []).map((c) => (
                  <li key={c}>
                    <span className="mono">{c}</span>
                  </li>
                ))}
              </ul>
              <div className="geo-pager">
                <span className="muted">
                  {total === 0
                    ? 'Ничего не найдено'
                    : `показаны ${page.data!.offset + 1}–${page.data!.offset + shown} из ${total}`}
                </span>
                <span className="spacer" />
                <Button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  ← Назад
                </Button>
                <Button
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Вперёд →
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {key !== null && (
        <div className="row">
          <span className="mono">{key}</span>
          <span className="spacer" />
          <Button onClick={() => void navigator.clipboard?.writeText(key)}>Скопировать</Button>
          {onUseKey && (
            <Button variant="primary" onClick={() => onUseKey(key)}>
              В правило
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
```

`useDebounced<T>(value: T, delay: number): T` — возвращает значение того же типа, `null`/`undefined` проходят мгновенно. Для строки поиска это ровно то, что нужно: пустая строка тоже ждёт таймер, но она приходит из `setItemQuery('')` при смене категории, а там `offset` сбрасывается одновременно.

- [ ] **Step 4: Добавить стили**

В конец `frontend/src/shared/ui/tokens.css`:

```css
/* --- Просмотр geo-баз --- */
.geo-browser { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.geo-browser-head { display: flex; gap: 8px; align-items: center; }
.geo-browser-body { display: grid; grid-template-columns: 240px 1fr; gap: 12px; align-items: start; }
.geo-cat-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 46vh;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding-right: 8px;
}
.geo-cat {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.geo-cat:hover { background: var(--rail); }
.geo-cat-active { background: var(--rail); border-color: var(--flux); }
.geo-cat-code { font-family: var(--font-mono); font-size: var(--t-sm); }
.geo-cat-count { margin-left: auto; color: var(--ink-dim); font-size: var(--t-sm); }
.geo-items { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.geo-item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 38vh;
  overflow-y: auto;
  font-size: var(--t-sm);
}
.geo-item-list li { display: flex; gap: 8px; align-items: baseline; }
.geo-item-type {
  color: var(--ink-dim);
  font-size: 11px;
  text-transform: uppercase;
  min-width: 56px;
}
.geo-item-attr { color: var(--ember); font-size: 11px; }
.geo-pager { display: flex; gap: 8px; align-items: center; }
.geo-empty { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
```

Токены `--ink`, `--ink-dim`, `--rail`, `--border`, `--flux`, `--ember`, `--radius-xs`, `--font-mono`, `--dur`, `--ease` уже объявлены в начале файла; `--t-sm` — это размер шрифта (12px), не длительность.

- [ ] **Step 5: Прогнать тест**

Из `frontend`: `npx vitest run test/geo-browser.test.tsx` → PASS (4 теста).

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/diagnostics/GeoBrowser.tsx frontend/src/shared/ui/tokens.css frontend/test/geo-browser.test.tsx
git commit -m "feat(frontend): browse geo categories and their contents"
```

---

### Task 7: Вкладки в диалоге и вставка из редактора

**Files:**
- Modify: `frontend/src/features/diagnostics/GeoDataDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Modify: `frontend/e2e/mocks.ts` (ответы новых ручек)
- Test: `frontend/test/geo-dialog.test.tsx` (дополнить)
- Test: `frontend/e2e/geo.spec.ts` (дополнить)

**Interfaces:**
- Consumes: `GeoBrowser` из `./GeoBrowser`, `appendGeoKey` из `entities/graph/mutations`.
- Produces: у `GeoDataDialog` появляется необязательный проп `onUseKey?: (key: string) => void`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `frontend/test/geo-dialog.test.tsx`. В файле уже есть хелпер `wrap(ui)` (рендер внутри `QueryClientProvider`), `beforeEach` со своим `fetchMock` и `afterEach(() => vi.unstubAllGlobals())`; тесты ниже перекрывают `fetch` своим и потому используют собственный рендер:

```tsx
describe('GeoDataDialog — вкладки', () => {
  it('вкладка «Просмотр» показывает категории, «Источники» — ссылки', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/categories')) {
        return new Response(JSON.stringify({ categories: [{ code: 'GOOGLE', count: 2 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          geosite: { url: 'https://example.test/dlc.dat', present: true, categories: 1 },
          geoip: { url: 'https://example.test/geoip.dat', present: false },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <GeoDataDialog open onClose={() => {}} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Ссылка на geosite')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Просмотр' }))
    expect(await screen.findByRole('button', { name: /GOOGLE/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Ссылка на geosite')).not.toBeInTheDocument()
  })

  it('закрытый диалог не рендерит содержимое вкладок', () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ categories: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <GeoDataDialog open={false} onClose={() => {}} />
      </QueryClientProvider>,
    )
    // Иначе поля диалога перехватывают поиск по подписям на всей странице
    expect(screen.queryByLabelText('Ссылка на geosite')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Просмотр' })).not.toBeInTheDocument()
  })
})
```

Дописать в конец `frontend/e2e/geo.spec.ts`:

```ts
test('категория из просмотра уходит в новое правило', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Geo-базы' }).click()
  await page.getByRole('button', { name: 'Просмотр' }).click()
  await page.getByRole('button', { name: /GOOGLE/ }).click()
  await expect(page.getByText('google.com')).toBeVisible()
  await page.getByRole('button', { name: 'В правило' }).click()

  // Правило создано и выбрано, черновик помечен изменённым
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(2)
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `frontend`: `npx vitest run test/geo-dialog.test.tsx` → FAIL: кнопки «Просмотр» нет.

- [ ] **Step 3: Добавить вкладки в диалог**

В `frontend/src/features/diagnostics/GeoDataDialog.tsx`:

импорт и проп:

```ts
import { GeoBrowser } from './GeoBrowser'
```

```tsx
export function GeoDataDialog({
  open,
  onClose,
  onUseKey,
}: {
  open: boolean
  onClose: () => void
  /** Не передан — просмотр без кнопки «В правило» */
  onUseKey?: (key: string) => void
}) {
```

состояние вкладки рядом с остальным:

```ts
  const [tab, setTab] = useState<'sources' | 'browse'>('sources')
```

в разметке: диалог становится широким на просмотре, содержимое рендерится только при `open`
(закрытый `<dialog>` всё равно рендерит children, и его поля перехватывают поиск по подписям):

```tsx
    <Dialog open={open} title="Geo-базы" onClose={onClose} wide={tab === 'browse'}>
      {open && (
        <>
          <div className="segmented versions-tabs">
            <Button aria-pressed={tab === 'sources'} onClick={() => setTab('sources')}>
              Источники
            </Button>
            <Button aria-pressed={tab === 'browse'} onClick={() => setTab('browse')}>
              Просмотр
            </Button>
          </div>

          {tab === 'browse' && (
            <GeoBrowser onUseKey={onUseKey} onOpenSources={() => setTab('sources')} />
          )}

          {tab === 'sources' && (
            <>
              {/* сюда переезжает без изменений всё, что сейчас лежит внутри <Dialog>:
                  вводный <p className="muted">, две карточки <SourceState>, поля
                  «Ссылка на geosite» и «Ссылка на geoip», строка пресетов,
                  {error && …} и кнопка «Загрузить» */}
            </>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </>
      )}
    </Dialog>
```

Порядок переноса: существующий блок разметки внутри `<Dialog>` целиком уходит в ветку
`tab === 'sources'` без правок, кроме одного — строка с кнопками внизу теряет «Закрыть»
(она становится общей для обеих вкладок, см. код выше) и оставляет себе только «Загрузить»:

```tsx
              <div className="row" style={{ marginTop: 12 }}>
                <span className="spacer" />
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={async () => {
                    await save.mutateAsync({ geositeUrl, geoipUrl })
                    await update.mutateAsync()
                  }}
                >
                  {busy ? 'Загружаю…' : 'Загрузить'}
                </Button>
              </div>
```

- [ ] **Step 4: Подключить вставку в редакторе**

В `frontend/src/features/editor/EditorPage.tsx` расширить импорт мутаций (`appendGeoKey` к уже
импортируемым из `../../entities/graph/mutations`) и заменить монтирование диалога:

```tsx
      <GeoDataDialog
        open={geoOpen}
        onClose={() => setGeoOpen(false)}
        onUseKey={(key) => {
          if (parsedConfig === undefined) return
          // Категория дописывается в открытое правило, иначе создаётся новое
          const ruleIndex = selectedNode?.startsWith('rule:') ? Number(selectedNode.slice(5)) : null
          const res = appendGeoKey(parsedConfig, ruleIndex, key)
          if (res.config !== parsedConfig) changeConfig(res.config)
          // Перекрывает сброс выбора из changeConfig: показываем, куда попала категория
          setSelectedNode(`rule:${res.ruleIndex}`)
          setGeoOpen(false)
        }}
      />
```

- [ ] **Step 5: Добавить ответы ручек в e2e-моки**

В `frontend/e2e/mocks.ts` рядом с существующим обработчиком `**/api/geo` (важно: обработчик
категорий должен стоять ДО общего `**/api/geo`, иначе тот перехватит запрос):

```ts
  await page.route('**/api/geo/geosite/categories', (r) =>
    r.fulfill({ json: { categories: [{ code: 'GOOGLE', count: 2 }] } }),
  )
  await page.route('**/api/geo/geosite/categories/**', (r) =>
    r.fulfill({
      json: {
        code: 'GOOGLE',
        total: 2,
        offset: 0,
        domains: [
          { type: 'domain', value: 'google.com', attributes: [] },
          { type: 'full', value: 'api.google.com', attributes: ['cn'] },
        ],
      },
    }),
  )
```

Общий обработчик `**/api/geo` при этом должен отдавать `present: true` для geosite, иначе
вкладка просмотра покажет пустой список:

```ts
        geosite: { url: 'https://example.test/dlc.dat', present: true, categories: 1 },
```

Существующий тест `geo.spec.ts`, который проверяет предупреждение о незагруженных базах,
опирается на `present: false` — если он сломается, переопределить статус локально в нём через
поздний `page.route` (поздний обработчик Playwright перекрывает ранний).

- [ ] **Step 6: Прогнать тесты**

Из `frontend`:
`npx vitest run test/geo-dialog.test.tsx test/geo-browser.test.tsx` → PASS.
`npx playwright test geo.spec.ts` → PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/diagnostics/GeoDataDialog.tsx frontend/src/features/editor/EditorPage.tsx frontend/e2e/mocks.ts frontend/test/geo-dialog.test.tsx frontend/e2e/geo.spec.ts
git commit -m "feat(frontend): geo viewer tab and category insertion into rules"
```

---

### Task 8: Документация и полный прогон

**Files:**
- Modify: `README.md` (раздел про geo-базы)
- Modify: `CLAUDE.md` (описание geo-подсистемы)

- [ ] **Step 1: Дополнить README**

В разделе про диагностику, где описаны geo-базы, добавить абзац:

```markdown
Вкладка «Просмотр» в диалоге «Geo-базы» показывает, что лежит внутри баз: список категорий со
счётчиками (`GOOGLE 960`), содержимое выбранной категории постранично с поиском, тип каждого
домена (`full`, `domain`, `keyword`, `regexp`) и его атрибуты (`@cn`, `@ads`). Кнопка
«В правило» дописывает категорию в открытое правило — или создаёт новое, если правило не
выбрано; `geosite:` уходит в `domain`, `geoip:` — в `ip`.
```

- [ ] **Step 2: Дополнить CLAUDE.md**

В описании `geo/*` дописать после фразы про верхний регистр кодов:

```markdown
  Просмотр баз: `categories(kind)` считает размеры категорий через `countEntries` (проход по
  байтам без разбора — полный разбор всей базы стоил бы сотни мегабайт), `categoryPage` режет
  содержимое по `offset`/`limit` и фильтрует по `q`, пересчитывая `total`. Кэш разобранных
  категорий ограничен восемью на вид (`MAX_PARSED`): вьюер листает категории подряд, а `US` в
  geoip — 291 507 подсетей. UI — `features/diagnostics/GeoBrowser.tsx` во вкладке диалога
  «Geo-базы»; кнопка «В правило» идёт через `appendGeoKey` в `entities/graph/mutations.ts`.
```

- [ ] **Step 3: Полный прогон**

Из корня репозитория:

```bash
npm test -w backend
npm run typecheck -w backend
npm run typecheck -w frontend
npm run build
```

Из каталога `frontend`:

```bash
npx vitest run
npx playwright test
```

Ожидание: всё зелёное. Ориентир: backend 195 → ~205, frontend 590 → ~606, e2e 48 → 49.

- [ ] **Step 4: Коммит**

```bash
git add README.md CLAUDE.md
git commit -m "docs: describe the geo database viewer"
```

---

## Проверка после реализации

Юнит-тесты идут на фикстурах из нескольких категорий. Настоящие базы — другой масштаб: 1520
категорий в `dlc.dat`, 291 507 подсетей в `US`. После Task 3 стоит открыть вьюер на реально
загруженных базах и проверить три вещи: список категорий появляется без заметной задержки
(счётчики считаются один раз), открытие `US` в geoip не подвешивает интерфейс, поиск внутри
такой категории отвечает за разумное время. Если счёт категорий окажется медленным — считать
их лениво, только для видимой части списка, и это повод вернуться к спеке, а не к точечной
правке.

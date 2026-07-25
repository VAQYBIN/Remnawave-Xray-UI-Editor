# Geo-подсистема и доводка трассировщика — план реализации (этап 2 из 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заставить трассировщик давать точные вердикты по `geosite:`/`geoip:` — разобрать geo-базы на бэкенде, дать пользователю загрузить их из UI и объяснить в интерфейсе, что вообще делает трассировка.

**Architecture:** Бэкенд читает `.dat` (protobuf) из `DATA_DIR/geodata/`, индексирует верхний уровень и отвечает на узкий вопрос «входит ли домен/IP в такие-то категории». Фронт спрашивает по списку geo-ключей из правил и передаёт ответ в уже готовый `traceRoute`. Плюс четыре UX-правки, которые нашло тестирование этапа 1.

**Tech Stack:** Fastify 5 + Node 24 (ESM, `.js`-суффиксы в импортах), zod, vitest; React 19, TanStack Query, Playwright.

## Global Constraints

- Новых зависимостей нет ни на фронте, ни на бэкенде. Protobuf разбираем сами.
- Бэкенд — ESM: импорты локальных модулей **с суффиксом `.js`** (`../geo/dat.js`).
- **Категории в `.dat` лежат в верхнем регистре.** Запрос `geosite:google` ищет `GOOGLE`. Атрибут отделяется первым `@` и приводится к нижнему регистру. Поиск по исходной строке из конфига всегда вернул бы пустоту — это главный подводный камень этапа.
- `Domain.Type`: `Substr = 0`, `Regex = 1`, `Domain = 2`, `Full = 3`. Ноль — это подстрока, не «plain».
- Сервисы инжектятся через `deps` в `buildServer` (как `BackupService`), сеть — через `fetchImpl`, чтобы тесты не ходили наружу.
- Язык UI и сообщений — русский. Коммиты — conventional, скоуп `frontend` или `backend`.
- Команды: `npm test -w backend`, `npm test -w frontend`, `npm run typecheck -w backend|frontend`, `npm run e2e -w frontend`; одиночный файл — `cd backend && npx vitest run test/<file>`.

## Файловая структура

| Файл | Ответственность |
| --- | --- |
| `backend/src/geo/dat.ts` (создать) | Разбор protobuf: varint, length-delimited, индекс категорий, домены и CIDR по требованию |
| `backend/src/geo/match.ts` (создать) | Матчинг домена и IP по разобранным записям, регистр категорий, атрибуты, `reverse_match` |
| `backend/src/geo/service.ts` (создать) | `GeoService`: настройки в `DATA_DIR/settings.json`, файлы в `DATA_DIR/geodata/`, кэш индекса, статус, обновление по URL |
| `backend/src/routes/geo.ts` (создать) | `GET/PUT /api/geo`, `POST /api/geo/update`, `POST /api/tools/geo/match` |
| `backend/src/server.ts` (изменить) | `deps.geo`, декорация `app.geo`, регистрация `geoRoutes` |
| `frontend/src/shared/api/types.ts` (изменить) | `GeoStatus`, `GeoMatchAnswer` |
| `frontend/src/shared/api/hooks.ts` (изменить) | `useGeoStatus`, `useSaveGeoUrls`, `useUpdateGeo`, `useGeoMatch` |
| `frontend/src/features/diagnostics/GeoDataDialog.tsx` (создать) | Источники, загрузка, состояние баз |
| `frontend/src/features/diagnostics/TracePanel.tsx` (изменить) | Кнопка «Geo-базы» рядом с caveat про незагруженные базы |
| `frontend/src/features/editor/EditorPage.tsx` (изменить) | Тумблер «Трасса», запрос geo, диалог geo-баз, кнопка в топбаре |
| `frontend/src/entities/xray/traceMatch.ts` (изменить) | `neverReason` — текст, зависящий от фактической стратегии |
| `frontend/src/entities/xray/trace.ts` (изменить) | Передача `neverReason` из стратегии конфига |
| `frontend/src/shared/ui/tokens.css` (изменить) | Классы `.geo-*`, состояние тумблера |

---

### Task 1: Декодер `.dat`

**Files:**
- Create: `backend/src/geo/dat.ts`
- Test: `backend/test/geo-dat.test.ts`

**Interfaces:**
- Produces:
  - `interface GeoDomain { type: 0 | 1 | 2 | 3; value: string; attributes: string[] }`
  - `interface GeoCidr { ip: Uint8Array; prefix: number }`
  - `function indexEntries(buf: Uint8Array): Map<string, Uint8Array>` — код категории → сырые байты записи
  - `function parseDomains(entry: Uint8Array): GeoDomain[]`
  - `function parseCidrs(entry: Uint8Array): { cidrs: GeoCidr[]; reverseMatch: boolean }`
  - `function encodeGeoSiteList(entries: { code: string; domains: GeoDomain[] }[]): Uint8Array` — только для тестов и фикстур
  - `function encodeGeoIpList(entries: { code: string; cidrs: GeoCidr[]; reverseMatch?: boolean }[]): Uint8Array`

Индексируем лениво: на верхнем уровне читаем `entry` (поле 1), внутри записи достаём только `code` (поле 1), а домены и CIDR оставляем сырыми до первого обращения. `dlc.dat` — это сотни категорий и сотни тысяч доменов, полный разбор на каждый запрос был бы расточителен.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/geo-dat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  encodeGeoIpList,
  encodeGeoSiteList,
  indexEntries,
  parseCidrs,
  parseDomains,
} from '../src/geo/dat.js'

describe('geosite .dat', () => {
  const buf = encodeGeoSiteList([
    {
      code: 'GOOGLE',
      domains: [
        { type: 2, value: 'google.com', attributes: [] },
        { type: 3, value: 'ads.google.com', attributes: ['ads'] },
        { type: 0, value: 'gstatic', attributes: [] },
        { type: 1, value: '^api\\..*\\.google$', attributes: [] },
      ],
    },
    { code: 'OPENAI', domains: [{ type: 2, value: 'openai.com', attributes: [] }] },
  ])

  it('индексирует записи по коду категории', () => {
    const index = indexEntries(buf)
    expect([...index.keys()].sort()).toEqual(['GOOGLE', 'OPENAI'])
  })

  it('разбирает домены с типами и атрибутами', () => {
    const index = indexEntries(buf)
    const domains = parseDomains(index.get('GOOGLE')!)
    expect(domains).toHaveLength(4)
    expect(domains[0]).toEqual({ type: 2, value: 'google.com', attributes: [] })
    expect(domains[1]).toEqual({ type: 3, value: 'ads.google.com', attributes: ['ads'] })
    expect(domains[2].type).toBe(0)
    expect(domains[3].value).toBe('^api\\..*\\.google$')
  })

  it('разбор второй категории не зависит от первой', () => {
    const index = indexEntries(buf)
    expect(parseDomains(index.get('OPENAI')!)).toEqual([
      { type: 2, value: 'openai.com', attributes: [] },
    ])
  })

  it('пустой буфер даёт пустой индекс', () => {
    expect(indexEntries(new Uint8Array()).size).toBe(0)
  })

  it('длинные значения (varint > 127 байт) читаются целиком', () => {
    const long = 'a'.repeat(500)
    const index = indexEntries(encodeGeoSiteList([{ code: 'LONG', domains: [{ type: 2, value: long, attributes: [] }] }]))
    expect(parseDomains(index.get('LONG')!)[0].value).toBe(long)
  })
})

describe('geoip .dat', () => {
  it('разбирает CIDR и reverse_match', () => {
    const buf = encodeGeoIpList([
      {
        code: 'RU',
        cidrs: [
          { ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 },
          { ip: new Uint8Array([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), prefix: 32 },
        ],
      },
      { code: 'CN', cidrs: [{ ip: new Uint8Array([1, 2, 3, 4]), prefix: 32 }], reverseMatch: true },
    ])
    const index = indexEntries(buf)
    const ru = parseCidrs(index.get('RU')!)
    expect(ru.reverseMatch).toBe(false)
    expect(ru.cidrs).toHaveLength(2)
    expect([...ru.cidrs[0].ip]).toEqual([10, 0, 0, 0])
    expect(ru.cidrs[0].prefix).toBe(8)
    expect(ru.cidrs[1].ip).toHaveLength(16)
    expect(parseCidrs(index.get('CN')!).reverseMatch).toBe(true)
  })

  it('prefix 0 не теряется (proto3 опускает нулевые поля)', () => {
    const buf = encodeGeoIpList([{ code: 'ANY', cidrs: [{ ip: new Uint8Array([0, 0, 0, 0]), prefix: 0 }] }])
    const parsed = parseCidrs(indexEntries(buf).get('ANY')!)
    expect(parsed.cidrs[0].prefix).toBe(0)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd backend && npx vitest run test/geo-dat.test.ts`
Expected: FAIL — `Failed to resolve import "../src/geo/dat.js"`.

- [ ] **Step 3: Минимальная реализация**

Создать `backend/src/geo/dat.ts`:

```ts
// Разбор geosite.dat/geoip.dat — protobuf без библиотеки. Схема сверена с
// common/geodata/geodat.proto (Xray-core):
//   GeoSiteList { repeated GeoSite entry = 1 }
//   GeoSite     { string code = 1; repeated Domain domain = 2 }
//   Domain      { Type type = 1; string value = 2; repeated Attribute attribute = 3 }
//   Attribute   { string key = 1; oneof { bool bool_value = 2; int64 int_value = 3 } }
//   GeoIPList   { repeated GeoIP entry = 1 }
//   GeoIP       { string code = 1; repeated CIDR cidr = 2; bool reverse_match = 3 }
//   CIDR        { bytes ip = 1; uint32 prefix = 2 }

/** Substr = 0, Regex = 1, Domain = 2, Full = 3 — нумерация из geodat.proto */
export interface GeoDomain {
  type: 0 | 1 | 2 | 3
  value: string
  attributes: string[]
}

export interface GeoCidr {
  ip: Uint8Array
  prefix: number
}

interface Reader {
  buf: Uint8Array
  pos: number
}

function readVarint(r: Reader): number {
  let result = 0
  let shift = 0
  while (r.pos < r.buf.length) {
    const byte = r.buf[r.pos++]!
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return result
    shift += 7
  }
  return result
}

function readBytes(r: Reader): Uint8Array {
  const len = readVarint(r)
  const start = r.pos
  r.pos = Math.min(start + len, r.buf.length)
  return r.buf.subarray(start, r.pos)
}

/** Пропуск неизвестного поля по его wire type — иначе новые поля ломали бы разбор */
function skipField(r: Reader, wire: number): void {
  if (wire === 0) readVarint(r)
  else if (wire === 1) r.pos += 8
  else if (wire === 2) readBytes(r)
  else if (wire === 5) r.pos += 4
}

const decoder = new TextDecoder()

/**
 * Код категории → сырые байты записи. Домены и CIDR внутри записи не разбираются:
 * geosite-база — это сотни категорий и сотни тысяч доменов, и почти всегда нужна
 * пара категорий из всей базы.
 */
export function indexEntries(buf: Uint8Array): Map<string, Uint8Array> {
  const index = new Map<string, Uint8Array>()
  const r: Reader = { buf, pos: 0 }
  while (r.pos < buf.length) {
    const key = readVarint(r)
    const wire = key & 7
    if (key >>> 3 !== 1 || wire !== 2) {
      skipField(r, wire)
      continue
    }
    const entry = readBytes(r)
    const er: Reader = { buf: entry, pos: 0 }
    let code = ''
    while (er.pos < entry.length) {
      const ekey = readVarint(er)
      const ewire = ekey & 7
      if (ekey >>> 3 === 1 && ewire === 2) {
        code = decoder.decode(readBytes(er))
        break // остальное (домены/CIDR) читаем только по требованию
      }
      skipField(er, ewire)
    }
    if (code !== '') index.set(code, entry)
  }
  return index
}

export function parseDomains(entry: Uint8Array): GeoDomain[] {
  const domains: GeoDomain[] = []
  const r: Reader = { buf: entry, pos: 0 }
  while (r.pos < entry.length) {
    const key = readVarint(r)
    const wire = key & 7
    if (key >>> 3 !== 2 || wire !== 2) {
      skipField(r, wire)
      continue
    }
    const raw = readBytes(r)
    const dr: Reader = { buf: raw, pos: 0 }
    let type: GeoDomain['type'] = 0
    let value = ''
    const attributes: string[] = []
    while (dr.pos < raw.length) {
      const dkey = readVarint(dr)
      const dwire = dkey & 7
      const field = dkey >>> 3
      if (field === 1 && dwire === 0) type = readVarint(dr) as GeoDomain['type']
      else if (field === 2 && dwire === 2) value = decoder.decode(readBytes(dr))
      else if (field === 3 && dwire === 2) {
        const attr = readBytes(dr)
        const ar: Reader = { buf: attr, pos: 0 }
        while (ar.pos < attr.length) {
          const akey = readVarint(ar)
          const awire = akey & 7
          if (akey >>> 3 === 1 && awire === 2) attributes.push(decoder.decode(readBytes(ar)))
          else skipField(ar, awire)
        }
      } else skipField(dr, dwire)
    }
    domains.push({ type, value, attributes })
  }
  return domains
}

export function parseCidrs(entry: Uint8Array): { cidrs: GeoCidr[]; reverseMatch: boolean } {
  const cidrs: GeoCidr[] = []
  let reverseMatch = false
  const r: Reader = { buf: entry, pos: 0 }
  while (r.pos < entry.length) {
    const key = readVarint(r)
    const wire = key & 7
    const field = key >>> 3
    if (field === 2 && wire === 2) {
      const raw = readBytes(r)
      const cr: Reader = { buf: raw, pos: 0 }
      let ip = new Uint8Array()
      let prefix = 0
      while (cr.pos < raw.length) {
        const ckey = readVarint(cr)
        const cwire = ckey & 7
        if (ckey >>> 3 === 1 && cwire === 2) ip = readBytes(cr)
        else if (ckey >>> 3 === 2 && cwire === 0) prefix = readVarint(cr)
        else skipField(cr, cwire)
      }
      cidrs.push({ ip, prefix })
    } else if (field === 3 && wire === 0) {
      reverseMatch = readVarint(r) !== 0
    } else skipField(r, wire)
  }
  return { cidrs, reverseMatch }
}

// --- Кодирование: нужно тестам и фикстурам, боевой код им не пользуется ---

function varint(value: number): number[] {
  const out: number[] = []
  let v = value
  while (v > 127) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}

const encoder = new TextEncoder()

function tagged(field: number, wire: number, payload: number[]): number[] {
  return [...varint((field << 3) | wire), ...payload]
}

function lengthDelimited(field: number, body: number[]): number[] {
  return tagged(field, 2, [...varint(body.length), ...body])
}

function domainBody(d: GeoDomain): number[] {
  const out: number[] = []
  if (d.type !== 0) out.push(...tagged(1, 0, varint(d.type)))
  out.push(...lengthDelimited(2, [...encoder.encode(d.value)]))
  for (const attr of d.attributes) {
    // Attribute { key = 1, bool_value = 2 } — атрибуты в базах хранятся как bool true
    const body = [...lengthDelimited(1, [...encoder.encode(attr)]), ...tagged(2, 0, varint(1))]
    out.push(...lengthDelimited(3, body))
  }
  return out
}

export function encodeGeoSiteList(entries: { code: string; domains: GeoDomain[] }[]): Uint8Array {
  const out: number[] = []
  for (const entry of entries) {
    const body = [
      ...lengthDelimited(1, [...encoder.encode(entry.code)]),
      ...entry.domains.flatMap((d) => lengthDelimited(2, domainBody(d))),
    ]
    out.push(...lengthDelimited(1, body))
  }
  return new Uint8Array(out)
}

export function encodeGeoIpList(
  entries: { code: string; cidrs: GeoCidr[]; reverseMatch?: boolean }[],
): Uint8Array {
  const out: number[] = []
  for (const entry of entries) {
    const body = [...lengthDelimited(1, [...encoder.encode(entry.code)])]
    for (const cidr of entry.cidrs) {
      const cidrBody = [...lengthDelimited(1, [...cidr.ip])]
      if (cidr.prefix !== 0) cidrBody.push(...tagged(2, 0, varint(cidr.prefix)))
      body.push(...lengthDelimited(2, cidrBody))
    }
    if (entry.reverseMatch) body.push(...tagged(3, 0, varint(1)))
    out.push(...lengthDelimited(1, body))
  }
  return new Uint8Array(out)
}
```

- [ ] **Step 4: Запустить тест**

Run: `cd backend && npx vitest run test/geo-dat.test.ts`
Expected: PASS, 7 тестов.

Внимание к тесту «prefix 0 не теряется»: proto3 опускает нулевые скалярные поля, поэтому `prefix` должен инициализироваться нулём при разборе, а кодировщик его не пишет. Если тест падает — ошибка в инициализации, не в кодировщике.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/geo/dat.ts backend/test/geo-dat.test.ts
git commit -m "feat(backend): protobuf decoder for geosite and geoip .dat files"
```

---

### Task 2: Матчинг по geo-данным

**Files:**
- Create: `backend/src/geo/match.ts`
- Test: `backend/test/geo-match.test.ts`

**Interfaces:**
- Consumes: `indexEntries`, `parseDomains`, `parseCidrs`, `GeoDomain`, `GeoCidr` из Task 1.
- Produces:
  - `function parseKey(key: string): { kind: 'geosite' | 'geoip'; code: string; attribute?: string; negated: boolean } | null`
  - `function domainMatches(domains: GeoDomain[], address: string, attribute?: string): boolean`
  - `function ipMatches(cidrs: GeoCidr[], ip: string): boolean`
  - `function ipToBytes(ip: string): Uint8Array | null`

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/geo-match.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { domainMatches, ipMatches, ipToBytes, parseKey } from '../src/geo/match.js'
import type { GeoDomain } from '../src/geo/dat.js'

describe('parseKey', () => {
  it('код категории приводится к верхнему регистру — в файле он такой', () => {
    expect(parseKey('geosite:google')).toEqual({
      kind: 'geosite',
      code: 'GOOGLE',
      attribute: undefined,
      negated: false,
    })
  })

  it('атрибут отделяется первым @ и идёт в нижнем регистре', () => {
    expect(parseKey('geosite:Google@Ads')).toEqual({
      kind: 'geosite',
      code: 'GOOGLE',
      attribute: 'ads',
      negated: false,
    })
  })

  it('geoip с негацией, в том числе многократной', () => {
    expect(parseKey('geoip:!ru')).toEqual({ kind: 'geoip', code: 'RU', attribute: undefined, negated: true })
    expect(parseKey('geoip:!!ru')?.negated).toBe(false)
  })

  it('неизвестный префикс — null', () => {
    expect(parseKey('ext:file.dat:ru')).toBeNull()
    expect(parseKey('domain:google.com')).toBeNull()
  })
})

describe('domainMatches', () => {
  const domains: GeoDomain[] = [
    { type: 2, value: 'google.com', attributes: [] },
    { type: 3, value: 'exact.example', attributes: [] },
    { type: 0, value: 'gstatic', attributes: [] },
    { type: 1, value: '^api\\d+\\.test$', attributes: [] },
    { type: 2, value: 'ads.example', attributes: ['ads'] },
  ]

  it('тип Domain матчит сам домен и поддомены', () => {
    expect(domainMatches(domains, 'google.com')).toBe(true)
    expect(domainMatches(domains, 'www.google.com')).toBe(true)
    expect(domainMatches(domains, 'notgoogle.com')).toBe(false)
  })

  it('тип Full — только точное совпадение', () => {
    expect(domainMatches(domains, 'exact.example')).toBe(true)
    expect(domainMatches(domains, 'sub.exact.example')).toBe(false)
  })

  it('тип Substr — подстрока', () => {
    expect(domainMatches(domains, 'ssl.gstatic.com')).toBe(true)
  })

  it('тип Regex — регулярное выражение', () => {
    expect(domainMatches(domains, 'api42.test')).toBe(true)
    expect(domainMatches(domains, 'apix.test')).toBe(false)
  })

  it('атрибут сужает выборку до доменов с этим ключом', () => {
    expect(domainMatches(domains, 'ads.example', 'ads')).toBe(true)
    expect(domainMatches(domains, 'google.com', 'ads')).toBe(false)
  })

  it('битый regexp в базе не роняет матчинг', () => {
    expect(domainMatches([{ type: 1, value: '[bad', attributes: [] }], 'anything')).toBe(false)
  })
})

describe('ipToBytes', () => {
  it('IPv4 и IPv6', () => {
    expect([...ipToBytes('10.0.0.1')!]).toEqual([10, 0, 0, 1])
    expect(ipToBytes('2001:db8::1')).toHaveLength(16)
    expect(ipToBytes('не-адрес')).toBeNull()
  })
})

describe('ipMatches', () => {
  it('IPv4 по маске', () => {
    const cidrs = [{ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 }]
    expect(ipMatches(cidrs, '10.1.2.3')).toBe(true)
    expect(ipMatches(cidrs, '11.1.2.3')).toBe(false)
  })

  it('граница префикса, не кратного восьми', () => {
    const cidrs = [{ ip: new Uint8Array([192, 168, 0, 0]), prefix: 20 }]
    expect(ipMatches(cidrs, '192.168.15.255')).toBe(true)
    expect(ipMatches(cidrs, '192.168.16.0')).toBe(false)
  })

  it('версии не смешиваются', () => {
    const v6 = [{ ip: new Uint8Array(16).fill(0), prefix: 0 }]
    expect(ipMatches(v6, '10.0.0.1')).toBe(false)
  })

  it('prefix 0 матчит всё в своей версии', () => {
    const all = [{ ip: new Uint8Array([0, 0, 0, 0]), prefix: 0 }]
    expect(ipMatches(all, '8.8.8.8')).toBe(true)
  })

  it('мусорный адрес не матчится', () => {
    expect(ipMatches([{ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 }], 'nope')).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd backend && npx vitest run test/geo-match.test.ts`
Expected: FAIL — `Failed to resolve import "../src/geo/match.js"`.

- [ ] **Step 3: Минимальная реализация**

Создать `backend/src/geo/match.ts`:

```ts
// Матчинг по разобранным geo-данным. Регистр и разбор ключа повторяют
// common/geodata/rule_parser.go: код категории апперкейсится, атрибут — в нижний
// регистр, префикс «!» у geoip инвертирует результат и может повторяться.

import type { GeoCidr, GeoDomain } from './dat.js'

export interface GeoKey {
  kind: 'geosite' | 'geoip'
  code: string
  attribute?: string
  negated: boolean
}

export function parseKey(key: string): GeoKey | null {
  const kind = key.startsWith('geosite:') ? 'geosite' : key.startsWith('geoip:') ? 'geoip' : null
  if (kind === null) return null
  let body = key.slice(kind === 'geosite' ? 8 : 6)
  let negated = false
  while (body.startsWith('!')) {
    body = body.slice(1)
    negated = !negated
  }
  const at = body.indexOf('@')
  const code = (at === -1 ? body : body.slice(0, at)).toUpperCase()
  const attribute = at === -1 ? undefined : body.slice(at + 1).toLowerCase()
  return { kind, code, attribute, negated }
}

function oneDomainMatches(d: GeoDomain, address: string): boolean {
  if (d.type === 3) return address === d.value
  if (d.type === 2) return address === d.value || address.endsWith(`.${d.value}`)
  if (d.type === 1) {
    try {
      return new RegExp(d.value).test(address)
    } catch {
      // Битое выражение в чужой базе — не наша забота, просто не матчим
      return false
    }
  }
  return address.includes(d.value)
}

export function domainMatches(domains: GeoDomain[], address: string, attribute?: string): boolean {
  for (const d of domains) {
    if (attribute !== undefined && !d.attributes.includes(attribute)) continue
    if (oneDomainMatches(d, address)) return true
  }
  return false
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function ipToBytes(ip: string): Uint8Array | null {
  const v4 = IPV4_RE.exec(ip)
  if (v4) {
    const bytes = new Uint8Array(4)
    for (let i = 0; i < 4; i += 1) {
      const octet = Number(v4[i + 1])
      if (octet > 255) return null
      bytes[i] = octet
    }
    return bytes
  }
  if (!ip.includes(':')) return null
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0]!.split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : []
  const gap = halves.length === 2 ? 8 - head.length - tail.length : 8 - head.length
  if (gap < 0 || (halves.length === 1 && gap !== 0)) return null
  const groups = [...head, ...Array<string>(gap).fill('0'), ...tail]
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i += 1) {
    const part = groups[i]!
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null
    const word = parseInt(part, 16)
    bytes[i * 2] = word >> 8
    bytes[i * 2 + 1] = word & 0xff
  }
  return bytes
}

function inCidr(cidr: GeoCidr, addr: Uint8Array): boolean {
  if (cidr.ip.length !== addr.length) return false
  const full = cidr.prefix >> 3
  for (let i = 0; i < full; i += 1) {
    if (cidr.ip[i] !== addr[i]) return false
  }
  const rest = cidr.prefix & 7
  if (rest === 0) return true
  const mask = 0xff << (8 - rest) & 0xff
  return (cidr.ip[full]! & mask) === (addr[full]! & mask)
}

export function ipMatches(cidrs: GeoCidr[], ip: string): boolean {
  const addr = ipToBytes(ip)
  if (!addr) return false
  return cidrs.some((cidr) => inCidr(cidr, addr))
}
```

- [ ] **Step 4: Запустить тест**

Run: `cd backend && npx vitest run test/geo-match.test.ts`
Expected: PASS, 15 тестов.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/geo/match.ts backend/test/geo-match.test.ts
git commit -m "feat(backend): geo category matching with upper-cased codes"
```

---

### Task 3: `GeoService` — файлы, настройки, ответы

**Files:**
- Create: `backend/src/geo/service.ts`
- Test: `backend/test/geo-service.test.ts`

**Interfaces:**
- Consumes: Task 1 и 2.
- Produces:
  - `interface GeoSourceStatus { url: string; present: boolean; loadedAt?: string; sizeBytes?: number; categories?: number }`
  - `interface GeoStatus { geosite: GeoSourceStatus; geoip: GeoSourceStatus }`
  - `interface GeoMatchResult { loaded: boolean; answers: Record<string, boolean>; missing: string[] }`
  - `class GeoService { constructor(dataDir: string, fetchImpl?: typeof fetch); status(): Promise<GeoStatus>; setUrls(urls: { geositeUrl?: string; geoipUrl?: string }): Promise<GeoStatus>; update(kinds?: ('geosite'|'geoip')[]): Promise<GeoStatus>; match(input: { domain?: string; ip?: string; keys: string[] }): Promise<GeoMatchResult> }`
  - `update` реализуется здесь же вместе с классом, а тестируется отдельно в Task 4 — у загрузки своя механика (стаб `fetch`, атомарная запись, отказы).
  - `const DEFAULT_GEOSITE_URL`, `const DEFAULT_GEOIP_URL`

`loaded` в ответе `match` — это «есть хотя бы один файл, нужный для запрошенных ключей». Если запрошены только `geosite:`-ключи, отсутствие geoip-файла не должно гасить весь ответ.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/geo-service.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { GeoService, DEFAULT_GEOSITE_URL } from '../src/geo/service.js'
import { encodeGeoIpList, encodeGeoSiteList } from '../src/geo/dat.js'

let dataDir: string

async function writeGeosite() {
  await mkdir(join(dataDir, 'geodata'), { recursive: true })
  await writeFile(
    join(dataDir, 'geodata', 'geosite.dat'),
    encodeGeoSiteList([
      { code: 'GOOGLE', domains: [{ type: 2, value: 'google.com', attributes: [] }] },
      { code: 'OPENAI', domains: [{ type: 2, value: 'openai.com', attributes: [] }] },
    ]),
  )
}

async function writeGeoip() {
  await mkdir(join(dataDir, 'geodata'), { recursive: true })
  await writeFile(
    join(dataDir, 'geodata', 'geoip.dat'),
    encodeGeoIpList([{ code: 'RU', cidrs: [{ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 }] }]),
  )
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'xui-geo-'))
})

describe('GeoService.status', () => {
  it('без файлов — present false и URL по умолчанию', async () => {
    const status = await new GeoService(dataDir).status()
    expect(status.geosite.present).toBe(false)
    expect(status.geosite.url).toBe(DEFAULT_GEOSITE_URL)
  })

  it('с файлом — размер, дата и число категорий', async () => {
    await writeGeosite()
    const status = await new GeoService(dataDir).status()
    expect(status.geosite.present).toBe(true)
    expect(status.geosite.categories).toBe(2)
    expect(status.geosite.sizeBytes).toBeGreaterThan(0)
    expect(status.geosite.loadedAt).toBeTruthy()
  })

  it('setUrls сохраняет ссылки и они видны после перезапуска сервиса', async () => {
    await new GeoService(dataDir).setUrls({ geositeUrl: 'https://example.test/dlc.dat' })
    const status = await new GeoService(dataDir).status()
    expect(status.geosite.url).toBe('https://example.test/dlc.dat')
  })

  it('нехттп-схема отвергается', async () => {
    await expect(new GeoService(dataDir).setUrls({ geositeUrl: 'file:///etc/passwd' })).rejects.toThrow(
      /http/i,
    )
  })
})

describe('GeoService.match', () => {
  it('без файлов — loaded false, ответов нет', async () => {
    const res = await new GeoService(dataDir).match({ domain: 'google.com', keys: ['geosite:google'] })
    expect(res.loaded).toBe(false)
    expect(res.answers).toEqual({})
  })

  it('домен в категории и не в категории', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({
      domain: 'www.google.com',
      keys: ['geosite:google', 'geosite:openai'],
    })
    expect(res.loaded).toBe(true)
    expect(res.answers).toEqual({ 'geosite:google': true, 'geosite:openai': false })
    expect(res.missing).toEqual([])
  })

  it('регистр ключа не важен — код всё равно апперкейсится', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({ domain: 'google.com', keys: ['geosite:GOOGLE'] })
    expect(res.answers['geosite:GOOGLE']).toBe(true)
  })

  it('категории нет в базе — попадает в missing, а не в answers', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({ domain: 'google.com', keys: ['geosite:nosuch'] })
    expect(res.missing).toEqual(['geosite:nosuch'])
    expect(res.answers['geosite:nosuch']).toBeUndefined()
  })

  it('geoip отвечает по IP, негация инвертирует', async () => {
    await writeGeoip()
    const res = await new GeoService(dataDir).match({ ip: '10.1.2.3', keys: ['geoip:ru', 'geoip:!ru'] })
    expect(res.answers).toEqual({ 'geoip:ru': true, 'geoip:!ru': false })
  })

  it('без IP на geoip-ключи не отвечаем вовсе', async () => {
    await writeGeoip()
    const res = await new GeoService(dataDir).match({ domain: 'google.com', keys: ['geoip:ru'] })
    expect(res.answers).toEqual({})
  })

  it('geosite-ключи отвечаются, даже если geoip-файла нет', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({
      domain: 'google.com',
      ip: '10.1.2.3',
      keys: ['geosite:google', 'geoip:ru'],
    })
    expect(res.loaded).toBe(true)
    expect(res.answers['geosite:google']).toBe(true)
    expect(res.answers['geoip:ru']).toBeUndefined()
  })

  it('нераспознанные ключи (ext:) игнорируются', async () => {
    await writeGeosite()
    const res = await new GeoService(dataDir).match({ domain: 'google.com', keys: ['ext:f.dat:x'] })
    expect(res.answers).toEqual({})
    expect(res.missing).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd backend && npx vitest run test/geo-service.test.ts`
Expected: FAIL — `Failed to resolve import "../src/geo/service.js"`.

- [ ] **Step 3: Реализация**

Создать `backend/src/geo/service.ts`:

```ts
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { indexEntries, parseCidrs, parseDomains } from './dat.js'
import { domainMatches, ipMatches, parseKey } from './match.js'

// Дефолты — канонические списки v2fly. Альтернатива с расширенными категориями:
// https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat
export const DEFAULT_GEOSITE_URL =
  'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat'
export const DEFAULT_GEOIP_URL =
  'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat'

export interface GeoSourceStatus {
  url: string
  present: boolean
  loadedAt?: string
  sizeBytes?: number
  categories?: number
}

export interface GeoStatus {
  geosite: GeoSourceStatus
  geoip: GeoSourceStatus
}

export interface GeoMatchResult {
  loaded: boolean
  answers: Record<string, boolean>
  missing: string[]
}

interface Settings {
  geositeUrl?: string
  geoipUrl?: string
}

type Kind = 'geosite' | 'geoip'

interface Cached {
  mtimeMs: number
  index: Map<string, Uint8Array>
}

const MAX_BYTES = 64 * 1024 * 1024

export class GeoService {
  private cache = new Map<Kind, Cached>()

  constructor(
    private dataDir: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private fileFor(kind: Kind): string {
    return join(this.dataDir, 'geodata', `${kind}.dat`)
  }

  private settingsPath(): string {
    return join(this.dataDir, 'settings.json')
  }

  private async readSettings(): Promise<Settings> {
    try {
      const raw = await readFile(this.settingsPath(), 'utf8')
      return ((JSON.parse(raw) as { geo?: Settings }).geo ?? {}) as Settings
    } catch {
      return {}
    }
  }

  private async writeSettings(next: Settings): Promise<void> {
    let root: Record<string, unknown> = {}
    try {
      root = JSON.parse(await readFile(this.settingsPath(), 'utf8')) as Record<string, unknown>
    } catch {
      root = {}
    }
    root.geo = next
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.settingsPath(), JSON.stringify(root, null, 2), 'utf8')
  }

  private urlFor(kind: Kind, settings: Settings): string {
    if (kind === 'geosite') return settings.geositeUrl ?? DEFAULT_GEOSITE_URL
    return settings.geoipUrl ?? DEFAULT_GEOIP_URL
  }

  /** Индекс живёт в памяти до смены mtime файла — разбирать его на каждый запрос незачем */
  private async indexOf(kind: Kind): Promise<Map<string, Uint8Array> | null> {
    let info
    try {
      info = await stat(this.fileFor(kind))
    } catch {
      this.cache.delete(kind)
      return null
    }
    const cached = this.cache.get(kind)
    if (cached && cached.mtimeMs === info.mtimeMs) return cached.index
    const buf = await readFile(this.fileFor(kind))
    const index = indexEntries(new Uint8Array(buf))
    this.cache.set(kind, { mtimeMs: info.mtimeMs, index })
    return index
  }

  private async statusOf(kind: Kind, settings: Settings): Promise<GeoSourceStatus> {
    const url = this.urlFor(kind, settings)
    try {
      const info = await stat(this.fileFor(kind))
      const index = await this.indexOf(kind)
      return {
        url,
        present: true,
        loadedAt: info.mtime.toISOString(),
        sizeBytes: info.size,
        categories: index?.size ?? 0,
      }
    } catch {
      return { url, present: false }
    }
  }

  async status(): Promise<GeoStatus> {
    const settings = await this.readSettings()
    return {
      geosite: await this.statusOf('geosite', settings),
      geoip: await this.statusOf('geoip', settings),
    }
  }

  async setUrls(urls: { geositeUrl?: string; geoipUrl?: string }): Promise<GeoStatus> {
    for (const url of [urls.geositeUrl, urls.geoipUrl]) {
      if (url === undefined) continue
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Ссылка должна начинаться с http:// или https://')
      }
    }
    const settings = await this.readSettings()
    await this.writeSettings({
      geositeUrl: urls.geositeUrl ?? settings.geositeUrl,
      geoipUrl: urls.geoipUrl ?? settings.geoipUrl,
    })
    return this.status()
  }

  /** Скачивает базы по сохранённым ссылкам; пишет через временный файл, чтобы не оставить обрубок */
  async update(kinds: Kind[] = ['geosite', 'geoip']): Promise<GeoStatus> {
    const settings = await this.readSettings()
    await mkdir(join(this.dataDir, 'geodata'), { recursive: true })
    for (const kind of kinds) {
      const url = this.urlFor(kind, settings)
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' })
      if (!res.ok) throw new Error(`Не удалось скачать ${kind}: сервер ответил ${res.status}`)
      const body = new Uint8Array(await res.arrayBuffer())
      if (body.byteLength === 0) throw new Error(`Пустой ответ при загрузке ${kind}`)
      if (body.byteLength > MAX_BYTES) throw new Error(`Файл ${kind} больше 64 МБ — отказываюсь`)
      if (indexEntries(body).size === 0) {
        throw new Error(`Файл ${kind} не похож на geo-базу: ни одной категории`)
      }
      const target = this.fileFor(kind)
      const tmp = `${target}.tmp`
      await writeFile(tmp, body)
      await rename(tmp, target)
      this.cache.delete(kind)
    }
    return this.status()
  }

  async match(input: { domain?: string; ip?: string; keys: string[] }): Promise<GeoMatchResult> {
    const answers: Record<string, boolean> = {}
    const missing: string[] = []
    let loaded = false

    for (const key of input.keys) {
      const parsed = parseKey(key)
      if (!parsed) continue
      if (parsed.kind === 'geosite' && input.domain === undefined) continue
      if (parsed.kind === 'geoip' && input.ip === undefined) continue

      const index = await this.indexOf(parsed.kind)
      if (!index) continue
      loaded = true

      const entry = index.get(parsed.code)
      if (!entry) {
        if (!missing.includes(key)) missing.push(key)
        continue
      }
      let hit: boolean
      if (parsed.kind === 'geosite') {
        hit = domainMatches(parseDomains(entry), input.domain!, parsed.attribute)
      } else {
        const { cidrs, reverseMatch } = parseCidrs(entry)
        hit = ipMatches(cidrs, input.ip!)
        if (reverseMatch) hit = !hit
      }
      answers[key] = parsed.negated ? !hit : hit
    }

    return { loaded, answers, missing }
  }
}
```

- [ ] **Step 4: Запустить тест**

Run: `cd backend && npx vitest run test/geo-service.test.ts`
Expected: PASS, 13 тестов.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/geo/service.ts backend/test/geo-service.test.ts
git commit -m "feat(backend): geo service with settings, cache and lookup"
```

---

### Task 4: Загрузка баз по ссылке

**Files:**
- Modify: `backend/test/geo-service.test.ts`

**Interfaces:**
- Consumes: `GeoService.update` (реализован в Task 3 вместе с классом).
- Produces: тесты на загрузку — отдельной задачей, потому что у неё своя механика (стаб `fetch`, атомарность, отказы).

- [ ] **Step 1: Написать падающий тест**

Дописать в `backend/test/geo-service.test.ts`:

```ts
describe('GeoService.update', () => {
  const goodBody = () =>
    encodeGeoSiteList([{ code: 'GOOGLE', domains: [{ type: 2, value: 'google.com', attributes: [] }] }])

  function fetchStub(body: Uint8Array | null, status = 200): typeof fetch {
    return (async () =>
      new Response(body === null ? null : (body as unknown as BodyInit), { status })) as unknown as typeof fetch
  }

  it('скачивает базу и она сразу отвечает на запросы', async () => {
    const svc = new GeoService(dataDir, fetchStub(goodBody()))
    const status = await svc.update(['geosite'])
    expect(status.geosite.present).toBe(true)
    expect(status.geosite.categories).toBe(1)
    const res = await svc.match({ domain: 'www.google.com', keys: ['geosite:google'] })
    expect(res.answers['geosite:google']).toBe(true)
  })

  it('ошибка сервера — исключение с текстом про статус', async () => {
    const svc = new GeoService(dataDir, fetchStub(goodBody(), 503))
    await expect(svc.update(['geosite'])).rejects.toThrow(/503/)
  })

  it('файл не похож на geo-базу — отказ, старая база не затирается', async () => {
    await writeGeosite()
    const svc = new GeoService(dataDir, fetchStub(new Uint8Array([1, 2, 3])))
    await expect(svc.update(['geosite'])).rejects.toThrow(/не похож/)
    const res = await svc.match({ domain: 'google.com', keys: ['geosite:google'] })
    expect(res.answers['geosite:google']).toBe(true)
  })

  it('пустой ответ — отказ', async () => {
    const svc = new GeoService(dataDir, fetchStub(new Uint8Array()))
    await expect(svc.update(['geosite'])).rejects.toThrow(/Пуст/i)
  })

  it('обновление сбрасывает кэш: новая база отвечает по-новому', async () => {
    await writeGeosite()
    const svc = new GeoService(dataDir, fetchStub(goodBody()))
    expect((await svc.match({ domain: 'openai.com', keys: ['geosite:openai'] })).answers['geosite:openai']).toBe(true)
    await svc.update(['geosite'])
    const after = await svc.match({ domain: 'openai.com', keys: ['geosite:openai'] })
    // В новой базе категории OPENAI нет — она должна уйти в missing, а не остаться true из кэша
    expect(after.missing).toEqual(['geosite:openai'])
  })
})
```

- [ ] **Step 2: Запустить тест**

Run: `cd backend && npx vitest run test/geo-service.test.ts`
Expected: PASS, 18 тестов. Если тест «обновление сбрасывает кэш» падает — `update` не делает `this.cache.delete(kind)` либо `rename` не меняет mtime.

- [ ] **Step 3: Коммит**

```bash
git add backend/test/geo-service.test.ts
git commit -m "test(backend): geo database download, validation and cache reset"
```

---

### Task 5: Роуты geo

**Files:**
- Create: `backend/src/routes/geo.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/geo-routes.test.ts`

**Interfaces:**
- Consumes: `GeoService` из Task 3.
- Produces:
  - `GET /api/geo` → `GeoStatus`
  - `PUT /api/geo` → `{ geositeUrl?, geoipUrl? }` → `GeoStatus`
  - `POST /api/geo/update` → `{ kinds?: ('geosite'|'geoip')[] }` → `GeoStatus`
  - `POST /api/tools/geo/match` → `{ domain?, ip?, keys }` → `GeoMatchResult`
  - `app.geo: GeoService`, `ServerDeps.geo?: GeoService`

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/geo-routes.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { GeoService } from '../src/geo/service.js'
import { encodeGeoSiteList } from '../src/geo/dat.js'
import { StubRemnawave } from './stub-remnawave.js'
import { loginCookie, makeTestConfig } from './helpers.js'

let app: FastifyInstance
let cookie: string
let dataDir: string

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'xui-geo-routes-'))
  await mkdir(join(dataDir, 'geodata'), { recursive: true })
  await writeFile(
    join(dataDir, 'geodata', 'geosite.dat'),
    encodeGeoSiteList([{ code: 'GOOGLE', domains: [{ type: 2, value: 'google.com', attributes: [] }] }]),
  )
  app = await buildServer(makeTestConfig({ dataDir }), {
    remnawave: new StubRemnawave(),
    geo: new GeoService(dataDir),
  })
  cookie = await loginCookie(app)
})

afterEach(async () => {
  await app.close()
})

describe('GET /api/geo', () => {
  it('возвращает состояние баз', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/geo', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { geosite: { present: boolean; categories: number } }
    expect(body.geosite.present).toBe(true)
    expect(body.geosite.categories).toBe(1)
  })

  it('без авторизации — 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/geo' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PUT /api/geo', () => {
  it('сохраняет ссылку', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/geo',
      headers: { cookie },
      payload: { geositeUrl: 'https://example.test/dlc.dat' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { geosite: { url: string } }).geosite.url).toBe('https://example.test/dlc.dat')
  })

  it('нехттп-схема — 400 с русским сообщением', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/geo',
      headers: { cookie },
      payload: { geositeUrl: 'file:///etc/passwd' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toMatch(/http/i)
  })
})

describe('POST /api/tools/geo/match', () => {
  it('отвечает по домену', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/geo/match',
      headers: { cookie },
      payload: { domain: 'www.google.com', keys: ['geosite:google', 'geosite:nosuch'] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { loaded: boolean; answers: Record<string, boolean>; missing: string[] }
    expect(body.loaded).toBe(true)
    expect(body.answers['geosite:google']).toBe(true)
    expect(body.missing).toEqual(['geosite:nosuch'])
  })

  it('keys обязателен — 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/geo/match',
      headers: { cookie },
      payload: { domain: 'google.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('пустой список ключей — пустой ответ, а не ошибка', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/geo/match',
      headers: { cookie },
      payload: { domain: 'google.com', keys: [] },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { answers: Record<string, boolean> }).answers).toEqual({})
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd backend && npx vitest run test/geo-routes.test.ts`
Expected: FAIL — `Object literal may only specify known properties` на `geo` в deps либо 404 на `/api/geo`.

- [ ] **Step 3: Реализация**

Создать `backend/src/routes/geo.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const urlsSchema = z.object({
  geositeUrl: z.string().min(1).optional(),
  geoipUrl: z.string().min(1).optional(),
})

const updateSchema = z.object({
  // .min(1), а не .nonempty(): в проекте zod ^3.25, где nonempty уже помечен устаревшим
  kinds: z.array(z.enum(['geosite', 'geoip'])).min(1).optional(),
})

const matchSchema = z.object({
  domain: z.string().min(1).optional(),
  ip: z.string().min(1).optional(),
  keys: z.array(z.string()),
})

export const geoRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/geo', async () => app.geo.status())

  app.put('/api/geo', async (req) => app.geo.setUrls(urlsSchema.parse(req.body)))

  app.post('/api/geo/update', async (req) => {
    const { kinds } = updateSchema.parse(req.body ?? {})
    return app.geo.update(kinds)
  })

  app.post('/api/tools/geo/match', async (req) => app.geo.match(matchSchema.parse(req.body)))
}
```

В `backend/src/server.ts`:

```ts
// к импортам
import { GeoService } from './geo/service.js'
import { geoRoutes } from './routes/geo.js'
```

```ts
// в declare module 'fastify' → interface FastifyInstance
    geo: GeoService
```

```ts
// в ServerDeps
  geo?: GeoService
```

```ts
// рядом с decorate('backups', ...)
  app.decorate('geo', deps.geo ?? new GeoService(config.dataDir))
```

```ts
// рядом с register(toolsRoutes)
  await app.register(geoRoutes)
```

Ошибки `GeoService` — обычные `Error`, поэтому глобальный обработчик отдаст 500. Для `setUrls` нужен 400: в `geo.ts` оборачиваем вызов:

```ts
  app.put('/api/geo', async (req, reply) => {
    try {
      return await app.geo.setUrls(urlsSchema.parse(req.body))
    } catch (err) {
      if (err instanceof Error && /http/i.test(err.message)) {
        return reply.status(400).send({ message: err.message })
      }
      throw err
    }
  })
```

- [ ] **Step 4: Запустить тесты бэкенда целиком и typecheck**

Run: `cd backend && npm test && npm run typecheck`
Expected: PASS всё.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/routes/geo.ts backend/src/server.ts backend/test/geo-routes.test.ts
git commit -m "feat(backend): geo status, urls, update and match routes"
```

---

### Task 6: Фронтовые типы и хуки

**Files:**
- Modify: `frontend/src/shared/api/types.ts`
- Modify: `frontend/src/shared/api/hooks.ts`
- Test: `frontend/test/api-client.test.ts`

**Interfaces:**
- Produces:
  - `interface GeoSourceStatus { url: string; present: boolean; loadedAt?: string; sizeBytes?: number; categories?: number }`
  - `interface GeoStatus { geosite: GeoSourceStatus; geoip: GeoSourceStatus }`
  - `interface GeoMatchAnswer { loaded: boolean; answers: Record<string, boolean>; missing: string[] }`
  - `useGeoStatus()`, `useSaveGeoUrls()`, `useUpdateGeo()`
  - `useGeoMatch(input: { domain?: string; ip?: string; keys: string[] } | null)` — `useQuery`, выключен при `null` или пустых `keys`

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/geo-hooks.test.tsx` — отдельным файлом, потому что нужен JSX для провайдера, а `api-client.test.ts` — чистый `.ts`. Мокаем `fetch` тем же приёмом, что и там: `vi.stubGlobal` + `vi.unstubAllGlobals` в `afterEach`. Обратите внимание: `renderHook` в этом проекте ещё не использовался — существующий тест хуков проверяет только `typeof === 'function'`, так что готового хелпера для рендера хуков нет, заводим здесь.

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGeoMatch } from '../src/shared/api'

function mockFetch(body: unknown) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function withClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useGeoMatch', () => {
  it('не запрашивает без ключей', () => {
    const fn = mockFetch({})
    const { result } = renderHook(() => useGeoMatch({ domain: 'a.com', keys: [] }), {
      wrapper: withClient(),
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(fn).not.toHaveBeenCalled()
  })

  it('не запрашивает при null', () => {
    const fn = mockFetch({})
    renderHook(() => useGeoMatch(null), { wrapper: withClient() })
    expect(fn).not.toHaveBeenCalled()
  })

  it('запрашивает и возвращает ответы', async () => {
    mockFetch({ loaded: true, answers: { 'geosite:google': true }, missing: [] })
    const { result } = renderHook(() => useGeoMatch({ domain: 'google.com', keys: ['geosite:google'] }), {
      wrapper: withClient(),
    })
    await waitFor(() => expect(result.current.data?.answers['geosite:google']).toBe(true))
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/geo-hooks.test.tsx`
Expected: FAIL — `useGeoMatch is not exported`.

- [ ] **Step 3: Реализация**

В `frontend/src/shared/api/types.ts`:

```ts
export interface GeoSourceStatus {
  url: string
  present: boolean
  loadedAt?: string
  sizeBytes?: number
  categories?: number
}

export interface GeoStatus {
  geosite: GeoSourceStatus
  geoip: GeoSourceStatus
}

export interface GeoMatchAnswer {
  loaded: boolean
  answers: Record<string, boolean>
  missing: string[]
}
```

В `frontend/src/shared/api/hooks.ts` (импорт типов добавить к существующему):

```ts
export function useGeoStatus() {
  return useQuery({
    queryKey: ['geo'],
    queryFn: () => apiFetch<GeoStatus>('/api/geo'),
    staleTime: 60_000,
  })
}

export function useSaveGeoUrls() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (urls: { geositeUrl?: string; geoipUrl?: string }) =>
      apiFetch<GeoStatus>('/api/geo', { method: 'PUT', body: JSON.stringify(urls) }),
    onSuccess: (status) => qc.setQueryData(['geo'], status),
  })
}

export function useUpdateGeo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<GeoStatus>('/api/geo/update', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (status) => {
      qc.setQueryData(['geo'], status)
      // Вердикты трассировки посчитаны по старой базе — пересчитываем
      qc.invalidateQueries({ queryKey: ['geo-match'] })
    },
  })
}

/** Ответы geo-базы для набора ключей из правил. null или пустые keys — запрос не идёт. */
export function useGeoMatch(input: { domain?: string; ip?: string; keys: string[] } | null) {
  const keys = input?.keys ?? []
  return useQuery({
    queryKey: ['geo-match', input?.domain ?? null, input?.ip ?? null, [...keys].sort()],
    queryFn: () =>
      apiFetch<GeoMatchAnswer>('/api/tools/geo/match', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    enabled: input !== null && keys.length > 0,
    staleTime: 60_000,
  })
}
```

Отдельные экспорты не нужны: `frontend/src/shared/api/index.ts` реэкспортирует `./types` и `./hooks` через `export *`.

- [ ] **Step 4: Запустить тест**

Run: `cd frontend && npx vitest run test/geo-hooks.test.tsx`
Expected: PASS, 3 теста.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/shared/api frontend/test/geo-hooks.test.tsx
git commit -m "feat(frontend): api hooks for geo status, update and match"
```

---

### Task 7: Диалог geo-баз

**Files:**
- Create: `frontend/src/features/diagnostics/GeoDataDialog.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/geo-dialog.test.tsx`

**Interfaces:**
- Consumes: `useGeoStatus`, `useSaveGeoUrls`, `useUpdateGeo`.
- Produces: `function GeoDataDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element`

Поведение: два поля URL с кнопками-пресетами (v2fly, Loyalsoldier), кнопка «Загрузить», состояние каждой базы (дата, размер, число категорий), явное предупреждение о том, что списки должны совпадать с теми, что стоят на нодах.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/geo-dialog.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeoDataDialog } from '../src/features/diagnostics/GeoDataDialog'

const STATUS = {
  geosite: {
    url: 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat',
    present: true,
    loadedAt: '2026-07-24T10:00:00.000Z',
    sizeBytes: 1234567,
    categories: 1200,
  },
  geoip: { url: 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat', present: false },
}

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// Тот же приём, что в api-client.test.ts: stubGlobal + unstubAllGlobals
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(STATUS), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('GeoDataDialog', () => {
  it('показывает состояние загруженной базы и отсутствие второй', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/категорий: 1200/i)).toBeInTheDocument())
    expect(screen.getByText(/не загружена/i)).toBeInTheDocument()
  })

  it('кнопка загрузки дергает /api/geo/update', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/категорий: 1200/i)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /загрузить/i }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/geo/update'))).toBe(true),
    )
  })

  it('пресет подставляет ссылку Loyalsoldier в поле geosite', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Ссылка на geosite')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /loyalsoldier/i }))
    expect(screen.getByLabelText('Ссылка на geosite')).toHaveValue(
      'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
    )
  })

  it('предупреждает, что базы должны совпадать с нодами', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/на нодах/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/geo-dialog.test.tsx`
Expected: FAIL — `Failed to resolve import ".../GeoDataDialog"`.

- [ ] **Step 3: Реализация**

Создать `frontend/src/features/diagnostics/GeoDataDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useGeoStatus, useSaveGeoUrls, useUpdateGeo, type GeoSourceStatus } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog, TextInput } from '../../shared/ui'

const PRESETS = {
  v2fly: {
    geosite: 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat',
    geoip: 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat',
  },
  loyalsoldier: {
    geosite: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
    geoip: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat',
  },
}

function megabytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function SourceState({ label, status }: { label: string; status: GeoSourceStatus | undefined }) {
  if (!status) return null
  return (
    <div className="geo-state">
      <span className="geo-state-name">{label}</span>
      {status.present ? (
        <span className="metrics">
          <span className="metric metric-accent">{`категорий: ${status.categories ?? 0}`}</span>
          <span className="metric">{megabytes(status.sizeBytes)}</span>
          {status.loadedAt && <span className="metric">{`обновлена ${relativeTime(status.loadedAt)}`}</span>}
        </span>
      ) : (
        <span className="field-warning">не загружена</span>
      )}
    </div>
  )
}

export function GeoDataDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useGeoStatus()
  const save = useSaveGeoUrls()
  const update = useUpdateGeo()
  const [geositeUrl, setGeositeUrl] = useState('')
  const [geoipUrl, setGeoipUrl] = useState('')

  // Поля наполняются, когда приходит статус; правки пользователя не перетираем
  useEffect(() => {
    if (!status.data) return
    setGeositeUrl((v) => (v === '' ? status.data.geosite.url : v))
    setGeoipUrl((v) => (v === '' ? status.data.geoip.url : v))
  }, [status.data])

  function applyPreset(preset: keyof typeof PRESETS) {
    setGeositeUrl(PRESETS[preset].geosite)
    setGeoipUrl(PRESETS[preset].geoip)
  }

  const busy = save.isPending || update.isPending
  const error = (save.error ?? update.error) as Error | undefined

  return (
    <Dialog open={open} title="Geo-базы" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Списки нужны трассировщику, чтобы отвечать по условиям <span className="mono">geosite:</span> и{' '}
        <span className="mono">geoip:</span>. Держите их теми же, что стоят на нодах — иначе вердикты
        разойдутся с реальностью.
      </p>

      <SourceState label="geosite" status={status.data?.geosite} />
      <SourceState label="geoip" status={status.data?.geoip} />

      <div className="field">
        <label className="field-label" htmlFor="geo-site-url">
          Ссылка на geosite
        </label>
        <TextInput id="geo-site-url" value={geositeUrl} onChange={(e) => setGeositeUrl(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="geo-ip-url">
          Ссылка на geoip
        </label>
        <TextInput id="geo-ip-url" value={geoipUrl} onChange={(e) => setGeoipUrl(e.target.value)} />
      </div>

      <div className="row">
        <span className="muted">Пресеты:</span>
        <Button onClick={() => applyPreset('v2fly')}>v2fly</Button>
        <Button onClick={() => applyPreset('loyalsoldier')}>Loyalsoldier</Button>
      </div>

      {error && <p className="field-error">{error.message}</p>}

      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
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
    </Dialog>
  )
}
```

Дописать в `frontend/src/shared/ui/tokens.css`:

```css
/* Состояние geo-базы в диалоге */
.geo-state { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.geo-state-name { font-family: var(--font-mono); font-size: var(--t-sm); color: var(--ink-dim); min-width: 4.5rem; }
```

- [ ] **Step 4: Запустить тест**

Run: `cd frontend && npx vitest run test/geo-dialog.test.tsx`
Expected: PASS, 4 теста.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/diagnostics/GeoDataDialog.tsx frontend/src/shared/ui/tokens.css frontend/test/geo-dialog.test.tsx
git commit -m "feat(frontend): geo databases dialog with presets and status"
```

---

### Task 8: Текст вердикта зависит от стратегии

**Files:**
- Modify: `frontend/src/entities/xray/traceMatch.ts`
- Modify: `frontend/src/entities/xray/trace.ts`
- Test: `frontend/test/trace.test.ts`

**Interfaces:**
- Изменение: `matchIpField(field, patterns, ip, availability, geo, neverReason?)` — шестой необязательный параметр с текстом для `availability: 'never'`. Существующие вызовы и тесты не ломаются.

Найдено тестированием: при `IPIfNonMatch` вердикт писал «стратегия домена AsIs», хотя в конфиге стояла другая стратегия.

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/trace.test.ts`:

```ts
describe('traceRoute: причина отказа ip-условия зависит от стратегии', () => {
  const ipRule = [{ ip: ['10.0.0.0/8'], outboundTag: 'warp' }]

  it('AsIs — так и говорит про AsIs', () => {
    const res = traceRoute(config(ipRule), TARGET, NO_GEO)
    expect(res.verdicts[0].fields[0].reason).toContain('AsIs')
  })

  it('IPIfNonMatch — говорит про второй проход, а не про AsIs', () => {
    const cfg = { ...config(ipRule), routing: { domainStrategy: 'IPIfNonMatch', rules: ipRule } } as XrayConfig
    const res = traceRoute(cfg, TARGET, NO_GEO)
    const reason = res.verdicts[0].fields[0].reason
    expect(reason).not.toContain('AsIs')
    expect(reason).toMatch(/втор|IP назначения/i)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/trace.test.ts`
Expected: FAIL — второй тест: reason содержит «AsIs».

- [ ] **Step 3: Реализация**

В `frontend/src/entities/xray/traceMatch.ts` — сигнатура и ветка `never`:

```ts
export function matchIpField(
  field: string,
  patterns: string[],
  ip: string | undefined,
  availability: IpAvailability,
  geo: GeoAnswers,
  /** Текст для 'never': зависит от фактической стратегии домена */
  neverReason = 'стратегия домена AsIs: ядро не резолвит домен, поэтому ip-условия не применяются',
): FieldVerdict {
  if (availability === 'never') {
    return { field, state: 'no', reason: neverReason }
  }
  // ...остальное без изменений
```

В `frontend/src/entities/xray/trace.ts` — `judgeRule` получает текст, `judgeAll` его прокидывает:

```ts
function judgeRule(
  rule: Rule,
  index: number,
  target: TraceTarget,
  geo: GeoAnswers,
  ipAvailability: IpAvailability,
  neverReason?: string,
): RuleVerdict {
  const fields: FieldVerdict[] = []
  if (rule.domain?.length) fields.push(matchDomainField(rule.domain, target.address, geo))
  if (rule.ip?.length) {
    fields.push(matchIpField('ip', rule.ip, target.ip, ipAvailability, geo, neverReason))
  }
  // ...остальное без изменений
```

```ts
function judgeAll(
  config: XrayConfig,
  target: TraceTarget,
  geo: GeoAnswers,
  ipAvailability: IpAvailability,
  neverReason?: string,
): RuleVerdict[] {
  const rules = (config.routing?.rules ?? []) as Rule[]
  return rules.map((rule, index) => judgeRule(rule, index, target, geo, ipAvailability, neverReason))
}
```

В `traceRoute` — текст по стратегии и передача в первый проход:

```ts
  const neverReason =
    strategy === 'IPIfNonMatch'
      ? 'на первом проходе домен ещё не разрешён в адрес; укажите IP назначения, чтобы увидеть второй проход'
      : 'стратегия домена AsIs: ядро не резолвит домен, поэтому ip-условия не применяются'

  const verdicts = judgeAll(config, effectiveTarget, geo, firstPassIp, neverReason)
```

- [ ] **Step 4: Запустить тесты**

Run: `cd frontend && npx vitest run test/trace.test.ts test/trace-match.test.ts`
Expected: PASS, все (включая прежние 23 + 2 новых).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/traceMatch.ts frontend/src/entities/xray/trace.ts frontend/test/trace.test.ts
git commit -m "fix(frontend): verdict reason names the actual domain strategy"
```

---

### Task 9: Тумблер «Трасса» и кнопка geo из caveat

**Files:**
- Modify: `frontend/src/features/diagnostics/TracePanel.tsx`
- Modify: `frontend/src/features/diagnostics/TraceBar.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/trace-panel.test.tsx`, `frontend/test/trace-bar.test.tsx`

**Interfaces:**
- `TracePanel` получает необязательный проп `onOpenGeo?: () => void` — при наличии рядом с caveat про незагруженные базы появляется кнопка «Geo-базы».
- `TraceBar` получает подпись-приставку «Куда пойдёт трафик» (не `<label>`, чтобы не портить accessible-имена полей).

Найдено тестированием: поля торчали в доке без объяснения, а сообщение «Geo-базы не загружены» не давало пути к решению.

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/trace-panel.test.tsx`:

```tsx
  it('caveat про незагруженные базы предлагает открыть диалог geo', async () => {
    const onOpenGeo = vi.fn()
    const withGeoCaveat: TraceResult = {
      ...result,
      caveats: ['Geo-базы не загружены: вердикты по geosite:/geoip: неизвестны.'],
    }
    render(
      <TracePanel result={withGeoCaveat} onClose={() => {}} onSelectRule={() => {}} onOpenGeo={onOpenGeo} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /geo-базы/i }))
    expect(onOpenGeo).toHaveBeenCalled()
  })

  it('без caveat про geo кнопки нет', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} onOpenGeo={() => {}} />)
    expect(screen.queryByRole('button', { name: /geo-базы/i })).not.toBeInTheDocument()
  })
```

Дописать в `frontend/test/trace-bar.test.tsx`:

```tsx
  it('строка подписана — понятно, что это трассировка', () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByText(/куда пойдёт трафик/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `cd frontend && npx vitest run test/trace-panel.test.tsx test/trace-bar.test.tsx`
Expected: FAIL — кнопка «Geo-базы» и подпись не найдены.

- [ ] **Step 3: Реализация**

В `frontend/src/features/diagnostics/TracePanel.tsx` — проп и кнопка:

```tsx
export function TracePanel({
  result,
  onClose,
  onSelectRule,
  onOpenGeo,
}: {
  result: TraceResult
  onClose: () => void
  onSelectRule: (index: number) => void
  onOpenGeo?: () => void
}) {
```

Заменить блок caveats на вариант с кнопкой:

```tsx
      {result.caveats.length > 0 && (
        <ul className="trace-caveats">
          {result.caveats.map((text, i) => (
            <li key={i} className="field-warning">
              {text}
              {/* Сообщение о незагруженных базах без пути к решению — тупик */}
              {onOpenGeo && text.includes('Geo-базы не загружены') && (
                <Button variant="ghost" onClick={onOpenGeo}>
                  Geo-базы
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
```

В `frontend/src/features/diagnostics/TraceBar.tsx` — подпись перед полями:

```tsx
    <div className="trace-bar">
      <span className="trace-bar-title">Куда пойдёт трафик</span>
      <label className="trace-bar-label" htmlFor={addressId}>
```

Дописать в `frontend/src/shared/ui/tokens.css`:

```css
.trace-bar-title { font-size: var(--t-sm); color: var(--ink); white-space: nowrap; }
.trace-caveats .btn { margin-left: 6px; padding: 0 6px; }
```

- [ ] **Step 4: Запустить тесты**

Run: `cd frontend && npx vitest run test/trace-panel.test.tsx test/trace-bar.test.tsx`
Expected: PASS, 9 + 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/diagnostics frontend/src/shared/ui/tokens.css frontend/test/trace-panel.test.tsx frontend/test/trace-bar.test.tsx
git commit -m "feat(frontend): explain the tracer and offer geo dialog from caveat"
```

---

### Task 10: Сборка в `EditorPage` — geo-ответы, тумблер, диалог

**Files:**
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Test: `frontend/test/editor-logic.test.ts`

**Interfaces:**
- Изменение: `traceOf(config, target, geo)` — третий параметр `GeoAnswers | undefined`; при `undefined` подставляется «базы не загружены».
- Новое: тумблер «Трасса» в доке (`aria-pressed`), кнопка «Geo-базы» в топбаре, `GeoDataDialog`, запрос `useGeoMatch` по ключам из правил.

- [ ] **Step 1: Написать падающий тест**

Заменить в `frontend/test/editor-logic.test.ts` блок `describe('traceOf')` на:

```ts
describe('traceOf', () => {
  const config = {
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: {
      rules: [
        { domain: ['geosite:google'], outboundTag: 'direct' },
        { domain: ['domain:openai.com'], outboundTag: 'direct' },
      ],
    },
  } as unknown as XrayConfig

  it('без цели трассировки нет', () => {
    expect(traceOf(config, null, undefined)).toBeUndefined()
  })

  it('без валидного конфига трассировки нет', () => {
    expect(traceOf(undefined, { address: 'openai.com', port: 443, network: 'tcp' }, undefined)).toBeUndefined()
  })

  it('без geo-ответов geo-правила неизвестны', () => {
    const res = traceOf(config, { address: 'api.openai.com', port: 443, network: 'tcp' }, undefined)
    expect(res?.verdicts[0].state).toBe('unknown')
    expect(res?.winner?.ruleIndex).toBe(1)
  })

  it('с geo-ответами geo-правило получает точный вердикт', () => {
    const res = traceOf(
      config,
      { address: 'www.google.com', port: 443, network: 'tcp' },
      { loaded: true, answers: { 'geosite:google': true }, missing: [] },
    )
    expect(res?.verdicts[0].state).toBe('yes')
    expect(res?.winner?.ruleIndex).toBe(0)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/editor-logic.test.ts`
Expected: FAIL — `traceOf` принимает два аргумента, четвёртый тест не проходит.

- [ ] **Step 3: Реализация**

В `frontend/src/features/editor/EditorPage.tsx`:

```ts
// к импортам
import { geoKeysOf, traceRoute, validateXrayConfig, type GeoAnswers, type TraceResult, type TraceTarget, type XrayConfig } from '../../entities/xray'
import { useGeoMatch } from '../../shared/api'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
```

```ts
const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }

export function traceOf(
  config: XrayConfig | undefined,
  target: TraceTarget | null,
  geo: GeoAnswers | undefined,
): TraceResult | undefined {
  if (!config || !target) return undefined
  return traceRoute(config, target, geo ?? NO_GEO)
}
```

В `EditorInner` — состояние, запрос geo и вычисление:

```ts
  const [traceOpen, setTraceOpen] = useState(false)
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)

  // Спрашиваем базу только по тем ключам, что реально есть в правилах
  const geoKeys = useMemo(() => (parsedConfig ? geoKeysOf(parsedConfig) : []), [parsedConfig])
  const geoQuery = useGeoMatch(
    traceTarget ? { domain: traceTarget.address, ip: traceTarget.ip, keys: geoKeys } : null,
  )
  const trace = useMemo(
    () => traceOf(parsedConfig, traceTarget, geoQuery.data),
    [parsedConfig, traceTarget, geoQuery.data],
  )
```

В топбаре — кнопка рядом с «Настройки конфига»:

```tsx
        <Button variant="ghost" onClick={() => setGeoOpen(true)}>
          Geo-базы
        </Button>
```

`dockExtra` — тумблер плюс строка:

```tsx
                dockExtra={
                  <>
                    <Button
                      aria-pressed={traceOpen}
                      onClick={() => {
                        setTraceOpen((v) => !v)
                        if (traceOpen) setTraceTarget(null)
                      }}
                    >
                      Трасса
                    </Button>
                    {traceOpen && <TraceBar value={traceTarget} onChange={setTraceTarget} />}
                  </>
                }
```

Панель — с кнопкой к диалогу:

```tsx
            {trace && (
              <TracePanel
                result={trace}
                onClose={() => setTraceTarget(null)}
                onSelectRule={(index) => setSelectedNode(`rule:${index}`)}
                onOpenGeo={() => setGeoOpen(true)}
              />
            )}
```

Диалог — рядом с остальными, вне ветки вкладок:

```tsx
      <GeoDataDialog open={geoOpen} onClose={() => setGeoOpen(false)} />
```

При переходе на вкладку JSON, помимо `setTraceTarget(null)`, добавить `setTraceOpen(false)`.

- [ ] **Step 4: Запустить весь фронтовый набор и typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: PASS всё. Тесты `trace-bar` рендерят `TraceBar` напрямую и тумблера не касаются.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/EditorPage.tsx frontend/test/editor-logic.test.ts
git commit -m "feat(frontend): feed geo answers into tracing, gate it behind a toggle"
```

---

### Task 11: e2e и финальная верификация

**Files:**
- Modify: `frontend/e2e/mocks.ts`
- Modify: `frontend/e2e/trace.spec.ts`
- Create: `frontend/e2e/geo.spec.ts`

**Interfaces:**
- `mockApi` дополняется маршрутами `**/api/geo` и `**/api/tools/geo/match` — иначе новые запросы уйдут в пустоту и трассировка зависнет в загрузке.

- [ ] **Step 1: Добавить geo в моки**

В `frontend/e2e/mocks.ts` — внутрь `mockApi`, до общих маршрутов:

```ts
  await page.route('**/api/geo', (r) =>
    r.fulfill({
      json: {
        geosite: { url: 'https://example.test/dlc.dat', present: false },
        geoip: { url: 'https://example.test/geoip.dat', present: false },
      },
    }),
  )
  await page.route('**/api/tools/geo/match', (r) =>
    r.fulfill({ json: { loaded: false, answers: {}, missing: [] } }),
  )
```

- [ ] **Step 2: Обновить существующую спеку трассировки**

В `frontend/e2e/trace.spec.ts` каждый тест теперь должен сначала открыть трассировку. Добавить после `page.goto` во всех трёх тестах:

```ts
  await page.getByRole('button', { name: 'Трасса' }).click()
```

- [ ] **Step 3: Запустить e2e и убедиться, что трассировка снова работает**

Run: `npm run e2e -w frontend`
Expected: PASS. Если тесты трассировки падают на `getByLabel('Адрес')` — не добавлен клик по тумблеру.

- [ ] **Step 4: Написать e2e на geo**

Создать `frontend/e2e/geo.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('диалог geo-баз открывается из топбара и показывает, что базы не загружены', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Geo-базы' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('не загружена')
  await expect(dialog).toContainText('на нодах')
})

test('пресет Loyalsoldier подставляет ссылки', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Geo-базы' }).click()
  await page.getByRole('button', { name: 'Loyalsoldier' }).click()
  await expect(page.getByLabel('Ссылка на geosite')).toHaveValue(/Loyalsoldier/)
})

test('из caveat трассировки можно открыть диалог geo-баз', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Трасса' }).click()
  await page.getByLabel('Адрес').fill('api.openai.com')
  await expect(page.locator('.trace-panel')).toContainText('Geo-базы не загружены')
  await page.locator('.trace-caveats').getByRole('button', { name: 'Geo-базы' }).click()
  await expect(page.getByRole('dialog')).toContainText('не загружена')
})
```

Третьему тесту нужно geo-правило в конфиге, а в общем `CONFIG` его нет. Переопределяем профиль своим маршрутом после `mockApi` — так же, как в `trace.spec.ts`, не трогая общий мок. Добавить в начало файла:

```ts
import { CONFIG, PROFILE } from './mocks'

const GEO_CONFIG = {
  ...CONFIG,
  routing: { rules: [{ type: 'field', domain: ['geosite:openai'], outboundTag: 'block' }] },
}
```

и в `beforeEach`, после `mockApi(page)`:

```ts
  await page.route(`**/api/profiles/${UUID}`, (r) =>
    r.fulfill({ json: { profile: { ...PROFILE, config: GEO_CONFIG } } }),
  )
```

- [ ] **Step 5: Финальная верификация**

Run:
```bash
npm test
npm run typecheck -w backend
npm run typecheck -w frontend
npm run e2e -w frontend
npm run build
```
Expected: всё зелёное.

- [ ] **Step 6: Коммит**

```bash
git add frontend/e2e
git commit -m "test(frontend): e2e for geo dialog and gated tracer"
```

---

## Ручная проверка после реализации

Проверять на реальном профиле с geo-правилами (тот, на котором тестировался этап 1):

- [ ] Кнопка «Трасса» в доке — поля появляются только по нажатию, подпись объясняет назначение
- [ ] «Geo-базы» в топбаре открывает диалог; кнопка «Загрузить» скачивает обе базы, статус показывает число категорий и дату
- [ ] После загрузки трассировка `google.com:443` даёт точный вердикт по `geosite:`-правилам вместо «нет данных»
- [ ] Caveat про незагруженные базы предлагает открыть диалог
- [ ] Вердикт ip-правила при `IPIfNonMatch` больше не упоминает AsIs

## Что остаётся на этап 3

Проверка конфига ядром (`xray run -test`, бинарь v26.6.27 в образе, инжект фиктивного клиента) и проверка Reality-цели с ограничением на приватные адреса.

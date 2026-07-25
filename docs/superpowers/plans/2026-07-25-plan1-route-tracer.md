# Трассировщик маршрута — план реализации (этап 1 из 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать в редакторе, какое правило маршрутизации сработает первым для заданной цели и в какой outbound уйдёт трафик — с честным различением «совпало / не совпало / данных нет».

**Architecture:** Чистая функция `traceRoute(config, target, geo)` в `entities/xray` считает вердикт по каждому правилу сверху вниз; UI (`features/diagnostics`) вводит цель в доке графа, рисует разбор по правилам оверлеем и подсвечивает победивший путь. Geo-ответы на этом этапе всегда «не загружены» — интерфейс готов, наполнит его этап 2. Бэкенд не затрагивается.

**Tech Stack:** TypeScript, React 19, zustand (не используется здесь), vitest + @testing-library/react, Playwright, React Flow (@xyflow/react).

## Global Constraints

- Слоевая чистота: `entities` НЕ импортирует из `features`. Трассировщик живёт в `entities/xray`.
- Новых зависимостей не добавляем — ни на фронт, ни на бэк.
- Язык UI, подсказок и сообщений — русский. Коммиты — английский conventional style, скоуп `frontend`.
- Три состояния вердикта: `'yes' | 'no' | 'unknown'`. `unknown` НИКОГДА не подменяется догадкой.
- На этом этапе geo-аргумент всегда `{ loaded: false, answers: {}, missing: [] }` — сетевых запросов трассировщик не делает.
- Тесты: vitest только в `frontend/test/**/*.test.{ts,tsx}`, Playwright только в `frontend/e2e/*.spec.ts` (tsc каталог `e2e` не проверяет).
- Команды: `cd frontend && npx vitest run test/<file>` — один файл; `npm test -w frontend` — все; `npm run typecheck -w frontend`; `npm run e2e -w frontend`.
- `buildGraph` не получает знания о трассировке: вердикты прокидываются в `data` узлов внутри `TopologyView`.
- Кастомный `Select` в тестах управляется хелперами `selectOption`/`selectedValue` из `test/helpers.ts`, а не `userEvent.selectOptions`.

## Файловая структура

| Файл | Ответственность |
| --- | --- |
| `frontend/src/entities/xray/traceMatch.ts` (создать) | Типы трассировки и предикаты отдельных полей правила: домен, IP, порт, сеть, списки строк |
| `frontend/src/entities/xray/trace.ts` (создать) | `traceRoute`: И-семантика полей, выбор победителя, проходы по `domainStrategy`, caveats |
| `frontend/src/entities/xray/rules.ts` (изменить) | + `portMatches` рядом с существующим `portSpecError` (формат портов живёт в одном месте) |
| `frontend/src/entities/xray/config.ts` (изменить) | + проверка sniffing в `analyzeIntegrity` |
| `frontend/src/entities/xray/index.ts` (изменить) | Реэкспорт двух новых модулей |
| `frontend/src/entities/graph/types.ts` (изменить) | + `traceState` в `RuleNodeData` |
| `frontend/src/features/diagnostics/TraceBar.tsx` (создать) | Ввод цели трассировки (адрес, порт, сеть, IP назначения) |
| `frontend/src/features/diagnostics/TracePanel.tsx` (создать) | Разбор по правилам, победитель, caveats |
| `frontend/src/features/topology/nodes.tsx` (изменить) | Бейдж вердикта на узле правила |
| `frontend/src/features/topology/TopologyView.tsx` (изменить) | Проброс вердиктов в `data`, подсветка победившего пути, слот дока под `TraceBar` |
| `frontend/src/features/editor/EditorPage.tsx` (изменить) | Состояние цели трассировки, вызов `traceRoute`, рендер `TracePanel` |
| `frontend/src/shared/ui/tokens.css` (изменить) | Классы `.trace-*` и состояния бейджа вердикта |

---

### Task 1: Матчер доменов

**Files:**
- Create: `frontend/src/entities/xray/traceMatch.ts`
- Test: `frontend/test/trace-match.test.ts`

**Interfaces:**
- Consumes: `DOMAIN_PREFIXES` из `entities/xray/rules.ts` (существует).
- Produces:
  - `type MatchState = 'yes' | 'no' | 'unknown'`
  - `interface TraceTarget { address: string; port: number; network: 'tcp' | 'udp'; ip?: string; sourceIp?: string; sourcePort?: number; inboundTag?: string; user?: string; protocol?: string }`
  - `interface GeoAnswers { loaded: boolean; answers: Record<string, boolean>; missing: string[] }`
  - `interface FieldVerdict { field: string; state: MatchState; reason: string }`
  - `function matchDomainPattern(pattern: string, address: string, geo: GeoAnswers): MatchState`
  - `function matchDomainField(patterns: string[], address: string, geo: GeoAnswers): FieldVerdict`

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/trace-match.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchDomainField, matchDomainPattern, type GeoAnswers } from '../src/entities/xray/traceMatch'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const geo = (answers: Record<string, boolean>, missing: string[] = []): GeoAnswers => ({
  loaded: true,
  answers,
  missing,
})

describe('matchDomainPattern', () => {
  it('строка без префикса матчится как keyword-подстрока', () => {
    expect(matchDomainPattern('openai', 'api.openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('openai', 'example.com', NO_GEO)).toBe('no')
  })

  it('keyword: — та же подстрока', () => {
    expect(matchDomainPattern('keyword:penai', 'api.openai.com', NO_GEO)).toBe('yes')
  })

  it('domain: матчит сам домен и поддомены, но не похожее имя', () => {
    expect(matchDomainPattern('domain:openai.com', 'openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('domain:openai.com', 'api.openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('domain:openai.com', 'notopenai.com', NO_GEO)).toBe('no')
  })

  it('full: требует точного совпадения', () => {
    expect(matchDomainPattern('full:openai.com', 'openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('full:openai.com', 'api.openai.com', NO_GEO)).toBe('no')
  })

  it('regexp: применяет регулярное выражение, битое — unknown', () => {
    expect(matchDomainPattern('regexp:^api\\..*\\.com$', 'api.openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('regexp:^api', 'openai.com', NO_GEO)).toBe('no')
    expect(matchDomainPattern('regexp:[unclosed', 'openai.com', NO_GEO)).toBe('unknown')
  })

  it('geosite: без загруженной базы — unknown, с базой — ответ базы', () => {
    expect(matchDomainPattern('geosite:openai', 'openai.com', NO_GEO)).toBe('unknown')
    expect(matchDomainPattern('geosite:openai', 'openai.com', geo({ 'geosite:openai': true }))).toBe('yes')
    expect(matchDomainPattern('geosite:openai', 'openai.com', geo({ 'geosite:openai': false }))).toBe('no')
  })

  it('категория, которой нет в загруженной базе, — unknown (ядро такой конфиг отвергнет)', () => {
    expect(matchDomainPattern('geosite:nosuch', 'openai.com', geo({}, ['geosite:nosuch']))).toBe('unknown')
  })

  it('ext: всегда unknown — внешние файлы не читаем', () => {
    expect(matchDomainPattern('ext:geoip.dat:ru', 'openai.com', geo({}))).toBe('unknown')
  })
})

describe('matchDomainField', () => {
  it('ИЛИ по элементам: одно совпадение делает поле совпавшим', () => {
    const v = matchDomainField(['full:example.com', 'domain:openai.com'], 'api.openai.com', NO_GEO)
    expect(v.state).toBe('yes')
    expect(v.reason).toContain('domain:openai.com')
  })

  it('нет совпадений, но есть неизвестное — поле unknown', () => {
    const v = matchDomainField(['full:example.com', 'geosite:openai'], 'api.openai.com', NO_GEO)
    expect(v.state).toBe('unknown')
  })

  it('все элементы точно не совпали — поле no', () => {
    const v = matchDomainField(['full:example.com', 'domain:google.com'], 'api.openai.com', NO_GEO)
    expect(v.state).toBe('no')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/trace-match.test.ts`
Expected: FAIL — `Failed to resolve import "../src/entities/xray/traceMatch"`.

- [ ] **Step 3: Минимальная реализация**

Создать `frontend/src/entities/xray/traceMatch.ts`:

```ts
// Предикаты отдельных полей правила маршрутизации. Каждое поле отвечает на вопрос
// «совпала ли цель», и отвечает честно: 'unknown' там, где данных нет, а не догадкой.

export type MatchState = 'yes' | 'no' | 'unknown'

/** Цель трассировки — то, что пользователь хочет провести через правила */
export interface TraceTarget {
  address: string
  port: number
  network: 'tcp' | 'udp'
  /** IP назначения; сервер домены не резолвит, поле заполняет пользователь */
  ip?: string
  sourceIp?: string
  sourcePort?: number
  inboundTag?: string
  user?: string
  /** http|tls|quic|bittorrent — известен только если inbound снифает трафик */
  protocol?: string
}

/**
 * Ответы geo-базы. Три состояния ключа различаются намеренно: есть ответ;
 * база загружена, но категории в ней нет (`missing` — ошибка конфига, ядро такой
 * конфиг отвергнет); база не загружена (`loaded: false`).
 */
export interface GeoAnswers {
  loaded: boolean
  answers: Record<string, boolean>
  missing: string[]
}

export interface FieldVerdict {
  field: string
  state: MatchState
  reason: string
}

function geoState(key: string, geo: GeoAnswers): MatchState {
  if (!geo.loaded) return 'unknown'
  const answer = geo.answers[key]
  return answer === undefined ? 'unknown' : answer ? 'yes' : 'no'
}

export function matchDomainPattern(pattern: string, address: string, geo: GeoAnswers): MatchState {
  if (pattern.startsWith('full:')) return address === pattern.slice(5) ? 'yes' : 'no'
  if (pattern.startsWith('domain:')) {
    const base = pattern.slice(7)
    return address === base || address.endsWith(`.${base}`) ? 'yes' : 'no'
  }
  if (pattern.startsWith('keyword:')) return address.includes(pattern.slice(8)) ? 'yes' : 'no'
  if (pattern.startsWith('regexp:')) {
    try {
      return new RegExp(pattern.slice(7)).test(address) ? 'yes' : 'no'
    } catch {
      // Битое выражение — не наше дело угадывать, что имелось в виду
      return 'unknown'
    }
  }
  if (pattern.startsWith('geosite:')) {
    // Атрибут (geosite:google@ads) — часть ключа: база отвечает уже с его учётом
    return geoState(pattern, geo)
  }
  if (pattern.startsWith('ext:')) return 'unknown'
  // Строка без префикса матчится как keyword-подстрока
  return address.includes(pattern) ? 'yes' : 'no'
}

/** ИЛИ по значениям поля: 'yes' перевешивает, 'unknown' перевешивает 'no' */
export function aggregate(
  field: string,
  states: { value: string; state: MatchState }[],
  labels: { yes: (v: string) => string; unknown: string; no: string },
): FieldVerdict {
  const hit = states.find((s) => s.state === 'yes')
  if (hit) return { field, state: 'yes', reason: labels.yes(hit.value) }
  if (states.some((s) => s.state === 'unknown')) return { field, state: 'unknown', reason: labels.unknown }
  return { field, state: 'no', reason: labels.no }
}

export function matchDomainField(patterns: string[], address: string, geo: GeoAnswers): FieldVerdict {
  const states = patterns.map((value) => ({ value, state: matchDomainPattern(value, address, geo) }))
  return aggregate('domain', states, {
    yes: (v) => `домен подходит под «${v}»`,
    unknown: 'зависит от geo-списка или внешнего файла',
    no: 'ни один шаблон домена не подходит',
  })
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `cd frontend && npx vitest run test/trace-match.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/traceMatch.ts frontend/test/trace-match.test.ts
git commit -m "feat(frontend): domain matcher for route tracing"
```

---

### Task 2: Матчер IP и CIDR

**Files:**
- Modify: `frontend/src/entities/xray/traceMatch.ts`
- Test: `frontend/test/trace-match.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `FieldVerdict`, `GeoAnswers`, `aggregate` из Task 1.
- Produces:
  - `function isIpAddress(value: string): boolean`
  - `function ipInCidr(ip: string, cidr: string): boolean | null` — `null`, если адрес или CIDR не разобрались
  - `type IpAvailability = 'known' | 'unspecified' | 'never'`
  - `function matchIpField(field: string, patterns: string[], ip: string | undefined, availability: IpAvailability, geo: GeoAnswers): FieldVerdict`

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/trace-match.test.ts`:

```ts
import { ipInCidr, isIpAddress, matchIpField } from '../src/entities/xray/traceMatch'

describe('isIpAddress', () => {
  it('различает IP и домен', () => {
    expect(isIpAddress('1.2.3.4')).toBe(true)
    expect(isIpAddress('2001:db8::1')).toBe(true)
    expect(isIpAddress('openai.com')).toBe(false)
    expect(isIpAddress('1.2.3.4.5')).toBe(false)
  })
})

describe('ipInCidr', () => {
  it('IPv4: попадание и промах', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.0/8')).toBe(true)
    expect(ipInCidr('11.0.0.5', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('10.0.0.5', '10.0.0.5')).toBe(true)
    expect(ipInCidr('10.0.0.6', '10.0.0.5')).toBe(false)
  })

  it('IPv4: граница префикса считается точно', () => {
    expect(ipInCidr('192.168.1.255', '192.168.1.0/24')).toBe(true)
    expect(ipInCidr('192.168.2.0', '192.168.1.0/24')).toBe(false)
  })

  it('IPv6: сокращённая запись и префикс', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true)
    expect(ipInCidr('2001:dba::1', '2001:db8::/32')).toBe(false)
    expect(ipInCidr('::1', '::1/128')).toBe(true)
  })

  it('версии не смешиваются, мусор даёт null', () => {
    expect(ipInCidr('1.2.3.4', '2001:db8::/32')).toBe(false)
    expect(ipInCidr('не-адрес', '10.0.0.0/8')).toBe(null)
    expect(ipInCidr('10.0.0.1', 'мусор/8')).toBe(null)
  })
})

describe('matchIpField', () => {
  it('IP известен: CIDR и geoip считаются', () => {
    expect(matchIpField('ip', ['10.0.0.0/8'], '10.1.2.3', 'known', NO_GEO).state).toBe('yes')
    expect(matchIpField('ip', ['geoip:ru'], '10.1.2.3', 'known', geo({ 'geoip:ru': true })).state).toBe('yes')
  })

  it('инверсия geoip:!cc переворачивает ответ базы', () => {
    expect(matchIpField('ip', ['geoip:!ru'], '1.2.3.4', 'known', geo({ 'geoip:ru': true })).state).toBe('no')
    expect(matchIpField('ip', ['geoip:!ru'], '1.2.3.4', 'known', geo({ 'geoip:ru': false })).state).toBe('yes')
  })

  it('IP не указан — unknown с просьбой указать адрес', () => {
    const v = matchIpField('ip', ['10.0.0.0/8'], undefined, 'unspecified', NO_GEO)
    expect(v.state).toBe('unknown')
    expect(v.reason).toContain('IP назначения')
  })

  it('стратегия AsIs — ip-правила по доменной цели не применяются вовсе', () => {
    const v = matchIpField('ip', ['10.0.0.0/8'], undefined, 'never', NO_GEO)
    expect(v.state).toBe('no')
    expect(v.reason).toContain('AsIs')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/trace-match.test.ts`
Expected: FAIL — `matchIpField is not a function` (и остальные новые импорты).

- [ ] **Step 3: Минимальная реализация**

Дописать в `frontend/src/entities/xray/traceMatch.ts`:

```ts
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Адрес в виде числа и размера в битах — чтобы сравнивать v4 и v6 одним кодом */
function parseIp(value: string): { bits: bigint; size: 32 | 128 } | null {
  const v4 = IPV4_RE.exec(value)
  if (v4) {
    let bits = 0n
    for (let i = 1; i <= 4; i += 1) {
      const octet = Number(v4[i])
      if (octet > 255) return null
      bits = (bits << 8n) | BigInt(octet)
    }
    return { bits, size: 32 }
  }
  if (!value.includes(':')) return null
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : []
  const groups = halves.length === 2 ? 8 - head.length - tail.length : 8 - head.length
  if (groups < 0 || (halves.length === 1 && groups !== 0)) return null
  const parts = [...head, ...Array(groups).fill('0'), ...tail]
  let bits = 0n
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null
    bits = (bits << 16n) | BigInt(parseInt(part, 16))
  }
  return { bits, size: 128 }
}

export function isIpAddress(value: string): boolean {
  return parseIp(value) !== null
}

/** null — адрес или CIDR не разобрались; сравнивать нечего */
export function ipInCidr(ip: string, cidr: string): boolean | null {
  const [net, prefixText] = cidr.split('/')
  const a = parseIp(ip)
  const b = parseIp(net)
  if (!a || !b) return null
  if (a.size !== b.size) return false
  const prefix = prefixText === undefined ? a.size : Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > a.size) return null
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(a.size - prefix)
  return (a.bits & mask) === (b.bits & mask)
}

/** Доступность IP назначения: известен / не указан / ядро его вообще не узнает */
export type IpAvailability = 'known' | 'unspecified' | 'never'

function matchIpPattern(pattern: string, ip: string, geo: GeoAnswers): MatchState {
  if (pattern.startsWith('geoip:')) {
    const body = pattern.slice(6)
    const negated = body.startsWith('!')
    const state = geoState(`geoip:${negated ? body.slice(1) : body}`, geo)
    if (state === 'unknown') return 'unknown'
    return negated ? (state === 'yes' ? 'no' : 'yes') : state
  }
  if (pattern.startsWith('ext:')) return 'unknown'
  const hit = ipInCidr(ip, pattern)
  return hit === null ? 'unknown' : hit ? 'yes' : 'no'
}

export function matchIpField(
  field: string,
  patterns: string[],
  ip: string | undefined,
  availability: IpAvailability,
  geo: GeoAnswers,
): FieldVerdict {
  if (availability === 'never') {
    return {
      field,
      state: 'no',
      reason: 'стратегия домена AsIs: ядро не резолвит домен, поэтому ip-условия не применяются',
    }
  }
  if (availability === 'unspecified' || ip === undefined) {
    return { field, state: 'unknown', reason: 'укажите IP назначения, чтобы проверить ip-условия' }
  }
  const states = patterns.map((value) => ({ value, state: matchIpPattern(value, ip, geo) }))
  return aggregate(field, states, {
    yes: (v) => `адрес подходит под «${v}»`,
    unknown: 'зависит от geo-списка или внешнего файла',
    no: 'ни одна подсеть не подходит',
  })
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `cd frontend && npx vitest run test/trace-match.test.ts`
Expected: PASS, 19 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/traceMatch.ts frontend/test/trace-match.test.ts
git commit -m "feat(frontend): ip and cidr matcher for route tracing"
```

---

### Task 3: Матчеры порта, сети и списков строк

**Files:**
- Modify: `frontend/src/entities/xray/rules.ts`
- Modify: `frontend/src/entities/xray/traceMatch.ts`
- Test: `frontend/test/xray-rules.test.ts`, `frontend/test/trace-match.test.ts`

**Interfaces:**
- Consumes: `aggregate`, `FieldVerdict`, `MatchState` из Task 1.
- Produces:
  - `function portMatches(spec: string | number | undefined, port: number): boolean` (в `rules.ts`, рядом с `portSpecError` — формат портов описан в одном месте)
  - `function matchPortField(field: string, spec: string | number, port: number | undefined): FieldVerdict`
  - `function matchNetworkField(spec: string, network: string): FieldVerdict`
  - `function matchExactField(field: string, patterns: string[], value: string | undefined, hint: string): FieldVerdict`

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/xray-rules.test.ts`:

```ts
import { portMatches } from '../src/entities/xray/rules'

describe('portMatches', () => {
  it('одиночный порт, диапазон и список', () => {
    expect(portMatches(443, 443)).toBe(true)
    expect(portMatches('443', 443)).toBe(true)
    expect(portMatches('1000-2000', 1500)).toBe(true)
    expect(portMatches('1000-2000', 2001)).toBe(false)
    expect(portMatches('80,443,8000-9000', 8080)).toBe(true)
    expect(portMatches('80,443', 8080)).toBe(false)
  })

  it('границы диапазона включаются', () => {
    expect(portMatches('1000-2000', 1000)).toBe(true)
    expect(portMatches('1000-2000', 2000)).toBe(true)
  })

  it('без спецификации порт не ограничен', () => {
    expect(portMatches(undefined, 443)).toBe(true)
  })
})
```

Дописать в `frontend/test/trace-match.test.ts`:

```ts
import { matchExactField, matchNetworkField, matchPortField } from '../src/entities/xray/traceMatch'

describe('matchPortField', () => {
  it('совпадение и промах', () => {
    expect(matchPortField('port', '443', 443).state).toBe('yes')
    expect(matchPortField('port', '443', 80).state).toBe('no')
  })

  it('порт цели не задан — unknown', () => {
    expect(matchPortField('sourcePort', '443', undefined).state).toBe('unknown')
  })

  it('битая спецификация — unknown, а не ложный промах', () => {
    const v = matchPortField('port', 'мусор', 443)
    expect(v.state).toBe('unknown')
    expect(v.reason).toContain('формат')
  })
})

describe('matchNetworkField', () => {
  it('одиночная сеть и список', () => {
    expect(matchNetworkField('tcp', 'tcp').state).toBe('yes')
    expect(matchNetworkField('tcp', 'udp').state).toBe('no')
    expect(matchNetworkField('tcp,udp', 'udp').state).toBe('yes')
    expect(matchNetworkField(' tcp , udp ', 'udp').state).toBe('yes')
  })
})

describe('matchExactField', () => {
  it('точное совпадение по списку значений', () => {
    expect(matchExactField('user', ['a@b'], 'a@b', 'подсказка').state).toBe('yes')
    expect(matchExactField('user', ['a@b'], 'c@d', 'подсказка').state).toBe('no')
  })

  it('значение цели неизвестно — unknown с подсказкой почему', () => {
    const v = matchExactField('protocol', ['tls'], undefined, 'протокол определяется sniffing’ом')
    expect(v.state).toBe('unknown')
    expect(v.reason).toContain('sniffing')
  })
})
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `cd frontend && npx vitest run test/xray-rules.test.ts test/trace-match.test.ts`
Expected: FAIL — `portMatches is not a function`, `matchPortField is not a function`.

- [ ] **Step 3: Минимальная реализация**

Дописать в `frontend/src/entities/xray/rules.ts`:

```ts
/** Совпадает ли порт со спецификацией правила. Формат тот же, что проверяет portSpecError. */
export function portMatches(spec: string | number | undefined, port: number): boolean {
  if (spec === undefined) return true
  for (const part of String(spec).split(',').map((s) => s.trim())) {
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part)
    if (!m) continue
    const lo = Number(m[1])
    const hi = m[2] === undefined ? lo : Number(m[2])
    if (port >= lo && port <= hi) return true
  }
  return false
}
```

Дописать в `frontend/src/entities/xray/traceMatch.ts` (импорт добавить к началу файла):

```ts
import { portMatches, portSpecError } from './rules'

export function matchPortField(
  field: string,
  spec: string | number,
  port: number | undefined,
): FieldVerdict {
  const formatError = portSpecError(spec)
  if (formatError) return { field, state: 'unknown', reason: `непонятный формат портов: ${formatError}` }
  if (port === undefined) return { field, state: 'unknown', reason: 'порт цели не задан' }
  return portMatches(spec, port)
    ? { field, state: 'yes', reason: `порт ${port} входит в «${spec}»` }
    : { field, state: 'no', reason: `порт ${port} не входит в «${spec}»` }
}

export function matchNetworkField(spec: string, network: string): FieldVerdict {
  const allowed = spec.split(',').map((s) => s.trim()).filter(Boolean)
  return allowed.includes(network)
    ? { field: 'network', state: 'yes', reason: `сеть ${network} разрешена` }
    : { field: 'network', state: 'no', reason: `правило только для «${spec}»` }
}

/** Точное совпадение по списку (user, inboundTag, protocol) */
export function matchExactField(
  field: string,
  patterns: string[],
  value: string | undefined,
  hint: string,
): FieldVerdict {
  if (value === undefined) return { field, state: 'unknown', reason: hint }
  return patterns.includes(value)
    ? { field, state: 'yes', reason: `«${value}» есть в списке` }
    : { field, state: 'no', reason: `«${value}» не входит в список` }
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `cd frontend && npx vitest run test/xray-rules.test.ts test/trace-match.test.ts`
Expected: PASS — оба файла, включая ранее написанные тесты.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/rules.ts frontend/src/entities/xray/traceMatch.ts frontend/test/xray-rules.test.ts frontend/test/trace-match.test.ts
git commit -m "feat(frontend): port, network and exact-list matchers for route tracing"
```

---

### Task 4: `traceRoute` — И-семантика полей и выбор победителя

**Files:**
- Create: `frontend/src/entities/xray/trace.ts`
- Modify: `frontend/src/entities/xray/index.ts`
- Test: `frontend/test/trace.test.ts`

**Interfaces:**
- Consumes: всё из `traceMatch.ts` (Task 1–3), `XrayConfig` из `entities/xray/config.ts`.
- Produces:
  - `interface RuleVerdict { index: number; state: MatchState; outboundTag?: string; balancerTag?: string; fields: FieldVerdict[] }`
  - `interface TraceWinner { ruleIndex: number | null; outboundTag?: string; balancerTag?: string }`
  - `interface TraceResult { verdicts: RuleVerdict[]; ipVerdicts?: RuleVerdict[]; winner?: TraceWinner; caveats: string[] }`
  - `function traceRoute(config: XrayConfig, target: TraceTarget, geo: GeoAnswers): TraceResult`

В этой задаче реализуется только один проход (поведение `AsIs`); `domainStrategy` и caveats — Task 5.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { traceRoute } from '../src/entities/xray/trace'
import type { GeoAnswers, TraceTarget } from '../src/entities/xray/traceMatch'
import type { XrayConfig } from '../src/entities/xray'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const TARGET: TraceTarget = { address: 'api.openai.com', port: 443, network: 'tcp' }

function config(rules: unknown[], outbounds = ['direct', 'warp']): XrayConfig {
  return {
    outbounds: outbounds.map((tag) => ({ tag, protocol: 'freedom' })),
    routing: { rules },
  } as XrayConfig
}

describe('traceRoute: выбор победителя', () => {
  it('побеждает первое совпавшее правило, остальные не влияют', () => {
    const res = traceRoute(
      config([
        { domain: ['domain:google.com'], outboundTag: 'warp' },
        { domain: ['domain:openai.com'], outboundTag: 'warp' },
        { outboundTag: 'direct' },
      ]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts.map((v) => v.state)).toEqual(['no', 'yes', 'yes'])
    expect(res.winner).toEqual({ ruleIndex: 1, outboundTag: 'warp', balancerTag: undefined })
  })

  it('правило без условий совпадает со всем', () => {
    const res = traceRoute(config([{ outboundTag: 'direct' }]), TARGET, NO_GEO)
    expect(res.verdicts[0].state).toBe('yes')
  })

  it('поля соединяются через И — один промах убивает правило', () => {
    const res = traceRoute(
      config([{ domain: ['domain:openai.com'], port: '80', outboundTag: 'warp' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('no')
    expect(res.verdicts[0].fields.map((f) => [f.field, f.state])).toEqual([
      ['domain', 'yes'],
      ['port', 'no'],
    ])
  })

  it('точный промах перевешивает неизвестное (поля через И)', () => {
    const res = traceRoute(
      config([{ domain: ['geosite:openai'], port: '80', outboundTag: 'warp' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('no')
  })

  it('все заданные поля совпали, но одно неизвестно — правило unknown и победителем не становится', () => {
    const res = traceRoute(
      config([
        { domain: ['geosite:openai'], outboundTag: 'warp' },
        { outboundTag: 'direct' },
      ]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('unknown')
    expect(res.winner?.ruleIndex).toBe(1)
  })

  it('ни одно правило не совпало — трафик уходит в первый outbound', () => {
    const res = traceRoute(config([{ domain: ['domain:google.com'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: null, outboundTag: 'direct', balancerTag: undefined })
  })

  it('правил нет вовсе — тоже первый outbound', () => {
    const res = traceRoute(config([]), TARGET, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: null, outboundTag: 'direct', balancerTag: undefined })
  })

  it('outbound-ов нет — победителя нет', () => {
    const res = traceRoute(config([], []), TARGET, NO_GEO)
    expect(res.winner).toBeUndefined()
  })

  it('победившее правило через balancerTag отдаёт балансер, а не outbound', () => {
    const res = traceRoute(config([{ balancerTag: 'bal', domain: ['domain:openai.com'] }]), TARGET, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 0, outboundTag: undefined, balancerTag: 'bal' })
  })

  it('inboundTag цели учитывается, если задан', () => {
    const res = traceRoute(
      config([{ inboundTag: ['vless-in'], outboundTag: 'warp' }]),
      { ...TARGET, inboundTag: 'other-in' },
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('no')
  })

  it('protocol без sniffing-данных даёт unknown с внятной причиной', () => {
    const res = traceRoute(config([{ protocol: ['tls'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.verdicts[0].state).toBe('unknown')
    expect(res.verdicts[0].fields[0].reason).toContain('sniffing')
  })

  it('ip-условие по доменной цели при стратегии по умолчанию не применяется', () => {
    const res = traceRoute(config([{ ip: ['10.0.0.0/8'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.verdicts[0].state).toBe('no')
    expect(res.verdicts[0].fields[0].reason).toContain('AsIs')
  })

  it('цель-IP сравнивается с ip-условиями без всякого резолва', () => {
    const res = traceRoute(
      config([{ ip: ['10.0.0.0/8'], outboundTag: 'warp' }]),
      { address: '10.1.2.3', port: 443, network: 'tcp' },
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('yes')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/trace.test.ts`
Expected: FAIL — `Failed to resolve import "../src/entities/xray/trace"`.

- [ ] **Step 3: Минимальная реализация**

Создать `frontend/src/entities/xray/trace.ts`:

```ts
// Куда уйдёт трафик: правила проверяются сверху вниз, побеждает первое полностью
// совпавшее. Поля внутри правила соединяются через И, значения внутри поля — через ИЛИ.

import type { XrayConfig } from './config'
import {
  isIpAddress,
  matchDomainField,
  matchExactField,
  matchIpField,
  matchNetworkField,
  matchPortField,
  type FieldVerdict,
  type GeoAnswers,
  type IpAvailability,
  type MatchState,
  type TraceTarget,
} from './traceMatch'

export interface RuleVerdict {
  index: number
  state: MatchState
  outboundTag?: string
  balancerTag?: string
  fields: FieldVerdict[]
}

export interface TraceWinner {
  /** null — ни одно правило не совпало, сработал дефолт (первый outbound) */
  ruleIndex: number | null
  outboundTag?: string
  balancerTag?: string
}

export interface TraceResult {
  verdicts: RuleVerdict[]
  ipVerdicts?: RuleVerdict[]
  winner?: TraceWinner
  caveats: string[]
}

type Rule = {
  domain?: string[]
  ip?: string[]
  port?: string | number
  sourcePort?: string | number
  network?: string
  protocol?: string[]
  user?: string[]
  source?: string[]
  inboundTag?: string[]
  outboundTag?: string
  balancerTag?: string
}

/** Правило совпало, если совпали ВСЕ заданные поля; точный промах перевешивает неизвестное */
function combine(fields: FieldVerdict[]): MatchState {
  if (fields.some((f) => f.state === 'no')) return 'no'
  if (fields.some((f) => f.state === 'unknown')) return 'unknown'
  return 'yes'
}

function judgeRule(
  rule: Rule,
  index: number,
  target: TraceTarget,
  geo: GeoAnswers,
  ipAvailability: IpAvailability,
): RuleVerdict {
  const fields: FieldVerdict[] = []
  if (rule.domain?.length) fields.push(matchDomainField(rule.domain, target.address, geo))
  if (rule.ip?.length) fields.push(matchIpField('ip', rule.ip, target.ip, ipAvailability, geo))
  if (rule.port !== undefined) fields.push(matchPortField('port', rule.port, target.port))
  if (rule.network !== undefined) fields.push(matchNetworkField(rule.network, target.network))
  if (rule.source?.length) {
    fields.push(
      matchIpField('source', rule.source, target.sourceIp, target.sourceIp ? 'known' : 'unspecified', geo),
    )
  }
  if (rule.sourcePort !== undefined) {
    fields.push(matchPortField('sourcePort', rule.sourcePort, target.sourcePort))
  }
  if (rule.protocol?.length) {
    fields.push(
      matchExactField(
        'protocol',
        rule.protocol,
        target.protocol,
        'протокол виден только при включённом sniffing — задайте его в цели',
      ),
    )
  }
  if (rule.user?.length) {
    fields.push(matchExactField('user', rule.user, target.user, 'пользователь цели не задан'))
  }
  if (rule.inboundTag?.length) {
    fields.push(matchExactField('inboundTag', rule.inboundTag, target.inboundTag, 'inbound цели не задан'))
  }

  return {
    index,
    state: combine(fields),
    outboundTag: rule.outboundTag,
    balancerTag: rule.balancerTag,
    fields,
  }
}

function judgeAll(
  config: XrayConfig,
  target: TraceTarget,
  geo: GeoAnswers,
  ipAvailability: IpAvailability,
): RuleVerdict[] {
  const rules = (config.routing?.rules ?? []) as Rule[]
  return rules.map((rule, index) => judgeRule(rule, index, target, geo, ipAvailability))
}

function pickWinner(verdicts: RuleVerdict[], config: XrayConfig): TraceWinner | undefined {
  const hit = verdicts.find((v) => v.state === 'yes')
  if (hit) {
    return { ruleIndex: hit.index, outboundTag: hit.outboundTag, balancerTag: hit.balancerTag }
  }
  // Ни одно правило не совпало — ядро отправляет трафик в первый outbound
  const fallback = config.outbounds?.[0]?.tag
  if (fallback === undefined) return undefined
  return { ruleIndex: null, outboundTag: fallback, balancerTag: undefined }
}

export function traceRoute(config: XrayConfig, target: TraceTarget, geo: GeoAnswers): TraceResult {
  // Цель-IP не требует резолва; для доменной цели ip-условия при AsIs не применяются
  const ipAvailability: IpAvailability = isIpAddress(target.address)
    ? 'known'
    : target.ip !== undefined
      ? 'known'
      : 'never'
  const effectiveTarget: TraceTarget =
    isIpAddress(target.address) && target.ip === undefined ? { ...target, ip: target.address } : target

  const verdicts = judgeAll(config, effectiveTarget, geo, ipAvailability)
  return { verdicts, winner: pickWinner(verdicts, config), caveats: [] }
}
```

Дописать в `frontend/src/entities/xray/index.ts` (после строки `export * from './rules'`):

```ts
export * from './traceMatch'
export * from './trace'
```

- [ ] **Step 4: Запустить тесты и typecheck**

Run: `cd frontend && npx vitest run test/trace.test.ts && npm run typecheck`
Expected: PASS, 13 тестов; typecheck без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/trace.ts frontend/src/entities/xray/index.ts frontend/test/trace.test.ts
git commit -m "feat(frontend): traceRoute picks the winning routing rule"
```

---

### Task 5: `domainStrategy`, второй проход и caveats

**Files:**
- Modify: `frontend/src/entities/xray/trace.ts`
- Test: `frontend/test/trace.test.ts`

**Interfaces:**
- Consumes: `traceRoute`, `RuleVerdict` из Task 4; `config.inbounds[].sniffing` (`SniffingSchema`: `enabled`, `destOverride`, `routeOnly`, `metadataOnly`).
- Produces: `TraceResult.ipVerdicts` заполняется при `IPIfNonMatch`; `TraceResult.caveats` — массив строк-предупреждений; `function geoKeysOf(config: XrayConfig): string[]` — список geo-ключей из правил (этап 2 будет спрашивать по ним бэкенд).

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/trace.test.ts`:

```ts
describe('traceRoute: стратегия домена', () => {
  const ipRule = [{ ip: ['10.0.0.0/8'], outboundTag: 'warp' }]

  it('IPIfNonMatch: второй проход по указанному IP находит победителя', () => {
    const cfg = { ...config(ipRule), routing: { domainStrategy: 'IPIfNonMatch', rules: ipRule } } as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, ip: '10.1.2.3' }, NO_GEO)
    expect(res.verdicts[0].state).toBe('no')
    expect(res.ipVerdicts?.[0].state).toBe('yes')
    expect(res.winner).toEqual({ ruleIndex: 0, outboundTag: 'warp', balancerTag: undefined })
  })

  it('IPIfNonMatch без указанного IP: второго прохода нет, но есть caveat', () => {
    const cfg = { ...config(ipRule), routing: { domainStrategy: 'IPIfNonMatch', rules: ipRule } } as XrayConfig
    const res = traceRoute(cfg, TARGET, NO_GEO)
    expect(res.ipVerdicts).toBeUndefined()
    expect(res.caveats.join(' ')).toContain('IP назначения')
  })

  it('IPOnDemand: ip-условия считаются сразу, одним проходом', () => {
    const cfg = { ...config(ipRule), routing: { domainStrategy: 'IPOnDemand', rules: ipRule } } as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, ip: '10.1.2.3' }, NO_GEO)
    expect(res.verdicts[0].state).toBe('yes')
    expect(res.ipVerdicts).toBeUndefined()
  })

  it('второго прохода нет, если победитель нашёлся на первом', () => {
    const rules = [{ domain: ['domain:openai.com'], outboundTag: 'warp' }, ...ipRule]
    const cfg = { ...config(rules), routing: { domainStrategy: 'IPIfNonMatch', rules } } as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, ip: '10.1.2.3' }, NO_GEO)
    expect(res.ipVerdicts).toBeUndefined()
  })
})

describe('traceRoute: caveats', () => {
  it('неизвестное правило выше победителя — предупреждение с его номером', () => {
    const res = traceRoute(
      config([{ domain: ['geosite:openai'], outboundTag: 'warp' }, { outboundTag: 'direct' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.caveats.join(' ')).toContain('#1')
    expect(res.caveats.join(' ')).toContain('может отличаться')
  })

  it('неизвестное правило НИЖЕ победителя не мешает — предупреждения нет', () => {
    const res = traceRoute(
      config([{ outboundTag: 'direct' }, { domain: ['geosite:openai'], outboundTag: 'warp' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.caveats.join(' ')).not.toContain('может отличаться')
  })

  it('geo-базы не загружены, а geo-условия есть — отдельное предупреждение', () => {
    const res = traceRoute(config([{ domain: ['geosite:openai'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.caveats.join(' ')).toContain('geo-базы не загружены')
  })

  it('категории нет в загруженной базе — предупреждение, что ядро отвергнет конфиг', () => {
    const geo: GeoAnswers = { loaded: true, answers: {}, missing: ['geosite:nosuch'] }
    const res = traceRoute(config([{ domain: ['geosite:nosuch'], outboundTag: 'warp' }]), TARGET, geo)
    expect(res.caveats.join(' ')).toContain('geosite:nosuch')
    expect(res.caveats.join(' ')).toContain('отвергнет')
  })

  it('правило матчит домен, а на inbound цели sniffing выключен — предупреждение', () => {
    const cfg = {
      inbounds: [{ tag: 'vless-in', protocol: 'vless', sniffing: { enabled: false } }],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ domain: ['domain:openai.com'], outboundTag: 'direct' }] },
    } as unknown as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, inboundTag: 'vless-in' }, NO_GEO)
    expect(res.caveats.join(' ')).toContain('sniffing')
  })

  it('sniffing включён с destOverride — предупреждения нет', () => {
    const cfg = {
      inbounds: [{ tag: 'vless-in', protocol: 'vless', sniffing: { enabled: true, destOverride: ['tls'] } }],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ domain: ['domain:openai.com'], outboundTag: 'direct' }] },
    } as unknown as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, inboundTag: 'vless-in' }, NO_GEO)
    expect(res.caveats.join(' ')).not.toContain('sniffing')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/trace.test.ts`
Expected: FAIL — `expected undefined to be 'yes'` (нет `ipVerdicts`) и пустые `caveats`.

- [ ] **Step 3: Реализация**

Заменить в `frontend/src/entities/xray/trace.ts` функцию `traceRoute` и дописать перед ней сбор caveats:

```ts
/** Все geo-ключи, встречающиеся в правилах. Экспортируется: этап 2 спросит по ним бэкенд. */
export function geoKeysOf(config: XrayConfig): string[] {
  const rules = (config.routing?.rules ?? []) as Rule[]
  const keys: string[] = []
  for (const rule of rules) {
    for (const value of rule.domain ?? []) if (value.startsWith('geosite:')) keys.push(value)
    for (const value of [...(rule.ip ?? []), ...(rule.source ?? [])]) {
      if (value.startsWith('geoip:')) keys.push(value)
    }
  }
  return keys
}

/** Снифер выключен или ничего не переопределяет — домена и протокола ядро не увидит */
function sniffingBlind(config: XrayConfig, inboundTag: string | undefined): boolean {
  if (inboundTag === undefined) return false
  const inbound = (config.inbounds ?? []).find((i) => i.tag === inboundTag)
  if (!inbound) return false
  const sniffing = inbound.sniffing as { enabled?: boolean; destOverride?: string[] } | undefined
  return sniffing?.enabled !== true || (sniffing.destOverride?.length ?? 0) === 0
}

function collectCaveats(
  config: XrayConfig,
  target: TraceTarget,
  geo: GeoAnswers,
  verdicts: RuleVerdict[],
  winner: TraceWinner | undefined,
  strategy: string,
): string[] {
  const caveats: string[] = []

  const winnerIndex = winner?.ruleIndex ?? verdicts.length
  const unknownAbove = verdicts.filter((v) => v.state === 'unknown' && v.index < winnerIndex)
  if (unknownAbove.length > 0) {
    const numbers = unknownAbove.map((v) => `#${v.index + 1}`).join(', ')
    caveats.push(
      `Правила ${numbers} зависят от данных, которых нет, и стоят выше победителя — реальный маршрут может отличаться.`,
    )
  }

  const geoKeys = geoKeysOf(config)
  if (geoKeys.length > 0 && !geo.loaded) {
    caveats.push('Geo-базы не загружены: вердикты по geosite:/geoip: неизвестны.')
  }
  for (const key of geo.missing) {
    caveats.push(`Категории «${key}» нет в загруженной базе — ядро отвергнет такой конфиг.`)
  }

  const needsSniffing = verdicts.some((v) =>
    v.fields.some((f) => f.field === 'domain' || f.field === 'protocol'),
  )
  if (needsSniffing && sniffingBlind(config, target.inboundTag)) {
    caveats.push(
      `На inbound «${target.inboundTag}» выключен sniffing — ядро не увидит домен и протокол, условия по ним не сработают.`,
    )
  }

  if (strategy === 'IPIfNonMatch' && target.ip === undefined && !isIpAddress(target.address)) {
    caveats.push(
      'Стратегия IPIfNonMatch делает второй проход по разрешённому адресу — укажите IP назначения, чтобы увидеть его.',
    )
  }

  return caveats
}

export function traceRoute(config: XrayConfig, target: TraceTarget, geo: GeoAnswers): TraceResult {
  const strategy = config.routing?.domainStrategy ?? 'AsIs'
  const targetIsIp = isIpAddress(target.address)
  const effectiveTarget: TraceTarget =
    targetIsIp && target.ip === undefined ? { ...target, ip: target.address } : target

  // AsIs: ядро не резолвит домен, ip-условия по доменной цели не применяются.
  // IPOnDemand: резолв происходит на первом же ip-условии, поэтому адрес доступен сразу.
  const firstPassIp: IpAvailability =
    targetIsIp || strategy === 'IPOnDemand'
      ? effectiveTarget.ip === undefined
        ? 'unspecified'
        : 'known'
      : 'never'

  const verdicts = judgeAll(config, effectiveTarget, geo, firstPassIp)
  let winner = pickWinner(verdicts, config)
  let ipVerdicts: RuleVerdict[] | undefined

  // IPIfNonMatch: если по домену никто не совпал — повторяем проход по адресу
  const noRuleMatched = !verdicts.some((v) => v.state === 'yes')
  if (strategy === 'IPIfNonMatch' && noRuleMatched && effectiveTarget.ip !== undefined) {
    ipVerdicts = judgeAll(config, effectiveTarget, geo, 'known')
    winner = pickWinner(ipVerdicts, config)
  }

  const caveats = collectCaveats(
    config,
    effectiveTarget,
    geo,
    ipVerdicts ?? verdicts,
    winner,
    strategy,
  )
  return { verdicts, ipVerdicts, winner, caveats }
}
```

- [ ] **Step 4: Запустить тесты и typecheck**

Run: `cd frontend && npx vitest run test/trace.test.ts && npm run typecheck`
Expected: PASS, 22 теста; typecheck без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/trace.ts frontend/test/trace.test.ts
git commit -m "feat(frontend): domainStrategy passes and caveats in route tracing"
```

---

### Task 6: Предупреждение о выключенном sniffing в `analyzeIntegrity`

**Files:**
- Modify: `frontend/src/entities/xray/config.ts`
- Test: `frontend/test/xray-config.test.ts`

**Interfaces:**
- Consumes: `ValidationIssue` (существует в `config.ts`).
- Produces: новые issue уровня `warning` с путём `routing.rules.<i>.domain` / `routing.rules.<i>.protocol`.

Проверка независима от трассировки: правило матчит по домену или протоколу, а inbound, к которому оно применяется, не снифает — значит правило не сработает никогда.

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/xray-config.test.ts`:

```ts
describe('analyzeIntegrity: sniffing и доменные правила', () => {
  const base = (inbounds: unknown[], rules: unknown[]) =>
    ({
      inbounds,
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules },
    }) as unknown as XrayConfig

  it('правило по домену на inbound без sniffing — warning с тегом inbound', () => {
    const issues = analyzeIntegrity(
      base(
        [{ tag: 'vless-in', protocol: 'vless', sniffing: { enabled: false } }],
        [{ inboundTag: ['vless-in'], domain: ['domain:openai.com'], outboundTag: 'direct' }],
      ),
    )
    const hit = issues.find((i) => i.path === 'routing.rules.0.domain')
    expect(hit?.level).toBe('warning')
    expect(hit?.message).toContain('vless-in')
    expect(hit?.message).toContain('sniffing')
  })

  it('sniffing включён, но destOverride пуст — тоже warning', () => {
    const issues = analyzeIntegrity(
      base(
        [{ tag: 'vless-in', protocol: 'vless', sniffing: { enabled: true, destOverride: [] } }],
        [{ inboundTag: ['vless-in'], domain: ['domain:openai.com'], outboundTag: 'direct' }],
      ),
    )
    expect(issues.some((i) => i.path === 'routing.rules.0.domain')).toBe(true)
  })

  it('sniffing настроен — предупреждения нет', () => {
    const issues = analyzeIntegrity(
      base(
        [{ tag: 'vless-in', protocol: 'vless', sniffing: { enabled: true, destOverride: ['tls', 'http'] } }],
        [{ inboundTag: ['vless-in'], domain: ['domain:openai.com'], outboundTag: 'direct' }],
      ),
    )
    expect(issues.some((i) => i.path === 'routing.rules.0.domain')).toBe(false)
  })

  it('правило без inboundTag применяется ко всем — слепые inbound-ы перечисляются', () => {
    const issues = analyzeIntegrity(
      base(
        [
          { tag: 'a-in', protocol: 'vless', sniffing: { enabled: true, destOverride: ['tls'] } },
          { tag: 'b-in', protocol: 'vless' },
        ],
        [{ domain: ['domain:openai.com'], outboundTag: 'direct' }],
      ),
    )
    const hit = issues.find((i) => i.path === 'routing.rules.0.domain')
    expect(hit?.message).toContain('b-in')
    expect(hit?.message).not.toContain('a-in')
  })

  it('правило по протоколу проверяется так же, но со своим путём', () => {
    const issues = analyzeIntegrity(
      base(
        [{ tag: 'vless-in', protocol: 'vless' }],
        [{ inboundTag: ['vless-in'], protocol: ['tls'], outboundTag: 'direct' }],
      ),
    )
    expect(issues.some((i) => i.path === 'routing.rules.0.protocol')).toBe(true)
  })

  it('правило без доменных и протокольных условий не трогаем', () => {
    const issues = analyzeIntegrity(
      base([{ tag: 'vless-in', protocol: 'vless' }], [{ ip: ['10.0.0.0/8'], outboundTag: 'direct' }]),
    )
    expect(issues.some((i) => i.path.startsWith('routing.rules.0'))).toBe(false)
  })
})
```

Если `analyzeIntegrity`/`XrayConfig` ещё не импортированы в этом файле — добавить к существующим импортам:

```ts
import { analyzeIntegrity, type XrayConfig } from '../src/entities/xray'
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/xray-config.test.ts`
Expected: FAIL — `expected undefined to be 'warning'`.

- [ ] **Step 3: Реализация**

В `frontend/src/entities/xray/config.ts` добавить перед `return issues` в `analyzeIntegrity`:

```ts
  // Правило по домену или протоколу не сработает, если inbound не снифает трафик:
  // ядро просто не узнает ни домена, ни протокола
  const blindTags = inbounds
    .filter((inb) => {
      const sniffing = inb.sniffing as { enabled?: boolean; destOverride?: string[] } | undefined
      return sniffing?.enabled !== true || (sniffing.destOverride?.length ?? 0) === 0
    })
    .map((inb) => inb.tag)

  if (blindTags.length > 0) {
    rules.forEach((rule, i) => {
      // Пустой inboundTag означает «все inbound-ы»
      const scope = rule.inboundTag?.length ? rule.inboundTag : [...inboundTags]
      const blind = scope.filter((tag) => blindTags.includes(tag))
      if (blind.length === 0) return
      const list = blind.map((t) => `«${t}»`).join(', ')
      if (rule.domain?.length) {
        issues.push({
          path: `routing.rules.${i}.domain`,
          message: `Правило матчит по домену, но на ${list} выключен sniffing — ядро не увидит домен`,
          level: 'warning',
        })
      }
      if (rule.protocol?.length) {
        issues.push({
          path: `routing.rules.${i}.protocol`,
          message: `Правило матчит по протоколу, но на ${list} выключен sniffing — ядро не определит протокол`,
          level: 'warning',
        })
      }
    })
  }
```

- [ ] **Step 4: Запустить весь фронтовый набор и typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: PASS. Если существующие тесты `analyzeIntegrity` начали получать лишние warning'и — это ожидаемо для конфигов без sniffing; поправить те тесты, которые считают issue'и по количеству, отфильтровав по `path`, и отметить правку в коммите.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/config.ts frontend/test/xray-config.test.ts
git commit -m "feat(frontend): warn when domain rules meet a blind sniffer"
```

---

### Task 7: `TracePanel` — разбор по правилам

**Files:**
- Create: `frontend/src/features/diagnostics/TracePanel.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/trace-panel.test.tsx`

**Interfaces:**
- Consumes: `TraceResult`, `RuleVerdict` из `entities/xray/trace`.
- Produces: `function TracePanel({ result, onClose, onSelectRule }: { result: TraceResult; onClose: () => void; onSelectRule: (index: number) => void }): JSX.Element`

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/trace-panel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TracePanel } from '../src/features/diagnostics/TracePanel'
import type { TraceResult } from '../src/entities/xray'

const result: TraceResult = {
  verdicts: [
    {
      index: 0,
      state: 'no',
      outboundTag: 'warp',
      fields: [{ field: 'domain', state: 'no', reason: 'ни один шаблон домена не подходит' }],
    },
    {
      index: 1,
      state: 'unknown',
      outboundTag: 'warp',
      fields: [{ field: 'domain', state: 'unknown', reason: 'зависит от geo-списка или внешнего файла' }],
    },
    { index: 2, state: 'yes', outboundTag: 'direct', fields: [] },
  ],
  winner: { ruleIndex: 2, outboundTag: 'direct' },
  caveats: ['Правила #2 зависят от данных, которых нет, и стоят выше победителя — реальный маршрут может отличаться.'],
}

describe('TracePanel', () => {
  it('показывает победителя и его outbound', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    // Итог ищем внутри своего блока: тег «direct» встречается ещё и в строке правила
    const summary = within(screen.getByLabelText('Итог трассировки'))
    expect(summary.getByText(/правило #3/i)).toBeInTheDocument()
    expect(summary.getByText('direct')).toBeInTheDocument()
  })

  it('нумерует правила от единицы и подписывает состояние каждого', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    // Список правил адресуем по имени: caveats — тоже <ul>, и getAllByRole('listitem') смешал бы их
    const rows = within(screen.getByRole('list', { name: 'Правила' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('#1')
    expect(rows[0]).toHaveTextContent('не совпало')
    expect(rows[1]).toHaveTextContent('нет данных')
    expect(rows[2]).toHaveTextContent('совпало')
  })

  it('показывает причину по каждому полю', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/ни один шаблон домена не подходит/)).toBeInTheDocument()
  })

  it('выводит caveats', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/может отличаться/)).toBeInTheDocument()
  })

  it('клик по строке правила выбирает его в графе', async () => {
    const onSelectRule = vi.fn()
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={onSelectRule} />)
    await userEvent.click(screen.getByRole('button', { name: /#1/ }))
    expect(onSelectRule).toHaveBeenCalledWith(0)
  })

  it('дефолтный маршрут подписан явно, когда ни одно правило не совпало', () => {
    const noMatch: TraceResult = {
      verdicts: [],
      winner: { ruleIndex: null, outboundTag: 'direct' },
      caveats: [],
    }
    render(<TracePanel result={noMatch} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/ни одно правило не совпало/i)).toBeInTheDocument()
  })

  it('второй проход по IP показывается отдельным блоком', () => {
    const twoPass: TraceResult = {
      ...result,
      ipVerdicts: [{ index: 0, state: 'yes', outboundTag: 'warp', fields: [] }],
    }
    render(<TracePanel result={twoPass} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/по разрешённому адресу/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/trace-panel.test.tsx`
Expected: FAIL — `Failed to resolve import ".../TracePanel"`.

- [ ] **Step 3: Реализация**

Создать `frontend/src/features/diagnostics/TracePanel.tsx`:

```tsx
import type { MatchState, RuleVerdict, TraceResult } from '../../entities/xray'
import { Button } from '../../shared/ui'

const STATE_LABEL: Record<MatchState, string> = {
  yes: 'совпало',
  no: 'не совпало',
  unknown: 'нет данных',
}

const FIELD_LABEL: Record<string, string> = {
  domain: 'домен',
  ip: 'IP',
  port: 'порт',
  sourcePort: 'порт источника',
  network: 'сеть',
  source: 'источник',
  protocol: 'протокол',
  user: 'пользователь',
  inboundTag: 'inbound',
}

function VerdictRows({
  verdicts,
  winnerIndex,
  onSelectRule,
}: {
  verdicts: RuleVerdict[]
  winnerIndex: number | null | undefined
  onSelectRule: (index: number) => void
}) {
  return (
    <ul className="trace-rules" aria-label="Правила">
      {verdicts.map((v) => (
        <li key={v.index} className="trace-rule" data-state={v.state} data-winner={v.index === winnerIndex || undefined}>
          <button type="button" className="trace-rule-head" onClick={() => onSelectRule(v.index)}>
            <span className="trace-rule-no">{`#${v.index + 1}`}</span>
            <span className={`trace-badge trace-badge-${v.state}`}>{STATE_LABEL[v.state]}</span>
            {v.outboundTag && <span className="metric metric-accent">{v.outboundTag}</span>}
            {v.balancerTag && <span className="metric">{`балансер ${v.balancerTag}`}</span>}
          </button>
          {v.fields.length > 0 && (
            <div className="trace-fields">
              {v.fields.map((f, i) => (
                <span key={i} className="trace-field" data-state={f.state}>
                  <span className="trace-field-name">{FIELD_LABEL[f.field] ?? f.field}</span>
                  {f.reason}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function TracePanel({
  result,
  onClose,
  onSelectRule,
}: {
  result: TraceResult
  onClose: () => void
  onSelectRule: (index: number) => void
}) {
  const { winner } = result
  const shown = result.ipVerdicts ?? result.verdicts

  return (
    <aside className="trace-panel">
      <div className="trace-panel-head">
        <h2>Разбор трассы</h2>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>

      <div className="trace-winner" aria-label="Итог трассировки">
        {winner === undefined ? (
          <span className="field-error">Выходов нет — трафику некуда идти</span>
        ) : winner.ruleIndex === null ? (
          <>
            <span className="muted">Ни одно правило не совпало — трафик уходит в первый выход</span>
            {winner.outboundTag && <span className="metric metric-accent">{winner.outboundTag}</span>}
          </>
        ) : (
          <>
            <span>{`Победило правило #${winner.ruleIndex + 1} →`}</span>
            {winner.outboundTag && <span className="metric metric-accent">{winner.outboundTag}</span>}
            {winner.balancerTag && <span className="metric">{`балансер ${winner.balancerTag}`}</span>}
          </>
        )}
      </div>

      {result.caveats.length > 0 && (
        <ul className="trace-caveats">
          {result.caveats.map((text, i) => (
            <li key={i} className="field-warning">
              {text}
            </li>
          ))}
        </ul>
      )}

      {result.ipVerdicts && (
        <p className="muted trace-pass-note">
          Показан второй проход — по разрешённому адресу (стратегия IPIfNonMatch).
        </p>
      )}

      <VerdictRows verdicts={shown} winnerIndex={winner?.ruleIndex} onSelectRule={onSelectRule} />
    </aside>
  )
}
```

Дописать в конец `frontend/src/shared/ui/tokens.css`:

```css
/* Разбор трассы — оверлей поверх канваса, как инспектор, но у левого края */
.trace-panel {
  position: absolute;
  left: 14px;
  bottom: 74px;
  z-index: 9;
  width: min(440px, calc(100% - 28px));
  max-height: 52%;
  overflow-y: auto;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--panel-2) 94%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--rail-hi);
  border-radius: 12px;
  box-shadow: var(--shadow-2);
  animation: slide-in 180ms var(--ease);
}
.trace-panel-head { display: flex; align-items: center; gap: 8px; }
.trace-panel-head h2 { margin: 0; font-size: var(--t-md); }
.trace-winner { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.trace-caveats { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 4px; font-size: var(--t-sm); }
.trace-pass-note { margin: 0 0 8px; font-size: var(--t-sm); }
.trace-rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.trace-rule { border: 1px solid var(--rail); border-radius: 8px; padding: 6px 8px; }
.trace-rule[data-winner] { border-color: var(--ember-line); background: var(--ember-soft); }
.trace-rule-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.trace-rule-no { font-family: var(--font-mono); color: var(--ink-dim); }
.trace-badge { font-size: var(--t-xs); padding: 1px 6px; border-radius: 999px; border: 1px solid var(--rail-hi); }
.trace-badge-yes { color: var(--ember); border-color: var(--ember-line); background: var(--ember-soft); }
.trace-badge-no { color: var(--ink-dim); }
.trace-badge-unknown { color: var(--flux); border-color: var(--flux-line); background: var(--flux-soft); }
.trace-fields { display: grid; gap: 2px; margin-top: 4px; font-size: var(--t-sm); color: var(--ink-dim); }
.trace-field-name { font-family: var(--font-mono); margin-right: 6px; color: var(--ink); }
```

Все использованные токены (`--ember-line`, `--ember-soft`, `--flux-line`, `--flux-soft`, `--t-xs`, `--t-sm`, `--t-md`, `--shadow-2`, `--ease`, `--rail`, `--rail-hi`, `--panel-2`, `--ink`, `--ink-dim`) уже объявлены в блоке `:root` того же файла — новых вводить не нужно.

- [ ] **Step 4: Запустить тест**

Run: `cd frontend && npx vitest run test/trace-panel.test.tsx`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/diagnostics/TracePanel.tsx frontend/src/shared/ui/tokens.css frontend/test/trace-panel.test.tsx
git commit -m "feat(frontend): trace panel with per-rule verdicts"
```

---

### Task 8: `TraceBar` — ввод цели

**Files:**
- Create: `frontend/src/features/diagnostics/TraceBar.tsx`
- Test: `frontend/test/trace-bar.test.tsx`

**Interfaces:**
- Consumes: `TraceTarget` из `entities/xray`; `Select`, `TextInput` из `shared/ui`.
- Produces: `function TraceBar({ value, onChange }: { value: TraceTarget | null; onChange: (t: TraceTarget | null) => void }): JSX.Element`

Поведение: пока адрес пустой — `onChange(null)` (трассировки нет). Порт по умолчанию 443, сеть по умолчанию tcp.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/trace-bar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { TraceBar } from '../src/features/diagnostics/TraceBar'
import type { TraceTarget } from '../src/entities/xray'
import { selectOption } from './helpers'

/** Контролируемый компонент требует эхо-обёртки, иначе userEvent.type теряет символы */
function Harness({ onChange }: { onChange: (t: TraceTarget | null) => void }) {
  const [value, setValue] = useState<TraceTarget | null>(null)
  return (
    <TraceBar
      value={value}
      onChange={(t) => {
        setValue(t)
        onChange(t)
      }}
    />
  )
}

describe('TraceBar', () => {
  it('пустой адрес — трассировки нет', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('введённый адрес даёт цель с портом 443 и tcp по умолчанию', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: 'openai.com', port: 443, network: 'tcp' }),
    )
  })

  it('порт и сеть меняются', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    await userEvent.clear(screen.getByLabelText('Порт'))
    await userEvent.type(screen.getByLabelText('Порт'), '80')
    await selectOption('Сеть', 'udp')
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 80, network: 'udp' }),
    )
  })

  it('IP назначения попадает в цель, пустое поле не попадает', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ip: undefined }))
    await userEvent.type(screen.getByLabelText('IP назначения'), '10.1.2.3')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ip: '10.1.2.3' }))
  })

  it('очистка адреса выключает трассировку', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const address = screen.getByLabelText('Адрес')
    await userEvent.type(address, 'openai.com')
    await userEvent.clear(address)
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/trace-bar.test.tsx`
Expected: FAIL — `Failed to resolve import ".../TraceBar"`.

- [ ] **Step 3: Реализация**

Создать `frontend/src/features/diagnostics/TraceBar.tsx`:

```tsx
import { useId, useState } from 'react'
import type { TraceTarget } from '../../entities/xray'
import { Select, TextInput } from '../../shared/ui'

/**
 * Ввод цели трассировки. Живёт в доке над канвасом, поэтому подписи полей
 * компактные и связаны с контролами через htmlFor (у Select значение лежит в
 * содержимом — обёртка <label> приклеила бы его к accessible-имени).
 */
export function TraceBar({
  value,
  onChange,
}: {
  value: TraceTarget | null
  onChange: (target: TraceTarget | null) => void
}) {
  const [address, setAddress] = useState(value?.address ?? '')
  const [port, setPort] = useState(String(value?.port ?? 443))
  const [network, setNetwork] = useState<'tcp' | 'udp'>(value?.network ?? 'tcp')
  const [ip, setIp] = useState(value?.ip ?? '')
  const addressId = useId()
  const portId = useId()
  const networkId = useId()
  const ipId = useId()

  function emit(next: { address?: string; port?: string; network?: 'tcp' | 'udp'; ip?: string }) {
    const addr = (next.address ?? address).trim()
    const portText = (next.port ?? port).trim()
    const ipText = (next.ip ?? ip).trim()
    if (addr === '') return onChange(null)
    onChange({
      address: addr,
      port: /^\d+$/.test(portText) ? Number(portText) : 443,
      network: next.network ?? network,
      ip: ipText === '' ? undefined : ipText,
    })
  }

  return (
    <div className="trace-bar">
      <label className="trace-bar-label" htmlFor={addressId}>
        Адрес
      </label>
      <TextInput
        id={addressId}
        value={address}
        placeholder="openai.com"
        onChange={(e) => {
          setAddress(e.target.value)
          emit({ address: e.target.value })
        }}
      />
      <label className="trace-bar-label" htmlFor={portId}>
        Порт
      </label>
      <TextInput
        id={portId}
        value={port}
        inputMode="numeric"
        onChange={(e) => {
          setPort(e.target.value)
          emit({ port: e.target.value })
        }}
      />
      <label className="trace-bar-label" htmlFor={networkId}>
        Сеть
      </label>
      <Select
        id={networkId}
        value={network}
        options={[
          { value: 'tcp', label: 'tcp' },
          { value: 'udp', label: 'udp' },
        ]}
        onChange={(v) => {
          const net = v as 'tcp' | 'udp'
          setNetwork(net)
          emit({ network: net })
        }}
      />
      <label className="trace-bar-label" htmlFor={ipId}>
        IP назначения
      </label>
      <TextInput
        id={ipId}
        value={ip}
        placeholder="необязательно"
        onChange={(e) => {
          setIp(e.target.value)
          emit({ ip: e.target.value })
        }}
      />
    </div>
  )
}
```

Дописать в `frontend/src/shared/ui/tokens.css`:

```css
/* Строка трассировки внутри дока: подписи мелкие, поля узкие */
.trace-bar { display: flex; align-items: center; gap: 6px; }
.trace-bar-label { font-size: var(--t-xs); color: var(--ink-dim); white-space: nowrap; }
.trace-bar .input { width: 9rem; }
.trace-bar .input[inputmode='numeric'] { width: 4.5rem; }
```

`TextInput` всегда добавляет класс `.input` (см. `shared/ui/TextInput.tsx`), поэтому селекторы выше сработают без правок компонента.

- [ ] **Step 4: Запустить тест**

Run: `cd frontend && npx vitest run test/trace-bar.test.tsx`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/diagnostics/TraceBar.tsx frontend/src/shared/ui/tokens.css frontend/test/trace-bar.test.tsx
git commit -m "feat(frontend): trace target input bar"
```

---

### Task 9: Вердикты на узлах графа и подсветка победившего пути

**Files:**
- Modify: `frontend/src/entities/graph/types.ts`
- Modify: `frontend/src/features/topology/nodes.tsx`
- Modify: `frontend/src/features/topology/TopologyView.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/topology-nodes.test.tsx`, `frontend/test/topology-trace.test.ts`

**Interfaces:**
- Consumes: `TraceResult` из `entities/xray/trace`.
- Produces:
  - `RuleNodeData` получает необязательное поле `traceState?: MatchState | 'winner'`
  - `function traceStateOf(result: TraceResult | undefined, ruleIndex: number): MatchState | 'winner' | undefined` (экспортируется из `TopologyView.tsx` для теста)
  - `function tracedEdgeIds(result: TraceResult | undefined, config: XrayConfig): Set<string>` (экспортируется из `TopologyView.tsx`)
  - `TopologyView` получает новый необязательный проп `trace?: TraceResult` и `dockExtra?: ReactNode`

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/topology-trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { traceStateOf, tracedEdgeIds } from '../src/features/topology/TopologyView'
import type { TraceResult, XrayConfig } from '../src/entities/xray'

const result: TraceResult = {
  verdicts: [
    { index: 0, state: 'no', outboundTag: 'warp', fields: [] },
    { index: 1, state: 'unknown', outboundTag: 'warp', fields: [] },
    { index: 2, state: 'yes', outboundTag: 'direct', fields: [] },
  ],
  winner: { ruleIndex: 2, outboundTag: 'direct' },
  caveats: [],
}

describe('traceStateOf', () => {
  it('победитель помечен отдельно от обычного совпадения', () => {
    expect(traceStateOf(result, 2)).toBe('winner')
    expect(traceStateOf(result, 1)).toBe('unknown')
    expect(traceStateOf(result, 0)).toBe('no')
  })

  it('без трассировки состояний нет', () => {
    expect(traceStateOf(undefined, 0)).toBeUndefined()
  })

  it('индекс за пределами разбора — undefined', () => {
    expect(traceStateOf(result, 7)).toBeUndefined()
  })
})

describe('tracedEdgeIds', () => {
  const config = {
    inbounds: [{ tag: 'vless-in', protocol: 'vless' }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [{}, {}, { inboundTag: ['vless-in'], outboundTag: 'direct' }] },
  } as unknown as XrayConfig

  it('путь победителя: inbound → правило → outbound', () => {
    const ids = tracedEdgeIds(result, config)
    expect(ids.has('e:in:vless-in->rule:2')).toBe(true)
    expect(ids.has('e:rule:2->out:direct')).toBe(true)
  })

  it('правила без своего inboundTag подсвечивают все входы', () => {
    const cfg = {
      inbounds: [{ tag: 'a-in', protocol: 'vless' }, { tag: 'b-in', protocol: 'vless' }],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{}, {}, { outboundTag: 'direct' }] },
    } as unknown as XrayConfig
    const ids = tracedEdgeIds(result, cfg)
    expect(ids.has('e:in:a-in->rule:2')).toBe(true)
    expect(ids.has('e:in:b-in->rule:2')).toBe(true)
  })

  it('дефолтный маршрут не подсвечивает ни одного правила', () => {
    const fallback: TraceResult = { verdicts: [], winner: { ruleIndex: null, outboundTag: 'direct' }, caveats: [] }
    expect(tracedEdgeIds(fallback, config).size).toBe(0)
  })

  it('без трассировки подсветки нет', () => {
    expect(tracedEdgeIds(undefined, config).size).toBe(0)
  })
})
```

Дописать в `frontend/test/topology-nodes.test.tsx` внутрь существующего `describe('узлы топологии')`. Файл уже объявляет типизированный алиас `RuleNode` и хелпер `wrap()`, который оборачивает узел в `ReactFlowProvider` (без провайдера `<Handle>` падает) — используем их, ничего нового не заводим:

```tsx
  it('rule показывает вердикт трассировки', () => {
    wrap(
      <RuleNode
        data={{ kind: 'rule' as const, index: 0, summary: [], allInbounds: true, traceState: 'winner' }}
        selected={false}
      />,
    )
    expect(screen.getByText('маршрут')).toBeInTheDocument()
  })

  it('rule без трассировки вердикт не показывает', () => {
    wrap(
      <RuleNode
        data={{ kind: 'rule' as const, index: 0, summary: [], allInbounds: true }}
        selected={false}
      />,
    )
    expect(screen.queryByText('маршрут')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `cd frontend && npx vitest run test/topology-trace.test.ts test/topology-nodes.test.tsx`
Expected: FAIL — `traceStateOf is not a function`, и `маршрут` не найден.

- [ ] **Step 3: Реализация**

В `frontend/src/entities/graph/types.ts` заменить `RuleNodeData`:

```ts
export interface RuleNodeData extends Record<string, unknown> {
  kind: 'rule'; index: number; summary: string[]; allInbounds: boolean
  /** Вердикт трассировки; 'winner' — правило, которое победило */
  traceState?: 'yes' | 'no' | 'unknown' | 'winner'
}
```

В `frontend/src/features/topology/nodes.tsx` — в `RuleNode`, сразу после `<div className="fnode-head">…</div>`:

```tsx
      {data.traceState && (
        <span className={`trace-badge trace-badge-${data.traceState}`}>
          {data.traceState === 'winner'
            ? 'маршрут'
            : data.traceState === 'yes'
              ? 'совпало'
              : data.traceState === 'no'
                ? 'не совпало'
                : 'нет данных'}
        </span>
      )}
```

В `frontend/src/features/topology/TopologyView.tsx`:

1. Расширить импорты: `import type { TraceResult } from '../../entities/xray'` и `import type { ReactNode } from 'react'`.
2. Добавить в `interface Props`: `trace?: TraceResult` и `dockExtra?: ReactNode`.
3. Добавить экспортируемые функции перед `TopologyView`:

```ts
/** Состояние правила для бейджа на узле: победитель отделён от обычного совпадения */
export function traceStateOf(
  result: TraceResult | undefined,
  ruleIndex: number,
): 'yes' | 'no' | 'unknown' | 'winner' | undefined {
  if (!result) return undefined
  const shown = result.ipVerdicts ?? result.verdicts
  const verdict = shown.find((v) => v.index === ruleIndex)
  if (!verdict) return undefined
  return result.winner?.ruleIndex === ruleIndex ? 'winner' : verdict.state
}

/** Кабели победившего пути: входы → правило → выход. Дефолтный маршрут правил не задействует. */
export function tracedEdgeIds(result: TraceResult | undefined, config: XrayConfig): Set<string> {
  const ids = new Set<string>()
  const index = result?.winner?.ruleIndex
  if (index === undefined || index === null) return ids
  const rule = config.routing?.rules?.[index]
  if (!rule) return ids
  const inboundTags = (config.inbounds ?? []).map((i) => i.tag)
  const scope = rule.inboundTag?.length ? rule.inboundTag.filter((t) => inboundTags.includes(t)) : inboundTags
  for (const tag of scope) ids.add(`e:in:${tag}->rule:${index}`)
  if (rule.outboundTag) ids.add(`e:rule:${index}->out:${rule.outboundTag}`)
  return ids
}
```

4. В `computed` (useMemo) — прокинуть вердикты в узлы правил и подсветить путь:

```ts
  const computed = useMemo(() => {
    const g = buildGraph(config, ctx)
    const traced = tracedEdgeIds(trace, config)
    const laid = layoutColumns(g.nodes).map((n) => ({
      ...n,
      deletable: false,
      position: saved?.[n.id] ?? n.position,
      selected: n.id === selectedId,
      data:
        n.data.kind === 'rule'
          ? { ...n.data, traceState: traceStateOf(trace, n.data.index as number) }
          : n.data,
    }))
    // Кабели подсвечиваются, если касаются выбранного узла или лежат на трассе
    const wired = g.edges.map((e) => ({
      ...e,
      type: 'signal',
      data: {
        active:
          traced.has(e.id) ||
          (selectedId !== null && (e.source === selectedId || e.target === selectedId)),
      },
    }))
    return { nodes: laid, edges: wired }
  }, [config, ctx, saved, selectedId, trace])
```

5. В `<Panel position="bottom-center">` — добавить слот перед кнопкой сброса расположения:

```tsx
        <div className="wb-dock">
          <Button onClick={() => onChangeConfig(addInbound(config))}>+ Inbound</Button>
          <Button onClick={() => onChangeConfig(addOutbound(config))}>+ Outbound</Button>
          <Button onClick={() => onChangeConfig(addRule(config))}>+ Правило</Button>
          <span className="wb-dock-sep" aria-hidden="true" />
          {dockExtra}
          {dockExtra && <span className="wb-dock-sep" aria-hidden="true" />}
          <Button variant="ghost" onClick={() => resetPositions(profileUuid)}>
            Сбросить расположение
          </Button>
        </div>
```

Дописать в `frontend/src/shared/ui/tokens.css`:

```css
/* Бейдж вердикта на узле правила — тот же язык, что в панели разбора */
.fnode .trace-badge { position: absolute; top: 6px; right: 8px; }
.trace-badge-winner { color: var(--ember); border-color: var(--ember-line); background: var(--ember-soft); }
```

- [ ] **Step 4: Запустить тесты и typecheck**

Run: `cd frontend && npx vitest run test/topology-trace.test.ts test/topology-nodes.test.tsx && npm run typecheck`
Expected: PASS, 9 новых тестов; typecheck без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/types.ts frontend/src/features/topology/nodes.tsx frontend/src/features/topology/TopologyView.tsx frontend/src/shared/ui/tokens.css frontend/test/topology-trace.test.ts frontend/test/topology-nodes.test.tsx
git commit -m "feat(frontend): rule verdicts and traced path in topology"
```

---

### Task 10: Сборка в `EditorPage` и e2e

**Files:**
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Create: `frontend/e2e/trace.spec.ts`
- Test: `frontend/test/editor-logic.test.ts` (существует — дополнить)

**Interfaces:**
- Consumes: `traceRoute`, `TraceTarget` из `entities/xray`; `TraceBar`, `TracePanel`; пропы `trace`/`dockExtra` из Task 9.
- Produces: `function traceOf(config: XrayConfig | undefined, target: TraceTarget | null): TraceResult | undefined` — экспортируется из `EditorPage.tsx`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/editor-logic.test.ts`:

```ts
import { traceOf } from '../src/features/editor/EditorPage'
import type { XrayConfig } from '../src/entities/xray'

describe('traceOf', () => {
  const config = {
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [{ domain: ['domain:openai.com'], outboundTag: 'direct' }] },
  } as unknown as XrayConfig

  it('без цели трассировки нет', () => {
    expect(traceOf(config, null)).toBeUndefined()
  })

  it('без валидного конфига трассировки нет', () => {
    expect(traceOf(undefined, { address: 'openai.com', port: 443, network: 'tcp' })).toBeUndefined()
  })

  it('цель и конфиг есть — считается маршрут, geo помечены как незагруженные', () => {
    const res = traceOf(config, { address: 'api.openai.com', port: 443, network: 'tcp' })
    expect(res?.winner).toEqual({ ruleIndex: 0, outboundTag: 'direct', balancerTag: undefined })
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd frontend && npx vitest run test/editor-logic.test.ts`
Expected: FAIL — `traceOf is not a function`.

- [ ] **Step 3: Реализация**

В `frontend/src/features/editor/EditorPage.tsx`:

1. Импорты:

```ts
import { traceRoute, validateXrayConfig, type TraceResult, type TraceTarget, type XrayConfig } from '../../entities/xray'
import { TraceBar } from '../diagnostics/TraceBar'
import { TracePanel } from '../diagnostics/TracePanel'
```

2. Экспортируемая чистая функция (рядом с `nextSelection`):

```ts
// Geo-базы появятся на следующем этапе; сейчас трассировщик честно считает
// geosite:/geoip: неизвестными и говорит об этом в caveats.
const NO_GEO = { loaded: false, answers: {}, missing: [] }

export function traceOf(
  config: XrayConfig | undefined,
  target: TraceTarget | null,
): TraceResult | undefined {
  if (!config || !target) return undefined
  return traceRoute(config, target, NO_GEO)
}
```

3. В `EditorInner` — состояние и вычисление:

```ts
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null)
  const trace = useMemo(() => traceOf(parsedConfig, traceTarget), [parsedConfig, traceTarget])
```

4. В рендере `TopologyView` — новые пропы:

```tsx
              <TopologyView
                profileUuid={profile.uuid}
                config={parsedConfig}
                ctx={ctx}
                selectedId={selectedNode}
                onSelect={setSelectedNode}
                onChangeConfig={changeConfig}
                trace={trace}
                dockExtra={<TraceBar value={traceTarget} onChange={setTraceTarget} />}
              />
```

5. Сразу после `</div>` канваса (внутри той же ветки `tab === 'topology'`), до блока инспектора:

```tsx
            {trace && (
              <TracePanel
                result={trace}
                onClose={() => setTraceTarget(null)}
                onSelectRule={(index) => setSelectedNode(`rule:${index}`)}
              />
            )}
```

6. При переключении на вкладку JSON — сбрасывать цель, чтобы панель не висела над редактором: в обработчике кнопки «JSON» рядом с `setSelectedNode(null)` добавить `setTraceTarget(null)`.

- [ ] **Step 4: Запустить весь набор и typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: PASS всё; typecheck чист.

- [ ] **Step 5: Написать e2e**

Создать `frontend/e2e/trace.spec.ts`. Общий `CONFIG` в `e2e/mocks.ts` НЕ трогаем — на его единственное правило опираются `routing.spec.ts` и `connections.spec.ts`. Вместо этого доопределяем маршрут профиля уже после `mockApi`: в Playwright позже добавленный обработчик имеет приоритет, поэтому свой конфиг применится только в этой спеке.

```ts
import { expect, test } from '@playwright/test'
import { CONFIG, PROFILE, UUID, mockApi } from './mocks'

// Свой конфиг: geo-правило выше конкретного — так проверяются и вердикты, и caveats
const TRACE_CONFIG = {
  ...CONFIG,
  routing: {
    rules: [
      { type: 'field', domain: ['geosite:openai'], outboundTag: 'block' },
      { type: 'field', domain: ['domain:openai.com'], outboundTag: 'direct' },
    ],
  },
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.route(`**/api/profiles/${UUID}`, (r) =>
    r.fulfill({ json: { profile: { ...PROFILE, config: TRACE_CONFIG } } }),
  )
})

test('трассировка показывает победившее правило и подсвечивает его узел', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()

  await page.getByLabel('Адрес').fill('api.openai.com')

  const panel = page.locator('.trace-panel')
  await expect(panel).toBeVisible()
  // Победило второе правило: первое зависит от geo-списка и остаётся неизвестным
  await expect(panel).toContainText('Победило правило #2')
  await expect(panel).toContainText('direct')

  // Вердикт виден и на узле графа
  await expect(page.locator('.react-flow__node[data-id="rule:1"] .trace-badge-winner')).toBeVisible()
})

test('geo-правила честно помечаются как неизвестные', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByLabel('Адрес').fill('api.openai.com')

  const panel = page.locator('.trace-panel')
  await expect(panel).toContainText('Geo-базы не загружены')
  await expect(panel).toContainText('может отличаться')
  await expect(page.locator('.react-flow__node[data-id="rule:0"] .trace-badge-unknown')).toBeVisible()
})

test('очистка адреса убирает панель разбора', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  const address = page.getByLabel('Адрес')
  await address.fill('api.openai.com')
  await expect(page.locator('.trace-panel')).toBeVisible()
  await address.fill('')
  await expect(page.locator('.trace-panel')).toBeHidden()
})
```

- [ ] **Step 6: Запустить e2e**

Run: `npm run e2e -w frontend`
Expected: PASS все спеки, включая три новых (chromium должен быть установлен: `cd frontend && npx playwright install chromium`).

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/editor/EditorPage.tsx frontend/test/editor-logic.test.ts frontend/e2e/trace.spec.ts
git commit -m "feat(frontend): wire route tracer into the editor with e2e coverage"
```

---

## Проверка по завершении

- [ ] `npm test` — оба workspace зелёные
- [ ] `npm run typecheck -w frontend` и `npm run typecheck -w backend` — чисто
- [ ] `npm run e2e -w frontend` — зелёно
- [ ] `npm run build` — собирается
- [ ] Ручная проверка: ввести цель в доке, убедиться, что победитель совпадает с ожиданием по порядку правил; выключить sniffing на inbound и увидеть предупреждение и в статус-баре, и в caveats

## Что этот этап сознательно НЕ делает

- geo-вердикты остаются `unknown` (этап 2: разбор `.dat`, `/api/tools/geo/match`, диалог geo-баз);
- нет проверки ядром и Reality-цели (этап 3);
- сервер не резолвит домены — IP вводится вручную;
- `ext:`, `attrs` и выбор конкретного outbound за балансером не поддерживаются (заявленные границы спеки).

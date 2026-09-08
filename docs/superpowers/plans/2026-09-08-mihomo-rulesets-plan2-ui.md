# Наборы правил Mihomo, план 2 — UI

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОД-НАВЫК: используйте
> superpowers:subagent-driven-development (рекомендуется) либо
> superpowers:executing-plans. Шаги помечены чекбоксами (`- [ ]`).

**Цель:** пользователь видит состояние каждого набора правил, читает его
содержимое и понимает, откуда взялся вердикт трассировки, — не выходя из
редактора и не открывая ссылку руками.

**Архитектура:** к уже работающему `RuleSetService` добавляются три операции
(`status`, `refresh`, `page`) и перечислитель содержимого — обход бора и
обратное превращение диапазонов в CIDR. Фронтенд получает диалог «Наборы
правил» с просмотрщиком (сёстры `GeoDataDialog` и `GeoBrowser`), пометки о
наборе в панели разбора трассы, предупреждения в общем списке диагностик и
оговорку о давности кэша.

**Технологии:** Node 24, Fastify, TypeScript, React 19, TanStack Query, vitest,
Playwright.

**Спека:** `docs/superpowers/specs/2026-09-08-mihomo-rulesets-design.md`

**Предшественник:** `docs/superpowers/plans/2026-09-08-mihomo-rulesets-plan1-core.md`
(выполнен; ядро, роут `match`, трассировка по наборам, правила по процессу).

## Global Constraints

- Язык UI, сообщений об ошибках и комментариев — **русский**. Коммиты —
  английский conventional style (`feat(frontend): ...`).
- В `main` не сливаем, `dev` не пушим без явной просьбы. Работа идёт в ветке
  плана 1.
- **Ни один тест не ходит в сеть.** Фикстуры лежат в
  `backend/test/fixtures/ruleset/` (`faceit.mrs`, `eft.mrs`, `twitch-ads.mrs`,
  `geoip-private.mrs`) и `frontend/test/fixtures/mihomo/roscomvpn.yaml`;
  загрузка подменяется, как в тестах geo.
- **Мутационное тестирование — планка приёмки.** Каждый значимый тест
  доказывается поломкой кода и наблюдением красного, затем обратной правкой.
  Никогда не `git checkout --`, никогда не замена на пустую строку.
- **Тест на отказ проверяет ТЕКСТ сообщения, а не только класс ошибки.** Все
  отказы бэкенда здесь одного класса `RuleSetError`, и `toThrow(RuleSetError)`
  не отличает сработавшую ветку от соседней. При исполнении плана 1 так трижды
  проходила мутация.
- **Порт чужого алгоритма — построчный.** Обход бора (`DomainSet.keys` /
  `Foreach`, `component/trie/domain_set.go`) переносится строка в строку, как
  уже перенесён `Has`. Пересказ своими словами запрещён.
- Никаких `doc.toString()` во фронтенде: модель Mihomo производна от текста.
- **Одна реализация на одну функцию ядра.** Хелперы `getBit`, `countZeros`,
  `selectIthOne` уже есть в `domainSet.ts` — перечислитель их импортирует, а не
  заводит вторые. В плане 1 две копии одной функции уже разъехались на
  подстановке и были пойманы ревью.
- Числа лимитов из плана 1 не меняются. Новое здесь одно: **предел на страницу
  просмотрщика — 1000 записей** (как у `GeoBrowser`).
- **Отказ вместо порчи.** Набор, который редактор загрузить не может, остаётся
  видимым со своей причиной; спрятать строку — значит соврать, что набора нет в
  документе.
- Недоступный набор **не блокирует сохранение** и не становится ошибкой: это
  предупреждение. Документ от нашей неспособности скачать файл корректным быть
  не перестаёт.

---

## Раскладка файлов

**Бэкенд**

| Файл | Ответственность | Задача |
|---|---|---|
| `backend/src/ruleset/domainSet.ts` | Экспорт трёх хелперов бора наружу (новых реализаций не заводим) | 1 |
| `backend/src/ruleset/enumerate.ts` | **Создать.** `domainKeys` — порт `DomainSet.keys`; `cidrsOf` — диапазон → минимальный список CIDR | 1 |
| `backend/src/ruleset/cache.ts` | `peek` (файл в обход TTL) и `remove` | 2 |
| `backend/src/ruleset/service.ts` | `Parsed.entries`/`loadedAt`, пул как общий хелпер, `status`, `refresh`, `page` | 2 |
| `backend/src/routes/tools.ts` | Роуты `status`, `refresh`, `page`; граница `match` перестаёт обнулять ответы | 3 |

**Фронтенд**

| Файл | Ответственность | Задача |
|---|---|---|
| `frontend/src/shared/api/types.ts` | `RuleSetStatusItem`, `RuleSetPageResponse`, `loadedAt` в ответе `match` | 4 |
| `frontend/src/shared/api/hooks.ts` | `useRuleSetStatus`, `useRefreshRuleSets`, `useRuleSetPage` | 4 |
| `frontend/src/entities/mihomo/trace.ts` | Пометки о наборе в вердикте, оговорка о давности, geo-ключи из строк `classical` | 5 |
| `frontend/src/features/editor/useMihomoDraft.ts` | Состояние диалога, честный отказ при сбое запроса, диагностики по наборам | 6 |
| `frontend/src/features/diagnostics/RuleSetsDialog.tsx` | **Создать.** Состояние наборов, обновление | 7 |
| `frontend/src/features/templates/MihomoEditorPage.tsx` | Кнопка «Наборы правил» в топбаре | 7 |
| `frontend/src/shared/ui/tokens.css` | Все стили плана 2 — одним блоком | 7 |
| `frontend/src/features/diagnostics/RuleSetBrowser.tsx` | **Создать.** Просмотрщик содержимого с поиском | 8 |
| `frontend/src/features/diagnostics/MihomoTracePanel.tsx` | Пометка «ответ из набора, записей столько-то» | 9 |
| `frontend/e2e/*`, `README.md`, `CLAUDE.md` | Раскладка дока, документация, сквозная приёмка | 10, 11 |

## Волны исполнения

Файлы между задачами одной волны не пересекаются:

| Волна | Задачи | Почему вместе |
|---|---|---|
| 1 | 1, 4 | `backend/src/ruleset/enumerate.ts` и `frontend/src/shared/api/*` — разные workspace |
| 2 | 2, 5 | `service.ts`/`cache.ts` против `entities/mihomo/trace.ts` |
| 3 | 3, 6 | `routes/tools.ts` против `features/editor/useMihomoDraft.ts` |
| 4 | 7 | Одна: задача владеет `tokens.css` целиком, и делить его нельзя |
| 5 | 8, 9 | Просмотрщик и панель трассы; классы из задачи 7 уже есть |
| 6 | 10, 11 | Раскладка дока и документация |

Задача 6 читает типы из задачи 4, задача 5 — поля ответа из задачи 2. Обе
зависимости объявлены в блоке **Interfaces** соответствующей задачи: подписи
там даны дословно, и совпадать они обязаны буквально.

---

### Задача 1: перечисление содержимого набора

**Files:**
- Modify: `backend/src/ruleset/domainSet.ts` (экспортировать `getBit`,
  `countZeros`, `selectIthOne`)
- Create: `backend/src/ruleset/enumerate.ts`
- Test: `backend/test/ruleset-enumerate.test.ts`

**Interfaces:**
- Consumes: `DomainSet`, `readDomainSet` (`./domainSet.js`); `IpCidrSet`,
  `readIpCidrSet` (`./ipcidrSet.js`); `bytesToIp` (`../geo/match.js`).
- Produces:
  ```ts
  export function domainKeys(ds: DomainSet): Generator<string>
  export function cidrsOf(set: IpCidrSet): Generator<string>
  ```
  Обе — генераторы, а не массивы: у `geoip/us` 300 531 диапазон, и материализация
  всего списка ради одной страницы просмотрщика — лишние сотни мегабайт.

**Что здесь легко сделать неверно.** Число ключей в боре НЕ равно `count` из
заголовка `.mrs`: на каждый домен ядро кладёт и сам домен, и его форму
`+.<домен>` (у `faceit.mrs` `count: 2`, ключей 4). Это не ошибка декодера и не
повод фильтровать — `+.faceit.com` такая же законная запись набора. Проверено на
всех четырёх фикстурах.

- [ ] **Шаг 1: написать падающий тест**

Создать `backend/test/ruleset-enumerate.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { readDomainSet } from '../src/ruleset/domainSet.js'
import { readIpCidrSet, type IpCidrSet } from '../src/ruleset/ipcidrSet.js'
import { cidrsOf, domainKeys } from '../src/ruleset/enumerate.js'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'ruleset')
const PLAIN_LIMIT = 32 * 1024 * 1024

function body(name: string) {
  return parseMrs(readFileSync(join(FIXTURES, `${name}.mrs`)), PLAIN_LIMIT)
}

/** Пара «начало+конец» в том виде, в каком её пишет ядро: два раза по 16 байт */
function pair(startV4: number[], endV4: number[]): Uint8Array {
  const out = new Uint8Array(32)
  out.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 0)
  out.set(startV4, 12)
  out.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 16)
  out.set(endV4, 28)
  return out
}

describe('перечисление бора доменов', () => {
  it('faceit отдаёт ровно те четыре ключа, что выписаны в README фикстур', () => {
    const file = body('faceit')
    expect([...domainKeys(readDomainSet(file.body))]).toEqual([
      'faceit.com',
      '+.faceit.com',
      'faceit-cdn.net',
      '+.faceit-cdn.net',
    ])
    // Число ключей и count из заголовка — РАЗНЫЕ числа, и это не ошибка:
    // на каждый домен ядро кладёт и его самого, и форму «+.»
    expect(file.count).toBe(2)
  })

  it('eft и twitch-ads совпадают по числу ключей', () => {
    expect([...domainKeys(readDomainSet(body('eft').body))]).toHaveLength(8)
    const twitch = [...domainKeys(readDomainSet(body('twitch-ads').body))]
    expect(twitch).toHaveLength(10)
    expect(twitch).toContain('gql.twitch.tv')
    expect(twitch).toContain('+.static-cdn.jtvnw.net')
  })

  it('ключи отдаются развёрнутыми: в боре они лежат наоборот', () => {
    // Без разворота вышло бы «moc.ticaf» — тест ловит ровно эту ошибку
    expect([...domainKeys(readDomainSet(body('faceit').body))][0]).toBe('faceit.com')
  })
})

describe('обратное превращение диапазонов в CIDR', () => {
  it('geoip private распадается на семнадцать подсетей', () => {
    const cidrs = [...cidrsOf(readIpCidrSet(body('geoip-private').body))]
    expect(cidrs).toEqual([
      '10.0.0.0/8',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.0.2.0/24',
      '192.88.99.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '198.51.100.0/24',
      '203.0.113.0/24',
      '224.0.0.0/3',
      '::1/128',
      'fc00::/7',
      'fe80::/10',
      'ff00::/8',
    ])
  })

  it('диапазон, не ложащийся в одну подсеть, распадается на несколько', () => {
    // 10.0.0.1—10.0.0.4 не выражается одним CIDR: ровно тот случай, ради
    // которого нужен цикл, а не «взять префикс по длине диапазона»
    const set: IpCidrSet = { v4: [pair([10, 0, 0, 1], [10, 0, 0, 4])], v6: [] }
    expect([...cidrsOf(set)]).toEqual(['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/32'])
  })

  it('диапазон во весь адресный простор даёт нулевой префикс', () => {
    // Ветка «начало равно нулю»: у нуля младшего единичного бита нет, и наивный
    // подсчёт нулевых разрядов зациклился бы
    const set: IpCidrSet = { v4: [pair([0, 0, 0, 0], [255, 255, 255, 255])], v6: [] }
    expect([...cidrsOf(set)]).toEqual(['0.0.0.0/0'])
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/ruleset-enumerate.test.ts`
Ожидается: FAIL, «Cannot find module '../src/ruleset/enumerate.js'».

- [ ] **Шаг 3: открыть хелперы бора**

В `backend/src/ruleset/domainSet.ts` три служебные функции становятся
экспортируемыми — новых реализаций не заводим ни при каких обстоятельствах:

```ts
/**
 * Хелперы бора экспортируются ради перечислителя (`enumerate.ts`): обход
 * пользуется ровно теми же rank/select, что и поиск. Вторая их копия разошлась
 * бы с первой на первом же нестандартном наборе — в плане 1 две реализации
 * одной функции ядра уже разъехались и были пойманы ревью.
 */
export const getBit = (words: Uint32Array, i: number): number => {
```

и так же `export function countZeros(...)`, `export function selectIthOne(...)`.
Тела не трогать.

- [ ] **Шаг 4: написать перечислитель**

Создать `backend/src/ruleset/enumerate.ts`:

```ts
// Перечисление содержимого набора — то, чего не умеет поиск: `has()` отвечает
// про один ключ, а просмотрщику надо показать все.
//
// Обход бора — построчный порт `DomainSet.keys`/`Foreach`
// (`component/trie/domain_set.go`), по тому же правилу, что и `Has`: чужой
// алгоритм пересказу своими словами не подлежит. Ключи внутри лежат
// перевёрнутыми, поэтому наружу они отдаются развёрнутыми обратно — это и
// делает `Foreach` через `utils.Reverse`.
import { bytesToIp } from '../geo/match.js'
import { countZeros, getBit, selectIthOne, type DomainSet } from './domainSet.js'
import type { IpCidrSet } from './ipcidrSet.js'

export function* domainKeys(ds: DomainSet): Generator<string> {
  // `currentKey` оригинала: путь от корня, накапливаемый по байтам меток
  const key: number[] = []

  function* traverse(nodeId: number, bmIdx: number): Generator<string> {
    if (getBit(ds.leaves, nodeId) !== 0) {
      yield String.fromCharCode(...[...key].reverse())
    }
    for (; ; bmIdx++) {
      if (getBit(ds.labelBitmap, bmIdx) !== 0) return
      key.push(ds.labels[bmIdx - nodeId]!)
      const nextNodeId = countZeros(ds, bmIdx + 1)
      const nextBmIdx = selectIthOne(ds, nextNodeId - 1) + 1
      yield* traverse(nextNodeId, nextBmIdx)
      key.pop()
    }
  }

  yield* traverse(0, 0)
}

/** Адрес из 16 байт в целое: диапазоны сравниваются и складываются как числа */
function toBig(pair: Uint8Array, from: number): bigint {
  let v = 0n
  for (let i = 0; i < 16; i++) v = (v << 8n) | BigInt(pair[from + i]!)
  return v
}

function toBytes(value: bigint, v4: boolean): Uint8Array {
  const out = new Uint8Array(16)
  let rest = value
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  // У IPv4 ядро хранит v4-mapped форму; показываем привычные четыре октета
  return v4 ? out.subarray(12) : out
}

/**
 * Диапазон «начало—конец» обратно в подсети. Одним CIDR он выражается далеко не
 * всегда (10.0.0.1—10.0.0.4 — это три подсети), поэтому от начала откусывается
 * наибольший блок, который и выровнен по началу, и помещается в остаток.
 */
export function* cidrsOf(set: IpCidrSet): Generator<string> {
  for (const [ranges, v4] of [
    [set.v4, true],
    [set.v6, false],
  ] as [Uint8Array[], boolean][]) {
    const bits = v4 ? 32n : 128n
    for (const range of ranges) {
      let start = toBig(range, 0)
      const end = toBig(range, 16)
      while (start <= end) {
        // Сколько младших разрядов у начала нулевые — столько бит и можно
        // отдать под хвост подсети. У нуля их «все»: младшего единичного бита
        // там нет, и подсчёт разрядов зациклился бы
        let size = bits
        if (start !== 0n) {
          let zeros = 0n
          while (((start >> zeros) & 1n) === 0n) zeros++
          if (zeros < size) size = zeros
        }
        // ...но не больше, чем осталось до конца диапазона
        while (size > 0n && (1n << size) - 1n > end - start) size--
        yield `${bytesToIp(toBytes(start, v4))}/${bits - size}`
        start += 1n << size
      }
    }
  }
}
```

- [ ] **Шаг 5: убедиться, что тест зелёный**

`npx vitest run test/ruleset-enumerate.test.ts` — Ожидается: PASS, 6 тестов.
Затем `npx vitest run` целиком и `npm run typecheck -w backend`.

- [ ] **Шаг 6: доказать тесты мутациями**

Каждую правку внести, увидеть красное на НАЗВАННОМ утверждении, вернуть обратной
правкой (не `git checkout`):

| Мутация | Что обязано покраснеть |
|---|---|
| убрать `[...key].reverse()` | «ключи отдаются развёрнутыми» |
| `key.pop()` убрать | faceit: ключи склеятся в мусор |
| `if (zeros < size) size = zeros` → `size = zeros` | «во весь адресный простор» (у нуля zeros вышло бы за разрядность) |
| `while (size > 0n && ...)` → `if (...)` | «не ложащийся в одну подсеть» |
| `start += 1n << size` → `start += 1n` | private: подсетей станут миллионы (тест по списку) |

- [ ] **Шаг 7: коммит**

```bash
git add backend/src/ruleset/enumerate.ts backend/src/ruleset/domainSet.ts backend/test/ruleset-enumerate.test.ts
git commit -m "feat(backend): enumerate the contents of a rule set"
```

---

### Задача 2: состояние, обновление и постраничная выдача

**Files:**
- Modify: `backend/src/ruleset/cache.ts` (добавить `peek` и `remove`)
- Modify: `backend/src/ruleset/service.ts`
- Test: `backend/test/ruleset-status.test.ts` (создать)

**Interfaces:**
- Consumes: `domainKeys`, `cidrsOf` из задачи 1.
- Produces (дословно; на эти подписи опираются задачи 3 и 4):
  ```ts
  export interface RuleSetStatusItem {
    name: string
    state: 'ready' | 'missing' | 'error'
    /** Записей по заголовку набора — не число ключей бора */
    count?: number
    /** Размер разобранного содержимого в байтах */
    bytes?: number
    loadedAt?: number
    /** Файл в кэше старше TTL: следующая трассировка перекачает его */
    stale?: boolean
    reason?: string
  }
  export interface RuleSetPage {
    total: number
    offset: number
    /** `count` из заголовка набора — рядом с `total`, и это разные числа */
    count: number
    items: string[]
  }
  class RuleSetService {
    status(sets: RuleSetDescriptor[]): Promise<RuleSetStatusItem[]>
    refresh(sets: RuleSetDescriptor[], names?: string[]): Promise<RuleSetStatusItem[]>
    page(set: RuleSetDescriptor, opts: { offset: number; limit: number; q?: string }): Promise<RuleSetPage>
  }
  ```
  И в ответ `match` добавляется `loadedAt`:
  ```ts
  export type RuleSetAnswer =
    | { state: 'yes' | 'no'; count: number; loadedAt?: number }
    | { state: 'lines'; lines: string[]; count: number; loadedAt?: number }
    | { state: 'unavailable'; reason: string }
  ```

**Решение, которое нужно знать заранее: `status` НЕ качает.** Он отвечает по
кэшу — что лежит на диске, то и показывает. Иначе открытие диалога на документе
с 26 наборами превращалось бы в 26 загрузок, а пользователь думал бы, что
редактор завис. Загрузка — это `refresh`, у неё есть кнопка и видимое ожидание.
Отсюда же честный `state: 'missing'` на пустом кэше: «не загружен» — это правда,
а не отговорка, и рядом стоит кнопка, которая её меняет.

- [ ] **Шаг 1: написать падающий тест**

Создать `backend/test/ruleset-status.test.ts`:

```ts
import { mkdtempSync, readFileSync, utimesSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RuleSetService, type RuleSetDescriptor } from '../src/ruleset/service.js'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'ruleset')
const FACEIT = readFileSync(join(FIXTURES, 'faceit.mrs'))
const PRIVATE = readFileSync(join(FIXTURES, 'geoip-private.mrs'))

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
      return new Response(body)
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
    const { service } = makeService()
    const page = await service.page(httpSet(), { offset: 0, limit: 200, q: 'cdn' })
    expect(page.items).toEqual(['faceit-cdn.net', '+.faceit-cdn.net'])
    expect(page.total).toBe(2)
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
```

- [ ] **Шаг 2: убедиться, что тест падает**

`npx vitest run test/ruleset-status.test.ts` — Ожидается: FAIL,
«service.status is not a function».

- [ ] **Шаг 3: научить кэш заглядывать в файл мимо TTL**

В `backend/src/ruleset/cache.ts` добавить два метода. `read` не трогать: у него
своя задача — отдать файл, ГОДНЫЙ к употреблению.

```ts
  /**
   * Файл как он есть, невзирая на срок годности. Нужен состоянию: просроченный
   * набор — это «загружен тогда-то и будет перекачан», а не «его нет». `read`
   * для этого не годится: он на просрочке возвращает null, и диалог показывал
   * бы «не загружен» на полном каталоге.
   *
   * Отметку обращения здесь НЕ ставим: заглядывание в состояние — не
   * использование набора, и двигать им очередь вытеснения значило бы спасать от
   * вытеснения то, на что никто не ссылается.
   */
  async peek(url: string): Promise<CachedFile | null> {
    const path = join(this.dir, this.nameOf(url))
    try {
      const info = await stat(path)
      return { bytes: await readFile(path), loadedAt: info.mtimeMs }
    } catch {
      return null
    }
  }

  /** Выбросить файл, чтобы следующая загрузка пошла в сеть */
  async remove(url: string): Promise<void> {
    try {
      await rm(join(this.dir, this.nameOf(url)))
    } catch {
      // Файла и не было — цель достигнута
    }
  }
```

- [ ] **Шаг 4: разобранный набор учится перечисляться и помнить время**

В `backend/src/ruleset/service.ts` заменить объявление `Parsed` на:

```ts
interface ParsedBase {
  count: number
  bytes: number
  /** Когда файл скачан; у встроенного набора времени нет — он часть документа */
  loadedAt?: number
  /**
   * Содержимое набора по одной записи. Генератор, а не массив: у `geoip/us`
   * 300 531 диапазон, и материализовать их все ради одной страницы просмотрщика
   * значило бы держать в памяти сотни мегабайт строк
   */
  entries: () => Iterable<string>
}

type Parsed =
  | (ParsedBase & { kind: 'domain'; matcher: DomainMatcher })
  | (ParsedBase & { kind: 'ipcidr'; matcher: IpMatcher })
  | (ParsedBase & { kind: 'classical'; lines: string[] })
```

В `build` для `.mrs` структуры теперь именуются — их берёт и поиск, и обход:

```ts
      if (file.behavior === 'domain') {
        const ds = readDomainSet(file.body)
        return {
          kind: 'domain',
          matcher: domainMatcher(ds),
          entries: () => domainKeys(ds),
          count: file.count,
          bytes: size,
        }
      }
      const ranges = readIpCidrSet(file.body)
      return {
        kind: 'ipcidr',
        matcher: ipMatcher(ranges),
        entries: () => cidrsOf(ranges),
        count: file.count,
        bytes: size,
      }
```

В `fromLines` каждая из трёх веток получает `entries: () => lines`.

Импорт наверху файла:

```ts
import { cidrsOf, domainKeys } from './enumerate.js'
```

- [ ] **Шаг 5: время загрузки доезжает до ответа**

В `loadUncached` заменить хвост:

```ts
    const parsed: Parsed = { ...this.build(set, bytes), loadedAt }
    this.remember(cacheKey, parsed, loadedAt + ttl)
    return parsed
```

В `answer` время попадает в ответ — оно нужно оговорке о давности:

```ts
    if (parsed.kind === 'classical') {
      return { state: 'lines', lines: parsed.lines, count: parsed.count, loadedAt: parsed.loadedAt }
    }
```

и так же в обеих ветках `domain`/`ipcidr` (`loadedAt: parsed.loadedAt` рядом с
`count`). Тип `RuleSetAnswer` — по блоку **Interfaces** выше.

- [ ] **Шаг 6: пул становится общим**

Внутри `match` пул написан вручную. Вынести его — им пользуются все три новых
операции:

```ts
  /**
   * Прогнать задачи с пределом одновременности, сохраняя порядок результатов.
   * Ни одна задача не отклоняется наружу: иначе обход завершился бы на первом
   * же отказе, не дождавшись соседей, и часть наборов осталась бы без ответа.
   */
  private async pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++
        if (index >= items.length) return
        out[index] = await fn(items[index]!)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(this.limits.concurrentDownloads, items.length) }, worker),
    )
    return out
  }
```

`match` переписывается на него; ловля ошибки переезжает внутрь функции-задачи:

```ts
    const results = await this.pool(allowed, async (set) => {
      try {
        return { name: set.name, answer: this.answer(await this.load(set), target) }
      } catch (err) {
        return {
          name: set.name,
          answer: {
            state: 'unavailable' as const,
            reason: err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
          },
        }
      }
    })
    for (const { name, answer } of results) answers[name] = answer
```

- [ ] **Шаг 7: три новые операции**

```ts
  /**
   * Состояние наборов ПО КЭШУ. Сеть здесь не трогается принципиально: документ
   * с 26 наборами превратил бы открытие диалога в 26 загрузок, и пользователь
   * читал бы пустой список секунд десять. Качает `refresh`, у него есть кнопка.
   */
  async status(sets: RuleSetDescriptor[]): Promise<RuleSetStatusItem[]> {
    return this.pool(sets, async (set) => {
      try {
        return await this.statusOf(set)
      } catch (err) {
        return {
          name: set.name,
          state: 'error' as const,
          reason: err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
        }
      }
    })
  }

  private async statusOf(set: RuleSetDescriptor): Promise<RuleSetStatusItem> {
    if (set.kind === 'inline') {
      const lines = set.payload ?? []
      const parsed = this.fromLines(set, lines, lines.join('\n').length)
      return { name: set.name, state: 'ready', count: parsed.count, bytes: parsed.bytes }
    }
    if (set.url === undefined) throw new RuleSetError('У набора не указана ссылка')

    const file = await this.cache.peek(set.url)
    if (file === null) return { name: set.name, state: 'missing' }

    const ttl = Math.max(this.limits.minTtlMs, (set.intervalSec ?? 0) * 1000)
    const cacheKey = `${set.url}|${set.behavior}|${set.format}`
    // Разобранное берём из памяти, если оно там есть: разбор `geoip/us` — это
    // 300 тысяч диапазонов, и повторять его на каждое открытие диалога незачем
    let parsed = this.parsed.get(cacheKey)?.parsed
    if (parsed === undefined) {
      parsed = { ...this.build(set, file.bytes), loadedAt: file.loadedAt }
      this.remember(cacheKey, parsed, file.loadedAt + ttl)
    }
    return {
      name: set.name,
      state: 'ready',
      count: parsed.count,
      bytes: parsed.bytes,
      loadedAt: file.loadedAt,
      stale: Date.now() - file.loadedAt > ttl,
    }
  }

  /**
   * Принудительная перезагрузка. `names` не задан — обновляем всё сетевое.
   * Причина неудачи доезжает до ответа: без неё состояние стало бы «не
   * загружен», и пользователь жал бы кнопку по кругу, не понимая, что не так.
   */
  async refresh(sets: RuleSetDescriptor[], names?: string[]): Promise<RuleSetStatusItem[]> {
    const wanted = sets.filter(
      (set) => set.kind === 'http' && (names === undefined || names.includes(set.name)),
    )
    const failures = new Map<string, string>()
    await this.pool(wanted, async (set) => {
      this.forget(set)
      try {
        await this.load(set)
      } catch (err) {
        failures.set(
          set.name,
          err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
        )
      }
    })
    const items = await this.status(sets)
    return items.map((item) => {
      const reason = failures.get(item.name)
      return reason === undefined ? item : { ...item, state: 'error' as const, reason }
    })
  }

  /** Забыть набор целиком: и разобранное, и файл — иначе `load` вернёт старое */
  private forget(set: RuleSetDescriptor): void {
    if (set.url === undefined) return
    const cacheKey = `${set.url}|${set.behavior}|${set.format}`
    const remembered = this.parsed.get(cacheKey)
    if (remembered !== undefined) {
      this.parsedBytes -= remembered.parsed.bytes
      this.parsed.delete(cacheKey)
    }
    void this.cache.remove(set.url)
  }

  /**
   * Страница содержимого для просмотрщика. В отличие от `status`, качать можно:
   * пользователь сам открыл набор и ждёт именно его.
   *
   * `total` считается по ФАКТИЧЕСКИ перечисленному, а не берётся из заголовка:
   * у набора доменов ключей вдвое больше записей (на каждый домен ядро кладёт
   * и форму `+.`), а при поиске их вообще столько, сколько совпало. Заголовочный
   * `count` едет рядом отдельным полем — оба числа правда, и подменять одно
   * другим нельзя.
   */
  async page(
    set: RuleSetDescriptor,
    opts: { offset: number; limit: number; q?: string },
  ): Promise<RuleSetPage> {
    const parsed = await this.load(set)
    const q = opts.q?.trim().toLowerCase() ?? ''
    const items: string[] = []
    let total = 0
    for (const entry of parsed.entries()) {
      if (q !== '' && !entry.toLowerCase().includes(q)) continue
      total++
      if (total > opts.offset && items.length < opts.limit) items.push(entry)
    }
    return { total, offset: opts.offset, count: parsed.count, items }
  }
```

`forget` зовёт `this.cache.remove` без ожидания намеренно? Нет — ожидание
обязательно, иначе `load` успеет прочитать ещё не удалённый файл. Метод сделать
асинхронным и звать с `await`:

```ts
  private async forget(set: RuleSetDescriptor): Promise<void> {
```

и в `refresh`: `await this.forget(set)`.

- [ ] **Шаг 8: тесты зелёные**

`npx vitest run test/ruleset-status.test.ts`, затем `npx vitest run` целиком
(регрессий в `ruleset-service.test.ts` быть не должно: пул переписан, поведение
прежнее) и `npm run typecheck -w backend`.

- [ ] **Шаг 9: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| в `statusOf` заменить `cache.peek` на `cache.read(set.url, ttl)` | «просроченный файл остаётся годным к показу» |
| в `statusOf` для `http` при пустом кэше звать `this.load(set)` | «на пустом кэше НИЧЕГО не качает» (счётчик) |
| в `refresh` убрать `await this.forget(set)` | «качает заново даже при свежем кэше» |
| в `refresh` не подмешивать `failures` | «неудача доезжает причиной» |
| в `page` считать `total = parsed.count` | «поиск пересчитывает общее число» |
| в `page` убрать `total > opts.offset` | «offset и limit режут страницу» |
| в `answer` убрать `loadedAt` | «в ответе есть время загрузки» |

- [ ] **Шаг 10: коммит**

```bash
git add backend/src/ruleset/service.ts backend/src/ruleset/cache.ts backend/test/ruleset-status.test.ts
git commit -m "feat(backend): rule set status, refresh and content paging"
```

---

### Задача 3: роуты и починка границы запроса

**Files:**
- Modify: `backend/src/routes/tools.ts`
- Test: `backend/test/ruleset-routes.test.ts` (дописать)

**Interfaces:**
- Consumes: `status`, `refresh`, `page`, `RuleSetStatusItem`, `RuleSetPage` из
  задачи 2.
- Produces: три роута:
  - `POST /api/tools/ruleset/status` — `{ sets }` → `{ items: RuleSetStatusItem[] }`
  - `POST /api/tools/ruleset/refresh` — `{ sets, names? }` → `{ items: RuleSetStatusItem[] }`
  - `POST /api/tools/ruleset/page` — `{ descriptor, offset, limit, q? }` → `RuleSetPage`

**Здесь же закрывается находка финального ревью плана 1.** Сегодня схема роута
`match` несёт `.max(200)`, и документ с 201 набором получает `400` на весь
запрос: фронтенд остаётся вовсе без ответов, и КАЖДОЕ правило `RULE-SET`
вырождается в «содержимое редактору неизвестно». Принцип спеки — «предел режет
набор, а не запрос» — держался внутри сервиса и ломался на его границе.

**Решение: предел на запрос меряется в байтах, а не в элементах.** Число
наборов ограничивает сервис и отвечает по каждому лишнему отдельной причиной
(`setsPerDocument`), а роут ставит `bodyLimit`. Так у предела остаётся ровно
один хозяин, и он умеет объяснять. По умолчанию Fastify рубит тело на 1 МБ —
документу со встроенными наборами этого мало, поэтому у наборных роутов свой
потолок 8 МБ, тот же, что у файла на проводе.

- [ ] **Шаг 1: написать падающие тесты**

Дописать в конец `backend/test/ruleset-routes.test.ts`:

```ts
describe('граница запроса не обнуляет ответы', () => {
  it('201 набор — это 200 с причиной по лишним, а не 400 на весь документ', async () => {
    const sets = Array.from({ length: 201 }, (_, i) => ({
      name: `set-${i}`,
      kind: 'inline' as const,
      payload: ['+.example.com'],
      behavior: 'domain' as const,
      format: 'yaml' as const,
    }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: { target: { address: 'a.example.com' }, sets },
    })
    // Отказ на весь запрос превратил бы превышение в неработающую трассировку
    // вместо частичной: 64 набора ответили бы, а «не знаю» получили бы все 201
    expect(res.statusCode).toBe(200)
    const answers = res.json().answers
    expect(answers['set-0']).toMatchObject({ state: 'yes' })
    expect(answers['set-200']).toMatchObject({ state: 'unavailable' })
    expect(answers['set-200'].reason).toMatch(/больше 64 наборов/)
  })

  it('нецелый interval не отказывает запросу целиком', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: {
        target: { address: 'a.example.com' },
        sets: [
          {
            name: 'i',
            kind: 'inline',
            payload: ['+.example.com'],
            behavior: 'domain',
            format: 'yaml',
            intervalSec: -7.5,
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.i).toMatchObject({ state: 'yes' })
  })
})

describe('POST /api/tools/ruleset/status', () => {
  it('требует авторизации', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tools/ruleset/status', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('отвечает состоянием по каждому набору', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/status',
      headers: { cookie },
      payload: {
        sets: [
          { name: 'i', kind: 'inline', payload: ['+.a.com'], behavior: 'domain', format: 'yaml' },
          {
            name: 'net',
            kind: 'http',
            url: 'https://example.com/x.mrs',
            behavior: 'domain',
            format: 'mrs',
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const items = res.json().items as { name: string; state: string }[]
    expect(items.find((i) => i.name === 'i')?.state).toBe('ready')
    expect(items.find((i) => i.name === 'net')?.state).toBe('missing')
  })
})

describe('POST /api/tools/ruleset/refresh', () => {
  it('пробует загрузку и возвращает причину неудачи', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/refresh',
      headers: { cookie },
      payload: {
        sets: [
          {
            name: 'net',
            kind: 'http',
            url: 'https://example.com/x.mrs',
            behavior: 'domain',
            format: 'mrs',
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const item = res.json().items[0]
    expect(item.state).toBe('error')
    // Подменённая сеть отвечает 503 — причина обязана дойти до пользователя
    expect(item.reason).toMatch(/503/)
  })
})

describe('POST /api/tools/ruleset/page', () => {
  it('отдаёт страницу содержимого встроенного набора', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/page',
      headers: { cookie },
      payload: {
        descriptor: {
          name: 'i',
          kind: 'inline',
          payload: ['+.a.com', '+.b.com', '+.c.com'],
          behavior: 'domain',
          format: 'yaml',
        },
        offset: 1,
        limit: 1,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 3, offset: 1, items: ['+.b.com'] })
  })

  it('недоступный набор — 400 с русской причиной, а не 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/page',
      headers: { cookie },
      payload: {
        descriptor: {
          name: 'net',
          kind: 'http',
          url: 'https://example.com/x.mrs',
          behavior: 'domain',
          format: 'mrs',
        },
        offset: 0,
        limit: 10,
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/503/)
  })

  it('запредельный limit отвергается схемой', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/page',
      headers: { cookie },
      payload: {
        descriptor: { name: 'i', kind: 'inline', payload: [], behavior: 'domain', format: 'yaml' },
        offset: 0,
        limit: 5000,
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Шаг 2: убедиться, что тесты падают**

`npx vitest run test/ruleset-routes.test.ts` — Ожидается: FAIL. «201 набор» даёт
400 вместо 200, три новых роута — 404.

- [ ] **Шаг 3: переписать схемы**

В `backend/src/routes/tools.ts` заменить `ruleSetSchema` на общий дескриптор и
четыре схемы поверх него:

```ts
/**
 * Дескриптор набора — общий для всех четырёх наборных роутов.
 *
 * `intervalSec` пропускается через `catch`: значение приходит из чужого
 * документа, и `interval: 1.5` или отрицательное число не повод отказать
 * запросу целиком — сервис сам поднимет срок годности до часа.
 */
const ruleSetDescriptorSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['http', 'inline']),
  url: z.string().optional(),
  payload: z.array(z.string()).optional(),
  behavior: z.enum(['domain', 'ipcidr', 'classical']),
  format: z.enum(['mrs', 'yaml', 'text']),
  intervalSec: z.number().int().nonnegative().optional().catch(undefined),
})

/**
 * Числом наборов запрос НЕ ограничен, и это осознанно. Предел на документ живёт
 * в сервисе (`setsPerDocument`), где по каждому лишнему набору есть отдельная
 * причина; отказ схемой обнулял бы ответы по ВСЕМ наборам сразу — превышение
 * превращалось бы в неработающую трассировку вместо частичной. Границу запроса
 * держит `bodyLimit` ниже: он меряет байты, которых у нас и правда конечное
 * число.
 */
const ruleSetSchema = z.object({
  target: z.object({ address: z.string().min(1), ip: z.string().optional() }),
  sets: z.array(ruleSetDescriptorSchema),
})
const ruleSetStatusSchema = z.object({ sets: z.array(ruleSetDescriptorSchema) })
const ruleSetRefreshSchema = ruleSetStatusSchema.extend({
  names: z.array(z.string()).optional(),
})
const ruleSetPageSchema = z.object({
  descriptor: ruleSetDescriptorSchema,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(200),
  q: z.string().optional(),
})

/** Тот же потолок, что у файла на проводе: документ со встроенными наборами
 *  в стандартный мегабайт Fastify не помещается */
const RULESET_BODY_LIMIT = 8 * 1024 * 1024
```

- [ ] **Шаг 4: роуты**

Заменить существующий роут `match` и добавить три новых:

```ts
  app.post('/api/tools/ruleset/match', { bodyLimit: RULESET_BODY_LIMIT }, async (req) => {
    const { target, sets } = ruleSetSchema.parse(req.body)
    return { answers: await app.ruleset.match(target, sets) }
  })

  app.post('/api/tools/ruleset/status', { bodyLimit: RULESET_BODY_LIMIT }, async (req) => {
    const { sets } = ruleSetStatusSchema.parse(req.body)
    return { items: await app.ruleset.status(sets) }
  })

  app.post('/api/tools/ruleset/refresh', { bodyLimit: RULESET_BODY_LIMIT }, async (req) => {
    const { sets, names } = ruleSetRefreshSchema.parse(req.body)
    return { items: await app.ruleset.refresh(sets, names) }
  })

  app.post('/api/tools/ruleset/page', { bodyLimit: RULESET_BODY_LIMIT }, async (req, reply) => {
    const { descriptor, offset, limit, q } = ruleSetPageSchema.parse(req.body)
    try {
      return await app.ruleset.page(descriptor, { offset, limit, q })
    } catch (err) {
      // Набор недоступен — это состояние набора, а не поломка сервера:
      // просмотрщик обязан показать причину строкой, а не «500»
      if (err instanceof RuleSetError) {
        return reply.status(400).send({ message: err.message })
      }
      throw err
    }
  })
```

Импорт наверху файла: `import { RuleSetError } from '../ruleset/errors.js'`.

- [ ] **Шаг 5: тесты зелёные**

`npx vitest run test/ruleset-routes.test.ts`, затем весь `npx vitest run` и
`npm run typecheck -w backend`.

- [ ] **Шаг 6: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| вернуть `.max(200)` в `ruleSetSchema` | «201 набор — это 200 с причиной» |
| убрать `.catch(undefined)` у `intervalSec` | «нецелый interval не отказывает» |
| убрать `bodyLimit` у роута `match` | тест-довесок ниже |
| в `page` убрать ловлю `RuleSetError` | «400 с русской причиной, а не 500» |
| в `refresh` игнорировать `names` | (проверено на уровне сервиса, задача 2) |

Довесок на `bodyLimit` (дописать в тот же describe) — без него мутация «убрать
`bodyLimit`» остаётся зелёной, а именно она и есть та граница, ради которой всё
переписывалось:

```ts
  it('встроенный набор на два мегабайта проходит: стандартного лимита Fastify мало', async () => {
    const payload = Array.from({ length: 60_000 }, (_, i) => `+.host-${i}.example.com`)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: {
        target: { address: 'host-1.example.com' },
        sets: [{ name: 'big', kind: 'inline', payload, behavior: 'domain', format: 'yaml' }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.big).toMatchObject({ state: 'yes' })
  })
```

- [ ] **Шаг 7: коммит**

```bash
git add backend/src/routes/tools.ts backend/test/ruleset-routes.test.ts
git commit -m "feat(backend): status, refresh and page routes for rule sets"
```

---

### Задача 4: типы и хуки состояния наборов

**Files:**
- Modify: `frontend/src/shared/api/types.ts`
- Modify: `frontend/src/shared/api/hooks.ts`
- Test: `frontend/test/ruleset-hooks.test.tsx` (создать)

**Interfaces:**
- Consumes: роуты задачи 3 (`status`, `refresh`, `page`) и `RuleSetQuery`,
  который уже есть в `types.ts`.
- Produces:
  ```ts
  export interface RuleSetStatusItem {
    name: string
    state: 'ready' | 'missing' | 'error'
    count?: number
    bytes?: number
    loadedAt?: number
    stale?: boolean
    reason?: string
  }
  export function useRuleSetStatus(sets: RuleSetQuery[], enabled?: boolean)
  export function useRefreshRuleSets()   // mutate({ sets, names? })
  export function useRuleSetPage(
    descriptor: RuleSetQuery | null,
    params: { offset: number; limit: number; q: string },
  )
  ```

Слой `shared` не знает про `entities`: форма провода описывается здесь ещё
раз, как уже описан `RuleSetMatchAnswer` рядом с `GeoMatchAnswer`. Это не
дублирование модели, а граница слоёв — та же, что действует у geo.

- [ ] **Шаг 1: написать падающий тест**

Создать `frontend/test/ruleset-hooks.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useRefreshRuleSets,
  useRuleSetPage,
  useRuleSetStatus,
  type RuleSetQuery,
} from '../src/shared/api'

const SET: RuleSetQuery = {
  name: 'ads',
  kind: 'http',
  url: 'https://example.com/ads.mrs',
  behavior: 'domain',
  format: 'mrs',
}

function mockFetch(body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useRuleSetStatus', () => {
  it('без наборов запрос не идёт', () => {
    const fn = mockFetch({ items: [] })
    renderHook(() => useRuleSetStatus([]), { wrapper: wrapperFor(makeClient()) })
    expect(fn).not.toHaveBeenCalled()
  })

  it('возвращает состояние по каждому набору', async () => {
    mockFetch({ items: [{ name: 'ads', state: 'ready', count: 12, loadedAt: 1_700_000_000_000 }] })
    const { result } = renderHook(() => useRuleSetStatus([SET]), {
      wrapper: wrapperFor(makeClient()),
    })
    await waitFor(() => expect(result.current.data?.[0]).toMatchObject({ state: 'ready', count: 12 }))
  })
})

describe('useRefreshRuleSets', () => {
  it('шлёт названные наборы и после успеха просит пересчитать трассировку', async () => {
    const fn = mockFetch({ items: [{ name: 'ads', state: 'ready', count: 12 }] })
    const client = makeClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRefreshRuleSets(), { wrapper: wrapperFor(client) })

    await result.current.mutateAsync({ sets: [SET], names: ['ads'] })

    const body = JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.names).toEqual(['ads'])
    // Вердикты посчитаны по прежнему содержимому набора: не пересчитать их
    // значило бы показывать старый маршрут по новому файлу
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ruleset-match'] })
  })
})

describe('useRuleSetPage', () => {
  it('без набора запрос не идёт', () => {
    const fn = mockFetch({ total: 0, offset: 0, count: 0, items: [] })
    renderHook(() => useRuleSetPage(null, { offset: 0, limit: 200, q: '' }), {
      wrapper: wrapperFor(makeClient()),
    })
    expect(fn).not.toHaveBeenCalled()
  })

  it('передаёт страницу и поиск', async () => {
    const fn = mockFetch({ total: 4, offset: 2, count: 2, items: ['a.com'] })
    const { result } = renderHook(
      () => useRuleSetPage(SET, { offset: 2, limit: 200, q: 'a.c' }),
      { wrapper: wrapperFor(makeClient()) },
    )
    await waitFor(() => expect(result.current.data?.items).toEqual(['a.com']))
    const body = JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toMatchObject({ offset: 2, limit: 200, q: 'a.c' })
    expect(body.descriptor.name).toBe('ads')
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/ruleset-hooks.test.tsx`
Ожидается: FAIL, «useRuleSetStatus is not exported».

- [ ] **Шаг 3: типы**

В `frontend/src/shared/api/types.ts` добавить рядом с `RuleSetMatchAnswer`:

```ts
/**
 * Состояние набора по кэшу редактора. Повторяет `RuleSetStatusItem` бэкенда:
 * слой `shared` не знает про `entities`, поэтому форма провода описана здесь.
 */
export interface RuleSetStatusItem {
  name: string
  state: 'ready' | 'missing' | 'error'
  /** Записей по заголовку набора — не число строк просмотрщика */
  count?: number
  bytes?: number
  loadedAt?: number
  /** Файл старше своего срока годности: следующая трассировка перекачает его */
  stale?: boolean
  reason?: string
}

export interface RuleSetStatusResponse {
  items: RuleSetStatusItem[]
}

export interface RuleSetPageResponse {
  /** Сколько записей нашлось всего (с учётом поиска) */
  total: number
  offset: number
  /** `count` из заголовка набора: у набора доменов он ВДВОЕ меньше `total` */
  count: number
  items: string[]
}
```

И в `RuleSetMatchAnswer` обеим отвечающим ветвям добавить время загрузки:

```ts
export type RuleSetMatchAnswer =
  | { state: 'yes' | 'no'; count: number; loadedAt?: number }
  | { state: 'lines'; lines: string[]; count: number; loadedAt?: number }
  | { state: 'unavailable'; reason: string }
```

- [ ] **Шаг 4: хуки**

В `frontend/src/shared/api/hooks.ts` рядом с `useRuleSetMatch`:

```ts
/**
 * Состояние наборов по кэшу сервера. Сеть здесь не трогается — сервер отвечает
 * тем, что у него уже лежит, поэтому открытие диалога стоит один запрос, а не
 * двадцать шесть загрузок. Качает `useRefreshRuleSets`.
 */
export function useRuleSetStatus(sets: RuleSetQuery[], enabled = true) {
  return useQuery({
    queryKey: ['ruleset-status', sets],
    queryFn: () =>
      apiFetch<RuleSetStatusResponse>('/api/tools/ruleset/status', {
        method: 'POST',
        body: JSON.stringify({ sets }),
      }).then((r) => r.items),
    enabled: enabled && sets.length > 0,
    // Секунды, а не минута: сразу после «Обновить» пользователь смотрит именно
    // сюда, и показать ему прежнее состояние было бы обманом
    staleTime: 5_000,
    retry: false,
  })
}

export function useRefreshRuleSets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { sets: RuleSetQuery[]; names?: string[] }) =>
      apiFetch<RuleSetStatusResponse>('/api/tools/ruleset/refresh', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.items),
    onSuccess: (items, input) => {
      qc.setQueryData(['ruleset-status', input.sets], items)
      // Вердикты трассировки посчитаны по прежнему содержимому: оставить их
      // значило бы показывать старый маршрут по новому файлу
      qc.invalidateQueries({ queryKey: ['ruleset-match'] })
    },
  })
}

/**
 * Страница содержимого набора. В отличие от состояния, здесь сервер качать
 * ИМЕЕТ право: пользователь открыл конкретный набор и ждёт именно его.
 */
export function useRuleSetPage(
  descriptor: RuleSetQuery | null,
  params: { offset: number; limit: number; q: string },
) {
  return useQuery({
    queryKey: ['ruleset-page', descriptor, params.offset, params.limit, params.q],
    queryFn: () =>
      apiFetch<RuleSetPageResponse>('/api/tools/ruleset/page', {
        method: 'POST',
        body: JSON.stringify({ descriptor, ...params }),
      }),
    enabled: descriptor !== null,
    retry: false,
  })
}
```

Импорты типов дописать в существующий блок `import type { ... } from './types'`.

- [ ] **Шаг 5: тесты зелёные**

`npx vitest run test/ruleset-hooks.test.tsx`, затем `npm run typecheck -w frontend`.

- [ ] **Шаг 6: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| `enabled: enabled` (убрать `sets.length > 0`) | «без наборов запрос не идёт» |
| в `useRefreshRuleSets` убрать `invalidateQueries` | «просит пересчитать трассировку» |
| в `useRuleSetPage` убрать `enabled` | «без набора запрос не идёт» |
| в `useRuleSetPage` не класть `params` в тело | «передаёт страницу и поиск» |

- [ ] **Шаг 7: коммит**

```bash
git add frontend/src/shared/api/types.ts frontend/src/shared/api/hooks.ts frontend/test/ruleset-hooks.test.tsx
git commit -m "feat(frontend): hooks for rule set status, refresh and paging"
```

---

### Задача 5: трассировка — пометки о наборе, давность кэша, geo внутри `classical`

**Files:**
- Modify: `frontend/src/entities/mihomo/trace.ts`
- Test: `frontend/test/mihomo-trace.test.ts` (дописать)

**Interfaces:**
- Consumes: поле `loadedAt` в ответе `match` (задача 2).
- Produces:
  ```ts
  export interface MihomoRuleVerdict {
    index: number
    state: MatchState
    target?: string
    reason?: string
    /** Наборы, к чьему содержимому обратилось это правило */
    sets?: { name: string; count: number }[]
  }
  export type RuleSetAnswer =
    | { state: 'yes' | 'no'; count: number; loadedAt?: number }
    | { state: 'lines'; lines: string[]; count: number; loadedAt?: number }
    | { state: 'unavailable'; reason: string }
  export function geoKeysOfRuleSetLines(lines: string[]): string[]
  ```

**Здесь закрывается вторая находка финального ревью плана 1.** Строка
`GEOSITE`/`GEOIP` внутри набора `classical` останавливала проход ВСЕГДА, и
причина вводила в заблуждение: «ответа базы по «geosite:cn» нет» — ответа не
было потому, что мы о нём и не спрашивали. `geoKeysOfMihomo` собирает ключи
только из правил документа, а строки набора приезжают из сети. Ключи из строк
собираются отдельной функцией; спрашивает по ним `useMihomoDraft` (задача 6).

**Слой держим:** `entities` не импортирует `shared` — в проекте такого нет ни
одного случая. Поэтому оговорка о давности НЕ форматирует время (`relativeTime`
живёт в `shared/lib`) и не заводит второго форматтера: она называет факт и
отсылает к диалогу, где время и кнопка «Обновить» уже есть.

- [ ] **Шаг 1: написать падающие тесты**

Дописать в `frontend/test/mihomo-trace.test.ts`:

```ts
describe('пометки о наборе в вердикте', () => {
  const answers = (over: Partial<RuleSetAnswers> = {}): RuleSetAnswers => ({
    answers: { ads: { state: 'yes', count: 15_511 } },
    pending: false,
    ...over,
  })

  it('вердикт правила несёт имя набора и число записей', () => {
    const res = traceMihomo(doc('RULE-SET,ads,REJECT', 'MATCH,D'), T(), NO_GEO, answers())
    // Без числа «не совпало» по набору из ста тысяч доменов неотличимо от
    // «не совпало» по пустому
    expect(res.verdicts[0]!.sets).toEqual([{ name: 'ads', count: 15_511 }])
  })

  it('правило без наборов пометки не несёт', () => {
    const res = traceMihomo(doc('DOMAIN,a.com,A'), T(), NO_GEO, answers())
    expect(res.verdicts[0]!.sets).toBeUndefined()
  })

  it('набор внутри логического условия помечается тоже', () => {
    const res = traceMihomo(
      doc('OR,((DOMAIN,zzz.com),(RULE-SET,ads)),A', 'MATCH,D'),
      T(),
      NO_GEO,
      answers(),
    )
    expect(res.verdicts[0]!.sets).toEqual([{ name: 'ads', count: 15_511 }])
  })

  it('недоступный набор пометки не даёт: содержимого не было', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      { answers: { ads: { state: 'unavailable', reason: '404' } }, pending: false },
    )
    expect(res.verdicts[0]!.sets).toBeUndefined()
    expect(res.stopped?.reason).toMatch(/404/)
  })
})

describe('оговорка о давности кэша', () => {
  const withLoadedAt = (loadedAt: number): RuleSetAnswers => ({
    answers: { ads: { state: 'no', count: 3, loadedAt } },
    pending: false,
  })

  it('набор старше суток даёт оговорку', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      withLoadedAt(Date.now() - 30 * 60 * 60 * 1000),
    )
    expect(res.caveats.join(' ')).toMatch(/«ads»[\s\S]*кэша/)
  })

  it('свежий набор оговорки не даёт: предупреждать не о чем', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      withLoadedAt(Date.now() - 60 * 1000),
    )
    expect(res.caveats.join(' ')).not.toMatch(/кэша/)
  })
})

describe('geo-ключи из строк набора classical', () => {
  it('собирает ключи из строк, включая логические условия', () => {
    expect(
      geoKeysOfRuleSetLines([
        'GEOSITE,cn',
        'DOMAIN,a.com',
        'AND,((GEOIP,ru),(DST-PORT,443))',
        'не правило',
      ]),
    ).toEqual(['geosite:cn', 'geoip:ru'])
  })

  it('повторы не дублируются', () => {
    expect(geoKeysOfRuleSetLines(['GEOSITE,cn', 'GEOSITE,cn'])).toEqual(['geosite:cn'])
  })

  it('строка GEOSITE внутри набора решается, когда ответ базы есть', () => {
    // Ровно тот случай, из-за которого проход вставал на каждом наборе
    // classical с geo-строкой: ключ не попадал в запрос к базе
    const geo: GeoAnswers = { loaded: true, answers: { 'geosite:cn': false }, missing: [] }
    const res = traceMihomo(
      doc('RULE-SET,region,PROXY', 'MATCH,D'),
      T(),
      geo,
      { answers: { region: { state: 'lines', lines: ['GEOSITE,cn'], count: 1 } }, pending: false },
    )
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })
})
```

- [ ] **Шаг 2: убедиться, что тесты падают**

`npx vitest run test/mihomo-trace.test.ts` — Ожидается: FAIL,
«geoKeysOfRuleSetLines is not exported», `verdicts[0].sets` — `undefined`.

- [ ] **Шаг 3: журнал обращений к наборам**

В `interface Ctx` добавить поле рядом с `usedSets`:

```ts
  /**
   * Обращения к содержимому наборов по порядку. `usedSets` отвечает на вопрос
   * «пользовались ли набором вообще» (оговорка про прокси), а здесь нужен
   * порядок: по нему вердикт узнаёт, к каким наборам обратилось ИМЕННО ЭТО
   * правило, не разбирая условие второй раз.
   */
  usedOrder: { name: string; count: number; loadedAt?: number }[]
```

В `traceMihomo` при сборке `ctx` — `usedOrder: []`.

В ветке `RULE-SET`, сразу за `ctx.usedSets.add(payload)`:

```ts
    ctx.usedOrder.push({ name: payload, count: answer.count, loadedAt: answer.loadedAt })
```

- [ ] **Шаг 4: пометка попадает в вердикт**

В типе:

```ts
export interface MihomoRuleVerdict {
  index: number
  state: MatchState
  target?: string
  /** Почему правило не проверено (state === 'unknown') */
  reason?: string
  /**
   * Наборы, к чьему СОДЕРЖИМОМУ обратилось это правило, с числом записей.
   * Пусто у правил без наборов и у набора, который оказался недоступен:
   * содержимого там не было, и хвастаться нечем.
   */
  sets?: { name: string; count: number }[]
}
```

Рядом с `judgeRule` — сборщик среза:

```ts
/**
 * Наборы, к которым обратилось одно правило. Считается срезом журнала
 * обращений, а не вторым разбором условия: `RULE-SET` бывает и внутри
 * `AND`/`OR`/`NOT`, и повторять ради пометки весь спуск незачем.
 */
function setsUsedSince(ctx: Ctx, from: number): MihomoRuleVerdict['sets'] {
  const seen = new Set<string>()
  const out: { name: string; count: number }[] = []
  for (const use of ctx.usedOrder.slice(from)) {
    if (seen.has(use.name)) continue
    seen.add(use.name)
    out.push({ name: use.name, count: use.count })
  }
  return out.length === 0 ? undefined : out
}
```

В цикле `traceMihomo`:

```ts
  for (const entry of entries) {
    const mark = ctx.usedOrder.length
    const res = judgeRule(ctx, entry.rule, new Set())
    const sets = setsUsedSince(ctx, mark)
    verdicts.push({
      index: entry.index,
      state: res.state,
      target: res.target ?? entry.rule?.target,
      reason: res.reason,
      ...(sets === undefined ? {} : { sets }),
    })
```

- [ ] **Шаг 5: оговорка о давности**

Рядом с `proxyCaveats`:

```ts
/**
 * Порог, после которого о кэше стоит предупреждать. Набор, скачанный час назад,
 * предупреждения не стоит — оно превратилось бы в шум на каждой трассировке и
 * перестало бы читаться.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Содержимое набора редактор берёт из своего кэша, и оно может отстать от того,
 * что скачает клиент. Времени здесь НЕ форматируем: `relativeTime` живёт в
 * `shared/lib`, а слой `entities` в проекте `shared` не импортирует, и второй
 * форматтер ради одной строки — это ровно то разъезжание двух реализаций, на
 * котором план 1 уже ловил ошибку. Поэтому называем факт и отсылаем туда, где
 * время и кнопка «Обновить» уже есть.
 */
function cacheAgeCaveats(ctx: Ctx): string[] {
  const now = Date.now()
  const names: string[] = []
  for (const use of ctx.usedOrder) {
    if (use.loadedAt === undefined || now - use.loadedAt <= STALE_AFTER_MS) continue
    if (!names.includes(use.name)) names.push(use.name)
  }
  if (names.length === 0) return []
  const list = names.map((n) => `«${n}»`).join(', ')
  const head = names.length === 1 ? `Набор ${list} лежит` : `Наборы ${list} лежат`
  return [
    `${head} в кэше редактора больше суток — у клиента содержимое может быть новее. Когда набор загружен и как его обновить, показывает диалог «Наборы правил».`,
  ]
}
```

В `collectCaveats` — строкой ниже `caveats.push(...proxyCaveats(ctx))`:

```ts
  caveats.push(...cacheAgeCaveats(ctx))
```

- [ ] **Шаг 6: geo-ключи из строк набора**

Внутри `geoKeysOfMihomo` локальная `fromCond` вынимается наружу — она нужна
обеим сборщицам, и второй её копии в проекте не будет:

```ts
/** Geo-ключи одного условия, включая вложенные в AND/OR/NOT */
function collectGeoKeys(cond: Cond, push: (key: string) => void): void {
  if (cond.type === 'GEOSITE' && cond.payload) return push(`geosite:${cond.payload}`)
  if (cond.type === 'GEOIP' && cond.payload) return push(`geoip:${cond.payload}`)
  if (cond.type === 'AND' || cond.type === 'OR' || cond.type === 'NOT') {
    for (const nested of parseConditions(cond.payload ?? '') ?? []) collectGeoKeys(nested, push)
  }
}
```

`geoKeysOfMihomo` зовёт её вместо своей `fromCond` (тело функции в остальном не
меняется), и рядом появляется вторая:

```ts
/**
 * Geo-ключи из строк набора `behavior: classical`. Строки там — полноценные
 * правила Mihomo, и `GEOSITE`/`GEOIP` встречаются в них наравне с документом.
 *
 * Без этого проход останавливался на КАЖДОМ таком наборе, а причина вводила в
 * заблуждение: «ответа базы по «geosite:cn» нет» — ответа не было потому, что
 * мы о нём не спрашивали. Ключи документа собирает `geoKeysOfMihomo`, а эти
 * приезжают вторым кругом: пока набор не скачан, знать о них неоткуда.
 */
export function geoKeysOfRuleSetLines(lines: string[]): string[] {
  const keys: string[] = []
  const push = (key: string) => {
    if (!keys.includes(key)) keys.push(key)
  }
  for (const line of lines) {
    const entry = parseClassicalEntry(line)
    if (entry === null) continue
    collectGeoKeys({ type: entry.type, payload: entry.payload }, push)
  }
  return keys
}
```

- [ ] **Шаг 7: тесты зелёные**

`npx vitest run test/mihomo-trace.test.ts`, затем весь `npx vitest run`
(`mihomo-trace-acceptance.test.ts` обязан остаться зелёным без правок) и
`npm run typecheck -w frontend`.

- [ ] **Шаг 8: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| `const mark = 0` вместо `ctx.usedOrder.length` | «правило без наборов пометки не несёт» |
| `ctx.usedOrder.push` перенести ВЫШЕ проверки `unavailable` | «недоступный набор пометки не даёт» |
| в `setsUsedSince` убрать дедупликацию | добавить случай `OR,((RULE-SET,ads),(RULE-SET,ads))` — вердикт обязан нести один набор |
| `now - use.loadedAt <= STALE_AFTER_MS` → `>=` | «свежий набор оговорки не даёт» |
| в `geoKeysOfRuleSetLines` не спускаться в `AND` | «собирает ключи из строк, включая логические условия» |

Случай с дедупликацией из третьей строки дописать тестом — мутация обязана быть
поймана существующим тестом, а не остаться на словах:

```ts
  it('один набор в двух ветвях условия помечается один раз', () => {
    const res = traceMihomo(
      doc('OR,((RULE-SET,ads),(RULE-SET,ads)),A', 'MATCH,D'),
      T(),
      NO_GEO,
      { answers: { ads: { state: 'no', count: 7 } }, pending: false },
    )
    expect(res.verdicts[0]!.sets).toEqual([{ name: 'ads', count: 7 }])
  })
```

- [ ] **Шаг 9: коммит**

```bash
git add frontend/src/entities/mihomo/trace.ts frontend/test/mihomo-trace.test.ts
git commit -m "feat(frontend): name the rule set behind a verdict and ask geo about its lines"
```

---

### Задача 6: черновик — диалог, честный отказ, диагностики

**Files:**
- Modify: `frontend/src/features/editor/useMihomoDraft.ts`
- Test: `frontend/test/mihomo-draft.test.tsx` (дописать)

**Interfaces:**
- Consumes: `geoKeysOfRuleSetLines` (задача 5), `RuleSetStatusItem` не нужен —
  диалог спрашивает состояние сам (задача 7).
- Produces (в `MihomoDraft`):
  ```ts
  ruleSetsOpen: boolean
  setRuleSetsOpen: (open: boolean) => void
  /** Дескрипторы наборов документа — их же спрашивает диалог */
  ruleSets: RuleSetDescriptor[]
  /** То, что реально уходит на сервер: только http и inline */
  askedSets: RuleSetQuery[]
  ```

**Три вещи, каждая со своей причиной.**

1. **Честный отказ при сбое запроса.** Сегодня, если запрос `match` не доехал
   (сеть, 500, тело больше предела), ответов нет вовсе — и КАЖДОЕ правило
   `RULE-SET` вырождается в «содержимое редактору неизвестно». Настоящая причина
   теряется по дороге. Отказ обязан называться по каждому спрошенному набору —
   так же, как называется отказ, приехавший с сервера.
2. **Geo-ключи из строк наборов** — вторая половина находки задачи 5.
3. **Предупреждения о недоступных наборах** в общем списке диагностик.

**`validateMihomo` не трогаем.** Проверка «`RULE-SET` ссылается на провайдера,
которого нет в документе» (`validate.ts:168`) остаётся как есть: она про
документ, а не про сеть, и смешивать её с сетевым состоянием значило бы сделать
чистую функцию зависимой от того, ответил ли сервер.

**Почему диагностики собираются здесь, а не в `useDocumentDraft`.** Состояние
наборов выводится из `md`, а `md` приходит ИЗ `useDocumentDraft`: передать их
внутрь — замкнуть круг. Поэтому список склеивается в возвращаемом объекте.
Затронуты ровно два поля: `issues` и `warningCount`. `errorCount` не меняется
(это предупреждения), `nodeIssues` — тоже: у пути `rule-providers` узла графа
нет по устройству (`mihomoNodeIdForPath` возвращает `null`), и перехода с
топологии не будет. В тексте переход работает: `parts` непустой.

- [ ] **Шаг 1: написать падающие тесты**

Дописать в `frontend/test/mihomo-draft.test.tsx` (стиль и обвязку взять из уже
существующих в файле тестов по наборам правил):

```tsx
describe('наборы правил: отказы и диагностики', () => {
  const DOC = [
    'rule-providers:',
    '  ads:',
    '    type: http',
    '    behavior: domain',
    '    format: mrs',
    '    url: https://example.com/ads.mrs',
    '  local:',
    '    type: file',
    '    behavior: domain',
    '    path: ./local.yaml',
    'rules:',
    '  - RULE-SET,ads,REJECT',
    '  - MATCH,PROXY',
    '',
  ].join('\n')

  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )

  /** Куда и с чем ходили: по этому видно, о чём спросили базу */
  let calls: { url: string; body: Record<string, unknown> }[] = []
  /** Ответ ручки наборов держится здесь: тест решает, каким он будет */
  let matchResponse: () => Promise<Response>

  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
    qc.clear()
    calls = []
    matchResponse = () =>
      json({ answers: { ads: { state: 'unavailable', reason: 'не удалось скачать: 404' } } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
        if (url.includes('/api/tools/ruleset/match')) return matchResponse()
        if (url.includes('/api/tools/geo/match')) {
          return json({ loaded: true, answers: {}, missing: [] })
        }
        throw new Error(`Неожиданный запрос: ${url}`)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const target = { address: 'a.com', port: 443, network: 'tcp' as const }

  it('сбой запроса называет причину по каждому спрошенному набору', async () => {
    // Без этого отказ на границе роута обнулял ответы по ВСЕМУ документу, и
    // каждое правило получало общее «содержимое редактору неизвестно»
    matchResponse = () => json({ message: 'Тело великовато' }, 500)
    const { result } = draft(DOC)
    act(() => result.current.setTraceTarget(target))
    await waitFor(
      () => expect(result.current.trace?.stopped?.reason).toMatch(/запрос к серверу не удался/),
      { timeout: 3000 },
    )
    expect(result.current.trace?.stopped?.reason).toMatch(/Тело великовато/)
  })

  it('недоступный набор и набор из файла клиента становятся предупреждениями', async () => {
    const { result } = draft(DOC)
    act(() => result.current.setTraceTarget(target))
    await waitFor(() => expect(result.current.issues.some((i) => i.path.includes('ads'))).toBe(true), {
      timeout: 3000,
    })
    const issue = result.current.issues.find((i) => i.path.includes('ads'))!
    // Предупреждение, а не ошибка: документ корректен, и сохранение не
    // блокируется нашей неспособностью скачать чужой файл
    expect(issue.level).toBe('warning')
    expect(issue.message).toMatch(/404/)
    expect(result.current.issues.some((i) => i.path.includes('local'))).toBe(true)
    // Счётчик в статус-баре обязан их видеть, иначе список и число разойдутся
    expect(result.current.warningCount).toBeGreaterThanOrEqual(2)
  })

  it('без цели трассировки сетевых предупреждений нет: мы ещё не спрашивали', async () => {
    const { result } = draft(DOC)
    await waitFor(() => expect(result.current.md).toBeDefined())
    // Утверждать, что набор недоступен, не спросив о нём, было бы выдумкой
    expect(result.current.issues.some((i) => i.path.includes('ads'))).toBe(false)
    expect(calls).toEqual([])
  })

  it('geo-ключи спрашиваются и по строкам набора classical', async () => {
    const doc = [
      'rule-providers:',
      '  region:',
      '    type: http',
      '    behavior: classical',
      '    url: https://example.com/region.yaml',
      'rules:',
      '  - RULE-SET,region,PROXY',
      '  - MATCH,D',
      '',
    ].join('\n')
    matchResponse = () =>
      json({ answers: { region: { state: 'lines', lines: ['GEOSITE,cn'], count: 1 } } })
    const { result } = draft(doc)
    act(() => result.current.setTraceTarget(target))
    await waitFor(
      () => {
        const geo = calls.filter((c) => c.url.includes('/api/tools/geo/match')).at(-1)
        expect((geo?.body.keys as string[] | undefined) ?? []).toContain('geosite:cn')
      },
      { timeout: 3000 },
    )
    expect(result.current.md).toBeDefined()
  })
})
```

Обвязка (`draft`, `qc`, `useDraftStore`, `act`, `waitFor`) — та, что уже есть в
этом файле от задачи 9 плана 1. Второй обвязки не заводить.

- [ ] **Шаг 2: убедиться, что тесты падают**

`npx vitest run test/mihomo-draft.test.tsx` — Ожидается: FAIL. Причина сбоя не
называется, предупреждений нет, `geosite:cn` в запрос не уходит.

- [ ] **Шаг 3: состояние диалога**

В `useMihomoDraft`:

```ts
  const [ruleSetsOpen, setRuleSetsOpen] = useState(false)
```

и в интерфейсе `MihomoDraft`:

```ts
  ruleSetsOpen: boolean
  setRuleSetsOpen: (open: boolean) => void
  /** Дескрипторы наборов документа: их же показывает диалог «Наборы правил» */
  ruleSets: RuleSetDescriptor[]
  /** Что из них сервер способен достать — только это и уходит на него */
  askedSets: RuleSetQuery[]
```

`ruleSets` и `askedSets` уже вычисляются внутри хука — их достаточно вернуть
наружу, второго вычисления не заводить.

- [ ] **Шаг 4: честный отказ и склейка ответов**

```ts
  /**
   * Запрос мог и не доехать: сеть, 500, тело больше предела роута. Ответов
   * тогда нет ВООБЩЕ, и каждое правило `RULE-SET` вырождается в «содержимое
   * редактору неизвестно» — настоящая причина теряется по дороге. Называем её
   * по каждому спрошенному набору, тем же способом, каким называется отказ,
   * приехавший с сервера.
   */
  const failedAnswers = useMemo<RuleSetAnswers['answers']>(() => {
    if (!ruleSetQuery.isError) return {}
    const reason = `запрос к серверу не удался: ${(ruleSetQuery.error as Error).message}`
    const answers: RuleSetAnswers['answers'] = {}
    for (const set of askedSets) answers[set.name] = { state: 'unavailable', reason }
    return answers
  }, [ruleSetQuery.isError, ruleSetQuery.error, askedSets])
```

Порядок склейки — от менее к более точному; ответ сервера перекрывает всё:

```ts
  const ruleSetAnswers = useMemo<RuleSetAnswers>(
    () => ({
      answers: { ...localAnswers, ...failedAnswers, ...(ruleSetQuery.data?.answers ?? {}) },
      pending: ruleSetQuery.isFetching,
    }),
    [localAnswers, failedAnswers, ruleSetQuery.data, ruleSetQuery.isFetching],
  )
```

- [ ] **Шаг 5: geo-ключи из строк наборов**

```ts
  // Строки набора `classical` — такие же правила Mihomo, и GEOSITE/GEOIP в них
  // надо спрашивать наравне с правилами документа. Ключи приезжают вторым
  // кругом: пока набор не скачан, знать о них неоткуда — поэтому запрос к базе
  // после прихода наборов уходит ещё раз, и это не лишний вызов, а
  // единственный способ узнать вопрос
  const setGeoKeys = useMemo(() => {
    const lines: string[] = []
    for (const answer of Object.values(ruleSetQuery.data?.answers ?? {})) {
      if (answer.state === 'lines') lines.push(...answer.lines)
    }
    return geoKeysOfRuleSetLines(lines)
  }, [ruleSetQuery.data])

  const geoKeys = useMemo(() => {
    const fromDoc = md ? geoKeysOfMihomo(md) : []
    return [...new Set([...fromDoc, ...setGeoKeys])]
  }, [md, setGeoKeys])
```

(существующее вычисление `geoKeys` заменяется этим).

- [ ] **Шаг 6: предупреждения о наборах**

```ts
  /**
   * Недоступный набор — ПРЕДУПРЕЖДЕНИЕ, а не ошибка: документ от нашей
   * неспособности скачать чужой файл корректным быть не перестаёт, и клиент его
   * загрузит. Поэтому сохранение не блокируется.
   *
   * Пока цель трассировки не задана, сетевых ответов нет — и предупреждений о
   * них тоже: утверждать, что набор недоступен, не спросив о нём, было бы
   * выдумкой. А про набор из файла клиента и про незнакомый вид сказать можно
   * сразу: их состояние от сети не зависит.
   */
  const ruleSetIssues = useMemo<ValidationIssue[]>(() => {
    const out: ValidationIssue[] = []
    for (const set of ruleSets) {
      const answer = Object.hasOwn(ruleSetAnswers.answers, set.name)
        ? ruleSetAnswers.answers[set.name]
        : undefined
      if (answer?.state !== 'unavailable') continue
      const parts: PathParts = ['rule-providers', set.name]
      out.push({
        parts,
        path: formatPath(parts),
        message: `Набор правил «${set.name}» редактор проверить не может: ${answer.reason}`,
        level: 'warning',
      })
    }
    return out
  }, [ruleSets, ruleSetAnswers])

  const issues = useMemo(
    () => (ruleSetIssues.length === 0 ? core.issues : [...core.issues, ...ruleSetIssues]),
    [core.issues, ruleSetIssues],
  )
```

В возвращаемом объекте, сразу за `...core`:

```ts
    // Диагностики по наборам приклеиваются здесь, а не в useDocumentDraft:
    // состояние набора выводится из `md`, а `md` приходит ИЗ него — передать их
    // внутрь значило бы замкнуть круг. Меняются ровно два поля: `errorCount`
    // не трогаем (это предупреждения), `nodeIssues` — тоже (узла у пути
    // `rule-providers` на графе нет по устройству графа)
    issues,
    warningCount: core.warningCount + ruleSetIssues.length,
```

Импорты дописать: `formatPath`, `type PathParts`, `type ValidationIssue` из
`'../../entities/xray'`; `geoKeysOfRuleSetLines` — из
`'../../entities/mihomo/trace'`; `type RuleSetDescriptor` — из
`'../../entities/mihomo/ruleSets'`.

- [ ] **Шаг 7: тесты зелёные**

`npx vitest run test/mihomo-draft.test.tsx`, весь `npx vitest run`,
`npm run typecheck -w frontend`.

- [ ] **Шаг 8: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| убрать `failedAnswers` из склейки | «сбой запроса называет причину» |
| поставить `failedAnswers` ПОСЛЕ `ruleSetQuery.data` | добавить проверку: успешный ответ не перекрывается отказом (дописать `expect(...state).toBe('yes')` в существующий тест по наборам) |
| в `ruleSetIssues` ставить `level: 'error'` | «становятся предупреждениями» |
| не складывать `warningCount` | «счётчик в статус-баре обязан их видеть» |
| в `geoKeys` не подмешивать `setGeoKeys` | «geo-ключи спрашиваются и по строкам набора» |

- [ ] **Шаг 9: коммит**

```bash
git add frontend/src/features/editor/useMihomoDraft.ts frontend/test/mihomo-draft.test.tsx
git commit -m "fix(frontend): a failed rule set request names its reason per set"
```

---

### Задача 7: диалог «Наборы правил»

**Files:**
- Create: `frontend/src/shared/lib/format.ts`
- Create: `frontend/src/features/diagnostics/RuleSetsDialog.tsx`
- Modify: `frontend/src/features/templates/MihomoEditorPage.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/ruleset-dialog.test.tsx` (создать)

**Interfaces:**
- Consumes: `useRuleSetStatus`, `useRefreshRuleSets`, `RuleSetQuery`,
  `RuleSetStatusItem` (задача 4); `draft.ruleSets`, `draft.askedSets`,
  `draft.ruleSetsOpen`, `draft.setRuleSetsOpen` (задача 6);
  `RuleSetDescriptor` (`entities/mihomo/ruleSets`).
- Produces:
  ```ts
  export function formatBytes(bytes: number): string
  export function groupDigits(value: number): string   // 15 511, узкий пробел
  export function RuleSetsDialog(props: {
    open: boolean
    onClose: () => void
    sets: RuleSetDescriptor[]
    asked: RuleSetQuery[]
  }): JSX.Element
  ```
  Задача 9 берёт отсюда `groupDigits`, задача 8 — весь файл диалога.

**Эта задача владеет `tokens.css` целиком.** Классы для просмотрщика (задача 8)
и для пометки в панели трассы (задача 9) пишутся здесь же, одним блоком: делить
единственный стилевой файл между параллельными задачами нельзя.

**`megabytes` в `GeoDataDialog` остаётся как есть** и на `formatBytes` НЕ
переводится: geo-база всегда мегабайтная, её подпись покрыта тестами, и правка
ради единообразия сменила бы проверенный текст в чужой задаче. Решение
осознанное, а не недосмотр.

- [ ] **Шаг 1: написать падающий тест**

Создать `frontend/test/ruleset-dialog.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RuleSetsDialog } from '../src/features/diagnostics/RuleSetsDialog'
import type { RuleSetDescriptor } from '../src/entities/mihomo/ruleSets'
import type { RuleSetQuery } from '../src/shared/api'

const SETS: RuleSetDescriptor[] = [
  {
    name: 'ads',
    kind: 'http',
    url: 'https://example.com/ads.mrs',
    behavior: 'domain',
    format: 'mrs',
  },
  { name: 'local', kind: 'file' },
  { name: 'weird', kind: 'unsupported', reason: 'вид набора «чепуха» редактору незнаком' },
]
const ASKED: RuleSetQuery[] = [
  { name: 'ads', kind: 'http', url: 'https://example.com/ads.mrs', behavior: 'domain', format: 'mrs' },
]

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

let bodies: { url: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  qc.clear()
  bodies = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return new Response(
        JSON.stringify({
          items: [
            {
              name: 'ads',
              state: 'ready',
              count: 15_511,
              bytes: 485_000,
              loadedAt: Date.now() - 5 * 60 * 1000,
              stale: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('диалог «Наборы правил»', () => {
  it('показывает состояние сетевого набора', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/загружен/)).toBeInTheDocument())
    expect(screen.getByText('15 511')).toBeInTheDocument()
  })

  it('набор из файла и незнакомый вид показаны со своей причиной, а не спрятаны', async () => {
    // Отсутствие строки читалось бы как «этого набора в документе нет»
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText(/в файле у клиента/)).toBeInTheDocument()
    expect(screen.getByText(/«чепуха»/)).toBeInTheDocument()
  })

  it('«Обновить» шлёт имя одного набора, «Обновить все» — ни одного', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/загружен/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Обновить набор ads' }))
    await waitFor(() =>
      expect(bodies.some((b) => b.url.includes('refresh') && b.body.names !== undefined)).toBe(true),
    )
    expect(bodies.find((b) => b.url.includes('refresh'))!.body.names).toEqual(['ads'])

    await userEvent.click(screen.getByRole('button', { name: 'Обновить все' }))
    await waitFor(() =>
      expect(bodies.filter((b) => b.url.includes('refresh'))).toHaveLength(2),
    )
    expect(bodies.filter((b) => b.url.includes('refresh')).at(-1)!.body.names).toBeUndefined()
  })

  it('у набора из файла кнопки обновления нет: обновлять нечего', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(screen.queryByRole('button', { name: 'Обновить набор local' })).toBeNull()
  })

  it('пустой документ говорит об этом прямо', () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={[]} asked={[]} />, { wrapper })
    expect(screen.getByText(/нет наборов правил/)).toBeInTheDocument()
  })

  it('закрытый диалог не запрашивает состояние', () => {
    render(<RuleSetsDialog open={false} onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(bodies).toEqual([])
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

`npx vitest run test/ruleset-dialog.test.tsx` — Ожидается: FAIL, модуля нет.

- [ ] **Шаг 3: форматирование чисел и размеров**

Создать `frontend/src/shared/lib/format.ts`:

```ts
/** Узкий неразрывный пробел: `15 511` читается, `15511` — нет */
const GROUP_SEPARATOR = ' '

/**
 * Разряды числа через пробел. Своя реализация, а не `toLocaleString`, потому что
 * набор разделителей у Intl зависит от среды: в jsdom и в браузере они разные,
 * и тест либо ловил бы не то, либо сравнивался бы сам с собой.
 */
export function groupDigits(value: number): string {
  const text = String(Math.trunc(Math.abs(value)))
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && (text.length - i) % 3 === 0) out += GROUP_SEPARATOR
    out += text[i]
  }
  return value < 0 ? `-${out}` : out
}

/** Размер файла набора: они бывают и в килобайтах, и в мегабайтах */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}
```

- [ ] **Шаг 4: диалог**

Создать `frontend/src/features/diagnostics/RuleSetsDialog.tsx`:

```tsx
// Состояние наборов правил документа. Сестра `GeoDataDialog`: тот же вопрос
// («что у редактора есть на руках и насколько оно свежее»), заданный про другой
// источник данных.
import type { RuleSetDescriptor } from '../../entities/mihomo/ruleSets'
import {
  useRefreshRuleSets,
  useRuleSetStatus,
  type RuleSetQuery,
  type RuleSetStatusItem,
} from '../../shared/api'
import { formatBytes, groupDigits } from '../../shared/lib/format'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'

/**
 * Причина, известная без сети. Такие наборы показываются наравне с остальными:
 * спрятать строку — значит соврать, что набора нет в документе.
 */
function localReason(set: RuleSetDescriptor): string | null {
  if (set.kind === 'file') return 'лежит в файле у клиента — сервер такой файл не видит'
  if (set.kind === 'unsupported') return set.reason
  return null
}

function stateText(item: RuleSetStatusItem | undefined): string {
  if (item === undefined) return 'состояние ещё не пришло'
  if (item.state === 'missing') return 'ещё не загружен'
  if (item.state === 'error') return item.reason ?? 'не читается'
  const when =
    item.loadedAt === undefined
      ? ''
      : ` ${relativeTime(new Date(item.loadedAt).toISOString())}`
  // Просрочка — не поломка: файл на месте, но следующая трассировка перекачает его
  return item.stale ? `загружен${when}, срок вышел` : `загружен${when}`
}

export function RuleSetsDialog({
  open,
  onClose,
  sets,
  asked,
}: {
  open: boolean
  onClose: () => void
  /** Все наборы документа, включая те, что редактор достать не может */
  sets: RuleSetDescriptor[]
  /** Из них — те, о которых можно спросить сервер */
  asked: RuleSetQuery[]
}) {
  // Спрашиваем только на открытом диалоге: закрытый <dialog> всё равно
  // рендерит содержимое, и без этого условия состояние тянулось бы всегда
  const status = useRuleSetStatus(asked, open)
  const refresh = useRefreshRuleSets()
  const byName = new Map((status.data ?? []).map((item) => [item.name, item]))

  return (
    <Dialog open={open} title="Наборы правил" onClose={onClose}>
      {open && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Наборы нужны трассировщику, чтобы отвечать по условиям{' '}
            <span className="mono">RULE-SET</span>. Редактор качает их напрямую и держит копию у
            себя; клиент качает их сам и может получить другое содержимое.
          </p>

          {sets.length === 0 ? (
            <p className="muted">В документе нет наборов правил: секция rule-providers пуста.</p>
          ) : (
            <>
              <div className="row">
                <span className="muted">{`наборов: ${sets.length}`}</span>
                <span className="spacer" />
                <Button
                  disabled={asked.length === 0 || refresh.isPending}
                  onClick={() => refresh.mutate({ sets: asked })}
                >
                  {refresh.isPending ? 'Обновляю…' : 'Обновить все'}
                </Button>
              </div>

              {status.isError && (
                <p className="field-error">{(status.error as Error).message}</p>
              )}
              {refresh.isError && (
                <p className="field-error">{(refresh.error as Error).message}</p>
              )}

              <ul className="rs-list" aria-label="Наборы правил">
                {sets.map((set) => {
                  const reason = localReason(set)
                  const item = byName.get(set.name)
                  return (
                    <li key={set.name} className="rs-row" data-state={reason ? 'local' : item?.state}>
                      <span className="rs-name mono">{set.name}</span>
                      <span className="rs-tags">
                        {'behavior' in set ? `${set.behavior} · ${set.format}` : '—'}
                      </span>
                      <span className={reason || item?.state === 'error' ? 'field-warning' : 'muted'}>
                        {reason ?? stateText(item)}
                      </span>
                      <span className="rs-metrics">
                        {item?.count !== undefined && (
                          <span className="metric metric-accent">{groupDigits(item.count)}</span>
                        )}
                        {item?.bytes !== undefined && (
                          <span className="metric">{formatBytes(item.bytes)}</span>
                        )}
                      </span>
                      {reason === null && (
                        <Button
                          variant="ghost"
                          aria-label={`Обновить набор ${set.name}`}
                          disabled={refresh.isPending}
                          onClick={() => refresh.mutate({ sets: asked, names: [set.name] })}
                        >
                          Обновить
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
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
  )
}
```

- [ ] **Шаг 5: кнопка в топбаре**

В `frontend/src/features/templates/MihomoEditorPage.tsx` — в `actions`, сразу за
кнопкой «Geo-базы»:

```tsx
          <Button variant="ghost" onClick={() => draft.setRuleSetsOpen(true)}>
            Наборы правил
          </Button>
```

и рядом с `<GeoDataDialog .../>`:

```tsx
      <RuleSetsDialog
        open={draft.ruleSetsOpen}
        onClose={() => draft.setRuleSetsOpen(false)}
        sets={draft.ruleSets}
        asked={draft.askedSets}
      />
```

Импорт: `import { RuleSetsDialog } from '../diagnostics/RuleSetsDialog'`.

- [ ] **Шаг 6: стили — весь блок плана 2 разом**

В конец `frontend/src/shared/ui/tokens.css`:

```css
/* Наборы правил: диалог состояния и просмотрщик содержимого. Свои классы, а не
   переиспользованные geo-*: сходство диалогов внешнее, и связав их одним
   набором правил, мы получили бы правку в geo, ломающую наборы */
.rs-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.rs-row {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) auto minmax(10rem, 1.5fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid var(--rail);
  border-radius: var(--radius-sm);
  background: var(--panel);
}
.rs-row[data-state='error'] { border-color: var(--ember-line); }
.rs-row[data-state='local'] { opacity: 0.85; }
.rs-name { font-size: var(--t-sm); overflow-wrap: anywhere; }
.rs-tags { font-family: var(--font-mono); font-size: 11px; color: var(--ink-dim); }
.rs-metrics { display: flex; gap: 6px; align-items: center; }
.rs-open { text-align: left; background: none; border: 0; padding: 0; color: inherit; cursor: pointer; font: inherit; }
.rs-open:hover { text-decoration: underline; }

.rs-browser { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.rs-browser-head { display: flex; gap: 8px; align-items: center; }
.rs-items {
  list-style: none;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--rail);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  max-height: 46vh;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--t-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rs-pager { display: flex; gap: 8px; align-items: center; }

/* Пометка в разборе трассы: из какого набора пришёл ответ и сколько в нём записей */
.trace-set { font-size: 11px; color: var(--ink-dim); }
.trace-set + .trace-set { margin-left: 8px; }
```

Все переменные здесь — действующие токены файла (`--rail` как бордюр, `--panel`
и `--panel-2` как поверхности, `--radius-sm`, `--t-sm`, `--ember-line`). Новых
токенов не заводить: палитра — это `:root` в начале файла, и добавление имени
туда меняет дизайн-систему, а не одну карточку.

- [ ] **Шаг 7: тесты зелёные**

`npx vitest run test/ruleset-dialog.test.tsx`, весь `npx vitest run`,
`npm run typecheck -w frontend`.

- [ ] **Шаг 8: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| в `useRuleSetStatus(asked, open)` убрать `open` | «закрытый диалог не запрашивает состояние» |
| в списке пропускать наборы с `localReason` | «показаны со своей причиной, а не спрятаны» |
| кнопку «Обновить» рисовать всем | «у набора из файла кнопки нет» |
| в кнопке строки не передавать `names` | «шлёт имя одного набора» |
| `groupDigits` вернуть `String(value)` | «15 511» |

- [ ] **Шаг 9: коммит**

```bash
git add frontend/src/shared/lib/format.ts frontend/src/features/diagnostics/RuleSetsDialog.tsx frontend/src/features/templates/MihomoEditorPage.tsx frontend/src/shared/ui/tokens.css frontend/test/ruleset-dialog.test.tsx
git commit -m "feat(frontend): rule sets dialog with per-set state and refresh"
```

---

### Задача 8: просмотрщик содержимого набора

**Files:**
- Create: `frontend/src/features/diagnostics/RuleSetBrowser.tsx`
- Modify: `frontend/src/features/diagnostics/RuleSetsDialog.tsx` (вкладки и выбор)
- Test: `frontend/test/ruleset-browser.test.tsx` (создать)

**Interfaces:**
- Consumes: `useRuleSetPage` (задача 4), классы `.rs-browser`/`.rs-items`/
  `.rs-pager` (задача 7), `groupDigits` (задача 7).
- Produces:
  ```ts
  export function RuleSetBrowser(props: {
    descriptor: RuleSetQuery | null
    /** Как называется набор в документе — заголовок и подпись пустого состояния */
    onBack: () => void
  }): JSX.Element
  ```

**Число записей и число строк — разные числа, и врать нельзя ни одним.** У
набора доменов ключей в боре вдвое больше, чем записей в заголовке: на каждый
домен ядро кладёт и сам домен, и форму `+.<домен>`. Просмотрщик показывает оба
и объясняет разницу — «показать поменьше, чтобы сошлось» здесь означало бы
скрыть настоящее содержимое набора.

- [ ] **Шаг 1: написать падающий тест**

Создать `frontend/test/ruleset-browser.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RuleSetBrowser } from '../src/features/diagnostics/RuleSetBrowser'
import type { RuleSetQuery } from '../src/shared/api'

const SET: RuleSetQuery = {
  name: 'ads',
  kind: 'http',
  url: 'https://example.com/ads.mrs',
  behavior: 'domain',
  format: 'mrs',
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

let bodies: Record<string, unknown>[] = []
let reply: () => Response

beforeEach(() => {
  qc.clear()
  bodies = []
  reply = () =>
    new Response(
      JSON.stringify({
        total: 4,
        offset: 0,
        count: 2,
        items: ['faceit.com', '+.faceit.com', 'faceit-cdn.net', '+.faceit-cdn.net'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return reply()
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('просмотрщик содержимого набора', () => {
  it('показывает записи и объясняет расхождение с числом в заголовке', async () => {
    render(<RuleSetBrowser descriptor={SET} onBack={() => {}} />, { wrapper })
    await waitFor(() => expect(screen.getByText('faceit.com')).toBeInTheDocument())
    expect(screen.getByText('+.faceit-cdn.net')).toBeInTheDocument()
    // Оба числа названы: 4 строки против 2 записей — это не ошибка декодера
    expect(screen.getByText(/из 4/)).toBeInTheDocument()
    expect(screen.getByText(/в заголовке набора: 2/)).toBeInTheDocument()
  })

  it('поиск уходит на сервер и сбрасывает страницу', async () => {
    render(<RuleSetBrowser descriptor={SET} onBack={() => {}} />, { wrapper })
    await waitFor(() => expect(screen.getByText('faceit.com')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Поиск по набору'), 'cdn')
    await waitFor(() => expect(bodies.at(-1)?.q).toBe('cdn'), { timeout: 3000 })
    expect(bodies.at(-1)?.offset).toBe(0)
  })

  it('отказ показывается строкой, а не пустым списком', async () => {
    reply = () =>
      new Response(JSON.stringify({ message: 'не удалось скачать: 404' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    render(<RuleSetBrowser descriptor={SET} onBack={() => {}} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/404/)).toBeInTheDocument())
  })

  it('без выбранного набора запроса нет', () => {
    render(<RuleSetBrowser descriptor={null} onBack={() => {}} />, { wrapper })
    expect(bodies).toEqual([])
    expect(screen.getByText(/Выберите набор/)).toBeInTheDocument()
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

`npx vitest run test/ruleset-browser.test.tsx` — Ожидается: FAIL, модуля нет.

- [ ] **Шаг 3: просмотрщик**

Создать `frontend/src/features/diagnostics/RuleSetBrowser.tsx`:

```tsx
// Содержимое одного набора постранично. Сестра `GeoBrowser`: тот же приём —
// страницу режет сервер, поиск идёт туда же, в DOM попадает только страница.
import { useState } from 'react'
import { useRuleSetPage, type RuleSetQuery } from '../../shared/api'
import { useDebounced } from '../../shared/lib/useDebounced'
import { groupDigits } from '../../shared/lib/format'
import { Button, TextInput } from '../../shared/ui'

const PAGE_SIZE = 200

export function RuleSetBrowser({
  descriptor,
  onBack,
}: {
  descriptor: RuleSetQuery | null
  onBack: () => void
}) {
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  // Поиск считает сервер: у набора подсетей крупной страны 300 тысяч записей,
  // и гонять их на клиент ради подстроки бессмысленно
  const debounced = useDebounced(query, 600)
  const page = useRuleSetPage(descriptor, { offset, limit: PAGE_SIZE, q: debounced })

  if (descriptor === null) {
    return (
      <div className="rs-browser">
        <p className="muted">Выберите набор на вкладке «Состояние».</p>
      </div>
    )
  }

  const total = page.data?.total ?? 0
  const shown = page.data ? Math.min(total - page.data.offset, PAGE_SIZE) : 0

  return (
    <div className="rs-browser">
      <div className="rs-browser-head">
        <Button variant="ghost" onClick={onBack}>
          ← К списку
        </Button>
        <span className="mono">{descriptor.name}</span>
        <TextInput
          aria-label="Поиск по набору"
          placeholder={descriptor.behavior === 'ipcidr' ? '10.' : 'example.com'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Страница считается от начала: на третьей странице прошлого поиска
            // новый выдал бы пустоту при непустом результате
            setOffset(0)
          }}
        />
      </div>

      {page.isError && <p className="field-error">{(page.error as Error).message}</p>}

      <ul className="rs-items" aria-label="Содержимое набора">
        {(page.data?.items ?? []).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div className="rs-pager">
        <span className="muted">
          {total === 0
            ? page.isPending
              ? 'Загружаю…'
              : 'Ничего не найдено'
            : `показаны ${page.data!.offset + 1}–${page.data!.offset + shown} из ${groupDigits(total)}`}
        </span>
        {page.data !== undefined && descriptor.behavior === 'domain' && (
          // Строк вдвое больше записей: на каждый домен ядро кладёт и его
          // самого, и форму «+.». Промолчать значило бы оставить пользователя с
          // подозрением, что декодер считает вдвое
          <span className="muted">{`в заголовке набора: ${groupDigits(page.data.count)}`}</span>
        )}
        <span className="spacer" />
        <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          ← Назад
        </Button>
        <Button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Вперёд →
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Шаг 4: вкладки в диалоге**

В `RuleSetsDialog` появляется выбор набора. Дописать импорты (`useState` из
`react`, `RuleSetBrowser` из соседнего файла) и состояние:

```tsx
  const [viewing, setViewing] = useState<RuleSetQuery | null>(null)
```

Имя набора в строке становится кнопкой — но только у тех, чьё содержимое сервер
способен достать:

```tsx
                      {reason === null ? (
                        <button
                          type="button"
                          className="rs-name rs-open mono"
                          onClick={() => setViewing(asked.find((a) => a.name === set.name) ?? null)}
                        >
                          {set.name}
                        </button>
                      ) : (
                        <span className="rs-name mono">{set.name}</span>
                      )}
```

Список строк и просмотрщик — взаимоисключающие: `viewing === null` показывает
список, иначе `<RuleSetBrowser descriptor={viewing} onBack={() => setViewing(null)} />`.
Отдельного переключателя вкладок не заводим: у набора одна страница содержимого,
и «вернуться к списку» — единственный обратный ход.

Диалог для просмотра шире: `<Dialog ... wide={viewing !== null}>` — как
`GeoDataDialog` расширяется на вкладке просмотра.

- [ ] **Шаг 5: тесты зелёные и дописанный тест диалога**

В `ruleset-dialog.test.tsx` дописать:

```tsx
  it('клик по имени сетевого набора открывает содержимое', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/загружен/)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'ads' }))
    expect(screen.getByLabelText('Поиск по набору')).toBeInTheDocument()
  })

  it('имя набора из файла кнопкой не становится: смотреть нечего', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(screen.queryByRole('button', { name: 'local' })).toBeNull()
  })
```

Прогнать `npx vitest run test/ruleset-browser.test.tsx test/ruleset-dialog.test.tsx`,
затем весь `npx vitest run` и `npm run typecheck -w frontend`.

- [ ] **Шаг 6: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| в `onChange` поиска убрать `setOffset(0)` | «поиск сбрасывает страницу» |
| убрать подпись «в заголовке набора» | «объясняет расхождение» |
| `enabled` в `useRuleSetPage` игнорировать `descriptor === null` | «без выбранного набора запроса нет» |
| имя делать кнопкой всем | «имя набора из файла кнопкой не становится» |

- [ ] **Шаг 7: коммит**

```bash
git add frontend/src/features/diagnostics/RuleSetBrowser.tsx frontend/src/features/diagnostics/RuleSetsDialog.tsx frontend/test/ruleset-browser.test.tsx frontend/test/ruleset-dialog.test.tsx
git commit -m "feat(frontend): browse the contents of a rule set"
```

---

### Задача 9: пометка о наборе в разборе трассы

**Files:**
- Modify: `frontend/src/features/diagnostics/MihomoTracePanel.tsx`
- Test: `frontend/test/mihomo-trace-panel.test.tsx` (дописать)

**Interfaces:**
- Consumes: `MihomoRuleVerdict.sets` (задача 5), `groupDigits` и класс
  `.trace-set` (задача 7).

**Зачем.** «Не совпало» по набору из ста тысяч доменов и «не совпало» по пустому
набору выглядят одинаково, а значат разное. Число записей рядом с вердиктом —
единственный способ их различить, не открывая диалог.

- [ ] **Шаг 1: написать падающий тест**

Дописать в `frontend/test/mihomo-trace-panel.test.tsx`:

```tsx
describe('пометка о наборе', () => {
  it('называет набор и число записей', () => {
    render(
      <MihomoTracePanel
        result={{
          verdicts: [
            { index: 0, state: 'no', target: 'REJECT', sets: [{ name: 'ads', count: 15_511 }] },
          ],
          winner: { ruleIndex: null, target: 'DIRECT' },
          caveats: [],
        }}
        onClose={() => {}}
        onSelectRule={() => {}}
      />,
    )
    expect(screen.getByText(/набор «ads»/)).toBeInTheDocument()
    expect(screen.getByText(/15 511/)).toBeInTheDocument()
  })

  it('у правила без наборов пометки нет', () => {
    render(
      <MihomoTracePanel
        result={{
          verdicts: [{ index: 0, state: 'no', target: 'REJECT' }],
          winner: { ruleIndex: null, target: 'DIRECT' },
          caveats: [],
        }}
        onClose={() => {}}
        onSelectRule={() => {}}
      />,
    )
    expect(screen.queryByText(/набор «/)).toBeNull()
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

`npx vitest run test/mihomo-trace-panel.test.tsx` — Ожидается: FAIL, текста нет.

- [ ] **Шаг 3: показать пометку**

В `MihomoTracePanel`, в блоке `trace-fields` рядом с причиной:

```tsx
            {(v.reason || v.sets) && (
              <div className="trace-fields">
                {v.reason && (
                  <span className="trace-field" data-state={v.state}>
                    {v.reason}
                  </span>
                )}
                {v.sets?.map((set) => (
                  // «Не совпало» по набору из ста тысяч доменов и «не совпало»
                  // по пустому выглядят одинаково, а значат разное
                  <span key={set.name} className="trace-set">
                    {`набор «${set.name}» — записей: ${groupDigits(set.count)}`}
                  </span>
                ))}
              </div>
            )}
```

Импорт: `import { groupDigits } from '../../shared/lib/format'`.

- [ ] **Шаг 4: тесты зелёные**

`npx vitest run test/mihomo-trace-panel.test.tsx`, весь `npx vitest run`,
`npm run typecheck -w frontend`.

- [ ] **Шаг 5: доказать мутациями**

| Мутация | Что обязано покраснеть |
|---|---|
| условие `(v.reason \|\| v.sets)` → `v.reason` | «называет набор и число записей» |
| `groupDigits(set.count)` → `set.count` | проверка на `15 511` |
| рисовать пометку всегда | «у правила без наборов пометки нет» |

- [ ] **Шаг 6: коммит**

```bash
git add frontend/src/features/diagnostics/MihomoTracePanel.tsx frontend/test/mihomo-trace-panel.test.tsx
git commit -m "feat(frontend): name the rule set and its size in the trace panel"
```

---

### Задача 10: раскладка дока с пятым полем

**Files:**
- Modify: `frontend/e2e/dock-layout.spec.ts`
- Modify (только если измерение того потребует): `frontend/src/shared/ui/tokens.css`

**Interfaces:**
- Consumes: поле «процесс» в `TraceBar` (план 1, задача 10), моки
  `MIHOMO_UUID`/`mockMihomo` (`frontend/e2e/mocks.ts`).

**Порядок здесь обратный обычному: сперва измерение, потом решение.** В прошлый
заход по этой же задаче было сделано три правки CSS и написан e2e — и всё
отменено: замеры показали, что правый край дока одинаков на 1280 и 1000 px, то
есть мерилось не то, а тест оставался зелёным и с выброшенным переносом. Поэтому
задача начинается с проверяемого измерения, и правка появляется, только если
измерение её потребует.

Мерить надо ПЕРЕПОЛНЕНИЕ самой строки (`scrollWidth` против `clientWidth`) и
ширину полей ввода, а не край дока: док — flex-контейнер, и его край остаётся на
месте ровно потому, что содержимое сжимается внутри.

- [ ] **Шаг 1: написать измеряющий тест**

Дописать в `frontend/e2e/dock-layout.spec.ts`:

```ts
import { MIHOMO_UUID, mockMihomo } from './mocks'

// У Mihomo в строке трассировки пять полей вместо четырёх — добавилось
// «Процесс». Проверяем не пиксели, а два свойства: строка не переполняется по
// горизонтали (иначе часть полей физически недостижима) и поля не сжимаются до
// нечитаемого. Мерить край дока бесполезно: он flex-контейнер и остаётся на
// месте как раз потому, что содержимое сжимается внутри него.
for (const width of [1280, 1100, 900]) {
  test(`строка трассировки Mihomo вмещает пять полей на ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockMihomo(page)
    await page.goto(`/templates/${MIHOMO_UUID}`)
    await page.evaluate(() => document.fonts.ready)

    await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
    await expect(page.getByLabel('Процесс')).toBeVisible()

    const bar = page.locator('.trace-bar')
    const metrics = await bar.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      inputs: [...el.querySelectorAll('input')].map((i) => i.getBoundingClientRect().width),
    }))
    // Переполнение означает, что до части полей не добраться ни мышью, ни Tab
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
    // Поле уже 80px — это два-три видимых символа: формально доступно, на деле нет
    expect(Math.min(...metrics.inputs)).toBeGreaterThan(80)
  })
}
```

- [ ] **Шаг 2: запустить и прочитать результат**

```bash
npm run e2e -w frontend -- dock-layout
```

Дальше — развилка, и оба исхода законны:

- **Тест зелёный на всех трёх ширинах.** Правка не нужна: строка уже
  переносится (`.trace-bar` — grid/flex с переносом) либо полей хватает.
  Записать это в отчёт задачи дословно, включая измеренные числа, и перейти к
  шагу 4. Менять CSS «на всякий случай» запрещено: прошлый заход именно так и
  закончился откатом.
- **Тест красный.** Перейти к шагу 3.

- [ ] **Шаг 3: правка, если измерение её потребовало**

Только при красном тесте. Действующее правило — строка 1346 `tokens.css`:

```css
.trace-bar { display: flex; align-items: center; gap: 6px; }
.trace-bar .input { width: 9rem; }
.trace-bar .input[inputmode='numeric'] { width: 4.5rem; }
```

Это flex без переноса с фиксированной шириной полей — то есть на узком экране
поля сжимаются флексом ниже своих `9rem`. Правка ровно из двух строк:

```css
.trace-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.trace-bar .input { width: 9rem; flex: 0 0 auto; }
```

`flex: 0 0 auto` запрещает сжатие, `flex-wrap` уводит лишнее на вторую строку —
док при этом растёт вниз, а не вширь, чего и требует прежний тест файла. После
правки перезапустить шаг 2 и убедиться, что зелены все три ширины И тест
«раскрытый инструмент не растит док вширь».

- [ ] **Шаг 4: коммит**

```bash
git add frontend/e2e/dock-layout.spec.ts
# плюс frontend/src/shared/ui/tokens.css, если шаг 3 выполнялся
git commit -m "test(frontend): the mihomo trace bar fits five fields"
```

---

### Задача 11: документация и сквозная приёмка

**Files:**
- Create: `frontend/test/ruleset-acceptance.test.tsx`
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: всё предыдущее; фикстура
  `frontend/test/fixtures/mihomo/roscomvpn.yaml` (26 провайдеров, 31 правило).

- [ ] **Шаг 1: написать приёмочный тест**

Создать `frontend/test/ruleset-acceptance.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { MihomoEditorPage } from '../src/features/templates/MihomoEditorPage'
import { mihomoFixture } from './helpers'
import { useDraftStore } from '../src/features/editor/draftStore'

const YAML = mihomoFixture('roscomvpn.yaml')
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** Сервер отвечает состоянием на каждый спрошенный набор — как настоящий */
function statusFor(body: { sets: { name: string }[] }) {
  return {
    items: body.sets.map((s) => ({
      name: s.name,
      state: 'ready',
      count: 128,
      bytes: 4096,
      loadedAt: Date.now() - 60_000,
      stale: false,
    })),
  }
}

beforeEach(() => {
  useDraftStore.setState({ drafts: {} })
  qc.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { sets: { name: string }[] }
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (url.includes('/ruleset/status')) return json(statusFor(body))
      if (url.includes('/ruleset/match')) return json({ answers: {} })
      if (url.includes('/geo/match')) return json({ loaded: false, answers: {}, missing: [] })
      throw new Error(`Неожиданный запрос: ${url}`)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('приёмка плана 2 на эталонном шаблоне', () => {
  it('диалог показывает ВСЕ наборы документа, ни один не спрятан', async () => {
    render(
      <MemoryRouter>
        <MihomoEditorPage
          template={{
            uuid: 'u',
            name: 'RoscomVPN',
            templateType: 'MIHOMO',
            encodedTemplateYaml: btoa(unescape(encodeURIComponent(YAML))),
          } as never}
          hash="h"
        />
      </MemoryRouter>,
      { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Наборы правил' }))
    const list = await screen.findByLabelText('Наборы правил')
    // Двадцать шесть провайдеров эталонного шаблона — ровно столько строк
    await waitFor(() => expect(list.querySelectorAll('.rs-row')).toHaveLength(26))
  })
})
```

Если сигнатура `MihomoEditorPage` в тесте потребует иных полей шаблона — взять
их из `frontend/test/mihomo-editor-page.test.tsx`, а не выдумывать.

- [ ] **Шаг 2: тест зелёный**

`npx vitest run test/ruleset-acceptance.test.tsx`, затем весь `npm test`.

- [ ] **Шаг 3: README**

В раздел про диагностику дописать:

```markdown
### Наборы правил Mihomo

Правила `RULE-SET` ссылаются на наборы из `rule-providers`. Редактор скачивает
их сам, чтобы трассировка отвечала не «не знаю», а «попадает» или «не попадает»:

- поддержаны виды `http` и `inline` и все три формата — `mrs`, `yaml`, `text`;
- набор вида `file` лежит на машине клиента, и сервер его не видит: такой набор
  честно помечается недоступным, а не угадывается;
- поле `proxy` у провайдера редактор не использует — он ходит по ссылке
  напрямую. Если клиент качает набор через прокси, содержимое может отличаться;
  трассировка говорит об этом оговоркой;
- скачанное лежит в `DATA_DIR/rulesets/` (имя файла — sha256 от ссылки), срок
  годности берётся из `interval` документа, но не чаще раза в час;
- диалог «Наборы правил» показывает состояние каждого набора, даёт обновить его
  и посмотреть содержимое с поиском.

Недоступный набор — предупреждение, а не ошибка: сохранение он не блокирует.
Клиент скачает его сам, и наша неспособность до него дотянуться документ не
портит.
```

- [ ] **Шаг 4: CLAUDE.md**

В абзац о трассировке Mihomo дописать (рядом с уже описанным `POST
/api/tools/ruleset/match`):

```markdown
  Состояние наборов и их содержимое — три отдельные ручки: `POST
  /api/tools/ruleset/status` (по кэшу, СЕТЬ НЕ ТРОГАЕТ — иначе открытие диалога
  на живом шаблоне превращалось бы в 26 загрузок), `refresh` (принудительная
  перезагрузка одной ссылки или всех) и `page` (постраничное содержимое с
  поиском). У наборных роутов свой `bodyLimit` в 8 МБ: числом наборов запрос НЕ
  ограничен намеренно — предел на документ живёт в сервисе и отвечает причиной
  по каждому лишнему набору, а отказ схемой обнулял бы ответы по всему
  документу. Просмотрщик показывает у набора доменов ВДВОЕ больше строк, чем
  записей в заголовке: на каждый домен ядро кладёт и сам домен, и форму
  `+.<домен>` — оба числа показываются рядом. Недоступный набор становится
  предупреждением в общем списке диагностик (`useMihomoDraft` склеивает их с
  диагностиками документа: состояние набора выводится из `md`, а `md` приходит
  из `useDocumentDraft`, и передать их внутрь значило бы замкнуть круг); узла на
  графе у пути `rule-providers` нет, поэтому переход работает только в тексте.
  Строки набора `classical` идут и в вопрос к geo-базе: `GEOSITE`/`GEOIP` внутри
  них — такие же условия, и без этого проход останавливался на каждом таком
  наборе с причиной «ответа базы нет», хотя мы о нём и не спрашивали.
```

- [ ] **Шаг 5: полная проверка и коммит**

```bash
npm test && npm run build
git add frontend/test/ruleset-acceptance.test.tsx README.md CLAUDE.md
git commit -m "docs: rule set dialog, browser and the three new routes"
```

---

## Приёмка плана

Пять проверяемых строк; каждая закреплена тестом из названной задачи.

| Что | Чем проверяется |
|---|---|
| Диалог показывает ВСЕ 26 наборов эталонного шаблона, включая недоступные | задача 11 |
| Содержимое набора открывается и ищется, а расхождение «строк / записей» объяснено | задача 8 |
| У правила с набором в разборе трассы видно имя набора и число записей | задача 9 |
| Отказ на границе запроса больше не обнуляет ответы по всему документу | задачи 3 и 6 |
| Строка `GEOSITE` внутри набора `classical` больше не останавливает проход | задачи 5 и 6 |

Две последние строки — закрытые находки финального ревью плана 1. Они входят в
приёмку именно потому, что были найдены после того, как план 1 считался
законченным: без теста они вернутся.

## Чего этот план НЕ делает

- **Загрузка набора через прокси провайдера** (`proxy` в `rule-providers`).
  Редактор ходит напрямую; расхождение объясняется оговоркой. Это граница спеки,
  а не недоделка: чтобы пойти через прокси, серверу пришлось бы поднять клиент
  Mihomo.
- **Редактирование содержимого наборов** — они принадлежат чужим репозиториям.
- **Свой конвертер `yaml` → `mrs`** и предпросмотр `.mrs` без скачивания.
- **Наборы правил sing-box** (`rule_set` с `format: binary`) — другой формат,
  свой у SagerNet; он относится к треку sing-box, а не сюда.
- **Показ содержимого набора `file`** — файла у сервера нет и быть не может.

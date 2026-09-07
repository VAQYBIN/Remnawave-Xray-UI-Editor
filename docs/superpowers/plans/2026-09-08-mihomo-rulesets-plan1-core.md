# Наборы правил Mihomo, план 1 — ядро

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОД-НАВЫК: используйте
> superpowers:subagent-driven-development (рекомендуется) либо
> superpowers:executing-plans. Шаги помечены чекбоксами (`- [ ]`).

**Цель:** трассировка Mihomo на эталонном шаблоне доходит до последнего правила,
а не встаёт на четвёртом.

**Архитектура:** бэкенд качает наборы правил по ссылкам из документа, разбирает
три формата (`mrs`, `yaml`, `text`) и отвечает «попадает / не попадает /
недоступен»; фронтенд спрашивает его по затихшему вводу так же, как уже
спрашивает geo-базы, и вдобавок получает необязательное поле «процесс», без
которого проход упирается во вторую стену.

**Технологии:** Node 24 (zstd встроен в `node:zlib`), Fastify, TypeScript,
React 19, vitest.

**Спека:** `docs/superpowers/specs/2026-09-08-mihomo-rulesets-design.md`

## Global Constraints

- Язык UI, сообщений об ошибках и комментариев — **русский**. Коммиты —
  английский conventional style (`feat(backend): ...`).
- В `main` не сливаем. Работа идёт в `dev`.
- **Ни один тест не ходит в сеть.** Фикстуры уже лежат в репозитории (коммит
  `1546b92`), загрузка подменяется, как в тестах geo.
- **Мутационное тестирование — планка приёмки.** Каждый значимый тест
  доказывается поломкой кода и наблюдением красного, затем обратной правкой.
  Никогда не `git checkout --`, никогда не замена на пустую строку.
- Лимиты, значения обязательны к соблюдению дословно:
  | Лимит | Значение |
  |---|---|
  | Файл на проводе | 8 МБ |
  | После распаковки | 32 МБ, через `maxOutputLength` |
  | Наборов на документ | 64 |
  | Кэш на диске | 256 МБ, вытеснение по давности обращения |
  | Разобранное в памяти | 64 МБ |
  | Строк `classical` в ответе | 10 000 |
  | TTL | `interval` из документа, но не чаще раза в час |
- Превышение любого лимита даёт по конкретному набору `unavailable` с причиной,
  а не отказ на весь запрос.
- Порт алгоритма `DomainSet.Has` — **построчный**. Это чужой алгоритм с
  нетривиальным откатом; пересказ своими словами запрещён.
- Ошибки, о которых пользователю говорят, — только `RuleSetError`. Всё
  остальное, что вылетело, — наша ошибка, и она не должна выглядеть как
  состояние набора.
- Никаких `doc.toString()` во фронтенде: модель Mihomo производна от текста.

---

## Раскладка файлов

**Бэкенд**

| Файл | Ответственность | Задача |
|---|---|---|
| `backend/src/net/guard.ts` | `fetchExternalBytes` — потоковая загрузка с потолком | 1 |
| `backend/src/ruleset/errors.ts` | `RuleSetError` | 2 |
| `backend/src/ruleset/mrs.ts` | zstd, заголовок, магия, версия, behavior, count | 2 |
| `backend/src/ruleset/domainSet.ts` | Сжатый бор: чтение и `has(domain)` | 3 |
| `backend/src/ruleset/ipcidrSet.ts` | Диапазоны: чтение и `has(ip)` | 4 |
| `backend/src/ruleset/payload.ts` | Форматы `yaml` и `text` | 5 |
| `backend/src/ruleset/cache.ts` | Файловый кэш, TTL, вытеснение | 6 |
| `backend/src/ruleset/textSets.ts` | Наборы `domain` и `ipcidr`, пришедшие текстом | 7 |
| `backend/src/ruleset/service.ts` | `RuleSetService`: сведение всего вместе | 7 |
| `backend/src/routes/tools.ts` | Роут `POST /api/tools/ruleset/match` | 7 |

**Фронтенд**

| Файл | Ответственность | Задача |
|---|---|---|
| `frontend/src/entities/mihomo/ruleSets.ts` | Дескрипторы провайдеров из документа | 8 |
| `frontend/src/entities/mihomo/trace.ts` | Ответы по наборам, вычисление `classical` | 9 |
| `frontend/src/entities/xray/traceMatch.ts` | Поле `process` в `TraceTarget` | 10 |
| `frontend/src/entities/mihomo/trace.ts` | Шесть типов `PROCESS-*` | 10 |
| `frontend/src/features/diagnostics/TraceBar.tsx` | Поле ввода процесса под пропом | 10 |
| `frontend/src/shared/api/hooks.ts` | `useRuleSetMatch` | 11 |
| `frontend/src/features/editor/useMihomoDraft.ts` | Связывание запроса с трассировкой | 11 |

---

### Задача 1: потолок размера у загрузки

**Файлы:**
- Изменить: `backend/src/net/guard.ts`
- Изменить: `backend/src/geo/service.ts` (перевод на новую функцию)
- Тест: `backend/test/net-guard.test.ts`

**Интерфейсы:**
- Отдаёт: `fetchExternalBytes(url: string, opts?: FetchGuardOptions): Promise<Uint8Array>`
  и новое поле `maxBytes?: number` в `FetchGuardOptions`.

Сегодня `fetchExternal` возвращает `Response`, и размер никто не ограничивает.
У geo предел есть (`MAX_BYTES`, 64 МБ), но проверяется после `arrayBuffer()` —
то есть когда тело уже целиком в памяти. Ссылку на набор задаёт чужой документ,
поэтому читать надо потоком и обрывать на пороге.

- [ ] **Шаг 1: падающий тест**

```ts
// backend/test/net-guard.test.ts — дописать в конец
import { fetchExternalBytes } from '../src/net/guard.js'

/** Ответ с телом из кусков; считает, сколько кусков реально прочитали */
function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const read: number[] = []
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [i, c] of chunks.entries()) {
        read.push(i)
        controller.enqueue(c)
      }
      controller.close()
    },
  })
  return { res: new Response(body, { status: 200, headers }), read }
}

const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34' }]

describe('fetchExternalBytes: потолок размера', () => {
  it('в пределах потолка отдаёт тело целиком', async () => {
    const { res } = streamResponse([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])])
    const out = await fetchExternalBytes('https://example.com/a', {
      fetchImpl: async () => res,
      lookupImpl: PUBLIC_LOOKUP,
      maxBytes: 1024,
    })
    expect([...out]).toEqual([1, 2, 3, 4, 5])
  })

  it('обрывает чтение, когда тело переросло потолок', async () => {
    const { res } = streamResponse([new Uint8Array(10), new Uint8Array(10)])
    await expect(
      fetchExternalBytes('https://example.com/a', {
        fetchImpl: async () => res,
        lookupImpl: PUBLIC_LOOKUP,
        maxBytes: 15,
      }),
    ).rejects.toThrow(/больше 15 байт/)
  })

  it('врущий content-length не спасает: отказ идёт по факту', async () => {
    // Сервер объявил 5 байт, прислал 20 — верим прочитанному, а не заголовку
    const { res } = streamResponse([new Uint8Array(20)], { 'content-length': '5' })
    await expect(
      fetchExternalBytes('https://example.com/a', {
        fetchImpl: async () => res,
        lookupImpl: PUBLIC_LOOKUP,
        maxBytes: 15,
      }),
    ).rejects.toThrow(/больше 15 байт/)
  })

  it('честный content-length отказывает до чтения тела', async () => {
    let bodyTouched = false
    const res = new Response(
      new ReadableStream({
        start(controller) {
          bodyTouched = true
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-length': '999' } },
    )
    await expect(
      fetchExternalBytes('https://example.com/a', {
        fetchImpl: async () => res,
        lookupImpl: PUBLIC_LOOKUP,
        maxBytes: 15,
      }),
    ).rejects.toThrow(/сервер объявил 999/)
    expect(bodyTouched).toBe(false)
  })

  it('не-2xx отказывает с кодом', async () => {
    await expect(
      fetchExternalBytes('https://example.com/a', {
        fetchImpl: async () => new Response('', { status: 404 }),
        lookupImpl: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/404/)
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npx vitest run test/net-guard.test.ts` из `backend`
Ожидается: FAIL, `fetchExternalBytes is not a function`.

- [ ] **Шаг 3: реализация**

```ts
// backend/src/net/guard.ts — в FetchGuardOptions добавить поле
  /**
   * Потолок размера тела в байтах. Читаем потоком и обрываем на пороге:
   * проверка после `arrayBuffer()` опаздывает — к этому моменту ответ уже
   * целиком в памяти, а ссылку задаёт чужой документ.
   */
  maxBytes?: number
```

```ts
// backend/src/net/guard.ts — в конец файла
export async function fetchExternalBytes(
  url: string,
  opts: FetchGuardOptions = {},
): Promise<Uint8Array> {
  const max = opts.maxBytes ?? Number.POSITIVE_INFINITY
  const res = await fetchExternal(url, opts)
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`)

  // Заголовок — только ранний отказ: он может и соврать, и вовсе отсутствовать,
  // поэтому решает всё равно счётчик прочитанного ниже
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    throw new Error(`Ответ больше ${max} байт (сервер объявил ${declared})`)
  }
  if (res.body === null) return new Uint8Array(0)

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) throw new Error(`Ответ больше ${max} байт`)
      chunks.push(value)
    }
  } finally {
    // Отказ на середине обязан закрыть соединение, а не оставить его висеть
    await reader.cancel().catch(() => {})
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}
```

- [ ] **Шаг 4: тест зелёный**

Выполнить: `npx vitest run test/net-guard.test.ts`
Ожидается: PASS.

- [ ] **Шаг 5: перевести geo на новую функцию**

В `backend/src/geo/service.ts` заменить пару `fetchExternal` + `arrayBuffer()` +
проверка `MAX_BYTES` на один вызов:

```ts
      // Ссылку задаёт пользователь: fetchExternal проверяет, что и исходный адрес,
      // и каждый редирект ведут во внешнюю сеть, а не к внутренним сервисам, а
      // потолок обрывает чтение, не дав огромному ответу лечь в память целиком
      const body = await fetchExternalBytes(url, { ...this.net, maxBytes: MAX_BYTES })
      if (body.byteLength === 0) throw new Error(`Пустой ответ при загрузке ${kind}`)
```

Импорт поправить на `fetchExternalBytes`. Константу `MAX_BYTES` оставить как
есть — она про geo-базы, а у наборов правил свой потолок.

- [ ] **Шаг 6: тесты geo не покраснели**

Выполнить: `npx vitest run test/geo-service.test.ts test/geo-routes.test.ts`
Ожидается: PASS. Если стаб в тесте отдавал `Response` без тела-потока —
поправить стаб, а не код: `fetchExternalBytes` читает `res.body`.

- [ ] **Шаг 7: мутации**

Выполнить каждую, убедиться в красном, вернуть обратной правкой:
1. `if (total > max)` → `if (total > max * 2)` — падает «обрывает чтение».
2. Убрать проверку `declared` — падает «честный content-length отказывает до
   чтения тела».
3. `if (!res.ok)` → `if (false)` — падает «не-2xx отказывает с кодом».

- [ ] **Шаг 8: коммит**

```bash
git add backend/src/net/guard.ts backend/src/geo/service.ts backend/test/net-guard.test.ts
git commit -m "feat(backend): cap external download size while streaming"
```

---

### Задача 2: заголовок и распаковка `.mrs`

**Файлы:**
- Создать: `backend/src/ruleset/errors.ts`
- Создать: `backend/src/ruleset/mrs.ts`
- Тест: `backend/test/ruleset-mrs.test.ts`
- Фикстуры: `backend/test/fixtures/ruleset/*.mrs` (уже в репозитории)

**Интерфейсы:**
- Отдаёт: `class RuleSetError extends Error`;
  `type RuleBehavior = 'domain' | 'ipcidr' | 'classical'`;
  `interface MrsFile { behavior: RuleBehavior; count: number; body: Buffer }`;
  `parseMrs(raw: Uint8Array, maxPlainBytes: number): MrsFile`.

Формат разобран в спеке; содержимое фикстур выписано в
`backend/test/fixtures/ruleset/README.md`.

- [ ] **Шаг 1: падающий тест**

```ts
// backend/test/ruleset-mrs.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { RuleSetError } from '../src/ruleset/errors.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const fixture = (name: string): Uint8Array => readFileSync(join(DIR, name))
const MAX = 32 * 1024 * 1024

/** Собрать .mrs с произвольным заголовком — для проверки отказов */
function madeUp(magic: string, version: number, behavior: number, count: bigint): Uint8Array {
  const head = Buffer.alloc(21)
  head.write(magic, 0, 'latin1')
  head[3] = version
  head[4] = behavior
  head.writeBigInt64BE(count, 5)
  head.writeBigInt64BE(0n, 13)
  return zstdCompressSync(head)
}

describe('заголовок .mrs', () => {
  it('читает настоящий набор доменов', () => {
    const file = parseMrs(fixture('faceit.mrs'), MAX)
    expect(file.behavior).toBe('domain')
    expect(file.count).toBe(2)
    expect(file.body.length).toBeGreaterThan(0)
  })

  it('читает настоящий набор подсетей', () => {
    const file = parseMrs(fixture('geoip-private.mrs'), MAX)
    expect(file.behavior).toBe('ipcidr')
    expect(file.count).toBe(17)
  })

  it('версия формата, кроме первой, — отказ с указанием версии', () => {
    expect(() => parseMrs(madeUp('MRS', 2, 0, 1n), MAX)).toThrow(RuleSetError)
    expect(() => parseMrs(madeUp('MRS', 2, 0, 1n), MAX)).toThrow(/версия/i)
  })

  it('чужая подпись — отказ, и не про версию', () => {
    expect(() => parseMrs(madeUp('SRS', 1, 0, 1n), MAX)).toThrow(/подпись|не набор/i)
  })

  it('незнакомый вид набора — отказ с номером байта', () => {
    expect(() => parseMrs(madeUp('MRS', 1, 7, 1n), MAX)).toThrow(/7/)
  })

  it('не-zstd мусор — RuleSetError, а не исключение распаковщика', () => {
    expect(() => parseMrs(new Uint8Array([1, 2, 3, 4]), MAX)).toThrow(RuleSetError)
  })

  it('обрезанный заголовок — отказ, а не чтение за границей буфера', () => {
    expect(() => parseMrs(zstdCompressSync(Buffer.from('MRS\x01\x00')), MAX)).toThrow(RuleSetError)
  })

  it('zstd-бомба отбивается потолком распаковки', () => {
    // 64 МБ нулей сжимаются примерно в две тысячи байт: потолок на проводе
    // такое пропустит, и остановить это может только предел на выходе
    const bomb = zstdCompressSync(Buffer.alloc(64 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(10_000)
    expect(() => parseMrs(bomb, 1024 * 1024)).toThrow(RuleSetError)
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npx vitest run test/ruleset-mrs.test.ts` из `backend`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализация**

```ts
// backend/src/ruleset/errors.ts
/**
 * Отказ, о котором пользователю говорят словами: набор не скачался, формат не
 * тот, размер не влез. Всё, что вылетело НЕ этим классом, — наша ошибка, и
 * показывать её как состояние набора нельзя: пользователь решит, что дело в
 * его документе.
 */
export class RuleSetError extends Error {}
```

```ts
// backend/src/ruleset/mrs.ts
import { zstdDecompressSync } from 'node:zlib'
import { RuleSetError } from './errors.js'

export type RuleBehavior = 'domain' | 'ipcidr' | 'classical'

/** Байт вида набора: constant/provider/interface.go, RuleBehavior.Byte() */
const BEHAVIOR_BY_BYTE: Record<number, RuleBehavior> = {
  0: 'domain',
  1: 'ipcidr',
  2: 'classical',
}

/** Заголовок: подпись, вид, счётчик, зарезервированное поле — 21 байт */
const HEADER_BYTES = 21

export interface MrsFile {
  behavior: RuleBehavior
  /**
   * Число записей ИСХОДНОГО списка, как его записало ядро. В боре доменов
   * ключей вдвое больше: на каждый домен ядро кладёт и его самого, и форму
   * `+.<домен>`. Пользователю показываем это число, а не число ключей.
   */
  count: number
  body: Buffer
}

/**
 * Разбор `.mrs`: весь файл — один zstd-поток, внутри заголовок и тело.
 * Прочитано в `rules/provider/mrs_reader.go`; документации на формат нет.
 */
export function parseMrs(raw: Uint8Array, maxPlainBytes: number): MrsFile {
  let buf: Buffer
  try {
    buf = zstdDecompressSync(raw, { maxOutputLength: maxPlainBytes })
  } catch (err) {
    // Отдельный текст на превышение потолка: «файл не распаковывается» увело бы
    // в сторону испорченного файла, а дело в размере
    const code = (err as { code?: string }).code
    throw new RuleSetError(
      code === 'ERR_BUFFER_TOO_LARGE'
        ? `Распакованный набор больше ${maxPlainBytes} байт`
        : 'Набор не распаковывается: это не zstd или файл испорчен',
    )
  }

  if (buf.length < HEADER_BYTES) throw new RuleSetError('Файл короче заголовка MRS')
  if (buf.subarray(0, 3).toString('latin1') !== 'MRS') {
    throw new RuleSetError('Это не набор правил MRS: подпись не совпала')
  }
  // Версия живёт четвёртым байтом подписи, поэтому о ней отдельный текст:
  // «подпись не совпала» на новом формате ядра сбило бы с толку
  if (buf[3] !== 1) {
    throw new RuleSetError(`Версия формата MRS ${buf[3]} — редактор знает только первую`)
  }

  const behavior = BEHAVIOR_BY_BYTE[buf[4]!]
  if (behavior === undefined) {
    throw new RuleSetError(`Незнакомый вид набора: байт ${buf[4]}`)
  }

  const count = Number(buf.readBigInt64BE(5))
  const extraLen = Number(buf.readBigInt64BE(13))
  if (extraLen < 0 || HEADER_BYTES + extraLen > buf.length) {
    throw new RuleSetError('Испорченный заголовок MRS: неверная длина запаса')
  }

  return { behavior, count, body: buf.subarray(HEADER_BYTES + extraLen) }
}
```

- [ ] **Шаг 4: тест зелёный**

Выполнить: `npx vitest run test/ruleset-mrs.test.ts`
Ожидается: PASS, 8 тестов.

- [ ] **Шаг 5: мутации**

1. `buf[3] !== 1` → `buf[3] !== 2` — падает «версия формата, кроме первой».
2. Убрать `if (buf.length < HEADER_BYTES)` — падает «обрезанный заголовок».
3. `maxOutputLength: maxPlainBytes` → убрать опцию — падает «zstd-бомба».
4. `BEHAVIOR_BY_BYTE[buf[4]!]` → всегда `'domain'` — падает «незнакомый вид».
5. `HEADER_BYTES + extraLen` → `HEADER_BYTES` — падает «читает настоящий набор»
   только если `extraLen > 0`; сегодня он ноль, поэтому мутация ЗЕЛЁНАЯ.
   Это ожидаемо и записывается в отчёт как непокрытая ветка: проверить её
   нечем, пока ядро не начнёт писать запас. Выдумывать `.mrs` с ненулевым
   запасом ради покрытия не нужно — тест на собранном нами файле проверял бы
   нас же.

- [ ] **Шаг 6: коммит**

```bash
git add backend/src/ruleset backend/test/ruleset-mrs.test.ts
git commit -m "feat(backend): parse the mihomo .mrs header"
```
---

### Задача 3: сжатый бор доменов

**Файлы:**
- Создать: `backend/src/ruleset/domainSet.ts`
- Создать: `backend/test/helpers/domainSetBuilder.ts`
- Тест: `backend/test/ruleset-domain-set.test.ts`

**Интерфейсы:**
- Потребляет: `RuleSetError` (задача 2), `MrsFile.body` (задача 2).
- Отдаёт: `interface DomainSet`; `readDomainSet(body: Buffer): DomainSet`;
  `hasDomain(ds: DomainSet, key: string): boolean`;
  `interface DomainMatcher { has(domain: string): boolean }` и
  `domainMatcher(ds: DomainSet): DomainMatcher`.

`DomainMatcher` — общий вид «что-то, у чего можно спросить про домен». Он нужен
задаче 7: наборы `domain` бывают не только в `.mrs`, но и текстовыми, а сервису
всё равно, откуда пришёл ответ. Объявляем его здесь, чтобы у типа было одно
место, а не два.

Внутри `.mrs` с `behavior: domain` лежит succinct trie: две битовые карты и
массив меток. Алгоритм поиска портируется **построчно** из
`component/trie/domain_set.go`.

Два решения по представлению, оба важны для скорости:

- битовые карты храним `Uint32Array`, младшее 32-битное слово каждой
  64-битной пары первым. Тогда бит `i` находится как `words[i >>> 5]`, и
  `BigInt` не нужен вовсе;
- `ranks`/`selects` ядра не читаем (их в файле нет — ядро строит их само),
  а заменяем префиксными суммами единиц по словам. Наивный `select` линейным
  проходом дал бы тот же ответ, но на `geosite/cn.mrs` (111 тысяч доменов) —
  порядка 32 миллионов операций на один запрос.

- [ ] **Шаг 1: строитель наборов для тестов**

Нужен, потому что в фикстурах есть только подстановка `+`, а `*` ядро в этих
наборах не использует. Собрать `.mrs` нам нечем, поэтому строитель отдаёт
готовую структуру, минуя двоичный формат. Живёт **только в тестах**.

```ts
// backend/test/helpers/domainSetBuilder.ts
import type { DomainSet } from '../../src/ruleset/domainSet.js'

/**
 * Порт `DomainTrie.NewDomainSet` из `component/trie/domain_set.go` — ровно
 * настолько, чтобы собирать наборы с подстановками и проверять на них поиск.
 *
 * Осознанное упрощение: разворот строки побайтовый, а в ядре он по рунам. Для
 * ASCII это одно и то же, и все наши тестовые домены — ASCII. На не-ASCII
 * строитель соврал бы, поэтому в тестах их нет.
 *
 * Это НЕ проверка декодера: строитель и читатель написаны одной рукой и могут
 * ошибаться одинаково. Сверка с ядром — на настоящих фикстурах `.mrs`.
 */
export function buildDomainSet(domains: string[]): DomainSet {
  const keys = domains.map((d) => [...d].reverse().join('')).sort()
  if (keys.length === 0) throw new Error('пустой набор')

  const leaves: number[] = []
  const labelBitmap: number[] = []
  const labels: number[] = []

  const setBit = (bm: number[], i: number, v: number): void => {
    while (i >>> 5 >= bm.length) bm.push(0)
    if (v !== 0) bm[i >>> 5]! |= 1 << (i & 31)
  }

  const queue: { s: number; e: number; col: number }[] = [{ s: 0, e: keys.length, col: 0 }]
  let lIdx = 0
  for (let i = 0; i < queue.length; i++) {
    const elt = queue[i]!
    if (elt.col === keys[elt.s]!.length) {
      elt.s++
      setBit(leaves, i, 1)
    }
    for (let j = elt.s; j < elt.e; ) {
      const frm = j
      while (j < elt.e && keys[j]!.charCodeAt(elt.col) === keys[frm]!.charCodeAt(elt.col)) j++
      queue.push({ s: frm, e: j, col: elt.col + 1 })
      labels.push(keys[frm]!.charCodeAt(elt.col))
      setBit(labelBitmap, lIdx, 0)
      lIdx++
    }
    setBit(labelBitmap, lIdx, 1)
    lIdx++
  }
  // Обе карты дотягиваем до одной длины: читатель ходит по ним одинаково
  while (leaves.length < labelBitmap.length) leaves.push(0)

  const words = Uint32Array.from(labelBitmap)
  const ranks = new Int32Array(words.length + 1)
  for (let i = 0; i < words.length; i++) {
    ranks[i + 1] = ranks[i]! + popcount(words[i]!)
  }
  return { leaves: Uint32Array.from(leaves), labelBitmap: words, labels: Uint8Array.from(labels), ranks }
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return (x * 0x01010101) >>> 24
}
```

- [ ] **Шаг 2: падающий тест**

Ожидаемые ответы взяты из `backend/test/fixtures/ruleset/README.md` — они
проверены на настоящих файлах ядра.

```ts
// backend/test/ruleset-domain-set.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { hasDomain, readDomainSet } from '../src/ruleset/domainSet.js'
import { RuleSetError } from '../src/ruleset/errors.js'
import { buildDomainSet } from './helpers/domainSetBuilder.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const MAX = 32 * 1024 * 1024
const load = (name: string) => readDomainSet(parseMrs(readFileSync(join(DIR, name)), MAX).body)

describe('набор доменов из настоящего .mrs', () => {
  const faceit = load('faceit.mrs')

  it('находит сам домен', () => {
    expect(hasDomain(faceit, 'faceit.com')).toBe(true)
    expect(hasDomain(faceit, 'faceit-cdn.net')).toBe(true)
  })

  it('находит поддомены — работает подстановка «+.»', () => {
    expect(hasDomain(faceit, 'www.faceit.com')).toBe(true)
    expect(hasDomain(faceit, 'a.b.faceit.com')).toBe(true)
    expect(hasDomain(faceit, 'cdn.faceit-cdn.net')).toBe(true)
  })

  it('регистр не важен', () => {
    expect(hasDomain(faceit, 'FACEIT.COM')).toBe(true)
    expect(hasDomain(faceit, 'WWW.Faceit.Com')).toBe(true)
  })

  it('граница метки соблюдается', () => {
    // Самая дорогая ошибка декодера: суффиксное сравнение вместо метки
    expect(hasDomain(faceit, 'notfaceit.com')).toBe(false)
    expect(hasDomain(faceit, 'myfaceit.com')).toBe(false)
  })

  it('домен в середине чужого имени не совпадает', () => {
    expect(hasDomain(faceit, 'faceit.com.evil.com')).toBe(false)
  })

  it('обрубки и пустая строка не совпадают', () => {
    expect(hasDomain(faceit, 'com')).toBe(false)
    expect(hasDomain(faceit, '.faceit.com')).toBe(false)
    expect(hasDomain(faceit, '')).toBe(false)
  })

  it('второй настоящий набор читается так же', () => {
    const eft = load('eft.mrs')
    expect(hasDomain(eft, 'escapefromtarkov.com')).toBe(true)
    expect(hasDomain(eft, 'launcher.escapefromtarkov.com')).toBe(true)
    expect(hasDomain(eft, 'tarkov.com')).toBe(true)
    expect(hasDomain(eft, 'faceit.com')).toBe(false)
  })

  it('третий настоящий набор: поддомен третьего уровня', () => {
    const ads = load('twitch-ads.mrs')
    expect(hasDomain(ads, 'gql.twitch.tv')).toBe(true)
    expect(hasDomain(ads, 'x.gql.twitch.tv')).toBe(true)
    expect(hasDomain(ads, 'twitch.tv')).toBe(false)
  })
})

describe('подстановки, которых нет в фикстурах', () => {
  it('«*» заменяет ровно одну метку', () => {
    const ds = buildDomainSet(['*.example.com'])
    expect(hasDomain(ds, 'a.example.com')).toBe(true)
    expect(hasDomain(ds, 'b.example.com')).toBe(true)
    // Две метки «*» не покрывает — этим он и отличается от «+»
    expect(hasDomain(ds, 'a.b.example.com')).toBe(false)
    expect(hasDomain(ds, 'example.com')).toBe(false)
  })

  it('«+» покрывает и сам домен, и любую глубину', () => {
    const ds = buildDomainSet(['+.example.com'])
    expect(hasDomain(ds, 'a.b.c.example.com')).toBe(true)
  })

  it('«*» в середине', () => {
    const ds = buildDomainSet(['a.*.example.com'])
    expect(hasDomain(ds, 'a.x.example.com')).toBe(true)
    expect(hasDomain(ds, 'a.example.com')).toBe(false)
    expect(hasDomain(ds, 'b.x.example.com')).toBe(false)
  })

  it('точный домен рядом с подстановкой не теряется', () => {
    const ds = buildDomainSet(['exact.com', '*.example.com'])
    expect(hasDomain(ds, 'exact.com')).toBe(true)
    expect(hasDomain(ds, 'a.example.com')).toBe(true)
    expect(hasDomain(ds, 'other.org')).toBe(false)
  })
})

describe('испорченный набор доменов', () => {
  it('чужая версия тела — отказ', () => {
    const body = Buffer.alloc(40)
    body[0] = 2
    expect(() => readDomainSet(body)).toThrow(RuleSetError)
  })

  it('длина массива за границей файла — отказ, а не чтение мусора', () => {
    const body = Buffer.alloc(20)
    body[0] = 1
    body.writeBigInt64BE(1_000_000n, 1)
    expect(() => readDomainSet(body)).toThrow(RuleSetError)
  })
})
```

- [ ] **Шаг 3: убедиться, что тест падает**

Выполнить: `npx vitest run test/ruleset-domain-set.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 4: реализация**

```ts
// backend/src/ruleset/domainSet.ts
// Сжатый префиксный бор (succinct trie) из `.mrs` с `behavior: domain`.
// Формат — `component/trie/domain_set_bin.go`, поиск — построчный порт
// `DomainSet.Has` из `component/trie/domain_set.go`. Документации на это нет,
// и пересказ своими словами здесь запрещён: у алгоритма нетривиальный откат по
// подстановке, а неверный ответ выглядел бы как знание.
//
// Ключи в наборе лежат ПЕРЕВЁРНУТЫМИ, поэтому цель читается с конца.
import { RuleSetError } from './errors.js'

/** Байты, значащие для поиска */
const DOT = 0x2e
const STAR = 0x2a // одна метка
const PLUS = 0x2b // всё остальное

export interface DomainSet {
  /**
   * Битовые карты 64-битных слов файла, разложенные по 32-битным: младшее
   * слово пары первым. Тогда бит `i` — это `words[i >>> 5]`, и `BigInt`,
   * который был бы здесь на порядок медленнее, не нужен.
   */
  leaves: Uint32Array
  labelBitmap: Uint32Array
  labels: Uint8Array
  /**
   * Префиксные суммы единиц по словам `labelBitmap`. В файле их нет — ядро
   * строит свои `ranks`/`selects` само. На ответ они не влияют, но без них
   * `select` линеен, а на наборе из ста тысяч доменов это десятки миллионов
   * операций на один запрос.
   */
  ranks: Int32Array
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return (x * 0x01010101) >>> 24
}

const getBit = (words: Uint32Array, i: number): number => {
  const w = words[i >>> 5]
  return w === undefined ? 0 : (w >>> (i & 31)) & 1
}

/** Сколько нулей в карте меток до i-го бита, не включая его */
function countZeros(ds: DomainSet, i: number): number {
  const w = i >>> 5
  const rest = i & 31
  const whole = ds.ranks[Math.min(w, ds.ranks.length - 1)] ?? 0
  const partial = rest === 0 ? 0 : popcount((ds.labelBitmap[w] ?? 0) & ((1 << rest) - 1))
  return i - (whole + partial)
}

/** Позиция k-й единицы в карте меток; нумерация с нуля */
function selectIthOne(ds: DomainSet, k: number): number {
  const words = ds.labelBitmap
  let lo = 0
  let hi = words.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (ds.ranks[mid]! <= k) lo = mid
    else hi = mid - 1
  }
  let seen = ds.ranks[lo]!
  const word = words[lo] ?? 0
  for (let b = 0; b < 32; b++) {
    if (((word >>> b) & 1) !== 0) {
      if (seen === k) return lo * 32 + b
      seen++
    }
  }
  throw new RuleSetError('Испорченный набор доменов: в карте меток не хватает единиц')
}

function readWords(body: Buffer, at: number): { words: Uint32Array; next: number } {
  if (at + 8 > body.length) throw new RuleSetError('Испорченный набор доменов: обрыв на длине массива')
  const n = Number(body.readBigInt64BE(at))
  const start = at + 8
  if (n < 1) throw new RuleSetError('Испорченный набор доменов: пустой массив')
  if (start + n * 8 > body.length) {
    throw new RuleSetError('Испорченный набор доменов: массив выходит за границу файла')
  }
  const words = new Uint32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const off = start + i * 8
    // uint64 записан big-endian; кладём младшую половину первой, чтобы
    // нумерация битов совпала с той, по которой ходит поиск
    words[i * 2] = body.readUInt32BE(off + 4)
    words[i * 2 + 1] = body.readUInt32BE(off)
  }
  return { words, next: start + n * 8 }
}

export function readDomainSet(body: Buffer): DomainSet {
  if (body.length < 1 || body[0] !== 1) {
    throw new RuleSetError(`Версия набора доменов ${body[0] ?? '?'} — редактор знает только первую`)
  }
  let at = 1
  const leaves = readWords(body, at)
  at = leaves.next
  const bitmap = readWords(body, at)
  at = bitmap.next

  if (at + 8 > body.length) throw new RuleSetError('Испорченный набор доменов: обрыв на длине меток')
  const labelsLen = Number(body.readBigInt64BE(at))
  at += 8
  if (labelsLen < 1 || at + labelsLen > body.length) {
    throw new RuleSetError('Испорченный набор доменов: метки выходят за границу файла')
  }

  const words = bitmap.words
  const ranks = new Int32Array(words.length + 1)
  for (let i = 0; i < words.length; i++) ranks[i + 1] = ranks[i]! + popcount(words[i]!)

  return {
    leaves: leaves.words,
    labelBitmap: words,
    labels: body.subarray(at, at + labelsLen),
    ranks,
  }
}

/**
 * Есть ли домен в наборе. Построчный порт `DomainSet.Has`: метка `restart`
 * повторяет `goto RESTART` оригинала, стек хранит точки отката по «*».
 */
export function hasDomain(ds: DomainSet, key: string): boolean {
  if (key.length === 0) return false
  // Читаем цель с конца и приводим ASCII к нижнему регистру на лету — то же
  // самое делает revLowerAt в ядре, не создавая перевёрнутой копии строки
  const revLowerAt = (i: number): number => {
    const c = key.charCodeAt(key.length - 1 - i)
    return c >= 0x41 && c <= 0x5a ? c + 0x20 : c
  }

  let nodeId = 0
  let bmIdx = 0
  const stack: { bmIdx: number; index: number }[] = []

  for (let i = 0; i < key.length; i++) {
    restart: for (;;) {
      const c = revLowerAt(i)
      for (;; bmIdx++) {
        if (getBit(ds.labelBitmap, bmIdx) !== 0) {
          // Метки узла кончились. Если была подстановка «*» — откатываемся к
          // ней и пробуем следующую метку цели; если нет — совпадения нет
          const cursor = stack.pop()
          if (cursor === undefined) return false
          const nextNodeId = countZeros(ds, cursor.bmIdx + 1)
          let nextBmIdx = selectIthOne(ds, nextNodeId - 1) + 1
          let j = cursor.index
          while (j < key.length && revLowerAt(j) !== DOT) j++
          if (j === key.length) {
            if (getBit(ds.leaves, nextNodeId) !== 0) return true
            continue restart
          }
          let moved = false
          for (; nextBmIdx - nextNodeId < ds.labels.length; nextBmIdx++) {
            if (ds.labels[nextBmIdx - nextNodeId] === DOT) {
              bmIdx = nextBmIdx
              nodeId = nextNodeId
              i = j
              moved = true
              break
            }
          }
          if (moved) continue restart
          return false
        }
        const label = ds.labels[bmIdx - nodeId]
        if (label === PLUS) return true
        if (label === STAR) stack.push({ bmIdx, index: i })
        else if (label === c) break
      }
      nodeId = countZeros(ds, bmIdx + 1)
      bmIdx = selectIthOne(ds, nodeId - 1) + 1
      break
    }
  }

  return getBit(ds.leaves, nodeId) !== 0
}

/** Что-то, у чего можно спросить про домен: бор из `.mrs` либо текстовый набор */
export interface DomainMatcher {
  has(domain: string): boolean
}

export const domainMatcher = (ds: DomainSet): DomainMatcher => ({
  has: (domain) => hasDomain(ds, domain),
})
```

- [ ] **Шаг 5: тест зелёный**

Выполнить: `npx vitest run test/ruleset-domain-set.test.ts`
Ожидается: PASS, 15 тестов.

- [ ] **Шаг 6: мутации**

1. `if (label === PLUS) return true` → убрать — падают «находит поддомены» и
   «+ покрывает любую глубину».
2. `if (label === STAR) stack.push(...)` → убрать — падают все три теста про «*».
3. В `revLowerAt` убрать приведение регистра — падает «регистр не важен».
4. `while (j < key.length && revLowerAt(j) !== DOT) j++` → `j = key.length` —
   падает «*» в середине».
5. `return getBit(ds.leaves, nodeId) !== 0` → `return true` — падают «граница
   метки соблюдается» и «обрубки не совпадают».
6. `words[i * 2] = readUInt32BE(off + 4)` и `+ 1` поменять местами — падает
   почти всё: карта читается наоборот.
7. В `selectIthOne` двоичный поиск заменить на `lo = 0` — падают тесты на
   настоящих наборах (на маленьких построенных может и уцелеть).

- [ ] **Шаг 7: коммит**

```bash
git add backend/src/ruleset/domainSet.ts backend/test/helpers/domainSetBuilder.ts backend/test/ruleset-domain-set.test.ts
git commit -m "feat(backend): read and query the mihomo domain set"
```

---

### Задача 4: набор подсетей

**Файлы:**
- Создать: `backend/src/ruleset/ipcidrSet.ts`
- Тест: `backend/test/ruleset-ipcidr-set.test.ts`

**Интерфейсы:**
- Потребляет: `RuleSetError`, `MrsFile.body`, `ipToBytes` из `../geo/match.js`.
- Отдаёт: `interface IpCidrSet`; `readIpCidrSet(body: Buffer): IpCidrSet`;
  `hasIp(set: IpCidrSet, ip: string): boolean`;
  `interface IpMatcher { has(ip: string): boolean }` и
  `ipMatcher(set: IpCidrSet): IpMatcher` — по той же причине, что и
  `DomainMatcher` в задаче 3.

Тело простое: версия, число диапазонов, пары адресов по 16 байт.
**Но порядок диапазонов — не лексикографический по этим 16 байтам.** Ядро
хранит их отсортированными как `netip.Addr`, где все адреса IPv4 идут перед
IPv6. В фикстуре `geoip-private.mrs` это видно прямо: `::1`
(`00…01`) лежит ПОСЛЕ `::ffff:224.0.0.0` (`00…ffff e0000000`). Двоичный поиск по
сырым байтам на таком массиве молча вернул бы неверный ответ, поэтому диапазоны
раскладываются на два семейства, и каждое ищется отдельно.

- [ ] **Шаг 1: падающий тест**

```ts
// backend/test/ruleset-ipcidr-set.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { hasIp, readIpCidrSet } from '../src/ruleset/ipcidrSet.js'
import { RuleSetError } from '../src/ruleset/errors.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const set = readIpCidrSet(parseMrs(readFileSync(join(DIR, 'geoip-private.mrs')), 1 << 20).body)

describe('набор подсетей из настоящего .mrs', () => {
  it('ловит приватные диапазоны IPv4', () => {
    expect(hasIp(set, '10.0.0.1')).toBe(true)
    expect(hasIp(set, '192.168.1.1')).toBe(true)
    expect(hasIp(set, '172.16.0.1')).toBe(true)
    expect(hasIp(set, '127.0.0.1')).toBe(true)
    expect(hasIp(set, '100.64.0.1')).toBe(true) // CGNAT
  })

  it('не ловит публичные', () => {
    expect(hasIp(set, '8.8.8.8')).toBe(false)
    expect(hasIp(set, '1.1.1.1')).toBe(false)
    expect(hasIp(set, '93.184.216.34')).toBe(false)
  })

  it('края диапазона входят в него', () => {
    expect(hasIp(set, '172.16.0.0')).toBe(true)
    expect(hasIp(set, '172.31.255.255')).toBe(true)
    expect(hasIp(set, '172.15.255.255')).toBe(false)
    expect(hasIp(set, '172.32.0.0')).toBe(false)
  })

  it('IPv6 ищется в своём семействе, а не по сырым байтам', () => {
    // Массив отсортирован как netip.Addr: сначала все IPv4, потом IPv6, и
    // «::1» лежит ПОСЛЕ «::ffff:224.0.0.0». Поиск по сырым 16 байтам сломался бы
    expect(hasIp(set, '::1')).toBe(true)
    expect(hasIp(set, 'fc00::1')).toBe(true)
    expect(hasIp(set, 'fe80::1')).toBe(true)
    expect(hasIp(set, '2606:4700:4700::1111')).toBe(false)
  })

  it('неразбираемый адрес — не совпадение, а не исключение', () => {
    expect(hasIp(set, 'не адрес')).toBe(false)
    expect(hasIp(set, '')).toBe(false)
  })

  it('чужая версия тела — отказ', () => {
    const body = Buffer.alloc(40)
    body[0] = 2
    expect(() => readIpCidrSet(body)).toThrow(RuleSetError)
  })

  it('число диапазонов больше файла — отказ', () => {
    const body = Buffer.alloc(20)
    body[0] = 1
    body.writeBigInt64BE(9999n, 1)
    expect(() => readIpCidrSet(body)).toThrow(RuleSetError)
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npx vitest run test/ruleset-ipcidr-set.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализация**

```ts
// backend/src/ruleset/ipcidrSet.ts
// Набор подсетей из `.mrs` с `behavior: ipcidr`. Формат —
// `component/cidr/ipcidr_set_bin.go`: версия, число диапазонов, затем пары
// адресов по 16 байт (начало и конец включительно).
import { ipToBytes } from '../geo/match.js'
import { RuleSetError } from './errors.js'

/** Префикс IPv4-mapped адреса: ядро пишет каждый адрес через As16() */
const V4_MAPPED_PREFIX = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])

export interface IpCidrSet {
  /**
   * Диапазоны, разложенные по семействам. В файле они отсортированы как
   * `netip.Addr`, где ЛЮБОЙ IPv4 меньше любого IPv6, — а не по сырым 16
   * байтам: «::1» лежит после «::ffff:224.0.0.0». Общий двоичный поиск по
   * такому массиву вернул бы неверный ответ, поэтому семейства разделены, и
   * каждое отсортировано внутри себя.
   */
  v4: Uint8Array[]
  v6: Uint8Array[]
}

const isV4Mapped = (a: Uint8Array): boolean =>
  V4_MAPPED_PREFIX.every((b, i) => a[i] === b)

/** Лексикографическое сравнение адресов одной длины */
function compare(a: Uint8Array, b: Uint8Array, bFrom: number): number {
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[bFrom + i]!
    if (d !== 0) return d
  }
  return 0
}

export function readIpCidrSet(body: Buffer): IpCidrSet {
  if (body.length < 1 || body[0] !== 1) {
    throw new RuleSetError(`Версия набора подсетей ${body[0] ?? '?'} — редактор знает только первую`)
  }
  if (body.length < 9) throw new RuleSetError('Испорченный набор подсетей: обрыв на длине')
  const n = Number(body.readBigInt64BE(1))
  if (n < 1) throw new RuleSetError('Испорченный набор подсетей: пустой список')
  if (9 + n * 32 > body.length) {
    throw new RuleSetError('Испорченный набор подсетей: список выходит за границу файла')
  }

  const v4: Uint8Array[] = []
  const v6: Uint8Array[] = []
  for (let i = 0; i < n; i++) {
    const at = 9 + i * 32
    // Пара «начало + конец» хранится одним куском в 32 байта: так сравнение
    // не создаёт срезов на каждом шаге двоичного поиска
    const pair = new Uint8Array(body.subarray(at, at + 32))
    ;(isV4Mapped(pair.subarray(0, 16)) ? v4 : v6).push(pair)
  }
  return { v4, v6 }
}

/** Попадает ли адрес хотя бы в один диапазон набора */
export function hasIp(set: IpCidrSet, ip: string): boolean {
  const bytes = ipToBytes(ip)
  if (bytes === null) return false

  // Приводим к тем же 16 байтам, какими ядро записало диапазон: у IPv4 это
  // v4-mapped форма
  const key = new Uint8Array(16)
  if (bytes.length === 4) {
    key.set(V4_MAPPED_PREFIX, 0)
    key.set(bytes, 12)
  } else {
    key.set(bytes, 0)
  }
  const ranges = bytes.length === 4 ? set.v4 : set.v6
  if (ranges.length === 0) return false

  // Последний диапазон, начало которого не больше адреса
  let lo = 0
  let hi = ranges.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (compare(key, ranges[mid]!, 0) >= 0) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return false
  // Конец диапазона включительный — вторые 16 байт пары
  return compare(key, ranges[found]!, 16) <= 0
}

/** Что-то, у чего можно спросить про адрес: набор из `.mrs` либо текстовый */
export interface IpMatcher {
  has(ip: string): boolean
}

export const ipMatcher = (set: IpCidrSet): IpMatcher => ({ has: (ip) => hasIp(set, ip) })
```

- [ ] **Шаг 4: тест зелёный**

Выполнить: `npx vitest run test/ruleset-ipcidr-set.test.ts`
Ожидается: PASS, 7 тестов.

- [ ] **Шаг 5: мутации**

1. Слить семейства в один массив и искать по нему — падает «IPv6 ищется в своём
   семействе».
2. `compare(key, ranges[found]!, 16) <= 0` → `< 0` — падает «края диапазона
   входят в него» на `172.31.255.255`.
3. `compare(key, ranges[mid]!, 0) >= 0` → `> 0` — падает «края диапазона» на
   `172.16.0.0`.
4. У IPv4 не подставлять `V4_MAPPED_PREFIX` — падают «ловит приватные
   диапазоны IPv4».
5. `if (bytes === null) return false` → `throw` — падает «неразбираемый адрес».

- [ ] **Шаг 6: коммит**

```bash
git add backend/src/ruleset/ipcidrSet.ts backend/test/ruleset-ipcidr-set.test.ts
git commit -m "feat(backend): read and query the mihomo ipcidr set"
```

---

### Задача 5: текстовые форматы

**Файлы:**
- Создать: `backend/src/ruleset/payload.ts`
- Тест: `backend/test/ruleset-payload.test.ts`

**Интерфейсы:**
- Потребляет: `RuleSetError`, `parse` из библиотеки `yaml`.
- Отдаёт: `parsePayload(text: string, format: 'yaml' | 'text'): string[]`.

Оба формата дают плоский список строк. `yaml` — документ с ключом `payload`,
`text` — по строке на запись, `#` начинает комментарий. Что означает строка,
решает `behavior`, а не этот модуль: у `domain` это домен, у `ipcidr` — подсеть,
у `classical` — правило целиком.

- [ ] **Шаг 1: падающий тест**

```ts
// backend/test/ruleset-payload.test.ts
import { describe, expect, it } from 'vitest'
import { parsePayload } from '../src/ruleset/payload.js'
import { RuleSetError } from '../src/ruleset/errors.js'

describe('формат yaml', () => {
  it('берёт список из ключа payload', () => {
    const text = ['payload:', '  - "+.example.com"', '  - other.org', ''].join('\n')
    expect(parsePayload(text, 'yaml')).toEqual(['+.example.com', 'other.org'])
  })

  it('строки правил classical проходят как есть', () => {
    const text = ['payload:', '  - PROCESS-NAME,uTorrent.exe', '  - DOMAIN-SUFFIX,x.com', ''].join('\n')
    expect(parsePayload(text, 'yaml')).toEqual(['PROCESS-NAME,uTorrent.exe', 'DOMAIN-SUFFIX,x.com'])
  })

  it('пустой payload — пустой список, а не отказ', () => {
    expect(parsePayload('payload: []\n', 'yaml')).toEqual([])
  })

  it('без ключа payload — отказ', () => {
    expect(() => parsePayload('other: 1\n', 'yaml')).toThrow(RuleSetError)
  })

  it('битый YAML — RuleSetError, а не исключение библиотеки', () => {
    expect(() => parsePayload('payload:\n  - [a\n', 'yaml')).toThrow(RuleSetError)
  })

  it('нестроковые записи пропускаются, а не превращаются в «null»', () => {
    const text = ['payload:', '  - ok.com', '  - 42', '  - [a, b]', ''].join('\n')
    expect(parsePayload(text, 'yaml')).toEqual(['ok.com'])
  })
})

describe('формат text', () => {
  it('строка на запись', () => {
    expect(parsePayload('a.com\nb.com\n', 'text')).toEqual(['a.com', 'b.com'])
  })

  it('комментарии и пустые строки отбрасываются', () => {
    const text = ['# заголовок', '', 'a.com  # хвостовой комментарий', '   ', 'b.com'].join('\n')
    expect(parsePayload(text, 'text')).toEqual(['a.com', 'b.com'])
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npx vitest run test/ruleset-payload.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализация**

```ts
// backend/src/ruleset/payload.ts
// Текстовые форматы наборов. Что означает строка, решает `behavior`, а не этот
// модуль: у `domain` это домен, у `ipcidr` — подсеть, у `classical` — правило.
import { parse } from 'yaml'
import { RuleSetError } from './errors.js'

export function parsePayload(text: string, format: 'yaml' | 'text'): string[] {
  return format === 'text' ? fromText(text) : fromYaml(text)
}

function fromYaml(text: string): string[] {
  let doc: unknown
  try {
    doc = parse(text)
  } catch {
    // Текст ошибки библиотеки английский и про синтаксис YAML, а пользователь
    // видит его как состояние набора — говорим своими словами
    throw new RuleSetError('Набор не разбирается как YAML')
  }
  const payload = (doc as { payload?: unknown } | null)?.payload
  if (payload === undefined) throw new RuleSetError('В наборе нет ключа payload')
  if (!Array.isArray(payload)) throw new RuleSetError('Ключ payload в наборе — не список')
  // Нестроковую запись пропускаем молча: приводить её к строке значило бы
  // завести в набор запись «null», которой в нём нет
  return payload.filter((x): x is string => typeof x === 'string')
}

function fromText(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0]!.trim()
    if (line !== '') out.push(line)
  }
  return out
}
```

- [ ] **Шаг 4: тест зелёный**

Выполнить: `npx vitest run test/ruleset-payload.test.ts`
Ожидается: PASS, 8 тестов.

- [ ] **Шаг 5: мутации**

1. `payload === undefined` → `payload === null` — падает «без ключа payload».
2. Убрать `filter` по типу — падает «нестроковые записи пропускаются».
3. В `fromText` убрать отсечение по `#` — падает «комментарии отбрасываются».
4. Убрать `try/catch` вокруг `parse` — падает «битый YAML» (тип ошибки другой).

- [ ] **Шаг 6: коммит**

```bash
git add backend/src/ruleset/payload.ts backend/test/ruleset-payload.test.ts
git commit -m "feat(backend): parse yaml and text rule-set payloads"
```
---

### Задача 6: файловый кэш наборов

**Файлы:**
- Создать: `backend/src/ruleset/cache.ts`
- Тест: `backend/test/ruleset-cache.test.ts`

**Интерфейсы:**
- Отдаёт: `class RuleSetCache` с методами
  `read(url: string, ttlMs: number): Promise<CachedFile | null>`,
  `write(url: string, bytes: Uint8Array): Promise<void>`;
  `interface CachedFile { bytes: Uint8Array; loadedAt: number }`.

Имя файла — `sha256` от ссылки, а не сама ссылка: в ссылке бывает что угодно,
включая `..` и символы, недопустимые в путях Windows.

- [ ] **Шаг 1: падающий тест**

```ts
// backend/test/ruleset-cache.test.ts
import { mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RuleSetCache } from '../src/ruleset/cache.js'

const URL_A = 'https://example.com/a.mrs'
const newDir = () => mkdtemp(join(tmpdir(), 'ruleset-cache-'))

describe('кэш наборов', () => {
  it('записанное читается обратно', async () => {
    const cache = new RuleSetCache(await newDir(), { totalBytes: 1 << 20 })
    await cache.write(URL_A, new Uint8Array([1, 2, 3]))
    const hit = await cache.read(URL_A, 60_000)
    expect(hit && [...hit.bytes]).toEqual([1, 2, 3])
  })

  it('чужая ссылка не читает чужой файл', async () => {
    const cache = new RuleSetCache(await newDir(), { totalBytes: 1 << 20 })
    await cache.write(URL_A, new Uint8Array([1]))
    expect(await cache.read('https://example.com/b.mrs', 60_000)).toBeNull()
  })

  it('просроченное не отдаётся', async () => {
    const dir = await newDir()
    const cache = new RuleSetCache(dir, { totalBytes: 1 << 20 })
    await cache.write(URL_A, new Uint8Array([1]))
    const [name] = await readdir(dir)
    const old = new Date(Date.now() - 10 * 60_000)
    await utimes(join(dir, name!), old, old)
    expect(await cache.read(URL_A, 60_000)).toBeNull()
    // Но с большим TTL — отдаётся: дело в сроке, а не в порче файла
    expect(await cache.read(URL_A, 60 * 60_000)).not.toBeNull()
  })

  it('имя файла не содержит частей ссылки', async () => {
    const dir = await newDir()
    const cache = new RuleSetCache(dir, { totalBytes: 1 << 20 })
    await cache.write('https://example.com/../../etc/passwd', new Uint8Array([1]))
    const names = await readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('переполнение вытесняет самое старое', async () => {
    const dir = await newDir()
    const cache = new RuleSetCache(dir, { totalBytes: 300 })
    await cache.write('https://example.com/1', new Uint8Array(200))
    const [first] = await readdir(dir)
    const old = new Date(Date.now() - 60_000)
    await utimes(join(dir, first!), old, old)
    await cache.write('https://example.com/2', new Uint8Array(200))
    const names = await readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).not.toBe(first)
  })

  it('мусор в каталоге не роняет чтение', async () => {
    const dir = await newDir()
    await writeFile(join(dir, 'не-хэш.txt'), 'мусор')
    const cache = new RuleSetCache(dir, { totalBytes: 1 << 20 })
    await expect(cache.read(URL_A, 60_000)).resolves.toBeNull()
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npx vitest run test/ruleset-cache.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализация**

```ts
// backend/src/ruleset/cache.ts
// Файловый кэш скачанных наборов. Ключ — sha256 от ссылки: в самой ссылке
// бывает что угодно, включая `..` и символы, недопустимые в путях Windows.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CachedFile {
  bytes: Uint8Array
  loadedAt: number
}

export interface CacheLimits {
  totalBytes: number
}

export class RuleSetCache {
  constructor(
    private readonly dir: string,
    private readonly limits: CacheLimits,
  ) {}

  private nameOf(url: string): string {
    return createHash('sha256').update(url).digest('hex')
  }

  async read(url: string, ttlMs: number): Promise<CachedFile | null> {
    const path = join(this.dir, this.nameOf(url))
    try {
      const info = await stat(path)
      // Свежесть меряем по mtime файла, а не по отдельному индексу: индекс
      // разъехался бы с содержимым каталога при любой правке снаружи
      if (Date.now() - info.mtimeMs > ttlMs) return null
      return { bytes: await readFile(path), loadedAt: info.mtimeMs }
    } catch {
      return null
    }
  }

  async write(url: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, this.nameOf(url)), bytes)
    await this.evict()
  }

  /** Держим каталог в пределах потолка, выбрасывая самое давнее */
  private async evict(): Promise<void> {
    let entries: { path: string; size: number; mtimeMs: number }[]
    try {
      const names = await readdir(this.dir)
      entries = []
      for (const name of names) {
        const path = join(this.dir, name)
        try {
          const info = await stat(path)
          if (info.isFile()) entries.push({ path, size: info.size, mtimeMs: info.mtimeMs })
        } catch {
          // Файл исчез между readdir и stat — не наша забота
        }
      }
    } catch {
      return
    }

    let total = entries.reduce((sum, e) => sum + e.size, 0)
    if (total <= this.limits.totalBytes) return

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of entries) {
      if (total <= this.limits.totalBytes) break
      try {
        await rm(entry.path)
        total -= entry.size
      } catch {
        // Не удалилось — считаем занятым и идём дальше
      }
    }
  }
}
```

- [ ] **Шаг 4: тест зелёный**

Выполнить: `npx vitest run test/ruleset-cache.test.ts`
Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: мутации**

1. `Date.now() - info.mtimeMs > ttlMs` → `< ttlMs` — падает «просроченное не
   отдаётся».
2. `nameOf` → возвращать `encodeURIComponent(url)` — падает «имя файла не
   содержит частей ссылки».
3. Убрать вызов `evict()` из `write` — падает «переполнение вытесняет».
4. `entries.sort((a, b) => a.mtimeMs - b.mtimeMs)` → обратный порядок — падает
   «переполнение вытесняет самое старое» (удалится новое).

- [ ] **Шаг 6: коммит**

```bash
git add backend/src/ruleset/cache.ts backend/test/ruleset-cache.test.ts
git commit -m "feat(backend): on-disk cache for downloaded rule-sets"
```

---

### Задача 7: сервис и роут

**Файлы:**
- Создать: `backend/src/ruleset/service.ts`
- Изменить: `backend/src/routes/tools.ts`
- Изменить: `backend/src/server.ts` (декоратор и `ServerDeps`)
- Тест: `backend/test/ruleset-service.test.ts`
- Тест: `backend/test/ruleset-routes.test.ts`

**Интерфейсы:**
- Потребляет: всё из задач 1–6.
- Отдаёт:
```ts
export interface RuleSetDescriptor {
  name: string
  kind: 'http' | 'inline'
  url?: string
  payload?: string[]
  behavior: 'domain' | 'ipcidr' | 'classical'
  format: 'mrs' | 'yaml' | 'text'
  /** Секунды из документа; сервис сам поднимает до часа, если меньше */
  intervalSec?: number
}

export type RuleSetAnswer =
  | { state: 'yes' | 'no'; count: number }
  | { state: 'lines'; lines: string[]; count: number }
  | { state: 'unavailable'; reason: string }

export class RuleSetService {
  constructor(dataDir: string, net?: FetchGuardOptions)
  match(
    target: { address: string; ip?: string },
    sets: RuleSetDescriptor[],
  ): Promise<Record<string, RuleSetAnswer>>
}
```

Правило распределения ответственности: `domain` и `ipcidr` сервис считает сам,
для `classical` отдаёт строки — вычислитель правил живёт на фронтенде, и второй
его копии в проекте не будет.

- [ ] **Шаг 1: падающий тест сервиса**

```ts
// backend/test/ruleset-service.test.ts
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RuleSetService, type RuleSetDescriptor } from '../src/ruleset/service.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const newDir = () => mkdtemp(join(tmpdir(), 'ruleset-svc-'))
const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34' }]

/** Сеть подменяется целиком: тесты в сеть не ходят */
function net(files: Record<string, Uint8Array | number>) {
  const asked: string[] = []
  return {
    asked,
    opts: {
      lookupImpl: PUBLIC_LOOKUP,
      fetchImpl: async (url: string) => {
        asked.push(url)
        const hit = files[url]
        if (hit === undefined) return new Response('', { status: 404 })
        if (typeof hit === 'number') return new Response('', { status: hit })
        return new Response(hit, { status: 200 })
      },
    },
  }
}

const http = (over: Partial<RuleSetDescriptor> = {}): RuleSetDescriptor => ({
  name: 'faceit',
  kind: 'http',
  url: 'https://example.com/faceit.mrs',
  behavior: 'domain',
  format: 'mrs',
  ...over,
})

const FACEIT = readFileSync(join(DIR, 'faceit.mrs'))
const PRIVATE_IPS = readFileSync(join(DIR, 'geoip-private.mrs'))

describe('RuleSetService', () => {
  it('домен внутри набора — да, снаружи — нет', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    const hit = await svc.match({ address: 'www.faceit.com' }, [http()])
    expect(hit.faceit).toEqual({ state: 'yes', count: 2 })
    const miss = await svc.match({ address: 'example.org' }, [http()])
    expect(miss.faceit).toEqual({ state: 'no', count: 2 })
  })

  it('подсети отвечают по IP цели, а без IP — не совпадение', async () => {
    const { opts } = net({ 'https://example.com/p.mrs': PRIVATE_IPS })
    const svc = new RuleSetService(await newDir(), opts)
    const d = http({ name: 'p', url: 'https://example.com/p.mrs', behavior: 'ipcidr' })
    expect((await svc.match({ address: 'x', ip: '10.0.0.1' }, [d])).p).toMatchObject({ state: 'yes' })
    expect((await svc.match({ address: 'x', ip: '8.8.8.8' }, [d])).p).toMatchObject({ state: 'no' })
    expect((await svc.match({ address: 'x' }, [d])).p).toMatchObject({ state: 'no' })
  })

  it('classical отдаёт строки, а не вердикт', async () => {
    const yaml = Buffer.from('payload:\n  - PROCESS-NAME,uTorrent.exe\n')
    const { opts } = net({ 'https://example.com/c.yaml': yaml })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [
      http({ name: 'c', url: 'https://example.com/c.yaml', behavior: 'classical', format: 'yaml' }),
    ])
    expect(answer.c).toEqual({ state: 'lines', lines: ['PROCESS-NAME,uTorrent.exe'], count: 1 })
  })

  it('inline не ходит в сеть вовсе', async () => {
    const { opts, asked } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'a.example.com' }, [
      { name: 'i', kind: 'inline', payload: ['+.example.com'], behavior: 'domain', format: 'yaml' },
    ])
    expect(answer.i).toMatchObject({ state: 'yes' })
    expect(asked).toEqual([])
  })

  it('404 даёт unavailable с кодом, а не «не совпало»', async () => {
    const { opts } = net({})
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [http()])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
    expect((answer.faceit as { reason: string }).reason).toMatch(/404/)
  })

  it('битый файл даёт unavailable, а не исключение', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': Buffer.from('мусор') })
    const svc = new RuleSetService(await newDir(), opts)
    const answer = await svc.match({ address: 'x' }, [http()])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
  })

  it('второй запрос берёт файл из кэша', async () => {
    const { opts, asked } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    await svc.match({ address: 'faceit.com' }, [http()])
    await svc.match({ address: 'other.com' }, [http()])
    expect(asked).toHaveLength(1)
  })

  it('наборы сверх предела отвечают unavailable, но остальные считаются', async () => {
    const { opts } = net({ 'https://example.com/faceit.mrs': FACEIT })
    const svc = new RuleSetService(await newDir(), opts)
    const many = Array.from({ length: 70 }, (_, i) => http({ name: `n${i}` }))
    const answer = await svc.match({ address: 'faceit.com' }, many)
    expect(answer.n0).toMatchObject({ state: 'yes' })
    expect(answer.n69).toMatchObject({ state: 'unavailable' })
    expect((answer.n69 as { reason: string }).reason).toMatch(/64/)
  })

  it('внутренний адрес отклоняется защитой от SSRF', async () => {
    const svc = new RuleSetService(await newDir(), {
      lookupImpl: async () => [{ address: '127.0.0.1' }],
      fetchImpl: async () => new Response('', { status: 200 }),
    })
    const answer = await svc.match({ address: 'x' }, [http({ url: 'https://internal/a.mrs' })])
    expect(answer.faceit).toMatchObject({ state: 'unavailable' })
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npx vitest run test/ruleset-service.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализация сервиса**

```ts
// backend/src/ruleset/service.ts
// Загрузка и опрос наборов правил, на которые ссылается документ шаблона.
//
// Разделение с фронтендом проходит по инструменту: `domain` и `ipcidr` считаем
// здесь, потому что декодеры бора и диапазонов есть только тут; `classical`
// отдаём строками, потому что это правила Mihomo, а их вычислитель живёт во
// фронтенде, и второй его копии в проекте не будет.
import { join } from 'node:path'
import { fetchExternalBytes, type FetchGuardOptions } from '../net/guard.js'
import { RuleSetCache } from './cache.js'
import { domainMatcher, readDomainSet, type DomainMatcher } from './domainSet.js'
import { RuleSetError } from './errors.js'
import { ipMatcher, readIpCidrSet, type IpMatcher } from './ipcidrSet.js'
import { parseMrs, type RuleBehavior } from './mrs.js'
import { parsePayload } from './payload.js'
import { domainSetFromLines, ipCidrSetFromLines } from './textSets.js'

/** Значения из спеки; менять их — менять спеку */
export const LIMITS = {
  wireBytes: 8 * 1024 * 1024,
  plainBytes: 32 * 1024 * 1024,
  setsPerDocument: 64,
  cacheBytes: 256 * 1024 * 1024,
  parsedBytes: 64 * 1024 * 1024,
  classicalLines: 10_000,
  minTtlMs: 60 * 60 * 1000,
}

export interface RuleSetDescriptor {
  name: string
  kind: 'http' | 'inline'
  url?: string
  payload?: string[]
  behavior: RuleBehavior
  format: 'mrs' | 'yaml' | 'text'
  intervalSec?: number
}

export type RuleSetAnswer =
  | { state: 'yes' | 'no'; count: number }
  | { state: 'lines'; lines: string[]; count: number }
  | { state: 'unavailable'; reason: string }

// Наборы `domain` и `ipcidr` приходят и из `.mrs`, и из текста, поэтому
// сервис держит не структуру, а то, у чего можно спросить: откуда взялся
// ответ, ему знать незачем
type Parsed =
  | { kind: 'domain'; matcher: DomainMatcher; count: number; bytes: number }
  | { kind: 'ipcidr'; matcher: IpMatcher; count: number; bytes: number }
  | { kind: 'classical'; lines: string[]; count: number; bytes: number }

export class RuleSetService {
  private readonly cache: RuleSetCache
  /** Разобранное держим в памяти: набор подсетей крупной страны разбирается заметно */
  private readonly parsed = new Map<string, Parsed>()
  private parsedBytes = 0

  constructor(
    dataDir: string,
    private readonly net: FetchGuardOptions = {},
  ) {
    this.cache = new RuleSetCache(join(dataDir, 'rulesets'), { totalBytes: LIMITS.cacheBytes })
  }

  async match(
    target: { address: string; ip?: string },
    sets: RuleSetDescriptor[],
  ): Promise<Record<string, RuleSetAnswer>> {
    const answers: Record<string, RuleSetAnswer> = {}
    // Предел режет лишние наборы, а не весь запрос: документ с 65 наборами
    // обязан получить ответ по первым 64 и честную причину по остальным
    const allowed = sets.slice(0, LIMITS.setsPerDocument)
    for (const set of sets.slice(LIMITS.setsPerDocument)) {
      answers[set.name] = {
        state: 'unavailable',
        reason: `в документе больше ${LIMITS.setsPerDocument} наборов — этот не проверялся`,
      }
    }

    await Promise.all(
      allowed.map(async (set) => {
        try {
          answers[set.name] = this.answer(await this.load(set), target)
        } catch (err) {
          answers[set.name] = {
            state: 'unavailable',
            // Наружу пускаем только текст известного отказа: чужое исключение
            // выглядело бы как состояние набора и увело бы пользователя
            // разбираться с его документом вместо нашей ошибки
            reason: err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
          }
          if (!(err instanceof RuleSetError)) throw err
        }
      }),
    ).catch(() => {
      // Одно упавшее не должно отменять остальные: ответы уже разложены выше
    })

    return answers
  }

  private answer(parsed: Parsed, target: { address: string; ip?: string }): RuleSetAnswer {
    if (parsed.kind === 'classical') {
      return { state: 'lines', lines: parsed.lines, count: parsed.count }
    }
    if (parsed.kind === 'domain') {
      return { state: parsed.matcher.has(target.address) ? 'yes' : 'no', count: parsed.count }
    }
    // Без IP в цели набор подсетей не совпадает: резолвить домены сервер не
    // берётся, а догадка здесь стоила бы неверного маршрута
    const hit = target.ip !== undefined && parsed.matcher.has(target.ip)
    return { state: hit ? 'yes' : 'no', count: parsed.count }
  }

  private async load(set: RuleSetDescriptor): Promise<Parsed> {
    if (set.kind === 'inline') {
      const lines = set.payload ?? []
      return this.build(set, lines.join('\n'), null, `inline:${set.name}`)
    }
    if (set.url === undefined) throw new RuleSetError('У набора не указана ссылка')

    const cacheKey = `${set.url}|${set.behavior}|${set.format}`
    const hit = this.parsed.get(cacheKey)
    if (hit !== undefined) return hit

    const ttl = Math.max(LIMITS.minTtlMs, (set.intervalSec ?? 0) * 1000)
    const cached = await this.cache.read(set.url, ttl)
    const bytes =
      cached?.bytes ??
      (await fetchExternalBytes(set.url, { ...this.net, maxBytes: LIMITS.wireBytes }).catch(
        (err: unknown) => {
          throw new RuleSetError(
            `не удалось скачать: ${err instanceof Error ? err.message : String(err)}`,
          )
        },
      ))
    if (cached === null) await this.cache.write(set.url, bytes)

    return this.build(set, null, bytes, cacheKey)
  }

  private build(
    set: RuleSetDescriptor,
    text: string | null,
    bytes: Uint8Array | null,
    cacheKey: string,
  ): Parsed {
    const size = bytes?.byteLength ?? text?.length ?? 0
    let parsed: Parsed

    if (set.format === 'mrs') {
      if (bytes === null) throw new RuleSetError('Формат mrs не бывает встроенным в документ')
      const file = parseMrs(bytes, LIMITS.plainBytes)
      if (file.behavior !== set.behavior) {
        // Документ обещал одно, файл содержит другое: считать по файлу — значит
        // ответить не на тот вопрос, который задало правило
        throw new RuleSetError(
          `в документе указан вид «${set.behavior}», а в файле «${file.behavior}»`,
        )
      }
      if (file.behavior === 'classical') {
        throw new RuleSetError('вид classical в формате mrs не встречается')
      }
      parsed =
        file.behavior === 'domain'
          ? {
              kind: 'domain',
              matcher: domainMatcher(readDomainSet(file.body)),
              count: file.count,
              bytes: size,
            }
          : {
              kind: 'ipcidr',
              matcher: ipMatcher(readIpCidrSet(file.body)),
              count: file.count,
              bytes: size,
            }
    } else {
      const source = text ?? Buffer.from(bytes!).toString('utf8')
      const lines = parsePayload(source, set.format)
      if (set.behavior === 'classical') {
        if (lines.length > LIMITS.classicalLines) {
          throw new RuleSetError(`в наборе больше ${LIMITS.classicalLines} строк`)
        }
        parsed = { kind: 'classical', lines, count: lines.length, bytes: size }
      } else if (set.behavior === 'domain') {
        parsed = {
          kind: 'domain',
          matcher: domainSetFromLines(lines),
          count: lines.length,
          bytes: size,
        }
      } else {
        parsed = {
          kind: 'ipcidr',
          matcher: ipCidrSetFromLines(lines),
          count: lines.length,
          bytes: size,
        }
      }
    }

    this.remember(cacheKey, parsed)
    return parsed
  }

  /** Разобранное вытесняем по объёму: счётчик, а не число наборов */
  private remember(key: string, parsed: Parsed): void {
    this.parsed.set(key, parsed)
    this.parsedBytes += parsed.bytes
    while (this.parsedBytes > LIMITS.parsedBytes && this.parsed.size > 1) {
      const oldest = this.parsed.keys().next().value as string
      this.parsedBytes -= this.parsed.get(oldest)?.bytes ?? 0
      this.parsed.delete(oldest)
    }
  }
}
```

Двух функций в этом файле не хватает — их пишет тот же шаг:
`domainSetFromLines(lines: string[]): DomainSet` и
`ipCidrSetFromLines(lines: string[]): IpCidrSet`. Наборы `domain` и `ipcidr`
бывают и текстовыми, и тогда бор с диапазонами надо собрать самим.

**Решение по объёму:** вместо строителя бора для текстовых наборов доменов
достаточно линейного сравнения — текстовые наборы доменов в экосистеме редки и
малы, а строитель бора нужен был бы только ради них. Поэтому:

```ts
// backend/src/ruleset/textSets.ts — вместе с service.ts
// Текстовые наборы `domain` и `ipcidr` разбираются в простые структуры:
// собирать ради них сжатый бор незачем — он нужен только чтобы ЧИТАТЬ то, что
// уже собрало ядро.
```

`domainSetFromLines` возвращает объект с тем же методом поиска, что и бор,
поэтому в `Parsed` вводится общий вид:

```ts
export interface DomainMatcher {
  has(domain: string): boolean
}
```

`readDomainSet` оборачивается в `{ has: (d) => hasDomain(ds, d) }`, а текстовый
набор реализует правила Mihomo для записей списка доменов: `+.example.com` —
домен и поддомены, `*.example.com` — ровно одна метка, `.example.com` —
поддомены, прочее — точное совпадение без учёта регистра.

- [ ] **Шаг 4: реализация текстовых наборов**

```ts
// backend/src/ruleset/textSets.ts
import { ipToBytes } from '../geo/match.js'
import type { DomainMatcher } from './domainSet.js'

/**
 * Запись текстового набора доменов. Правила те же, что у списка `domain` в
 * самом документе Mihomo: `+.` — домен и любые поддомены, `*.` — ровно одна
 * метка, ведущая точка — только поддомены, иначе точное совпадение.
 */
export function domainSetFromLines(lines: string[]): DomainMatcher {
  const entries = lines.map((line) => line.trim().toLowerCase()).filter((l) => l !== '')
  return {
    has(domain: string): boolean {
      const target = domain.trim().toLowerCase()
      if (target === '') return false
      return entries.some((entry) => matchDomainEntry(entry, target))
    },
  }
}

function matchDomainEntry(entry: string, target: string): boolean {
  if (entry.startsWith('+.')) {
    const base = entry.slice(2)
    return target === base || target.endsWith(`.${base}`)
  }
  if (entry.startsWith('*.')) {
    const base = entry.slice(2)
    if (!target.endsWith(`.${base}`)) return false
    // Ровно одна метка: в остатке точек быть не должно
    return !target.slice(0, target.length - base.length - 1).includes('.')
  }
  if (entry.startsWith('.')) return target.endsWith(entry)
  return target === entry
}

/** Текстовый набор подсетей: строка на подсеть в записи CIDR */
export function ipCidrSetFromLines(lines: string[]): { has(ip: string): boolean } {
  const nets = lines.map((l) => l.trim()).filter((l) => l !== '')
  return {
    has(ip: string): boolean {
      const bytes = ipToBytes(ip)
      if (bytes === null) return false
      return nets.some((cidr) => inCidr(bytes, cidr))
    },
  }
}
```

`inCidr` берётся не заново: в `backend/src/geo/match.ts` уже есть арифметика
подсетей, и вторая её копия разошлась бы с первой. Использовать существующую
функцию сравнения; если её сигнатура не подходит напрямую — вынести общее, а не
копировать.

- [ ] **Шаг 5: роут**

```ts
// backend/src/routes/tools.ts — рядом с остальными
const ruleSetSchema = z.object({
  target: z.object({ address: z.string().min(1), ip: z.string().optional() }),
  sets: z
    .array(
      z.object({
        name: z.string().min(1),
        kind: z.enum(['http', 'inline']),
        url: z.string().optional(),
        payload: z.array(z.string()).optional(),
        behavior: z.enum(['domain', 'ipcidr', 'classical']),
        format: z.enum(['mrs', 'yaml', 'text']),
        intervalSec: z.number().int().nonnegative().optional(),
      }),
    )
    .max(200),
})

app.post('/api/tools/ruleset/match', async (req) => {
  const { target, sets } = ruleSetSchema.parse(req.body)
  return { answers: await app.ruleset.match(target, sets) }
})
```

Предел `200` в схеме — не тот же, что `setsPerDocument`: схема отбивает явно
абсурдный запрос, а осмысленный предел с внятной причиной по каждому набору
ставит сервис.

- [ ] **Шаг 6: подключение в server.ts**

В объявлении типов Fastify добавить `ruleset: RuleSetService`, в `ServerDeps` —
`ruleset?: RuleSetService`, и декоратор:

```ts
  app.decorate(
    'ruleset',
    deps.ruleset ?? new RuleSetService(config.dataDir, { allowPrivate: config.geoAllowPrivateUrls }),
  )
```

- [ ] **Шаг 7: тест роута**

```ts
// backend/test/ruleset-routes.test.ts
import { describe, expect, it } from 'vitest'
import { makeApp, login } from './helpers.js'

describe('POST /api/tools/ruleset/match', () => {
  it('требует авторизации', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/api/tools/ruleset/match', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('отвечает по каждому набору', async () => {
    const app = await makeApp()
    const cookie = await login(app)
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
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.i).toMatchObject({ state: 'yes' })
  })

  it('кривое тело — 400, а не 500', async () => {
    const app = await makeApp()
    const cookie = await login(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/ruleset/match',
      headers: { cookie },
      payload: { target: {}, sets: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

Точные формы `makeApp` и `login` взять из `backend/test/helpers.ts` — не
придумывать: в других тестах роутов они уже используются.

- [ ] **Шаг 8: всё зелёное**

Выполнить: `npm test -w backend`
Ожидается: PASS.

- [ ] **Шаг 9: мутации**

1. В `answer` для `ipcidr` убрать проверку `target.ip !== undefined` — падает
   «подсети отвечают по IP цели».
2. `sets.slice(0, LIMITS.setsPerDocument)` → `sets` — падает «наборы сверх
   предела».
3. В `build` убрать сверку `file.behavior !== set.behavior` — тест на это надо
   ДОБАВИТЬ, если его нет: набор `geoip-private.mrs`, объявленный как `domain`,
   обязан дать `unavailable`.
4. `err instanceof RuleSetError ? err.message : ...` → всегда `err.message` —
   тест не покраснеет сам; добавить тест, где сервис получает не-`RuleSetError`,
   и проверить, что наружу уходит общий текст.

- [ ] **Шаг 10: коммит**

```bash
git add backend/src/ruleset backend/src/routes/tools.ts backend/src/server.ts backend/test/ruleset-service.test.ts backend/test/ruleset-routes.test.ts
git commit -m "feat(backend): serve rule-set membership answers"
```
---

### Задача 8: дескрипторы наборов из документа

**Файлы:**
- Изменить: `frontend/src/entities/mihomo/groups.ts` (`ruleProvidersOf`)
- Создать: `frontend/src/entities/mihomo/ruleSets.ts`
- Тест: `frontend/test/mihomo-rule-sets.test.ts`

**Интерфейсы:**
- Отдаёт: `type RuleSetDescriptor` и
  `ruleSetDescriptors(md: MihomoDoc): RuleSetDescriptor[]`.

**Внимание на разницу с бэкендом.** Здесь у дескриптора **четыре** вида, а
роут задачи 7 принимает **два**. Так и задумано: `file` и `unsupported` —
состояния, известные без сети, и посылать их на сервер незачем. Отбор делает
задача 11: на бэкенд уходят только `http` и `inline`, а два оставшихся вида
превращаются в `unavailable` со своей причиной прямо на клиенте. Поле `proxy`
на бэкенд тоже не уходит — оно нужно только для оговорки трассы.

Читать документ умеет только фронтенд, поэтому дескрипторы собирает он.
`ruleProvidersOf` сегодня отдаёт лишь имя и `behavior` — дополняем её
остальными полями, а не заводим второй обход секции.

- [ ] **Шаг 1: падающий тест**

```ts
// frontend/test/mihomo-rule-sets.test.ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { ruleSetDescriptors } from '../src/entities/mihomo/ruleSets'

const doc = (...lines: string[]) => parseMihomo(['rule-providers:', ...lines, ''].join('\n'))

describe('дескрипторы наборов', () => {
  it('читает набор по ссылке целиком', () => {
    const md = doc(
      '  ads:',
      '    type: http',
      '    behavior: domain',
      '    format: mrs',
      '    url: https://example.com/ads.mrs',
      '    interval: 86400',
    )
    expect(ruleSetDescriptors(md)).toEqual([
      {
        name: 'ads',
        kind: 'http',
        url: 'https://example.com/ads.mrs',
        behavior: 'domain',
        format: 'mrs',
        intervalSec: 86400,
      },
    ])
  })

  it('пустой format означает yaml — так его понимает ядро', () => {
    const md = doc('  a:', '    type: http', '    behavior: classical', '    url: https://e.com/a')
    expect(ruleSetDescriptors(md)[0]).toMatchObject({ format: 'yaml' })
  })

  it('inline берёт payload из документа и не имеет ссылки', () => {
    const md = doc(
      '  local:',
      '    type: inline',
      '    behavior: domain',
      '    payload:',
      '      - "+.example.com"',
    )
    expect(ruleSetDescriptors(md)[0]).toMatchObject({
      name: 'local',
      kind: 'inline',
      payload: ['+.example.com'],
    })
  })

  it('type: file недоступен редактору и помечается этим, а не пропадает', () => {
    const md = doc('  f:', '    type: file', '    behavior: domain', '    path: ./x.mrs')
    const [d] = ruleSetDescriptors(md)
    expect(d).toMatchObject({ name: 'f', kind: 'file' })
  })

  it('поле proxy сохраняется — на нём держится оговорка трассы', () => {
    const md = doc(
      '  a:',
      '    type: http',
      '    behavior: domain',
      '    url: https://e.com/a',
      '    proxy: Авто',
    )
    expect(ruleSetDescriptors(md)[0]).toMatchObject({ proxy: 'Авто' })
  })

  it('незнакомый behavior или format не выдумывается', () => {
    const md = doc('  a:', '    type: http', '    behavior: странное', '    url: https://e.com/a')
    const [d] = ruleSetDescriptors(md)
    // Подставить «domain» значило бы ответить не на тот вопрос
    expect(d).toMatchObject({ kind: 'unsupported' })
  })

  it('на документе без секции возвращает пусто', () => {
    expect(ruleSetDescriptors(parseMihomo('rules:\n  - MATCH,DIRECT\n'))).toEqual([])
  })
})
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npx vitest run test/mihomo-rule-sets.test.ts` из `frontend`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: расширить `ruleProvidersOf`**

В `frontend/src/entities/mihomo/groups.ts` дополнить `RuleProviderRef` полями
`type`, `url`, `format`, `proxy`, `payload` и заполнить их тем же `str`, каким
уже читается `behavior`. Для `payload` понадобится чтение списка скаляров —
если такого помощника рядом нет, добавить его туда же, а не в `ruleSets.ts`:
второй способ читать список в одном модуле разошёлся бы с первым.

- [ ] **Шаг 4: реализация дескрипторов**

```ts
// frontend/src/entities/mihomo/ruleSets.ts
// Что именно редактор попросит у бэкенда по каждому набору правил документа.
// Читает документ только фронтенд, поэтому и дескрипторы собирает он.
import { ruleProvidersOf } from './groups'
import type { MihomoDoc } from './parse'

export type RuleSetBehavior = 'domain' | 'ipcidr' | 'classical'
export type RuleSetFormat = 'mrs' | 'yaml' | 'text'

export type RuleSetDescriptor =
  | {
      name: string
      kind: 'http'
      url: string
      behavior: RuleSetBehavior
      format: RuleSetFormat
      intervalSec?: number
      proxy?: string
    }
  | {
      name: string
      kind: 'inline'
      payload: string[]
      behavior: RuleSetBehavior
      format: RuleSetFormat
    }
  /** Набор лежит в файле у клиента — сервер такого файла не видит */
  | { name: string; kind: 'file' }
  /** Вид или формат редактору незнаком; выдумывать их нельзя */
  | { name: string; kind: 'unsupported'; reason: string }

const BEHAVIORS = new Set<string>(['domain', 'ipcidr', 'classical'])
const FORMATS = new Set<string>(['mrs', 'yaml', 'text'])

export function ruleSetDescriptors(md: MihomoDoc): RuleSetDescriptor[] {
  const out: RuleSetDescriptor[] = []
  for (const ref of ruleProvidersOf(md)) {
    const type = ref.type?.trim() ?? 'http'
    if (type === 'file') {
      out.push({ name: ref.name, kind: 'file' })
      continue
    }

    const behavior = ref.behavior?.trim().toLowerCase()
    if (behavior === undefined || !BEHAVIORS.has(behavior)) {
      out.push({
        name: ref.name,
        kind: 'unsupported',
        reason: `вид набора «${ref.behavior ?? 'не указан'}» редактору незнаком`,
      })
      continue
    }
    // Пустое поле формата ядро понимает как yaml: ParseRuleFormat("") → YamlRule
    const format = ref.format?.trim().toLowerCase() ?? 'yaml'
    if (!FORMATS.has(format)) {
      out.push({
        name: ref.name,
        kind: 'unsupported',
        reason: `формат набора «${ref.format}» редактору незнаком`,
      })
      continue
    }

    if (type === 'inline') {
      out.push({
        name: ref.name,
        kind: 'inline',
        payload: ref.payload ?? [],
        behavior: behavior as RuleSetBehavior,
        format: format as RuleSetFormat,
      })
      continue
    }

    const url = ref.url?.trim()
    if (url === undefined || url === '') {
      out.push({ name: ref.name, kind: 'unsupported', reason: 'у набора не указана ссылка' })
      continue
    }
    out.push({
      name: ref.name,
      kind: 'http',
      url,
      behavior: behavior as RuleSetBehavior,
      format: format as RuleSetFormat,
      ...(ref.intervalSec === undefined ? {} : { intervalSec: ref.intervalSec }),
      ...(ref.proxy === undefined ? {} : { proxy: ref.proxy }),
    })
  }
  return out
}
```

- [ ] **Шаг 5: тест зелёный**

Выполнить: `npx vitest run test/mihomo-rule-sets.test.ts`
Ожидается: PASS, 7 тестов.

- [ ] **Шаг 6: мутации**

1. `?? 'yaml'` → `?? 'mrs'` — падает «пустой format означает yaml».
2. Ветку `type === 'file'` убрать — падает «type: file недоступен редактору».
3. Проверку `BEHAVIORS.has` заменить на `true` — падает «незнакомый behavior не
   выдумывается».
4. Не переносить `proxy` — падает «поле proxy сохраняется».

- [ ] **Шаг 7: коммит**

```bash
git add frontend/src/entities/mihomo/groups.ts frontend/src/entities/mihomo/ruleSets.ts frontend/test/mihomo-rule-sets.test.ts
git commit -m "feat(frontend): describe a document's rule-set providers"
```

---

### Задача 9: наборы правил в трассировке

**Файлы:**
- Изменить: `frontend/src/entities/mihomo/trace.ts`
- Тест: `frontend/test/mihomo-trace.test.ts`

**Интерфейсы:**
- Потребляет: `RuleSetAnswer` той же формы, что отдаёт бэкенд (задача 7).
- Отдаёт: четвёртый параметр `traceMihomo(md, target, geo, ruleSets)`;
  `interface RuleSetAnswers { answers: Record<string, RuleSetAnswer>; pending: boolean }`;
  `parseClassicalEntry(line: string): ConditionLike | null`.

Здесь же — рефакторинг, без которого `classical` не посчитать: отказы «источник»
и «резолв запрещён» выносятся в `earlyRefusal`, а вычисление условия — в
`judgeCondition`. Строки `classical` — это правила **без цели**
(`ParseRulePayload(rule, false)` в ядре), поэтому `parseRule` на них не годится:
он требует три поля и вернёт `null`.

- [ ] **Шаг 1: падающий тест**

```ts
// frontend/test/mihomo-trace.test.ts — дописать
import type { RuleSetAnswers } from '../src/entities/mihomo/trace'

const NO_SETS: RuleSetAnswers = { answers: {}, pending: false }
const sets = (answers: RuleSetAnswers['answers'], pending = false): RuleSetAnswers => ({
  answers,
  pending,
})

describe('трассировка Mihomo: наборы правил', () => {
  it('набор ответил «да» — правило побеждает', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      sets({ ads: { state: 'yes', count: 10 } }),
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'REJECT' })
  })

  it('набор ответил «нет» — проход идёт дальше', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      sets({ ads: { state: 'no', count: 10 } }),
    )
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
    expect(res.stopped).toBeUndefined()
  })

  it('недоступный набор останавливает проход и называет причину', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      sets({ ads: { state: 'unavailable', reason: 'сервер ответил 404' } }),
    )
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/404/)
    // Прежний текст обещал, что редактор наборы не скачивает, — это стало неправдой
    expect(res.stopped?.reason).not.toMatch(/не скачивает/)
  })

  it('пока ответы едут, причина говорит именно это', () => {
    const res = traceMihomo(doc('RULE-SET,ads,REJECT', 'MATCH,D'), T(), NO_GEO, sets({}, true))
    expect(res.stopped?.reason).toMatch(/загружа/i)
  })

  it('без ответов вообще проход по-прежнему останавливается', () => {
    const res = traceMihomo(doc('RULE-SET,ads,REJECT', 'MATCH,D'), T(), NO_GEO, NO_SETS)
    expect(res.stopped?.index).toBe(0)
  })

  it('no-resolve на ipcidr решает без ответа набора', () => {
    // Проверено в 8adf32e: содержимое файла на ответ не влияет
    const text = [
      'rule-providers:',
      '  p:',
      '    behavior: ipcidr',
      '',
      'rules:',
      '  - RULE-SET,p,DIRECT,no-resolve',
      '  - MATCH,D',
      '',
    ].join('\n')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO, NO_SETS)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })
})

describe('трассировка Mihomo: набор classical', () => {
  const classical = (lines: string[]) =>
    sets({ c: { state: 'lines', lines, count: lines.length } })

  it('совпавшая строка набора выигрывает правило', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'a.com' }),
      NO_GEO,
      classical(['DOMAIN-SUFFIX,a.com']),
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })

  it('набор — это ИЛИ: точное «да» перевешивает непроверяемую строку', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'a.com' }),
      NO_GEO,
      classical(['PROCESS-NAME,x.exe', 'DOMAIN-SUFFIX,a.com']),
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })

  it('непроверяемая строка без совпадений останавливает проход', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['PROCESS-NAME,x.exe', 'DOMAIN-SUFFIX,a.com']),
    )
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/PROCESS-NAME|процесс/i)
  })

  it('все строки промахнулись — набор не совпал, проход идёт дальше', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['DOMAIN-SUFFIX,a.com', 'DOMAIN,b.com']),
    )
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('строка, запрещённая ядром внутри classical, названа поимённо', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['RULE-SET,other']),
    )
    expect(res.stopped?.reason).toMatch(/RULE-SET/)
  })

  it('строки classical идут без цели — три поля не требуются', () => {
    // `PROCESS-NAME,uTorrent.exe` — это ДВА поля. Разбор правилом документа
    // вернул бы null и потерял бы всю строку
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'a.com' }),
      NO_GEO,
      classical(['DOMAIN,a.com']),
    )
    expect(res.winner?.ruleIndex).toBe(0)
  })
})
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Выполнить: `npx vitest run test/mihomo-trace.test.ts`
Ожидается: FAIL — четвёртого параметра нет.

- [ ] **Шаг 3: реализация**

В `frontend/src/entities/mihomo/trace.ts`:

```ts
export type RuleSetAnswer =
  | { state: 'yes' | 'no'; count: number }
  | { state: 'lines'; lines: string[]; count: number }
  | { state: 'unavailable'; reason: string }

export interface RuleSetAnswers {
  answers: Record<string, RuleSetAnswer>
  /** Ответы ещё едут: это «пока не знаем», а не «недоступен» */
  pending: boolean
}

const NO_RULE_SETS: RuleSetAnswers = { answers: {}, pending: false }

/** Условие без цели: то, из чего состоит и правило, и строка набора classical */
interface ConditionLike {
  type: string
  payload?: string
  modifiers: string[]
}

/** Ядро отвергает эти типы внутри classical при разборе набора */
const FORBIDDEN_IN_CLASSICAL = new Set(['MATCH', 'RULE-SET', 'SUB-RULE'])

/**
 * Строка набора `classical` — правило БЕЗ цели: ядро разбирает её
 * `ParseRulePayload(rule, false)`. Обычный `parseRule` тут не годится: он ждёт
 * три поля и на `PROCESS-NAME,uTorrent.exe` вернул бы null.
 */
export function parseClassicalEntry(line: string): ConditionLike | null {
  const parts = splitTopLevel(line.trim())
  if (parts.length < 2) return null
  const type = parts[0]!.trim()
  if (type === '') return null
  return { type, payload: parts[1], modifiers: parts.slice(2) }
}

/** Отказы, видные до разбора условия: источник и запрет резолва */
function earlyRefusal(ctx: Ctx, rule: ConditionLike): CondResult | null {
  if (rule.modifiers.includes('src')) {
    return {
      state: 'unknown',
      reason: `модификатор src разворачивает «${rule.type}» на источник соединения — таких данных в цели трассировки нет`,
    }
  }
  if (missesWithoutResolve(ctx, rule)) return NO
  return null
}

function judgeCondition(ctx: Ctx, rule: ConditionLike): CondResult {
  return earlyRefusal(ctx, rule) ?? evalCondition(ctx, { type: rule.type, payload: rule.payload })
}

/**
 * Набор `classical` — это ИЛИ по его строкам (`classical_strategy.go`).
 * Значит точное «да» решает исход, а непроверяемая строка без единого «да»
 * делает неизвестным весь набор: молча счесть его промахом — соврать.
 */
function evalClassical(ctx: Ctx, name: string, lines: string[]): CondResult {
  let unknown: CondResult | null = null
  for (const line of lines) {
    const entry = parseClassicalEntry(line)
    if (entry === null) {
      unknown ??= { state: 'unknown', reason: `в наборе «${name}» не разбирается строка «${line}»` }
      continue
    }
    if (FORBIDDEN_IN_CLASSICAL.has(entry.type)) {
      unknown ??= {
        state: 'unknown',
        reason: `в наборе «${name}» строка «${line}»: ядро не принимает «${entry.type}» внутри classical`,
      }
      continue
    }
    const res = judgeCondition(ctx, entry)
    if (res.state === 'yes') return YES
    if (res.state === 'unknown') {
      unknown ??= { state: 'unknown', reason: `в наборе «${name}»: ${res.reason}` }
    }
  }
  return unknown ?? NO
}
```

Ветка `RULE-SET` в `evalCondition` заменяется целиком:

```ts
  if (type === 'RULE-SET') {
    const answer = ctx.ruleSets.answers[payload]
    if (answer === undefined) {
      return {
        state: 'unknown',
        reason: ctx.ruleSets.pending
          ? `набор правил «${payload}» ещё загружается`
          : `содержимое набора правил «${payload}» редактору неизвестно`,
      }
    }
    if (answer.state === 'unavailable') {
      return { state: 'unknown', reason: `набор правил «${payload}»: ${answer.reason}` }
    }
    if (answer.state === 'lines') return evalClassical(ctx, payload, answer.lines)
    return answer.state === 'yes' ? YES : NO
  }
```

`Ctx` получает поле `ruleSets: RuleSetAnswers`; сигнатура —
`traceMihomo(md, target, geo, ruleSets: RuleSetAnswers = NO_RULE_SETS)`.
Значение по умолчанию обязательно: у `traceMihomo` есть другие вызывающие, и
менять их в этой задаче незачем.

`judgeRule` переписывается на новые части:

```ts
function judgeRule(ctx: Ctx, rule: MihomoRule | null, seen: Set<string>): Judged {
  if (rule === null) return { state: 'unknown', reason: 'строку правила разобрать не удалось' }
  // Отказы проверяются ДО ветки SUB-RULE: src разворачивает на источник и её тоже
  const early = earlyRefusal(ctx, rule)
  if (early !== null) return early
  if (rule.type === 'SUB-RULE') {
    // Тело этой ветки не меняется: разбор payload, проверка условия через
    // evalCondition и спуск в walkSubRule остаются ровно теми же строками, что
    // стоят в файле сегодня. Переписывать их не нужно — только перенести ниже
    // вызова earlyRefusal
  }
  const res = evalCondition(ctx, { type: rule.type, payload: rule.payload })
  return res.state === 'yes' ? { state: 'yes', target: rule.target } : res
}
```

- [ ] **Шаг 4: тесты зелёные**

Выполнить: `npx vitest run test/mihomo-trace.test.ts`
Ожидается: PASS. Существующие тесты трассировки обязаны остаться зелёными без
правок — если какой-то покраснел, дело в рефакторинге, а не в тесте.

- [ ] **Шаг 5: мутации**

1. `if (res.state === 'yes') return YES` в `evalClassical` → `continue` — падает
   «точное „да“ перевешивает непроверяемую строку».
2. `return unknown ?? NO` → `return NO` — падает «непроверяемая строка
   останавливает проход».
3. `FORBIDDEN_IN_CLASSICAL` очистить — падает «строка, запрещённая ядром».
4. Ветку `pending` убрать — падает «пока ответы едут».
5. `answer.state === 'unavailable'` → возвращать `NO` — падает «недоступный
   набор останавливает проход».

- [ ] **Шаг 6: коммит**

```bash
git add frontend/src/entities/mihomo/trace.ts frontend/test/mihomo-trace.test.ts
git commit -m "feat(frontend): trace mihomo rule-sets from fetched answers"
```

---

### Задача 10: правила по процессу

**Файлы:**
- Изменить: `frontend/src/entities/xray/traceMatch.ts` (поле `process`)
- Изменить: `frontend/src/entities/mihomo/trace.ts`
- Изменить: `frontend/src/features/diagnostics/TraceBar.tsx`
- Изменить: `frontend/src/features/templates/MihomoEditorPage.tsx`
- Тест: `frontend/test/mihomo-trace.test.ts`, `frontend/test/trace-bar.test.tsx`

**Интерфейсы:**
- Отдаёт: `TraceTarget.process?: string`; проп `showProcess?: boolean` у
  `TraceBar`.

Вторая стена. Семантика — из `rules/common/process.go` и
`component/wildcard/wildcard.go`, а не из документации.

- [ ] **Шаг 1: падающий тест**

```ts
// frontend/test/mihomo-trace.test.ts — дописать
describe('трассировка Mihomo: правила по процессу', () => {
  it('без процесса в цели проход останавливается, как раньше', () => {
    const res = traceMihomo(doc('PROCESS-NAME,chrome.exe,VPN', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
  })

  it('точное имя сравнивается без учёта регистра', () => {
    const t = T({ process: 'Chrome.exe' })
    expect(traceMihomo(doc('PROCESS-NAME,chrome.exe,VPN', 'MATCH,D'), t, NO_GEO).winner).toEqual({
      ruleIndex: 0,
      target: 'VPN',
    })
    expect(traceMihomo(doc('PROCESS-NAME,firefox.exe,VPN', 'MATCH,D'), t, NO_GEO).winner).toEqual({
      ruleIndex: 1,
      target: 'D',
    })
  })

  it('REGEX ищет подстроку, а не совпадение целиком', () => {
    // `regexp2.MatchString` не заякорен: правило `discord` ловит и помощника
    const t = T({ process: 'my-discord-helper.exe' })
    const res = traceMihomo(doc('PROCESS-NAME-REGEX,discord,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })

  it('REGEX не учитывает регистр', () => {
    const t = T({ process: 'Discord.exe' })
    expect(
      traceMihomo(doc('PROCESS-NAME-REGEX,discord,VPN', 'MATCH,D'), t, NO_GEO).winner?.ruleIndex,
    ).toBe(0)
  })

  it('нерабочее выражение — остановка с причиной, а не промах', () => {
    const t = T({ process: 'x.exe' })
    const res = traceMihomo(doc('PROCESS-NAME-REGEX,[,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/регулярн/i)
  })

  it('подстановки: «*» — сколько угодно, «?» — ровно один', () => {
    const t = T({ process: 'chrome.exe' })
    const yes = (p: string) =>
      traceMihomo(doc(`PROCESS-NAME-WILDCARD,${p},VPN`, 'MATCH,D'), t, NO_GEO).winner?.ruleIndex
    expect(yes('chr*')).toBe(0)
    expect(yes('*.exe')).toBe(0)
    expect(yes('chrome.ex?')).toBe(0)
    expect(yes('chrome.ex??')).toBe(1)
    expect(yes('firefox*')).toBe(1)
  })

  it('введён путь — работают оба семейства правил', () => {
    const t = T({ process: 'C:\\Program Files\\Chrome\\chrome.exe' })
    expect(
      traceMihomo(doc('PROCESS-NAME,chrome.exe,VPN', 'MATCH,D'), t, NO_GEO).winner?.ruleIndex,
    ).toBe(0)
    expect(
      traceMihomo(doc('PROCESS-PATH-REGEX,Program Files,VPN', 'MATCH,D'), t, NO_GEO).winner
        ?.ruleIndex,
    ).toBe(0)
  })

  it('введено имя — правило по ПУТИ остаётся остановкой', () => {
    // Путь из имени не выводится, и подставлять догадку сюда нельзя
    const t = T({ process: 'chrome.exe' })
    const res = traceMihomo(doc('PROCESS-PATH,C:\\x\\chrome.exe,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/путь/i)
  })
})
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Выполнить: `npx vitest run test/mihomo-trace.test.ts`
Ожидается: FAIL — `process` в `TraceTarget` нет.

- [ ] **Шаг 3: поле в цели трассировки**

```ts
// frontend/src/entities/xray/traceMatch.ts — в TraceTarget, рядом с ip
  /**
   * Имя или полный путь процесса; заполняет пользователь. У Xray правил по
   * процессу нет — поле живёт здесь потому, что цель трассировки общая.
   */
  process?: string
```

- [ ] **Шаг 4: реализация в трассировке**

```ts
// frontend/src/entities/mihomo/trace.ts
// Правила по процессу. Семантика — `rules/common/process.go`: точные типы
// сравнивают целиком через EqualFold, `-WILDCARD` — через wildcard.Match с
// обеими сторонами в нижнем регистре, `-REGEX` — через regexp2 с IgnoreCase, и
// это ПОИСК ПОДСТРОКИ, а не совпадение целиком.
const PROCESS_PATH_TYPES = new Set([
  'PROCESS-PATH',
  'PROCESS-PATH-WILDCARD',
  'PROCESS-PATH-REGEX',
])
const PROCESS_NAME_TYPES = new Set([
  'PROCESS-NAME',
  'PROCESS-NAME-WILDCARD',
  'PROCESS-NAME-REGEX',
])

/** `*` — ноль и больше символов, `?` — ровно один, совпадение целиком */
function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === '') return value === ''
  if (pattern === '*') return true
  let p = 0
  let i = 0
  let star = -1
  let mark = 0
  while (i < value.length) {
    const c = pattern[p]
    if (p < pattern.length && (c === '?' || c === value[i])) {
      p++
      i++
      continue
    }
    if (p < pattern.length && c === '*') {
      star = p
      mark = i
      p++
      continue
    }
    if (star !== -1) {
      p = star + 1
      mark++
      i = mark
      continue
    }
    return false
  }
  while (p < pattern.length && pattern[p] === '*') p++
  return p === pattern.length
}

function matchProcess(type: string, pattern: string, value: string): CondResult {
  if (type.endsWith('-REGEX')) {
    let re: RegExp
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      return {
        state: 'unknown',
        reason: `выражение «${pattern}» не разбирается как регулярное`,
      }
    }
    // Не заякорено намеренно: ядро зовёт MatchString, а это поиск подстроки
    return re.test(value) ? YES : NO
  }
  if (type.endsWith('-WILDCARD')) {
    return wildcardMatch(pattern.toLowerCase(), value.toLowerCase()) ? YES : NO
  }
  return pattern.toLowerCase() === value.toLowerCase() ? YES : NO
}

function processCond(ctx: Ctx, type: string, payload: string): CondResult {
  const raw = ctx.target.process?.trim()
  if (raw === undefined || raw === '') {
    return {
      state: 'unknown',
      reason: `условие «${type}» проверяется по процессу — укажите его в цели трассировки`,
    }
  }
  // Разделитель отличает путь от имени: имя и путь у ядра — РАЗНЫЕ поля
  const isPath = raw.includes('/') || raw.includes('\\')
  if (PROCESS_PATH_TYPES.has(type)) {
    if (!isPath) {
      return {
        state: 'unknown',
        reason: `условие «${type}» сравнивает путь процесса, а в цели указано только имя`,
      }
    }
    return matchProcess(type, payload, raw)
  }
  const name = isPath ? (raw.split(/[\\/]/).pop() ?? raw) : raw
  return matchProcess(type, payload, name)
}
```

В `evalCondition` — ветка **до** `NO_DATA_TYPES`:

```ts
  if (PROCESS_NAME_TYPES.has(type) || PROCESS_PATH_TYPES.has(type)) {
    return processCond(ctx, type, payload)
  }
```

И из `NO_DATA_TYPES` убирается предикат `t.startsWith('PROCESS-')`. Список
по-прежнему выводится из `RULE_TYPES` вычитанием, а не переписывается руками.

- [ ] **Шаг 5: поле в строке трассировки**

В `TraceBar` добавить необязательное поле под пропом `showProcess`; в
`MihomoEditorPage` передать `showProcess`. В `Workbench` (Xray) проп не
передаётся — правил по процессу у Xray нет, и лишнее поле там было бы шумом.
Плейсхолдер — `chrome.exe или C:\...\chrome.exe`: он подсказывает оба вида
значения, которые поле принимает.

Тест на разметку — в `frontend/test/trace-bar.test.tsx`: поле есть при
`showProcess`, отсутствует без него, ввод доходит до `onChange` как
`target.process`.

- [ ] **Шаг 6: всё зелёное**

Выполнить: `npm test -w frontend` и `npm run typecheck -w frontend`
Ожидается: PASS.

- [ ] **Шаг 7: мутации**

1. `re.test(value)` → якорить выражение (`^…$`) — падает «REGEX ищет подстроку».
2. Убрать `'i'` у `RegExp` — падает «REGEX не учитывает регистр».
3. В `matchProcess` точное сравнение без `toLowerCase` — падает «точное имя
   сравнивается без учёта регистра».
4. `PROCESS_PATH_TYPES` ветку `!isPath` убрать — падает «введено имя — правило
   по ПУТИ остаётся остановкой».
5. В `wildcardMatch` `'?'` трактовать как «ноль или один» — падает
   «`chrome.ex??`».
6. Вернуть `t.startsWith('PROCESS-')` в `NO_DATA_TYPES` — падают все
   положительные тесты задачи.

- [ ] **Шаг 8: коммит**

```bash
git add frontend/src/entities/xray/traceMatch.ts frontend/src/entities/mihomo/trace.ts frontend/src/features/diagnostics/TraceBar.tsx frontend/src/features/templates/MihomoEditorPage.tsx frontend/test
git commit -m "feat(frontend): trace mihomo process rules from an optional target field"
```

---

### Задача 11: связывание и приёмка

**Файлы:**
- Изменить: `frontend/src/shared/api/hooks.ts`
- Изменить: `frontend/src/features/editor/useMihomoDraft.ts`
- Изменить: `frontend/test/helpers.ts` (фикстура `roscomvpn`)
- Тест: `frontend/test/mihomo-trace-acceptance.test.ts`

**Интерфейсы:**
- Потребляет: всё предыдущее.
- Отдаёт: `useRuleSetMatch(input)` рядом с `useGeoMatch`.

- [ ] **Шаг 1: хук запроса**

По образцу `useGeoMatch` (`frontend/src/shared/api/hooks.ts`), включая
`staleTime` и ключ запроса, куда входят цель и список дескрипторов. На бэкенд
уходят только `http` и `inline`; `file` и `unsupported` в запрос не попадают —
их состояние известно без сети, и трассировка получает его напрямую.

- [ ] **Шаг 2: связывание в черновике**

В `useMihomoDraft` рядом с `geoQuery`:

```ts
  const ruleSets = useMemo(() => (md ? ruleSetDescriptors(md) : []), [md])
  const ruleSetQuery = useRuleSetMatch(
    settledTarget ? { target: settledTarget, sets: ruleSets } : null,
  )
```

и четвёртым аргументом в `traceMihomo` — ответы плюс `pending:
ruleSetQuery.isFetching`. Наборы `file` и `unsupported` подмешиваются как
`unavailable` со своей причиной здесь же: сеть для них не нужна.

- [ ] **Шаг 3: фикстура эталонного шаблона**

```ts
// frontend/test/helpers.ts
import roscomvpnYaml from './fixtures/mihomo/roscomvpn.yaml?raw'

const mihomoFixtures = {
  default: defaultYaml,
  simple: simpleYaml,
  bundle: bundleYaml,
  roscomvpn: roscomvpnYaml,
}
```

Тип параметра `mihomoFixture` расширить на `'roscomvpn'`.

- [ ] **Шаг 4: приёмочный тест**

```ts
// frontend/test/mihomo-trace-acceptance.test.ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { ruleSetDescriptors } from '../src/entities/mihomo/ruleSets'
import { traceMihomo, type RuleSetAnswers } from '../src/entities/mihomo/trace'
import { rulesOf } from '../src/entities/mihomo/rules'
import type { GeoAnswers, TraceTarget } from '../src/entities/xray'
import { mihomoFixture } from './helpers'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const md = parseMihomo(mihomoFixture('roscomvpn'))

/** Все наборы отвечают «нет», кроме classical — он отдаёт свои строки */
function allMiss(): RuleSetAnswers {
  const answers: RuleSetAnswers['answers'] = {}
  for (const set of ruleSetDescriptors(md)) {
    answers[set.name] =
      set.name === 'torrent-clients'
        ? { state: 'lines', lines: ['PROCESS-NAME,uTorrent.exe'], count: 1 }
        : { state: 'no', count: 0 }
  }
  return { answers, pending: false }
}

const target = (over: Partial<TraceTarget> = {}): TraceTarget => ({
  address: 'example.com',
  port: 443,
  network: 'tcp',
  ...over,
})

describe('приёмка: эталонный шаблон RoscomVPN', () => {
  it('в шаблоне 31 правило', () => {
    expect(rulesOf(md)).toHaveLength(31)
  })

  it('без наборов и без процесса проход встаёт в начале списка', () => {
    // Так это выглядело до всей работы: измеренное состояние, а не догадка
    const res = traceMihomo(md, target(), NO_GEO)
    expect(res.stopped?.index).toBe(3)
  })

  it('наборы отвечают, процесса нет — упирается в правила по процессу', () => {
    const res = traceMihomo(md, target(), NO_GEO, allMiss())
    expect(res.stopped?.index).toBe(24)
  })

  it('наборы отвечают и процесс задан — проход доходит до MATCH', () => {
    // Ради этой строки всё и делалось
    const res = traceMihomo(md, target({ process: 'chrome.exe' }), NO_GEO, allMiss())
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 30, target: 'PROXY' })
  })

  it('совпавший набор выигрывает раньше и не доходит до конца', () => {
    const answers = allMiss()
    answers.answers['whitelist'] = { state: 'yes', count: 100 }
    const res = traceMihomo(md, target({ address: 'gosuslugi.ru', process: 'chrome.exe' }), NO_GEO, answers)
    expect(res.winner?.target).toBe('DIRECT')
    expect(res.winner!.ruleIndex).toBeLessThan(30)
  })

  it('один недоступный набор возвращает остановку на нём', () => {
    const answers = allMiss()
    answers.answers['category-ads'] = { state: 'unavailable', reason: 'сервер ответил 404' }
    const res = traceMihomo(md, target({ process: 'chrome.exe' }), NO_GEO, answers)
    expect(res.stopped?.reason).toMatch(/404/)
  })
})
```

Индексы `3`, `24` и `30` в этом тесте — измеренные на настоящем шаблоне, а не
выбранные. Если реализация даёт другие, разбираться надо с реализацией; если
шаблон в каталоге обновится, тест обязан покраснеть — на то он и приёмка.

- [ ] **Шаг 5: всё зелёное**

Выполнить: `npm test`, `npm run build`
Ожидается: PASS.

- [ ] **Шаг 6: мутации**

1. Не подмешивать `file`/`unsupported` как `unavailable` — падает тест
   `useMihomoDraft`, если он есть; иначе добавить его.
2. `pending: ruleSetQuery.isFetching` → `false` — падает тест на «ещё
   загружается» из задачи 9 на уровне черновика.

- [ ] **Шаг 7: оговорка про прокси провайдера**

Спека требует её в плане 1, и данные для неё есть уже здесь: поле `proxy`
дескриптора собрано в задаче 8. Клиент качает такой набор через указанный
прокси, а редактор ходил напрямую — содержимое могло отличаться, и об этом
надо сказать, а не умолчать.

В `collectCaveats` добавить: если хоть один набор, участвовавший в разборе,
имеет непустой `proxy`, дописать оговорку с его именем. Тест: документ с
`proxy: Авто` у сработавшего набора даёт оговорку; без `proxy` — не даёт.
Мутация: убрать условие — оговорка появляется всегда, и второй тест краснеет.

Вторая оговорка спеки, про давность кэша, в плане 1 невозможна: время загрузки
приходит из роута `status`, которого здесь нет. Она уходит в план 2, и это
записано ниже осознанно, а не забыто.

- [ ] **Шаг 8: документация**

В `CLAUDE.md`, в абзац про трассировку Mihomo, дописать: наборы правил
приходят ответами с бэкенда; `classical` считается на фронтенде теми же
правилами; поле «процесс» в цели включает шесть типов `PROCESS-*`; `-REGEX` не
заякорен. В `README` — раздел про кэш наборов в `DATA_DIR/rulesets` и лимиты.

- [ ] **Шаг 9: коммит**

```bash
git add frontend backend CLAUDE.md README.md
git commit -m "feat(frontend): wire rule-set answers into the mihomo trace"
```

---

## Приёмка плана

Одна проверяемая строка: на эталонном `roscomvpn-mihomo-ru.yaml` цель, не
совпавшая ни с одним набором, при заданном процессе доходит до правила #31
(`MATCH,PROXY`). Тест из задачи 11 проверяет и её, и обе промежуточные отметки
— #4 без наборов и #25 без процесса, — чтобы движение было видно, а регресс
нельзя было списать на «так и было».

## Чего этот план НЕ делает

Всё это — план 2:

- роуты `status`, `refresh`, `page`;
- диалог «Наборы правил» и просмотрщик содержимого с поиском;
- обход бора для перечисления доменов и обратное превращение диапазонов в CIDR;
- пометки в панели разбора трассы о том, что ответ пришёл из загруженного
  набора и сколько в нём записей;
- предупреждения о недоступных наборах в общем списке диагностик;
- оговорку про давность кэша: время загрузки приходит из роута `status`,
  которого в плане 1 нет. Вторая оговорка спеки, про поле `proxy`, сделана
  здесь — данные для неё есть.

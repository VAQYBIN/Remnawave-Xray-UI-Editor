# Проверка ядром и Reality-цели — план реализации (этап 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать редактору два внешних вердикта — «соберёт ли конфиг само ядро Xray» и «годится ли выбранная Reality-цель» — с честной деградацией, когда бинаря ядра нет.

**Architecture:** Бэкенд получает две новые ручки. `POST /api/tools/xray-test` пишет конфиг во временный файл внутри `DATA_DIR`, подставляет фиктивных клиентов (профили Remnawave хранятся с `clients: []`) и запускает `xray run -test -c`, передавая процессу `XRAY_LOCATION_ASSET=<DATA_DIR>/geodata` — те же geo-базы, что качает этап 2. `POST /api/tools/reality-target` открывает TLS-соединение через `node:tls` и разбирает `getProtocol`/`getCipher`/`getEphemeralKeyInfo`/`getPeerCertificate` в набор вердиктов. Оба запуска чистые функции + тонкая обёртка над вводом-выводом, поэтому тестируются подменой раннера процесса и `connectImpl`. На фронте — `CheckReportDialog` по кнопке «Проверить конфиг» в топбаре; Reality-цели извлекаются из конфига чистой функцией в `entities/xray`.

**Tech Stack:** Fastify 5 / Node 24 ESM (импорты с суффиксом `.js`), zod ^3.25, `node:child_process`, `node:tls`, vitest, React 19 + TanStack Query, Playwright, Docker multi-stage.

## Global Constraints

- Версия ядра в образе — **v26.6.27**, потому что её использует сама Remnawave. Критерий — совпадение с ядром на нодах, а не «последний релиз».
- sha256 архива `Xray-linux-64.zip` v26.6.27 — `b3e5902d06d6282fe53cfa2fc426058b9aeaa429b2c812e20887cd47f26d08bf` (взят из `Xray-linux-64.zip.dgst`, строка `SHA2-256=`, сверено 2026-07-25).
- Бинарь не найден → `available: false` и текст «проверка недоступна». Ни одна ручка не отдаёт 500 из-за отсутствия ядра: локальная разработка на Windows не должна ломаться.
- Язык UI, сообщений об ошибках и комментариев — русский; коммиты — английский conventional style (`feat(backend): ...`).
- Исходящие соединения (и загрузка, и TLS-проба) идут только на публичные адреса: переиспользуется `backend/src/net/guard.ts`. Опции `GEO_ALLOW_PRIVATE_URLS` у пробы Reality нет — Reality-цель по определению публичный сайт.
- `entities` не импортирует из `features`; сторонних UI-библиотек не добавляем.
- Слои фронта: типы ответов дублируются в `shared/api/types.ts` (у бэкенда и фронта нет общего пакета типов — так во всём проекте).
- Временный файл конфига удаляется в `finally`, путь до него не попадает в текст ошибок пользователю.

## Структура файлов

Создаются:

| Файл | Ответственность |
|---|---|
| `backend/src/xray/dummyClient.ts` | чистая подстановка фиктивного клиента в inbound'ы с пустым `clients` |
| `backend/src/xray/parseOutput.ts` | разбор вывода `xray run -test` в список ошибок с русскими подсказками |
| `backend/src/xray/service.ts` | `XrayService`: временный файл, запуск процесса, сборка `XrayTestResult` |
| `backend/src/tools/realityProbe.ts` | разбор цели, TLS-проба, вердикты по сертификату и версии TLS |
| `frontend/src/entities/xray/realityTargets.ts` | извлечение Reality-целей из конфига |
| `frontend/src/features/diagnostics/CheckReportDialog.tsx` | отчёт проверки ядром и целей |

Модифицируются: `backend/src/config.ts` (`XRAY_BIN`), `backend/src/net/guard.ts` (экспорт `assertPublicHost`), `backend/src/routes/tools.ts`, `backend/src/server.ts`, `backend/test/helpers.ts`, `frontend/src/shared/api/{types,hooks}.ts`, `frontend/src/entities/xray/index.ts`, `frontend/src/features/editor/EditorPage.tsx`, `frontend/src/shared/ui/tokens.css`, `frontend/e2e/mocks.ts`, `Dockerfile`, `.env.example`, `README.md`, `CLAUDE.md`.

---

### Task 1: Подстановка фиктивного клиента

**Files:**
- Create: `backend/src/xray/dummyClient.ts`
- Test: `backend/test/xray-dummy-client.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `withDummyClients(config: unknown): { config: unknown; injected: string[] }`, константа `DUMMY_UUID`.

- [ ] **Step 1: Написать падающий тест**

```ts
// backend/test/xray-dummy-client.test.ts
import { describe, expect, it } from 'vitest'
import { DUMMY_UUID, withDummyClients } from '../src/xray/dummyClient.js'

describe('withDummyClients', () => {
  it('подставляет клиента в vless с пустым clients', () => {
    const src = {
      inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [], decryption: 'none' } }],
    }
    const { config, injected } = withDummyClients(src)
    const clients = (config as any).inbounds[0].settings.clients
    expect(clients).toEqual([{ id: DUMMY_UUID, email: 'xray-ui-editor@test' }])
    expect(injected).toEqual(['vless-in'])
  })

  it('не трогает inbound с настоящими пользователями', () => {
    const src = { inbounds: [{ tag: 'a', protocol: 'vless', settings: { clients: [{ id: 'real' }] } }] }
    const { config, injected } = withDummyClients(src)
    expect((config as any).inbounds[0].settings.clients).toEqual([{ id: 'real' }])
    expect(injected).toEqual([])
  })

  it('в trojan подставляет пароль, а не UUID', () => {
    const { config } = withDummyClients({ inbounds: [{ tag: 't', protocol: 'trojan', settings: {} }] })
    expect((config as any).inbounds[0].settings.clients[0].password).toBeTypeOf('string')
    expect((config as any).inbounds[0].settings.clients[0].id).toBeUndefined()
  })

  it('для shadowsocks-2022 даёт ключ ровно нужной длины', () => {
    const { config } = withDummyClients({
      inbounds: [{ tag: 's', protocol: 'shadowsocks', settings: { method: '2022-blake3-aes-128-gcm', clients: [] } }],
    })
    const password = (config as any).inbounds[0].settings.clients[0].password as string
    expect(Buffer.from(password, 'base64')).toHaveLength(16)
  })

  it('shadowsocks без method получает метод на клиенте', () => {
    const { config } = withDummyClients({ inbounds: [{ tag: 's', protocol: 'shadowsocks', settings: {} }] })
    expect((config as any).inbounds[0].settings.clients[0].method).toBe('chacha20-ietf-poly1305')
  })

  it('одиночный shadowsocks с паролем в settings не трогается', () => {
    const src = { inbounds: [{ tag: 's', protocol: 'shadowsocks', settings: { password: 'p', method: 'aes-128-gcm' } }] }
    const { config, injected } = withDummyClients(src)
    expect((config as any).inbounds[0].settings.clients).toBeUndefined()
    expect(injected).toEqual([])
  })

  it('протоколы без пользователей не трогаются', () => {
    const src = { inbounds: [{ tag: 'd', protocol: 'dokodemo-door', settings: { address: '1.1.1.1' } }] }
    expect(withDummyClients(src).injected).toEqual([])
  })

  it('исходный объект не мутируется', () => {
    const src = { inbounds: [{ tag: 'a', protocol: 'vless', settings: { clients: [] } }] }
    withDummyClients(src)
    expect(src.inbounds[0].settings.clients).toEqual([])
  })

  it('не-объект возвращается как есть', () => {
    expect(withDummyClients('нет').config).toBe('нет')
    expect(withDummyClients(null).injected).toEqual([])
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/xray-dummy-client.test.ts`
Ожидаемо: FAIL — `Cannot find module '../src/xray/dummyClient.js'`.

- [ ] **Step 3: Реализовать**

```ts
// backend/src/xray/dummyClient.ts
// Профили Remnawave хранятся с пустым clients: пользователей инжектит панель при
// раздаче конфига на ноды. Прогон такого документа ядром дал бы ложные ошибки на
// том, что в проде валидно, поэтому перед проверкой подставляем одного фиктивного.

/** Фиксированный UUID: вердикт проверки не должен зависеть от случайного значения */
export const DUMMY_UUID = '11111111-1111-4111-8111-111111111111'
const DUMMY_EMAIL = 'xray-ui-editor@test'
const DUMMY_PASSWORD = 'xray-ui-editor-dummy-password'

// Методы 2022 требуют ключ ровно такой длины в base64, иначе ядро отказывается
const SS2022_KEY_BYTES: Record<string, number> = {
  '2022-blake3-aes-128-gcm': 16,
  '2022-blake3-aes-256-gcm': 32,
  '2022-blake3-chacha20-poly1305': 32,
}

export interface DummyInjection {
  config: unknown
  /** Теги inbound'ов, куда подставлен пользователь — отчёт обязан это показать */
  injected: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dummyClientFor(protocol: string, settings: Record<string, unknown>): Record<string, unknown> {
  if (protocol === 'trojan') return { password: DUMMY_PASSWORD, email: DUMMY_EMAIL }
  if (protocol === 'shadowsocks') {
    const method = typeof settings.method === 'string' ? settings.method : undefined
    const keyBytes = method === undefined ? undefined : SS2022_KEY_BYTES[method]
    if (keyBytes !== undefined) {
      return { password: Buffer.alloc(keyBytes, 7).toString('base64'), email: DUMMY_EMAIL }
    }
    // Метод не задан на уровне settings — ядро ждёт его на клиенте
    if (method === undefined) {
      return { password: DUMMY_PASSWORD, method: 'chacha20-ietf-poly1305', email: DUMMY_EMAIL }
    }
    return { password: DUMMY_PASSWORD, email: DUMMY_EMAIL }
  }
  return { id: DUMMY_UUID, email: DUMMY_EMAIL }
}

export function withDummyClients(config: unknown): DummyInjection {
  const injected: string[] = []
  if (!isRecord(config)) return { config, injected }

  const next = structuredClone(config) as Record<string, unknown>
  if (!Array.isArray(next.inbounds)) return { config: next, injected }

  for (const raw of next.inbounds) {
    if (!isRecord(raw)) continue
    const protocol = typeof raw.protocol === 'string' ? raw.protocol : ''
    if (protocol !== 'vless' && protocol !== 'trojan' && protocol !== 'shadowsocks') continue

    if (!isRecord(raw.settings)) raw.settings = {}
    const settings = raw.settings as Record<string, unknown>
    if (Array.isArray(settings.clients) && settings.clients.length > 0) continue
    // Одиночный shadowsocks (пароль в settings) — валидный конфиг без clients
    if (protocol === 'shadowsocks' && typeof settings.password === 'string' && settings.password !== '') {
      continue
    }

    settings.clients = [dummyClientFor(protocol, settings)]
    injected.push(typeof raw.tag === 'string' ? raw.tag : protocol)
  }

  return { config: next, injected }
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `backend`: `npx vitest run test/xray-dummy-client.test.ts`
Ожидаемо: 9 passed.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/xray/dummyClient.ts backend/test/xray-dummy-client.test.ts
git commit -m "feat(backend): inject a dummy client before core validation"
```

---

### Task 2: Разбор вывода `xray run -test`

**Files:**
- Create: `backend/src/xray/parseOutput.ts`
- Test: `backend/test/xray-parse-output.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `XrayTestError { message: string; line?: number; hint?: string; code?: 'geo' }`, `parseXrayOutput(output: string, configPath: string): XrayTestError[]`, `versionOf(output: string): string | undefined`.

- [ ] **Step 1: Написать падающий тест**

```ts
// backend/test/xray-parse-output.test.ts
import { describe, expect, it } from 'vitest'
import { parseXrayOutput, versionOf } from '../src/xray/parseOutput.js'

const OK = 'Xray 26.6.27 (Xray, Penetrates Everything.) Custom (go1.24.4 linux/amd64)\nConfiguration OK.\n'

describe('versionOf', () => {
  it('достаёт версию из первой строки', () => {
    expect(versionOf(OK)).toBe('26.6.27')
  })

  it('нет строки Xray — undefined', () => {
    expect(versionOf('что-то другое')).toBeUndefined()
  })
})

describe('parseXrayOutput', () => {
  it('успешный прогон — ни одной ошибки', () => {
    expect(parseXrayOutput(OK, '/data/tmp/x.json')).toEqual([])
  })

  it('пустые clients — подсказка про пользователей', () => {
    const out =
      'Failed to start: main: failed to load config: [/data/tmp/x.json] > infra/conf: failed to build config > proxy/vless/inbound: empty clients'
    const errors = parseXrayOutput(out, '/data/tmp/x.json')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.hint).toMatch(/пользовател/i)
  })

  it('путь к временному файлу не утекает в сообщение', () => {
    const out = 'Failed to start: main: failed to load config: [/data/tmp/xray-test-abc.json] > infra/conf: bad'
    const errors = parseXrayOutput(out, '/data/tmp/xray-test-abc.json')
    expect(errors[0]!.message).not.toContain('/data/tmp')
    expect(errors[0]!.message).not.toContain('xray-test-abc.json')
  })

  it('отсутствие geo-баз помечается кодом geo', () => {
    const out =
      'Failed to start: main: failed to load config: [/x.json] > infra/conf: failed to build config > failed to open file: geosite.dat'
    const errors = parseXrayOutput(out, '/x.json')
    expect(errors[0]!.code).toBe('geo')
    expect(errors[0]!.hint).toMatch(/Geo-базы/)
  })

  it('битый тег outbound — своя подсказка', () => {
    const out = 'Failed to start: main: failed to load config: [/x.json] > app/router: unable to find outbound tag: proxy'
    expect(parseXrayOutput(out, '/x.json')[0]!.hint).toMatch(/outbound/i)
  })

  it('номер строки достаётся, если ядро его назвало', () => {
    const out = 'Failed to start: main: failed to load config: [/x.json] > json: invalid character at line 12'
    expect(parseXrayOutput(out, '/x.json')[0]!.line).toBe(12)
  })

  it('незнакомый текст показывается как есть, без подсказки', () => {
    const errors = parseXrayOutput('Failed to start: something entirely new', '/x.json')
    expect(errors[0]!.message).toBe('something entirely new')
    expect(errors[0]!.hint).toBeUndefined()
  })

  it('panic тоже попадает в ошибки', () => {
    expect(parseXrayOutput('panic: runtime error: index out of range', '/x.json')).toHaveLength(1)
  })

  it('вывод без вердикта и без Failed — одна ошибка с исходным текстом', () => {
    const errors = parseXrayOutput('какая-то мусорная строка', '/x.json')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('мусорная')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/xray-parse-output.test.ts`
Ожидаемо: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

```ts
// backend/src/xray/parseOutput.ts
// Ядро сообщает об ошибке цепочкой «слой > слой > конкретная причина» в одну строку.
// Показываем цепочку как есть (по ней ищут в issues), а рядом — русскую подсказку
// для случаев, которые в этом редакторе встречаются регулярно.

export interface XrayTestError {
  message: string
  line?: number
  hint?: string
  /** 'geo' — UI предлагает открыть диалог Geo-баз вместо сырого текста */
  code?: 'geo'
}

const HINTS: { pattern: RegExp; hint: string; code?: 'geo' }[] = [
  {
    pattern: /(geosite|geoip)\.dat|geodata:/i,
    hint: 'Ядро не нашло geo-базы. Загрузите их в диалоге «Geo-базы»: правила с geosite:/geoip: без файлов списков не собираются.',
    code: 'geo',
  },
  {
    pattern: /empty clients|no valid users?|user is not specified/i,
    hint: 'Inbound без пользователей. Панель подставляет их сама, редактор — тоже (на время проверки), так что ошибка означает несовпадение протокола и settings.',
  },
  {
    pattern: /unable to find (outbound|balancer)|tag (does not exist|not found)/i,
    hint: 'Правило или балансер ссылается на тег outbound, которого нет в конфиге.',
  },
  {
    pattern: /reality|empty serverNames/i,
    hint: 'Reality собран неполно: нужны serverNames, приватный ключ и shortIds.',
  },
  {
    pattern: /unknown protocol|unknown (network|security)|unsupported/i,
    hint: 'Ядро не знает такой протокол или транспорт — проверьте написание значения.',
  },
  {
    pattern: /cannot unmarshal|invalid character|failed to parse json/i,
    hint: 'Значение не того типа, чем ждёт ядро (строка вместо числа или наоборот).',
  },
  {
    pattern: /no such file or directory/i,
    hint: 'Конфиг ссылается на файл, которого нет на диске рядом с ядром (сертификат, ключ, лог).',
  },
]

export function versionOf(output: string): string | undefined {
  return /^Xray\s+(\S+)/m.exec(output)?.[1]
}

function scrub(line: string, configPath: string): string {
  const base = configPath.split(/[\\/]/).pop() ?? configPath
  return line
    .replace(/^Failed to start:\s*/i, '')
    .replace(/^main:\s*/i, '')
    .split(configPath)
    .join('конфиг')
    .split(base)
    .join('конфиг')
    .replace(/\[конфиг\]\s*>\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseXrayOutput(output: string, configPath: string): XrayTestError[] {
  if (/Configuration OK/i.test(output)) return []

  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  let raw = lines.filter((l) => /^(failed to|panic:)/i.test(l))
  // Ядро молчит понятным нам образом — не выдумываем причину, показываем весь вывод
  if (raw.length === 0) raw = lines.length > 0 ? [lines.join(' ')] : ['Ядро не вернуло вывода']

  return raw.map((line) => {
    const message = scrub(line, configPath)
    const hit = HINTS.find((h) => h.pattern.test(message))
    const line10 = /(?:at )?line (\d+)/i.exec(message)?.[1]
    return {
      message,
      ...(line10 === undefined ? {} : { line: Number(line10) }),
      ...(hit === undefined ? {} : { hint: hit.hint }),
      ...(hit?.code === undefined ? {} : { code: hit.code }),
    }
  })
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `backend`: `npx vitest run test/xray-parse-output.test.ts`
Ожидаемо: 11 passed. Если тест про `versionOf('что-то другое')` падает — проверить, что регексп с флагом `m` привязан к началу строки.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/xray/parseOutput.ts backend/test/xray-parse-output.test.ts
git commit -m "feat(backend): parse xray -test output into hinted errors"
```

---

### Task 3: `XrayService` — запуск ядра

**Files:**
- Create: `backend/src/xray/service.ts`
- Test: `backend/test/xray-service.test.ts`

**Interfaces:**
- Consumes: `withDummyClients` (Task 1), `parseXrayOutput`/`versionOf`/`XrayTestError` (Task 2).
- Produces: `XrayTestResult { available: boolean; ok: boolean; version?: string; errors: XrayTestError[]; injected: string[] }`, `SpawnRunner`, `class XrayService { constructor(bin: string, dataDir: string, run?: SpawnRunner); test(config: unknown): Promise<XrayTestResult> }`.

- [ ] **Step 1: Написать падающий тест**

```ts
// backend/test/xray-service.test.ts
import { existsSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { XrayService, type SpawnRunner } from '../src/xray/service.js'

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'xui-xray-'))
})

const OK_OUTPUT = 'Xray 26.6.27 (Xray, Penetrates Everything.)\nConfiguration OK.\n'
const CONFIG = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }] }

describe('XrayService.test', () => {
  it('бинаря нет — available: false, а не исключение', async () => {
    const runner: SpawnRunner = async () => ({
      code: null,
      output: '',
      error: Object.assign(new Error('spawn xray ENOENT'), { code: 'ENOENT' }),
    })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res).toMatchObject({ available: false, ok: false })
    expect(res.errors).toEqual([])
  })

  it('Configuration OK — ok: true и версия', async () => {
    const runner: SpawnRunner = async () => ({ code: 0, output: OK_OUTPUT })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res.ok).toBe(true)
    expect(res.version).toBe('26.6.27')
  })

  it('ошибка ядра доезжает с подсказкой', async () => {
    const runner: SpawnRunner = async () => ({
      code: 1,
      output: 'Failed to start: main: failed to load config: [x] > app/router: unable to find outbound tag: proxy',
    })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res.ok).toBe(false)
    expect(res.errors[0]!.hint).toMatch(/outbound/i)
  })

  it('в конфиг на диске попадает фиктивный клиент', async () => {
    let seen: unknown
    const runner: SpawnRunner = async (_bin, args) => {
      seen = JSON.parse(await readFile(args[args.length - 1]!, 'utf8'))
      return { code: 0, output: OK_OUTPUT }
    }
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect((seen as any).inbounds[0].settings.clients).toHaveLength(1)
    expect(res.injected).toEqual(['vless-in'])
  })

  it('временный файл удаляется после прогона', async () => {
    let path = ''
    const runner: SpawnRunner = async (_bin, args) => {
      path = args[args.length - 1]!
      return { code: 0, output: OK_OUTPUT }
    }
    await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(path).not.toBe('')
    expect(existsSync(path)).toBe(false)
  })

  it('ядру передаются geo-базы из DATA_DIR', async () => {
    let asset: string | undefined
    const runner: SpawnRunner = async (_bin, _args, opts) => {
      asset = opts.env.XRAY_LOCATION_ASSET
      return { code: 0, output: OK_OUTPUT }
    }
    await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(asset).toBe(join(dataDir, 'geodata'))
  })

  it('вывода нет вовсе — честная ошибка про таймаут', async () => {
    const runner: SpawnRunner = async () => ({ code: null, output: '' })
    const res = await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(res.available).toBe(true)
    expect(res.ok).toBe(false)
    expect(res.errors[0]!.message).toMatch(/10 секунд|вердикт/i)
  })

  it('аргументы — run -test -c <файл>', async () => {
    let args: string[] = []
    const runner: SpawnRunner = async (_bin, a) => {
      args = a
      return { code: 0, output: OK_OUTPUT }
    }
    await new XrayService('xray', dataDir, runner).test(CONFIG)
    expect(args.slice(0, 3)).toEqual(['run', '-test', '-c'])
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/xray-service.test.ts`
Ожидаемо: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

```ts
// backend/src/xray/service.ts
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withDummyClients } from './dummyClient.js'
import { parseXrayOutput, versionOf, type XrayTestError } from './parseOutput.js'

export interface XrayTestResult {
  /** false — бинаря нет; UI показывает «инструмент недоступен», а не ошибку */
  available: boolean
  ok: boolean
  version?: string
  errors: XrayTestError[]
  /** Теги inbound'ов, куда подставлен фиктивный пользователь */
  injected: string[]
}

export interface SpawnOutcome {
  code: number | null
  output: string
  error?: NodeJS.ErrnoException
}

export type SpawnRunner = (
  bin: string,
  args: string[],
  opts: { env: Record<string, string>; timeoutMs: number },
) => Promise<SpawnOutcome>

const TIMEOUT_MS = 10_000

/** Ядро пишет и в stdout, и в stderr — вердикт может оказаться в любом из них */
const runProcess: SpawnRunner = (bin, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: opts.env,
      timeout: opts.timeoutMs,
      killSignal: 'SIGKILL',
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.on('error', (error: NodeJS.ErrnoException) => resolve({ code: null, output, error }))
    child.on('close', (code) => resolve({ code, output }))
  })

export class XrayService {
  constructor(
    private bin: string,
    private dataDir: string,
    private run: SpawnRunner = runProcess,
  ) {}

  async test(config: unknown): Promise<XrayTestResult> {
    const { config: prepared, injected } = withDummyClients(config)
    const dir = join(this.dataDir, 'tmp')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `xray-test-${randomUUID()}.json`)
    await writeFile(file, JSON.stringify(prepared), 'utf8')

    try {
      const res = await this.run(this.bin, ['run', '-test', '-c', file], {
        // Правила с geosite:/geoip: ядро собирает, читая списки с диска: даём ему
        // те же файлы, что качает диалог «Geo-базы»
        env: { ...process.env, XRAY_LOCATION_ASSET: join(this.dataDir, 'geodata') } as Record<string, string>,
        timeoutMs: TIMEOUT_MS,
      })

      if (res.error?.code === 'ENOENT') return { available: false, ok: false, errors: [], injected }
      if (res.error) {
        return { available: true, ok: false, errors: [{ message: res.error.message }], injected }
      }

      const errors = parseXrayOutput(res.output, file)
      const ok = errors.length === 0 && /Configuration OK/i.test(res.output)
      if (!ok && errors.length === 0) {
        errors.push({ message: 'Ядро не вернуло вердикт — возможно, проверка не успела за 10 секунд.' })
      }
      return { available: true, ok, version: versionOf(res.output), errors, injected }
    } finally {
      await rm(file, { force: true })
    }
  }
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `backend`: `npx vitest run test/xray-service.test.ts`
Ожидаемо: 8 passed.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/xray/service.ts backend/test/xray-service.test.ts
git commit -m "feat(backend): run xray -test against a temporary config"
```

---

### Task 4: `XRAY_BIN` в конфигурации окружения

**Files:**
- Modify: `backend/src/config.ts`, `backend/test/helpers.ts`, `.env.example`
- Test: `backend/test/config.test.ts`

**Interfaces:**
- Produces: `AppConfig.xrayBin: string` (по умолчанию `'xray'`).

- [ ] **Step 1: Написать падающий тест**

Дописать в `backend/test/config.test.ts` (внутрь существующего верхнего `describe`, рядом с прочими кейсами; `validEnv` — уже существующая в файле фикстура окружения, использовать её):

```ts
  it('XRAY_BIN по умолчанию — xray в PATH', () => {
    expect(loadConfig({ ...validEnv }).xrayBin).toBe('xray')
  })

  it('XRAY_BIN берётся из окружения', () => {
    expect(loadConfig({ ...validEnv, XRAY_BIN: '/usr/local/bin/xray' }).xrayBin).toBe(
      '/usr/local/bin/xray',
    )
  })
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/config.test.ts`
Ожидаемо: FAIL — `xrayBin` отсутствует в типе и в результате.

- [ ] **Step 3: Реализовать**

В `backend/src/config.ts` — в `envSchema` после `GEO_ALLOW_PRIVATE_URLS`:

```ts
  // Путь к бинарю ядра для проверки конфига. Не найден — проверка отдаёт
  // available: false, редактор продолжает работать (в т.ч. на Windows).
  XRAY_BIN: z.string().min(1).default('xray'),
```

В `AppConfig` — `xrayBin: string`, в `return` — `xrayBin: e.XRAY_BIN,`.

В `backend/test/helpers.ts` — в `makeTestConfig` после `geoAllowPrivateUrls: false`: `xrayBin: 'xray',`.

В `.env.example` — после блока `GEO_ALLOW_PRIVATE_URLS`:

```
# Путь к бинарю Xray для проверки конфига ядром (кнопка «Проверить конфиг»).
# В Docker-образе бинарь уже лежит по этому пути. Если бинаря нет, редактор
# просто сообщит, что проверка недоступна.
XRAY_BIN=xray
```

- [ ] **Step 4: Тесты должны пройти**

Из каталога `backend`: `npx vitest run test/config.test.ts` — passed; затем `npm run typecheck -w backend` из корня — чисто.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/config.ts backend/test/config.test.ts backend/test/helpers.ts .env.example
git commit -m "feat(backend): configure the xray binary path via XRAY_BIN"
```

---

### Task 5: Вердикты Reality-цели (чистая часть)

**Files:**
- Create: `backend/src/tools/realityProbe.ts`
- Test: `backend/test/reality-probe.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `CheckLevel = 'ok' | 'warn' | 'error'`, `RealityCheck { id: string; level: CheckLevel; title: string; detail?: string }`, `PeerInfo { protocol: string | null; cipher?: string; alpn?: string | null; keyExchange?: string; subject?: string; issuer?: string; altNames: string[]; validTo?: string; authorized?: boolean; authorizationError?: string }`, `certCovers(altNames: string[], name: string): boolean`, `cdnSuspect(info: PeerInfo): string | undefined`, `buildChecks(info: PeerInfo, serverNames: string[]): RealityCheck[]`.

- [ ] **Step 1: Написать падающий тест**

```ts
// backend/test/reality-probe.test.ts
import { describe, expect, it } from 'vitest'
import { buildChecks, cdnSuspect, certCovers, type PeerInfo } from '../src/tools/realityProbe.js'

const GOOD: PeerInfo = {
  protocol: 'TLSv1.3',
  cipher: 'TLS_AES_128_GCM_SHA256',
  alpn: 'h2',
  keyExchange: 'X25519',
  subject: 'www.example.com',
  issuer: "Let's Encrypt R3",
  altNames: ['www.example.com', '*.cdn-free.example.com'],
  validTo: 'Oct 10 12:00:00 2026 GMT',
  authorized: true,
}

describe('certCovers', () => {
  it('точное совпадение', () => {
    expect(certCovers(['www.example.com'], 'www.example.com')).toBe(true)
  })

  it('wildcard покрывает один уровень', () => {
    expect(certCovers(['*.example.com'], 'a.example.com')).toBe(true)
  })

  it('wildcard не покрывает два уровня', () => {
    expect(certCovers(['*.example.com'], 'a.b.example.com')).toBe(false)
  })

  it('wildcard не покрывает сам домен', () => {
    expect(certCovers(['*.example.com'], 'example.com')).toBe(false)
  })

  it('терпит префикс DNS: и разный регистр', () => {
    expect(certCovers(['DNS:WWW.Example.com'], 'www.example.com')).toBe(true)
  })
})

describe('cdnSuspect', () => {
  it('видит Cloudflare по эмитенту', () => {
    expect(cdnSuspect({ ...GOOD, issuer: 'Cloudflare Inc ECC CA-3' })).toBe('cloudflare')
  })

  it('чистый сертификат подозрений не вызывает', () => {
    expect(cdnSuspect(GOOD)).toBeUndefined()
  })
})

describe('buildChecks', () => {
  it('всё хорошо — ни одного warn и error', () => {
    const checks = buildChecks(GOOD, ['www.example.com'])
    expect(checks.every((c) => c.level === 'ok')).toBe(true)
  })

  it('TLS 1.2 — ошибка', () => {
    const checks = buildChecks({ ...GOOD, protocol: 'TLSv1.2' }, ['www.example.com'])
    expect(checks.find((c) => c.id === 'tls13')?.level).toBe('error')
  })

  it('без h2 — предупреждение, а не ошибка', () => {
    const checks = buildChecks({ ...GOOD, alpn: 'http/1.1' }, ['www.example.com'])
    expect(checks.find((c) => c.id === 'alpn')?.level).toBe('warn')
  })

  it('не тот обмен ключами — предупреждение', () => {
    const checks = buildChecks({ ...GOOD, keyExchange: 'P-256' }, ['www.example.com'])
    expect(checks.find((c) => c.id === 'x25519')?.level).toBe('warn')
  })

  it('сертификат не покрывает serverNames — ошибка с перечислением', () => {
    const checks = buildChecks(GOOD, ['other.test'])
    const sni = checks.find((c) => c.id === 'sni')!
    expect(sni.level).toBe('error')
    expect(sni.title).toContain('other.test')
  })

  it('serverNames не заданы — предупреждение', () => {
    expect(buildChecks(GOOD, []).find((c) => c.id === 'sni')?.level).toBe('warn')
  })

  it('CDN подаётся подозрением', () => {
    const checks = buildChecks({ ...GOOD, issuer: 'Cloudflare Inc ECC CA-3' }, ['www.example.com'])
    const cdn = checks.find((c) => c.id === 'cdn')!
    expect(cdn.level).toBe('warn')
    expect(cdn.detail).toMatch(/подозрение/i)
  })

  it('непроверяемая цепочка сертификата — предупреждение с причиной', () => {
    const checks = buildChecks(
      { ...GOOD, authorized: false, authorizationError: 'SELF_SIGNED_CERT_IN_CHAIN' },
      ['www.example.com'],
    )
    const chain = checks.find((c) => c.id === 'chain')!
    expect(chain.level).toBe('warn')
    expect(chain.detail).toContain('SELF_SIGNED_CERT_IN_CHAIN')
  })

  it('доверенная цепочка — вердикт ok', () => {
    expect(buildChecks(GOOD, ['www.example.com']).find((c) => c.id === 'chain')?.level).toBe('ok')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/reality-probe.test.ts`
Ожидаемо: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

```ts
// backend/src/tools/realityProbe.ts
// Проверка Reality-цели: годится ли сайт под маскировку. Своя реализация вместо
// `xray tls ping` — даёт структурированный результат и работает без бинаря ядра.

export type CheckLevel = 'ok' | 'warn' | 'error'

export interface RealityCheck {
  id: string
  level: CheckLevel
  title: string
  detail?: string
}

export interface PeerInfo {
  protocol: string | null
  cipher?: string
  alpn?: string | null
  keyExchange?: string
  subject?: string
  issuer?: string
  altNames: string[]
  validTo?: string
  /** Прошла ли цепочка проверку по системным корням */
  authorized?: boolean
  authorizationError?: string
}

// Короткий список, расширяется по мере надобности. Совпадение — повод присмотреться,
// а не вердикт: за этими же именами живут и обычные сайты.
const CDN_MARKERS = [
  'cloudflare',
  'akamai',
  'fastly',
  'cloudfront',
  'incapsula',
  'imperva',
  'sucuri',
  'stackpath',
  'bunny',
  'gcore',
  'ddos-guard',
  'qrator',
  'edgecast',
  'cdn77',
]

export function certCovers(altNames: string[], name: string): boolean {
  const host = name.trim().toLowerCase().replace(/\.$/, '')
  if (host === '') return false
  return altNames.some((entry) => {
    const pattern = entry.trim().toLowerCase().replace(/^dns:/, '')
    if (pattern === host) return true
    if (!pattern.startsWith('*.')) return false
    const suffix = pattern.slice(1) // '.example.com'
    if (!host.endsWith(suffix)) return false
    const head = host.slice(0, host.length - suffix.length)
    // Wildcard покрывает ровно один уровень и не покрывает сам домен
    return head !== '' && !head.includes('.')
  })
}

export function cdnSuspect(info: PeerInfo): string | undefined {
  const haystack = [info.issuer ?? '', info.subject ?? '', ...info.altNames].join(' ').toLowerCase()
  return CDN_MARKERS.find((marker) => haystack.includes(marker))
}

export function buildChecks(info: PeerInfo, serverNames: string[]): RealityCheck[] {
  const checks: RealityCheck[] = []

  const tls13 = info.protocol === 'TLSv1.3'
  checks.push({
    id: 'tls13',
    level: tls13 ? 'ok' : 'error',
    title: tls13 ? 'TLS 1.3' : `Нет TLS 1.3 (цель отвечает ${info.protocol ?? 'непонятно чем'})`,
    detail: tls13 ? undefined : 'Reality работает только с TLS 1.3 — такая цель не подойдёт.',
  })

  const h2 = info.alpn === 'h2'
  checks.push({
    id: 'alpn',
    level: h2 ? 'ok' : 'warn',
    title: h2 ? 'ALPN h2' : `ALPN не h2 (${info.alpn ?? 'не согласован'})`,
    detail: h2 ? undefined : 'Желательно h2: клиенты чаще всего просят именно его, и профиль трафика будет ближе к настоящему.',
  })

  const x25519 = (info.keyExchange ?? '').toUpperCase().includes('X25519')
  checks.push({
    id: 'x25519',
    level: x25519 ? 'ok' : 'warn',
    title: x25519 ? 'Обмен ключами X25519' : `Обмен ключами ${info.keyExchange ?? 'неизвестен'}`,
    detail: x25519 ? undefined : 'Reality рассчитан на X25519. Другая кривая — цель хуже подходит.',
  })

  if (serverNames.length === 0) {
    checks.push({
      id: 'sni',
      level: 'warn',
      title: 'serverNames не заданы',
      detail: `Сверять сертификат не с чем. Сертификат выдан на: ${info.altNames.join(', ') || '—'}`,
    })
  } else {
    const uncovered = serverNames.filter((name) => !certCovers(info.altNames, name))
    checks.push(
      uncovered.length === 0
        ? { id: 'sni', level: 'ok', title: 'Сертификат покрывает все serverNames' }
        : {
            id: 'sni',
            level: 'error',
            title: `Сертификат не покрывает: ${uncovered.join(', ')}`,
            detail: `В сертификате: ${info.altNames.join(', ') || '—'}`,
          },
    )
  }

  // Соединение установлено с rejectUnauthorized: false — иначе негодная цель дала бы
  // отказ рукопожатия вместо вердикта. Результат проверки цепочки поэтому не
  // выбрасывается, а показывается: у нормального публичного сайта она сходится.
  const authorized = info.authorized !== false
  checks.push({
    id: 'chain',
    level: authorized ? 'ok' : 'warn',
    title: authorized ? 'Сертификат проверяется по системным корням' : 'Цепочка сертификата не проверяется',
    detail: authorized
      ? undefined
      : `Причина: ${info.authorizationError ?? 'неизвестна'}. Reality сам цепочку не проверяет, но обычный публичный сайт такого не показывает — возможно, это не та цель, за которую вы её принимаете.`,
  })

  const cdn = cdnSuspect(info)
  if (cdn !== undefined) {
    checks.push({
      id: 'cdn',
      level: 'warn',
      title: `Похоже на CDN (${cdn})`,
      detail: 'Это подозрение по сертификату, а не факт. За CDN сертификат общий, а адреса меняются — Reality на такой цели ненадёжен.',
    })
  }

  return checks
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `backend`: `npx vitest run test/reality-probe.test.ts`
Ожидаемо: 16 passed.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/tools/realityProbe.ts backend/test/reality-probe.test.ts
git commit -m "feat(backend): judge a reality target from its TLS handshake"
```

---

### Task 6: TLS-проба цели

**Files:**
- Modify: `backend/src/net/guard.ts` (экспорт `assertPublicHost` + необязательная подсказка), `backend/src/tools/realityProbe.ts`
- Test: `backend/test/reality-probe.test.ts` (дописать), `backend/test/net-guard.test.ts` (дописать)

**Interfaces:**
- Consumes: `buildChecks`/`PeerInfo` (Task 5), `isPrivateAddress` (этап 2).
- Produces: `assertPublicHost(hostname: string, opts?: FetchGuardOptions, hint?: string): Promise<void>` (экспорт из `net/guard.ts`); `parseTarget(target: string): { host: string; port: number } | null`; `RealityProbeInput { target: string; serverNames?: string[] }`; `RealityProbeResult { target: string; host?: string; port?: number; reachable: boolean; error?: string; info?: PeerInfo; checks: RealityCheck[] }`; `RealityProbeOptions { lookupImpl?; connectImpl?; timeoutMs? }`; `probeRealityTarget(input: RealityProbeInput, opts?: RealityProbeOptions): Promise<RealityProbeResult>`; тип `RealityProbe = typeof probeRealityTarget`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `backend/test/reality-probe.test.ts` (импорт расширить: `parseTarget`, `probeRealityTarget`):

```ts
describe('parseTarget', () => {
  it('хост с портом', () => {
    expect(parseTarget('example.com:8443')).toEqual({ host: 'example.com', port: 8443 })
  })

  it('без порта — 443', () => {
    expect(parseTarget('example.com')).toEqual({ host: 'example.com', port: 443 })
  })

  it('IPv6 в скобках', () => {
    expect(parseTarget('[2606:4700::1]:443')).toEqual({ host: '2606:4700::1', port: 443 })
  })

  it('мусорный порт — null', () => {
    expect(parseTarget('example.com:0')).toBeNull()
    expect(parseTarget('example.com:abc')).toBeNull()
  })
})

describe('probeRealityTarget', () => {
  const info: PeerInfo = { ...GOOD }

  it('успешная проба возвращает вердикты', async () => {
    const res = await probeRealityTarget(
      { target: 'www.example.com:443', serverNames: ['www.example.com'] },
      { lookupImpl: async () => [{ address: '93.184.216.34' }], connectImpl: async () => info },
    )
    expect(res.reachable).toBe(true)
    expect(res.port).toBe(443)
    expect(res.checks.find((c) => c.id === 'tls13')?.level).toBe('ok')
  })

  it('внутренний адрес отклоняется до соединения', async () => {
    let connected = false
    const res = await probeRealityTarget(
      { target: 'intranet.test:443' },
      {
        lookupImpl: async () => [{ address: '10.0.0.5' }],
        connectImpl: async () => {
          connected = true
          return info
        },
      },
    )
    expect(connected).toBe(false)
    expect(res.reachable).toBe(false)
    expect(res.error).toMatch(/внутреннюю сеть/i)
    expect(res.error).not.toMatch(/GEO_ALLOW_PRIVATE_URLS/)
  })

  it('SNI берётся из первого serverName', async () => {
    let servername = ''
    await probeRealityTarget(
      { target: 'www.example.com:443', serverNames: ['sni.example.com'] },
      {
        lookupImpl: async () => [{ address: '93.184.216.34' }],
        connectImpl: async (o) => {
          servername = o.servername
          return info
        },
      },
    )
    expect(servername).toBe('sni.example.com')
  })

  it('без serverNames SNI равен хосту', async () => {
    let servername = ''
    await probeRealityTarget(
      { target: 'www.example.com' },
      {
        lookupImpl: async () => [{ address: '93.184.216.34' }],
        connectImpl: async (o) => {
          servername = o.servername
          return info
        },
      },
    )
    expect(servername).toBe('www.example.com')
  })

  it('обрыв соединения — reachable: false с текстом ошибки', async () => {
    const res = await probeRealityTarget(
      { target: 'www.example.com:443' },
      {
        lookupImpl: async () => [{ address: '93.184.216.34' }],
        connectImpl: async () => {
          throw new Error('Таймаут соединения')
        },
      },
    )
    expect(res.reachable).toBe(false)
    expect(res.error).toBe('Таймаут соединения')
    expect(res.checks).toEqual([])
  })

  it('неразбираемая цель — понятное сообщение, без запроса', async () => {
    const res = await probeRealityTarget({ target: 'example.com:0' })
    expect(res.reachable).toBe(false)
    expect(res.error).toMatch(/адрес цели/i)
  })
})
```

Дописать в `backend/test/net-guard.test.ts`:

```ts
describe('assertPublicHost', () => {
  it('подсказка добавляется только когда её передали', async () => {
    const lookupImpl = async () => [{ address: '10.1.2.3' }]
    await expect(assertPublicHost('mirror.test', { lookupImpl })).rejects.toThrow(/внутреннюю сеть/)
    await expect(assertPublicHost('mirror.test', { lookupImpl })).rejects.not.toThrow(/GEO_ALLOW/)
    await expect(assertPublicHost('mirror.test', { lookupImpl }, 'подсказка')).rejects.toThrow(
      /подсказка/,
    )
  })
})
```

(импорт `assertPublicHost` добавить к существующим в этом файле)

- [ ] **Step 2: Убедиться, что тесты падают**

Из каталога `backend`: `npx vitest run test/reality-probe.test.ts test/net-guard.test.ts`
Ожидаемо: FAIL — `parseTarget`/`probeRealityTarget`/`assertPublicHost` не экспортируются.

- [ ] **Step 3: Реализовать**

В `backend/src/net/guard.ts` — сделать функцию экспортируемой и принимать подсказку:

```ts
/**
 * Отклоняет хост, если хоть один его адрес внутренний. Общая для загрузки geo-баз
 * и пробы Reality-цели: у обеих адрес приходит из браузера.
 */
export async function assertPublicHost(
  hostname: string,
  opts: FetchGuardOptions = {},
  hint?: string,
): Promise<void> {
  const resolve =
    opts.lookupImpl ?? ((host: string) => lookup(host, { all: true, verbatim: true }))
  let addresses: { address: string }[]
  try {
    addresses = await resolve(hostname)
  } catch {
    throw new Error(`Не удалось разрешить имя «${hostname}»`)
  }
  if (addresses.length === 0) throw new Error(`Имя «${hostname}» ни во что не разрешается`)
  // Проверяем все адреса: достаточно одного внутреннего, чтобы отказать
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      const base = `Адрес «${hostname}» указывает во внутреннюю сеть (${address})`
      throw new Error(hint === undefined ? base : `${base}. ${hint}`)
    }
  }
}
```

и в `fetchExternal` заменить вызов на:

```ts
    if (!opts.allowPrivate) {
      await assertPublicHost(
        parsed.hostname,
        opts,
        'Если это ваше зеркало, включите GEO_ALLOW_PRIVATE_URLS=true',
      )
    }
```

В `backend/src/tools/realityProbe.ts` — дописать снизу:

```ts
import { connect, type PeerCertificate } from 'node:tls'
import { assertPublicHost } from '../net/guard.js'

export interface RealityProbeInput {
  target: string
  serverNames?: string[]
}

export interface RealityProbeResult {
  target: string
  host?: string
  port?: number
  reachable: boolean
  error?: string
  info?: PeerInfo
  checks: RealityCheck[]
}

export interface RealityProbeOptions {
  lookupImpl?: (host: string) => Promise<{ address: string }[]>
  connectImpl?: (opts: {
    host: string
    port: number
    servername: string
    timeoutMs: number
  }) => Promise<PeerInfo>
  timeoutMs?: number
}

const TIMEOUT_MS = 5_000

export function parseTarget(target: string): { host: string; port: number } | null {
  const trimmed = target.trim()
  if (trimmed === '') return null

  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed)
  const [host, rawPort] = bracketed
    ? [bracketed[1]!, bracketed[2]]
    : (() => {
        const idx = trimmed.lastIndexOf(':')
        // Двоеточий больше одного — это IPv6 без скобок, порта в записи нет
        if (idx === -1 || trimmed.indexOf(':') !== idx) return [trimmed, undefined] as const
        return [trimmed.slice(0, idx), trimmed.slice(idx + 1)] as const
      })()

  if (host === '') return null
  if (rawPort === undefined || rawPort === '') return { host, port: 443 }
  if (!/^\d+$/.test(rawPort)) return null
  const port = Number(rawPort)
  if (port < 1 || port > 65535) return null
  return { host, port }
}

function altNamesOf(cert: PeerCertificate | undefined): string[] {
  return (cert?.subjectaltname ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^DNS:/i, ''))
    .filter((entry) => entry !== '')
}

/**
 * rejectUnauthorized: false намеренно — это инспектор, а не транспорт: сертификат
 * мы разбираем сами и обязаны увидеть даже негодный, а секретов в это соединение
 * не отправляется. Результат проверки цепочки не теряется — он уходит в вердикт
 * `chain` (см. buildChecks). minVersion TLS 1.2, чтобы цель без 1.3 не роняла
 * рукопожатие, а честно попадала в вердикт «нет TLS 1.3».
 */
const tlsConnect: NonNullable<RealityProbeOptions['connectImpl']> = (o) =>
  new Promise((resolve, reject) => {
    const socket = connect(
      {
        host: o.host,
        port: o.port,
        servername: o.servername,
        ALPNProtocols: ['h2', 'http/1.1'],
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
      },
      () => {
        const cert = socket.getPeerCertificate()
        const ephemeral = socket.getEphemeralKeyInfo() as { name?: string; type?: string } | null
        resolve({
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name,
          alpn: socket.alpnProtocol === false ? null : (socket.alpnProtocol ?? null),
          keyExchange: ephemeral?.name ?? ephemeral?.type,
          subject: cert?.subject?.CN,
          issuer: [cert?.issuer?.O, cert?.issuer?.CN].filter(Boolean).join(' ') || undefined,
          altNames: altNamesOf(cert),
          validTo: cert?.valid_to,
          authorized: socket.authorized,
          // В типах это Error, но в рантайме встречается и код строкой — терпим оба
          authorizationError:
            typeof socket.authorizationError === 'string'
              ? socket.authorizationError
              : socket.authorizationError?.message,
        })
        socket.end()
      },
    )
    socket.setTimeout(o.timeoutMs, () => socket.destroy(new Error('Цель не ответила за 5 секунд')))
    socket.on('error', reject)
  })

export async function probeRealityTarget(
  input: RealityProbeInput,
  opts: RealityProbeOptions = {},
): Promise<RealityProbeResult> {
  const serverNames = input.serverNames ?? []
  const parsed = parseTarget(input.target)
  if (!parsed) {
    return {
      target: input.target,
      reachable: false,
      error: 'Не разобрал адрес цели: ожидается host или host:port',
      checks: [],
    }
  }

  const base = { target: input.target, host: parsed.host, port: parsed.port }
  try {
    // Тот же запрет, что у загрузки geo-баз: адрес приходит из браузера,
    // а серверу незачем ходить по внутренней сети. Опт-ина здесь нет —
    // Reality-цель по определению публичный сайт.
    await assertPublicHost(parsed.host, { lookupImpl: opts.lookupImpl })
  } catch (err) {
    return { ...base, reachable: false, error: (err as Error).message, checks: [] }
  }

  const doConnect = opts.connectImpl ?? tlsConnect
  try {
    const info = await doConnect({
      host: parsed.host,
      port: parsed.port,
      servername: serverNames[0] ?? parsed.host,
      timeoutMs: opts.timeoutMs ?? TIMEOUT_MS,
    })
    return { ...base, reachable: true, info, checks: buildChecks(info, serverNames) }
  } catch (err) {
    return { ...base, reachable: false, error: (err as Error).message, checks: [] }
  }
}

export type RealityProbe = typeof probeRealityTarget
```

Импорты `connect`/`PeerCertificate`/`assertPublicHost` поднять к остальным импортам в начало файла (в шапке файла из Task 5 импортов не было).

- [ ] **Step 4: Тесты должны пройти**

Из каталога `backend`: `npx vitest run test/reality-probe.test.ts test/net-guard.test.ts test/geo-service.test.ts`
Ожидаемо: всё passed (geo-тесты проверяют, что рефакторинг `guard.ts` ничего не сломал).

- [ ] **Step 5: Коммит**

```bash
git add backend/src/net/guard.ts backend/src/tools/realityProbe.ts backend/test/reality-probe.test.ts backend/test/net-guard.test.ts
git commit -m "feat(backend): probe a reality target over TLS, refusing internal hosts"
```

---

### Task 7: Ручки `/api/tools/xray-test` и `/api/tools/reality-target`

**Files:**
- Modify: `backend/src/routes/tools.ts`, `backend/src/server.ts`
- Test: `backend/test/xray-routes.test.ts`

**Interfaces:**
- Consumes: `XrayService` (Task 3), `probeRealityTarget`/`RealityProbe` (Task 6), `AppConfig.xrayBin` (Task 4).
- Produces: `ServerDeps.xray?: XrayService`, `ServerDeps.probeReality?: RealityProbe`, `FastifyInstance.xray: XrayService`, `toolsRoutes` с опцией `{ probeReality?: RealityProbe }`.

- [ ] **Step 1: Написать падающий тест**

```ts
// backend/test/xray-routes.test.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { XrayService } from '../src/xray/service.js'
import { makeStubRemnawave } from './stub-remnawave.js'
import { loginCookie, makeTestConfig } from './helpers.js'

let app: FastifyInstance
let cookie: string

async function start(overrides: Parameters<typeof buildServer>[1] = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'xui-xray-routes-'))
  app = await buildServer(makeTestConfig({ dataDir }), {
    remnawave: makeStubRemnawave(),
    ...overrides,
  })
  cookie = await loginCookie(app)
}

afterEach(async () => {
  await app.close()
})

describe('POST /api/tools/xray-test', () => {
  beforeEach(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'xui-xray-routes-'))
    await start({
      xray: new XrayService('xray', dataDir, async () => ({
        code: 0,
        output: 'Xray 26.6.27\nConfiguration OK.',
      })),
    })
  })

  it('отдаёт вердикт ядра', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: { config: { inbounds: [], outbounds: [] } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ available: true, ok: true, version: '26.6.27' })
  })

  it('без config — 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('без авторизации — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tools/xray-test', payload: {} })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/tools/reality-target', () => {
  beforeEach(async () => {
    await start({
      probeReality: async (input) => ({
        target: input.target,
        reachable: true,
        checks: [{ id: 'tls13', level: 'ok', title: 'TLS 1.3' }],
      }),
    })
  })

  it('отдаёт вердикты пробы', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-target',
      headers: { cookie },
      payload: { target: 'www.example.com:443', serverNames: ['www.example.com'] },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { checks: { id: string }[] }).checks[0]!.id).toBe('tls13')
  })

  it('без target — 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-target',
      headers: { cookie },
      payload: { serverNames: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('без авторизации — 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-target',
      payload: { target: 'a.test' },
    })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `backend`: `npx vitest run test/xray-routes.test.ts`
Ожидаемо: FAIL — 404 на новых путях (и ошибка типов на `deps.xray`).

- [ ] **Step 3: Реализовать**

`backend/src/routes/tools.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { derivePublicKey, generateRealityKeypair } from '../tools/reality.js'
import { probeRealityTarget, type RealityProbe } from '../tools/realityProbe.js'

const deriveSchema = z.object({ privateKey: z.string().min(1) })
const xrayTestSchema = z.object({ config: z.unknown() })
const realitySchema = z.object({
  target: z.string().min(1),
  serverNames: z.array(z.string()).default([]),
})

export interface ToolsRoutesOptions {
  probeReality?: RealityProbe
}

export const toolsRoutes: FastifyPluginAsync<ToolsRoutesOptions> = async (app, opts) => {
  const probe = opts.probeReality ?? probeRealityTarget

  app.post('/api/tools/reality-keypair', async () => generateRealityKeypair())

  app.post('/api/tools/reality-public-key', async (req) => {
    const { privateKey } = deriveSchema.parse(req.body)
    return { publicKey: derivePublicKey(privateKey) }
  })

  app.post('/api/tools/xray-test', async (req, reply) => {
    // z.unknown() не отличает «не передали» от «передали undefined» — проверяем сами
    const { config } = xrayTestSchema.parse(req.body ?? {})
    if (config === undefined) {
      return reply.status(400).send({ message: 'Нужно передать поле config' })
    }
    return app.xray.test(config)
  })

  app.post('/api/tools/reality-target', async (req) => {
    const input = realitySchema.parse(req.body)
    return probe(input)
  })
}
```

`backend/src/server.ts`:
- импорты: `import { XrayService } from './xray/service.js'`, `import type { RealityProbe } from './tools/realityProbe.js'`;
- в `declare module 'fastify'` → `xray: XrayService`;
- в `ServerDeps` → `xray?: XrayService`, `probeReality?: RealityProbe`;
- после декорации `geo`: `app.decorate('xray', deps.xray ?? new XrayService(config.xrayBin, config.dataDir))`;
- регистрация: `await app.register(toolsRoutes, { probeReality: deps.probeReality })`.

- [ ] **Step 4: Тесты должны пройти**

Из каталога `backend`: `npx vitest run test/xray-routes.test.ts` — 6 passed; затем `npm test -w backend` из корня — всё зелёное; `npm run typecheck -w backend` — чисто.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/routes/tools.ts backend/src/server.ts backend/test/xray-routes.test.ts
git commit -m "feat(backend): expose config and reality target checks over the API"
```

---

### Task 8: Reality-цели из конфига (фронт)

**Files:**
- Create: `frontend/src/entities/xray/realityTargets.ts`
- Modify: `frontend/src/entities/xray/index.ts`
- Test: `frontend/test/reality-targets.test.ts`

**Interfaces:**
- Consumes: `XrayConfig` (существующий тип).
- Produces: `RealityTargetRef { inboundTag: string; target: string; serverNames: string[] }`, `realityTargetsOf(config: XrayConfig): RealityTargetRef[]`.

- [ ] **Step 1: Написать падающий тест**

```ts
// frontend/test/reality-targets.test.ts
import { describe, expect, it } from 'vitest'
import { realityTargetsOf } from '../src/entities/xray'
import type { XrayConfig } from '../src/entities/xray'

function withInbound(inbound: unknown): XrayConfig {
  return { inbounds: [inbound], outbounds: [] } as unknown as XrayConfig
}

describe('realityTargetsOf', () => {
  it('берёт target и serverNames', () => {
    const config = withInbound({
      tag: 'reality-in',
      protocol: 'vless',
      streamSettings: {
        network: 'tcp',
        security: 'reality',
        realitySettings: { target: 'www.microsoft.com:443', serverNames: ['www.microsoft.com'] },
      },
    })
    expect(realityTargetsOf(config)).toEqual([
      { inboundTag: 'reality-in', target: 'www.microsoft.com:443', serverNames: ['www.microsoft.com'] },
    ])
  })

  it('понимает устаревшее имя dest', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'reality', realitySettings: { dest: 'example.com:443' } },
    })
    expect(realityTargetsOf(config)[0]!.target).toBe('example.com:443')
  })

  it('дописывает порт 443, если его нет', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'reality', realitySettings: { target: 'example.com' } },
    })
    expect(realityTargetsOf(config)[0]!.target).toBe('example.com:443')
  })

  it('inbound не на reality пропускается', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'tls', realitySettings: { target: 'example.com:443' } },
    })
    expect(realityTargetsOf(config)).toEqual([])
  })

  it('reality без цели пропускается — проверять нечего', () => {
    const config = withInbound({
      tag: 'a',
      protocol: 'vless',
      streamSettings: { security: 'reality', realitySettings: { serverNames: ['a.test'] } },
    })
    expect(realityTargetsOf(config)).toEqual([])
  })

  it('пустой конфиг — пустой список', () => {
    expect(realityTargetsOf({ inbounds: [], outbounds: [] } as unknown as XrayConfig)).toEqual([])
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/reality-targets.test.ts`
Ожидаемо: FAIL — `realityTargetsOf` не экспортируется.

- [ ] **Step 3: Реализовать**

```ts
// frontend/src/entities/xray/realityTargets.ts
import type { XrayConfig } from './config'

export interface RealityTargetRef {
  inboundTag: string
  /** Всегда host:port — проба на бэкенде ждёт именно такую запись */
  target: string
  serverNames: string[]
}

/** Цель без порта в конфиге допустима: ядро подразумевает 443 */
function withPort(target: string): string {
  const trimmed = target.trim()
  if (trimmed.startsWith('[')) return /\]:\d+$/.test(trimmed) ? trimmed : `${trimmed}:443`
  return /:\d+$/.test(trimmed) ? trimmed : `${trimmed}:443`
}

export function realityTargetsOf(config: XrayConfig): RealityTargetRef[] {
  const out: RealityTargetRef[] = []
  for (const inbound of config.inbounds ?? []) {
    const stream = inbound.streamSettings as
      | { security?: string; realitySettings?: { target?: unknown; dest?: unknown; serverNames?: unknown } }
      | undefined
    if (stream?.security !== 'reality') continue
    const reality = stream.realitySettings
    // dest — устаревшее имя того же поля; в конфигах панели встречаются оба
    const raw = reality?.target ?? reality?.dest
    if (typeof raw !== 'string' || raw.trim() === '') continue
    out.push({
      inboundTag: inbound.tag,
      target: withPort(raw),
      serverNames: Array.isArray(reality?.serverNames)
        ? (reality.serverNames.filter((n) => typeof n === 'string') as string[])
        : [],
    })
  }
  return out
}
```

В `frontend/src/entities/xray/index.ts` добавить `export * from './realityTargets'`.

- [ ] **Step 4: Тест должен пройти**

Из каталога `frontend`: `npx vitest run test/reality-targets.test.ts`
Ожидаемо: 6 passed. Если TS ругается на `inbound.streamSettings` — привести через `as unknown as` внутри функции, не меняя схему inbound'а.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/realityTargets.ts frontend/src/entities/xray/index.ts frontend/test/reality-targets.test.ts
git commit -m "feat(frontend): collect reality targets from the config"
```

---

### Task 9: API-слой фронта

**Files:**
- Modify: `frontend/src/shared/api/types.ts`, `frontend/src/shared/api/hooks.ts`
- Test: `frontend/test/check-hooks.test.tsx`

**Interfaces:**
- Consumes: формы ответов из Task 3 и Task 6.
- Produces: типы `XrayTestError`, `XrayTestResult`, `CheckLevel`, `RealityCheck`, `RealityPeerInfo`, `RealityProbeResult`; хуки `useXrayTest()`, `useRealityProbe()`.

- [ ] **Step 1: Написать падающий тест**

```tsx
// frontend/test/check-hooks.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRealityProbe, useXrayTest } from '../src/shared/api'

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

function withClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useXrayTest', () => {
  it('отправляет конфиг в теле запроса', async () => {
    const fn = mockFetch({ available: true, ok: true, errors: [], injected: [] })
    const { result } = renderHook(() => useXrayTest(), { wrapper: withClient() })
    result.current.mutate({ outbounds: [] })
    await waitFor(() => expect(result.current.data?.ok).toBe(true))
    const [, init] = fn.mock.calls[0]! as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ config: { outbounds: [] } })
  })
})

describe('useRealityProbe', () => {
  it('возвращает вердикты', async () => {
    mockFetch({ target: 'a.test:443', reachable: true, checks: [{ id: 'tls13', level: 'ok', title: 'TLS 1.3' }] })
    const { result } = renderHook(() => useRealityProbe(), { wrapper: withClient() })
    result.current.mutate({ target: 'a.test:443', serverNames: [] })
    await waitFor(() => expect(result.current.data?.checks[0]?.level).toBe('ok'))
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/check-hooks.test.tsx`
Ожидаемо: FAIL — хуки не экспортируются.

- [ ] **Step 3: Реализовать**

В `frontend/src/shared/api/types.ts` дописать:

```ts
export interface XrayTestError {
  message: string
  line?: number
  hint?: string
  code?: 'geo'
}

export interface XrayTestResult {
  available: boolean
  ok: boolean
  version?: string
  errors: XrayTestError[]
  /** Теги inbound'ов, куда на время проверки подставлен фиктивный пользователь */
  injected: string[]
}

export type CheckLevel = 'ok' | 'warn' | 'error'

export interface RealityCheck {
  id: string
  level: CheckLevel
  title: string
  detail?: string
}

export interface RealityPeerInfo {
  protocol: string | null
  cipher?: string
  alpn?: string | null
  keyExchange?: string
  subject?: string
  issuer?: string
  altNames: string[]
  validTo?: string
  authorized?: boolean
  authorizationError?: string
}

export interface RealityProbeResult {
  target: string
  host?: string
  port?: number
  reachable: boolean
  error?: string
  info?: RealityPeerInfo
  checks: RealityCheck[]
}
```

В `frontend/src/shared/api/hooks.ts` — расширить импорт типов и дописать:

```ts
export function useXrayTest() {
  return useMutation({
    mutationFn: (config: unknown) =>
      apiFetch<XrayTestResult>('/api/tools/xray-test', {
        method: 'POST',
        body: JSON.stringify({ config }),
      }),
  })
}

export function useRealityProbe() {
  return useMutation({
    mutationFn: (input: { target: string; serverNames: string[] }) =>
      apiFetch<RealityProbeResult>('/api/tools/reality-target', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `frontend`: `npx vitest run test/check-hooks.test.tsx`
Ожидаемо: 2 passed.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/shared/api/types.ts frontend/src/shared/api/hooks.ts frontend/test/check-hooks.test.tsx
git commit -m "feat(frontend): api hooks for core and reality checks"
```

---

### Task 10: `CheckReportDialog`

**Files:**
- Create: `frontend/src/features/diagnostics/CheckReportDialog.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/check-report-dialog.test.tsx`

**Interfaces:**
- Consumes: `useXrayTest`/`useRealityProbe` (Task 9), `RealityTargetRef` (Task 8), `Button`/`Dialog` из `shared/ui`.
- Produces: `CheckReportDialog({ open, config, targets, onClose, onOpenGeo }): JSX.Element`.

- [ ] **Step 1: Написать падающий тест**

```tsx
// frontend/test/check-report-dialog.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CheckReportDialog } from '../src/features/diagnostics/CheckReportDialog'

function mockRoutes(byUrl: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(byUrl).find((k) => url.includes(k))
      return new Response(JSON.stringify(key ? byUrl[key] : {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => vi.unstubAllGlobals())

const NO_TARGETS: never[] = []

describe('CheckReportDialog', () => {
  it('ядра нет — сообщение вместо ошибки', async () => {
    mockRoutes({ 'xray-test': { available: false, ok: false, errors: [], injected: [] } })
    wrap(<CheckReportDialog open config={{}} targets={NO_TARGETS} onClose={() => {}} onOpenGeo={() => {}} />)
    expect(await screen.findByText(/проверка ядром недоступна/i)).toBeInTheDocument()
  })

  it('конфиг собирается — вердикт и версия', async () => {
    mockRoutes({
      'xray-test': { available: true, ok: true, version: '26.6.27', errors: [], injected: [] },
    })
    wrap(<CheckReportDialog open config={{}} targets={NO_TARGETS} onClose={() => {}} onOpenGeo={() => {}} />)
    expect(await screen.findByText(/ядро собирает конфиг/i)).toBeInTheDocument()
    expect(screen.getByText(/26\.6\.27/)).toBeInTheDocument()
  })

  it('подставленный пользователь отмечается в отчёте', async () => {
    mockRoutes({
      'xray-test': { available: true, ok: true, errors: [], injected: ['vless-in'] },
    })
    wrap(<CheckReportDialog open config={{}} targets={NO_TARGETS} onClose={() => {}} onOpenGeo={() => {}} />)
    expect(await screen.findByText(/подставн/i)).toBeInTheDocument()
    expect(screen.getByText(/vless-in/)).toBeInTheDocument()
  })

  it('ошибка с подсказкой показывает и то, и другое', async () => {
    mockRoutes({
      'xray-test': {
        available: true,
        ok: false,
        errors: [{ message: 'app/router: unable to find outbound tag: proxy', hint: 'Правило ссылается на тег, которого нет.' }],
        injected: [],
      },
    })
    wrap(<CheckReportDialog open config={{}} targets={NO_TARGETS} onClose={() => {}} onOpenGeo={() => {}} />)
    expect(await screen.findByText(/unable to find outbound tag/)).toBeInTheDocument()
    expect(screen.getByText(/тег, которого нет/)).toBeInTheDocument()
  })

  it('ошибка про geo ведёт в диалог баз', async () => {
    const onOpenGeo = vi.fn()
    mockRoutes({
      'xray-test': {
        available: true,
        ok: false,
        errors: [{ message: 'failed to open file: geosite.dat', hint: 'Загрузите базы', code: 'geo' }],
        injected: [],
      },
    })
    wrap(<CheckReportDialog open config={{}} targets={NO_TARGETS} onClose={() => {}} onOpenGeo={onOpenGeo} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Geo-базы' }))
    expect(onOpenGeo).toHaveBeenCalled()
  })

  it('Reality-цель проверяется по кнопке и показывает вердикты', async () => {
    mockRoutes({
      'xray-test': { available: true, ok: true, errors: [], injected: [] },
      'reality-target': {
        target: 'www.microsoft.com:443',
        reachable: true,
        checks: [
          { id: 'tls13', level: 'ok', title: 'TLS 1.3' },
          { id: 'cdn', level: 'warn', title: 'Похоже на CDN (akamai)', detail: 'подозрение' },
        ],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={[{ inboundTag: 'reality-in', target: 'www.microsoft.com:443', serverNames: ['www.microsoft.com'] }]}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    const row = within(await screen.findByRole('listitem', { name: 'reality-in' }))
    await userEvent.click(row.getByRole('button', { name: /проверить цель/i }))
    await waitFor(() => expect(row.getByText('TLS 1.3')).toBeInTheDocument())
    expect(row.getByText(/похоже на cdn/i)).toBeInTheDocument()
  })

  it('без reality-целей — прямая формулировка', async () => {
    mockRoutes({ 'xray-test': { available: true, ok: true, errors: [], injected: [] } })
    wrap(<CheckReportDialog open config={{}} targets={NO_TARGETS} onClose={() => {}} onOpenGeo={() => {}} />)
    expect(await screen.findByText(/reality не используется/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/check-report-dialog.test.tsx`
Ожидаемо: FAIL — компонента нет.

- [ ] **Step 3: Реализовать**

```tsx
// frontend/src/features/diagnostics/CheckReportDialog.tsx
import { useEffect, useState } from 'react'
import {
  useRealityProbe,
  useXrayTest,
  type RealityProbeResult,
  type XrayTestResult,
} from '../../shared/api'
import type { RealityTargetRef } from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'

function CoreReport({
  result,
  pending,
  error,
  onOpenGeo,
}: {
  result: XrayTestResult | undefined
  pending: boolean
  error: Error | undefined
  onOpenGeo: () => void
}) {
  if (pending) return <p className="muted">Проверяю конфиг ядром…</p>
  if (error) return <p className="field-error">{error.message}</p>
  if (!result) return null

  if (!result.available) {
    return (
      <p className="field-warning">
        Проверка ядром недоступна: бинарь Xray не найден. Укажите путь в переменной{' '}
        <span className="mono">XRAY_BIN</span> — в Docker-образе он уже есть.
      </p>
    )
  }

  return (
    <>
      {result.ok ? (
        <p className="check-verdict-ok">
          Ядро собирает конфиг без ошибок
          {result.version && <span className="metric">{`версия ${result.version}`}</span>}
        </p>
      ) : (
        <ul className="check-list" aria-label="Ошибки ядра">
          {result.errors.map((err, i) => (
            <li key={i} className="check-item check-level-error">
              <span className="mono">{err.message}</span>
              {err.line !== undefined && <span className="metric">{`строка ${err.line}`}</span>}
              {err.hint && <span className="check-hint">{err.hint}</span>}
              {err.code === 'geo' && (
                <Button variant="ghost" onClick={onOpenGeo}>
                  Geo-базы
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {result.injected.length > 0 && (
        <p className="muted">
          Проверялся конфиг с подставным пользователем в inbound'ах:{' '}
          <span className="mono">{result.injected.join(', ')}</span>. Панель инжектит реальных
          пользователей сама, поэтому в профиле их нет.
        </p>
      )}
    </>
  )
}

function TargetRow({
  ref_,
  result,
  busy,
  onProbe,
}: {
  ref_: RealityTargetRef
  result: RealityProbeResult | undefined
  busy: boolean
  onProbe: () => void
}) {
  return (
    <li className="check-target" aria-label={ref_.inboundTag}>
      <div className="row">
        <span className="chip-like">{ref_.inboundTag}</span>
        <span className="mono">{ref_.target}</span>
        <span className="spacer" />
        <Button disabled={busy} onClick={onProbe}>
          {busy ? 'Проверяю…' : 'Проверить цель'}
        </Button>
      </div>
      {result && !result.reachable && <p className="field-error">{result.error}</p>}
      {result && result.reachable && (
        <ul className="check-list">
          {result.checks.map((check) => (
            <li key={check.id} className={`check-item check-level-${check.level}`}>
              <span>{check.title}</span>
              {check.detail && <span className="check-hint">{check.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function CheckReportDialog({
  open,
  config,
  targets,
  onClose,
  onOpenGeo,
}: {
  open: boolean
  config: unknown
  targets: RealityTargetRef[]
  onClose: () => void
  onOpenGeo: () => void
}) {
  const test = useXrayTest()
  const probe = useRealityProbe()
  const [probes, setProbes] = useState<Record<string, RealityProbeResult>>({})
  const [busyTag, setBusyTag] = useState<string | null>(null)

  // Проверка ядром локальная и дешёвая — запускаем сразу. Пробы Reality-целей
  // открывают исходящие соединения, поэтому только по кнопке.
  useEffect(() => {
    if (!open) return
    setProbes({})
    test.mutate(config)
    // config меняется по ссылке на каждый рендер редактора — перезапускать проверку не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} title="Проверка конфига" onClose={onClose}>
      <section className="check-section">
        <h3>Ядро Xray</h3>
        <CoreReport
          result={test.data}
          pending={test.isPending}
          error={test.error as Error | undefined}
          onOpenGeo={onOpenGeo}
        />
      </section>

      <section className="check-section">
        <h3>Reality-цели</h3>
        {targets.length === 0 ? (
          <p className="muted">Reality не используется ни в одном inbound'е — проверять нечего.</p>
        ) : (
          <ul className="check-targets">
            {targets.map((ref_) => (
              <TargetRow
                key={ref_.inboundTag}
                ref_={ref_}
                result={probes[ref_.inboundTag]}
                busy={busyTag === ref_.inboundTag && probe.isPending}
                onProbe={() => {
                  setBusyTag(ref_.inboundTag)
                  probe.mutate(
                    { target: ref_.target, serverNames: ref_.serverNames },
                    {
                      onSuccess: (result) =>
                        setProbes((prev) => ({ ...prev, [ref_.inboundTag]: result })),
                      onSettled: () => setBusyTag(null),
                    },
                  )
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}
```

В конец `frontend/src/shared/ui/tokens.css` — рядом с блоком `.trace-*`:

```css
/* Отчёт проверки конфига: секции ядра и Reality-целей */
.check-section { margin-bottom: 16px; }
.check-section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); margin: 0 0 8px; }
.check-verdict-ok { display: flex; align-items: center; gap: 8px; color: var(--ok); margin: 0 0 8px; }
.check-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.check-item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border-left: 3px solid var(--line); background: var(--surface-2); }
.check-level-ok { border-left-color: var(--ok); }
.check-level-warn { border-left-color: var(--warn); }
.check-level-error { border-left-color: var(--danger); }
.check-hint { color: var(--text-dim); flex-basis: 100%; }
.check-targets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.check-target { border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
```

Перед вставкой сверить имена переменных (`--ok`, `--warn`, `--danger`, `--surface-2`, `--line`, `--text-dim`) с тем, что реально объявлено в `tokens.css`, и использовать существующие; при расхождении взять те, которыми пользуется блок `.trace-*`.

- [ ] **Step 4: Тест должен пройти**

Из каталога `frontend`: `npx vitest run test/check-report-dialog.test.tsx`
Ожидаемо: 7 passed. Если `getByRole('listitem', { name: 'reality-in' })` не находит — проверить, что `aria-label` стоит на `<li>`, а не на внутреннем `div`.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/diagnostics/CheckReportDialog.tsx frontend/src/shared/ui/tokens.css frontend/test/check-report-dialog.test.tsx
git commit -m "feat(frontend): report core and reality target checks in a dialog"
```

---

### Task 11: Кнопка «Проверить конфиг» и e2e

**Files:**
- Modify: `frontend/src/features/editor/EditorPage.tsx`, `frontend/e2e/mocks.ts`
- Create: `frontend/e2e/check-report.spec.ts`

**Interfaces:**
- Consumes: `CheckReportDialog` (Task 10), `realityTargetsOf` (Task 8).
- Produces: ничего для последующих задач.

- [ ] **Step 1: Написать падающий тест**

```ts
// frontend/e2e/check-report.spec.ts
import { expect, test } from '@playwright/test'
import { CONFIG, PROFILE, UUID, mockApi } from './mocks'

test.describe('Проверка конфига', () => {
  test('ядро недоступно — редактор сообщает об этом', async ({ page }) => {
    await mockApi(page)
    await page.goto(`/profiles/${UUID}`)
    await page.getByRole('button', { name: 'Проверить конфиг' }).click()
    await expect(page.getByText(/проверка ядром недоступна/i)).toBeVisible()
  })

  test('ошибка ядра показывается с подсказкой', async ({ page }) => {
    await mockApi(page)
    // Позже зарегистрированный обработчик Playwright перекрывает мок из mockApi
    await page.route('**/api/tools/xray-test', (r) =>
      r.fulfill({
        json: {
          available: true,
          ok: false,
          version: '26.6.27',
          errors: [
            {
              message: 'app/router: unable to find outbound tag: proxy',
              hint: 'Правило ссылается на тег outbound, которого нет в конфиге.',
            },
          ],
          injected: ['vless-in'],
        },
      }),
    )
    await page.goto(`/profiles/${UUID}`)
    await page.getByRole('button', { name: 'Проверить конфиг' }).click()
    await expect(page.getByText('unable to find outbound tag: proxy')).toBeVisible()
    await expect(page.getByText(/которого нет в конфиге/)).toBeVisible()
    await expect(page.getByText(/подставным пользователем/i)).toBeVisible()
  })

  test('Reality-цель проверяется по кнопке', async ({ page }) => {
    await mockApi(page)
    const withReality = {
      ...CONFIG,
      inbounds: [
        {
          ...CONFIG.inbounds[0],
          streamSettings: {
            network: 'tcp',
            security: 'reality',
            realitySettings: { target: 'www.microsoft.com:443', serverNames: ['www.microsoft.com'] },
          },
        },
      ],
    }
    await page.route(`**/api/profiles/${UUID}`, (r) =>
      r.fulfill({ json: { profile: { ...PROFILE, config: withReality } } }),
    )
    await page.route('**/api/tools/reality-target', (r) =>
      r.fulfill({
        json: {
          target: 'www.microsoft.com:443',
          reachable: true,
          checks: [{ id: 'tls13', level: 'ok', title: 'TLS 1.3' }],
        },
      }),
    )
    await page.goto(`/profiles/${UUID}`)
    await page.getByRole('button', { name: 'Проверить конфиг' }).click()
    await page.getByRole('button', { name: /проверить цель/i }).click()
    await expect(page.getByText('TLS 1.3')).toBeVisible()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx playwright test e2e/check-report.spec.ts`
Ожидаемо: FAIL — кнопки «Проверить конфиг» нет.

- [ ] **Step 3: Реализовать**

В `frontend/e2e/mocks.ts` внутрь `mockApi`, рядом с прочими `**/api/tools/...`:

```ts
  await page.route('**/api/tools/xray-test', (r) =>
    r.fulfill({ json: { available: false, ok: false, errors: [], injected: [] } }),
  )
```

В `frontend/src/features/editor/EditorPage.tsx`:
- к импортам из `../../entities/xray` добавить `realityTargetsOf`;
- импорт `import { CheckReportDialog } from '../diagnostics/CheckReportDialog'`;
- рядом с `const [geoOpen, setGeoOpen] = useState(false)` — `const [checkOpen, setCheckOpen] = useState(false)`;
- после `const geoKeys = useMemo(...)`:

```ts
  const realityTargets = useMemo(
    () => (parsedConfig ? realityTargetsOf(parsedConfig) : []),
    [parsedConfig],
  )
```

- в топбаре перед кнопкой «Geo-базы»:

```tsx
        <Button
          variant="ghost"
          disabled={parsedConfig === undefined}
          onClick={() => setCheckOpen(true)}
        >
          Проверить конфиг
        </Button>
```

- рядом с `<GeoDataDialog …>`:

```tsx
      <CheckReportDialog
        open={checkOpen}
        config={validation.config}
        targets={realityTargets}
        onClose={() => setCheckOpen(false)}
        onOpenGeo={() => {
          setCheckOpen(false)
          setGeoOpen(true)
        }}
      />
```

- [ ] **Step 4: Тесты должны пройти**

Из каталога `frontend`: `npx playwright test e2e/check-report.spec.ts` — 3 passed. Затем полностью: `npm test -w frontend` и `npm run e2e -w frontend` из корня; `npm run typecheck -w frontend`.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/EditorPage.tsx frontend/e2e/mocks.ts frontend/e2e/check-report.spec.ts
git commit -m "feat(frontend): open the config check report from the topbar"
```

---

### Task 12: Бинарь Xray в образе и документация

**Files:**
- Modify: `Dockerfile`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `XRAY_BIN` (Task 4).
- Produces: образ с ядром v26.6.27 по пути `/usr/local/bin/xray`.

- [ ] **Step 1: Дописать стадию сборки в `Dockerfile`**

Первым блоком файла (до `backend-build`):

```dockerfile
# Ядро для проверки конфига (`xray run -test`). Версия совпадает с той, что
# использует Remnawave: проверять конфиг чужим ядром бессмысленно. sha256 взят
# из Xray-linux-64.zip.dgst того же релиза; при смене версии двигать оба ARG.
FROM alpine:3.22 AS xray
ARG XRAY_VERSION=v26.6.27
ARG XRAY_SHA256=b3e5902d06d6282fe53cfa2fc426058b9aeaa429b2c812e20887cd47f26d08bf
RUN apk add --no-cache curl unzip \
 && curl -fsSL -o /tmp/xray.zip \
    "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" \
 && echo "${XRAY_SHA256}  /tmp/xray.zip" | sha256sum -c - \
 && unzip -j /tmp/xray.zip xray -d /usr/local/bin \
 && chmod +x /usr/local/bin/xray \
 && rm /tmp/xray.zip
```

В финальную стадию, после `ENV STATIC_DIR=/app/frontend/dist`:

```dockerfile
ENV XRAY_BIN=/usr/local/bin/xray
COPY --from=xray /usr/local/bin/xray /usr/local/bin/xray
```

- [ ] **Step 2: Проверить, что стадия собирается и бинарь работает**

```bash
docker build --target xray -t xray-ui-editor-xray .
docker run --rm xray-ui-editor-xray /usr/local/bin/xray -version
```
Ожидаемо: первая строка вывода — `Xray 26.6.27 ...`. Если `sha256sum -c` падает — сверить ARG со строкой `SHA2-256=` в `Xray-linux-64.zip.dgst` релиза, ничего не «поправляя» на глаз.

- [ ] **Step 3: Собрать образ целиком**

```bash
docker build -t xray-ui-editor:check .
```
Ожидаемо: сборка проходит; бинарь лежит в финальном слое, архив — нет (он остался в стадии `xray`).

- [ ] **Step 4: Дописать документацию**

В `README.md` — новый раздел после раздела про geo-базы:

```markdown
### Проверка конфига ядром

Кнопка «Проверить конфиг» в редакторе прогоняет документ через `xray run -test` и проверяет
Reality-цели по TLS.

- В Docker-образе ядро уже лежит: `XRAY_BIN=/usr/local/bin/xray`, версия **v26.6.27** — та же,
  что использует Remnawave. Проверять конфиг ядром другой версии смысла мало, поэтому pin
  двигается вслед за панелью (`XRAY_VERSION` и `XRAY_SHA256` в `Dockerfile`, хэш — из
  `Xray-linux-64.zip.dgst` релиза).
- Без бинаря (обычный случай при локальной разработке) редактор сообщает, что проверка
  недоступна, и продолжает работать.
- Правила с `geosite:`/`geoip:` ядро собирает, читая списки с диска, поэтому перед проверкой
  загрузите geo-базы в диалоге «Geo-базы» — процессу передаётся
  `XRAY_LOCATION_ASSET=<DATA_DIR>/geodata`.
- Профили Remnawave хранятся с пустым `clients`: пользователей инжектит панель. Перед проверкой
  редактор подставляет одного фиктивного, иначе ядро ругалось бы на то, что в проде валидно.
  Отчёт это отмечает.
- Проба Reality-цели открывает исходящее TLS-соединение и запускается только по кнопке.
  Внутренние адреса (loopback, приватные сети, link-local, CGNAT) отклоняются.
```

В `CLAUDE.md`, в разделе «Backend», после пункта про `auth/*`:

```markdown
- `xray/*` — проверка конфига ядром: `dummyClient.ts` подставляет фиктивного пользователя
  (профили панели хранятся с `clients: []`), `service.ts` запускает `xray run -test` с
  `XRAY_LOCATION_ASSET` на geo-базы из `DATA_DIR`, `parseOutput.ts` переводит цепочки ошибок
  ядра в русские подсказки. Нет бинаря — `available: false`, а не ошибка.
- `tools/realityProbe.ts` — TLS-проба Reality-цели (TLS 1.3, ALPN h2, X25519, покрытие
  `serverNames` сертификатом, подозрение на CDN). Исходящие соединения обоих инструментов
  проходят через `net/guard.ts`.
```

В том же файле, в разделе «Frontend», к пункту про `features/topology` + `features/inspector` добавить:

```markdown
- `features/diagnostics` — трассировщик (`TraceBar`/`TracePanel`), диалог geo-баз и отчёт
  проверки конфига (`CheckReportDialog`). Логика трассировки живёт в `entities/xray/trace.ts`,
  бэкенд отвечает только на вопрос «входит ли домен/IP в geo-категорию».
```

- [ ] **Step 5: Коммит**

```bash
git add Dockerfile README.md CLAUDE.md
git commit -m "build: ship xray v26.6.27 in the image for config checks"
```

---

## Финальная проверка

- [ ] `npm test` из корня — оба workspace зелёные
- [ ] `npm run build` из корня — tsup + tsc + vite проходят
- [ ] `npm run e2e -w frontend` — вся папка `e2e` зелёная
- [ ] `docker build -t xray-ui-editor:check .` — образ собирается
- [ ] Далее — **REQUIRED SUB-SKILL:** superpowers:finishing-a-development-branch

## Self-review (выполнен при написании плана)

**Покрытие спеки.** Раздел 4 (проверка ядром: `XRAY_BIN`, временный файл, таймаут, разбор
вывода, инжект фиктивного клиента, `XRAY_LOCATION_ASSET`, Docker с pin и sha256) — задачи
1–4, 7, 12. Раздел 5 (проба Reality: TLS 1.3, ALPN h2, X25519, сертификат против
`serverNames`, подозрение на CDN, отклонение приватных адресов, таймаут 5 секунд) — задачи
5–7. Раздел 6 в части `CheckReportDialog` — задачи 8–11. Раздел 7 (тестирование) — тесты
в каждой задаче плюс три e2e-сценария.

**Расхождения со спекой, принятые сознательно.**
1. `XrayTestResult` содержит `injected: string[]` вместо простого признака: отчёт называет
   конкретные inbound'ы, а не «где-то подставлен пользователь».
2. `XrayTestError` получил `code?: 'geo'`, чтобы UI мог вести в диалог geo-баз кнопкой — тот
   же приём, что уже применён в `TracePanel` по итогам тестирования этапа 1.
3. Пробы Reality-целей не запускаются автоматически при открытии диалога: они открывают
   исходящие соединения, и это должно быть решением пользователя. Проверка ядром — локальная,
   запускается сразу.
4. `assertPublicHost` вынесен в экспорт `net/guard.ts` с необязательной подсказкой вместо
   копии проверки: подсказка про `GEO_ALLOW_PRIVATE_URLS` относится только к загрузке баз.

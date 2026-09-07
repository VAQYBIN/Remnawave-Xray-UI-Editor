# Ядро поддержки Sing-box (план 1 из 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Научить бэкенд сохранять и проверять ядром шаблоны типа `SINGBOX`, а фронтенд — разбирать их, понимать подстановку панели, выдавать диагностики и трассировать маршрут. Без интерфейса.

**Architecture:** Бэкенд получает третий инструмент проверки ядром (`sing-box check`) по образцу двух существующих, с достройкой фиктивных серверов ровно по правилам генератора панели. Фронтенд получает новую сущность `entities/singbox` — модель, словарь, валидации и трассировку — которая ничего не знает об интерфейсе и проверяется юнит-тестами. Общий слой редактора (`useDocumentDraft`, `EditorShell`, `GraphCanvas`, `DocumentAdapter`) в этом плане не меняется вовсе.

**Tech Stack:** TypeScript, Node 24, Fastify, zod 4, vitest. Новых npm-зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-09-07-singbox-templates-design.md`

## Global Constraints

- Целевая версия ядра — **sing-box 1.13.x** (та же, на которую целится генератор панели).
- Ключ панели в документе — `remnawave.includeProxies` (**camelCase**, в отличие от `include-proxies` у Mihomo). Единственное осмысленное значение — `false`.
- Группы выходов — типы `selector` и `urltest`. Прокси-протоколы, которые панель подставляет и учитывает при заполнении групп: `vless`, `trojan`, `shadowsocks`, `hysteria2`.
- Панель дописывает серверы **в конец** массива `outbounds`; списки `outbounds` у групп перезаписывает целиком, кроме групп с `includeProxies: false`; ключ `remnawave` вырезает из результата.
- `route.final` пуст → ядро берёт **первый** элемент `outbounds`.
- Схема разбора **сквозная**: незнакомые ключи проходят насквозь и не делают документ невалидным.
- Белый список типов остаётся белым: новый тип панели обязан молча получить `400`.
- Язык кода: комментарии, сообщения об ошибках и тексты диагностик — русские; коммиты — English conventional style (`feat(backend): ...`).
- Тесты Xray и Mihomo не меняются ни в одной задаче. Их неизменность — доказательство, что общий слой не тронут.
- **Мутационная проверка обязательна:** каждый значимый тест доказывается сломанным кодом и наблюдаемым красным, после чего правка отменяется обратной правкой (не `git checkout --`). Мутация никогда не определяется как замена на пустую строку.
- Проверки перед коммитом: `npm test -w backend` / `npm test -w frontend` и `npm run typecheck -w backend` / `-w frontend`. Вывод не пропускать через `| tail` — код возврата возьмётся от `tail`.

---

## Структура файлов

**Бэкенд (создаются):**
- `backend/src/templates/starterSingbox.ts` — каркас нового шаблона.
- `backend/src/singbox/dummyOutbounds.ts` — достройка документа перед проверкой ядром.
- `backend/src/singbox/parseOutput.ts` — вывод ядра → список строк.
- `backend/src/singbox/service.ts` — `SingboxService`, запуск `sing-box check`.
- `backend/test/fixtures/singbox/{default,bundle,legacy}.json` — настоящие шаблоны каталога.
- `backend/test/singbox-test.test.ts` — тесты достройки, сервиса и роута.

**Бэкенд (правятся):**
- `backend/src/routes/templates.ts` — белый список типов, каркас при создании.
- `backend/src/routes/tools.ts` — роут `POST /api/tools/singbox-test`.
- `backend/src/config.ts` — `SINGBOX_BIN`.
- `backend/src/server.ts` — декоратор `app.singbox`.
- `Dockerfile`, `.env.example` — бинарь ядра.

**Фронтенд (создаются):**
- `frontend/src/entities/singbox/types.ts` — типы разделов документа.
- `frontend/src/entities/singbox/parse.ts` — разбор текста и сквозная схема.
- `frontend/src/entities/singbox/outbounds.ts` — выходы, группы, подстановка панели, дефолтный маршрут.
- `frontend/src/entities/singbox/rules.ts` — правила маршрута: условия, действия, цели.
- `frontend/src/entities/singbox/docSchema.ts` — словарь ключей.
- `frontend/src/entities/singbox/validate.ts` — диагностики.
- `frontend/src/entities/singbox/trace.ts` — трассировка.
- `frontend/src/entities/singbox/index.ts` — реэкспорт.
- `frontend/test/fixtures/singbox/{default,bundle,legacy}.json` — те же шаблоны.
- `frontend/test/singbox-*.test.ts` — по тесту на задачу.

---

### Task 1: Каркас шаблона и белый список типов

**Files:**
- Create: `backend/src/templates/starterSingbox.ts`
- Modify: `backend/src/routes/templates.ts`
- Test: `backend/test/templates-routes.test.ts`, `backend/test/templates-save.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `STARTER_SINGBOX_TEMPLATE: Record<string, unknown>`; `EDITABLE_TEMPLATE_TYPES: readonly TemplateType[]` (экспорт из `routes/templates.ts`).

- [ ] **Step 1: Написать падающие тесты**

В `backend/test/templates-routes.test.ts` добавить:

```ts
it('создание SINGBOX кладёт каркас в templateJson', async () => {
  const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
  const cookie = await loginCookie(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/templates',
    headers: { cookie },
    payload: { name: 'sb', templateType: 'SINGBOX' },
  })
  expect(res.statusCode).toBe(201)
  const { template } = res.json() as { template: { templateJson: Record<string, unknown> } }
  // Каркас обязан быть рабочим: пустой шаблон панель создаст и сама, но
  // подписка из него не отдаст клиенту ни одного сервера
  expect(template.templateJson.outbounds).toBeDefined()
  expect(template.templateJson.route).toBeDefined()
})
```

В `backend/test/templates-save.test.ts` добавить (форма вызовов — как у соседних тестов файла: `makeStubRemnawave(profiles, templates)`, кука уходит в `headers`, uuid берётся у самого шаблона):

```ts
it('PATCH шаблона SINGBOX проходит и требует templateJson', async () => {
  const template = makeStubTemplate({
    templateType: 'SINGBOX',
    templateJson: { outbounds: [{ type: 'direct', tag: 'direct' }] },
  })
  const { app, cookie } = await makeApp([template])

  const ok = await app.inject({
    method: 'PATCH',
    url: `/api/templates/${template.uuid}`,
    headers: { cookie },
    payload: {
      templateJson: { outbounds: [{ type: 'direct', tag: 'direct' }], route: { final: 'direct' } },
      expectedHash: hashTemplateJson(template.templateJson),
    },
  })
  expect(ok.statusCode).toBe(200)

  // Поле содержимого своё у каждого вида: YAML-поле на JSON-шаблоне — ошибка,
  // а не молча принятая правка
  const wrong = await app.inject({
    method: 'PATCH',
    url: `/api/templates/${template.uuid}`,
    headers: { cookie },
    payload: { encodedTemplateYaml: 'eA==', expectedHash: 'x' },
  })
  expect(wrong.statusCode).toBe(400)
  expect((wrong.json() as { message: string }).message).toMatch(/templateJson/)
})

it('тип вне белого списка получает 400, а не проходит молча', async () => {
  const template = makeStubTemplate({
    templateType: 'CLASH',
    templateJson: null,
    encodedTemplateYaml: 'eA==',
  })
  const { app, cookie } = await makeApp([template])
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/templates/${template.uuid}`,
    headers: { cookie },
    payload: { encodedTemplateYaml: 'eA==', expectedHash: 'x' },
  })
  expect(res.statusCode).toBe(400)
  expect((res.json() as { message: string }).message).toMatch(/CLASH/)
})
```

`makeApp` — уже существующий помощник в начале этого файла; он принимает список шаблонов и возвращает `{ app, cookie, stub, template }`. Стаб расширять не нужно: `makeStubTemplate(overrides)` умеет задать любой тип.

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npm test -w backend -- templates-routes templates-save`
Expected: FAIL — `SINGBOX` не проходит `createSchema`, PATCH отвечает 400 «Редактор не умеет шаблоны типа SINGBOX».

- [ ] **Step 3: Написать каркас**

Создать `backend/src/templates/starterSingbox.ts`:

```ts
/**
 * Каркас нового SINGBOX-шаблона. Панель создаёт шаблон пустым, а пустой шаблон
 * бесполезен: подписка из него не даст клиенту ни одного сервера.
 *
 * Список `outbounds` у селектора оставлен пустым намеренно: панель перезапишет
 * его целиком тегами подставленных серверов. Писать сюда что-то осмысленное
 * значило бы изображать данные, которых в отданном клиенту конфиге не будет.
 *
 * `final` задан явно, хотя ядро и без него взяло бы первый выход: неявный
 * дефолт зависит от позиции элемента в массиве и меняется при любой
 * перестановке — в каркасе такой ловушке не место.
 */
export const STARTER_SINGBOX_TEMPLATE = {
  log: { level: 'warn', timestamp: true },
  dns: {
    servers: [
      { tag: 'dns-remote', type: 'tls', server: '1.1.1.1', detour: '→ Remnawave' },
      { tag: 'dns-local', type: 'local' },
    ],
    final: 'dns-local',
  },
  inbounds: [
    {
      type: 'tun',
      tag: 'tun-in',
      address: ['172.19.0.1/30'],
      auto_route: true,
      strict_route: true,
      stack: 'mixed',
    },
    { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2412 },
  ],
  outbounds: [
    { type: 'selector', tag: '→ Remnawave', outbounds: [], interrupt_exist_connections: true },
    { type: 'direct', tag: 'direct' },
  ],
  route: {
    rules: [
      { action: 'sniff' },
      { protocol: 'dns', action: 'hijack-dns' },
      { ip_is_private: true, outbound: 'direct' },
    ],
    final: '→ Remnawave',
    auto_detect_interface: true,
    default_domain_resolver: { server: 'dns-local' },
  },
  experimental: { cache_file: { enabled: true } },
}
```

- [ ] **Step 4: Расширить роут шаблонов**

В `backend/src/routes/templates.ts`:

```ts
import { STARTER_SINGBOX_TEMPLATE } from '../templates/starterSingbox.js'

/**
 * Типы, которые редактор открывает на правку. Белый список, а не чёрный: тип,
 * который панель добавит завтра, обязан молча получить 400, а не молча пройти.
 */
export const EDITABLE_TEMPLATE_TYPES = ['XRAY_JSON', 'MIHOMO', 'SINGBOX'] as const
```

`createSchema` — `templateType: z.enum(EDITABLE_TEMPLATE_TYPES).default('XRAY_JSON')`.

Выбор каркаса при создании:

```ts
function starterFor(type: (typeof EDITABLE_TEMPLATE_TYPES)[number]) {
  if (type === 'MIHOMO') {
    return { encodedTemplateYaml: Buffer.from(STARTER_MIHOMO_TEMPLATE, 'utf8').toString('base64') }
  }
  return { templateJson: type === 'SINGBOX' ? STARTER_SINGBOX_TEMPLATE : STARTER_XRAY_TEMPLATE }
}
```

и в обработчике `POST`: `await app.remnawave.updateTemplate({ uuid: created.uuid, ...starterFor(body.templateType) })`.

Проверку типа в `PATCH` заменить на список, сохранив прежний комментарий о порядке проверок:

```ts
if (!(EDITABLE_TEMPLATE_TYPES as readonly string[]).includes(current.templateType)) {
  return reply.status(400).send({
    message: `Редактор не умеет шаблоны типа ${current.templateType}`,
  })
}
```

Ветка `isYaml` не меняется: `SINGBOX` не входит в `YAML_TEMPLATE_TYPES`, поэтому попадает в JSON-ветку сам.

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w backend` и `npm run typecheck -w backend`
Expected: PASS, включая все прежние тесты шаблонов.

- [ ] **Step 6: Мутационная проверка**

Заменить `EDITABLE_TEMPLATE_TYPES` на `['XRAY_JSON', 'MIHOMO'] as const` → тесты SINGBOX краснеют. Вернуть обратно. Затем заменить на `['XRAY_JSON', 'MIHOMO', 'SINGBOX', 'CLASH'] as const` → краснеет тест про 400 на CLASH. Вернуть обратно.

- [ ] **Step 7: Коммит**

```bash
git add backend/src/templates/starterSingbox.ts backend/src/routes/templates.ts backend/test
git commit -m "feat(backend): editor accepts SINGBOX templates and seeds a starter"
```

---

### Task 2: Достройка документа перед проверкой ядром

**Files:**
- Create: `backend/src/singbox/dummyOutbounds.ts`, `backend/test/fixtures/singbox/{default,bundle,legacy}.json`
- Test: `backend/test/singbox-test.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `withDummyOutbounds(doc: unknown): unknown` — возвращает НОВЫЙ документ, вход не мутируется.

- [ ] **Step 1: Положить фикстуры**

Настоящие шаблоны каталога, а не синтетика: главный риск задачи — «достройка повторяет поведение панели» — на выдуманных пяти строках не проверяется.

```bash
mkdir -p backend/test/fixtures/singbox
base=https://raw.githubusercontent.com/remnawave/templates/refs/heads/main
curl -sfL -o backend/test/fixtures/singbox/default.json "$base/remnawave-default/subscription-templates/singbox.json"
curl -sfL -o backend/test/fixtures/singbox/legacy.json  "$base/remnawave-default/subscription-templates/singbox-legacy.json"
curl -sfL -o backend/test/fixtures/singbox/bundle.json  "$base/by-legiz/subscription-templates/singbox-ru-bundle.json"
```

- [ ] **Step 2: Написать падающие тесты**

Создать `backend/test/singbox-test.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { withDummyOutbounds } from '../src/singbox/dummyOutbounds.js'

type Doc = {
  outbounds: { type: string; tag: string; outbounds?: string[]; remnawave?: unknown }[]
}

function fixture(name: 'default' | 'bundle' | 'legacy'): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/singbox/${name}.json`, import.meta.url), 'utf8'),
  )
}

describe('достройка sing-box перед проверкой ядром', () => {
  it('дописывает серверы в конец и заполняет ими группы', () => {
    const doc = withDummyOutbounds(fixture('default')) as Doc
    const selector = doc.outbounds.find((o) => o.type === 'selector')!
    const dummies = doc.outbounds.filter((o) => o.type === 'shadowsocks').map((o) => o.tag)
    expect(dummies.length).toBeGreaterThan(0)
    // Порядок значим: панель дописывает серверы В КОНЕЦ, и от позиции зависит,
    // какой выход станет дефолтным при пустом route.final
    expect(doc.outbounds.at(-1)!.tag).toBe(dummies.at(-1))
    expect(selector.outbounds).toEqual(expect.arrayContaining(dummies))
  })

  it('селектор получает и теги urltest-групп, а urltest — только прокси', () => {
    const doc = withDummyOutbounds(fixture('bundle')) as Doc
    const selector = doc.outbounds.find((o) => o.type === 'selector')!
    const urltest = doc.outbounds.find((o) => o.type === 'urltest')!
    expect(selector.outbounds).toContain(urltest.tag)
    expect(urltest.outbounds).not.toContain(urltest.tag)
  })

  it('группу с includeProxies: false не трогает', () => {
    const doc = withDummyOutbounds({
      outbounds: [
        { type: 'direct', tag: 'direct' },
        {
          type: 'selector',
          tag: 'fixed',
          outbounds: ['direct'],
          remnawave: { includeProxies: false },
        },
      ],
    }) as Doc
    const fixed = doc.outbounds.find((o) => o.tag === 'fixed')!
    expect(fixed.outbounds).toEqual(['direct'])
  })

  it('вырезает ключ remnawave: ядро строго к незнакомым полям', () => {
    const doc = withDummyOutbounds({
      outbounds: [
        { type: 'selector', tag: 'g', outbounds: [], remnawave: { includeProxies: false } },
      ],
    }) as Doc
    expect(doc.outbounds[0]!.remnawave).toBeUndefined()
    expect(JSON.stringify(doc)).not.toContain('remnawave')
  })

  it('вход не мутируется', () => {
    const input = { outbounds: [{ type: 'selector', tag: 'g', outbounds: null }] }
    const before = JSON.stringify(input)
    withDummyOutbounds(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('документ без outbounds не роняет достройку', () => {
    const doc = withDummyOutbounds({ route: { rules: [] } }) as Doc
    expect(Array.isArray(doc.outbounds)).toBe(true)
  })
})
```

- [ ] **Step 3: Запустить и убедиться, что тесты падают**

Run: `npm test -w backend -- singbox-test`
Expected: FAIL — модуля `dummyOutbounds` не существует.

- [ ] **Step 4: Реализовать достройку**

Создать `backend/src/singbox/dummyOutbounds.ts`:

```ts
// Ядро отвергнет корректный шаблон: группы ссылаются на серверы, которых в
// документе нет — их подставит панель. Перед проверкой кладём фиктивные,
// как xray/dummyClient.ts кладёт фиктивного пользователя.
//
// Повторяем ровно то, что делает генератор панели
// (remnawave/backend, singbox.generator.service.ts): серверы дописываются в
// КОНЕЦ, список группы перезаписывается целиком, `includeProxies: false`
// оставляет список как есть, ключ `remnawave` вырезается. Расхождение с
// генератором сделало бы вердикт ядра ответом про другой документ.

/** Типы выходов, которые панель считает прокси при заполнении групп */
const PROXY_TYPES = new Set(['vless', 'trojan', 'shadowsocks', 'hysteria2'])

/** Фиксированные значения: вердикт проверки не должен зависеть от случайности */
const DUMMY = [
  {
    type: 'shadowsocks',
    tag: 'singbox-dummy-1',
    server: '127.0.0.1',
    server_port: 1080,
    method: 'aes-128-gcm',
    password: 'dummy',
  },
  {
    type: 'shadowsocks',
    tag: 'singbox-dummy-2',
    server: '127.0.0.1',
    server_port: 1081,
    method: 'aes-128-gcm',
    password: 'dummy',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function withDummyOutbounds(doc: unknown): unknown {
  if (!isRecord(doc)) return doc
  // Копия целиком: вход — документ пользователя, и правка на месте отравила бы
  // объект, который вызывающий ещё держит
  const out = structuredClone(doc) as Record<string, unknown>
  delete out.remnawave

  const template = Array.isArray(out.outbounds) ? out.outbounds.filter(isRecord) : []
  const all = [...template, ...DUMMY.map((d) => ({ ...d }))]

  const proxyTags = all
    .filter((o) => typeof o.type === 'string' && PROXY_TYPES.has(o.type))
    .map((o) => String(o.tag))
  const urltestTags = all.filter((o) => o.type === 'urltest').map((o) => String(o.tag))

  out.outbounds = all.map((outbound) => {
    const copy = { ...outbound }
    const panelKey = isRecord(copy.remnawave) ? copy.remnawave : undefined
    delete copy.remnawave
    if (panelKey?.includeProxies === false) return copy
    if (copy.type === 'urltest') return { ...copy, outbounds: proxyTags }
    if (copy.type === 'selector') return { ...copy, outbounds: [...proxyTags, ...urltestTags] }
    return copy
  })

  return out
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w backend -- singbox-test`
Expected: PASS (6 тестов).

- [ ] **Step 6: Мутационная проверка**

Четыре мутации, каждая с обратной правкой:
1. `[...template, ...DUMMY...]` → `[...DUMMY..., ...template]` — краснеет тест про порядок.
2. `if (copy.type === 'urltest') return { ...copy, outbounds: proxyTags }` → `outbounds: [...proxyTags, ...urltestTags]` — краснеет тест про urltest.
3. `if (panelKey?.includeProxies === false) return copy` → `if (false) return copy` — краснеет тест про `includeProxies`.
4. `delete copy.remnawave` → закомментировать — краснеет тест про вырезание ключа.

- [ ] **Step 7: Коммит**

```bash
git add backend/src/singbox backend/test/singbox-test.test.ts backend/test/fixtures/singbox
git commit -m "feat(backend): build a core-checkable sing-box document the way the panel does"
```

---

### Task 3: Сервис проверки ядром

**Files:**
- Create: `backend/src/singbox/parseOutput.ts`, `backend/src/singbox/service.ts`
- Test: `backend/test/singbox-test.test.ts` (дополняется)

**Interfaces:**
- Consumes: `withDummyOutbounds` (задача 2), `runProcess`/`SpawnRunner` из `backend/src/proc/spawn.js`.
- Produces: `SingboxService` с конструктором `(bin: string, dataDir: string, run?: SpawnRunner)` и методом `test(jsonText: string): Promise<SingboxTestResult>`; тип `SingboxTestResult = { available: boolean; ok: boolean; errors: string[] }`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `backend/test/singbox-test.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { vi } from 'vitest'
import { SingboxService } from '../src/singbox/service.js'
import type { SpawnRunner } from '../src/proc/spawn.js'

const TEMPLATE = JSON.stringify({
  outbounds: [{ type: 'selector', tag: 'g', outbounds: null }],
  route: { rules: [], final: 'g' },
})

describe('проверка шаблона sing-box ядром', () => {
  it('нет бинаря — инструмент недоступен, а не ошибка', async () => {
    const run: SpawnRunner = async () => ({
      code: null,
      output: '',
      error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res).toEqual({ available: false, ok: false, errors: [] })
  })

  it('код 0 — вердикт принят', async () => {
    const run: SpawnRunner = async () => ({ code: 0, output: '' })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res.ok).toBe(true)
    expect(res.available).toBe(true)
  })

  it('ненулевой код отдаёт строки ядра, а не пустоту', async () => {
    const run: SpawnRunner = async () => ({
      code: 1,
      output: 'FATAL[0000] decode config at index 0: json: unknown field "oops"\n\n',
      })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res.ok).toBe(false)
    expect(res.errors).toEqual(['FATAL[0000] decode config at index 0: json: unknown field "oops"'])
  })

  it('ядру уходит достроенный документ, и файл удаляется', async () => {
    let seen: unknown
    let path = ''
    const run: SpawnRunner = async (_bin, args) => {
      path = args.at(-1)!
      seen = JSON.parse(await readFile(path, 'utf8'))
      return { code: 0, output: '' }
    }
    await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    const doc = seen as { outbounds: { tag: string; outbounds?: string[] }[] }
    // Пустая группа ядру не годится: панель заполнила бы её тегами серверов
    expect(doc.outbounds[0]!.outbounds!.length).toBeGreaterThan(0)
    await expect(readFile(path, 'utf8')).rejects.toThrow()
  })

  it('вердикт без объяснения всё равно объясняется по-русски', async () => {
    const run: SpawnRunner = async () => ({ code: 1, output: '   \n\n' })
    const res = await new SingboxService('sing-box', tmpdir(), run).test(TEMPLATE)
    expect(res.errors).toEqual(['Ядро отклонило шаблон без объяснения'])
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npm test -w backend -- singbox-test`
Expected: FAIL — модуля `service` не существует.

- [ ] **Step 3: Реализовать разбор вывода**

Создать `backend/src/singbox/parseOutput.ts`:

```ts
/**
 * Формат вывода `sing-box check` от версии к версии не фиксирован, поэтому
 * вердикт берём по коду возврата, а из текста достаём только содержательные
 * строки. Разбор по конкретным фразам ядра сделал бы проверку слепой после
 * первого же обновления.
 */
export function parseSingboxOutput(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}
```

- [ ] **Step 4: Реализовать сервис**

Создать `backend/src/singbox/service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess, type SpawnRunner } from '../proc/spawn.js'
import { withDummyOutbounds } from './dummyOutbounds.js'
import { parseSingboxOutput } from './parseOutput.js'

export interface SingboxTestResult {
  /** false — бинаря нет; UI показывает «инструмент недоступен», а не ошибку */
  available: boolean
  ok: boolean
  errors: string[]
}

const TIMEOUT_MS = 10_000

export class SingboxService {
  constructor(
    private bin: string,
    private dataDir: string,
    private run: SpawnRunner = runProcess,
  ) {}

  /**
   * На вход — ТЕКСТ черновика, а не модель: проверяется то, что видит
   * пользователь. `JSON.parse` здесь может бросить, и вызывающий роут обязан
   * превратить это в 400 по-русски.
   */
  async test(jsonText: string): Promise<SingboxTestResult> {
    const doc = withDummyOutbounds(JSON.parse(jsonText))

    const dir = join(this.dataDir, 'tmp')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `singbox-test-${randomUUID()}.json`)
    await writeFile(file, JSON.stringify(doc), 'utf8')

    try {
      const res = await this.run(this.bin, ['check', '-c', file], {
        env: process.env as Record<string, string>,
        timeoutMs: TIMEOUT_MS,
      })
      if (res.error?.code === 'ENOENT') return { available: false, ok: false, errors: [] }
      if (res.error) return { available: true, ok: false, errors: [res.error.message] }
      if (res.code === 0) return { available: true, ok: true, errors: [] }
      const errors = parseSingboxOutput(res.output)
      return {
        available: true,
        ok: false,
        errors: errors.length > 0 ? errors : ['Ядро отклонило шаблон без объяснения'],
      }
    } finally {
      await rm(file, { force: true })
    }
  }
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w backend -- singbox-test` и `npm run typecheck -w backend`
Expected: PASS.

- [ ] **Step 6: Мутационная проверка**

1. `if (res.error?.code === 'ENOENT')` → `if (false)` — краснеет тест про отсутствующий бинарь.
2. `errors.length > 0 ? errors : ['Ядро отклонило...']` → `errors` — краснеет тест про вердикт без объяснения.
3. Убрать `await rm(file, ...)` из `finally` — краснеет тест про удаление файла.
4. `withDummyOutbounds(JSON.parse(jsonText))` → `JSON.parse(jsonText)` — краснеет тест про достроенный документ.

- [ ] **Step 7: Коммит**

```bash
git add backend/src/singbox backend/test/singbox-test.test.ts
git commit -m "feat(backend): sing-box core check service"
```

---

### Task 4: Роут инструмента и конфигурация

**Files:**
- Modify: `backend/src/config.ts`, `backend/src/server.ts`, `backend/src/routes/tools.ts`, `.env.example`
- Test: `backend/test/singbox-test.test.ts` (дополняется)

**Interfaces:**
- Consumes: `SingboxService` (задача 3).
- Produces: `POST /api/tools/singbox-test` с телом `{ templateJson: unknown }`; декоратор `app.singbox: SingboxService`; поле конфигурации `singboxBin: string` из `SINGBOX_BIN`.

Тело роута принимает **объект** `templateJson`, а не текст: фронтенд отправляет разобранный черновик, а сериализация к тексту — забота сервиса. Синтаксическая ошибка JSON до бэкенда не доходит вовсе — черновик с битым JSON фронтенд не разбирает и кнопку не даёт нажать. Но `JSON.parse` в сервисе всё равно может бросить на невалидном значении, поэтому роут ловит `SyntaxError` и отвечает `400` по-русски — тот же приём, что у `mihomo-test` с `YAMLParseError`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `backend/test/singbox-test.test.ts`:

```ts
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave } from './stub-remnawave.js'

describe('роут проверки шаблона sing-box', () => {
  it('отдаёт вердикт сервиса', async () => {
    const singbox = {
      test: vi.fn(async () => ({ available: true, ok: true, errors: [] })),
    } as unknown as import('../src/singbox/service.js').SingboxService
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave(), singbox })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/singbox-test',
      headers: { cookie },
      payload: { templateJson: { outbounds: [] } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: true, ok: true, errors: [] })
  })

  it('неразбираемое содержимое — 400 по-русски, а не 500 движка', async () => {
    const singbox = {
      test: vi.fn(async () => {
        throw new SyntaxError('Unexpected token')
      }),
    } as unknown as import('../src/singbox/service.js').SingboxService
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave(), singbox })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/singbox-test',
      headers: { cookie },
      payload: { templateJson: 'не объект' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toMatch(/разобрать/i)
  })

  it('требует вход', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/singbox-test',
      payload: { templateJson: {} },
    })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npm test -w backend -- singbox-test`
Expected: FAIL — роут отвечает 404, `deps.singbox` не существует.

- [ ] **Step 3: Конфигурация**

В `backend/src/config.ts` рядом с `MIHOMO_BIN`:

```ts
  SINGBOX_BIN: z.string().min(1).default('sing-box'),
```

в интерфейсе `AppConfig` рядом с `mihomoBin: string` — `singboxBin: string`, и в сборке значения — `singboxBin: e.SINGBOX_BIN,`.

В `.env.example` рядом с `MIHOMO_BIN`:

```
# Ядро sing-box для проверки шаблонов подписки (`sing-box check`).
# Нет бинаря — инструмент просто недоступен, редактор работает.
SINGBOX_BIN=sing-box
```

- [ ] **Step 4: Декоратор сервера**

В `backend/src/server.ts` рядом с декоратором `mihomo`:

```ts
  app.decorate('singbox', deps.singbox ?? new SingboxService(config.singboxBin, config.dataDir))
```

плюс импорт и поле `singbox?: SingboxService` в типе `deps`, и объявление в `declare module 'fastify'` рядом с `mihomo` (найти существующее объявление и повторить его форму).

- [ ] **Step 5: Роут**

В `backend/src/routes/tools.ts` рядом со схемами:

```ts
const singboxSchema = z.object({ templateJson: z.unknown() })
```

и сам роут после `mihomo-test`:

```ts
  app.post('/api/tools/singbox-test', async (req, reply) => {
    const { templateJson } = singboxSchema.parse(req.body)
    try {
      return await app.singbox.test(JSON.stringify(templateJson))
    } catch (error) {
      // Кнопку жмут именно тогда, когда с документом что-то не так: ответ
      // обязан быть 400 по-русски, а не 500 движка по-английски
      if (error instanceof SyntaxError) {
        return reply.status(400).send({ message: 'Не удалось разобрать шаблон как JSON' })
      }
      throw error
    }
  })
```

- [ ] **Step 6: Прогнать тесты**

Run: `npm test -w backend` и `npm run typecheck -w backend`
Expected: PASS целиком.

- [ ] **Step 7: Мутационная проверка**

1. Убрать `try/catch` вокруг вызова сервиса — краснеет тест про 400.
2. Зарегистрировать роут вне защищённой области (если в файле есть такое разделение) либо временно снять guard — краснеет тест про 401. Если guard общий для всех `/api/*` и снять его локально нельзя, мутацией служит переименование пути роута: тест про 401 останется зелёным, а два других покраснеют — это и доказывает, что тесты видят именно этот путь.

- [ ] **Step 8: Коммит**

```bash
git add backend/src .env.example backend/test/singbox-test.test.ts
git commit -m "feat(backend): expose the sing-box check as an API tool"
```

---

### Task 5: Бинарь ядра в образе

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `SINGBOX_BIN` (задача 4).
- Produces: `/usr/local/bin/sing-box` в финальном образе.

Эта задача не имеет юнит-теста: проверяется сборкой образа. Так же устроены и две существующие стадии.

- [ ] **Step 1: Узнать версию и контрольные суммы**

```bash
curl -sfL https://api.github.com/repos/SagerNet/sing-box/releases/latest | grep '"tag_name"'
```

Взять последний релиз ветки 1.13.x (целевая версия из спеки). Скачать оба архива и посчитать суммы:

```bash
v=1.13.0   # подставить фактическую версию без ведущей v
for arch in amd64 arm64; do
  curl -sfL -o /tmp/sb-$arch.tar.gz \
    "https://github.com/SagerNet/sing-box/releases/download/v$v/sing-box-$v-linux-$arch.tar.gz"
  sha256sum /tmp/sb-$arch.tar.gz
done
```

- [ ] **Step 2: Добавить стадию сборки**

В `Dockerfile` после стадии `mihomo`:

```dockerfile
# Ядро sing-box для проверки шаблонов подписки (`sing-box check`). Приём тот же,
# что у стадий xray и mihomo: закреплённая версия и контрольная сумма,
# архитектура — от buildx.
FROM alpine:3.24 AS singbox

ARG SINGBOX_VERSION=1.13.0
ARG SINGBOX_SHA256_AMD64=<сумма из шага 1>
ARG SINGBOX_SHA256_ARM64=<сумма из шага 1>

RUN set -eux; \
    apk add --no-cache curl tar; \
    case "$(apk --print-arch)" in \
      x86_64)  arch=amd64; sha="$SINGBOX_SHA256_AMD64" ;; \
      aarch64) arch=arm64; sha="$SINGBOX_SHA256_ARM64" ;; \
      *) echo "unsupported arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/sing-box.tar.gz \
      "https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-${arch}.tar.gz"; \
    echo "${sha}  /tmp/sing-box.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/sing-box.tar.gz -C /tmp; \
    mv "/tmp/sing-box-${SINGBOX_VERSION}-linux-${arch}/sing-box" /usr/local/bin/sing-box; \
    chmod +x /usr/local/bin/sing-box; \
    rm -rf /tmp/sing-box.tar.gz "/tmp/sing-box-${SINGBOX_VERSION}-linux-${arch}"
```

Определение архитектуры взять ровно то же, каким пользуются стадии `xray` и `mihomo` в этом файле: они уже решили этот вопрос, и второй способ в одном файле — источник расхождения.

В финальной стадии рядом с двумя существующими строками:

```dockerfile
ENV SINGBOX_BIN=/usr/local/bin/sing-box
COPY --from=singbox /usr/local/bin/sing-box /usr/local/bin/sing-box
```

- [ ] **Step 3: Собрать образ и проверить бинарь**

```bash
docker build -t xray-ui-editor:singbox-check .
docker run --rm xray-ui-editor:singbox-check sing-box version
```
Expected: печатается версия 1.13.x.

Если Docker в среде исполнителя недоступен — сборку не подделывать: отметить в отчёте как непроверенное и сообщить контроллеру. Ложный «проверено» здесь дороже, чем честный пропуск.

- [ ] **Step 4: Коммит**

```bash
git add Dockerfile
git commit -m "build: ship the sing-box core for template checking"
```

---
### Task 6: Типы и разбор документа

**Files:**
- Create: `frontend/src/entities/singbox/types.ts`, `frontend/src/entities/singbox/parse.ts`, `frontend/src/entities/singbox/index.ts`, `frontend/test/fixtures/singbox/{default,bundle,legacy}.json`
- Test: `frontend/test/singbox-parse.test.ts`

**Interfaces:**
- Consumes: `ValidationIssue`, `PathParts` из `../xray/config` (тот же импорт использует `entities/mihomo/validate.ts`).
- Produces: типы `SingboxDoc`, `SingboxOutbound`, `SingboxInbound`, `SingboxRule`, `SingboxRoute`, `SingboxRuleSet`; функция `parseSingbox(text: string): { ok: boolean; doc?: SingboxDoc; issues: ValidationIssue[] }`.

- [ ] **Step 1: Положить фикстуры**

```bash
mkdir -p frontend/test/fixtures/singbox
base=https://raw.githubusercontent.com/remnawave/templates/refs/heads/main
curl -sfL -o frontend/test/fixtures/singbox/default.json "$base/remnawave-default/subscription-templates/singbox.json"
curl -sfL -o frontend/test/fixtures/singbox/legacy.json  "$base/remnawave-default/subscription-templates/singbox-legacy.json"
curl -sfL -o frontend/test/fixtures/singbox/bundle.json  "$base/by-legiz/subscription-templates/singbox-ru-bundle.json"
```

Это те же три файла, что в `backend/test/fixtures/singbox/`. Дублирование ДАННЫХ между workspace намеренно: общих файлов между ними нет, а копия дешевле непроверенного риска.

- [ ] **Step 2: Написать падающие тесты**

Создать `frontend/test/singbox-parse.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'

function fixture(name: 'default' | 'bundle' | 'legacy'): string {
  return readFileSync(new URL(`./fixtures/singbox/${name}.json`, import.meta.url), 'utf8')
}

describe('разбор документа sing-box', () => {
  it.each(['default', 'bundle', 'legacy'] as const)('настоящий шаблон %s разбирается', (name) => {
    const res = parseSingbox(fixture(name))
    expect(res.ok).toBe(true)
    expect(res.issues).toEqual([])
    expect(res.doc!.outbounds!.length).toBeGreaterThan(0)
  })

  it('битый JSON объясняется по-русски и не даёт модели', () => {
    const res = parseSingbox('{ "outbounds": [')
    expect(res.ok).toBe(false)
    expect(res.doc).toBeUndefined()
    expect(res.issues[0]!.level).toBe('error')
    expect(res.issues[0]!.message).toMatch(/JSON/)
    expect(res.issues[0]!.parts).toEqual([])
  })

  it('корень-массив — ошибка с понятной причиной', () => {
    const res = parseSingbox('[]')
    expect(res.ok).toBe(false)
    expect(res.issues[0]!.message).toMatch(/объект/)
  })

  it('выход без type — ошибка с путём до элемента', () => {
    const res = parseSingbox('{"outbounds":[{"tag":"x"}]}')
    expect(res.ok).toBe(false)
    expect(res.issues[0]!.parts).toEqual(['outbounds', 0, 'type'])
  })

  it('незнакомые ключи проходят насквозь', () => {
    // Ядро развивается быстрее словаря: строгая схема отвергала бы валидные
    // документы будущих версий
    const res = parseSingbox('{"outbounds":[{"type":"direct","tag":"d","brand_new_field":1}],"future_section":{"a":1}}')
    expect(res.ok).toBe(true)
    expect(res.doc!.outbounds![0]!.brand_new_field).toBe(1)
    expect(res.doc!.future_section).toEqual({ a: 1 })
  })

  it('null в outbounds группы сохраняется как есть', () => {
    // Дефолтный шаблон панели пишет именно null, и модель обязана уметь его
    // отличить от пустого списка
    const res = parseSingbox('{"outbounds":[{"type":"selector","tag":"g","outbounds":null}]}')
    expect(res.ok).toBe(true)
    expect(res.doc!.outbounds![0]!.outbounds).toBeNull()
  })
})
```

- [ ] **Step 3: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-parse.test.ts` (из каталога `frontend`)
Expected: FAIL — модуля `parse` не существует.

- [ ] **Step 4: Написать типы**

Создать `frontend/src/entities/singbox/types.ts`:

```ts
// Типы документа sing-box. Все интерфейсы открыты индексной сигнатурой: схема
// разбора сквозная, и ключ, которого мы не знаем, обязан доезжать до текста
// нетронутым, а не исчезать при первом сохранении.

/** Ключ панели внутри элемента outbounds. camelCase — не описка: у Mihomo он kebab-case */
export interface SingboxPanelKey {
  includeProxies?: boolean
}

export interface SingboxOutbound {
  type: string
  tag?: string
  /**
   * У групп — список тегов. `null` пишет дефолтный шаблон панели, и это НЕ то же
   * самое, что пустой список: панель перезапишет и то и другое, а вот форма
   * должна различать «поле не заполняли» и «заполнили пустым».
   */
  outbounds?: string[] | null
  remnawave?: SingboxPanelKey
  [key: string]: unknown
}

export interface SingboxInbound {
  type: string
  tag?: string
  [key: string]: unknown
}

/** Правило маршрута: набор условий плюс служебные поля. Условия свободны по составу */
export interface SingboxRule {
  [key: string]: unknown
}

export interface SingboxRuleSet {
  tag?: string
  [key: string]: unknown
}

export interface SingboxRoute {
  rules?: SingboxRule[]
  rule_set?: SingboxRuleSet[]
  final?: string
  [key: string]: unknown
}

export interface SingboxDns {
  servers?: Record<string, unknown>[]
  rules?: SingboxRule[]
  final?: string
  [key: string]: unknown
}

export interface SingboxDoc {
  log?: Record<string, unknown>
  dns?: SingboxDns
  inbounds?: SingboxInbound[]
  outbounds?: SingboxOutbound[]
  endpoints?: Record<string, unknown>[]
  route?: SingboxRoute
  experimental?: Record<string, unknown>
  [key: string]: unknown
}
```

- [ ] **Step 5: Написать разбор**

Создать `frontend/src/entities/singbox/parse.ts`:

```ts
// Разбор текста шаблона. Схема проверяет КАРКАС и ничего больше: у элемента
// outbounds обязателен `type` (без него неизвестно, что это за выход и как его
// рисовать), всё остальное проходит насквозь. Ядро развивается быстрее нашего
// словаря, и строгая схема отвергала бы валидные документы — тот же выбор
// сделан в схеме Xray.

import { z } from 'zod'
import type { PathParts, ValidationIssue } from '../xray/config'
import type { SingboxDoc } from './types'

function issue(parts: PathParts, message: string): ValidationIssue {
  return { parts, path: parts.join('.'), message, level: 'error' }
}

const OutboundSchema = z.looseObject({ type: z.string() })
const InboundSchema = z.looseObject({ type: z.string() })

const DocSchema = z.looseObject({
  inbounds: z.array(InboundSchema).optional(),
  outbounds: z.array(OutboundSchema).optional(),
  route: z.looseObject({}).optional(),
  dns: z.looseObject({}).optional(),
})

export function parseSingbox(text: string): {
  ok: boolean
  doc?: SingboxDoc
  issues: ValidationIssue[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      issues: [issue([], `Некорректный JSON: ${err instanceof Error ? err.message : String(err)}`)],
    }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [issue([], 'Ожидается объект конфигурации sing-box')] }
  }

  const parsed = DocSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => issue(i.path as PathParts, i.message)),
    }
  }

  return { ok: true, doc: parsed.data as SingboxDoc, issues: [] }
}
```

Создать `frontend/src/entities/singbox/index.ts`:

```ts
export * from './types'
export * from './parse'
```

- [ ] **Step 6: Прогнать тесты**

Run: `npx vitest run test/singbox-parse.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (8 проверок вместе с `it.each`).

- [ ] **Step 7: Мутационная проверка**

1. `z.looseObject({ type: z.string() })` → `z.looseObject({})` — краснеет тест про выход без `type`.
2. `z.looseObject` → `z.object` в `OutboundSchema` — краснеет тест про незнакомые ключи.
3. Убрать проверку `Array.isArray(raw)` — краснеет тест про корень-массив.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/entities/singbox frontend/test/singbox-parse.test.ts frontend/test/fixtures/singbox
git commit -m "feat(frontend): parse sing-box templates with a permissive schema"
```

---

### Task 7: Выходы, группы и подстановка панели

**Files:**
- Create: `frontend/src/entities/singbox/outbounds.ts`
- Modify: `frontend/src/entities/singbox/index.ts`
- Test: `frontend/test/singbox-outbounds.test.ts`

**Interfaces:**
- Consumes: `SingboxDoc`, `SingboxOutbound` (задача 6).
- Produces:
  - `PROXY_OUTBOUND_TYPES: ReadonlySet<string>` — `vless`, `trojan`, `shadowsocks`, `hysteria2`;
  - `GROUP_OUTBOUND_TYPES: ReadonlySet<string>` — `selector`, `urltest`;
  - `outboundsOf(doc: SingboxDoc): SingboxOutbound[]`;
  - `groupsOf(doc: SingboxDoc): SingboxOutbound[]`;
  - `panelFillsGroup(group: SingboxOutbound): boolean`;
  - `panelFilledTags(doc: SingboxDoc, group: SingboxOutbound): string[]`;
  - `documentGetsPanelServers(doc: SingboxDoc): boolean`;
  - `defaultRoute(doc: SingboxDoc): { tag?: string; fromFinal: boolean }`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-outbounds.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import {
  defaultRoute,
  documentGetsPanelServers,
  groupsOf,
  panelFilledTags,
  panelFillsGroup,
} from '../src/entities/singbox/outbounds'
import type { SingboxDoc } from '../src/entities/singbox/types'

function fixtureDoc(name: 'default' | 'bundle' | 'legacy'): SingboxDoc {
  const text = readFileSync(new URL(`./fixtures/singbox/${name}.json`, import.meta.url), 'utf8')
  return parseSingbox(text).doc!
}

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

describe('подстановка панели в группы', () => {
  it('в selector попадают прокси и urltest, в urltest — только прокси', () => {
    const d = doc(`{"outbounds":[
      {"type":"vless","tag":"srv"},
      {"type":"urltest","tag":"auto","outbounds":[]},
      {"type":"selector","tag":"sel","outbounds":[]},
      {"type":"direct","tag":"direct"}
    ]}`)
    const groups = groupsOf(d)
    const auto = groups.find((g) => g.tag === 'auto')!
    const sel = groups.find((g) => g.tag === 'sel')!
    expect(panelFilledTags(d, auto)).toEqual(['srv'])
    expect(panelFilledTags(d, sel)).toEqual(['srv', 'auto'])
    // direct — не прокси-протокол: панель его в списки не кладёт
    expect(panelFilledTags(d, sel)).not.toContain('direct')
  })

  it('includeProxies: false выключает подстановку для группы', () => {
    const d = doc(`{"outbounds":[
      {"type":"vless","tag":"srv"},
      {"type":"selector","tag":"fixed","outbounds":["srv"],"remnawave":{"includeProxies":false}}
    ]}`)
    const fixed = groupsOf(d)[0]!
    expect(panelFillsGroup(fixed)).toBe(false)
    expect(panelFilledTags(d, fixed)).toEqual([])
  })

  it('документ считается получающим серверы, пока хоть одна группа их ждёт', () => {
    const open = doc(`{"outbounds":[{"type":"selector","tag":"g","outbounds":null}]}`)
    const closed = doc(
      `{"outbounds":[{"type":"selector","tag":"g","outbounds":["direct"],"remnawave":{"includeProxies":false}}]}`,
    )
    expect(documentGetsPanelServers(open)).toBe(true)
    expect(documentGetsPanelServers(closed)).toBe(false)
  })
})

describe('дефолтный маршрут', () => {
  it('final задан — он и есть дефолт', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"d"},{"type":"selector","tag":"g"}],"route":{"final":"g"}}`)
    expect(defaultRoute(d)).toEqual({ tag: 'g', fromFinal: true })
  })

  it('final пуст — ядро берёт ПЕРВЫЙ выход', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"d"},{"type":"selector","tag":"g"}]}`)
    expect(defaultRoute(d)).toEqual({ tag: 'd', fromFinal: false })
  })

  it('выходов нет — дефолта нет', () => {
    expect(defaultRoute(doc('{}'))).toEqual({ tag: undefined, fromFinal: false })
  })

  it('на настоящих шаблонах дефолт разный, и разница только в порядке', () => {
    // Тот самый случай, ради которого дефолт вообще называется вслух:
    // в bundle несовпавший трафик идёт напрямую, в панельном — в прокси
    expect(defaultRoute(fixtureDoc('bundle'))).toEqual({ tag: 'direct', fromFinal: false })
    expect(defaultRoute(fixtureDoc('default'))).toEqual({ tag: '→ Remnawave', fromFinal: false })
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-outbounds.test.ts`
Expected: FAIL — модуля `outbounds` не существует.

- [ ] **Step 3: Реализовать**

Создать `frontend/src/entities/singbox/outbounds.ts`:

```ts
// Выходы документа и то, что с ними сделает панель.
//
// Всё знание о генераторе панели собрано ЗДЕСЬ, а не размазано по графу и
// формам: генератор — чужой код, он изменится, и тогда правка должна быть в
// одном файле. Источник: remnawave/backend,
// src/modules/subscription-template/generators/singbox.generator.service.ts.

import type { SingboxDoc, SingboxOutbound } from './types'

/** Типы, которые панель считает прокси при заполнении групп */
export const PROXY_OUTBOUND_TYPES: ReadonlySet<string> = new Set([
  'vless',
  'trojan',
  'shadowsocks',
  'hysteria2',
])

export const GROUP_OUTBOUND_TYPES: ReadonlySet<string> = new Set(['selector', 'urltest'])

export function outboundsOf(doc: SingboxDoc): SingboxOutbound[] {
  return Array.isArray(doc.outbounds) ? doc.outbounds : []
}

export function groupsOf(doc: SingboxDoc): SingboxOutbound[] {
  return outboundsOf(doc).filter((o) => GROUP_OUTBOUND_TYPES.has(o.type))
}

/**
 * Заполнит ли панель список этой группы. Единственный способ отказаться —
 * `remnawave.includeProxies: false`; никакого маркера в тексте у sing-box нет,
 * решает ТИП выхода.
 */
export function panelFillsGroup(group: SingboxOutbound): boolean {
  if (!GROUP_OUTBOUND_TYPES.has(group.type)) return false
  return group.remnawave?.includeProxies !== false
}

/**
 * Теги ИЗ ДОКУМЕНТА, которые панель положит в группу. Серверов подписки здесь
 * нет и быть не может: их имена — примечания хостов, редактору неизвестные.
 */
export function panelFilledTags(doc: SingboxDoc, group: SingboxOutbound): string[] {
  if (!panelFillsGroup(group)) return []
  const all = outboundsOf(doc)
  const proxies = all
    .filter((o) => PROXY_OUTBOUND_TYPES.has(o.type))
    .map((o) => o.tag)
    .filter((tag): tag is string => typeof tag === 'string')
  if (group.type === 'urltest') return proxies
  const urltests = all
    .filter((o) => o.type === 'urltest')
    .map((o) => o.tag)
    .filter((tag): tag is string => typeof tag === 'string')
  return [...proxies, ...urltests]
}

/** Получит ли документ серверы от панели хоть куда-нибудь */
export function documentGetsPanelServers(doc: SingboxDoc): boolean {
  return groupsOf(doc).some(panelFillsGroup)
}

/**
 * Куда уйдёт трафик, не совпавший ни с одним правилом. `route.final` — тег
 * выхода; при пустом `final` ядро берёт ПЕРВЫЙ элемент `outbounds`
 * (документация sing-box, раздел route). Панель дописывает серверы в конец,
 * поэтому дефолт всегда задаёт шаблон — но задаёт его позицией элемента, а не
 * явным полем, и увидеть это глазами нельзя.
 */
export function defaultRoute(doc: SingboxDoc): { tag?: string; fromFinal: boolean } {
  const final = doc.route?.final
  if (typeof final === 'string' && final !== '') return { tag: final, fromFinal: true }
  const first = outboundsOf(doc)[0]
  return { tag: typeof first?.tag === 'string' ? first.tag : undefined, fromFinal: false }
}
```

Дописать в `frontend/src/entities/singbox/index.ts`: `export * from './outbounds'`.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/singbox-outbounds.test.ts` и `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 5: Мутационная проверка**

1. В `panelFilledTags` для `urltest` вернуть `[...proxies, ...urltests]` — краснеет первый тест.
2. `group.remnawave?.includeProxies !== false` → `!== true` — краснеют тесты про `includeProxies` и про «получает серверы».
3. В `defaultRoute` вместо `outboundsOf(doc)[0]` взять `.at(-1)` — краснеют тесты про пустой `final` и про настоящие шаблоны.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/singbox frontend/test/singbox-outbounds.test.ts
git commit -m "feat(frontend): model how the panel fills sing-box outbound groups"
```

---

### Task 8: Правила маршрута

**Files:**
- Create: `frontend/src/entities/singbox/rules.ts`
- Modify: `frontend/src/entities/singbox/index.ts`
- Test: `frontend/test/singbox-rules.test.ts`

**Interfaces:**
- Consumes: `SingboxDoc`, `SingboxRule` (задача 6).
- Produces:
  - `CHECKABLE_CONDITIONS: ReadonlySet<string>`;
  - `NON_TERMINAL_ACTIONS: ReadonlySet<string>` — `route-options`, `sniff`, `resolve`;
  - `rulesOf(doc: SingboxDoc): SingboxRule[]`;
  - `ruleSetTagsOf(doc: SingboxDoc): string[]`;
  - `ruleAction(rule: SingboxRule): string`;
  - `ruleTarget(rule: SingboxRule): string | undefined`;
  - `isLogicalRule(rule: SingboxRule): boolean`;
  - `conditionKeysOf(rule: SingboxRule): string[]`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  conditionKeysOf,
  isLogicalRule,
  ruleAction,
  ruleSetTagsOf,
  ruleTarget,
  rulesOf,
} from '../src/entities/singbox/rules'
import { parseSingbox } from '../src/entities/singbox/parse'

describe('правила маршрута', () => {
  it('правило без action считается маршрутным — так его трактует ядро', () => {
    expect(ruleAction({ domain: 'a.com', outbound: 'g' })).toBe('route')
    expect(ruleTarget({ domain: 'a.com', outbound: 'g' })).toBe('g')
  })

  it('action: route берёт цель из того же поля outbound', () => {
    expect(ruleAction({ action: 'route', outbound: 'g' })).toBe('route')
    expect(ruleTarget({ action: 'route', outbound: 'g' })).toBe('g')
  })

  it('у нетерминальных действий цели нет', () => {
    expect(ruleTarget({ action: 'sniff' })).toBeUndefined()
    expect(ruleTarget({ action: 'resolve', server: 'dns-local' })).toBeUndefined()
  })

  it('служебные поля не считаются условиями', () => {
    const keys = conditionKeysOf({
      action: 'route',
      outbound: 'g',
      invert: true,
      domain_suffix: ['a.com'],
      port: 443,
    })
    expect(keys.sort()).toEqual(['domain_suffix', 'port'])
  })

  it('логическое правило опознаётся по type', () => {
    expect(isLogicalRule({ type: 'logical', mode: 'and', rules: [] })).toBe(true)
    expect(isLogicalRule({ domain: 'a.com' })).toBe(false)
  })

  it('незнакомое поле остаётся условием: молча пропустить его нельзя', () => {
    // Всё, что ниже такого правила, выполняется ровно при условии, что оно не
    // совпало, — а этого мы не знаем
    expect(conditionKeysOf({ brand_new_condition: 1, outbound: 'g' })).toEqual([
      'brand_new_condition',
    ])
  })

  it('теги наборов правил собираются из route.rule_set', () => {
    const doc = parseSingbox(
      '{"route":{"rule_set":[{"tag":"ru","type":"remote"},{"tag":"ads"}],"rules":[]}}',
    ).doc!
    expect(ruleSetTagsOf(doc)).toEqual(['ru', 'ads'])
    expect(rulesOf(doc)).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-rules.test.ts`
Expected: FAIL — модуля `rules` не существует.

- [ ] **Step 3: Реализовать**

Создать `frontend/src/entities/singbox/rules.ts`:

```ts
// Правила маршрута: из чего они состоят и что редактор о них знает.
//
// Деление условий на проверяемые и непроверяемые — не вкусовщина, а граница
// знания редактора. Всё, что зависит от клиента (режим Clash), от системы
// (процесс, интерфейс, Wi-Fi), от источника соединения или от результата
// сниффинга, документ не содержит и содержать не может.

import type { SingboxDoc, SingboxRule } from './types'

/** Условия, ответ на которые даёт сама цель трассировки */
export const CHECKABLE_CONDITIONS: ReadonlySet<string> = new Set([
  'domain',
  'domain_suffix',
  'domain_keyword',
  'domain_regex',
  'ip_cidr',
  'ip_is_private',
  'port',
  'port_range',
])

// Списка «непроверяемых условий» здесь намеренно НЕТ. Проверяемые перечислены
// выше, а всё остальное непроверяемо по определению — включая поле, которое
// ядро добавит завтра. Закрытый список опасен ровно наоборот: незнакомое поле
// не попало бы в него и молча сошло бы за проверенное.
//
// Действия, завершающие подбор (`route`, `bypass`, `reject`, `hijack-dns`),
// тоже не перечисляются: терминально всё, что не входит в список ниже.

/** Действия, после которых подбор продолжается со следующего правила */
export const NON_TERMINAL_ACTIONS: ReadonlySet<string> = new Set([
  'route-options',
  'sniff',
  'resolve',
])

/**
 * Поля правила, которые условиями НЕ являются. Список закрытый: всё
 * незнакомое считается условием, и трассировка на нём остановится. Обратный
 * выбор («незнакомое — служебное») дал бы уверенный неверный ответ.
 */
const SERVICE_KEYS: ReadonlySet<string> = new Set([
  'action',
  'outbound',
  'type',
  'mode',
  'rules',
  'invert',
  'server',
  'strategy',
  'disable_cache',
  'rewrite_ttl',
  'client_subnet',
  'override_address',
  'override_port',
  'udp_disable_domain_unmapping',
  'udp_connect',
  'udp_timeout',
  'timeout',
  'sniffer',
  'method',
  'no_drop',
])

export function rulesOf(doc: SingboxDoc): SingboxRule[] {
  return Array.isArray(doc.route?.rules) ? doc.route.rules : []
}

export function ruleSetTagsOf(doc: SingboxDoc): string[] {
  const sets = Array.isArray(doc.route?.rule_set) ? doc.route.rule_set : []
  return sets.map((s) => s.tag).filter((tag): tag is string => typeof tag === 'string')
}

/** Правило без `action` ядро считает маршрутным — старая форма записи всё ещё жива */
export function ruleAction(rule: SingboxRule): string {
  return typeof rule.action === 'string' ? rule.action : 'route'
}

export function ruleTarget(rule: SingboxRule): string | undefined {
  if (ruleAction(rule) !== 'route') return undefined
  return typeof rule.outbound === 'string' ? rule.outbound : undefined
}

export function isLogicalRule(rule: SingboxRule): boolean {
  return rule.type === 'logical'
}

export function conditionKeysOf(rule: SingboxRule): string[] {
  return Object.keys(rule).filter((key) => !SERVICE_KEYS.has(key))
}
```

Дописать в `index.ts`: `export * from './rules'`.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/singbox-rules.test.ts` и `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 5: Мутационная проверка**

1. `ruleAction` → всегда `String(rule.action)` без умолчания — краснеет тест про правило без `action`.
2. В `SERVICE_KEYS` добавить `'brand_new_condition'` — краснеет тест про незнакомое поле. Вернуть.
3. `ruleTarget` без проверки действия (`return rule.outbound`) — краснеет тест про нетерминальные действия. Проверить, что мутация именно такая: `{ action: 'resolve', server: 'dns-local' }` не имеет `outbound`, поэтому для красноты нужен случай `{ action: 'sniff', outbound: 'g' }` — добавить его в тест ДО мутации, если его там нет.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/singbox frontend/test/singbox-rules.test.ts
git commit -m "feat(frontend): sing-box route rules — conditions, actions, targets"
```

---

### Task 9: Словарь ключей

**Files:**
- Create: `frontend/src/entities/singbox/docSchema.ts`
- Modify: `frontend/src/entities/singbox/index.ts`
- Test: `frontend/test/singbox-doc-schema.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: типы `SingboxEnum`, `SingboxField`, `SingboxSectionName`; `SINGBOX_SECTIONS: Record<SingboxSectionName, SingboxField[]>`; `fieldFor(section: SingboxSectionName, key: string): SingboxField | undefined`.

Секции: `root`, `inbound`, `outbound`, `group`, `route`, `route-rule`, `rule-set`, `dns`, `dns-server`, `experimental`.

Источники описаний: официальная документация ядра (sing-box.sagernet.org, разделы `configuration/*`) и три фикстуры. Описание пишется только для ключа, который реально встречается в шаблонах или выводится в форму; выдуманное описание хуже молчания — это уже правило проекта.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-doc-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SINGBOX_SECTIONS, fieldFor } from '../src/entities/singbox/docSchema'
import { parseSingbox } from '../src/entities/singbox/parse'

describe('словарь sing-box', () => {
  it('в секции нет двух описаний одного ключа', () => {
    for (const [section, fields] of Object.entries(SINGBOX_SECTIONS)) {
      const keys = fields.map((f) => f.key)
      expect(new Set(keys).size, `дубли в секции ${section}`).toBe(keys.length)
    }
  })

  it('у каждого поля непустое русское описание', () => {
    for (const fields of Object.values(SINGBOX_SECTIONS)) {
      for (const field of fields) {
        expect(field.doc.trim().length, `пустое описание у ${field.key}`).toBeGreaterThan(0)
        expect(field.doc).toMatch(/[а-яА-ЯёЁ]/)
      }
    }
  })

  it('ключ панели помечен как панельный и живёт в секции группы', () => {
    const field = fieldFor('group', 'remnawave.includeProxies')
    expect(field).toBeDefined()
    expect(field!.panelKey).toBe(true)
  })

  it('ключи настоящих шаблонов описаны на верхнем уровне', () => {
    const text = readFileSync(new URL('./fixtures/singbox/bundle.json', import.meta.url), 'utf8')
    const doc = parseSingbox(text).doc!
    const missing = Object.keys(doc).filter((key) => fieldFor('root', key) === undefined)
    expect(missing, `не описаны корневые ключи: ${missing.join(', ')}`).toEqual([])
  })

  it('значения enum не пустые', () => {
    for (const fields of Object.values(SINGBOX_SECTIONS)) {
      for (const field of fields) {
        for (const value of field.enum ?? []) {
          expect(value.value.length).toBeGreaterThan(0)
        }
      }
    }
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-doc-schema.test.ts`
Expected: FAIL — модуля `docSchema` не существует.

- [ ] **Step 3: Реализовать словарь**

Создать `frontend/src/entities/singbox/docSchema.ts`. Каркас файла и обязательный минимум содержимого:

```ts
// Декларативное описание документа sing-box: какие ключи бывают в каждой
// секции, какого они вида и что значат по-русски. Один словарь питает и формы
// инспектора, и подсказки JSON-вкладки.
//
// Целевая версия ядра — 1.13.x. Словарь ОПИСЫВАЕТ, а не ограничивает:
// незнакомый ключ проходит в документ и не считается ошибкой (см. parse.ts).
// Молчание там, где сказать нечего, — осознанный выбор: выдуманное описание
// читается как знание.
//
// Источники: sing-box.sagernet.org (разделы configuration/*), генератор панели
// (remnawave/backend, singbox.generator.service.ts) — для ключа remnawave,
// и три фикстуры в frontend/test/fixtures/singbox/.

export interface SingboxEnum {
  value: string
  doc?: string
}

export interface SingboxField {
  /** Ключ или путь через точку внутри секции */
  key: string
  /** Русское описание: подпись в форме и tooltip подсказки */
  doc: string
  type: 'string' | 'number' | 'boolean' | 'strings' | 'object' | 'array'
  /** Известные значения — подсказка, а не ограничение */
  enum?: SingboxEnum[]
  /** Ключ панели, а не ядра: в отданном клиенту конфиге его не будет */
  panelKey?: boolean
}

export type SingboxSectionName =
  | 'root'
  | 'inbound'
  | 'outbound'
  | 'group'
  | 'route'
  | 'route-rule'
  | 'rule-set'
  | 'dns'
  | 'dns-server'
  | 'experimental'

export const SINGBOX_SECTIONS: Record<SingboxSectionName, SingboxField[]> = {
  root: [
    { key: 'log', doc: 'Журнал ядра: уровень и вывод.', type: 'object' },
    { key: 'dns', doc: 'Разрешение имён: свои серверы и свои правила, отдельные от маршрута.', type: 'object' },
    { key: 'inbounds', doc: 'Входы клиента: чем ядро принимает трафик системы.', type: 'array' },
    { key: 'outbounds', doc: 'Выходы: серверы, группы выбора и прямой выход. Серверы подписки панель дописывает в КОНЕЦ этого списка.', type: 'array' },
    { key: 'endpoints', doc: 'Конечные точки WireGuard и Tailscale (ядро 1.11 и новее).', type: 'array' },
    { key: 'route', doc: 'Маршрутизация: правила, наборы правил и выход по умолчанию.', type: 'object' },
    { key: 'experimental', doc: 'Экспериментальные разделы: Clash API и файл кэша.', type: 'object' },
    { key: 'http_clients', doc: 'Именованные HTTP-клиенты: через них ядро скачивает наборы правил.', type: 'array' },
    { key: 'ntp', doc: 'Синхронизация времени: нужна там, где системные часы врут, а TLS этого не прощает.', type: 'object' },
    { key: 'certificate', doc: 'Хранилище доверенных сертификатов.', type: 'object' },
    { key: 'services', doc: 'Встроенные службы ядра (например, DERP).', type: 'array' },
  ],
  outbound: [
    { key: 'type', doc: 'Тип выхода: протокол сервера, группа выбора или прямой выход.', type: 'string', enum: [
      { value: 'direct', doc: 'Прямое соединение, минуя прокси.' },
      { value: 'selector', doc: 'Группа с ручным выбором. Панель заменит её список тегами серверов подписки.' },
      { value: 'urltest', doc: 'Группа с автовыбором по задержке. Панель заменит её список тегами серверов подписки.' },
      { value: 'vless', doc: 'Сервер VLESS.' },
      { value: 'trojan', doc: 'Сервер Trojan.' },
      { value: 'shadowsocks', doc: 'Сервер Shadowsocks.' },
      { value: 'hysteria2', doc: 'Сервер Hysteria2.' },
      { value: 'vmess', doc: 'Сервер VMess. Панель такие серверы в группы не добавляет.' },
      { value: 'socks', doc: 'Прокси SOCKS. Панель такие серверы в группы не добавляет.' },
      { value: 'http', doc: 'Прокси HTTP. Панель такие серверы в группы не добавляет.' },
      { value: 'block', doc: 'Устаревший выход-заглушка: ядро 1.13 его не знает, вместо него action: reject.' },
      { value: 'dns', doc: 'Устаревший выход для DNS: ядро 1.13 его не знает, вместо него action: hijack-dns.' },
    ] },
    { key: 'tag', doc: 'Имя выхода. По нему на выход ссылаются правила и группы.', type: 'string' },
    { key: 'server', doc: 'Адрес сервера.', type: 'string' },
    { key: 'server_port', doc: 'Порт сервера.', type: 'number' },
    { key: 'detour', doc: 'Через какой выход устанавливать это соединение — цепочка прокси.', type: 'string' },
  ],
  group: [
    { key: 'outbounds', doc: 'Список выходов группы. Панель заменит его целиком: у urltest — тегами серверов, у selector — серверами и группами urltest. Чтобы список остался вашим, поставьте remnawave.includeProxies = false.', type: 'strings' },
    { key: 'default', doc: 'Выход, выбранный в группе изначально.', type: 'string' },
    { key: 'url', doc: 'Адрес для замера задержки в группе urltest.', type: 'string' },
    { key: 'interval', doc: 'Период повторного замера задержки, например 3m.', type: 'string' },
    { key: 'tolerance', doc: 'На сколько миллисекунд новый выход должен быть быстрее, чтобы группа переключилась.', type: 'number' },
    { key: 'interrupt_exist_connections', doc: 'Разрывать ли текущие соединения при смене выбранного выхода.', type: 'boolean' },
    { key: 'remnawave.includeProxies', doc: 'Ключ панели: false — не заполнять список этой группы серверами подписки. В конфиге, который получит клиент, ключа не будет.', type: 'boolean', panelKey: true },
  ],
  'route-rule': [
    { key: 'action', doc: 'Что сделать с соединением. Без этого поля правило считается маршрутным.', type: 'string', enum: [
      { value: 'route', doc: 'Отправить в выход из поля outbound.' },
      { value: 'reject', doc: 'Отклонить соединение.' },
      { value: 'hijack-dns', doc: 'Перехватить DNS-запрос во внутренний резолвер.' },
      { value: 'sniff', doc: 'Определить протокол соединения. Подбор правил продолжается.' },
      { value: 'resolve', doc: 'Разрешить домен в адреса. Подбор правил продолжается.' },
      { value: 'route-options', doc: 'Изменить параметры маршрута. Подбор правил продолжается.' },
    ] },
    { key: 'outbound', doc: 'Тег выхода, в который уйдёт совпавшее соединение.', type: 'string' },
    { key: 'domain', doc: 'Полное совпадение домена.', type: 'strings' },
    { key: 'domain_suffix', doc: 'Суффикс домена. Без ведущей точки совпадает и сам домен, и его поддомены; с ведущей точкой — только поддомены.', type: 'strings' },
    { key: 'domain_keyword', doc: 'Подстрока в домене.', type: 'strings' },
    { key: 'domain_regex', doc: 'Регулярное выражение по домену.', type: 'strings' },
    { key: 'ip_cidr', doc: 'Подсеть адреса назначения.', type: 'strings' },
    { key: 'ip_is_private', doc: 'Адрес назначения принадлежит частному диапазону.', type: 'boolean' },
    { key: 'port', doc: 'Порт назначения.', type: 'strings' },
    { key: 'port_range', doc: 'Диапазон портов назначения, например 1000:2000.', type: 'strings' },
    { key: 'protocol', doc: 'Протокол, определённый сниффингом. Редактор его предсказать не может.', type: 'strings' },
    { key: 'network', doc: 'Транспорт: tcp или udp.', type: 'strings', enum: [{ value: 'tcp' }, { value: 'udp' }] },
    { key: 'clash_mode', doc: 'Режим, выбранный в клиенте через Clash API. Документом не задаётся.', type: 'string' },
    { key: 'rule_set', doc: 'Теги наборов правил. Содержимое набора лежит по ссылке, редактор его не скачивает.', type: 'strings' },
    { key: 'inbound', doc: 'Теги входов, с которых пришло соединение.', type: 'strings' },
    { key: 'invert', doc: 'Обратить результат проверки условий.', type: 'boolean' },
    { key: 'type', doc: 'logical — правило объединяет вложенные правила по «и» либо «или».', type: 'string', enum: [{ value: 'logical' }] },
    { key: 'mode', doc: 'Для логического правила: and — все вложенные, or — хотя бы одно.', type: 'string', enum: [{ value: 'and' }, { value: 'or' }] },
    { key: 'rules', doc: 'Вложенные правила логического правила.', type: 'array' },
  ],
  route: [
    { key: 'rules', doc: 'Правила маршрутизации по порядку: выигрывает первое совпавшее.', type: 'array' },
    { key: 'rule_set', doc: 'Наборы правил: локальные файлы или удалённые .srs по ссылке.', type: 'array' },
    { key: 'final', doc: 'Выход для трафика, не совпавшего ни с одним правилом. Если поле пусто, ядро возьмёт ПЕРВЫЙ выход из outbounds.', type: 'string' },
    { key: 'auto_detect_interface', doc: 'Определять исходящий интерфейс автоматически.', type: 'boolean' },
    { key: 'default_domain_resolver', doc: 'Каким DNS-сервером разрешать домены при исходящих соединениях.', type: 'object' },
    { key: 'default_http_client', doc: 'Каким HTTP-клиентом скачивать удалённые наборы правил.', type: 'string' },
    { key: 'override_android_vpn', doc: 'Перехватывать ли трафик другого VPN на Android.', type: 'boolean' },
    { key: 'default_mark', doc: 'Метка исходящих соединений в Linux.', type: 'number' },
  ],
  'rule-set': [
    { key: 'tag', doc: 'Имя набора: по нему на набор ссылаются правила.', type: 'string' },
    { key: 'type', doc: 'Откуда берётся набор.', type: 'string', enum: [
      { value: 'remote', doc: 'Скачивается по ссылке.' },
      { value: 'local', doc: 'Читается из файла на устройстве.' },
      { value: 'inline', doc: 'Записан прямо в конфиге.' },
    ] },
    { key: 'format', doc: 'Формат набора: binary (.srs) или source (.json).', type: 'string', enum: [{ value: 'binary' }, { value: 'source' }] },
    { key: 'url', doc: 'Ссылка на удалённый набор.', type: 'string' },
    { key: 'path', doc: 'Путь к локальному файлу набора.', type: 'string' },
    { key: 'download_detour', doc: 'Через какой выход скачивать набор.', type: 'string' },
    { key: 'update_interval', doc: 'Как часто обновлять набор, например 1d.', type: 'string' },
  ],
  inbound: [
    { key: 'type', doc: 'Тип входа.', type: 'string', enum: [
      { value: 'tun', doc: 'Виртуальный сетевой интерфейс: забирает весь трафик системы.' },
      { value: 'mixed', doc: 'Локальный прокси HTTP и SOCKS на одном порту.' },
      { value: 'socks', doc: 'Локальный прокси SOCKS.' },
      { value: 'http', doc: 'Локальный прокси HTTP.' },
    ] },
    { key: 'tag', doc: 'Имя входа: на него ссылается условие inbound в правилах.', type: 'string' },
    { key: 'listen', doc: 'Адрес, который слушает вход.', type: 'string' },
    { key: 'listen_port', doc: 'Порт, который слушает вход.', type: 'number' },
    { key: 'address', doc: 'Адреса виртуального интерфейса tun.', type: 'strings' },
    { key: 'auto_route', doc: 'Прописывать системные маршруты в интерфейс tun.', type: 'boolean' },
    { key: 'strict_route', doc: 'Строгая маршрутизация: закрывает пути в обход туннеля.', type: 'boolean' },
    { key: 'stack', doc: 'Сетевой стек интерфейса tun.', type: 'string', enum: [{ value: 'system' }, { value: 'gvisor' }, { value: 'mixed' }] },
    { key: 'mtu', doc: 'Размер MTU интерфейса tun.', type: 'number' },
    { key: 'set_system_proxy', doc: 'Прописывать этот вход системным прокси.', type: 'boolean' },
    { key: 'interface_name', doc: 'Имя создаваемого интерфейса tun.', type: 'string' },
  ],
  dns: [
    { key: 'servers', doc: 'DNS-серверы: у каждого свой тег, тип и адрес.', type: 'array' },
    { key: 'rules', doc: 'Правила DNS: какой запрос каким сервером разрешать. Считаются отдельно от правил маршрута.', type: 'array' },
    { key: 'final', doc: 'Сервер для запросов, не совпавших ни с одним правилом DNS.', type: 'string' },
    { key: 'strategy', doc: 'Какие адреса запрашивать по умолчанию.', type: 'string', enum: [
      { value: 'prefer_ipv4' }, { value: 'prefer_ipv6' }, { value: 'ipv4_only' }, { value: 'ipv6_only' },
    ] },
    { key: 'independent_cache', doc: 'Держать отдельный кэш для каждого сервера.', type: 'boolean' },
    { key: 'reverse_mapping', doc: 'Запоминать соответствие адреса и домена для обратного поиска.', type: 'boolean' },
  ],
  'dns-server': [
    { key: 'tag', doc: 'Имя сервера: по нему на него ссылаются правила DNS.', type: 'string' },
    { key: 'type', doc: 'Транспорт запроса.', type: 'string', enum: [
      { value: 'local', doc: 'Системный резолвер устройства.' },
      { value: 'udp' }, { value: 'tcp' }, { value: 'tls' }, { value: 'https' }, { value: 'quic' }, { value: 'h3' },
      { value: 'fakeip', doc: 'Выдаёт подставные адреса из заданного диапазона.' },
    ] },
    { key: 'server', doc: 'Адрес DNS-сервера.', type: 'string' },
    { key: 'detour', doc: 'Через какой выход отправлять запросы этого сервера.', type: 'string' },
    { key: 'inet4_range', doc: 'Диапазон подставных адресов IPv4 для fakeip.', type: 'string' },
    { key: 'inet6_range', doc: 'Диапазон подставных адресов IPv6 для fakeip.', type: 'string' },
  ],
  experimental: [
    { key: 'clash_api', doc: 'Внешний интерфейс управления: порт, панель и режим по умолчанию.', type: 'object' },
    { key: 'cache_file', doc: 'Файл кэша: адреса fakeip и выбранные в группах выходы переживают перезапуск.', type: 'object' },
  ],
}

export function fieldFor(section: SingboxSectionName, key: string): SingboxField | undefined {
  return SINGBOX_SECTIONS[section].find((field) => field.key === key)
}
```

Если тест «ключи настоящих шаблонов описаны» падает на ключе, которого в наборе выше нет, — добавить его с честным описанием по документации ядра, а не подгонять тест.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/singbox-doc-schema.test.ts` и `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 5: Мутационная проверка**

1. Продублировать запись `tag` в секции `outbound` — краснеет тест про дубли. Убрать.
2. Заменить `doc` у любого поля на английский текст — краснеет тест про русское описание. Вернуть.
3. Убрать `panelKey: true` у `remnawave.includeProxies` — краснеет тест про ключ панели. Вернуть.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/singbox frontend/test/singbox-doc-schema.test.ts
git commit -m "feat(frontend): russian dictionary of sing-box document keys"
```

---

### Task 10: Диагностики

**Files:**
- Create: `frontend/src/entities/singbox/validate.ts`
- Modify: `frontend/src/entities/singbox/index.ts`
- Test: `frontend/test/singbox-validate.test.ts`

**Interfaces:**
- Consumes: задачи 6-8 (`SingboxDoc`, `outbounds.ts`, `rules.ts`).
- Produces: `validateSingbox(doc: SingboxDoc): ValidationIssue[]`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-validate.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { validateSingbox } from '../src/entities/singbox/validate'
import type { SingboxDoc } from '../src/entities/singbox/types'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

function fixtureDoc(name: 'default' | 'bundle' | 'legacy'): SingboxDoc {
  return parseSingbox(
    readFileSync(new URL(`./fixtures/singbox/${name}.json`, import.meta.url), 'utf8'),
  ).doc!
}

describe('диагностики sing-box', () => {
  it('настоящие шаблоны панели не дают ни одной ошибки', () => {
    for (const name of ['default', 'bundle'] as const) {
      const errors = validateSingbox(fixtureDoc(name)).filter((i) => i.level === 'error')
      expect(errors, `${name}: ${errors.map((e) => e.message).join('; ')}`).toEqual([])
    }
  })

  it('дублирующийся тег выхода — ошибка', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"direct","tag":"d"},{"type":"direct","tag":"d"}]}'),
    )
    expect(issues.some((i) => i.level === 'error' && /d/.test(i.message))).toBe(true)
  })

  it('кольцо ссылок между группами — ошибка', () => {
    const issues = validateSingbox(
      doc(`{"outbounds":[
        {"type":"selector","tag":"a","outbounds":["b"],"remnawave":{"includeProxies":false}},
        {"type":"selector","tag":"b","outbounds":["a"],"remnawave":{"includeProxies":false}}
      ]}`),
    )
    expect(issues.some((i) => i.level === 'error' && /кольц/i.test(i.message))).toBe(true)
  })

  it('пустая группа с includeProxies: false — ошибка: заполнить её некому', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"selector","tag":"g","outbounds":[],"remnawave":{"includeProxies":false}}]}'),
    )
    expect(issues.some((i) => i.level === 'error' && /g/.test(i.message))).toBe(true)
  })

  it('пустая группа БЕЗ этого ключа ошибкой не считается — её заполнит панель', () => {
    const issues = validateSingbox(doc('{"outbounds":[{"type":"selector","tag":"g","outbounds":null}]}'))
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('ссылка на несуществующий набор правил — ошибка', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"rule_set":["nope"],"outbound":"d"}],"rule_set":[{"tag":"ru"}]}}'),
    )
    expect(issues.some((i) => i.level === 'error' && /nope/.test(i.message))).toBe(true)
  })

  it('неизвестный тег — предупреждение, пока панель подставляет серверы', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"selector","tag":"g","outbounds":null}],"route":{"rules":[{"domain":"a.com","outbound":"кто-то"}]}}'),
    )
    const hit = issues.find((i) => /кто-то/.test(i.message))!
    expect(hit.level).toBe('warning')
  })

  it('тот же тег — ошибка, когда серверов от панели документ не получает', () => {
    const issues = validateSingbox(
      doc(`{"outbounds":[{"type":"selector","tag":"g","outbounds":["d"],"remnawave":{"includeProxies":false}},{"type":"direct","tag":"d"}],
            "route":{"rules":[{"domain":"a.com","outbound":"кто-то"}]}}`),
    )
    const hit = issues.find((i) => /кто-то/.test(i.message))!
    expect(hit.level).toBe('error')
  })

  it('выход, который панель в группы не положит, — предупреждение', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"vmess","tag":"old"},{"type":"selector","tag":"g","outbounds":null}]}'),
    )
    expect(issues.some((i) => i.level === 'warning' && /old/.test(i.message))).toBe(true)
  })

  it('устаревшие block и dns — предупреждение с названной причиной', () => {
    const issues = validateSingbox(fixtureDoc('legacy'))
    const legacy = issues.filter((i) => i.level === 'warning' && /1\.13|устарел/i.test(i.message))
    expect(legacy.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-validate.test.ts`
Expected: FAIL — модуля `validate` не существует.

- [ ] **Step 3: Реализовать**

Создать `frontend/src/entities/singbox/validate.ts`:

```ts
// Диагностики документа. Главное правило то же, что у Mihomo: имена серверов,
// которые подставит панель, редактору неизвестны, поэтому «ссылка на неизвестный
// тег» — предупреждение. Ошибкой она становится ровно тогда, когда серверов от
// панели документ не получает вовсе: тогда неизвестному имени взяться неоткуда.

import type { PathParts, ValidationIssue } from '../xray/config'
import {
  GROUP_OUTBOUND_TYPES,
  PROXY_OUTBOUND_TYPES,
  documentGetsPanelServers,
  groupsOf,
  outboundsOf,
  panelFillsGroup,
} from './outbounds'
import { ruleSetTagsOf, ruleTarget, rulesOf } from './rules'
import type { SingboxDoc, SingboxOutbound } from './types'

function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: parts.join('.'), message, level }
}

/** Типы выходов, которые панель не кладёт в списки групп, но и претензий к ним нет */
const NEUTRAL_TYPES = new Set(['direct', ...GROUP_OUTBOUND_TYPES])

/** Устаревшие выходы: ядро 1.13 их не знает */
const LEGACY_TYPES: Record<string, string> = {
  block: 'вместо него action: reject в правиле',
  dns: 'вместо него action: hijack-dns в правиле',
}

function tagsOf(doc: SingboxDoc): Set<string> {
  const tags = new Set<string>()
  for (const outbound of outboundsOf(doc)) {
    if (typeof outbound.tag === 'string') tags.add(outbound.tag)
  }
  for (const endpoint of Array.isArray(doc.endpoints) ? doc.endpoints : []) {
    const tag = (endpoint as { tag?: unknown }).tag
    if (typeof tag === 'string') tags.add(tag)
  }
  return tags
}

function listed(group: SingboxOutbound): string[] {
  return Array.isArray(group.outbounds) ? group.outbounds.filter((t) => typeof t === 'string') : []
}

/** Кольцо ссылок между группами: ядро на таком конфиге не поднимется */
function findCycle(doc: SingboxDoc): string[] | null {
  const groups = new Map(
    groupsOf(doc)
      .filter((g): g is SingboxOutbound & { tag: string } => typeof g.tag === 'string')
      .map((g) => [g.tag, g]),
  )
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const walk = (tag: string): string[] | null => {
    if (state.get(tag) === 'done') return null
    if (state.get(tag) === 'visiting') return [...stack.slice(stack.indexOf(tag)), tag]
    const group = groups.get(tag)
    if (group === undefined) return null
    state.set(tag, 'visiting')
    stack.push(tag)
    for (const next of listed(group)) {
      const found = walk(next)
      if (found !== null) return found
    }
    stack.pop()
    state.set(tag, 'done')
    return null
  }

  for (const tag of groups.keys()) {
    const found = walk(tag)
    if (found !== null) return found
  }
  return null
}

export function validateSingbox(doc: SingboxDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const outbounds = outboundsOf(doc)
  const known = tagsOf(doc)
  const panelServes = documentGetsPanelServers(doc)
  const unknownLevel = panelServes ? 'warning' : 'error'
  const unknownHint = panelServes
    ? ' — если это имя подставит панель, всё в порядке'
    : ''

  const seen = new Set<string>()
  outbounds.forEach((outbound, index) => {
    const tag = typeof outbound.tag === 'string' ? outbound.tag : undefined
    if (tag !== undefined) {
      // Дубликат ломает не только ядро: узлы графа адресуются тегом, и один из
      // них молча пропадёт с холста
      if (seen.has(tag)) {
        issues.push(issue(['outbounds', index, 'tag'], `Тег «${tag}» уже занят другим выходом`, 'error'))
      }
      seen.add(tag)
    }

    const legacy = LEGACY_TYPES[outbound.type]
    if (legacy !== undefined) {
      issues.push(
        issue(
          ['outbounds', index, 'type'],
          `Выход типа ${outbound.type} ядро 1.13 не знает: ${legacy}`,
          'warning',
        ),
      )
    } else if (!NEUTRAL_TYPES.has(outbound.type) && !PROXY_OUTBOUND_TYPES.has(outbound.type)) {
      issues.push(
        issue(
          ['outbounds', index, 'type'],
          `Выход «${tag ?? outbound.type}» панель не добавит в списки групп: она подставляет только vless, trojan, shadowsocks и hysteria2. Сослаться на него можно вручную`,
          'warning',
        ),
      )
    }

    if (GROUP_OUTBOUND_TYPES.has(outbound.type) && !panelFillsGroup(outbound) && listed(outbound).length === 0) {
      issues.push(
        issue(
          ['outbounds', index, 'outbounds'],
          `Группа «${tag ?? '?'}» пуста, а includeProxies: false запрещает панели её заполнять`,
          'error',
        ),
      )
    }

    for (const [position, target] of listed(outbound).entries()) {
      if (!known.has(target)) {
        issues.push(
          issue(
            ['outbounds', index, 'outbounds', position],
            `Группа «${tag ?? '?'}» ссылается на неизвестный выход «${target}»${unknownHint}`,
            unknownLevel,
          ),
        )
      }
    }
  })

  const cycle = findCycle(doc)
  if (cycle !== null) {
    issues.push(issue(['outbounds'], `Кольцо ссылок между группами: ${cycle.join(' → ')}`, 'error'))
  }

  const ruleSets = new Set(ruleSetTagsOf(doc))
  rulesOf(doc).forEach((rule, index) => {
    const target = ruleTarget(rule)
    if (target !== undefined && !known.has(target)) {
      issues.push(
        issue(
          ['route', 'rules', index, 'outbound'],
          `Правило ссылается на неизвестный выход «${target}»${unknownHint}`,
          unknownLevel,
        ),
      )
    }
    const sets = Array.isArray(rule.rule_set)
      ? rule.rule_set
      : typeof rule.rule_set === 'string'
        ? [rule.rule_set]
        : []
    for (const set of sets) {
      if (typeof set === 'string' && !ruleSets.has(set)) {
        issues.push(
          issue(
            ['route', 'rules', index, 'rule_set'],
            `Набор правил «${set}» не описан в route.rule_set`,
            'error',
          ),
        )
      }
    }
  })

  const final = doc.route?.final
  if (typeof final === 'string' && final !== '' && !known.has(final)) {
    issues.push(
      issue(['route', 'final'], `Выход по умолчанию «${final}» не описан${unknownHint}`, unknownLevel),
    )
  }

  return issues
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/singbox-validate.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (10 тестов).

- [ ] **Step 5: Мутационная проверка**

1. `unknownLevel` сделать всегда `'warning'` — краснеет тест про ошибку в закрытом документе.
2. `unknownLevel` сделать всегда `'error'` — краснеет тест про предупреждение и тест «настоящие шаблоны без ошибок».
3. В проверке пустой группы убрать `!panelFillsGroup(outbound)` — краснеет тест про пустую группу без ключа.
4. `findCycle` заменить на `() => null` — краснеет тест про кольцо.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/singbox frontend/test/singbox-validate.test.ts
git commit -m "feat(frontend): sing-box diagnostics that tell warnings from errors"
```

---

### Task 11: Трассировка маршрута

**Files:**
- Create: `frontend/src/entities/singbox/trace.ts`
- Modify: `frontend/src/entities/singbox/index.ts`
- Test: `frontend/test/singbox-trace.test.ts`

**Interfaces:**
- Consumes: задачи 6-8.
- Produces:
  - `SingboxTraceResult = { verdicts: SingboxRuleVerdict[]; winner?: { ruleIndex: number | null; target: string }; stopped?: { index: number; reason: string }; caveats: string[] }`;
  - `SingboxRuleVerdict = { index: number; state: 'yes' | 'no' | 'unknown'; reason?: string; target?: string }`;
  - `traceSingbox(doc: SingboxDoc, target: string): SingboxTraceResult`.

**Семантика, проверенная по исходникам ядра** (`SagerNet/sing`, `common/domain/matcher.go`) — реализовать буквально:

- `domain_suffix` **без** ведущей точки совпадает и с самим доменом, и с его поддоменами по границе метки: `example.com` ловит `example.com` и `www.example.com`, но не `myexample.com`;
- `domain_suffix` **с** ведущей точкой (`.example.com`) — только поддомены, зато обычным строковым суффиксом.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { traceSingbox } from '../src/entities/singbox/trace'
import type { SingboxDoc } from '../src/entities/singbox/types'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

const BASE = '{"type":"direct","tag":"direct"},{"type":"selector","tag":"g","outbounds":null}'

describe('трассировка sing-box', () => {
  it('выигрывает ПЕРВОЕ совпавшее правило, а не любое подходящее', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"domain_suffix":["example.com"],"outbound":"direct"},
      {"domain":"www.example.com","outbound":"g"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, 'www.example.com')
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('domain_suffix без точки ловит и сам домен, и поддомен, но не соседа', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"domain_suffix":["example.com"],"outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(d, 'example.com').winner!.target).toBe('direct')
    expect(traceSingbox(d, 'www.example.com').winner!.target).toBe('direct')
    // Граница метки, а не строковый суффикс
    expect(traceSingbox(d, 'myexample.com').winner!.target).toBe('g')
  })

  it('domain_suffix с ведущей точкой сам домен не ловит', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"domain_suffix":[".example.com"],"outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(d, 'www.example.com').winner!.target).toBe('direct')
    expect(traceSingbox(d, 'example.com').winner!.target).toBe('g')
  })

  it('несколько условий в правиле — это «и»', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"domain":"a.com","port":[443],"outbound":"direct"}
    ],"final":"g"}}`)
    // Порт цели не задан, значит условие port проверить нечем
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
  })

  it('нетерминальные действия не выбирают выход и не мешают идти дальше', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"action":"sniff"},
      {"action":"resolve"},
      {"domain":"a.com","outbound":"direct"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, 'a.com')
    expect(res.winner).toEqual({ ruleIndex: 2, target: 'direct' })
  })

  it('reject — это ответ, а не остановка', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"domain":"ads.com","action":"reject"}],"final":"g"}}`)
    const res = traceSingbox(d, 'ads.com')
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'reject' })
    expect(res.stopped).toBeUndefined()
  })

  it('rule_set останавливает разбор и называет причину', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"rule_set":["ru"],"outbound":"g"},
      {"domain":"a.com","outbound":"direct"}
    ],"rule_set":[{"tag":"ru"}],"final":"g"}}`)
    const res = traceSingbox(d, 'a.com')
    expect(res.stopped).toEqual({ index: 0, reason: expect.stringMatching(/набор|rule_set/i) })
    // Правила НИЖЕ остановки в разбор не попадают: они выполняются ровно при
    // условии, что непроверяемое правило не совпало, — а этого мы не знаем
    expect(res.winner).toBeUndefined()
    expect(res.verdicts).toHaveLength(1)
  })

  it('clash_mode останавливает: режим живёт в клиенте', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"clash_mode":"Global","outbound":"g"}],"final":"g"}}`)
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
  })

  it('логическое «или»: точное «да» перевешивает неизвестность', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"type":"logical","mode":"or","rules":[{"clash_mode":"Global"},{"domain":"a.com"}],"outbound":"direct"}
    ],"final":"g"}}`)
    expect(traceSingbox(d, 'a.com').winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('логическое «и»: точное «нет» перевешивает неизвестность', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"type":"logical","mode":"and","rules":[{"clash_mode":"Global"},{"domain":"b.com"}],"outbound":"direct"},
      {"domain":"a.com","outbound":"g"}
    ],"final":"direct"}}`)
    const res = traceSingbox(d, 'a.com')
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'g' })
  })

  it('invert обращает результат', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"domain":"b.com","invert":true,"outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(d, 'a.com').winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('ни одно правило не совпало — победитель дефолтный выход, и сказано откуда он', () => {
    const withFinal = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"domain":"b.com","outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(withFinal, 'a.com').winner).toEqual({ ruleIndex: null, target: 'g' })

    const noFinal = doc(`{"outbounds":[${BASE}],"route":{"rules":[]}}`)
    const res = traceSingbox(noFinal, 'a.com')
    expect(res.winner).toEqual({ ruleIndex: null, target: 'direct' })
    expect(res.caveats.join(' ')).toMatch(/final/i)
  })

  it('битый domain_regex не роняет разбор, а останавливает его', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"domain_regex":["("],"outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
  })

  it('IP-цель проверяется по ip_cidr, домен по такому правилу неизвестен', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"ip_cidr":["10.0.0.0/8"],"outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(d, '10.1.2.3').winner!.target).toBe('direct')
    expect(traceSingbox(d, '8.8.8.8').winner!.target).toBe('g')
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-trace.test.ts`
Expected: FAIL — модуля `trace` не существует.

- [ ] **Step 3: Реализовать**

Создать `frontend/src/entities/singbox/trace.ts`:

```ts
// Трассировка маршрута: куда уйдёт запрос к заданной цели.
//
// Правило то же, что у Mihomo: разбор ОСТАНАВЛИВАЕТСЯ на правиле, условие
// которого проверить нечем, и прямо называет причину. Молчаливый пропуск дал бы
// уверенный неверный ответ — всё, что стоит ниже, выполняется ровно при
// условии, что непроверяемое правило не совпало, а этого мы не знаем.
//
// Семантика domain_suffix взята из исходников ядра (SagerNet/sing,
// common/domain/matcher.go), а не из документации: документация говорит лишь
// «Match domain suffix». Без ведущей точки совпадение идёт по границе метки и
// включает сам домен; с ведущей точкой — обычный строковый суффикс, и сам
// домен уже не совпадает.

import { defaultRoute } from './outbounds'
import {
  CHECKABLE_CONDITIONS,
  NON_TERMINAL_ACTIONS,
  conditionKeysOf,
  isLogicalRule,
  ruleAction,
  ruleTarget,
  rulesOf,
} from './rules'
import type { SingboxDoc, SingboxRule } from './types'

type MatchState = 'yes' | 'no' | 'unknown'

export interface SingboxRuleVerdict {
  index: number
  state: MatchState
  /** У 'unknown' причина обязательна: без неё остановка необъяснима */
  reason?: string
  target?: string
}

export interface SingboxTraceResult {
  verdicts: SingboxRuleVerdict[]
  /** ruleIndex === null — ни одно правило не совпало, сработал выход по умолчанию */
  winner?: { ruleIndex: number | null; target: string }
  /** Правило, на котором проход остановлен: проверить его редактор не может */
  stopped?: { index: number; reason: string }
  caveats: string[]
}

interface Cond {
  state: MatchState
  reason?: string
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

function isIp(target: string): boolean {
  return IPV4.test(target) || target.includes(':')
}

function values(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v))
  if (raw === undefined || raw === null) return []
  return [String(raw)]
}

/** Совпадение по границе метки: `example.com` ловит и сам домен, и поддомены */
function matchesSuffix(target: string, suffix: string): boolean {
  if (suffix.startsWith('.')) return target.endsWith(suffix)
  return target === suffix || target.endsWith(`.${suffix}`)
}

function ipInCidr(ip: string, cidr: string): boolean | undefined {
  const [net, bitsRaw] = cidr.split('/')
  if (net === undefined || !IPV4.test(net) || !IPV4.test(ip)) return undefined
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return undefined
  const toInt = (value: string) =>
    value.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (toInt(ip) & mask) === (toInt(net) & mask)
}

const PRIVATE = ['10.', '192.168.', '127.']

function checkCondition(key: string, raw: unknown, target: string): Cond {
  if (!CHECKABLE_CONDITIONS.has(key)) {
    return { state: 'unknown', reason: reasonFor(key) }
  }
  const targetIsIp = isIp(target)

  switch (key) {
    case 'domain':
      if (targetIsIp) return { state: 'unknown', reason: 'условие про домен, а цель — адрес' }
      return { state: values(raw).includes(target) ? 'yes' : 'no' }
    case 'domain_suffix':
      if (targetIsIp) return { state: 'unknown', reason: 'условие про домен, а цель — адрес' }
      return { state: values(raw).some((s) => matchesSuffix(target, s)) ? 'yes' : 'no' }
    case 'domain_keyword':
      if (targetIsIp) return { state: 'unknown', reason: 'условие про домен, а цель — адрес' }
      return { state: values(raw).some((s) => target.includes(s)) ? 'yes' : 'no' }
    case 'domain_regex': {
      if (targetIsIp) return { state: 'unknown', reason: 'условие про домен, а цель — адрес' }
      for (const pattern of values(raw)) {
        try {
          if (new RegExp(pattern).test(target)) return { state: 'yes' }
        } catch {
          return { state: 'unknown', reason: `выражение «${pattern}» не разбирается` }
        }
      }
      return { state: 'no' }
    }
    case 'ip_cidr': {
      if (!targetIsIp) return { state: 'unknown', reason: 'условие про адрес, а цель — домен' }
      let sawUsable = false
      for (const cidr of values(raw)) {
        const hit = ipInCidr(target, cidr)
        if (hit === undefined) continue
        sawUsable = true
        if (hit) return { state: 'yes' }
      }
      return sawUsable ? { state: 'no' } : { state: 'unknown', reason: 'подсеть не разбирается' }
    }
    case 'ip_is_private': {
      if (!targetIsIp) return { state: 'unknown', reason: 'условие про адрес, а цель — домен' }
      const isPrivate = PRIVATE.some((prefix) => target.startsWith(prefix))
      return { state: isPrivate === (raw !== false) ? 'yes' : 'no' }
    }
    case 'port':
    case 'port_range':
      return { state: 'unknown', reason: 'порт назначения в цели трассировки не задан' }
    default:
      return { state: 'unknown', reason: reasonFor(key) }
  }
}

/** Почему условие непроверяемо — текст виден пользователю, поэтому он конкретный */
function reasonFor(key: string): string {
  const named: Record<string, string> = {
    rule_set: 'набор правил лежит по ссылке, редактор её не скачивает',
    clash_mode: 'режим выбирается в клиенте, а не в документе',
    inbound: 'зависит от того, каким входом пришло соединение',
    protocol: 'протокол определяется сниффингом уже в работе',
    client: 'клиент определяется сниффингом уже в работе',
    network: 'транспорт цели трассировки неизвестен',
  }
  if (named[key] !== undefined) return named[key]
  if (key.startsWith('process_') || key === 'package_name') return 'зависит от процесса на устройстве'
  if (key.startsWith('source_')) return 'зависит от источника соединения'
  if (key.startsWith('wifi_')) return 'зависит от сети Wi-Fi на устройстве'
  if (key.startsWith('user')) return 'зависит от пользователя соединения'
  if (key.startsWith('network_')) return 'зависит от типа сети на устройстве'
  return `условие «${key}» редактору незнакомо`
}

/** «И» по всем условиям правила: точное «нет» перевешивает неизвестность */
function judge(rule: SingboxRule, target: string): Cond {
  if (isLogicalRule(rule)) return judgeLogical(rule, target)

  let unknown: string | undefined
  for (const key of conditionKeysOf(rule)) {
    const res = checkCondition(key, rule[key], target)
    if (res.state === 'no') return applyInvert(rule, { state: 'no' })
    if (res.state === 'unknown' && unknown === undefined) unknown = res.reason
  }
  if (unknown !== undefined) return { state: 'unknown', reason: unknown }
  // Правило без единого условия совпадает со всем — так его понимает и ядро
  return applyInvert(rule, { state: 'yes' })
}

function judgeLogical(rule: SingboxRule, target: string): Cond {
  const nested = Array.isArray(rule.rules) ? rule.rules : []
  if (nested.length === 0) return { state: 'unknown', reason: 'у логического правила нет вложенных' }
  const mode = rule.mode === 'or' ? 'or' : 'and'

  let unknown: string | undefined
  for (const inner of nested) {
    const res = judge(inner as SingboxRule, target)
    // Ответ, решающий исход, перевешивает неизвестность: у «и» это «нет»,
    // у «или» — «да»
    if (mode === 'and' && res.state === 'no') return applyInvert(rule, { state: 'no' })
    if (mode === 'or' && res.state === 'yes') return applyInvert(rule, { state: 'yes' })
    if (res.state === 'unknown' && unknown === undefined) unknown = res.reason
  }
  if (unknown !== undefined) return { state: 'unknown', reason: unknown }
  return applyInvert(rule, { state: mode === 'and' ? 'yes' : 'no' })
}

function applyInvert(rule: SingboxRule, res: Cond): Cond {
  if (rule.invert !== true || res.state === 'unknown') return res
  return { state: res.state === 'yes' ? 'no' : 'yes' }
}

export function traceSingbox(doc: SingboxDoc, target: string): SingboxTraceResult {
  const verdicts: SingboxRuleVerdict[] = []
  const caveats: string[] = []
  const query = target.trim()
  if (query === '') return { verdicts, caveats }

  const rules = rulesOf(doc)
  for (const [index, rule] of rules.entries()) {
    const action = ruleAction(rule)
    const res = judge(rule, query)

    if (res.state === 'unknown') {
      verdicts.push({ index, state: 'unknown', reason: res.reason })
      return {
        verdicts,
        stopped: { index, reason: res.reason ?? 'условие проверить нечем' },
        caveats,
      }
    }

    if (res.state === 'no') {
      verdicts.push({ index, state: 'no' })
      continue
    }

    // Совпало. Нетерминальное действие выход не выбирает — идём дальше
    if (NON_TERMINAL_ACTIONS.has(action)) {
      verdicts.push({ index, state: 'yes', reason: `действие ${action} выход не выбирает` })
      continue
    }

    const winnerTarget = action === 'route' ? ruleTarget(rule) : action
    if (winnerTarget === undefined) {
      verdicts.push({ index, state: 'unknown', reason: 'у маршрутного правила не указан выход' })
      return {
        verdicts,
        stopped: { index, reason: 'у маршрутного правила не указан выход' },
        caveats,
      }
    }
    verdicts.push({ index, state: 'yes', target: winnerTarget })
    return { verdicts, winner: { ruleIndex: index, target: winnerTarget }, caveats }
  }

  const fallback = defaultRoute(doc)
  if (!fallback.fromFinal && fallback.tag !== undefined) {
    caveats.push(
      `route.final не задан, поэтому ядро возьмёт первый выход списка — «${fallback.tag}». Любая перестановка outbounds меняет этот ответ.`,
    )
  }
  if (fallback.tag === undefined) return { verdicts, caveats }
  return { verdicts, winner: { ruleIndex: null, target: fallback.tag }, caveats }
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/singbox-trace.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (14 тестов).

- [ ] **Step 5: Мутационная проверка**

1. `matchesSuffix` → `target.endsWith(suffix)` — краснеет тест про `myexample.com`.
2. `matchesSuffix` → `target === suffix || target.endsWith('.' + suffix)` без ветки для ведущей точки — краснеет тест про `.example.com`.
3. В `judgeLogical` для `or` заменить возврат на `state: 'unknown'` при первом же неизвестном — краснеет тест про «или».
4. После остановки продолжать цикл вместо `return` — краснеет тест про `rule_set` (появится `winner`).
5. `NON_TERMINAL_ACTIONS.has(action)` → `false` — краснеет тест про `sniff`/`resolve`.
6. Убрать `applyInvert` из `judge` — краснеет тест про `invert`.

- [ ] **Step 6: Прогнать всё и закоммитить**

Run: `npm test -w frontend`, `npm test -w backend`, `npm run typecheck -w frontend`, `npm run typecheck -w backend`
Expected: PASS целиком; тесты Xray и Mihomo не изменились ни в одном файле (`git diff --stat` по `frontend/test` показывает только новые файлы `singbox-*`).

```bash
git add frontend/src/entities/singbox frontend/test/singbox-trace.test.ts
git commit -m "feat(frontend): trace a request through sing-box route rules"
```

---

## Что этот план НЕ делает

Ни одной строки интерфейса: адаптер документа, страница редактора, граф, формы, панель трассировки, диалог отчёта проверки ядром и различение формата при импорте файла — план 2. Общий слой редактора (`useDocumentDraft`, `EditorShell`, `GraphCanvas`, `DocumentAdapter`) здесь не меняется вовсе, и `entities/singbox/search.ts` тоже уходит в план 2: его результаты адресуют узлы графа, которых пока нет.

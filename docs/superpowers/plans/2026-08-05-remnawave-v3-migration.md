# Миграция на Remnawave v3.x и Xray-core v26.7.28 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести редактор до панели Remnawave 3.x и ядра Xray-core v26.7.28: починить единственную сломавшуюся ручку, забрать у панели вычисленный конфиг для честной проверки ядром и научить схему, формы и диагностики новым запретам ядра и панели.

**Architecture:** Изменения ложатся тремя независимыми слоями. Бэкенд: `RemnawaveClient` получает `getComputedConfig`, `XrayService` — необязательный источник настоящих клиентов панели вместо фиктивных. Фронтенд: единая точка чтения транспорта `streamNetwork` (ядро переименовало `network` → `method`), новый модуль `address.ts` и четыре новые диагностики в `analyzeIntegrity`, поля `minClientVer`/`maxClientVer` в схеме Reality и форме. Инфраструктура: pin ядра и документация.

**Tech Stack:** Fastify + Node 24 + zod (backend, ESM, vitest), React 19 + zustand + zod + vitest/@testing-library + Playwright (frontend), Docker multi-stage.

## Global Constraints

- Дизайн-документ: `docs/superpowers/specs/2026-08-05-remnawave-v3-migration-design.md`. Расходиться с ним нельзя без явного согласования.
- Ветка работы — `feat/remnawave-v3` (уже создана от `origin/main` + коммит спеки `cb4bad7`).
- Совместимость **одновременно с панелью 2.8.x и 3.x**. Ветвлений по версии панели в коде быть не должно.
- Целевая версия ядра — **v26.7.28**. Контрольные суммы (из `.dgst` релиза): amd64 `8195d909f1109b8f3d99eefe401a3c451d7bf4af71f24d3815420f77e5dd2a40`, arm64 `f5698bb218ada3b4022db26fafc39601c5f53b46b19eb76c9616325985807501`.
- Язык: UI, тексты диагностик, комментарии и названия тестов — русский. Сообщения коммитов — английский conventional style (`fix(backend): ...`).
- Сторонних UI-библиотек не добавлять: `shared/ui` — собственный мини-кит.
- В тестах вместо `userEvent.selectOptions` — `selectOption()`/`optionLabels()`/`selectedValue()` из `frontend/test/helpers.ts`.
- Команды: `npm test -w backend`, `npm test -w frontend`, `npm run typecheck -w backend`, `npm run typecheck -w frontend`. Один файл: `npx vitest run test/<file>.test.ts` из каталога workspace.
- Каталог `docs/Remnawave API/` в `.gitignore` — трогать его в коммитах не нужно.

---

## Структура файлов

**Backend**

| Файл | Ответственность |
|---|---|
| `backend/src/remnawave/client.ts` (изм.) | `getComputedConfig`, `deleteProfile` без типизации тела, `describePanelError` |
| `backend/src/remnawave/types.ts` (изм.) | `getComputedConfig` в `RemnawavePort` |
| `backend/src/xray/dummyClient.ts` (изм.) | экспорт предиката `needsClient` |
| `backend/src/xray/panelClients.ts` (нов.) | подстановка клиентов панели + fallback на фиктивных, тип `Injected` |
| `backend/src/xray/service.ts` (изм.) | `test(config, computed?)`, `injected: Injected[]` |
| `backend/src/routes/tools.ts` (изм.) | `profileUuid` в `xray-test`, мягкий отказ панели |
| `backend/src/xray/parseOutput.ts` (изм.) | русские подсказки к новым сообщениям ядра |

**Frontend**

| Файл | Ответственность |
|---|---|
| `frontend/src/entities/xray/compat.ts` (изм.) | `streamNetwork` — единственная точка чтения транспорта |
| `frontend/src/entities/xray/address.ts` (нов.) | `isPrivateAddress` |
| `frontend/src/entities/xray/stream.ts` (изм.) | `method`, `minClientVer`, `maxClientVer`, `cipherSuites`, `pinnedPeerCertSha256` |
| `frontend/src/entities/xray/outbounds.ts` (изм.) | плоская форма VLESS и Trojan |
| `frontend/src/entities/xray/config.ts` (изм.) | `env` в корне, четыре новые диагностики |
| `frontend/src/entities/xray/docSchema.ts` (изм.) | подсказки для всего перечисленного |
| `frontend/src/entities/xray/index.ts` (изм.) | реэкспорт `address.ts` |
| `frontend/src/entities/graph/buildGraph.ts`, `search.ts` (изм.) | чтение транспорта через `streamNetwork` |
| `frontend/src/features/inspector/StreamForm.tsx` (изм.) | `streamNetwork`, удаление `method` при смене транспорта, поле `minClientVer` |
| `frontend/src/shared/api/types.ts`, `hooks.ts` (изм.) | `InjectedClient`, `profileUuid` в `useXrayTest` |
| `frontend/src/features/diagnostics/CheckReportDialog.tsx` (изм.) | два списка инжекта, проп `profileUuid` |
| `frontend/src/features/editor/EditorPage.tsx` (изм.) | прокидывает `profileUuid` |

**Инфраструктура:** `Dockerfile`, `README.md`, `CLAUDE.md`.

---

### Task 1: Клиент панели — DELETE 204, computed-config, разбор `errors[]`

**Files:**
- Modify: `backend/src/remnawave/client.ts`
- Modify: `backend/src/remnawave/types.ts`
- Modify: `backend/test/stub-remnawave.ts`
- Test: `backend/test/remnawave-client.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `describePanelError(json: unknown): string | undefined` — экспорт из `client.ts`
  - `RemnawavePort.getComputedConfig(uuid: string): Promise<unknown>`
  - `RemnawaveClient.deleteProfile(uuid: string): Promise<void>` (тело ответа больше не читается)

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `describe('RemnawaveClient', ...)` в `backend/test/remnawave-client.test.ts`:

```ts
  // v3.0.0 отвечает на DELETE 204 без тела, 2.8.x — 200 с {response:{isDeleted}}.
  // Метод обязан пережить оба: редактор поддерживает обе версии панели.
  it('deleteProfile переживает и 204 без тела, и 200 с телом', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 204 }), calls),
    })
    await expect(client.deleteProfile(profile.uuid)).resolves.toBeUndefined()
    expect(calls[0]!.url).toBe(`http://panel.test/api/config-profiles/${profile.uuid}`)
    expect(calls[0]!.init.method).toBe('DELETE')

    const old = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: { isDeleted: true } } })),
    })
    await expect(old.deleteProfile(profile.uuid)).resolves.toBeUndefined()
  })

  it('getComputedConfig отдаёт config профиля, вычисленный панелью', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(
        () => ({
          status: 200,
          body: { response: { ...profile, config: { inbounds: [{ tag: 'vless-in' }] } } },
        }),
        calls,
      ),
    })
    expect(await client.getComputedConfig('p1')).toEqual({ inbounds: [{ tag: 'vless-in' }] })
    expect(calls[0]!.url).toBe('http://panel.test/api/config-profiles/p1/computed-config')
  })

  // Панель v3 валидирует конфиг сама и кладёт разбор в errors[]. Верхнеуровневый
  // message при этом ничего не называет — без разбора пользователь не поймёт, где чинить.
  it('валидационная ошибка панели разворачивается в перечень полей', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({
        status: 400,
        body: {
          message: 'Validation failed',
          statusCode: 400,
          errors: [
            { validation: 'array', code: 'too_small', message: 'Outbounds cannot be empty', path: ['config', 'outbounds'] },
            { validation: 'string', code: 'invalid_string', message: 'Invalid key', path: ['config', 'inbounds', '0', 'settings', 'password'] },
          ],
        },
      })),
    })
    const err = await client.updateProfile({ uuid: 'p1', config: {} }).catch((e) => e)
    expect(err.status).toBe(400)
    expect(err.message).toBe(
      'config.outbounds — Outbounds cannot be empty; config.inbounds.0.settings.password — Invalid key',
    )
  })

  it('describePanelError без errors[] отдаёт message, а на мусоре — undefined', () => {
    expect(describePanelError({ message: 'Config profile not found' })).toBe('Config profile not found')
    expect(describePanelError({ message: 'Validation failed', errors: [] })).toBe('Validation failed')
    expect(describePanelError({ errors: 'не массив' })).toBeUndefined()
    expect(describePanelError(undefined)).toBeUndefined()
    expect(describePanelError('строка')).toBeUndefined()
  })
```

Дописать `describePanelError` в импорт того же файла:

```ts
import {
  RemnawaveClient,
  RemnawaveError,
  describeCause,
  describePanelError,
  hintForNetworkError,
} from '../src/remnawave/client.js'
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `backend/`: `npx vitest run test/remnawave-client.test.ts`
Ожидается: FAIL — `describePanelError` не экспортирован, `getComputedConfig` не существует.

- [ ] **Step 3: Реализовать в клиенте**

В `backend/src/remnawave/client.ts` добавить после `describeCause`:

```ts
/**
 * У панели два формата ошибки 400: RemnawaveBadRequestErrorDto (просто message)
 * и RemnawaveValidationErrorDto с errors[] — там лежат пути полей, которые не
 * прошли проверку. В v3 панель валидирует и сам Xray-конфиг, поэтому верхний
 * message («Validation failed») перестал что-либо называть.
 */
export function describePanelError(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined
  const body = json as { message?: unknown; errors?: unknown }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const lines = body.errors
      .map((e) => {
        const item = e as { path?: unknown; message?: unknown }
        const path = Array.isArray(item.path) ? item.path.join('.') : ''
        const message = typeof item.message === 'string' ? item.message : ''
        if (path === '' && message === '') return ''
        return path === '' ? message : `${path} — ${message}`
      })
      .filter((line) => line !== '')
    if (lines.length > 0) return lines.join('; ')
  }
  return typeof body.message === 'string' ? body.message : undefined
}
```

Заменить сборку сообщения в `request` (строки 92–96):

```ts
    if (!res.ok) {
      const message = describePanelError(json) ?? `Панель ответила ${res.status}`
      throw new RemnawaveError(res.status, message, json ?? text)
    }
```

Заменить `deleteProfile` (строки 137–142) и добавить `getComputedConfig`:

```ts
  // v3 отвечает 204 без тела, 2.8 — 200 с {response:{isDeleted}}: тело не читаем,
  // и метод одинаково работает с обеими версиями панели
  async deleteProfile(uuid: string): Promise<void> {
    await this.request<void>('DELETE', `/api/config-profiles/${uuid}`)
  }

  /** Конфиг профиля с пользователями, которых панель инжектит при раздаче на ноды */
  async getComputedConfig(uuid: string): Promise<unknown> {
    const r = await this.request<{ response: { config: unknown } }>(
      'GET',
      `/api/config-profiles/${uuid}/computed-config`,
    )
    return r.response.config
  }
```

- [ ] **Step 4: Расширить порт и стаб**

В `backend/src/remnawave/types.ts` дописать в `RemnawavePort` после `getProfileInbounds`:

```ts
  getComputedConfig(uuid: string): Promise<unknown>
```

В `backend/test/stub-remnawave.ts` дописать в возвращаемый объект после `getProfileInbounds`:

```ts
    async getComputedConfig(uuid) {
      const p = find(uuid)
      return p.config
    },
```

- [ ] **Step 5: Прогнать тесты и typecheck**

Из `backend/`: `npx vitest run test/remnawave-client.test.ts` — PASS.
Из корня: `npm test -w backend` и `npm run typecheck -w backend` — PASS.

- [ ] **Step 6: Коммит**

```bash
git add backend/src/remnawave backend/test/stub-remnawave.ts backend/test/remnawave-client.test.ts
git commit -m "feat(backend): support panel v3 delete semantics and computed-config"
```

---

### Task 2: Клиенты панели вместо фиктивных при проверке ядром

**Files:**
- Create: `backend/src/xray/panelClients.ts`
- Create: `backend/test/xray-panel-clients.test.ts`
- Modify: `backend/src/xray/dummyClient.ts`
- Modify: `backend/src/xray/service.ts`
- Modify: `backend/src/routes/tools.ts`
- Test: `backend/test/xray-routes.test.ts`

**Interfaces:**
- Consumes: `RemnawavePort.getComputedConfig` из Task 1.
- Produces:
  - `needsClient(raw: Record<string, unknown>): boolean` — экспорт из `dummyClient.ts`
  - `interface Injected { tag: string; source: 'panel' | 'dummy' }` — экспорт из `panelClients.ts`
  - `withPanelClients(draft: unknown, computed?: unknown): { config: unknown; injected: Injected[] }`
  - `XrayService.test(config: unknown, computed?: unknown): Promise<XrayTestResult>` с `injected: Injected[]`

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/test/xray-panel-clients.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DUMMY_UUID } from '../src/xray/dummyClient.js'
import { withPanelClients } from '../src/xray/panelClients.js'

const draft = {
  inbounds: [
    { tag: 'vless-in', protocol: 'vless', settings: { clients: [], decryption: 'none' } },
    { tag: 'new-in', protocol: 'vless', settings: { clients: [], decryption: 'none' } },
  ],
}

describe('withPanelClients', () => {
  it('берёт клиента панели по совпадению тега', () => {
    const computed = {
      inbounds: [
        {
          tag: 'vless-in',
          protocol: 'vless',
          settings: { clients: [{ id: 'real-1', email: 'a@panel', flow: 'xtls-rprx-vision' }] },
        },
      ],
    }
    const { config, injected } = withPanelClients(draft, computed)
    const clients = (config as any).inbounds[0].settings.clients
    expect(clients).toEqual([{ id: 'real-1', email: 'a@panel', flow: 'xtls-rprx-vision' }])
    expect(injected).toContainEqual({ tag: 'vless-in', source: 'panel' })
  })

  // Боевой профиль содержит тысячи пользователей: во временный файл проверки
  // им незачем ехать целиком
  it('берёт ровно одного клиента, даже если панель прислала много', () => {
    const computed = {
      inbounds: [
        {
          tag: 'vless-in',
          protocol: 'vless',
          settings: { clients: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        },
      ],
    }
    const { config } = withPanelClients(draft, computed)
    expect((config as any).inbounds[0].settings.clients).toEqual([{ id: 'a' }])
  })

  it('inbound без пары в панели получает фиктивного клиента', () => {
    const computed = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [{ id: 'real-1' }] } }] }
    const { config, injected } = withPanelClients(draft, computed)
    expect((config as any).inbounds[1].settings.clients[0].id).toBe(DUMMY_UUID)
    expect(injected).toContainEqual({ tag: 'new-in', source: 'dummy' })
  })

  it('без computed всё уходит в фиктивных — проверка работает при недоступной панели', () => {
    const { config, injected } = withPanelClients(draft)
    expect((config as any).inbounds[0].settings.clients[0].id).toBe(DUMMY_UUID)
    expect(injected).toEqual([
      { tag: 'vless-in', source: 'dummy' },
      { tag: 'new-in', source: 'dummy' },
    ])
  })

  it('inbound с настоящими пользователями в черновике не трогаем', () => {
    const withReal = { inbounds: [{ tag: 'x', protocol: 'vless', settings: { clients: [{ id: 'mine' }] } }] }
    const computed = { inbounds: [{ tag: 'x', protocol: 'vless', settings: { clients: [{ id: 'panel' }] } }] }
    const { config, injected } = withPanelClients(withReal, computed)
    expect((config as any).inbounds[0].settings.clients).toEqual([{ id: 'mine' }])
    expect(injected).toEqual([])
  })

  it('пустой clients у панели не считается парой', () => {
    const computed = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }] }
    const { injected } = withPanelClients(draft, computed)
    expect(injected).toEqual([
      { tag: 'vless-in', source: 'dummy' },
      { tag: 'new-in', source: 'dummy' },
    ])
  })

  it('исходный черновик не мутируется', () => {
    const src = { inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }] }
    withPanelClients(src, { inbounds: [{ tag: 'vless-in', settings: { clients: [{ id: 'p' }] } }] })
    expect(src.inbounds[0]!.settings.clients).toEqual([])
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `backend/`: `npx vitest run test/xray-panel-clients.test.ts`
Ожидается: FAIL — модуля `panelClients.ts` нет.

- [ ] **Step 3: Вынести предикат из `dummyClient.ts`**

В `backend/src/xray/dummyClient.ts` добавить экспорт перед `withDummyClients`:

```ts
/**
 * Нужен ли inbound'у подставной пользователь. Общий предикат для фиктивных
 * клиентов и для клиентов, взятых из computed-config панели: разъехавшись,
 * они начали бы затирать друг друга.
 */
export function needsClient(raw: Record<string, unknown>): boolean {
  const protocol = typeof raw.protocol === 'string' ? raw.protocol : ''
  if (protocol !== 'vless' && protocol !== 'trojan' && protocol !== 'shadowsocks') return false
  const settings = isRecord(raw.settings) ? raw.settings : {}
  if (Array.isArray(settings.clients) && settings.clients.length > 0) return false
  // Одиночный shadowsocks (пароль в settings) — валидный конфиг без clients
  if (protocol === 'shadowsocks' && typeof settings.password === 'string' && settings.password !== '') {
    return false
  }
  return true
}
```

Переписать тело цикла в `withDummyClients` через него:

```ts
  for (const raw of next.inbounds) {
    if (!isRecord(raw)) continue
    if (!needsClient(raw)) continue
    const protocol = raw.protocol as string

    if (!isRecord(raw.settings)) raw.settings = {}
    const settings = raw.settings as Record<string, unknown>
    settings.clients = [dummyClientFor(protocol, settings)]
    injected.push(typeof raw.tag === 'string' ? raw.tag : protocol)
  }
```

- [ ] **Step 4: Написать `panelClients.ts`**

Создать `backend/src/xray/panelClients.ts`:

```ts
// Профили Remnawave хранятся с пустым clients — пользователей инжектит панель.
// computed-config отвечает на вопрос, которого не знал dummyClient: как именно
// выглядит клиент, которого панель реально подставляет. Берём оттуда одного на
// inbound; всё, чему пары не нашлось, уходит в фиктивных как раньше.

import { withDummyClients, needsClient } from './dummyClient.js'

export interface Injected {
  tag: string
  /** 'panel' — клиент взят из computed-config, 'dummy' — подставлен редактором */
  source: 'panel' | 'dummy'
}

export interface PanelInjection {
  config: unknown
  injected: Injected[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** tag → первый клиент inbound'а вычисленного конфига */
function panelClientsByTag(computed: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>()
  if (!isRecord(computed) || !Array.isArray(computed.inbounds)) return map
  for (const raw of computed.inbounds) {
    if (!isRecord(raw) || typeof raw.tag !== 'string') continue
    const settings = isRecord(raw.settings) ? raw.settings : undefined
    const clients = settings?.clients
    if (!Array.isArray(clients) || clients.length === 0) continue
    map.set(raw.tag, clients[0])
  }
  return map
}

export function withPanelClients(draft: unknown, computed?: unknown): PanelInjection {
  const byTag = panelClientsByTag(computed)
  const injected: Injected[] = []

  let staged: unknown = draft
  if (byTag.size > 0 && isRecord(draft) && Array.isArray(draft.inbounds)) {
    const next = structuredClone(draft) as Record<string, unknown>
    for (const raw of next.inbounds as unknown[]) {
      if (!isRecord(raw) || typeof raw.tag !== 'string') continue
      if (!needsClient(raw)) continue
      const client = byTag.get(raw.tag)
      if (client === undefined) continue
      if (!isRecord(raw.settings)) raw.settings = {}
      ;(raw.settings as Record<string, unknown>).clients = [client]
      injected.push({ tag: raw.tag, source: 'panel' })
    }
    staged = next
  }

  const dummy = withDummyClients(staged)
  return {
    config: dummy.config,
    injected: [...injected, ...dummy.injected.map((tag) => ({ tag, source: 'dummy' as const }))],
  }
}
```

- [ ] **Step 5: Прогнать тесты модуля**

Из `backend/`: `npx vitest run test/xray-panel-clients.test.ts test/xray-dummy-client.test.ts` — PASS.

- [ ] **Step 6: Провести `computed` через сервис и роут**

В `backend/src/xray/service.ts` заменить импорт и подпись:

```ts
import { withPanelClients, type Injected } from './panelClients.js'
```

```ts
  /** Теги inbound'ов, куда подставлен пользователь, и откуда он взят */
  injected: Injected[]
```

```ts
  async test(config: unknown, computed?: unknown): Promise<XrayTestResult> {
    const { config: prepared, injected } = withPanelClients(config, computed)
```

Импорт `withDummyClients` из `service.ts` убрать — он больше не вызывается напрямую.

В `backend/src/routes/tools.ts` заменить схему и обработчик:

```ts
const xrayTestSchema = z.object({ config: z.unknown(), profileUuid: z.string().optional() })
```

```ts
  app.post('/api/tools/xray-test', async (req, reply) => {
    // z.unknown() не отличает «не передали» от «передали undefined» — проверяем сами
    const { config, profileUuid } = xrayTestSchema.parse(req.body ?? {})
    if (config === undefined) {
      return reply.status(400).send({ message: 'Нужно передать поле config' })
    }
    let computed: unknown
    if (profileUuid !== undefined) {
      // Панель недоступна или профиль ещё не сохранён — проверка обязана
      // работать так же, как работала до computed-config
      try {
        computed = await app.remnawave.getComputedConfig(profileUuid)
      } catch (err) {
        req.log.warn({ err }, 'computed-config недоступен, проверяем на фиктивных клиентах')
      }
    }
    return app.xray.test(config, computed)
  })
```

- [ ] **Step 7: Дописать тесты роута**

В `backend/test/xray-routes.test.ts` заменить содержимое `describe('POST /api/tools/xray-test', ...)` так, чтобы стаб панели был доступен, и добавить два случая. Полностью новый блок:

```ts
describe('POST /api/tools/xray-test', () => {
  let seen: unknown

  beforeEach(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'xui-xray-stub-'))
    seen = undefined
    const stub = makeStubRemnawave([
      makeProfile({
        uuid: '11111111-1111-4111-8111-111111111111',
        config: {
          inbounds: [
            { tag: 'vless-in', protocol: 'vless', settings: { clients: [{ id: 'panel-user' }] } },
          ],
        },
      }),
    ])
    await start({
      remnawave: stub,
      xray: new XrayService('xray', dataDir, async (_bin, args) => {
        seen = args
        return { code: 0, output: 'Xray 26.7.28\nConfiguration OK.' }
      }),
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
    expect(res.json()).toMatchObject({ available: true, ok: true, version: '26.7.28' })
    expect(seen).toBeDefined()
  })

  it('с profileUuid клиент берётся из панели', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: {
        profileUuid: '11111111-1111-4111-8111-111111111111',
        config: {
          inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }],
          outbounds: [],
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().injected).toEqual([{ tag: 'vless-in', source: 'panel' }])
  })

  // Проверка ядром не должна падать вместе с панелью
  it('панель не ответила — откат на фиктивного клиента, а не 5xx', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: {
        profileUuid: '22222222-2222-4222-8222-222222222222',
        config: {
          inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }],
          outbounds: [],
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().injected).toEqual([{ tag: 'vless-in', source: 'dummy' }])
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
```

Дополнить импорт стаба в том же файле:

```ts
import { makeProfile, makeStubRemnawave } from './stub-remnawave.js'
```

- [ ] **Step 8: Прогнать бэкенд целиком**

Сначала поправить `backend/test/xray-service.test.ts:54` — он ждёт старую форму:

```ts
    expect(res.injected).toEqual([{ tag: 'vless-in', source: 'dummy' }])
```

Затем из корня: `npm test -w backend` и `npm run typecheck -w backend` — PASS.

- [ ] **Step 9: Коммит**

```bash
git add backend/src/xray backend/src/routes/tools.ts backend/test
git commit -m "feat(backend): check the config with real panel clients from computed-config"
```

---

### Task 3: Отчёт проверки показывает источник клиентов

**Files:**
- Modify: `frontend/src/shared/api/types.ts`
- Modify: `frontend/src/shared/api/hooks.ts:219-226`
- Modify: `frontend/src/features/diagnostics/CheckReportDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx:671-680`
- Test: `frontend/test/check-report-dialog.test.tsx`
- Modify: `frontend/test/check-hooks.test.tsx:30-36`
- Modify: `frontend/e2e/check-report.spec.ts:28,36`

**Interfaces:**
- Consumes: форма ответа `/api/tools/xray-test` из Task 2 (`injected: { tag, source }[]`).
- Produces:
  - `interface InjectedClient { tag: string; source: 'panel' | 'dummy' }` в `shared/api/types.ts`
  - `useXrayTest()` с `mutate({ config, profileUuid })`
  - `CheckReportDialog` с обязательным пропом `profileUuid: string`

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/check-report-dialog.test.tsx` дописать в `describe('CheckReportDialog', ...)`:

```ts
  it('клиенты из панели и фиктивные показаны отдельными строками', async () => {
    mockRoutes({
      'xray-test': {
        available: true,
        ok: true,
        version: '26.7.28',
        errors: [],
        warnings: [],
        injected: [
          { tag: 'vless-in', source: 'panel' },
          { tag: 'new-in', source: 'dummy' },
        ],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        profileUuid="p1"
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/клиенты взяты из панели/i)).toHaveTextContent('vless-in')
    expect(screen.getByText(/подставлены фиктивные/i)).toHaveTextContent('new-in')
  })

  it('нет фиктивных — второй строки нет', async () => {
    mockRoutes({
      'xray-test': {
        available: true,
        ok: true,
        errors: [],
        warnings: [],
        injected: [{ tag: 'vless-in', source: 'panel' }],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        profileUuid="p1"
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/клиенты взяты из панели/i)).toBeInTheDocument()
    expect(screen.queryByText(/подставлены фиктивные/i)).not.toBeInTheDocument()
  })
```

В существующих вызовах `CheckReportDialog` того же файла дописать проп `profileUuid="p1"`.

- [ ] **Step 2: Убедиться, что тесты падают**

Из `frontend/`: `npx vitest run test/check-report-dialog.test.tsx`
Ожидается: FAIL — нет текста «клиенты взяты из панели», TypeScript ругается на неизвестный проп.

- [ ] **Step 3: Обновить типы и хук**

В `frontend/src/shared/api/types.ts` заменить поле `injected` в `XrayTestResult` и добавить тип:

```ts
export interface InjectedClient {
  tag: string
  /** 'panel' — клиент взят из computed-config панели, 'dummy' — подставлен редактором */
  source: 'panel' | 'dummy'
}

export interface XrayTestResult {
  available: boolean
  ok: boolean
  version?: string
  errors: XrayTestError[]
  /** Предупреждения ядра: приходят и при успешной проверке */
  warnings: string[]
  /** Inbound'ы, куда на время проверки подставлен пользователь, и откуда он взят */
  injected: InjectedClient[]
}
```

В `frontend/src/shared/api/hooks.ts` заменить `useXrayTest`:

```ts
export function useXrayTest() {
  return useMutation({
    mutationFn: (input: { config: unknown; profileUuid?: string }) =>
      apiFetch<XrayTestResult>('/api/tools/xray-test', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}
```

- [ ] **Step 4: Обновить диалог**

В `CheckReportDialog.tsx` заменить блок `result.injected.length > 0` (строки 73–79) на:

```ts
      {fromPanel.length > 0 && (
        <p className="muted check-note">
          Клиенты взяты из панели: <span className="mono">{fromPanel.join(', ')}</span> — проверялся
          ровно тот пользователь, которого панель инжектит на ноды.
        </p>
      )}
      {fromDummy.length > 0 && (
        <p className="muted check-note">
          Подставлены фиктивные клиенты: <span className="mono">{fromDummy.join(', ')}</span>.
          Панель инжектит реальных пользователей сама, поэтому в профиле их нет.
        </p>
      )}
```

Выше по `CoreReport`, сразу после `if (!result.available) {...}`-блока, добавить:

```ts
  const fromPanel = result.injected.filter((i) => i.source === 'panel').map((i) => i.tag)
  const fromDummy = result.injected.filter((i) => i.source === 'dummy').map((i) => i.tag)
```

Расширить пропы `CheckReportDialog` и передать uuid в мутацию:

```ts
export function CheckReportDialog({
  open,
  config,
  profileUuid,
  targets,
  onClose,
  onOpenGeo,
}: {
  open: boolean
  config: unknown
  /** Профиль панели: из его computed-config берутся настоящие клиенты */
  profileUuid: string
  targets: RealityTargetRef[]
  onClose: () => void
  onOpenGeo: () => void
}) {
```

```ts
    test.mutate({ config, profileUuid })
```

- [ ] **Step 5: Прокинуть uuid из редактора**

В `frontend/src/features/editor/EditorPage.tsx` добавить проп в вызов `CheckReportDialog` (около строки 671):

```tsx
      <CheckReportDialog
        open={checkOpen}
        config={validation.config}
        profileUuid={profile.uuid}
        targets={realityTargets}
```

- [ ] **Step 6: Обновить остальных потребителей формы ответа**

`frontend/test/check-hooks.test.tsx:32,35` — хук теперь принимает объект:

```ts
    result.current.mutate({ config: { outbounds: [] }, profileUuid: 'p1' })
    await waitFor(() => expect(result.current.data?.ok).toBe(true))
    const [, init] = fn.mock.calls[0]! as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      config: { outbounds: [] },
      profileUuid: 'p1',
    })
```

`frontend/e2e/check-report.spec.ts:28` — форма ответа, и следом `:36` — текст, который она проверяет:

```ts
          injected: [{ tag: 'vless-in', source: 'dummy' }],
```

```ts
    await expect(page.getByText(/подставлены фиктивные клиенты/i)).toBeVisible()
```

`frontend/e2e/mocks.ts:70` — там `injected: []`, форма пустого массива не изменилась, править нечего.

- [ ] **Step 7: Прогнать тесты**

Из корня: `npm test -w frontend` и `npm run typecheck -w frontend` — PASS.
Из `frontend/`: `npm run e2e` — PASS.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/shared/api frontend/src/features/diagnostics frontend/src/features/editor/EditorPage.tsx frontend/test/check-report-dialog.test.tsx frontend/e2e
git commit -m "feat(frontend): show whether check clients came from the panel"
```

---

### Task 4: `method` как синоним `network`

**Files:**
- Modify: `frontend/src/entities/xray/compat.ts`
- Modify: `frontend/src/entities/xray/stream.ts:103`
- Modify: `frontend/src/entities/xray/config.ts:16-21,234,236,242,250,267`
- Modify: `frontend/src/entities/xray/docSchema.ts:279-281`
- Modify: `frontend/src/entities/graph/buildGraph.ts:70`
- Modify: `frontend/src/entities/graph/search.ts:51`
- Modify: `frontend/src/features/inspector/StreamForm.tsx:121,206-212`
- Test: `frontend/test/xray-compat.test.ts`, `frontend/test/stream-form.test.tsx`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `interface StreamNetworkSource { network?: string; method?: string }` — экспорт из `compat.ts`
  - `streamNetwork(stream: StreamNetworkSource | undefined): string | undefined`

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/xray-compat.test.ts` дописать импорт `streamNetwork` и новый блок:

```ts
describe('streamNetwork', () => {
  it('читает network, когда method не задан', () => {
    expect(streamNetwork({ network: 'ws' })).toBe('ws')
  })

  it('читает method, когда network не задан', () => {
    expect(streamNetwork({ method: 'xhttp' })).toBe('xhttp')
  })

  // Xray v26.7.28: StreamConfig.Build перезаписывает Network значением Method
  it('при обоих ключах побеждает method — так делает ядро', () => {
    expect(streamNetwork({ network: 'ws', method: 'grpc' })).toBe('grpc')
  })

  it('нет ни одного ключа — undefined, дефолт остаётся за вызывающим', () => {
    expect(streamNetwork({})).toBeUndefined()
    expect(streamNetwork(undefined)).toBeUndefined()
  })
})
```

В `frontend/test/stream-form.test.tsx` дописать внутрь `describe('StreamForm', ...)` (обёртка `wrap` и хелперы `selectOption`/`selectedValue` уже импортированы в этом файле):

```ts
  it('транспорт читается из method', async () => {
    wrap(<StreamForm value={{ method: 'ws', security: 'none' }} onChange={vi.fn()} />)
    expect(selectedValue('Транспорт')).toBe('ws')
  })

  it('смена транспорта пишет network и убирает method', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ method: 'ws', security: 'none' }} onChange={onChange} />)
    await selectOption('Транспорт', 'grpc')
    // method перебивает network в ядре: оставить старый ключ — значит потерять правку
    expect(onChange).toHaveBeenLastCalledWith({ network: 'grpc', security: 'none' })
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `frontend/`: `npx vitest run test/xray-compat.test.ts test/stream-form.test.tsx`
Ожидается: FAIL — `streamNetwork` не экспортирован.

- [ ] **Step 3: Добавить `streamNetwork`**

В `frontend/src/entities/xray/compat.ts` дописать после `normalizeNetwork`:

```ts
/** Поля streamSettings, из которых читается транспорт */
export interface StreamNetworkSource {
  network?: string
  method?: string
}

/**
 * Транспорт узла. Xray v26.7.28 переименовал `network` в `method` (PR #6426) и
 * оставил старое имя алиасом, но в StreamConfig.Build действует
 * `if c.Method != nil { c.Network = c.Method }` — при обоих ключах слушается
 * `method`. Читать транспорт где-либо ещё, кроме этой функции, нельзя.
 */
export function streamNetwork(stream: StreamNetworkSource | undefined): string | undefined {
  return stream?.method ?? stream?.network
}
```

В `frontend/src/entities/xray/stream.ts` дописать в `StreamSettingsSchema` рядом с `network` (строка 103):

```ts
  method: z.string().optional(),
```

- [ ] **Step 4: Перевести все чтения на `streamNetwork`**

`frontend/src/entities/xray/config.ts` — расширить `StreamSubset` (строки 16–21):

```ts
interface StreamSubset {
  network?: string
  method?: string
  security?: string
  tlsSettings?: { certificates?: unknown[] }
  sockopt?: { dialerProxy?: string }
}
```

и заменить пять чтений на `streamNetwork(stream)` / `streamNetwork(stream ?? undefined)`:

```ts
      const secNet = securityNetworkIssue(stream.security, streamNetwork(stream))
      if (secNet) issues.push(issue(['inbounds', i, 'streamSettings'], secNet, 'error'))
      const cert = hysteriaCertificateIssue(streamNetwork(stream), stream.security, stream.tlsSettings)
```

```ts
      const flowIssue = flowNetworkIssue(flow, streamNetwork(stream))
```

```ts
      const secNet = securityNetworkIssue(stream.security, streamNetwork(stream))
```

```ts
          const flowIssue = flowNetworkIssue(user.flow, streamNetwork(stream))
```

Импорт в `config.ts` дополнить `streamNetwork`.

`frontend/src/entities/graph/buildGraph.ts:70`:

```ts
        network: streamNetwork(inb.streamSettings),
```

`frontend/src/entities/graph/search.ts:51`:

```ts
      { label: 'транспорт', value: streamNetwork(inb.streamSettings) },
```

В обоих файлах добавить импорт `streamNetwork` из `../xray`.

`frontend/src/features/inspector/StreamForm.tsx:121`:

```ts
  const network = streamNetwork(value as StreamNetworkSource) ?? 'tcp'
```

и обработчик смены транспорта (строки 206–212):

```tsx
        onChange={(v) =>
          patch((n) => {
            n.network = v
            // method перебивает network в ядре: оставь старый ключ — правка не подействует
            delete n.method
            // Hysteria 2 жёстко требует version: 2 — иначе ядро не стартует
            if (v === 'hysteria' && n.hysteriaSettings === undefined) n.hysteriaSettings = { version: 2 }
          })
        }
```

Импорт в `StreamForm.tsx` дополнить `streamNetwork` и типом `StreamNetworkSource`.

- [ ] **Step 5: Дописать подсказку в `docSchema`**

В `frontend/src/entities/xray/docSchema.ts`, узел `streamSettings` (после строки 280):

```ts
      method: {
        doc: 'Транспорт — новое имя network (Xray ≥26.7.28); при обоих ключах ядро берёт method',
        type: 'string',
        enum: NETWORKS,
      },
```

- [ ] **Step 6: Прогнать тесты**

Из корня: `npm test -w frontend` и `npm run typecheck -w frontend` — PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/entities frontend/src/features/inspector/StreamForm.tsx frontend/test/xray-compat.test.ts frontend/test/stream-form.test.tsx
git commit -m "feat(frontend): read streamSettings.method as the new name of network"
```

---

### Task 5: `isPrivateAddress` и запрет VLESS/Trojan без шифрования

**Files:**
- Create: `frontend/src/entities/xray/address.ts`
- Create: `frontend/test/xray-address.test.ts`
- Modify: `frontend/src/entities/xray/index.ts`
- Modify: `frontend/src/entities/xray/outbounds.ts`
- Modify: `frontend/src/entities/xray/config.ts:247-280`
- Modify: `frontend/src/entities/xray/docSchema.ts:477-481`
- Test: `frontend/test/xray-config.test.ts`, `frontend/test/xray-outbounds.test.ts`

**Interfaces:**
- Consumes: `streamNetwork` из Task 4 (косвенно — тот же блок `outbounds.forEach`).
- Produces:
  - `isPrivateAddress(address: string): boolean` из `entities/xray/address.ts`
  - `TrojanOutboundSettingsSchema`, `TrojanServerSchema` из `entities/xray/outbounds.ts`
  - `VlessOutboundSettingsSchema` с плоскими полями

- [ ] **Step 1: Написать падающие тесты для адреса**

Создать `frontend/test/xray-address.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from '../src/entities/xray'

describe('isPrivateAddress', () => {
  it('приватные диапазоны IPv4', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  it('публичные IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '203.0.113.7']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })

  it('приватные IPv6, в том числе в скобках', () => {
    for (const ip of ['::1', '[::1]', 'fd00::1', 'fc00::1', 'fe80::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('локальные имена и суффиксы', () => {
    for (const host of ['localhost', 'LOCALHOST', 'nas.local', 'panel.internal', 'router.lan', 'pi.home.arpa', 'server.local.']) {
      expect(isPrivateAddress(host), host).toBe(true)
    }
  })

  it('обычный домен считается публичным — как и в ядре', () => {
    expect(isPrivateAddress('example.com')).toBe(false)
    expect(isPrivateAddress('vpn.mydomain.net')).toBe(false)
  })

  it('пустая строка не считается приватной', () => {
    expect(isPrivateAddress('')).toBe(false)
    expect(isPrivateAddress('   ')).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `frontend/`: `npx vitest run test/xray-address.test.ts`
Ожидается: FAIL — `isPrivateAddress` не экспортирован.

- [ ] **Step 3: Написать `address.ts`**

Создать `frontend/src/entities/xray/address.ts`:

```ts
// Ядро Xray с v26.7.28 разрешает VLESS и Trojan без шифрования только на
// приватный адрес и сверяется с geosite-категорией `private` (PR #6303).
// Категорию целиком не повторить — берём практическое подмножество и считаем
// всё остальное публичным, ровно как поступает ядро с неизвестным доменом.

const PRIVATE_SUFFIXES = ['.local', '.lan', '.internal', '.home', '.home.arpa']

function isPrivateV4(host: string): boolean | undefined {
  const parts = host.split('.')
  if (parts.length !== 4) return undefined
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return undefined
  const [a, b] = nums as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function isPrivateAddress(address: string): boolean {
  let host = address.trim().toLowerCase()
  if (host === '') return false
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host === 'localhost') return true

  const v4 = isPrivateV4(host)
  if (v4 !== undefined) return v4

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    // fc00::/7 (ULA) и fe80::/10 (link-local)
    return /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  }

  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
}
```

В `frontend/src/entities/xray/index.ts` дописать первой строкой блока:

```ts
export * from './address'
```

- [ ] **Step 4: Прогнать тесты адреса**

Из `frontend/`: `npx vitest run test/xray-address.test.ts` — PASS.

- [ ] **Step 5: Написать падающие тесты диагностики и схемы**

В `frontend/test/xray-config.test.ts` дописать новый `describe` в конец файла:

```ts
describe('outbound без шифрования на публичный адрес', () => {
  const cfg = (out: Record<string, unknown>) =>
    ({ inbounds: [], outbounds: [out], routing: { rules: [] } }) as unknown as XrayConfig

  it('плоский VLESS без security и без encryption — ошибка', () => {
    const issues = analyzeIntegrity(
      cfg({ tag: 'chain', protocol: 'vless', settings: { address: 'example.com', port: 443, id: 'u' } }),
    )
    const hit = issues.find((i) => i.path === 'outbounds.0.settings.address')
    expect(hit?.level).toBe('error')
    expect(hit?.message).toContain('VLESS')
  })

  it('security tls снимает вопрос', () => {
    const issues = analyzeIntegrity(
      cfg({
        tag: 'chain',
        protocol: 'vless',
        settings: { address: 'example.com', port: 443, id: 'u' },
        streamSettings: { network: 'tcp', security: 'tls' },
      }),
    )
    expect(issues.some((i) => i.path === 'outbounds.0.settings.address')).toBe(false)
  })

  it('encryption снимает вопрос у VLESS, но не у Trojan', () => {
    const vless = analyzeIntegrity(
      cfg({ tag: 'c', protocol: 'vless', settings: { address: 'example.com', port: 443, encryption: 'mlkem768x25519plus.native.0rtt.abc' } }),
    )
    expect(vless.some((i) => i.path === 'outbounds.0.settings.address')).toBe(false)

    const trojan = analyzeIntegrity(
      cfg({ tag: 'c', protocol: 'trojan', settings: { address: 'example.com', port: 443, password: 'p', encryption: 'x' } }),
    )
    const hit = trojan.find((i) => i.path === 'outbounds.0.settings.address')
    expect(hit?.level).toBe('error')
    expect(hit?.message).toContain('Trojan')
  })

  it('приватный адрес разрешён — ядро тоже его пропускает', () => {
    const issues = analyzeIntegrity(
      cfg({ tag: 'c', protocol: 'vless', settings: { address: '10.0.0.5', port: 443, id: 'u' } }),
    )
    expect(issues.some((i) => i.path === 'outbounds.0.settings.address')).toBe(false)
  })

  // vnext/servers ядро не проверяет: validateOutboundTransportSecurity читает
  // плоский Address, а у классической формы он nil
  it('классическая форма vnext под запрет не попадает', () => {
    const issues = analyzeIntegrity(
      cfg({
        tag: 'c',
        protocol: 'vless',
        settings: { vnext: [{ address: 'example.com', port: 443, users: [{ id: 'u', encryption: 'none' }] }] },
      }),
    )
    expect(issues.some((i) => i.path.startsWith('outbounds.0.settings'))).toBe(false)
  })
})
```

В `frontend/test/xray-outbounds.test.ts` дописать в `describe('OutboundSchema — типизированные settings', ...)`:

```ts
  it('vless: плоская форма settings парсится наравне с vnext', () => {
    const parsed = OutboundSchema.parse({
      tag: 'chain',
      protocol: 'vless',
      settings: { address: 'node2.example.com', port: 443, id: 'uuid', encryption: 'none', seed: 's' },
    })
    const settings = parsed.settings as { address: string; seed: string }
    expect(settings.address).toBe('node2.example.com')
    expect(settings.seed).toBe('s')
  })

  it('trojan: обе формы парсятся, servers не-массивом — ошибка с путём', () => {
    expect(() =>
      OutboundSchema.parse({ tag: 't', protocol: 'trojan', settings: { address: 'a.test', port: 443, password: 'p' } }),
    ).not.toThrow()
    expect(() =>
      OutboundSchema.parse({ tag: 't', protocol: 'trojan', settings: { servers: [{ address: 'a.test', port: 443, password: 'p' }] } }),
    ).not.toThrow()
    const res = OutboundSchema.safeParse({ tag: 't', protocol: 'trojan', settings: { servers: 'nope' } })
    expect(res.success).toBe(false)
    expect(res.error!.issues[0]!.path).toEqual(['settings', 'servers'])
  })
```

- [ ] **Step 6: Убедиться, что тесты падают**

Из `frontend/`: `npx vitest run test/xray-config.test.ts test/xray-outbounds.test.ts`
Ожидается: FAIL — диагностики нет, Trojan-схема не зарегистрирована.

- [ ] **Step 7: Реализовать диагностику**

В `frontend/src/entities/xray/config.ts` внутри `outbounds.forEach` (после блока `if (stream) {...}`, до `if (out.protocol === 'vless')`) добавить:

```ts
    // Xray v26.7.28 (PR #6303) отказывается собирать VLESS и Trojan без
    // шифрования на публичный адрес. Проверка ядра читает плоский settings.address —
    // у классических vnext[]/servers[] он nil, поэтому их не трогаем.
    if (out.protocol === 'vless' || out.protocol === 'trojan') {
      const flat = out.settings as { address?: string; encryption?: string } | undefined
      const address = flat?.address
      const secured = (stream?.security ?? 'none') !== 'none'
      const encrypted =
        out.protocol === 'vless' && (flat?.encryption ?? 'none') !== 'none'
      if (
        typeof address === 'string' &&
        address !== '' &&
        !secured &&
        !encrypted &&
        !isPrivateAddress(address)
      ) {
        issues.push(
          issue(
            ['outbounds', i, 'settings', 'address'],
            out.protocol === 'vless'
              ? 'Ядро 26.7.28+ не соберёт VLESS без TLS/Reality и без encryption на публичный адрес — включите security или задайте encryption'
              : 'Ядро 26.7.28+ не соберёт Trojan без TLS на публичный адрес — включите security',
            'error',
          ),
        )
      }
    }
```

Импорт в `config.ts` дополнить `isPrivateAddress` из `./address`.

- [ ] **Step 8: Описать плоскую форму в схеме и подсказках**

В `frontend/src/entities/xray/outbounds.ts` заменить `VlessOutboundSettingsSchema` и добавить Trojan:

```ts
// Xray понимает две формы клиентского outbound'а: классическую (vnext/servers)
// и плоскую (адрес прямо в settings). Ядро проверяет запрет «без шифрования на
// публичный адрес» только для плоской — описываем обе.
export const VlessOutboundSettingsSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  id: z.string().optional(),
  flow: z.string().optional(),
  encryption: z.string().optional(),
  seed: z.string().optional(),
  vnext: z.array(VlessVnextSchema).optional(),
})

export const TrojanServerSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  password: z.string().optional(),
  email: z.string().optional(),
  flow: z.string().optional(),
})

export const TrojanOutboundSettingsSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  password: z.string().optional(),
  flow: z.string().optional(),
  servers: z.array(TrojanServerSchema).optional(),
})
```

и зарегистрировать в `OUTBOUND_SETTINGS_BY_PROTOCOL`:

```ts
  trojan: TrojanOutboundSettingsSchema,
```

В `frontend/src/entities/xray/docSchema.ts` расширить `vlessOutboundSettings` (строки 477–481) и добавить узел Trojan:

```ts
  vlessOutboundSettings: {
    fields: {
      vnext: { doc: 'Серверы назначения (классическая форма)', type: 'array', itemsNode: 'vlessVnext' },
      address: { doc: 'Адрес сервера (плоская форма)', type: 'string' },
      port: { doc: 'Порт сервера (плоская форма)', type: 'number' },
      id: { doc: 'UUID пользователя (плоская форма)', type: 'string' },
      flow: { doc: 'Flow (плоская форма)', type: 'string', enum: FLOW },
      encryption: { doc: 'Шифрование VLESS: none либо строка mlkem768x25519plus…', type: 'string' },
      seed: { doc: 'Seed для VLESS Seed', type: 'string' },
    },
  },
  trojanOutboundSettings: {
    fields: {
      servers: { doc: 'Серверы назначения (классическая форма)', type: 'array', itemsNode: 'trojanServer' },
      address: { doc: 'Адрес сервера (плоская форма)', type: 'string' },
      port: { doc: 'Порт сервера (плоская форма)', type: 'number' },
      password: { doc: 'Пароль (плоская форма)', type: 'string' },
      flow: { doc: 'Flow', type: 'string', enum: FLOW },
    },
  },
  trojanServer: {
    fields: {
      address: { doc: 'Адрес сервера', type: 'string' },
      port: { doc: 'Порт сервера', type: 'number' },
      password: { doc: 'Пароль', type: 'string' },
      email: { doc: 'Идентификатор', type: 'string' },
      flow: { doc: 'Flow', type: 'string', enum: FLOW },
    },
  },
```

и зарегистрировать в `outboundSettingsNode` (строка 141):

```ts
    trojan: 'trojanOutboundSettings',
```

Там же в `OUTBOUND_PROTOCOLS` (строка 122) дописать:

```ts
  { value: 'trojan', doc: 'Цепочка на Trojan-сервер' },
```

- [ ] **Step 9: Прогнать тесты**

Из корня: `npm test -w frontend` и `npm run typecheck -w frontend` — PASS.

- [ ] **Step 10: Коммит**

```bash
git add frontend/src/entities/xray frontend/test/xray-address.test.ts frontend/test/xray-config.test.ts frontend/test/xray-outbounds.test.ts
git commit -m "feat(frontend): flag VLESS and Trojan outbounds the core now refuses"
```

---

### Task 6: Пустые outbounds, Reality `minClientVer`, ключ Shadowsocks 2022

**Files:**
- Modify: `frontend/src/entities/xray/config.ts` (`analyzeIntegrity`)
- Test: `frontend/test/xray-config.test.ts`

**Interfaces:**
- Consumes: `analyzeIntegrity` из Task 5.
- Produces: три новых диагностики; путей и сигнатур наружу не добавляет.

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/xray-config.test.ts` дописать в конец:

```ts
describe('запреты панели v3 и умолчания ядра v26.7.28', () => {
  it('конфиг без outbounds — ошибка: панель такой профиль не примет', () => {
    const issues = analyzeIntegrity({ inbounds: [] } as unknown as XrayConfig)
    const hit = issues.find((i) => i.path === 'outbounds')
    expect(hit?.level).toBe('error')
    expect(hit?.message).toContain('outbounds')
  })

  it('пустой массив outbounds — та же ошибка', () => {
    const issues = analyzeIntegrity({ inbounds: [], outbounds: [] } as unknown as XrayConfig)
    expect(issues.some((i) => i.path === 'outbounds' && i.level === 'error')).toBe(true)
  })

  it('непустые outbounds ошибки не дают', () => {
    const issues = analyzeIntegrity({
      inbounds: [],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    } as unknown as XrayConfig)
    expect(issues.some((i) => i.path === 'outbounds')).toBe(false)
  })

  const reality = (realitySettings: Record<string, unknown>) =>
    ({
      inbounds: [
        {
          tag: 'r-in',
          protocol: 'vless',
          streamSettings: { network: 'tcp', security: 'reality', realitySettings },
        },
      ],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    }) as unknown as XrayConfig

  it('Reality без minClientVer — предупреждение про Mihomo и Sing-Box', () => {
    const hit = analyzeIntegrity(reality({ target: 'x.com:443' })).find(
      (i) => i.path === 'inbounds.0.streamSettings.realitySettings',
    )
    expect(hit?.level).toBe('warning')
    expect(hit?.message).toContain('26.3.27')
    expect(hit?.message).toContain('Mihomo')
  })

  it('явный minClientVer — молчим, вопрос решён', () => {
    const issues = analyzeIntegrity(reality({ target: 'x.com:443', minClientVer: '0.0.0' }))
    expect(issues.some((i) => i.path === 'inbounds.0.streamSettings.realitySettings')).toBe(false)
  })

  const ss = (settings: Record<string, unknown>) =>
    ({
      inbounds: [{ tag: 'ss-in', protocol: 'shadowsocks', settings }],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    }) as unknown as XrayConfig

  // btoa падает на не-Latin1, поэтому исходники ключей здесь только ASCII
  it('ключ 2022 не той длины — ошибка с ожидаемым числом байт', () => {
    const hit = analyzeIntegrity(
      ss({ method: '2022-blake3-aes-256-gcm', password: btoa('short') }),
    ).find((i) => i.path === 'inbounds.0.settings.password')
    expect(hit?.level).toBe('error')
    expect(hit?.message).toContain('32')
  })

  it('ключ 2022 нужной длины — молчим', () => {
    const key = btoa('x'.repeat(32))
    const issues = analyzeIntegrity(ss({ method: '2022-blake3-aes-256-gcm', password: key }))
    expect(issues.some((i) => i.path === 'inbounds.0.settings.password')).toBe(false)
  })

  it('не-base64 в ключе 2022 — тоже ошибка', () => {
    const hit = analyzeIntegrity(
      ss({ method: '2022-blake3-aes-128-gcm', password: 'not base64 at all!!' }),
    ).find((i) => i.path === 'inbounds.0.settings.password')
    expect(hit?.level).toBe('error')
  })

  it('обычный метод шифрования по длине ключа не проверяется', () => {
    const issues = analyzeIntegrity(ss({ method: 'aes-256-gcm', password: 'любой пароль' }))
    expect(issues.some((i) => i.path === 'inbounds.0.settings.password')).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `frontend/`: `npx vitest run test/xray-config.test.ts -t 'запреты панели'`
Ожидается: FAIL — ни одной из трёх диагностик нет.

- [ ] **Step 3: Реализовать проверки**

В `frontend/src/entities/xray/config.ts` добавить перед `analyzeIntegrity`:

```ts
// Длины ключей Shadowsocks 2022 в байтах — панель v3 проверяет их до сохранения
const SS2022_KEY_BYTES: Record<string, number> = {
  '2022-blake3-aes-128-gcm': 16,
  '2022-blake3-aes-256-gcm': 32,
  '2022-blake3-chacha20-poly1305': 32,
}

/** Длина ключа в байтах или null, если это не base64 */
function base64Bytes(value: string): number | null {
  try {
    return atob(value).length
  } catch {
    return null
  }
}
```

В теле `analyzeIntegrity` сразу после объявления `outbounds` (строка 64):

```ts
  // Панель Remnawave 3.x отклоняет профиль с пустыми outbounds ещё до сохранения
  if (outbounds.length === 0) {
    issues.push(
      issue(
        ['outbounds'],
        'Панель Remnawave 3.x не примет конфиг без outbounds — добавьте хотя бы один выход',
        'error',
      ),
    )
  }
```

В цикл `inbounds.forEach` из блока матрицы совместимости (после проверки `cert`, внутри `if (stream)`):

```ts
      // Ядро 26.7.11+ по умолчанию ставит minClientVer 26.3.27: клиенты постарше
      // отваливаются молча, ни в одном логе это не видно
      if ((stream.security ?? 'none') === 'reality') {
        const reality = (inb.streamSettings as { realitySettings?: { minClientVer?: unknown } })
          .realitySettings
        if (reality !== undefined && reality.minClientVer === undefined) {
          issues.push(
            issue(
              ['inbounds', i, 'streamSettings', 'realitySettings'],
              'Ядро 26.7.11+ по умолчанию требует клиента 26.3.27 и новее — Mihomo, Sing-Box и старые Xray не подключатся. Задайте minClientVer «0.0.0», если они нужны',
              'warning',
            ),
          )
        }
      }
```

И там же, в том же `inbounds.forEach`, после блока `if (inb.protocol === 'vless')`:

```ts
    if (inb.protocol === 'shadowsocks') {
      const ss = inb.settings as { method?: string; password?: string } | undefined
      const expected = ss?.method === undefined ? undefined : SS2022_KEY_BYTES[ss.method]
      if (expected !== undefined && typeof ss?.password === 'string') {
        const actual = base64Bytes(ss.password)
        if (actual !== expected) {
          issues.push(
            issue(
              ['inbounds', i, 'settings', 'password'],
              `Метод ${ss.method} требует ключ ровно ${expected} байт в base64 — панель отклонит конфиг с другим`,
              'error',
            ),
          )
        }
      }
    }
```

- [ ] **Step 4: Прогнать тесты и починить фикстуры**

Из корня: `npm test -w frontend` и `npm run typecheck -w frontend` — PASS.

Основные фикстуры уже содержат выходы (`frontend/e2e/mocks.ts:18`, `frontend/test/editor-logic.test.ts:84`, `fullConfig` и `base()` в `xray-config.test.ts`), а тесты, где `.find()` ищет конкретный путь, лишняя диагностика не задевает. Если что-то всё же упало на новой ошибке `outbounds` — значит фикстура без выходов, добавить ей `outbounds: [{ tag: 'direct', protocol: 'freedom' }]`.

- [ ] **Step 5: Прогнать e2e**

Из `frontend/`: `npm run e2e` — PASS.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray/config.ts frontend/test frontend/e2e
git commit -m "feat(frontend): warn about empty outbounds, reality minClientVer and ss2022 keys"
```

---

### Task 7: `minClientVer` и `maxClientVer` в схеме Reality и форме

**Files:**
- Modify: `frontend/src/entities/xray/stream.ts:5-19`
- Modify: `frontend/src/entities/xray/docSchema.ts:296-313`
- Modify: `frontend/src/features/inspector/StreamForm.tsx:626-633`
- Test: `frontend/test/xray-stream.test.ts`, `frontend/test/stream-form.test.tsx`

**Interfaces:**
- Consumes: диагностика Reality из Task 6 (форма её закрывает).
- Produces: поля `minClientVer`/`maxClientVer` в `RealitySettingsSchema`.

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/xray-stream.test.ts` дописать:

```ts
  it('RealitySettingsSchema знает minClientVer и maxClientVer', () => {
    const parsed = RealitySettingsSchema.parse({ minClientVer: '0.0.0', maxClientVer: '99.0.0' })
    expect(parsed.minClientVer).toBe('0.0.0')
    expect(parsed.maxClientVer).toBe('99.0.0')
  })
```

(при необходимости дополнить импорт `RealitySettingsSchema` из `../src/entities/xray`).

В `frontend/test/stream-form.test.tsx` дописать внутрь `describe('StreamForm', ...)`. Поле живёт в `CollapsibleSection`, а он не рендерит содержимое, пока закрыт, — поэтому сначала клик по заголовку:

```ts
  it('кнопка ставит minClientVer 0.0.0 — так пускают Mihomo и Sing-Box', async () => {
    const onChange = vi.fn()
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'reality', realitySettings: { target: 'x.com:443' } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByText('Продвинутые (Reality)'))
    await userEvent.click(screen.getByText(/0\.0\.0 — пустить/))
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.minClientVer).toBe('0.0.0')
    expect(next.realitySettings.target).toBe('x.com:443')
  })

  it('уже заданный minClientVer виден в поле', async () => {
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'reality', realitySettings: { minClientVer: '26.3.27' } }}
        onChange={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByText('Продвинутые (Reality)'))
    expect(screen.getByLabelText('Минимальная версия клиента')).toHaveValue('26.3.27')
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `frontend/`: `npx vitest run test/xray-stream.test.ts test/stream-form.test.tsx`
Ожидается: FAIL — полей и кнопки нет.

- [ ] **Step 3: Расширить схему и подсказки**

В `frontend/src/entities/xray/stream.ts` дописать в `RealitySettingsSchema`:

```ts
  minClientVer: z.string().optional(),
  maxClientVer: z.string().optional(),
```

В `frontend/src/entities/xray/docSchema.ts`, узел `realitySettings`:

```ts
      minClientVer: {
        doc: 'Минимальная версия клиента. С Xray 26.7.11 умолчание — 26.3.27: Mihomo, Sing-Box и старые Xray не подключатся. «0.0.0» снимает ограничение',
        type: 'string',
      },
      maxClientVer: { doc: 'Максимальная версия клиента', type: 'string' },
```

- [ ] **Step 4: Добавить поле в форму**

В `frontend/src/features/inspector/StreamForm.tsx`, внутри `CollapsibleSection title="Продвинутые (Reality)"` (строки 626–633), перед `CheckboxField`:

```tsx
            <TextField
              label="Минимальная версия клиента"
              mono
              placeholder="26.3.27"
              hint="Умолчание ядра с 26.7.11 — 26.3.27: Mihomo, Sing-Box и старые Xray отваливаются молча"
              value={reality.minClientVer as string | undefined}
              onChange={(v) => patchReality((r) => { if (v === undefined) delete r.minClientVer; else r.minClientVer = v })}
            />
            <Button
              variant="ghost"
              onClick={() => patchReality((r) => { r.minClientVer = '0.0.0' })}
            >
              0.0.0 — пустить Mihomo и Sing-Box
            </Button>
            <TextField
              label="Максимальная версия клиента"
              mono
              value={reality.maxClientVer as string | undefined}
              onChange={(v) => patchReality((r) => { if (v === undefined) delete r.maxClientVer; else r.maxClientVer = v })}
            />
```

- [ ] **Step 5: Прогнать тесты**

Из корня: `npm test -w frontend` и `npm run typecheck -w frontend` — PASS.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray frontend/src/features/inspector/StreamForm.tsx frontend/test
git commit -m "feat(frontend): edit reality minClientVer so old clients can be let back in"
```

---

### Task 8: Догон схемы под v26.7.28 — `env`, XMC, `cipherSuites`, `pinnedPeerCertSha256`

**Files:**
- Modify: `frontend/src/entities/xray/config.ts:23-37`
- Modify: `frontend/src/entities/xray/stream.ts` (`TlsSettingsSchema`)
- Modify: `frontend/src/entities/xray/docSchema.ts` (узлы `config`, `finalmask`, `tlsSettings`)
- Test: `frontend/test/xray-config.test.ts`, `frontend/test/xray-stream.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `env` в `XrayConfigSchema`; `cipherSuites` и `pinnedPeerCertSha256` в `TlsSettingsSchema`.

- [ ] **Step 1: Написать падающие тесты**

В `frontend/test/xray-config.test.ts`:

```ts
  it('корневой env (Xray ≥26.7.28) проходит схему и не даёт диагностик', () => {
    const res = validateXrayConfig(
      JSON.stringify({
        env: { XRAY_VMESS_AEAD_FORCED: 'false' },
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      }),
    )
    expect(res.ok).toBe(true)
    expect(res.issues).toEqual([])
  })
```

В `frontend/test/xray-stream.test.ts`:

```ts
  it('TlsSettingsSchema знает cipherSuites и pinnedPeerCertSha256', () => {
    const parsed = TlsSettingsSchema.parse({
      cipherSuites: 'TLS_AES_128_GCM_SHA256',
      pinnedPeerCertSha256: ['abc='],
    })
    expect(parsed.cipherSuites).toBe('TLS_AES_128_GCM_SHA256')
    expect(parsed.pinnedPeerCertSha256).toEqual(['abc='])
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `frontend/`: `npx vitest run test/xray-config.test.ts test/xray-stream.test.ts`
Ожидается: FAIL на обоих новых тестах.

- [ ] **Step 3: Расширить схемы**

В `frontend/src/entities/xray/config.ts`, `XrayConfigSchema` — дописать рядом с `api`:

```ts
  env: obj().optional(),
```

В `frontend/src/entities/xray/stream.ts`, `TlsSettingsSchema` — дописать:

```ts
  cipherSuites: z.string().optional(),
  pinnedPeerCertSha256: z.array(z.string()).optional(),
  verifyPeerCertByName: z.string().optional(),
```

- [ ] **Step 4: Дописать подсказки**

`docSchema.ts`, узел `config` — рядом с `api`:

```ts
      env: { doc: 'Переменные окружения ядра (Xray ≥26.7.28)', type: 'object' },
```

`docSchema.ts`, узел `finalmask`:

```ts
      xmc: { doc: 'Маскировка под Minecraft (TCP) — Xray ≥26.7.28', type: 'object' },
```

`docSchema.ts`, узел `tlsSettings`:

```ts
      cipherSuites: { doc: 'Наборы шифров — только для unsafe (golang) fingerprint', type: 'string' },
      pinnedPeerCertSha256: { doc: 'Пиннинг сертификата; требует serverName, verifyPeerCertByName или адрес outbound-а', type: 'array' },
      verifyPeerCertByName: { doc: 'Имя, по которому проверяется сертификат пира', type: 'string' },
```

- [ ] **Step 5: Прогнать тесты**

Из корня: `npm test -w frontend` и `npm run typecheck -w frontend` — PASS.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray frontend/test
git commit -m "feat(frontend): cover env, XMC and TLS pinning added in Xray v26.7.28"
```

---

### Task 9: Русские подсказки к новым сообщениям ядра

**Files:**
- Modify: `backend/src/xray/parseOutput.ts:13-50`
- Test: `backend/test/xray-parse-output.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: три новые записи в `HINTS`; экспортов не добавляет.

- [ ] **Step 1: Написать падающие тесты**

В `backend/test/xray-parse-output.test.ts` дописать:

```ts
  it('запрет VLESS без шифрования получает русскую подсказку', () => {
    const out =
      'Failed to start: main: failed to load config: vless without TLS or other encryption is prohibited unless the server address is a private IP or domain'
    const errors = parseXrayOutput(out, '/data/tmp/x.json')
    expect(errors[0]!.hint).toContain('encryption')
    expect(errors[0]!.hint).toContain('26.7.28')
  })

  it('запрет Trojan без TLS получает свою подсказку', () => {
    const out =
      'Failed to start: main: failed to load config: trojan without TLS is prohibited unless the server address is a private IP or domain'
    const errors = parseXrayOutput(out, '/data/tmp/x.json')
    expect(errors[0]!.hint).toContain('TLS')
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Из `backend/`: `npx vitest run test/xray-parse-output.test.ts`
Ожидается: FAIL — `hint` не определён.

- [ ] **Step 3: Дописать подсказки**

В `backend/src/xray/parseOutput.ts` вставить в массив `HINTS` **перед** записью про `unknown (protocol|network|security|config id)` (иначе общая запись перехватит):

```ts
  {
    pattern: /vless without TLS or other encryption is prohibited/i,
    hint: 'Ядро 26.7.28+ не собирает VLESS без TLS/Reality и без encryption, если адрес публичный. Включите security в streamSettings или задайте settings.encryption.',
  },
  {
    pattern: /trojan without TLS is prohibited/i,
    hint: 'Ядро 26.7.28+ не собирает Trojan без TLS на публичный адрес. Включите security «tls» в streamSettings — у Trojan обхода через encryption нет.',
  },
  {
    pattern: /minClientVer|maxClientVer/i,
    hint: 'Reality разбирает ограничение версии клиента. С 26.7.11 умолчание minClientVer — 26.3.27; «0.0.0» пускает Mihomo, Sing-Box и старые Xray.',
  },
```

- [ ] **Step 4: Прогнать тесты**

Из корня: `npm test -w backend` — PASS.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/xray/parseOutput.ts backend/test/xray-parse-output.test.ts
git commit -m "feat(backend): translate the new core refusals into Russian hints"
```

---

### Task 10: Ядро v26.7.28 в образе и документация

**Files:**
- Modify: `Dockerfile:8-10`
- Modify: `README.md:16,276-278`
- Modify: `CLAUDE.md:7`

**Interfaces:**
- Consumes: ничего.
- Produces: ничего для кода; фиксирует версии.

- [ ] **Step 1: Поднять pin ядра**

В `Dockerfile` заменить три ARG (строки 8–10):

```dockerfile
ARG XRAY_VERSION=v26.7.28
ARG XRAY_SHA256_AMD64=8195d909f1109b8f3d99eefe401a3c451d7bf4af71f24d3815420f77e5dd2a40
ARG XRAY_SHA256_ARM64=f5698bb218ada3b4022db26fafc39601c5f53b46b19eb76c9616325985807501
```

- [ ] **Step 2: Проверить, что суммы сходятся**

```bash
curl -sL https://github.com/XTLS/Xray-core/releases/download/v26.7.28/Xray-linux-64.zip.dgst | grep SHA2-256
curl -sL https://github.com/XTLS/Xray-core/releases/download/v26.7.28/Xray-linux-arm64-v8a.zip.dgst | grep SHA2-256
```

Ожидается: значения совпадают с ARG выше. Затем собрать образ и убедиться, что шаг `sha256sum -c` проходит:

```bash
docker build --build-arg TARGETARCH=amd64 --target xray -t xui-xray-check .
```

- [ ] **Step 3: Обновить README**

`README.md:16` — бейдж:

```markdown
![Remnawave](https://img.shields.io/badge/Remnawave-3.2.1-6E56CF)
```

`README.md:276-278` — версия ядра:

```markdown
- В Docker-образе ядро уже лежит: `XRAY_BIN=/usr/local/bin/xray`, версия **v26.7.28** — та же,
  что использует Remnawave Node 3.x. Проверять конфиг ядром другой версии смысла мало, поэтому pin
  двигается вслед за панелью (`XRAY_VERSION` и `XRAY_SHA256_*` в `Dockerfile`, хэш берётся из
  `Xray-linux-64.zip.dgst` релиза).
```

Там же, в разделе про проверку ядром, заменить абзац про фиктивных пользователей:

```markdown
- Профили Remnawave хранятся с пустым `clients` — пользователей инжектит панель. Перед проверкой
  редактор берёт по одному настоящему клиенту из `computed-config` профиля; для inbound'ов, которых
  в панели ещё нет (или когда панель недоступна), подставляется фиктивный. Отчёт показывает оба
  списка раздельно.
```

Дописать в README раздел про совместимость — сразу после бейджей:

```markdown
> [!NOTE]
> Редактор работает и с панелью 2.8.x, и с 3.x: используемые им ручки `config-profiles`,
> `internal-squads` и `nodes` мажор не менял. Единственное расхождение — ответ на удаление
> профиля (`204` против `200`), и оно обработано.
```

- [ ] **Step 4: Обновить CLAUDE.md**

`CLAUDE.md`, первая строка раздела «Что это»: заменить «панели Remnawave v2.8.0» на «панели Remnawave 2.8+/3.x».

В разделе про backend, в описании `xray/*`, заменить упоминание `dummyClient.ts` на:

```markdown
- `xray/*` — проверка конфига ядром: `panelClients.ts` берёт по одному настоящему клиенту из
  `computed-config` профиля, `dummyClient.ts` подставляет фиктивного там, где пары не нашлось
  (профили панели хранятся с `clients: []`), `service.ts` запускает `xray run -test` с
  `XRAY_LOCATION_ASSET` на geo-базы из `DATA_DIR`, `parseOutput.ts` переводит цепочки ошибок ядра
  в русские подсказки. Нет бинаря (`XRAY_BIN`) — `available: false`, а не ошибка.
```

В разделе про frontend, в описании `entities/xray`, дописать предложение:

```markdown
  Транспорт узла читается **только** через `streamNetwork` (`compat.ts`): Xray v26.7.28
  переименовал `streamSettings.network` в `method` и при обоих ключах слушает `method`.
```

- [ ] **Step 5: Прогнать всё**

Из корня: `npm test`, `npm run build`, `npm run typecheck -w backend`, `npm run typecheck -w frontend` — PASS.

- [ ] **Step 6: Коммит**

```bash
git add Dockerfile README.md CLAUDE.md
git commit -m "chore: pin Xray-core v26.7.28 and document panel 3.x support"
```

---

## Финальная проверка

- [ ] `npm test` из корня — оба workspace зелёные
- [ ] `npm run build` — tsup и vite собираются
- [ ] `npm run e2e -w frontend` — Playwright зелёный
- [ ] `docker build .` проходит целиком, `sha256sum -c` не ругается
- [ ] Ручная проверка на живой панели 3.x: открыть профиль, нажать «Проверить конфиг», убедиться, что отчёт пишет «Клиенты взяты из панели»
- [ ] PR из `feat/remnawave-v3` в `main`

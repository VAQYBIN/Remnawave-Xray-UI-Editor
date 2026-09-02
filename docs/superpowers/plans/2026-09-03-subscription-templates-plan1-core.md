# Шаблоны подписок, план 1: бэкенд, модель и граф

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать редактору полностью рабочую модель шаблонов подписок XRAY_JSON — чтение и запись через панель, объект `remnawave.injectHosts` как типизированная сущность, его узлы и рёбра в графе — без единого нового экрана.

**Architecture:** Бэкенд получает пять методов порта и роуты `/api/templates*`, зеркалящие профильные, но с защитой от затирания по хэшу содержимого вместо `updatedAt`. Фронтенд получает чистый модуль `entities/xray/inject.ts` с предсказанием тегов; граф и валидации начинают понимать теги, которых в конфиге физически нет.

**Tech Stack:** Fastify 5 + Node 24 (ESM, импорты с `.js`), zod 4, vitest, React Flow 12.

**Spec:** `docs/superpowers/specs/2026-09-03-subscription-templates-design.md`

## Global Constraints

- Язык UI, сообщений об ошибках и текстов тестов — **русский**; коммиты — английский conventional style (`feat(backend): ...`).
- Ветка работы — от `dev`. Ветки `main` касаться нельзя.
- Ответы панели **не валидируются** zod-схемами: новые поля обязаны проходить насквозь. Это закреплено тестом «новые поля панели проходят насквозь» в `backend/test/remnawave-client.test.ts`.
- `@remnawave/backend-contract` подключается **только как devDependency и только через `import type`**. Вызовов `.parse()` его схемами быть не должно.
- Транспорт узла читается только через `streamNetwork` из `entities/xray/compat.ts`.
- Схемы конфига — `z.looseObject`: незнакомые ключи сохраняются, а не выбрасываются.
- Все диагностики несут путь массивом `parts`; строковый `path` — производный, собирается только внутри хелпера `issue()`.
- Каждая задача заканчивается зелёными `npm test -w backend` либо `npm test -w frontend` и коммитом.

---

### Task 1: Типы шаблонов и методы клиента панели

**Files:**
- Modify: `backend/src/remnawave/types.ts`
- Modify: `backend/src/remnawave/client.ts`
- Modify: `backend/test/stub-remnawave.ts`
- Test: `backend/test/templates-client.test.ts`

**Interfaces:**
- Consumes: `RemnawaveClient.request` (приватный), `RemnawaveError` — уже есть.
- Produces: тип `SubscriptionTemplate`, тип `TemplateType`, методы порта `listTemplates`, `getTemplate`, `createTemplate`, `updateTemplate`, `deleteTemplate`; функция `makeStubTemplate` в стабе.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/templates-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RemnawaveClient } from '../src/remnawave/client.js'

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  return (async (url: string, init: RequestInit) => {
    const r = handler(String(url), init)
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const template = {
  uuid: 'bc169195-ca14-4e12-904d-c320a9a5e618',
  viewPosition: 0,
  name: 'Default',
  tags: [],
  templateType: 'XRAY_JSON' as const,
  templateJson: { outbounds: [] },
  encodedTemplateYaml: null,
}

describe('RemnawaveClient: шаблоны подписок', () => {
  it('listTemplates разворачивает response.templates', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: { total: 1, templates: [template] } } })),
    })
    expect(await client.listTemplates()).toEqual([template])
  })

  it('getTemplate ходит по uuid в пути', async () => {
    let seen = ''
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((url) => {
        seen = url
        return { status: 200, body: { response: template } }
      }),
    })
    await client.getTemplate(template.uuid)
    expect(seen).toBe(`http://panel.test/api/subscription-templates/${template.uuid}`)
  })

  // Панель ждёт uuid В ТЕЛЕ, а не в пути — как и у config-profiles
  it('updateTemplate шлёт PATCH на коллекцию с uuid в теле', async () => {
    let method = ''
    let url = ''
    let body: unknown
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((u, init) => {
        url = u
        method = String(init.method)
        body = JSON.parse(String(init.body))
        return { status: 200, body: { response: template } }
      }),
    })
    await client.updateTemplate({ uuid: template.uuid, name: 'Новое', templateJson: { a: 1 } })
    expect(method).toBe('PATCH')
    expect(url).toBe('http://panel.test/api/subscription-templates/')
    expect(body).toEqual({ uuid: template.uuid, name: 'Новое', templateJson: { a: 1 } })
  })

  it('createTemplate шлёт POST {name, templateType}', async () => {
    let body: unknown
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((_u, init) => {
        body = JSON.parse(String(init.body))
        return { status: 201, body: { response: template } }
      }),
    })
    await client.createTemplate('Новый', 'XRAY_JSON')
    expect(body).toEqual({ name: 'Новый', templateType: 'XRAY_JSON' })
  })

  it('deleteTemplate переживает и 200 с телом, и 204 без него', async () => {
    for (const r of [{ status: 200, body: { response: { isDeleted: true } } }, { status: 204 }]) {
      const client = new RemnawaveClient({
        baseUrl: 'http://panel.test',
        token: 't',
        fetchImpl: fakeFetch(() => r),
      })
      await expect(client.deleteTemplate(template.uuid)).resolves.toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd backend && npx vitest run test/templates-client.test.ts`
Expected: FAIL — `client.listTemplates is not a function`.

- [ ] **Step 3: Добавить типы**

В `backend/src/remnawave/types.ts` перед `RemnawavePort`:

```ts
/** Типы шаблонов подписки панели 3.4.x (см. @remnawave/backend-contract) */
export type TemplateType =
  | 'XRAY_JSON'
  | 'XRAY_BASE64'
  | 'MIHOMO'
  | 'STASH'
  | 'CLASH'
  | 'SINGBOX'

/**
 * Шаблон подписки. Полей createdAt/updatedAt здесь НЕТ — оптимистическая
 * блокировка профилей через expectedUpdatedAt тут неприменима, защита строится
 * на сравнении содержимого (backend/src/templates/hash.ts).
 */
export interface SubscriptionTemplate {
  uuid: string
  viewPosition: number
  name: string
  tags?: string[]
  templateType: TemplateType
  /** JSON-типы (XRAY_JSON, SINGBOX); у YAML-типов здесь null */
  templateJson: unknown
  /** YAML-типы (MIHOMO, CLASH, STASH) в base64; у JSON-типов null */
  encodedTemplateYaml: string | null
}
```

В интерфейс `RemnawavePort` добавить:

```ts
  listTemplates(): Promise<SubscriptionTemplate[]>
  getTemplate(uuid: string): Promise<SubscriptionTemplate>
  createTemplate(name: string, templateType: TemplateType): Promise<SubscriptionTemplate>
  updateTemplate(input: {
    uuid: string
    name?: string
    templateJson?: unknown
  }): Promise<SubscriptionTemplate>
  deleteTemplate(uuid: string): Promise<void>
```

- [ ] **Step 4: Реализовать методы клиента**

В `backend/src/remnawave/client.ts` импорт расширить до
`import type { ConfigProfile, PanelInboundDetail, RemnawavePort, SubscriptionTemplate, TemplateType } from './types.js'`,
и добавить в класс после `getProfileInbounds`:

```ts
  // Ручки шаблонов зеркалят config-profiles: PATCH идёт на коллекцию, uuid — в теле.
  // Слеш в конце путей коллекций взят из официального контракта, не из догадки.
  async listTemplates(): Promise<SubscriptionTemplate[]> {
    const r = await this.request<{ response: { total: number; templates: SubscriptionTemplate[] } }>(
      'GET',
      '/api/subscription-templates/',
    )
    return r.response.templates
  }

  async getTemplate(uuid: string): Promise<SubscriptionTemplate> {
    const r = await this.request<{ response: SubscriptionTemplate }>(
      'GET',
      `/api/subscription-templates/${uuid}`,
    )
    return r.response
  }

  async createTemplate(name: string, templateType: TemplateType): Promise<SubscriptionTemplate> {
    const r = await this.request<{ response: SubscriptionTemplate }>(
      'POST',
      '/api/subscription-templates/',
      { name, templateType },
    )
    return r.response
  }

  async updateTemplate(input: {
    uuid: string
    name?: string
    templateJson?: unknown
  }): Promise<SubscriptionTemplate> {
    const r = await this.request<{ response: SubscriptionTemplate }>(
      'PATCH',
      '/api/subscription-templates/',
      input,
    )
    return r.response
  }

  // Тело не читаем — как и у deleteProfile: панель отвечает то 200 с телом, то 204
  async deleteTemplate(uuid: string): Promise<void> {
    await this.request<void>('DELETE', `/api/subscription-templates/${uuid}`)
  }
```

- [ ] **Step 5: Расширить стаб**

В `backend/test/stub-remnawave.ts` добавить импорт `SubscriptionTemplate`, `TemplateType` в существующий `import type`, затем экспорт и реализацию:

```ts
export function makeStubTemplate(
  overrides: Partial<SubscriptionTemplate> = {},
): SubscriptionTemplate {
  return {
    uuid: randomUUID(),
    viewPosition: 0,
    name: 'Test Template',
    tags: [],
    templateType: 'XRAY_JSON',
    templateJson: { outbounds: [{ tag: 'direct', protocol: 'freedom' }] },
    encodedTemplateYaml: null,
    ...overrides,
  }
}
```

В `makeStubRemnawave` расширить сигнатуру до
`(initial: ConfigProfile[] = [], templates: SubscriptionTemplate[] = [])`,
вернуть `templates` в объекте рядом с `profiles` (тип возврата дополнить
`& { templates: SubscriptionTemplate[] }`) и добавить методы:

```ts
    async listTemplates() {
      return templates
    },
    async getTemplate(uuid) {
      const t = templates.find((x) => x.uuid === uuid)
      if (!t) throw new RemnawaveError(404, 'Subscription template not found')
      return t
    },
    async createTemplate(name, templateType) {
      const t = makeStubTemplate({ name, templateType, templateJson: null })
      templates.push(t)
      return t
    },
    async updateTemplate({ uuid, name, templateJson }) {
      const t = templates.find((x) => x.uuid === uuid)
      if (!t) throw new RemnawaveError(404, 'Subscription template not found')
      if (name !== undefined) t.name = name
      if (templateJson !== undefined) t.templateJson = templateJson
      return t
    },
    async deleteTemplate(uuid) {
      const i = templates.findIndex((x) => x.uuid === uuid)
      if (i === -1) throw new RemnawaveError(404, 'Subscription template not found')
      templates.splice(i, 1)
    },
```

- [ ] **Step 6: Убедиться, что всё зелёное**

Run: `cd backend && npx vitest run && npm run typecheck`
Expected: PASS, typecheck без вывода ошибок.

- [ ] **Step 7: Коммит**

```bash
git add backend/src/remnawave backend/test/stub-remnawave.ts backend/test/templates-client.test.ts
git commit -m "feat(backend): методы панели для шаблонов подписок"
```

---

### Task 2: Контрактный тест против официального пакета

**Files:**
- Modify: `backend/package.json`
- Create: `backend/test/contract.test-types.ts`
- Modify: `backend/tsconfig.json` (только если `test` не входит в `include` — проверить перед правкой)

**Interfaces:**
- Consumes: `SubscriptionTemplate`, `TemplateType` из Task 1.
- Produces: ничего в рантайме. Проверка живёт на уровне типов и падает на `tsc --noEmit`.

- [ ] **Step 1: Поставить пакет как devDependency**

```bash
npm install --save-dev --workspace backend @remnawave/backend-contract@3.4.14
```

Версия пинуется точно, без `^`: пакет версионируется под версию панели, и его обновление должно быть осознанным действием.

- [ ] **Step 2: Написать проверку присваиваемости**

Создать `backend/test/contract.test-types.ts`:

```ts
/**
 * Контрактный тест на уровне типов. Ничего не выполняет: падает на
 * `tsc --noEmit`, если наши интерфейсы разошлись с официальным контрактом
 * панели. Пакет подключён ТОЛЬКО как devDependency и только через import type —
 * в рантайме его нет, поэтому терпимость к новым полям панели сохраняется
 * (см. тест «новые поля панели проходят насквозь»).
 */
import type { GetSubscriptionTemplateCommand, UpdateSubscriptionTemplateCommand } from '@remnawave/backend-contract'
import type { SubscriptionTemplate, TemplateType } from '../src/remnawave/types.js'

type PanelTemplate = GetSubscriptionTemplateCommand.Response['response']

// Ответ панели обязан подходить под наш тип: иначе клиент врёт о том, что читает
const _fromPanel: SubscriptionTemplate = null as unknown as PanelTemplate

// Наше перечисление типов обязано совпадать с контрактным
type PanelTemplateType = PanelTemplate['templateType']
const _typeToPanel: PanelTemplateType = null as unknown as TemplateType
const _typeFromPanel: TemplateType = null as unknown as PanelTemplateType

// Тело обновления, которое шлёт клиент, обязано быть допустимым для панели
const _updateBody: UpdateSubscriptionTemplateCommand.RequestBody = {
  uuid: '00000000-0000-0000-0000-000000000000',
  name: 'x',
  templateJson: {},
}

export type { PanelTemplate }
```

- [ ] **Step 3: Убедиться, что проверка реально работает**

Временно сломать: в `backend/src/remnawave/types.ts` заменить в `TemplateType`
строку `'XRAY_BASE64'` на `'SINGBOX_LEGACY'`.

Run: `cd backend && npx tsc --noEmit`
Expected: FAIL с ошибкой присваиваемости на `_typeFromPanel`.

Вернуть `'XRAY_BASE64'` обратно и убедиться, что `npx tsc --noEmit` снова чист.
Проверка, которая не краснеет на подложенной ошибке, бесполезна — этот шаг
пропускать нельзя.

- [ ] **Step 4: Коммит**

```bash
git add backend/package.json backend/test/contract.test-types.ts package-lock.json
git commit -m "test(backend): контрактный тест против @remnawave/backend-contract"
```

---

### Task 3: Канонизация и хэш содержимого

**Files:**
- Create: `backend/src/templates/hash.ts`
- Test: `backend/test/templates-hash.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `canonicalize(value: unknown): unknown`, `hashTemplateJson(templateJson: unknown): string`.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/templates-hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canonicalize, hashTemplateJson } from '../src/templates/hash.js'

describe('хэш содержимого шаблона', () => {
  // Порядок ключей в JSON незначим, порядок элементов массива — значим
  it('не зависит от порядка ключей', () => {
    const a = { outbounds: [{ tag: 'direct', protocol: 'freedom' }], dns: { servers: ['1.1.1.1'] } }
    const b = { dns: { servers: ['1.1.1.1'] }, outbounds: [{ protocol: 'freedom', tag: 'direct' }] }
    expect(hashTemplateJson(a)).toBe(hashTemplateJson(b))
  })

  it('зависит от порядка элементов массива', () => {
    expect(hashTemplateJson({ rules: [1, 2] })).not.toBe(hashTemplateJson({ rules: [2, 1] }))
  })

  it('меняется при изменении значения', () => {
    expect(hashTemplateJson({ a: 1 })).not.toBe(hashTemplateJson({ a: 2 }))
  })

  // У YAML-типов templateJson равен null — хэш обязан считаться, а не падать
  it('переживает null и undefined', () => {
    expect(hashTemplateJson(null)).toBe(hashTemplateJson(undefined))
    expect(hashTemplateJson(null)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('canonicalize сортирует ключи рекурсивно и не трогает массивы', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: [3, 1] } }))).toBe(
      '{"a":{"c":[3,1],"d":2},"b":1}',
    )
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd backend && npx vitest run test/templates-hash.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

Создать `backend/src/templates/hash.ts`:

```ts
import { createHash } from 'node:crypto'

/**
 * У шаблонов подписки нет updatedAt, поэтому чужие правки ловятся сравнением
 * содержимого. Хэш считает ТОЛЬКО бэкенд: если бы его вычисляли обе стороны,
 * они разошлись бы на первой же мелочи вроде порядка ключей.
 *
 * Канонизация — рекурсивная сортировка ключей объектов. Порядок элементов
 * массивов значим и сохраняется: в Xray-конфиге порядок правил маршрутизации
 * решает всё.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key])
    return out
  }
  return value
}

/** Хэшируется только templateJson: переименование шаблона в панели — не конфликт содержимого */
export function hashTemplateJson(templateJson: unknown): string {
  const canonical = JSON.stringify(canonicalize(templateJson) ?? null)
  return createHash('sha256').update(canonical).digest('hex')
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd backend && npx vitest run test/templates-hash.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add backend/src/templates backend/test/templates-hash.test.ts
git commit -m "feat(backend): канонический хэш содержимого шаблона"
```

---

### Task 4: Бэкапы шаблонов в своём пространстве имён

**Files:**
- Modify: `backend/src/backups/service.ts`
- Test: `backend/test/backups-templates.test.ts`

**Interfaces:**
- Consumes: `SubscriptionTemplate` из Task 1.
- Produces: `BackupService.saveTemplateBackup(template)`, `.listTemplateBackups(uuid)`, `.readTemplateBackup(uuid, file)`, тип `TemplateBackupFile { savedAt: string; template: SubscriptionTemplate }`.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/backups-templates.test.ts`:

```ts
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BackupService } from '../src/backups/service.js'
import { makeStubTemplate } from './stub-remnawave.js'
import { makeProfile } from './stub-remnawave.js'

const dataDir = () => mkdtempSync(join(tmpdir(), 'xui-backups-'))

describe('бэкапы шаблонов', () => {
  it('пишет в своё пространство имён, не задевая профили', async () => {
    const dir = dataDir()
    const svc = new BackupService(dir)
    const template = makeStubTemplate({ name: 'Мой шаблон' })

    const file = await svc.saveTemplateBackup(template)

    expect(existsSync(join(dir, 'backups', 'templates', template.uuid, file))).toBe(true)
    // Путь профилей не изменился — иначе накопленные бэкапы осиротеют
    expect(existsSync(join(dir, 'backups', template.uuid))).toBe(false)
  })

  it('список и чтение возвращают сохранённое', async () => {
    const svc = new BackupService(dataDir())
    const template = makeStubTemplate({ name: 'Мой шаблон' })
    const file = await svc.saveTemplateBackup(template)

    const entries = await svc.listTemplateBackups(template.uuid)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ file, profileName: 'Мой шаблон' })

    const read = await svc.readTemplateBackup(template.uuid, file)
    expect(read.template).toEqual(template)
  })

  it('бэкапы шаблона и профиля с одним uuid не смешиваются', async () => {
    const svc = new BackupService(dataDir())
    const uuid = '11111111-1111-1111-1111-111111111111'
    await svc.saveBackup(makeProfile({ uuid, name: 'Профиль' }))
    await svc.saveTemplateBackup(makeStubTemplate({ uuid, name: 'Шаблон' }))

    expect(await svc.list(uuid)).toHaveLength(1)
    expect(await svc.listTemplateBackups(uuid)).toHaveLength(1)
  })

  it('имя файла бэкапа шаблона проверяется так же строго', async () => {
    const svc = new BackupService(dataDir())
    await expect(svc.readTemplateBackup('u', '../secrets.json')).rejects.toThrow(
      'Некорректное имя файла бэкапа',
    )
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd backend && npx vitest run test/backups-templates.test.ts`
Expected: FAIL — `svc.saveTemplateBackup is not a function`.

- [ ] **Step 3: Реализовать**

В `backend/src/backups/service.ts` расширить импорт типов до
`import type { ConfigProfile, SubscriptionTemplate } from '../remnawave/types.js'`,
добавить рядом с `BackupFile`:

```ts
export interface TemplateBackupFile {
  savedAt: string
  template: SubscriptionTemplate
}
```

Заменить `dirFor` и добавить общее ядро плюс методы шаблонов:

```ts
  private dirFor(profileUuid: string): string {
    return join(this.dataDir, 'backups', profileUuid)
  }

  // Шаблоны живут в своём подкаталоге: uuid профиля и шаблона могут совпасть,
  // а путь профилей менять нельзя — иначе накопленные бэкапы осиротеют
  private templateDirFor(templateUuid: string): string {
    return join(this.dataDir, 'backups', 'templates', templateUuid)
  }

  private async writeTo(dir: string, payload: unknown): Promise<string> {
    await mkdir(dir, { recursive: true })
    const savedAt = (payload as { savedAt: string }).savedAt
    const file = `${savedAt.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`
    await writeFile(join(dir, file), JSON.stringify(payload, null, 2), 'utf8')
    return file
  }

  async saveTemplateBackup(template: SubscriptionTemplate): Promise<string> {
    const payload: TemplateBackupFile = { savedAt: new Date().toISOString(), template }
    return this.writeTo(this.templateDirFor(template.uuid), payload)
  }

  async listTemplateBackups(templateUuid: string): Promise<BackupEntry[]> {
    let files: string[]
    try {
      files = await readdir(this.templateDirFor(templateUuid))
    } catch {
      return []
    }
    const entries: BackupEntry[] = []
    for (const file of files.filter((f) => SAFE_FILE.test(f))) {
      const data = await this.readTemplateBackup(templateUuid, file)
      entries.push({ file, savedAt: data.savedAt, profileName: data.template.name })
    }
    return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  }

  async readTemplateBackup(templateUuid: string, file: string): Promise<TemplateBackupFile> {
    if (!SAFE_FILE.test(file)) {
      throw new Error('Некорректное имя файла бэкапа')
    }
    const raw = await readFile(join(this.templateDirFor(templateUuid), file), 'utf8')
    return JSON.parse(raw) as TemplateBackupFile
  }
```

Существующий `saveBackup` переписать через общее ядро, не меняя поведения:

```ts
  async saveBackup(profile: ConfigProfile): Promise<string> {
    const payload: BackupFile = { savedAt: new Date().toISOString(), profile }
    return this.writeTo(this.dirFor(profile.uuid), payload)
  }
```

Поле `profileName` в `BackupEntry` намеренно оставлено с прежним именем: на него
завязан фронтенд, а переименование ради шаблонов потянуло бы правки в
`VersionsDialog` без всякой пользы.

- [ ] **Step 4: Убедиться, что зелено, включая старые тесты бэкапов**

Run: `cd backend && npx vitest run test/backups.test.ts test/backups-templates.test.ts`
Expected: PASS оба файла.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/backups/service.ts backend/test/backups-templates.test.ts
git commit -m "feat(backend): бэкапы шаблонов в отдельном пространстве имён"
```

---

### Task 5: Роуты чтения, создания и удаления шаблонов

**Files:**
- Create: `backend/src/routes/templates.ts`
- Create: `backend/src/templates/starter.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/templates-routes.test.ts`

**Interfaces:**
- Consumes: методы порта из Task 1, `hashTemplateJson` из Task 3, `saveTemplateBackup` из Task 4.
- Produces: `templateRoutes` (Fastify-плагин), константа `STARTER_XRAY_TEMPLATE`.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/templates-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

async function makeApp(stub = makeStubRemnawave()) {
  const app = await buildServer(makeTestConfig(), { remnawave: stub })
  const cookie = await loginCookie(app)
  return { app, cookie, stub }
}

describe('роуты шаблонов', () => {
  it('список отдаёт шаблоны панели', async () => {
    const t = makeStubTemplate({ name: 'Default' })
    const { app, cookie } = await makeApp(makeStubRemnawave([], [t]))
    const res = await app.inject({ method: 'GET', url: '/api/templates', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().templates).toHaveLength(1)
    await app.close()
  })

  it('чтение отдаёт шаблон вместе с хэшем содержимого', async () => {
    const t = makeStubTemplate()
    const { app, cookie } = await makeApp(makeStubRemnawave([], [t]))
    const res = await app.inject({ method: 'GET', url: `/api/templates/${t.uuid}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().template.uuid).toBe(t.uuid)
    expect(res.json().hash).toMatch(/^[0-9a-f]{64}$/)
    await app.close()
  })

  // Панель создаёт шаблон в два вызова; клиент обязан видеть одну операцию
  it('создание возвращает готовый каркас, а не пустышку', async () => {
    const { app, cookie, stub } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { cookie },
      payload: { name: 'My Template' },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json().template
    expect(created.name).toBe('My Template')
    expect(created.templateType).toBe('XRAY_JSON')
    const json = created.templateJson as Record<string, unknown>
    expect(json.outbounds).toBeDefined()
    expect((json.remnawave as { injectHosts: unknown[] }).injectHosts).toHaveLength(1)
    expect(stub.templates).toHaveLength(1)
    await app.close()
  })

  // Панель режет имя регуляркой /^[A-Za-z0-9_\s-]+$/ и отвечает 400 по-английски.
  // Проверяем локально ровно тем же набором символов, чтобы пользователь получал
  // понятное русское сообщение до обращения к панели, а не её ответ после.
  it('имя шаблона проверяется так же, как имя профиля', async () => {
    const { app, cookie } = await makeApp()
    for (const name of ['плохое имя ✗', 'Кириллица', 'имя/со/слешем']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/templates',
        headers: { cookie },
        payload: { name },
      })
      expect(res.statusCode, `имя «${name}» должно быть отклонено`).toBe(400)
    }
    await app.close()
  })

  it('удаление пишет бэкап и убирает шаблон из панели', async () => {
    const t = makeStubTemplate()
    const { app, cookie, stub } = await makeApp(makeStubRemnawave([], [t]))
    const res = await app.inject({ method: 'DELETE', url: `/api/templates/${t.uuid}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(stub.templates).toHaveLength(0)
    expect(await app.backups.listTemplateBackups(t.uuid)).toHaveLength(1)
    await app.close()
  })

  it('все ручки шаблонов закрыты гардом', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    for (const url of ['/api/templates', '/api/templates/11111111-1111-1111-1111-111111111111']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    }
    await app.close()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd backend && npx vitest run test/templates-routes.test.ts`
Expected: FAIL — 404 вместо 200 на `/api/templates`.

- [ ] **Step 3: Написать каркас нового шаблона**

Создать `backend/src/templates/starter.ts`:

```ts
/**
 * Каркас нового XRAY_JSON-шаблона. Панель создаёт шаблон пустым, а пустой
 * шаблон бесполезен: подписка из него не даст клиенту ни одного сервера.
 * Здесь — минимальный рабочий скелет: локальные входы клиента, одна группа
 * подстановки и статические выходы, перед которыми панель вставит хосты.
 */
export const STARTER_XRAY_TEMPLATE = {
  remnawave: {
    addVirtualHostAsOutbound: false,
    injectHosts: [
      {
        selector: { type: 'sameTagAsRecipient' },
        tagPrefix: 'proxy',
        selectFrom: 'HIDDEN',
      },
    ],
  },
  log: { loglevel: 'warning' },
  inbounds: [
    {
      tag: 'socks',
      port: 10808,
      listen: '127.0.0.1',
      protocol: 'socks',
      settings: { udp: true, auth: 'noauth' },
      sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
    },
    {
      tag: 'http',
      port: 10809,
      listen: '127.0.0.1',
      protocol: 'http',
      settings: { allowTransparent: false },
      sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'block', protocol: 'blackhole' },
  ],
  routing: { rules: [] },
} as const
```

- [ ] **Step 4: Написать роуты**

Создать `backend/src/routes/templates.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { hashTemplateJson } from '../templates/hash.js'
import { STARTER_XRAY_TEMPLATE } from '../templates/starter.js'

const paramsSchema = z.object({ uuid: z.string().uuid() })

// Те же ограничения, что у имени профиля: панель одинаково придирчива к обоим
const nameSchema = z
  .string()
  .min(2)
  .max(30)
  .regex(/^[A-Za-z0-9_\s-]+$/, 'Имя: латиница, цифры, пробел, - и _')

const createSchema = z.object({ name: nameSchema })

export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/templates', async () => ({ templates: await app.remnawave.listTemplates() }))

  app.get('/api/templates/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    const template = await app.remnawave.getTemplate(uuid)
    return { template, hash: hashTemplateJson(template.templateJson) }
  })

  // Создание у панели двухшаговое: POST делает пустой шаблон, содержимое
  // заливается отдельным PATCH. Склейка здесь, клиент видит одну операцию.
  app.post('/api/templates', async (req, reply) => {
    const body = createSchema.parse(req.body)
    const created = await app.remnawave.createTemplate(body.name, 'XRAY_JSON')
    const template = await app.remnawave.updateTemplate({
      uuid: created.uuid,
      templateJson: STARTER_XRAY_TEMPLATE,
    })
    reply.status(201)
    return { template }
  })

  app.delete('/api/templates/:uuid', async (req) => {
    const { uuid } = paramsSchema.parse(req.params)
    const current = await app.remnawave.getTemplate(uuid)
    await app.backups.saveTemplateBackup(current)
    await app.remnawave.deleteTemplate(uuid)
    return { ok: true }
  })
}
```

- [ ] **Step 5: Зарегистрировать плагин**

В `backend/src/server.ts` добавить импорт
`import { templateRoutes } from './routes/templates.js'`
и строку регистрации сразу после `await app.register(profileRoutes)`:

```ts
  await app.register(templateRoutes)
```

- [ ] **Step 6: Убедиться, что тест проходит**

Run: `cd backend && npx vitest run test/templates-routes.test.ts && npm run typecheck`
Expected: PASS (6 тестов), typecheck чист.

- [ ] **Step 7: Коммит**

```bash
git add backend/src/routes/templates.ts backend/src/templates/starter.ts backend/src/server.ts backend/test/templates-routes.test.ts
git commit -m "feat(backend): роуты чтения, создания и удаления шаблонов"
```

---

### Task 6: Сохранение шаблона с защитой по хэшу

**Files:**
- Modify: `backend/src/routes/templates.ts`
- Test: `backend/test/templates-save.test.ts`

**Interfaces:**
- Consumes: всё из Task 5.
- Produces: `PATCH /api/templates/:uuid`, тело `{ name?, templateJson, expectedHash }`, ответ `{ template }` либо `409 { message, current }`.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/templates-save.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { hashTemplateJson } from '../src/templates/hash.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

async function makeApp(templates = [makeStubTemplate()]) {
  const stub = makeStubRemnawave([], templates)
  const app = await buildServer(makeTestConfig(), { remnawave: stub })
  const cookie = await loginCookie(app)
  return { app, cookie, stub, template: templates[0]! }
}

describe('сохранение шаблона', () => {
  it('с актуальным хэшем сохраняет и пишет бэкап', async () => {
    const { app, cookie, template, stub } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: {
        templateJson: { outbounds: [{ tag: 'direct', protocol: 'freedom' }], dns: {} },
        expectedHash: hashTemplateJson(template.templateJson),
      },
    })
    expect(res.statusCode).toBe(200)
    expect((stub.templates[0]!.templateJson as Record<string, unknown>).dns).toBeDefined()
    expect(await app.backups.listTemplateBackups(template.uuid)).toHaveLength(1)
    await app.close()
  })

  it('с устаревшим хэшем отвечает 409 и отдаёт актуальный шаблон', async () => {
    const { app, cookie, template, stub } = await makeApp()
    // Снимок ДО запроса и обязательно глубокая копия: стаб хранит тот же объект,
    // что и `template`, поэтому сравнение с ним самим прошло бы всегда и не
    // проверило бы ничего
    const before = structuredClone(template.templateJson)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { a: 1 }, expectedHash: 'устаревший' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().current.uuid).toBe(template.uuid)
    // Ничего не записано
    expect(stub.templates[0]!.templateJson).toEqual(before)
    expect(await app.backups.listTemplateBackups(template.uuid)).toHaveLength(0)
    await app.close()
  })

  // Порядок ключей в панели мог измениться, а содержимое — нет: это не конфликт
  it('переставленные ключи конфликтом не считаются', async () => {
    const template = makeStubTemplate({ templateJson: { a: 1, b: 2 } })
    const { app, cookie } = await makeApp([template])
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { c: 3 }, expectedHash: hashTemplateJson({ b: 2, a: 1 }) },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('без expectedHash запрос отклоняется', async () => {
    const { app, cookie, template } = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { a: 1 } },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd backend && npx vitest run test/templates-save.test.ts`
Expected: FAIL — 404 на PATCH.

- [ ] **Step 3: Реализовать**

В `backend/src/routes/templates.ts` добавить схему рядом с `createSchema`:

```ts
const updateSchema = z.object({
  name: nameSchema.optional(),
  templateJson: z.record(z.string(), z.unknown()),
  /** Хэш, полученный при чтении; считает и сравнивает только бэкенд */
  expectedHash: z.string().min(1),
})
```

и роут после `app.delete`:

```ts
  // Аналог оптимистической блокировки профилей, но по содержимому: у шаблонов
  // нет updatedAt, сравнивать нечего кроме самого JSON.
  app.patch('/api/templates/:uuid', async (req, reply) => {
    const { uuid } = paramsSchema.parse(req.params)
    const body = updateSchema.parse(req.body)
    const current = await app.remnawave.getTemplate(uuid)
    if (hashTemplateJson(current.templateJson) !== body.expectedHash) {
      return reply.status(409).send({
        message: 'Шаблон был изменён в панели после открытия',
        current,
      })
    }
    await app.backups.saveTemplateBackup(current)
    const template = await app.remnawave.updateTemplate({
      uuid,
      name: body.name,
      templateJson: body.templateJson,
    })
    return { template }
  })
```

- [ ] **Step 4: Убедиться, что весь бэкенд зелёный**

Run: `cd backend && npx vitest run && npm run typecheck`
Expected: PASS всё, typecheck чист.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/routes/templates.ts backend/test/templates-save.test.ts
git commit -m "feat(backend): сохранение шаблона с защитой по хэшу содержимого"
```

---

### Task 7: Модель директив подстановки

**Files:**
- Create: `frontend/src/entities/xray/inject.ts`
- Modify: `frontend/src/entities/xray/config.ts` (только добавление поля в `XrayConfigSchema`)
- Modify: `frontend/src/entities/xray/index.ts`
- Test: `frontend/test/xray-inject.test.ts`

**Interfaces:**
- Consumes: `XrayConfig` из `entities/xray/config`.
- Produces: `InjectGroupSchema`, `RemnawaveDirectivesSchema`, типы `InjectGroup`, `HostSelector`; функции `tagScheme(group): 'prefix' | 'panel' | 'none'`, `predictedTags(group): string[]`, `injectGroupsOf(config): InjectGroup[]`, `injectedTagOwners(config): Map<string, number>`, `injectedTagsOf(config): string[]`, `hasPanelNamedTags(config): boolean`, `describeSelector(group): string`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-inject.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import {
  describeSelector,
  hasPanelNamedTags,
  injectedTagOwners,
  injectedTagsOf,
  injectGroupsOf,
  predictedTags,
  tagScheme,
} from '../src/entities/xray/inject'

const withGroups = (groups: unknown[]) =>
  XrayConfigSchema.parse({
    remnawave: { injectHosts: groups },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  })

describe('директивы подстановки', () => {
  it('переживают разбор и не теряют незнакомые ключи', () => {
    const config = withGroups([
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', полеИзБудущего: 1 },
    ])
    expect(injectGroupsOf(config)).toHaveLength(1)
    expect((injectGroupsOf(config)[0] as Record<string, unknown>).полеИзБудущего).toBe(1)
  })

  it('без директив список групп пуст, а не падает', () => {
    const config = XrayConfigSchema.parse({ outbounds: [] })
    expect(injectGroupsOf(config)).toEqual([])
    expect(injectedTagsOf(config)).toEqual([])
    expect(hasPanelNamedTags(config)).toBe(false)
  })

  it('tagScheme различает три случая', () => {
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' })).toBe('prefix')
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true })).toBe('panel')
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' }, useHostRemarkAsTag: true })).toBe('panel')
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' } })).toBe('none')
  })

  // Панель нумерует со второго: proxy, proxy-2, proxy-3
  it('предсказывает теги префиксной группы', () => {
    expect(predictedTags({ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' })).toEqual([
      'proxy',
      'proxy-2',
      'proxy-3',
    ])
  })

  it('для тегов от панели предсказывать нечего', () => {
    expect(predictedTags({ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true })).toEqual([])
    expect(predictedTags({ selector: { type: 'sameTagAsRecipient' }, tagPrefix: '' })).toEqual([])
  })

  it('владелец тега находится по индексу группы', () => {
    const config = withGroups([
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'ru' },
      { selector: { type: 'tagRegex', pattern: '^DE-' }, tagPrefix: 'de' },
    ])
    const owners = injectedTagOwners(config)
    expect(owners.get('ru')).toBe(0)
    expect(owners.get('de-2')).toBe(1)
    expect(owners.get('direct')).toBeUndefined()
    expect(injectedTagsOf(config)).toContain('ru-3')
  })

  it('hasPanelNamedTags поднимается от одной группы с тегами панели', () => {
    expect(hasPanelNamedTags(withGroups([{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p' }]))).toBe(false)
    expect(
      hasPanelNamedTags(
        withGroups([
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p' },
          { selector: { type: 'sameTagAsRecipient' }, useHostRemarkAsTag: true },
        ]),
      ),
    ).toBe(true)
  })

  it('describeSelector даёт короткую подпись для карточки узла', () => {
    expect(describeSelector({ selector: { type: 'tagRegex', pattern: '^RU-' } })).toBe('тег ~ ^RU-')
    expect(describeSelector({ selector: { type: 'remarkRegex', pattern: '^RU' } })).toBe('примечание ~ ^RU')
    expect(describeSelector({ selector: { type: 'uuids', values: ['a', 'b'] } })).toBe('по списку: 2')
    expect(describeSelector({ selector: { type: 'sameTagAsRecipient' } })).toBe('тег как у получателя')
    expect(describeSelector({})).toBe('селектор не задан')
    expect(describeSelector({ selector: { type: 'выдумка' } })).toBe('неизвестный селектор «выдумка»')
  })

  // Сломанный селектор — ошибка ВАЛИДАЦИИ, а не разбора: иначе одна опечатка
  // гасит весь граф и пользователь не видит даже уцелевшего
  it('группа с незнакомым селектором и группа без него всё равно разбираются', () => {
    const config = withGroups([{ selector: { type: 'выдумка' }, tagPrefix: 'p' }, { tagPrefix: 'q' }])
    expect(injectGroupsOf(config)).toHaveLength(2)
    expect(injectedTagsOf(config)).toContain('p')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/xray-inject.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Написать модель**

Создать `frontend/src/entities/xray/inject.ts`:

```ts
// Директивы Remnawave в шаблоне подписки. Ядро Xray о них не знает: панель
// подставляет хосты и удаляет объект `remnawave` перед отдачей клиенту.
//
// Главная особенность: инжектируемых outbound'ов в конфиге ФИЗИЧЕСКИ НЕТ, а
// правила и балансеры ссылаются на них по тегу. Поэтому теги предсказываются —
// и предсказать их можно не всегда, см. tagScheme.

import { z } from 'zod'
import type { XrayConfig } from './config'

// type — строка, а НЕ discriminatedUnion: селектор с незнакомым типом должен
// давать ошибку валидации, а не рушить разбор всего конфига. Иначе одна опечатка
// гасит весь граф и пользователь не видит даже того, что уцелело. Тот же приём,
// что у strategy.type в balancers.ts.
export const HostSelectorSchema = z.looseObject({
  type: z.string(),
  values: z.array(z.string()).optional(),
  pattern: z.string().optional(),
})

export type HostSelector = z.infer<typeof HostSelectorSchema>

export const SELECTOR_TYPES = ['uuids', 'remarkRegex', 'tagRegex', 'sameTagAsRecipient'] as const

export const SELECT_FROM = ['HIDDEN', 'NOT_HIDDEN', 'ALL'] as const

// selectFrom — строка, а не z.enum: незнакомое значение из чужого шаблона должно
// давать предупреждение валидации, а не рушить разбор всего конфига. Тот же
// приём, что у strategy.type в balancers.ts.
export const InjectGroupSchema = z.looseObject({
  // selector необязателен на уровне разбора: его отсутствие — ошибка валидации,
  // а не повод отказаться читать документ
  selector: HostSelectorSchema.optional(),
  selectFrom: z.string().optional(),
  tagPrefix: z.string().optional(),
  useHostRemarkAsTag: z.boolean().optional(),
  useHostTagAsTag: z.boolean().optional(),
})

export type InjectGroup = z.infer<typeof InjectGroupSchema>

export const RemnawaveDirectivesSchema = z.looseObject({
  addVirtualHostAsOutbound: z.boolean().optional(),
  injectHosts: z.array(InjectGroupSchema).optional(),
})

/**
 * Сколько тегов предсказываем для префиксной группы. Точное число знает только
 * панель — оно равно числу подошедших хостов. Трёх хватает, чтобы селектор
 * балансера вида ["proxy-"] нашёл хотя бы одного кандидата.
 */
const PREDICTED_COUNT = 3

/**
 * Как группа именует свои outbound'ы:
 * `prefix` — теги предсказуемы (proxy, proxy-2, …), связи выводимы;
 * `panel`  — теги берутся из примечаний или тегов хостов и заранее НЕИЗВЕСТНЫ;
 * `none`   — способ не выбран, это ошибка конфигурации.
 */
export function tagScheme(group: InjectGroup): 'prefix' | 'panel' | 'none' {
  if (group.useHostRemarkAsTag === true || group.useHostTagAsTag === true) return 'panel'
  if (typeof group.tagPrefix === 'string' && group.tagPrefix !== '') return 'prefix'
  return 'none'
}

/** Теги, которые произведёт группа. Для схемы `panel` их не предсказать — пусто. */
export function predictedTags(group: InjectGroup): string[] {
  if (tagScheme(group) !== 'prefix') return []
  const prefix = group.tagPrefix as string
  const tags = [prefix]
  for (let n = 2; n <= PREDICTED_COUNT; n += 1) tags.push(`${prefix}-${n}`)
  return tags
}

export function injectGroupsOf(config: XrayConfig): InjectGroup[] {
  return config.remnawave?.injectHosts ?? []
}

/** Тег → индекс произведшей его группы. Нужно графу: ребро ведёт к узлу inj:<index>. */
export function injectedTagOwners(config: XrayConfig): Map<string, number> {
  const owners = new Map<string, number>()
  injectGroupsOf(config).forEach((group, index) => {
    for (const tag of predictedTags(group)) {
      if (!owners.has(tag)) owners.set(tag, index)
    }
  })
  return owners
}

export function injectedTagsOf(config: XrayConfig): string[] {
  return [...injectedTagOwners(config).keys()]
}

/**
 * Есть ли группа, теги которой знает только панель. Если да — проверки
 * «неизвестный outbound-тег» и «у балансера нет кандидатов» обязаны молчать:
 * на корректном шаблоне они дают ложную тревогу.
 */
export function hasPanelNamedTags(config: XrayConfig): boolean {
  return injectGroupsOf(config).some((g) => tagScheme(g) === 'panel')
}

/** Короткая подпись селектора для карточки узла и списка проблем */
export function describeSelector(group: InjectGroup): string {
  const selector = group.selector
  if (selector === undefined) return 'селектор не задан'
  switch (selector.type) {
    case 'tagRegex':
      return `тег ~ ${selector.pattern ?? ''}`
    case 'remarkRegex':
      return `примечание ~ ${selector.pattern ?? ''}`
    case 'uuids':
      return `по списку: ${selector.values?.length ?? 0}`
    case 'sameTagAsRecipient':
      return 'тег как у получателя'
    default:
      return `неизвестный селектор «${selector.type}»`
  }
}
```

- [ ] **Step 4: Подключить к корневой схеме и реэкспорту**

В `frontend/src/entities/xray/config.ts` добавить импорт
`import { RemnawaveDirectivesSchema } from './inject'`
и поле в `XrayConfigSchema` сразу после `env`:

```ts
  /** Директивы подстановки хостов в шаблоне подписки; в профиле ноды их не бывает */
  remnawave: RemnawaveDirectivesSchema.optional(),
```

В `frontend/src/entities/xray/index.ts` добавить строку реэкспорта рядом с остальными:

```ts
export * from './inject'
```

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `cd frontend && npx vitest run test/xray-inject.test.ts test/xray-config.test.ts && npm run typecheck`
Expected: PASS оба файла, typecheck чист.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray/inject.ts frontend/src/entities/xray/config.ts frontend/src/entities/xray/index.ts frontend/test/xray-inject.test.ts
git commit -m "feat(frontend): модель директив подстановки хостов"
```

---

### Task 8: Валидации подстановки и ослабление двух существующих

**Files:**
- Modify: `frontend/src/entities/xray/config.ts` (функция `analyzeIntegrity`)
- Modify: `frontend/src/entities/xray/balancers.ts` (функция `outboundTagsOf`)
- Test: `frontend/test/xray-inject-validate.test.ts`

**Interfaces:**
- Consumes: `injectGroupsOf`, `tagScheme`, `hasPanelNamedTags`, `injectedTagsOf`, `SELECT_FROM` из Task 7.
- Produces: новые `ValidationIssue` с путями `['remnawave','injectHosts',i,...]`; `outboundTagsOf` теперь возвращает и предсказанные теги.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-inject-validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { analyzeIntegrity, XrayConfigSchema } from '../src/entities/xray/config'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)
const messages = (config: ReturnType<typeof parse>) => analyzeIntegrity(config).map((i) => i.message)

const base = {
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

describe('валидации подстановки', () => {
  it('ругается на группу без способа именования тегов', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' } }] } })
    expect(messages(config)).toContain(
      'Не выбран способ именования тегов: нужен ровно один из tagPrefix, useHostRemarkAsTag, useHostTagAsTag',
    )
  })

  it('ругается на два способа именования сразу', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p', useHostTagAsTag: true }] },
    })
    expect(messages(config)).toContain(
      'Задано больше одного способа именования тегов — панель примет только один',
    )
  })

  it('ругается на группу без селектора', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [{ tagPrefix: 'p' }] } })
    expect(messages(config)).toContain('Группа без селектора: непонятно, какие хосты подставлять')
  })

  it('ругается на незнакомый тип селектора, но конфиг при этом читается', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [{ selector: { type: 'выдумка' }, tagPrefix: 'p' }] } })
    expect(messages(config).some((m) => m.startsWith('Неизвестный тип селектора «выдумка»'))).toBe(true)
  })

  it('ругается на нерабочее регулярное выражение', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'tagRegex', pattern: '^[RU' }, tagPrefix: 'p' }] },
    })
    expect(messages(config).some((m) => m.startsWith('Селектор не компилируется'))).toBe(true)
  })

  it('ругается на неизвестный пул выбора', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p', selectFrom: 'ЛЮБОЙ' }] },
    })
    expect(messages(config)).toContain('Неизвестный пул выбора «ЛЮБОЙ»: ожидается HIDDEN, NOT_HIDDEN или ALL')
  })

  it('предупреждает о пустом списке uuid', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'uuids', values: [] }, tagPrefix: 'p' }] },
    })
    expect(messages(config)).toContain('Список uuid пуст — группа не подставит ни одного хоста')
  })

  it('предупреждает о шаблоне без единой группы подстановки', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [] } })
    expect(messages(config)).toContain(
      'В шаблоне нет ни одной группы подстановки — подписка не получит ни одного сервера',
    )
  })

  // В профиле ноды объекта remnawave нет вовсе: предупреждение не должно вылезать
  it('на конфиге без директив про подстановку молчит', () => {
    expect(messages(parse(base)).some((m) => m.includes('группы подстановки'))).toBe(false)
  })

  it('путь проблемы ведёт внутрь injectHosts', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' } }] },
    })
    const found = analyzeIntegrity(config).find((i) => i.message.startsWith('Не выбран способ'))
    expect(found?.parts).toEqual(['remnawave', 'injectHosts', 0])
    expect(found?.path).toBe('remnawave.injectHosts.0')
  })
})

describe('ослабление проверок на предсказанных тегах', () => {
  const withPrefixGroup = {
    ...base,
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    routing: { rules: [{ outboundTag: 'proxy' }], balancers: [{ tag: 'bal', selector: ['proxy'] }] },
  }

  it('правило на предсказанный тег не считается ошибочным', () => {
    expect(messages(parse(withPrefixGroup)).some((m) => m.includes('несуществующий outbound'))).toBe(false)
  })

  it('балансер с предсказанными кандидатами не ругается', () => {
    expect(messages(parse(withPrefixGroup)).some((m) => m.includes('не из чего выбирать'))).toBe(false)
  })

  // Теги от панели неизвестны: обе проверки обязаны замолчать целиком,
  // иначе редактор ругается на корректный шаблон
  it('при тегах от панели обе проверки подавляются', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      routing: { rules: [{ outboundTag: 'что-угодно' }], balancers: [{ tag: 'bal', selector: ['нечто'] }] },
    })
    const m = messages(config)
    expect(m.some((x) => x.includes('несуществующий outbound'))).toBe(false)
    expect(m.some((x) => x.includes('не из чего выбирать'))).toBe(false)
  })

  // А без всякой подстановки проверки обязаны работать как раньше
  it('в обычном профиле проверки не ослаблены', () => {
    const config = parse({ ...base, routing: { rules: [{ outboundTag: 'нет-такого' }] } })
    expect(messages(config).some((m) => m.includes('несуществующий outbound'))).toBe(true)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/xray-inject-validate.test.ts`
Expected: FAIL — новых сообщений нет, а последние тесты ослабления падают на ложных срабатываниях.

- [ ] **Step 3: Научить балансеры видеть предсказанные теги**

В `frontend/src/entities/xray/balancers.ts` заменить `outboundTagsOf`:

```ts
// Для балансера тег инжектируемого хоста НИЧЕМ не отличается от обычного:
// к моменту работы ядра панель уже подставила его в outbounds. Поэтому
// предсказанные теги входят сюда наравне со статическими.
export function outboundTagsOf(config: XrayConfig): string[] {
  const static_ = (config.outbounds ?? [])
    .map((o) => o.tag)
    .filter((t): t is string => typeof t === 'string')
  return [...static_, ...injectedTagsOf(config)]
}
```

и добавить импорт `import { injectedTagsOf } from './inject'`.

- [ ] **Step 4: Добавить и ослабить проверки**

В `frontend/src/entities/xray/config.ts` в начале `analyzeIntegrity` после
`const outbounds = config.outbounds ?? []` добавить:

```ts
  const injectGroups = injectGroupsOf(config)
  // Теги, которые панель создаст сама: для проверок они существуют
  const predicted = injectedTagsOf(config)
  // Часть тегов знает только панель — тогда проверки на существование тега молчат
  const tagsUnknowable = hasPanelNamedTags(config)
```

Заменить строку `const outboundTags = new Set(outbounds.map((x) => x.tag))` на:

```ts
  const outboundTags = new Set([...outbounds.map((x) => x.tag), ...predicted])
```

Условие проверки правила заменить на:

```ts
    if (rule.outboundTag && !tagsUnknowable && !outboundTags.has(rule.outboundTag)) {
```

Условие проверки балансера заменить на:

```ts
    const candidates = balancerCandidates(config, bal)
    if (candidates.length === 0 && !tagsUnknowable) {
```

Добавить блок проверок подстановки перед `return issues`:

```ts
  // Шаблон подписки без подстановки отдаёт клиенту конфиг без единого сервера.
  // Глазами в JSON это не видно, поэтому проверка ценнее прочих.
  if (config.remnawave !== undefined && injectGroups.length === 0) {
    issues.push(
      issue(
        ['remnawave', 'injectHosts'],
        'В шаблоне нет ни одной группы подстановки — подписка не получит ни одного сервера',
        'warning',
      ),
    )
  }

  injectGroups.forEach((group, i) => {
    const named = [group.tagPrefix !== undefined && group.tagPrefix !== '', group.useHostRemarkAsTag === true, group.useHostTagAsTag === true].filter(Boolean).length
    if (named === 0) {
      issues.push(
        issue(
          ['remnawave', 'injectHosts', i],
          'Не выбран способ именования тегов: нужен ровно один из tagPrefix, useHostRemarkAsTag, useHostTagAsTag',
          'error',
        ),
      )
    } else if (named > 1) {
      issues.push(
        issue(
          ['remnawave', 'injectHosts', i],
          'Задано больше одного способа именования тегов — панель примет только один',
          'error',
        ),
      )
    }

    if (group.selectFrom !== undefined && !SELECT_FROM.includes(group.selectFrom as (typeof SELECT_FROM)[number])) {
      issues.push(
        issue(
          ['remnawave', 'injectHosts', i, 'selectFrom'],
          `Неизвестный пул выбора «${group.selectFrom}»: ожидается HIDDEN, NOT_HIDDEN или ALL`,
          'error',
        ),
      )
    }

    const selector = group.selector
    if (selector === undefined) {
      issues.push(
        issue(['remnawave', 'injectHosts', i, 'selector'], 'Группа без селектора: непонятно, какие хосты подставлять', 'error'),
      )
    } else if (!SELECTOR_TYPES.includes(selector.type as (typeof SELECTOR_TYPES)[number])) {
      issues.push(
        issue(
          ['remnawave', 'injectHosts', i, 'selector', 'type'],
          `Неизвестный тип селектора «${selector.type}»: ожидается uuids, remarkRegex, tagRegex или sameTagAsRecipient`,
          'error',
        ),
      )
    }
    if (selector?.type === 'tagRegex' || selector?.type === 'remarkRegex') {
      try {
        new RegExp(selector.pattern ?? '')
      } catch (err) {
        issues.push(
          issue(
            ['remnawave', 'injectHosts', i, 'selector', 'pattern'],
            `Селектор не компилируется как регулярное выражение: ${(err as Error).message}`,
            'error',
          ),
        )
      }
    }
    if (selector?.type === 'uuids' && (selector.values ?? []).length === 0) {
      issues.push(
        issue(
          ['remnawave', 'injectHosts', i, 'selector', 'values'],
          'Список uuid пуст — группа не подставит ни одного хоста',
          'warning',
        ),
      )
    }
  })
```

Добавить в импорты `config.ts`:
`import { hasPanelNamedTags, injectedTagsOf, injectGroupsOf, SELECT_FROM, SELECTOR_TYPES } from './inject'`
(объединить с уже добавленным в Task 7 импортом `RemnawaveDirectivesSchema`).

- [ ] **Step 5: Убедиться, что зелено и старые валидации не сломались**

Run: `cd frontend && npx vitest run test/xray-inject-validate.test.ts test/xray-config.test.ts test/xray-balancers.test.ts && npm run typecheck`
Expected: PASS все три файла, typecheck чист.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/xray/config.ts frontend/src/entities/xray/balancers.ts frontend/test/xray-inject-validate.test.ts
git commit -m "feat(frontend): валидации подстановки хостов и учёт предсказанных тегов"
```

---

### Task 9: Узлы подстановки в графе

**Files:**
- Modify: `frontend/src/entities/graph/types.ts`
- Modify: `frontend/src/entities/graph/buildGraph.ts`
- Test: `frontend/test/graph-inject.test.ts`

**Interfaces:**
- Consumes: `injectGroupsOf`, `tagScheme`, `predictedTags`, `describeSelector` из Task 7.
- Produces: тип `InjectNodeData`, узлы с id `inj:<index>` в колонке outbound.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-inject.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import { buildGraph, COLUMN_X, layoutColumns } from '../src/entities/graph/buildGraph'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

const config = parse({
  remnawave: {
    injectHosts: [
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
      { selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true },
    ],
  },
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
})

describe('узлы подстановки', () => {
  it('строятся по одному на группу', () => {
    const { nodes } = buildGraph(config)
    const inject = nodes.filter((n) => n.data.kind === 'inject')
    expect(inject.map((n) => n.id)).toEqual(['inj:0', 'inj:1'])
  })

  it('несут подпись селектора, пул и предсказанные теги', () => {
    const { nodes } = buildGraph(config)
    const first = nodes.find((n) => n.id === 'inj:0')!
    expect(first.data).toMatchObject({
      kind: 'inject',
      index: 0,
      selector: 'тег ~ ^RU-',
      selectFrom: 'HIDDEN',
      scheme: 'prefix',
      tags: ['proxy', 'proxy-2', 'proxy-3'],
    })
  })

  it('у группы с тегами от панели список тегов пуст', () => {
    const { nodes } = buildGraph(config)
    expect(nodes.find((n) => n.id === 'inj:1')!.data).toMatchObject({ scheme: 'panel', tags: [] })
  })

  it('без директив узлов подстановки нет', () => {
    const { nodes } = buildGraph(parse({ outbounds: [{ tag: 'direct', protocol: 'freedom' }] }))
    expect(nodes.some((n) => n.data.kind === 'inject')).toBe(false)
  })

  // Инжектируемые outbound'ы панель вставляет в начало массива — на холсте они
  // тоже стоят выше статических, в той же колонке
  it('ложатся в колонку outbound выше статических выходов', () => {
    const placed = layoutColumns(buildGraph(config).nodes)
    const inj0 = placed.find((n) => n.id === 'inj:0')!
    const direct = placed.find((n) => n.id === 'out:direct')!
    expect(inj0.position.x).toBe(COLUMN_X.outbound)
    expect(direct.position.x).toBe(COLUMN_X.outbound)
    expect(inj0.position.y).toBeLessThan(direct.position.y)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/graph-inject.test.ts`
Expected: FAIL — узлов `inject` нет.

- [ ] **Step 3: Добавить тип данных узла**

В `frontend/src/entities/graph/types.ts` после `BalancerNodeData`:

```ts
export interface InjectNodeData extends Record<string, unknown> {
  kind: 'inject'; index: number
  /** Короткая подпись селектора для карточки */
  selector: string
  /** Пул выбора; undefined — панель возьмёт HIDDEN */
  selectFrom?: string
  /** 'prefix' — теги предсказуемы, 'panel' — их знает только панель, 'none' — не задано */
  scheme: 'prefix' | 'panel' | 'none'
  /** Предсказанные теги; для схемы 'panel' пусто */
  tags: string[]
  issueCount?: IssueCount
}
```

- [ ] **Step 4: Строить узлы**

В `frontend/src/entities/graph/buildGraph.ts` добавить импорт
`import { describeSelector, injectGroupsOf, predictedTags, tagScheme } from '../xray/inject'`
и вставить блок **перед** циклом построения outbound-узлов (`const seenOutboundTags`):

```ts
  // Группы подстановки идут перед статическими выходами: панель вставляет
  // инжектируемые outbound'ы в начало массива, и на холсте порядок тот же
  injectGroupsOf(config).forEach((group, index) => {
    nodes.push({
      id: `inj:${index}`,
      type: 'inject',
      position: { x: 0, y: 0 },
      data: {
        kind: 'inject',
        index,
        selector: describeSelector(group),
        selectFrom: group.selectFrom,
        scheme: tagScheme(group),
        tags: predictedTags(group),
      },
    })
  })
```

- [ ] **Step 5: Разложить их в колонку outbound**

В `layoutColumns` заменить строку `const kind = n.data.kind as keyof typeof counters | 'dns' | 'observatory'` на:

```ts
    // Узлы подстановки делят колонку и счётчик строк с outbound'ами: они и есть
    // будущие outbound'ы, просто их создаст панель
    const raw = n.data.kind === 'inject' ? 'outbound' : n.data.kind
    const kind = raw as keyof typeof counters | 'dns' | 'observatory'
```

- [ ] **Step 6: Убедиться, что тест проходит**

Run: `cd frontend && npx vitest run test/graph-inject.test.ts test/build-graph.test.ts && npm run typecheck`
Expected: PASS оба файла, typecheck чист.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/entities/graph/types.ts frontend/src/entities/graph/buildGraph.ts frontend/test/graph-inject.test.ts
git commit -m "feat(frontend): узлы групп подстановки в графе"
```

---

### Task 10: Рёбра к узлам подстановки

**Files:**
- Modify: `frontend/src/entities/graph/buildGraph.ts`
- Test: `frontend/test/graph-inject-edges.test.ts`

**Interfaces:**
- Consumes: `injectedTagOwners` из Task 7, узлы `inj:<index>` из Task 9.
- Produces: рёбра `e:bal:<tag>->inj:<index>`, `e:rule:<i>->inj:<index>`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-inject-edges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import { buildGraph } from '../src/entities/graph/buildGraph'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

describe('рёбра к группам подстановки', () => {
  it('балансер соединяется с группой, чьи теги попали под селектор', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['proxy'] }], rules: [] },
    })
    const { edges } = buildGraph(config)
    expect(edges.map((e) => e.id)).toContain('e:bal:bal->inj:0')
    // Ребра к несуществующему узлу out:proxy быть не должно — React Flow его отбросит
    expect(edges.some((e) => e.target === 'out:proxy')).toBe(false)
  })

  it('правило соединяется с группой по предсказанному тегу', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ outboundTag: 'proxy-2' }] },
    })
    const { edges } = buildGraph(config)
    expect(edges.map((e) => e.id)).toContain('e:rule:0->inj:0')
  })

  it('статические выходы по-прежнему получают свои рёбра', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['proxy', 'direct'] }], rules: [{ outboundTag: 'direct' }] },
    })
    const { edges } = buildGraph(config)
    expect(edges.map((e) => e.id)).toContain('e:bal:bal->out:direct')
    expect(edges.map((e) => e.id)).toContain('e:rule:0->out:direct')
  })

  // Теги знает только панель — выводить связи не из чего, и выдумывать нельзя
  it('к группе с тегами от панели рёбер не выводится', () => {
    const config = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { balancers: [{ tag: 'bal', selector: ['что-угодно'] }], rules: [{ outboundTag: 'нечто' }] },
    })
    const { edges } = buildGraph(config)
    expect(edges.some((e) => e.target.startsWith('inj:'))).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/graph-inject-edges.test.ts`
Expected: FAIL — рёбер `->inj:0` нет.

- [ ] **Step 3: Реализовать**

В `buildGraph.ts` добавить `injectedTagOwners` в существующий импорт из `'../xray/inject'`
и рядом с `const outboundTags` объявить:

```ts
  // Тег может принадлежать группе подстановки: тогда ребро ведёт к её узлу,
  // а не к несуществующему out:<tag>
  const injectOwners = injectedTagOwners(config)
  const targetForTag = (tag: string): string | undefined => {
    const owner = injectOwners.get(tag)
    if (owner !== undefined) return `inj:${owner}`
    return outboundTags.has(tag) ? `out:${tag}` : undefined
  }
```

В цикле балансеров заменить формирование рёбер кандидатов на:

```ts
    const seenTargets = new Set<string>()
    for (const tag of candidates) {
      const target = targetForTag(tag)
      // Несколько предсказанных тегов одной группы дают один узел: без дедупликации
      // получились бы дубликаты id рёбер, а они ломают React Flow
      if (target === undefined || seenTargets.has(target)) continue
      seenTargets.add(target)
      edges.push({
        id: `e:bal:${bal.tag}->${target}`,
        source: `bal:${bal.tag}`,
        target,
      })
    }
```

В цикле правил заменить блок `if (rule.outboundTag && outboundTags.has(rule.outboundTag))`
(сейчас это `buildGraph.ts:115-121`) на:

```ts
    if (rule.outboundTag) {
      const target = targetForTag(rule.outboundTag)
      if (target !== undefined) {
        edges.push({
          id: `e:rule:${index}->${target}`,
          source: `rule:${index}`,
          target,
        })
      }
    }
```

Важно: сам блок построения узлов подстановки (Task 9) стоит выше по файлу, а
`injectOwners` объявляется рядом с `outboundTags` — до цикла правил. Порядок
объявлений менять не нужно.

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd frontend && npx vitest run test/graph-inject-edges.test.ts test/build-graph.test.ts test/graph-balancers.test.ts && npm run typecheck`
Expected: PASS все три файла.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/buildGraph.ts frontend/test/graph-inject-edges.test.ts
git commit -m "feat(frontend): рёбра правил и балансеров к группам подстановки"
```

---

### Task 11: Мутации групп подстановки

**Files:**
- Modify: `frontend/src/entities/graph/mutations.ts`
- Test: `frontend/test/graph-inject-mutations.test.ts`

**Interfaces:**
- Consumes: `predictedTags`, `injectedTagOwners` из Task 7.
- Produces: `addInjectGroup(config)`, `updateInjectGroup(config, index, patch)`, `removeInjectGroup(config, index)`, `setRuleInjectGroup(config, ruleIndex, groupIndex)`, `attachInjectGroupToBalancer(config, balancerTag, groupIndex)`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-inject-mutations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import {
  addInjectGroup,
  attachInjectGroupToBalancer,
  removeInjectGroup,
  setRuleInjectGroup,
  updateInjectGroup,
} from '../src/entities/graph/mutations'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

const base = parse({
  remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{}], balancers: [{ tag: 'bal', selector: [] }] },
})

describe('мутации групп подстановки', () => {
  it('добавляет группу с рабочими значениями по умолчанию', () => {
    const next = addInjectGroup(parse({ outbounds: [] }))
    expect(next.remnawave?.injectHosts).toHaveLength(1)
    expect(next.remnawave?.injectHosts?.[0]).toMatchObject({
      selector: { type: 'sameTagAsRecipient' },
      tagPrefix: 'proxy',
      selectFrom: 'HIDDEN',
    })
  })

  it('вторая группа получает неконфликтующий префикс', () => {
    const next = addInjectGroup(base)
    expect(next.remnawave?.injectHosts?.[1]?.tagPrefix).not.toBe('proxy')
  })

  it('правка группы не мутирует исходный конфиг', () => {
    const next = updateInjectGroup(base, 0, { tagPrefix: 'ru' })
    expect(next.remnawave?.injectHosts?.[0]?.tagPrefix).toBe('ru')
    expect(base.remnawave?.injectHosts?.[0]?.tagPrefix).toBe('proxy')
  })

  // Способов именования ровно один: выбор нового обязан снять прежние
  it('смена способа именования снимает парные ключи', () => {
    const next = updateInjectGroup(base, 0, { useHostTagAsTag: true })
    const group = next.remnawave?.injectHosts?.[0] as Record<string, unknown>
    expect(group.useHostTagAsTag).toBe(true)
    expect(group.tagPrefix).toBeUndefined()
    expect(group.useHostRemarkAsTag).toBeUndefined()
  })

  it('удаление вынимает группу, несуществующий индекс отдаёт тот же конфиг', () => {
    expect(removeInjectGroup(base, 0).remnawave?.injectHosts).toHaveLength(0)
    expect(removeInjectGroup(base, 5)).toBe(base)
  })

  it('правило цепляется за первый предсказанный тег группы', () => {
    const next = setRuleInjectGroup(base, 0, 0)
    expect(next.routing?.rules?.[0]?.outboundTag).toBe('proxy')
    expect(next.routing?.rules?.[0]?.balancerTag).toBeUndefined()
  })

  it('балансер цепляется за группу префиксом, а не точным тегом', () => {
    const next = attachInjectGroupToBalancer(base, 'bal', 0)
    expect(next.routing?.balancers?.[0]?.selector).toEqual(['proxy'])
  })

  it('повторное соединение ничего не дублирует', () => {
    const once = attachInjectGroupToBalancer(base, 'bal', 0)
    expect(attachInjectGroupToBalancer(once, 'bal', 0)).toBe(once)
  })

  // У группы с тегами от панели цепляться не за что: связь выразить нечем
  it('к группе с тегами от панели связь не создаётся', () => {
    const panelNamed = parse({
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      outbounds: [],
      routing: { rules: [{}], balancers: [{ tag: 'bal', selector: [] }] },
    })
    expect(setRuleInjectGroup(panelNamed, 0, 0)).toBe(panelNamed)
    expect(attachInjectGroupToBalancer(panelNamed, 'bal', 0)).toBe(panelNamed)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/graph-inject-mutations.test.ts`
Expected: FAIL — функции не экспортированы.

- [ ] **Step 3: Реализовать**

В `frontend/src/entities/graph/mutations.ts` добавить импорт
`import { predictedTags, type InjectGroup } from '../xray/inject'`
и функции в конец файла:

```ts
/**
 * Группы подстановки. Способ именования тегов ровно один из трёх, поэтому
 * правка всегда снимает парные ключи — тот же приём, что у пары
 * outboundTag/balancerTag: невыразимое состояние лучше проверяемого.
 */
const TAG_SCHEME_KEYS = ['tagPrefix', 'useHostRemarkAsTag', 'useHostTagAsTag'] as const

export function addInjectGroup(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.remnawave = next.remnawave ?? {}
  next.remnawave.injectHosts = next.remnawave.injectHosts ?? []
  const taken = new Set(
    next.remnawave.injectHosts
      .map((g) => g.tagPrefix)
      .filter((t): t is string => typeof t === 'string'),
  )
  next.remnawave.injectHosts.push({
    selector: { type: 'sameTagAsRecipient' },
    tagPrefix: uniqueTag(taken, 'proxy'),
    selectFrom: 'HIDDEN',
  })
  return next
}

export function updateInjectGroup(
  config: XrayConfig,
  index: number,
  patch: Partial<InjectGroup>,
): XrayConfig {
  if (config.remnawave?.injectHosts?.[index] === undefined) return config
  const next = clone(config)
  const group = next.remnawave!.injectHosts![index]! as Record<string, unknown>
  const touchesScheme = TAG_SCHEME_KEYS.some((k) => k in patch)
  if (touchesScheme) for (const key of TAG_SCHEME_KEYS) delete group[key]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete group[key]
    else group[key] = value
  }
  return next
}

export function removeInjectGroup(config: XrayConfig, index: number): XrayConfig {
  if (config.remnawave?.injectHosts?.[index] === undefined) return config
  const next = clone(config)
  next.remnawave!.injectHosts!.splice(index, 1)
  return next
}

/** Ребро «правило → группа»: тег берётся первый предсказанный. Непредсказуемый — тот же конфиг. */
export function setRuleInjectGroup(
  config: XrayConfig,
  ruleIndex: number,
  groupIndex: number,
): XrayConfig {
  const group = config.remnawave?.injectHosts?.[groupIndex]
  const rule = config.routing?.rules?.[ruleIndex]
  const tag = group ? predictedTags(group)[0] : undefined
  if (!rule || tag === undefined) return config
  return setRuleOutbound(config, ruleIndex, tag)
}

/**
 * Ребро «балансер → группа»: в selector уходит ПРЕФИКС, а не точный тег —
 * иначе балансер поймает только первый из подставленных хостов.
 */
export function attachInjectGroupToBalancer(
  config: XrayConfig,
  balancerTag: string,
  groupIndex: number,
): XrayConfig {
  const group = config.remnawave?.injectHosts?.[groupIndex]
  const prefix = group?.tagPrefix
  const index = (config.routing?.balancers ?? []).findIndex((b) => b.tag === balancerTag)
  if (index === -1 || typeof prefix !== 'string' || prefix === '') return config
  const balancer = config.routing!.balancers![index]!
  if ((balancer.selector ?? []).includes(prefix)) return config
  const next = clone(config)
  const target = next.routing!.balancers![index]!
  target.selector = [...(target.selector ?? []), prefix]
  return next
}
```

Если `uniqueTag` не экспортируется из модуля, использовать её как есть — она
объявлена в этом же файле выше.

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd frontend && npx vitest run test/graph-inject-mutations.test.ts test/graph-mutations.test.ts && npm run typecheck`
Expected: PASS оба файла.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/mutations.ts frontend/test/graph-inject-mutations.test.ts
git commit -m "feat(frontend): мутации групп подстановки"
```

---

### Task 12: Коммутация кабелей к группам подстановки

**Files:**
- Modify: `frontend/src/features/topology/TopologyView.tsx` (функции `isValidConnection` и `applyConnection`)
- Test: `frontend/test/topology-inject-connect.test.ts`

**Interfaces:**
- Consumes: `setRuleInjectGroup`, `attachInjectGroupToBalancer` из Task 11.
- Produces: пары `rule: → inj:` и `bal: → inj:` в `isValidConnection`; их обработка в `applyConnection`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/topology-inject-connect.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import { applyConnection, isValidConnection } from '../src/features/topology/TopologyView'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)

const config = parse({
  remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{}], balancers: [{ tag: 'bal', selector: [] }] },
})

describe('коммутация с группами подстановки', () => {
  it('правило и балансер могут вести в группу', () => {
    expect(isValidConnection({ source: 'rule:0', target: 'inj:0' })).toBe(true)
    expect(isValidConnection({ source: 'bal:bal', target: 'inj:0' })).toBe(true)
  })

  // Группа — это выход, в неё нельзя войти из входа и из неё нельзя выйти
  it('прочие пары с группой недопустимы', () => {
    expect(isValidConnection({ source: 'in:vless', target: 'inj:0' })).toBe(false)
    expect(isValidConnection({ source: 'inj:0', target: 'out:direct' })).toBe(false)
    expect(isValidConnection({ source: 'inj:0', target: 'inj:0' })).toBe(false)
  })

  it('протяжка правило → группа ставит предсказанный тег', () => {
    const next = applyConnection(config, { source: 'rule:0', target: 'inj:0' })
    expect(next.routing?.rules?.[0]?.outboundTag).toBe('proxy')
  })

  it('протяжка балансер → группа добавляет префикс в селектор', () => {
    const next = applyConnection(config, { source: 'bal:bal', target: 'inj:0' })
    expect(next.routing?.balancers?.[0]?.selector).toEqual(['proxy'])
  })

  it('недопустимая пара возвращает тот же конфиг', () => {
    expect(applyConnection(config, { source: 'inj:0', target: 'out:direct' })).toBe(config)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/topology-inject-connect.test.ts`
Expected: FAIL — `isValidConnection` возвращает false для `rule: → inj:`.

- [ ] **Step 3: Реализовать**

В `frontend/src/features/topology/TopologyView.tsx` в `isValidConnection` заменить
две строки правил:

```ts
  if (source.startsWith('rule:')) {
    return target.startsWith('out:') || target.startsWith('bal:') || target.startsWith('inj:')
  }
  if (source.startsWith('bal:')) return target.startsWith('out:') || target.startsWith('inj:')
```

В `applyConnection` добавить две ветки перед `return config`:

```ts
  if (source.startsWith('rule:') && target.startsWith('inj:')) {
    return setRuleInjectGroup(config, Number(source.slice(5)), Number(target.slice(4)))
  }
  if (source.startsWith('bal:') && target.startsWith('inj:')) {
    return attachInjectGroupToBalancer(config, source.slice(4), Number(target.slice(4)))
  }
```

Дополнить импорт из `'../../entities/graph/mutations'` именами
`attachInjectGroupToBalancer, setRuleInjectGroup`.

Обновить комментарий над `isValidConnection`, добавив предложение:
«Группы подстановки — такие же выходы, только их outbound'ы создаст панель,
поэтому вести в них можно из правил и балансеров, а выходить из них нельзя.»

- [ ] **Step 4: Проверить весь фронтенд**

Run: `cd frontend && npx vitest run && npm run typecheck`
Expected: PASS всё.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/topology/TopologyView.tsx frontend/test/topology-inject-connect.test.ts
git commit -m "feat(frontend): коммутация кабелей к группам подстановки"
```

---

### Task 13: Проверка записи на живой панели

**Files:**
- Create: `backend/smoke-templates.ts` (временный, удаляется в этой же задаче)

**Interfaces:**
- Consumes: всё из задач 1–6.
- Produces: подтверждение, что контракт из пакета совпал с поведением живой панели. Кода не оставляет.

Контракт взят из официального пакета, но `POST`, `PATCH` и `DELETE` ни разу не
выполнялись против настоящей панели. Это последний невыясненный риск плана.

- [ ] **Step 1: Убедиться, что токен панели действует**

Run: `cd backend && npx tsx --env-file=../.env -e "import('./src/config.js').then(m => { const c = m.loadConfig(); const p = JSON.parse(Buffer.from(c.remnawaveToken.split('.')[1], 'base64url').toString()); console.log('exp:', new Date(p.exp * 1000).toISOString()) })"`
Expected: дата в будущем. Если токен истёк — выпустить новый в панели и обновить `.env`.

- [ ] **Step 2: Написать временный смоук**

Создать `backend/smoke-templates.ts`:

```ts
/** Временная проверка контракта против живой панели. Удаляется после прогона. */
import bcrypt from 'bcryptjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './src/config.js'
import { buildServer } from './src/server.js'

const PASSWORD = 'smoke-password-123'
const NAME = `zz-tpl-check-${Date.now()}`
const config = {
  ...loadConfig(),
  dataDir: mkdtempSync(join(tmpdir(), 'xui-tpl-')),
  appPassword: bcrypt.hashSync(PASSWORD, 4),
}
const app = await buildServer(config)
const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD } })
const cookie = String(login.headers['set-cookie']).split(';')[0]
const H = { cookie }
const step = (n: string, ok: boolean, extra = '') => console.log(`${ok ? '  OK  ' : '  ПРОВАЛ  '}${n}${extra ? ' — ' + extra : ''}`)

let uuid = ''
try {
  const created = await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { name: NAME } })
  step('POST /api/templates', created.statusCode === 201, String(created.statusCode))
  if (created.statusCode !== 201) console.log('    тело:', created.body.slice(0, 400))
  uuid = created.json().template.uuid

  const got = await app.inject({ method: 'GET', url: `/api/templates/${uuid}`, headers: H })
  step('GET /api/templates/:uuid', got.statusCode === 200, String(got.statusCode))
  const hash = got.json().hash

  const stale = await app.inject({
    method: 'PATCH', url: `/api/templates/${uuid}`, headers: H,
    payload: { templateJson: { a: 1 }, expectedHash: 'устаревший' },
  })
  step('PATCH с чужим хэшем → 409', stale.statusCode === 409, String(stale.statusCode))

  const patched = await app.inject({
    method: 'PATCH', url: `/api/templates/${uuid}`, headers: H,
    payload: { templateJson: { ...got.json().template.templateJson, dns: { servers: ['1.1.1.1'] } }, expectedHash: hash },
  })
  step('PATCH с актуальным хэшем', patched.statusCode === 200, String(patched.statusCode))
  if (patched.statusCode !== 200) console.log('    тело:', patched.body.slice(0, 400))
  step('панель сохранила изменение', Boolean((patched.json().template.templateJson as Record<string, unknown>)?.dns))
} finally {
  if (uuid) {
    const del = await app.inject({ method: 'DELETE', url: `/api/templates/${uuid}`, headers: H })
    step('DELETE (уборка)', del.statusCode === 200, String(del.statusCode))
    const left = (await app.inject({ method: 'GET', url: '/api/templates', headers: H })).json().templates
    step('временный шаблон удалён', !left.some((t: { name: string }) => t.name === NAME))
  }
  await app.close()
}
```

- [ ] **Step 3: Прогнать**

Run: `cd backend && npx tsx --env-file=../.env smoke-templates.ts`
Expected: все строки `OK`. Любой `ПРОВАЛ` означает расхождение контракта с
реальностью — чинить нужно клиент или роут, а не подгонять смоук.

- [ ] **Step 4: Удалить временный файл**

```bash
rm backend/smoke-templates.ts
```

Файл не коммитится: он ходит в боевую панель и в репозитории ему не место.

- [ ] **Step 5: Финальная проверка и коммит**

Run из корня: `npm test && npm run typecheck -w backend && npm run typecheck -w frontend && npm run build`
Expected: всё зелёное.

```bash
git status --porcelain   # backend/smoke-templates.ts не должен появиться в выводе
git commit --allow-empty -m "chore: контракт шаблонов подтверждён на живой панели"
```

---

## Что этот план НЕ делает

Осознанно вне охвата — всё это входит в план 2:

- страницы `/templates` и `/templates/:uuid`, список и диалоги;
- вынос `useConfigDraft` и `Workbench` из `EditorPage`;
- карточка узла подстановки в `features/topology/nodes.tsx` и её стили;
- форма группы в инспекторе;
- трассировка через группы подстановки;
- e2e-сценарии;
- **разрыв рёбер, ведущих к группам подстановки.** Найдено ревью Task 12 и
  требует отдельного решения в плане 2, а не механического переиспользования
  существующего пути. Ребро «балансер → группа» задано ПРЕФИКСОМ, и нынешний
  `expandSelector` при разрыве разворачивает селектор в точные теги кандидатов.
  Для инжектируемых тегов это вредно: он вморозит в конфиг предсказанные
  `proxy`, `proxy-2`, `proxy-3`, тогда как реальное их число знает только
  панель — селектор перестанет ловить хосты, которых окажется больше. Пока
  рёбра не отрисованы и не удаляемы пользователем, вопрос не горит.

После этого плана узлы подстановки строятся и тестируются, но на холсте ещё не
отрисованы: React Flow не знает типа `inject`, пока в `nodeTypes` не появится
компонент. Это ожидаемое состояние, а не недоделка — граф проверяется юнит-тестами
на структуру узлов и рёбер.

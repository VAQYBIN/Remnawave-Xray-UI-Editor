# Редактор шаблонов подписок — план 2 (UI, форма, трассировка)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** довести редактор шаблонов подписок до рабочего состояния: страницы `/templates` и `/templates/:uuid`, карточка и форма группы подстановки, трассировка через инжектируемые выходы — на общей оболочке, вынесенной из `EditorPage`.

**Architecture:** план 1 построил бэкенд, модель `inject.ts` и граф; узлы подстановки строятся и тестируются, но на холсте не нарисованы. План 2 сначала достраивает недостающие чистые функции (резолверы, трассировка, id рёбер, защита `expandSelector`), затем **разбирает `EditorPage` на `useConfigDraft` + `Workbench`** под прикрытием существующих тестов, и только потом ставит на эту оболочку вторую страницу. Порядок из спеки соблюдён буквально: рефакторинг идёт до появления второй страницы, иначе рефакторить пришлось бы две страницы сразу и без сетки безопасности.

**Tech Stack:** Fastify 5 + Node 24 ESM (бэкенд), React 19 + Vite + React Flow v12 + zustand + TanStack Query (фронтенд), vitest, Playwright, zod 4.

**Spec:** `docs/superpowers/specs/2026-09-03-subscription-templates-design.md`

**Предыдущий план:** `docs/superpowers/plans/2026-09-03-subscription-templates-plan1-core.md` (выполнен, влит в `dev` коммитом `5294cd2`). Его раздел «Что этот план НЕ делает» — источник половины задач ниже.

## Global Constraints

- Язык UI, сообщений об ошибках, подсказок и комментариев — **русский**; коммиты — английский conventional style (`feat(frontend): ...`).
- Ответы панели **не валидируются zod'ом** — это осознанная терпимость к версиям панели. Новые типы описываются интерфейсами, а не схемами.
- Хэш содержимого шаблона считает **только бэкенд**. Клиент получает `hash` при чтении и возвращает его в `expectedHash` — своего хэша он не вычисляет.
- Имя шаблона: `/^[A-Za-z0-9_\s-]+$/`, длина 2–30. Это ограничение **самой панели** (проверено вживую на 3.4.3), расширять нельзя.
- Предсказание тегов: для схемы `panel` (`useHostRemarkAsTag`/`useHostTagAsTag`) теги **не предсказываются никогда** — функции возвращают пустое, проверки подавляются целиком.
- В топбаре шаблона **нет** кнопок «Проверить конфиг» и «+ Рецепт». «Куда пойдёт трафик» — есть.
- `Select` — кастомный listbox, не `<select>`. В тестах — `selectOption()`/`optionLabels()`/`selectedValue()` из `test/helpers.ts`, в e2e — `pickOption()` из `e2e/helpers.ts`. Лейбл связывается через `Field` с `controlId`.
- Любая замена документа целиком (undo/redo, импорт, восстановление бэкапа, принятие версии панели) обязана делать `setSelectedNode(null)`: позиционные id `rule:N` и `inj:N` дрейфуют.
- Все записи черновика идут через единственную точку `writeDraft(text, { history })`.
- Id рёбер уникальны: одинаковые id ломают React Flow.
- Пути бэкапов профилей (`DATA_DIR/backups/<uuid>/`) **не меняются** — иначе накопленные бэкапы осиротеют.

## Структура файлов

**Создаются:**

| Файл | Ответственность |
|---|---|
| `frontend/src/entities/graph/edgeIds.ts` | схема id ребра и разрешение тега в узел-цель — одно место на весь проект |
| `frontend/src/features/editor/useConfigDraft.ts` | документ: черновик, история, валидация, выбор узла, вкладки, трассировка, хоткеи |
| `frontend/src/features/editor/Workbench.tsx` | оболочка: топбар / сцена / статус-бар и общие для обеих страниц диалоги |
| `frontend/src/features/nav/SectionSwitch.tsx` | переключатель «Профили ↔ Шаблоны» в шапке обоих списков |
| `frontend/src/features/templates/TemplatesPage.tsx` | список шаблонов панели |
| `frontend/src/features/templates/CreateTemplateDialog.tsx` | создание шаблона |
| `frontend/src/features/templates/TemplateEditorPage.tsx` | редактор XRAY_JSON-шаблона |
| `frontend/src/features/inspector/InjectGroupForm.tsx` | форма группы подстановки |

**Изменяются:** `backend/src/routes/backups.ts`; `entities/graph/{mutations,locate,search,buildGraph}.ts`; `entities/xray/{trace,balancers,inject}.ts`; `features/topology/{nodes.tsx,TopologyView.tsx,SearchBox.tsx,NodeInspector.tsx}`; `features/diagnostics/TracePanel.tsx`; `features/editor/{EditorPage.tsx,VersionsDialog.tsx,draftStore.ts}`; `features/profiles/ProfilesPage.tsx`; `shared/api/{types,hooks,client}.ts`; `shared/ui/tokens.css`; `App.tsx`; `CLAUDE.md`.

## Волны

Задачи внутри волны не пересекаются по файлам и запускаются параллельно. Между волнами — строгий порядок.

| Волна | Задачи | Почему вместе |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 6 | чистые функции и бэкенд; файлы попарно не пересекаются |
| 2 | 7 → 8 → 9 | все трогают `features/editor/*` — строго по очереди |
| 3 | 10, 11, 12 | визуал / холст / форма: `tokens.css` целиком у задачи 10 |
| 4 | 13 | `App.tsx` и `ProfilesPage.tsx` |
| 5 | 14 | `App.tsx` снова |
| 6 | 15, 16 | e2e и документация |
| 7 | 17 | живая проверка записи на панели |

---

### Task 1: Роуты бэкапов шаблонов

`listTemplateBackups`/`readTemplateBackup` написаны в плане 1 и не имеют ни одного потребителя. Диалог «Версии» шаблона (задача 8) ходит именно сюда.

**Files:**
- Modify: `backend/src/routes/backups.ts`
- Test: `backend/test/backups-routes-templates.test.ts` (создать)

**Interfaces:**
- Consumes: `app.backups.listTemplateBackups(uuid)`, `app.backups.readTemplateBackup(uuid, file)` из `backend/src/backups/service.ts`.
- Produces: `GET /api/templates/:uuid/backups` → `{ backups: BackupEntry[] }`; `GET /api/templates/:uuid/backups/:file` → `{ savedAt, template }`.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/test/backups-routes-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeProfile, makeStubRemnawave, makeStubTemplate } from './stub-remnawave.js'

describe('роуты бэкапов шаблонов', () => {
  it('сохранение шаблона кладёт версию, которую видно списком и читается по имени', async () => {
    const template = makeStubTemplate({ name: 'Default' })
    const app = await buildServer(makeTestConfig(), {
      remnawave: makeStubRemnawave([], [template]),
    })
    const cookie = await loginCookie(app)

    const read = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
    })
    await app.inject({
      method: 'PATCH',
      url: `/api/templates/${template.uuid}`,
      headers: { cookie },
      payload: { templateJson: { outbounds: [] }, expectedHash: read.json().hash },
    })

    const list = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}/backups`,
      headers: { cookie },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().backups).toHaveLength(1)

    const file = list.json().backups[0].file as string
    const one = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}/backups/${file}`,
      headers: { cookie },
    })
    expect(one.statusCode).toBe(200)
    // В бэкапе лежит версия ДО правки — ради неё бэкап и делается
    expect(one.json().template.templateJson).toEqual(template.templateJson)
    await app.close()
  })

  it('бэкап профиля не виден через путь шаблона с тем же uuid', async () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    const app = await buildServer(makeTestConfig(), {
      remnawave: makeStubRemnawave([makeProfile({ uuid })], []),
    })
    const cookie = await loginCookie(app)
    await app.backups.saveBackup(makeProfile({ uuid, name: 'Профиль' }))

    const res = await app.inject({
      method: 'GET',
      url: `/api/templates/${uuid}/backups`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().backups).toEqual([])
    await app.close()
  })

  it('имя файла с обходом каталога отклоняется', async () => {
    const template = makeStubTemplate()
    const app = await buildServer(makeTestConfig(), {
      remnawave: makeStubRemnawave([], [template]),
    })
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'GET',
      url: `/api/templates/${template.uuid}/backups/..%2F..%2Fsettings.json`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
```

Если сигнатура `makeStubRemnawave` в `backend/test/stub-remnawave.ts` отличается от `(profiles, templates)` — использовать ту, что есть в файле; менять стаб не нужно.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `backend`: `npx vitest run test/backups-routes-templates.test.ts`
Expected: FAIL — 404 на `/api/templates/:uuid/backups`.

- [ ] **Step 3: Добавить роуты**

В `backend/src/routes/backups.ts`, внутрь `backupRoutes`, после существующих двух роутов:

```ts
  // Шаблоны живут в своём пространстве имён (backups/templates/<uuid>): uuid
  // профиля и шаблона могут совпасть, и общий путь вернул бы чужие версии
  app.get('/api/templates/:uuid/backups', async (req) => {
    const { uuid } = listParams.parse(req.params)
    return { backups: await app.backups.listTemplateBackups(uuid) }
  })

  app.get('/api/templates/:uuid/backups/:file', async (req) => {
    const { uuid, file } = readParams.parse(req.params)
    return await app.backups.readTemplateBackup(uuid, file)
  })
```

- [ ] **Step 4: Прогнать тесты**

Run из каталога `backend`: `npx vitest run test/backups-routes-templates.test.ts && npm test && npm run typecheck`
Expected: PASS, ни один существующий тест не сломан.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/routes/backups.ts backend/test/backups-routes-templates.test.ts
git commit -m "feat(backend): версии шаблона доступны по API"
```

---

### Task 2: Узел группы в `getNodeJson`/`applyNodeJson`/`removeNode`

Инспектор читает и пишет узел через эти три функции. Ни одна не знает про `inj:` — без этого вкладка «JSON узла» у группы будет пустой, а форма не сможет ничего применить.

**Files:**
- Modify: `frontend/src/entities/graph/mutations.ts`
- Test: `frontend/test/graph-inject-node-json.test.ts` (создать)

**Interfaces:**
- Consumes: `XrayConfig['remnawave']['injectHosts']` из `entities/xray/inject.ts`.
- Produces: `getNodeJson(config, 'inj:<i>') → InjectGroup | undefined`, `applyNodeJson(config, 'inj:<i>', value)`, `removeNode(config, 'inj:<i>')`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-inject-node-json.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyNodeJson, getNodeJson, removeNode } from '../src/entities/graph/mutations'
import type { XrayConfig } from '../src/entities/xray'

const config = (): XrayConfig =>
  ({
    remnawave: {
      injectHosts: [
        { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
        { selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true },
      ],
    },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [] },
  }) as unknown as XrayConfig

describe('узел группы подстановки в инспекторе', () => {
  it('читается целиком', () => {
    expect(getNodeJson(config(), 'inj:0')).toEqual({
      selector: { type: 'tagRegex', pattern: '^RU-' },
      tagPrefix: 'proxy',
      selectFrom: 'HIDDEN',
    })
  })

  it('несуществующий индекс даёт undefined, а не падение', () => {
    expect(getNodeJson(config(), 'inj:9')).toBeUndefined()
  })

  it('применение заменяет группу и не трогает соседнюю', () => {
    const next = applyNodeJson(config(), 'inj:0', { selector: { type: 'uuids', values: ['a'] } })
    expect(next.remnawave!.injectHosts![0]).toEqual({ selector: { type: 'uuids', values: ['a'] } })
    expect(next.remnawave!.injectHosts![1]!.useHostTagAsTag).toBe(true)
  })

  it('применение к несуществующему индексу возвращает конфиг без изменений', () => {
    const next = applyNodeJson(config(), 'inj:9', { selector: { type: 'uuids' } })
    expect(next.remnawave!.injectHosts).toHaveLength(2)
  })

  it('удаление вырезает группу и сдвигает индексы', () => {
    const next = removeNode(config(), 'inj:0')
    expect(next.remnawave!.injectHosts).toHaveLength(1)
    expect(next.remnawave!.injectHosts![0]!.useHostTagAsTag).toBe(true)
  })

  it('исходный конфиг не мутируется', () => {
    const before = config()
    applyNodeJson(before, 'inj:0', { selector: { type: 'uuids' } })
    removeNode(before, 'inj:0')
    expect(before.remnawave!.injectHosts).toHaveLength(2)
    expect(before.remnawave!.injectHosts![0]!.tagPrefix).toBe('proxy')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/graph-inject-node-json.test.ts`
Expected: FAIL — `getNodeJson` возвращает `undefined` для `inj:0`.

- [ ] **Step 3: Добавить ветки**

В `frontend/src/entities/graph/mutations.ts`, в `getNodeJson`, перед `if (nodeId === 'obs')`:

```ts
  if (nodeId.startsWith('inj:')) {
    return config.remnawave?.injectHosts?.[Number(nodeId.slice(4))]
  }
```

В `applyNodeJson`, перед веткой `obs` (или перед финальным `return next`):

```ts
  if (nodeId.startsWith('inj:')) {
    const i = Number(nodeId.slice(4))
    const groups = next.remnawave?.injectHosts
    if (groups?.[i] !== undefined) groups[i] = value as NonNullable<typeof groups>[number]
    return next
  }
```

В `removeNode`, там же:

```ts
  if (nodeId.startsWith('inj:')) {
    // Ссылки на предсказанные теги в правилах и селекторах остаются висеть —
    // ровно как при удалении обычного outbound'а. Их ловит валидация, а не
    // молчаливая чистка: удалить чужое правило пользователь не просил.
    next.remnawave?.injectHosts?.splice(Number(nodeId.slice(4)), 1)
    return next
  }
```

- [ ] **Step 4: Прогнать тесты**

Run из каталога `frontend`: `npx vitest run test/graph-inject-node-json.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/mutations.ts frontend/test/graph-inject-node-json.test.ts
git commit -m "feat(frontend): инспектор читает и правит группу подстановки"
```

---

### Task 3: Резолверы `locate` и `search` знают про группы

Спека обещала, что три резолвера получат новые диагностики бесплатно. Бесплатно вышло только у `jsonLocate` — он обходит дерево обобщённо. Без веток ниже клик по проблеме подстановки на вкладке топологии никуда не ведёт, а на узле нет счётчика.

**Files:**
- Modify: `frontend/src/entities/graph/locate.ts`
- Modify: `frontend/src/entities/graph/search.ts`
- Modify: `frontend/src/features/topology/SearchBox.tsx` (одна строка: подпись нового вида)
- Test: `frontend/test/graph-inject-locate.test.ts` (создать)

**Interfaces:**
- Consumes: `injectGroupsOf`, `describeSelector`, `predictedTags` из `entities/xray/inject.ts`.
- Produces: `nodeIdForPath(['remnawave','injectHosts',i], config) → 'inj:<i>'`; `SearchHit['kind']` пополняется значением `'inject'`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-inject-locate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { issueCountsByNode, nodeIdForPath } from '../src/entities/graph/locate'
import { searchNodes } from '../src/entities/graph/search'
import type { ValidationIssue, XrayConfig } from '../src/entities/xray'

const config = (): XrayConfig =>
  ({
    remnawave: {
      injectHosts: [
        { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
      ],
    },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [] },
  }) as unknown as XrayConfig

const issue = (parts: ValidationIssue['parts']): ValidationIssue =>
  ({ level: 'error', parts, path: '', message: 'тест' }) as ValidationIssue

describe('переход к группе подстановки', () => {
  it('путь диагностики ведёт к узлу группы', () => {
    expect(nodeIdForPath(['remnawave', 'injectHosts', 0], config())).toBe('inj:0')
    expect(nodeIdForPath(['remnawave', 'injectHosts', 0, 'selector'], config())).toBe('inj:0')
  })

  it('несуществующая группа не даёт узла', () => {
    expect(nodeIdForPath(['remnawave', 'injectHosts', 3], config())).toBeNull()
  })

  // Предупреждение «нет ни одной группы» садится на секцию: узла ещё нет
  it('путь без индекса узла не даёт', () => {
    expect(nodeIdForPath(['remnawave', 'injectHosts'], config())).toBeNull()
  })

  it('счётчик проблем садится на узел группы', () => {
    const counts = issueCountsByNode([issue(['remnawave', 'injectHosts', 0, 'selector'])], config())
    expect(counts['inj:0']).toEqual({ errors: 1, warnings: 0 })
  })
})

describe('поиск по группам подстановки', () => {
  it('находит по предсказанному тегу', () => {
    const hits = searchNodes(config(), {}, 'proxy-2')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ nodeId: 'inj:0', kind: 'inject' })
  })

  it('находит по подписи селектора', () => {
    expect(searchNodes(config(), {}, '^RU-')[0]?.nodeId).toBe('inj:0')
  })

  it('чужая строка не находит ничего', () => {
    expect(searchNodes(config(), {}, 'zzz')).toEqual([])
  })
})
```

Если поля `ValidationIssue` отличаются — сверить с `entities/xray/config.ts` и поправить конструктор `issue` по факту.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/graph-inject-locate.test.ts`
Expected: FAIL — `nodeIdForPath` возвращает `null`.

- [ ] **Step 3: Добавить ветку в `locate.ts`**

В `frontend/src/entities/graph/locate.ts`, в `nodeIdForPath`, перед веткой `observatory`:

```ts
  // Группы подстановки адресуются позиционно, как правила: путь диагностики
  // приходит из валидации в виде ['remnawave', 'injectHosts', i, ...]
  if (head === 'remnawave' && second === 'injectHosts' && typeof third === 'number') {
    return config.remnawave?.injectHosts?.[third] ? `inj:${third}` : null
  }
```

- [ ] **Step 4: Добавить группы в `search.ts`**

В шапке файла:

```ts
import { describeSelector, injectGroupsOf, predictedTags } from '../xray/inject'
```

В `SearchHit`:

```ts
  kind: 'inbound' | 'outbound' | 'rule' | 'squad' | 'dns' | 'balancer' | 'inject'
```

В `searchNodes`, сразу после прохода по `config.outbounds` (группы стоят в колонке выходов):

```ts
  injectGroupsOf(config).forEach((group, index) => {
    const matched = firstMatch(needle, [
      { label: 'селектор', value: describeSelector(group) },
      { label: 'префикс тегов', value: group.tagPrefix },
      // Предсказанные теги ищутся наравне с настоящими: пользователь помнит
      // proxy-2 из правила и не обязан знать, что физически его в конфиге нет
      { label: 'тег', value: predictedTags(group) },
      { label: 'пул', value: group.selectFrom },
    ])
    if (matched) {
      push({
        nodeId: `inj:${index}`,
        kind: 'inject',
        title: `подстановка ${index + 1}`,
        matchedOn: matched,
      })
    }
  })
```

- [ ] **Step 5: Дописать подпись вида в `SearchBox`**

В `frontend/src/features/topology/SearchBox.tsx`, в `KIND_LABEL` (иначе `Record<SearchHit['kind'], string>` перестанет быть полным и typecheck упадёт):

```ts
  inject: 'подстановка',
```

- [ ] **Step 6: Прогнать тесты**

Run из каталога `frontend`: `npx vitest run test/graph-inject-locate.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/entities/graph/locate.ts frontend/src/entities/graph/search.ts frontend/src/features/topology/SearchBox.tsx frontend/test/graph-inject-locate.test.ts
git commit -m "feat(frontend): переход и поиск по группам подстановки"
```

---

### Task 4: Трассировка через группы подстановки

Самое ценное здесь — дефолтный маршрут. Панель вставляет свои outbound'ы **в начало массива**, поэтому в шаблоне подписки «ни одно правило не совпало» означает не `direct`, а первый подставленный сервер. Сейчас трассировщик уверенно называет `direct` — и врёт.

**Files:**
- Modify: `frontend/src/entities/xray/trace.ts`
- Test: `frontend/test/xray-trace-inject.test.ts` (создать)

**Interfaces:**
- Consumes: `injectGroupsOf`, `injectedTagOwners`, `predictedTags`, `describeSelector`, `hasPanelNamedTags` из `./inject`.
- Produces: `export interface InjectedOutbound { groupIndex: number; selector: string; selectFrom?: string }`; `TraceWinner` пополняется полями `injected?: InjectedOutbound` и `injectedTags?: string[]`. Их читает `TracePanel` (задача 10).

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-trace-inject.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { traceRoute, type GeoAnswers, type XrayConfig } from '../src/entities/xray'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const target = { address: 'example.com', network: 'tcp' } as const

const template = (extra: Record<string, unknown> = {}): XrayConfig =>
  ({
    remnawave: {
      injectHosts: [
        { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
      ],
    },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [] },
    ...extra,
  }) as unknown as XrayConfig

describe('трассировка шаблона подписки', () => {
  it('дефолтный маршрут уходит в подстановку, а не в первый статический выход', () => {
    const res = traceRoute(template(), target, NO_GEO)
    expect(res.winner?.ruleIndex).toBeNull()
    expect(res.winner?.injected).toMatchObject({ groupIndex: 0, selectFrom: 'HIDDEN' })
    expect(res.winner?.outboundTag).toBe('proxy')
    expect(res.caveats.join(' ')).toContain('в начало массива')
  })

  it('без групп подстановки дефолт прежний — первый статический выход', () => {
    const config = {
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [] },
    } as unknown as XrayConfig
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: null, outboundTag: 'direct', balancerTag: undefined })
  })

  it('победившее правило с предсказанным тегом помечается как подстановка', () => {
    const config = template({
      routing: { rules: [{ type: 'field', domain: ['example.com'], outboundTag: 'proxy-2' }] },
    })
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner?.ruleIndex).toBe(0)
    expect(res.winner?.injected?.groupIndex).toBe(0)
    expect(res.caveats.join(' ')).toContain('подставит панель')
  })

  it('правило со статическим тегом подстановкой не помечается', () => {
    const config = template({
      routing: { rules: [{ type: 'field', domain: ['example.com'], outboundTag: 'direct' }] },
    })
    expect(traceRoute(config, target, NO_GEO).winner?.injected).toBeUndefined()
  })

  it('кандидаты балансера, которых подставит панель, названы отдельно', () => {
    const config = template({
      routing: {
        rules: [{ type: 'field', domain: ['example.com'], balancerTag: 'bal' }],
        balancers: [{ tag: 'bal', selector: ['proxy'] }],
      },
    })
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner?.injectedTags).toEqual(['proxy', 'proxy-2', 'proxy-3'])
    expect(res.caveats.join(' ')).toContain('знает только панель')
  })

  it('теги из примечаний хостов: маршрут не выдумывается', () => {
    const config = {
      remnawave: {
        injectHosts: [{ selector: { type: 'tagRegex', pattern: '^RU-' }, useHostRemarkAsTag: true }],
      },
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [] },
    } as unknown as XrayConfig
    const res = traceRoute(config, target, NO_GEO)
    expect(res.winner?.outboundTag).toBeUndefined()
    expect(res.winner?.injected?.groupIndex).toBe(0)
    expect(res.caveats.join(' ')).toContain('предсказать')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/xray-trace-inject.test.ts`
Expected: FAIL — `winner.injected` отсутствует, дефолт уходит в `direct`.

- [ ] **Step 3: Расширить тип победителя**

В `frontend/src/entities/xray/trace.ts`, рядом с `TraceWinner`:

```ts
/** Выход, которого в конфиге физически нет: его подставит панель по группе */
export interface InjectedOutbound {
  groupIndex: number
  /** Подпись селектора для человека: describeSelector(group) */
  selector: string
  selectFrom?: string
}
```

и в самом `TraceWinner` — два поля:

```ts
  /** Выход победителя подставит панель */
  injected?: InjectedOutbound
  /** Кандидаты балансера, которых подставит панель (подмножество balancerCandidates) */
  injectedTags?: string[]
```

- [ ] **Step 4: Разрешать тег в группу и починить дефолт**

Импорт в шапке `trace.ts`:

```ts
import {
  describeSelector,
  hasPanelNamedTags,
  injectedTagOwners,
  injectGroupsOf,
  predictedTags,
} from './inject'
```

Рядом с `withBalancer` добавить:

```ts
/** Помечает победителя, чей выход или кандидаты придут из подстановки */
function withInject(winner: TraceWinner, config: XrayConfig): TraceWinner {
  const groups = injectGroupsOf(config)
  if (groups.length === 0) return winner
  const owners = injectedTagOwners(config)
  const next = { ...winner }
  const owner = winner.outboundTag !== undefined ? owners.get(winner.outboundTag) : undefined
  if (owner !== undefined) {
    next.injected = {
      groupIndex: owner,
      selector: describeSelector(groups[owner]!),
      selectFrom: groups[owner]!.selectFrom,
    }
  }
  const injectedCandidates = (winner.balancerCandidates ?? []).filter((t) => owners.has(t))
  if (injectedCandidates.length > 0) next.injectedTags = injectedCandidates
  return next
}
```

Ветку совпавшего правила в `pickWinner` обернуть:

```ts
  if (hit) {
    return withInject(
      withBalancer(
        { ruleIndex: hit.index, outboundTag: hit.outboundTag, balancerTag: hit.balancerTag },
        config,
      ),
      config,
    )
  }
```

и заменить ветку дефолта:

```ts
  // Панель вставляет инжектируемые outbound'ы в НАЧАЛО массива, поэтому в шаблоне
  // подписки дефолтом становится первый подставленный сервер, а не outbounds[0].
  // Для схемы `panel` тег неизвестен — оставляем его пустым, но группу называем.
  const groups = injectGroupsOf(config)
  if (groups.length > 0) {
    const first = groups[0]!
    return withInject(
      { ruleIndex: null, outboundTag: predictedTags(first)[0], balancerTag: undefined },
      config,
    )
  }
  const fallback = config.outbounds?.[0]?.tag
  if (fallback === undefined) return undefined
  return { ruleIndex: null, outboundTag: fallback, balancerTag: undefined }
```

- [ ] **Step 5: Дописать оговорки**

В `collectCaveats`, перед блоком про балансер:

```ts
  const groups = injectGroupsOf(config)
  if (groups.length > 0 && winner?.ruleIndex === null) {
    caveats.push(
      'Ни одно правило не совпало. В шаблоне подписки дефолтом становится не первый outbound из документа: панель вставляет подставленные серверы в начало массива, и трафик уйдёт в первый из них.',
    )
  }
  if (winner?.injected) {
    caveats.push(
      `Выход подставит панель по группе «${winner.injected.selector}» (пул ${winner.injected.selectFrom ?? 'HIDDEN'}) — в самом документе такого outbound'а нет.`,
    )
  }
  if (winner?.injectedTags?.length) {
    caveats.push(
      `Кандидаты ${winner.injectedTags.join(', ')} предсказаны по префиксу: сколько серверов подставится на самом деле, знает только панель.`,
    )
  }
  if (groups.length > 0 && hasPanelNamedTags(config)) {
    caveats.push(
      'Часть групп именует выходы по примечанию или тегу хоста — такие теги предсказать нельзя, и связи по ним показаны не полностью.',
    )
  }
```

- [ ] **Step 6: Прогнать тесты**

Run из каталога `frontend`: `npx vitest run test/xray-trace-inject.test.ts && npm test && npm run typecheck`
Expected: PASS. Особое внимание существующим тестам трассировки профилей: без секции `remnawave` поведение обязано остаться прежним.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/entities/xray/trace.ts frontend/test/xray-trace-inject.test.ts
git commit -m "feat(frontend): трассировка честно показывает подстановку панели"
```

---

### Task 5: Общий хелпер id рёбер

Схема `e:<источник>-><цель>` независимо построена в `buildGraph.ts` (рисует рёбра) и в `tracedEdgeIds` внутри `TopologyView.tsx` (подсвечивает путь), а разбирает её `disconnectEdge`. Для инжектируемых тегов первые две уже разошлись: граф ведёт ребро в `inj:<index>`, подсветка — в несуществующий `out:<tag>`, и путь трассы обрывается.

**Files:**
- Create: `frontend/src/entities/graph/edgeIds.ts`
- Modify: `frontend/src/entities/graph/buildGraph.ts`
- Test: `frontend/test/graph-edge-ids.test.ts` (создать)

**Interfaces:**
- Produces: `edgeId(source, target): string`, `fallbackEdgeId(balancerTag, outboundTag): string`, `outboundTargets(config): (tag: string) => string | undefined`. Последнюю в задаче 11 использует `tracedEdgeIds`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-edge-ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildGraph } from '../src/entities/graph/buildGraph'
import { edgeId, fallbackEdgeId, outboundTargets } from '../src/entities/graph/edgeIds'
import type { XrayConfig } from '../src/entities/xray'

const config = (): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [{ type: 'field', outboundTag: 'proxy-2' }] },
  }) as unknown as XrayConfig

describe('id рёбер', () => {
  it('собирается по одной схеме', () => {
    expect(edgeId('rule:0', 'out:direct')).toBe('e:rule:0->out:direct')
    expect(fallbackEdgeId('bal', 'direct')).toBe('e:bal:bal->fb:direct')
  })

  it('тег группы разрешается в её узел, статический — в узел выхода', () => {
    const target = outboundTargets(config())
    expect(target('proxy-2')).toBe('inj:0')
    expect(target('direct')).toBe('out:direct')
    expect(target('нет-такого')).toBeUndefined()
  })

  // Ровно та рассинхронизация, ради которой хелпер и заводится
  it('граф строит ребро правила с тем же id, что даёт хелпер', () => {
    const { edges } = buildGraph(config())
    const target = outboundTargets(config())
    expect(edges.map((e) => e.id)).toContain(edgeId('rule:0', target('proxy-2')!))
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/graph-edge-ids.test.ts`
Expected: FAIL — модуля `edgeIds` нет.

- [ ] **Step 3: Написать модуль**

Создать `frontend/src/entities/graph/edgeIds.ts`:

```ts
// Схема id ребра — `e:<источник>-><цель>`. Живёт в одном месте, потому что её
// независимо строят buildGraph (рисует рёбра) и tracedEdgeIds (подсвечивает
// победивший путь), а разбирает disconnectEdge. Для инжектируемых тегов они
// уже разошлись: граф вёл ребро в inj:<index>, подсветка — в out:<tag>.

import type { XrayConfig } from '../xray'
import { injectedTagOwners } from '../xray/inject'

export function edgeId(source: string, target: string): string {
  return `e:${source}->${target}`
}

/**
 * Запасной выход балансера. Свой префикс цели нужен потому, что один и тот же
 * тег бывает и кандидатом, и fallback'ом, а два ребра с одним id ломают React Flow.
 */
export function fallbackEdgeId(balancerTag: string, outboundTag: string): string {
  return edgeId(`bal:${balancerTag}`, `fb:${outboundTag}`)
}

/**
 * Разрешение тега outbound'а в узел-цель. Возвращает функцию, а не значение:
 * карта владельцев тегов строится один раз на конфиг, а зовут её на каждое ребро.
 * Тег группы подстановки ведёт к её узлу — статического out:<tag> для него нет.
 */
export function outboundTargets(config: XrayConfig): (tag: string) => string | undefined {
  const owners = injectedTagOwners(config)
  const statics = new Set((config.outbounds ?? []).map((o) => o.tag))
  return (tag) => {
    const owner = owners.get(tag)
    if (owner !== undefined) return `inj:${owner}`
    return statics.has(tag) ? `out:${tag}` : undefined
  }
}
```

- [ ] **Step 4: Перевести `buildGraph` на хелпер**

В `frontend/src/entities/graph/buildGraph.ts`:
- добавить `import { edgeId, fallbackEdgeId, outboundTargets } from './edgeIds'`;
- заменить локальное определение `targetForTag` на `const targetForTag = outboundTargets(config)`; строки с `injectOwners` уходят, а импорт `injectedTagOwners` из `../xray/inject` убрать, если он больше не нужен;
- заменить шаблонные строки id рёбер вызовами: `edgeId('squad:' + uuid, 'in:' + inb.tag)`, `edgeId('in:' + tag, 'rule:' + index)`, `edgeId('rule:' + index, target)`, `edgeId('bal:' + bal.tag, target)`, `edgeId('rule:' + index, 'bal:' + rule.balancerTag)`, `edgeId('obs', 'bal:' + bal.tag)`, а для запасного выхода — `fallbackEdgeId(bal.tag, bal.fallbackTag)`.

Значения id не меняются ни на символ — это чистая замена конкатенации вызовом.

- [ ] **Step 5: Прогнать тесты**

Run из каталога `frontend`: `npx vitest run test/graph-edge-ids.test.ts && npm test && npm run typecheck`
Expected: PASS, включая все существующие тесты графа — id обязаны остаться прежними.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/graph/edgeIds.ts frontend/src/entities/graph/buildGraph.ts frontend/test/graph-edge-ids.test.ts
git commit -m "refactor(frontend): схема id рёбер в одном месте"
```

---

### Task 6: `expandSelector` не вмораживает предсказанные теги

Найдено ревью задачи 12 плана 1. `balancerCandidates` теперь включает инжектируемые теги, поэтому разворот префикса запишет в селектор `proxy`, `proxy-2`, `proxy-3` — ровно три, тогда как реальное их число знает только панель. Селектор перестанет ловить остальных. Опасна сама функция, а не только рёбра к группам: разрыв ребра «балансер → обычный выход» у балансера, чей селектор попутно ловит префикс группы, ломает то же самое.

**Files:**
- Modify: `frontend/src/entities/xray/balancers.ts`
- Test: `frontend/test/xray-expand-selector.test.ts` (создать; если файл с таким именем уже есть — дописать `describe` в него)

**Interfaces:**
- Produces: `expandSelector` сохраняет прежнюю сигнатуру `(config, balancerTag, dropTag) => XrayConfig`; добавляется `blockingInjectPrefix(config, balancerTag, dropTag): string | undefined`. Её зовёт `TopologyView` (задача 11), чтобы выбрать текст диалога.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/xray-expand-selector.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { blockingInjectPrefix, expandSelector, type XrayConfig } from '../src/entities/xray'

const withGroups = (selector: string[], outbounds: string[]): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    outbounds: outbounds.map((tag) => ({ tag, protocol: 'freedom' })),
    routing: { balancers: [{ tag: 'bal', selector }], rules: [] },
  }) as unknown as XrayConfig

describe('разворот префикса селектора', () => {
  it('без групп подстановки разворачивает как раньше', () => {
    const config = {
      outbounds: [{ tag: 'eu-1' }, { tag: 'eu-2' }, { tag: 'direct' }],
      routing: { balancers: [{ tag: 'bal', selector: ['eu-'] }], rules: [] },
    } as unknown as XrayConfig
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-1'])
  })

  // Главное: предсказанных proxy/proxy-2/proxy-3 в селекторе появиться не должно
  it('префикс группы сохраняется как префикс', () => {
    const config = withGroups(['proxy', 'eu-'], ['eu-1', 'eu-2'])
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy', 'eu-1'])
  })

  it('выход, который ловит тот же префикс, убрать нельзя — конфиг не меняется', () => {
    const config = withGroups(['proxy'], ['proxy-eu'])
    expect(blockingInjectPrefix(config, 'bal', 'proxy-eu')).toBe('proxy')
    expect(expandSelector(config, 'bal', 'proxy-eu')).toBe(config)
  })

  it('обычный разрыв блокировкой не считается', () => {
    const config = withGroups(['proxy', 'eu-'], ['eu-1', 'eu-2'])
    expect(blockingInjectPrefix(config, 'bal', 'eu-2')).toBeUndefined()
  })

  it('неизвестный балансер возвращает тот же конфиг', () => {
    const config = withGroups(['proxy'], ['eu-1'])
    expect(expandSelector(config, 'нет-такого', 'eu-1')).toBe(config)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/xray-expand-selector.test.ts`
Expected: FAIL — `blockingInjectPrefix` не экспортируется, а `expandSelector` пишет в селектор `proxy, proxy-2, proxy-3`.

- [ ] **Step 3: Переписать `expandSelector`**

В `frontend/src/entities/xray/balancers.ts` заменить функцию (импорт `injectedTagsOf` из `./inject` там уже есть):

```ts
/**
 * Префиксы селектора, которые ловят инжектируемые теги. Разворачивать их нельзя:
 * число подставленных хостов знает только панель, а разворот вморозил бы ровно
 * три предсказанных тега — и селектор перестал бы ловить остальных.
 */
function injectPrefixes(config: XrayConfig, selector: string[]): string[] {
  const injected = injectedTagsOf(config)
  return selector.filter((prefix) => injected.some((tag) => tag.startsWith(prefix)))
}

/**
 * Префикс, который ловит и dropTag, и группу подстановки. Пока он в селекторе,
 * убрать dropTag нечем: сохраним префикс — выход вернётся, развернём — сломается
 * группа. Возвращает такой префикс, если он есть; иначе undefined.
 */
export function blockingInjectPrefix(
  config: XrayConfig,
  balancerTag: string,
  dropTag: string,
): string | undefined {
  const balancer = findBalancer(config, balancerTag)
  if (!balancer) return undefined
  return injectPrefixes(config, balancer.selector ?? []).find((p) => dropTag.startsWith(p))
}

/**
 * Разворачивает selector в точные теги текущих СТАТИЧЕСКИХ кандидатов, выбрасывая
 * dropTag. Префиксы групп подстановки переносятся как есть. Неизвестный балансер
 * и неразрешимый конфликт префикса — ТОТ ЖЕ конфиг.
 */
export function expandSelector(
  config: XrayConfig,
  balancerTag: string,
  dropTag: string,
): XrayConfig {
  const index = (config.routing?.balancers ?? []).findIndex((b) => b.tag === balancerTag)
  if (index === -1) return config
  if (blockingInjectPrefix(config, balancerTag, dropTag) !== undefined) return config
  const selector = config.routing!.balancers![index]!.selector ?? []
  const kept = injectPrefixes(config, selector)
  const statics = (config.outbounds ?? []).map((o) => o.tag)
  const expanded = matchPrefixes(
    statics,
    selector.filter((p) => !kept.includes(p)),
  ).filter((t) => t !== dropTag)
  const next = structuredClone(config)
  next.routing!.balancers![index]!.selector = [...kept, ...expanded]
  return next
}
```

- [ ] **Step 4: Прогнать тесты**

Run из каталога `frontend`: `npx vitest run test/xray-expand-selector.test.ts && npm test && npm run typecheck`
Expected: PASS. Существующие тесты разворота префикса на конфигах без `remnawave` обязаны пройти без правок — там `kept` пуст и поведение прежнее.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/balancers.ts frontend/test/xray-expand-selector.test.ts
git commit -m "fix(frontend): разворот префикса не вмораживает предсказанные теги"
```

---

### Task 7: Вынести документ в `useConfigDraft`

Первая половина рефакторинга из спеки. `EditorPage` — 709 строк, из которых документ (черновик, история, валидация, выбор узла, вкладки, трассировка, хоткеи) не имеет ни одного профильного признака и целиком переиспользуется шаблоном. **Поведение не меняется ни в чём** — существующие тесты редактора и e2e служат сеткой безопасности и обязаны пройти без правок, кроме перечисленных ниже переездов импортов.

**Files:**
- Create: `frontend/src/features/editor/useConfigDraft.ts`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Modify: `frontend/src/features/editor/draftStore.ts` (переименование поля + миграция persist)
- Modify: `frontend/test/editor-logic.test.ts` (переезд импортов)
- Modify: `frontend/test/draft-store.test.ts` (новое имя поля)
- Test: `frontend/test/draft-store-migrate.test.ts` (создать)

**Interfaces:**
- Consumes: `validateXrayConfig`, `traceRoute`, `geoKeysOf` из `entities/xray`; `issueCountsByNode`/`nodeIdForPath` из `entities/graph/locate`; `searchNodes` из `entities/graph/search`; `applyNodeJson`/`getNodeJson`/`moveRule`/`removeNode`/`appendGeoKey` из `entities/graph/mutations`; `ensureObservatorySection` из `entities/xray`; `useGeoMatch` из `shared/api`.
- Produces: `useConfigDraft(options): ConfigDraft` и типы `ConfigDraftOptions`/`ConfigDraft`. Их потребляют `Workbench` (задача 9), `EditorPage` и `TemplateEditorPage` (задача 14). Чистые функции `formatConfig`, `resolveEditorText`, `nextSelection`, `moveSelectedRule`, `escapeTarget`, `renamedNodeId`, `traceOf` **переезжают сюда** из `EditorPage`; `toGraphContext` остаётся в `EditorPage` — это профильная склейка сквадов с inbound'ами.

- [ ] **Step 1: Переименовать базу черновика и написать тест миграции**

В `frontend/src/features/editor/draftStore.ts` переименовать поле и добавить версию хранилища:

```ts
export interface Draft {
  text: string
  /** Версия панели, от которой отсчитан черновик: updatedAt профиля либо хэш шаблона */
  baseVersion: string
  savedAt: string
}

interface DraftState {
  drafts: Record<string, Draft>
  setDraft: (uuid: string, text: string, baseVersion: string) => void
  clearDraft: (uuid: string) => void
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (uuid, text, baseVersion) =>
        set((s) => ({
          drafts: {
            ...s.drafts,
            [uuid]: { text, baseVersion, savedAt: new Date().toISOString() },
          },
        })),
      clearDraft: (uuid) =>
        set((s) => {
          const { [uuid]: _removed, ...rest } = s.drafts
          return { drafts: rest }
        }),
    }),
    {
      name: 'xui-drafts',
      version: 1,
      // v0 звал это поле baseUpdatedAt. У шаблонов подписки updatedAt нет —
      // базой служит хэш содержимого, и имя перестало быть правдой. Без миграции
      // уже сохранённые черновики ушли бы в панель с undefined и получили 400.
      migrate: (state, version) => {
        if (version >= 1) return state as DraftState
        const old = state as {
          drafts?: Record<string, { text: string; baseUpdatedAt?: string; savedAt: string }>
        }
        const drafts: Record<string, Draft> = {}
        for (const [uuid, d] of Object.entries(old.drafts ?? {})) {
          drafts[uuid] = { text: d.text, baseVersion: d.baseUpdatedAt ?? '', savedAt: d.savedAt }
        }
        return { ...(state as DraftState), drafts }
      },
    },
  ),
)
```

Создать `frontend/test/draft-store-migrate.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'

describe('миграция черновиков', () => {
  beforeEach(() => {
    localStorage.clear()
    // Модуль читает localStorage при первом импорте — сбрасываем кэш модулей
    return void 0
  })

  it('старый черновик с baseUpdatedAt читается как baseVersion', async () => {
    localStorage.setItem(
      'xui-drafts',
      JSON.stringify({
        state: {
          drafts: { 'u-1': { text: '{}', baseUpdatedAt: '2026-07-20T10:00:00Z', savedAt: 's' } },
        },
        version: 0,
      }),
    )
    const mod = await import('../src/features/editor/draftStore?migrate-v0')
    const { useDraftStore } = mod as typeof import('../src/features/editor/draftStore')
    expect(useDraftStore.getState().drafts['u-1']?.baseVersion).toBe('2026-07-20T10:00:00Z')
  })
})
```

Если приём с суффиксом запроса в импорте в этом проекте не работает, заменить его на `vi.resetModules()` + обычный динамический импорт — важно, чтобы стор читал подложенный localStorage при инициализации, а не переиспользовал уже созданный.

- [ ] **Step 2: Прогнать тест миграции и починить существующие**

Run из каталога `frontend`: `npx vitest run test/draft-store-migrate.test.ts test/draft-store.test.ts`
Expected: тест миграции PASS; `test/draft-store.test.ts` падает на `baseUpdatedAt` — заменить в нём имя поля на `baseVersion`.

- [ ] **Step 3: Создать хук**

Создать `frontend/src/features/editor/useConfigDraft.ts`:

```ts
// Документ, который правит редактор: черновик в localStorage, история, валидация,
// выбор узла, вкладки, поиск и трассировка. Профильного здесь нет ничего — тот же
// хук обслуживает шаблон подписки. Страница добавляет к нему только своё
// сохранение и свои кнопки топбара.

import { useMemo, useRef, useState } from 'react'
import {
  ensureObservatorySection,
  geoKeysOf,
  traceRoute,
  validateXrayConfig,
  type GeoAnswers,
  type PathParts,
  type TraceResult,
  type TraceTarget,
  type ValidationIssue,
  type XrayConfig,
} from '../../entities/xray'
import { issueCountsByNode, nodeIdForPath } from '../../entities/graph/locate'
import { searchNodes, type SearchHit } from '../../entities/graph/search'
import {
  appendGeoKey,
  applyNodeJson,
  getNodeJson,
  moveRule,
  removeNode,
} from '../../entities/graph/mutations'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import { useGeoMatch } from '../../shared/api'
import { useDebounced } from '../../shared/lib/useDebounced'
import { hasOpenDialog, useHotkeys } from '../../shared/lib/useHotkeys'
import { useDraftStore, type Draft } from './draftStore'
import { canRedo, canUndo, useHistoryStore } from './historyStore'

export function formatConfig(config: unknown): string {
  return JSON.stringify(config, null, 2)
}

export function resolveEditorText(draft: Draft | undefined, panelConfig: unknown): string {
  return draft ? draft.text : formatConfig(panelConfig)
}

export function nextSelection(
  selected: string | null,
  prev: XrayConfig,
  next: XrayConfig,
): string | null {
  if (!selected) return null
  if (getNodeJson(next, selected) === undefined) return null
  // rule- и inj-узлы адресуются позиционно: при изменении их числа id укажет на
  // соседа — сбрасываем выбор
  if (selected.startsWith('rule:')) {
    const prevLen = prev.routing?.rules?.length ?? 0
    const nextLen = next.routing?.rules?.length ?? 0
    if (prevLen !== nextLen) return null
  }
  if (selected.startsWith('inj:')) {
    const prevLen = prev.remnawave?.injectHosts?.length ?? 0
    const nextLen = next.remnawave?.injectHosts?.length ?? 0
    if (prevLen !== nextLen) return null
  }
  return selected
}

// Пока ответ базы не пришёл (или базы нет), трассировщик честно считает
// geosite:/geoip: неизвестными и говорит об этом в caveats.
const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }

/**
 * Пауза, после которой строка трассировки считается введённой. 600 мс: доменное
 * имя к этому моменту дописано, а ощущения «подвисло» ещё нет.
 */
const TRACE_DEBOUNCE_MS = 600

export function traceOf(
  config: XrayConfig | undefined,
  target: TraceTarget | null,
  geo: GeoAnswers | undefined,
): TraceResult | undefined {
  if (!config || !target) return undefined
  return traceRoute(config, target, geo ?? NO_GEO)
}

// Перестановка выбранного правила: конфиг меняется, а позиционный id выбора
// должен «переехать» вместе с правилом — иначе rule:N укажет на соседа
export function moveSelectedRule(
  config: XrayConfig,
  selected: string | null,
  dir: -1 | 1,
): { config: XrayConfig; selected: string } | null {
  if (!selected || !selected.startsWith('rule:')) return null
  const from = Number(selected.slice(5))
  const next = moveRule(config, from, dir)
  if (next === config) return null
  return { config: next, selected: `rule:${from + dir}` }
}

/**
 * Что закрывает Escape. Порядок — от самого «верхнего» слоя к нижнему: сначала
 * инспектор узла, потом панель разбора трассы, потом результаты поиска.
 */
export function escapeTarget(state: {
  selectedNode: string | null
  traceTarget: TraceTarget | null
  searchQuery: string
}): 'inspector' | 'trace' | 'search' | null {
  if (state.selectedNode) return 'inspector'
  if (state.traceTarget) return 'trace'
  if (state.searchQuery.trim() !== '') return 'search'
  return null
}

/**
 * Новый id узла, если правка сменила его тег: id inbound'а и outbound'а — это его
 * тег, поэтому после переименования выбор нужно вести за узлом, иначе инспектор
 * закрывается прямо во время редактирования.
 */
export function renamedNodeId(nodeId: string, value: unknown): string | null {
  const prefix = nodeId.startsWith('in:')
    ? 'in:'
    : nodeId.startsWith('out:')
      ? 'out:'
      : nodeId.startsWith('bal:')
        ? 'bal:'
        : null
  if (prefix === null) return null
  if (typeof value !== 'object' || value === null) return null
  const tag = (value as { tag?: unknown }).tag
  if (typeof tag !== 'string' || tag === '') return null
  const next = `${prefix}${tag}`
  return next === nodeId ? null : next
}

export interface ConfigDraftOptions {
  /** Ключ документа: uuid профиля или шаблона. По нему живут черновик, история и позиции узлов */
  docKey: string
  /** Документ, каким его отдала панель */
  panelConfig: unknown
  /** Версия панели: updatedAt профиля либо хэш содержимого шаблона */
  baseVersion: string
  /** Контекст графа: у шаблона он пустой — сквадов там нет */
  ctx: GraphContext
}

export interface ConfigDraft {
  docKey: string
  /** Контекст графа, с которым построен документ: его же ждёт TopologyView */
  ctx: GraphContext
  text: string
  /** Текст, каким его отдала панель: левая сторона сравнения при сохранении */
  panelText: string
  /** Версия, от которой отсчитывается черновик, — она уходит в сохранение */
  baseVersion: string
  dirty: boolean
  validation: ReturnType<typeof validateXrayConfig>
  /** Разобранный конфиг; undefined — документ не проходит схему, топология не строится */
  parsedConfig: XrayConfig | undefined
  hasErrors: boolean
  errorCount: number
  warningCount: number
  nodeIssues: Record<string, IssueCount>

  tab: 'topology' | 'json'
  openJsonTab: () => void
  openTopologyTab: () => void

  selectedNode: string | null
  setSelectedNode: (id: string | null) => void

  writeDraft: (text: string, opts: { history: boolean }) => void
  changeConfig: (next: XrayConfig) => void
  /** Отменить локальные правки и вернуться к версии панели (сам шаг отменяем через undo) */
  resetDraft: () => void
  /** Сохранение прошло: черновик и история относятся к прежней базе */
  clearAfterSave: () => void
  /** Принять версию панели при конфликте: документ меняется целиком */
  adoptPanelVersion: () => void

  undoAvailable: boolean
  redoAvailable: boolean
  doUndo: () => void
  doRedo: () => void

  reveal: { parts: PathParts; nonce: number } | null
  canSelectIssue: (issue: ValidationIssue) => boolean
  selectIssue: (issue: ValidationIssue) => void

  searchQuery: string
  setSearchQuery: (value: string) => void
  searchFocus: number
  searchHits: SearchHit[]
  focus: { nodeId: string; nonce: number } | null
  /** Выбрать узел и подвести к нему холст (из поиска) */
  focusNode: (nodeId: string) => void

  traceOpen: boolean
  toggleTrace: () => void
  traceTarget: TraceTarget | null
  setTraceTarget: (target: TraceTarget | null) => void
  trace: TraceResult | undefined

  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  geoOpen: boolean
  setGeoOpen: (open: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  issuesOpen: boolean
  setIssuesOpen: (open: boolean) => void

  /** Применить правку узла из инспектора */
  applyNode: (value: unknown) => void
  /** Переставить выбранное правило */
  moveSelected: (dir: -1 | 1) => void
  /** Удалить выбранный узел */
  removeSelected: () => void
  /** Дописать geo-категорию в открытое правило либо завести новое */
  appendGeoKeyToRule: (key: string) => void
  setupObservatory: (kind: 'observatory' | 'burst', subjects: string[]) => void
}

export function useConfigDraft({
  docKey,
  panelConfig,
  baseVersion,
  ctx,
}: ConfigDraftOptions): ConfigDraft {
  const { drafts, setDraft, clearDraft } = useDraftStore()
  const { stacks, record, undo, redo, clear: clearHistory } = useHistoryStore()
  const stored = drafts[docKey]
  const text = resolveEditorText(stored, panelConfig)
  const panelText = useMemo(() => formatConfig(panelConfig), [panelConfig])
  const dirty = stored !== undefined && stored.text !== panelText
  // `||`, а не `??`: миграция v0 могла оставить пустую строку, и она не база
  const base = stored?.baseVersion || baseVersion

  // Единственная точка записи черновика: здесь же решается, попадает ли правка в историю
  function writeDraft(nextText: string, opts: { history: boolean }) {
    if (opts.history) record(docKey, text)
    setDraft(docKey, nextText, base)
  }

  const validation = useMemo(() => validateXrayConfig(text), [text])
  const hasErrors = validation.issues.some((i) => i.level === 'error')
  const errorCount = validation.issues.filter((i) => i.level === 'error').length
  const warningCount = validation.issues.length - errorCount

  const [tab, setTab] = useState<'topology' | 'json'>('topology')
  // Текст на момент входа в JSON-редактор: вся текстовая сессия сворачивается
  // в один снимок истории при уходе с вкладки
  const jsonEntryText = useRef<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  // Цель трассировки — инструмент, а не документ: в localStorage ей делать нечего
  const [traceOpen, setTraceOpen] = useState(false)
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Прокрутка к месту проблемы в JSON; nonce делает повторный клик рабочим
  const [reveal, setReveal] = useState<{ parts: PathParts; nonce: number } | null>(null)
  const revealNonce = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocus, setSearchFocus] = useState(0)
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number } | null>(null)
  const focusNonce = useRef(0)

  // топология строится только по валидному (по схеме) документу
  const parsedConfig = validation.ok ? (validation.config as XrayConfig) : undefined
  // Считаем и спрашиваем базу, когда ввод затих: иначе каждый символ адреса
  // пересчитывал бы граф и дергал бэкенд, а вердикты мигали бы на полуслове
  const settledTarget = useDebounced(traceTarget, TRACE_DEBOUNCE_MS)
  const geoKeys = useMemo(() => (parsedConfig ? geoKeysOf(parsedConfig) : []), [parsedConfig])
  const searchHits = useMemo(
    () => (parsedConfig ? searchNodes(parsedConfig, ctx, searchQuery) : []),
    [parsedConfig, ctx, searchQuery],
  )
  const nodeIssues = useMemo(
    () => (parsedConfig ? issueCountsByNode(validation.issues, parsedConfig) : {}),
    [validation.issues, parsedConfig],
  )
  const geoQuery = useGeoMatch(
    settledTarget ? { domain: settledTarget.address, ip: settledTarget.ip, keys: geoKeys } : null,
  )
  const trace = useMemo(
    () => traceOf(parsedConfig, settledTarget, geoQuery.data),
    [parsedConfig, settledTarget, geoQuery.data],
  )

  // Переход зависит от вкладки: на топологии ведём к узлу, в JSON — к месту в тексте.
  // Вкладку не переключаем: у log/policy узла нет, и прыжок увёл бы в никуда.
  function canSelectIssue(issue: ValidationIssue): boolean {
    if (tab === 'json') return issue.parts.length > 0
    return parsedConfig !== undefined && nodeIdForPath(issue.parts, parsedConfig) !== null
  }

  function selectIssue(issue: ValidationIssue) {
    if (tab === 'json') {
      revealNonce.current += 1
      setReveal({ parts: issue.parts, nonce: revealNonce.current })
      return
    }
    const id = parsedConfig ? nodeIdForPath(issue.parts, parsedConfig) : null
    if (id) setSelectedNode(id)
  }

  function changeConfig(next: XrayConfig) {
    writeDraft(formatConfig(next), { history: true })
    setSelectedNode((cur) => nextSelection(cur, parsedConfig!, next))
  }

  const historyDisabled = tab === 'json'
  const undoAvailable = !historyDisabled && canUndo(stacks, docKey)
  const redoAvailable = !historyDisabled && canRedo(stacks, docKey)

  function doUndo() {
    const prev = undo(docKey, text)
    if (prev === null) return
    setDraft(docKey, prev, base)
    // Конфиг подменяется целиком — позиционные rule:N и inj:N дрейфуют
    setSelectedNode(null)
  }

  function doRedo() {
    const next = redo(docKey, text)
    if (next === null) return
    setDraft(docKey, next, base)
    setSelectedNode(null)
  }

  function openJsonTab() {
    jsonEntryText.current = text
    setTab('json')
    setSelectedNode(null)
    // Панель разбора живёт над канвасом — над JSON-редактором ей не место
    setTraceTarget(null)
    setTraceOpen(false)
  }

  function openTopologyTab() {
    // Вся текстовая сессия сворачивается в один шаг истории
    const entry = jsonEntryText.current
    if (entry !== null && entry !== text) record(docKey, entry)
    jsonEntryText.current = null
    setTab('topology')
  }

  useHotkeys([
    { combo: 'mod+z', handler: () => { if (undoAvailable) doUndo() } },
    { combo: 'mod+shift+z', handler: () => { if (redoAvailable) doRedo() } },
    { combo: 'mod+y', handler: () => { if (redoAvailable) doRedo() } },
    {
      combo: 'mod+f',
      // На вкладке JSON Ctrl+F отдан поиску CodeMirror
      handler: () => { if (tab === 'topology') setSearchFocus((v) => v + 1) },
    },
    {
      combo: 'Escape',
      // Нативный <dialog> закрывается по Escape сам — не мешаем и не отменяем действие
      preventDefault: false,
      whenEditable: true,
      handler: () => {
        if (hasOpenDialog()) return
        const target = escapeTarget({ selectedNode, traceTarget, searchQuery })
        if (target === 'inspector') setSelectedNode(null)
        if (target === 'trace') setTraceTarget(null)
        if (target === 'search') setSearchQuery('')
      },
    },
    { combo: '?', handler: () => setShortcutsOpen(true) },
  ])

  return {
    docKey,
    ctx,
    text,
    panelText,
    baseVersion: base,
    dirty,
    validation,
    parsedConfig,
    hasErrors,
    errorCount,
    warningCount,
    nodeIssues,
    tab,
    openJsonTab,
    openTopologyTab,
    selectedNode,
    setSelectedNode,
    writeDraft,
    changeConfig,
    resetDraft: () => {
      // Сброс тоже отменяется: undo вернёт текст и создаст черновик заново
      record(docKey, text)
      clearDraft(docKey)
      setSelectedNode(null)
    },
    clearAfterSave: () => {
      clearDraft(docKey)
      // База сместилась: прежние снимки относятся к другому документу
      clearHistory(docKey)
    },
    adoptPanelVersion: () => {
      clearDraft(docKey)
      clearHistory(docKey)
      setSelectedNode(null)
    },
    undoAvailable,
    redoAvailable,
    doUndo,
    doRedo,
    reveal,
    canSelectIssue,
    selectIssue,
    searchQuery,
    setSearchQuery,
    searchFocus,
    searchHits,
    focus,
    focusNode: (nodeId) => {
      setSelectedNode(nodeId)
      focusNonce.current += 1
      setFocus({ nodeId, nonce: focusNonce.current })
      setSearchQuery('')
    },
    traceOpen,
    toggleTrace: () => {
      setTraceOpen((v) => !v)
      // Закрыли инструмент — снимаем и цель, иначе панель разбора висит
      if (traceOpen) setTraceTarget(null)
    },
    traceTarget,
    setTraceTarget,
    trace,
    shortcutsOpen,
    setShortcutsOpen,
    geoOpen,
    setGeoOpen,
    settingsOpen,
    setSettingsOpen,
    issuesOpen,
    setIssuesOpen,
    applyNode: (value) => {
      if (!parsedConfig || !selectedNode) return
      changeConfig(applyNodeJson(parsedConfig, selectedNode, value))
      // Тег сменился — сменился и id узла: перекрываем сброс выбора из changeConfig
      const renamed = renamedNodeId(selectedNode, value)
      if (renamed !== null) setSelectedNode(renamed)
    },
    moveSelected: (dir) => {
      if (!parsedConfig) return
      const moved = moveSelectedRule(parsedConfig, selectedNode, dir)
      if (!moved) return
      changeConfig(moved.config)
      // Перекрывает nextSelection: число правил не изменилось, но правило переехало
      setSelectedNode(moved.selected)
    },
    removeSelected: () => {
      if (!parsedConfig || !selectedNode) return
      changeConfig(removeNode(parsedConfig, selectedNode))
      setSelectedNode(null)
    },
    appendGeoKeyToRule: (key) => {
      if (!parsedConfig) return
      // Категория дописывается в открытое правило, иначе создаётся новое
      const ruleIndex = selectedNode?.startsWith('rule:') ? Number(selectedNode.slice(5)) : null
      const res = appendGeoKey(parsedConfig, ruleIndex, key)
      if (res.config !== parsedConfig) changeConfig(res.config)
      // Перекрывает сброс выбора: показываем, куда попала категория
      setSelectedNode(`rule:${res.ruleIndex}`)
      setGeoOpen(false)
    },
    setupObservatory: (kind, subjects) => {
      if (!parsedConfig) return
      changeConfig(ensureObservatorySection(parsedConfig, kind, subjects))
      setSelectedNode('obs')
    },
  }
}
```

- [ ] **Step 4: Перевести `EditorPage` на хук**

В `frontend/src/features/editor/EditorPage.tsx`:
- удалить перечисленные в «Interfaces» чистые функции и константы `NO_GEO`/`TRACE_DEBOUNCE_MS` (они переехали), оставив `toGraphContext`;
- удалить из `EditorInner` весь блок состояния документа (черновик, история, валидация, вкладки, выбор, поиск, трассировка, хоткеи, `changeConfig`, `doUndo`/`doRedo`, `selectIssue`) и заменить его одним вызовом:

```tsx
  const ctx = useMemo(
    () => toGraphContext(squads.data, panelInbounds.data),
    [squads.data, panelInbounds.data],
  )
  const draft = useConfigDraft({
    docKey: profile.uuid,
    panelConfig: profile.config,
    baseVersion: profile.updatedAt,
    ctx,
  })
```

- в JSX заменить обращения: `text` → `draft.text`, `dirty` → `draft.dirty`, `validation` → `draft.validation`, `parsedConfig` → `draft.parsedConfig`, `selectedNode` → `draft.selectedNode`, `tab` → `draft.tab`, и так далее по всем полям `ConfigDraft`; обработчики инспектора и `GeoDataDialog` заменить на `draft.applyNode`, `draft.moveSelected`, `draft.removeSelected`, `draft.setupObservatory`, `draft.appendGeoKeyToRule`;
- `doSave(draft?.baseUpdatedAt ?? profile.updatedAt)` → `doSave(draft.baseVersion)`;
- в `onSuccess` сохранения — `draft.clearAfterSave()`;
- в диалоге конфликта «Загрузить версию панели» — `draft.adoptPanelVersion()` перед `qc.setQueryData(...)`;
- в диалоге сброса — `draft.resetDraft()`.

Ничего не переименовывать в разметке и не менять тексты: все существующие тесты и e2e обязаны пройти без правок.

- [ ] **Step 5: Перевести `test/editor-logic.test.ts` на новый модуль**

В `frontend/test/editor-logic.test.ts` разделить импорт: `toGraphContext` остаётся из `EditorPage`, остальное — из `useConfigDraft`. В литерале черновика заменить `baseUpdatedAt` на `baseVersion`. Дописать два случая для `nextSelection`:

```ts
  it('inj:N сбрасывается при изменении числа групп', () => {
    const prev = { remnawave: { injectHosts: [{}, {}] } } as unknown as XrayConfig
    const next = { remnawave: { injectHosts: [{}] } } as unknown as XrayConfig
    expect(nextSelection('inj:0', prev, next)).toBeNull()
  })

  it('inj:N переживает правку самой группы', () => {
    const prev = { remnawave: { injectHosts: [{ tagPrefix: 'a' }] } } as unknown as XrayConfig
    const next = { remnawave: { injectHosts: [{ tagPrefix: 'b' }] } } as unknown as XrayConfig
    expect(nextSelection('inj:0', prev, next)).toBe('inj:0')
  })
```

- [ ] **Step 6: Полная проверка**

Run из корня: `npm test && npm run typecheck -w frontend && npm run e2e -w frontend`
Expected: всё зелёное. Расхождение в e2e означает, что рефакторинг изменил поведение — искать причину, а не править тест.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/editor/useConfigDraft.ts frontend/src/features/editor/EditorPage.tsx frontend/src/features/editor/draftStore.ts frontend/test/editor-logic.test.ts frontend/test/draft-store.test.ts frontend/test/draft-store-migrate.test.ts
git commit -m "refactor(frontend): документ редактора вынесен в useConfigDraft"
```

---

### Task 8: API-слой шаблонов, конфликт и диалог версий

Фронтенд ещё ни разу не ходил в `/api/templates`. Здесь появляются запросы, тип шаблона и обобщение двух общих мест: `ConflictError` (у шаблона в теле лежит шаблон и хэш, а не профиль) и `VersionsDialog` (бэкапы шаблона лежат по другому пути).

**Files:**
- Modify: `frontend/src/shared/api/types.ts`
- Modify: `frontend/src/shared/api/hooks.ts`
- Modify: `frontend/src/shared/api/client.ts`
- Modify: `frontend/src/features/editor/VersionsDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx` (одно сужение типа конфликта)
- Test: `frontend/test/api-templates.test.ts` (создать)

**Interfaces:**
- Produces: типы `TemplateType`, `SubscriptionTemplate`, `TemplateBackupFileData`; хуки `useTemplates`, `useTemplate`, `useCreateTemplate`, `useSaveTemplate`, `useDeleteTemplate`; `useBackups(kind, uuid, enabled)`; `ConflictError` с полями `current: unknown` и `hash?: string`; `VersionsDialog` получает проп `kind: 'profiles' | 'templates'`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/api-templates.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ConflictError } from '../src/shared/api'

afterEach(() => vi.restoreAllMocks())

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

describe('конфликт сохранения', () => {
  it('409 от шаблона несёт и текущую версию, и её хэш', async () => {
    mockFetch(409, {
      message: 'Шаблон был изменён в панели после открытия',
      current: { uuid: 'u-1', name: 'Default', templateType: 'XRAY_JSON', templateJson: {} },
      hash: 'a'.repeat(64),
    })
    await expect(apiFetch('/api/templates/u-1', { method: 'PATCH', body: '{}' })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ConflictError &&
        err.hash === 'a'.repeat(64) &&
        (err.current as { name: string }).name === 'Default',
    )
  })

  it('409 от профиля по-прежнему несёт профиль, а хэша у него нет', async () => {
    mockFetch(409, { message: 'конфликт', current: { uuid: 'p-1', name: 'Profile' } })
    await expect(apiFetch('/api/profiles/p-1', { method: 'PATCH', body: '{}' })).rejects.toSatisfy(
      (err: unknown) => err instanceof ConflictError && err.hash === undefined,
    )
  })
})
```

Если `rejects.toSatisfy` в этой версии vitest недоступен — заменить на `try/catch` с явными `expect`.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/api-templates.test.ts`
Expected: FAIL — у `ConflictError` нет поля `hash`.

- [ ] **Step 3: Добавить типы**

В `frontend/src/shared/api/types.ts`:

```ts
export type TemplateType = 'XRAY_JSON' | 'XRAY_BASE64' | 'MIHOMO' | 'STASH' | 'CLASH' | 'SINGBOX'

/**
 * Шаблон подписки. Полей createdAt/updatedAt здесь НЕТ — защита при сохранении
 * строится на хэше содержимого, который считает бэкенд.
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

export interface TemplateBackupFileData {
  savedAt: string
  template: SubscriptionTemplate
}
```

- [ ] **Step 4: Обобщить `ConflictError`**

В `frontend/src/shared/api/client.ts`:

```ts
export class ConflictError extends ApiError {
  constructor(
    message: string,
    /** Текущая версия из панели: профиль либо шаблон — сужает вызывающая сторона */
    public current: unknown,
    /** Хэш текущей версии; только у шаблонов — у профилей роль базы играет updatedAt */
    public hash?: string,
  ) {
    super(409, message)
    this.name = 'ConflictError'
  }
}
```

и в разборе ответа — прокинуть хэш:

```ts
      if (current) throw new ConflictError(message, current, (body as { hash?: string }).hash)
```

В `frontend/src/features/editor/EditorPage.tsx` сузить тип в одном месте (там, где конфликт кладётся в state):

```ts
          if (err instanceof ConflictError) {
            setSaveOpen(false)
            // Роут профилей отдаёт в `current` профиль — сужаем на границе
            setConflict(err.current as Profile)
          }
```

- [ ] **Step 5: Добавить хуки**

В `frontend/src/shared/api/hooks.ts` (импорты типов дополнить):

```ts
export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () =>
      apiFetch<{ templates: SubscriptionTemplate[] }>('/api/templates').then((r) => r.templates),
  })
}

/** Шаблон вместе с хэшем содержимого: хэш возвращается в expectedHash при сохранении */
export function useTemplate(uuid: string) {
  return useQuery({
    queryKey: ['templates', uuid],
    queryFn: () =>
      apiFetch<{ template: SubscriptionTemplate; hash: string }>(`/api/templates/${uuid}`),
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string }) =>
      apiFetch<{ template: SubscriptionTemplate }>('/api/templates', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) =>
      apiFetch<{ ok: boolean }>(`/api/templates/${uuid}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useSaveTemplate(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { templateJson: unknown; name?: string; expectedHash: string }) =>
      apiFetch<{ template: SubscriptionTemplate; hash: string }>(`/api/templates/${uuid}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['templates', uuid], data)
      qc.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}
```

и обобщить бэкапы — путь у профиля и шаблона разный, всё остальное совпадает:

```ts
export function useBackups(kind: 'profiles' | 'templates', uuid: string, enabled = true) {
  return useQuery({
    queryKey: [kind, uuid, 'backups'],
    queryFn: () =>
      apiFetch<{ backups: BackupEntry[] }>(`/api/${kind}/${uuid}/backups`).then((r) => r.backups),
    enabled,
  })
}
```

Проверить `frontend/src/shared/api/index.ts`: если реэкспорт перечислением, дописать новые имена.

- [ ] **Step 6: Обобщить `VersionsDialog`**

В `frontend/src/features/editor/VersionsDialog.tsx`:
- в `Props` добавить `kind: 'profiles' | 'templates'`, а `profileUuid`/`profileName` переименовать в `docUuid`/`docName` (это уже не только профиль);
- `useBackups(profileUuid, open)` → `useBackups(kind, docUuid, open)`;
- в `loadBackup` выбрать поле содержимого по виду:

```ts
      const data = await apiFetch<BackupFileData | TemplateBackupFileData>(
        `/api/${kind}/${docUuid}/backups/${file}`,
      )
      // У профиля содержимое лежит в profile.config, у шаблона — в template.templateJson
      const config =
        kind === 'profiles'
          ? (data as BackupFileData).profile.config
          : (data as TemplateBackupFileData).template.templateJson
      return JSON.stringify(config, null, 2)
```

- заголовок диалога и подписи оставить прежними; если где-то в тексте стоит слово «профиль», заменить на нейтральное «документ» **только** там, где диалог общий.

В `EditorPage` передать `kind="profiles"` и переименованные пропсы.

- [ ] **Step 7: Прогнать тесты**

Run из корня: `npm test && npm run typecheck -w frontend && npm run e2e -w frontend`
Expected: всё зелёное. Тесты `VersionsDialog`, если они есть, поправить по новым именам пропсов.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/shared/api frontend/src/features/editor/VersionsDialog.tsx frontend/src/features/editor/EditorPage.tsx frontend/test/api-templates.test.ts
git commit -m "feat(frontend): API шаблонов, общий конфликт и общий диалог версий"
```

---

### Task 9: Вынести оболочку в `Workbench`

Вторая половина рефакторинга. Всё, что осталось в `EditorPage` между топбаром и статус-баром, одинаково для профиля и шаблона: вкладки, канвас, инспектор, панель разбора трассы, список проблем, диалоги настроек, geo, горячих клавиш, версий и сброса. Различаются ровно четыре вещи — заголовок, кнопки топбара, сохранение и наличие рецептов.

**Files:**
- Create: `frontend/src/features/editor/Workbench.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Test: `frontend/test/workbench.test.tsx` (создать)

**Interfaces:**
- Consumes: `ConfigDraft` из `useConfigDraft`; `TopologyView`, `SearchBox`, `NodeInspector` из `features/topology`; `TraceBar`, `TracePanel`, `GeoDataDialog` из `features/diagnostics`; `JsonView`, `IssueList`, `PanelTokenNotice`, `ShortcutsDialog`, `ConfigSettingsDialog`, `VersionsDialog` из `features/editor`.
- Produces:

```ts
export interface WorkbenchProps {
  draft: ConfigDraft
  /** Вид документа: путь бэкапов и адрес кнопки возврата */
  kind: 'profiles' | 'templates'
  /** Куда ведёт кнопка возврата и что на ней написано */
  back: { to: string; label: string }
  title: string
  /** Строка под заголовком: «обновлён N минут назад» либо тип шаблона */
  subtitle?: string
  /** Кнопки топбара между сегментами и «Сохранить» (специфичные для страницы) */
  actions?: ReactNode
  /** Кнопка сохранения целиком: условия и диалоги у профиля и шаблона разные */
  save?: ReactNode
  /** Библиотека рецептов: у шаблона её нет, кнопка не появляется */
  onOpenRecipes?: () => void
  /** Правая часть статус-бара: текст ошибки сохранения приходит из мутации страницы */
  statusExtra?: ReactNode
  /** Диалоги страницы: сохранение, конфликт, проверка ядром */
  children?: ReactNode
}
```

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/workbench.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Workbench } from '../src/features/editor/Workbench'
import { useConfigDraft } from '../src/features/editor/useConfigDraft'

const CONFIG = {
  log: { loglevel: 'warning' },
  inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

function Harness({ recipes }: { recipes?: boolean }) {
  const draft = useConfigDraft({
    docKey: 'doc-1',
    panelConfig: CONFIG,
    baseVersion: 'v1',
    ctx: {},
  })
  return (
    <Workbench
      draft={draft}
      kind="templates"
      back={{ to: '/templates', label: '← Шаблоны' }}
      title="Мой шаблон"
      onOpenRecipes={recipes ? () => {} : undefined}
      save={<button type="button">Сохранить в панель</button>}
    />
  )
}

function renderWorkbench(props: { recipes?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Harness {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Workbench', () => {
  it('рисует заголовок, вкладки и кнопку сохранения страницы', () => {
    renderWorkbench()
    expect(screen.getByRole('heading', { name: 'Мой шаблон' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Топология' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить в панель' })).toBeInTheDocument()
  })

  it('без обработчика рецептов кнопки рецептов нет', () => {
    renderWorkbench()
    expect(screen.queryByRole('button', { name: /Рецепт/ })).not.toBeInTheDocument()
  })

  it('валидный документ не показывает проблем', () => {
    renderWorkbench()
    expect(screen.getByText('Конфиг валиден')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/workbench.test.tsx`
Expected: FAIL — модуля `Workbench` нет.

- [ ] **Step 3: Написать `Workbench`**

Создать `frontend/src/features/editor/Workbench.tsx`. Разметка **переносится из `EditorInner` буквально**, вместе с классами, подписями кнопок, `aria-label`, комментариями и порядком элементов: это перемещение кода, а не новая вёрстка. Из `EditorInner` переезжают целиком блоки `<div className="wb-iconbar">`, `<div className="segmented">`, `<div className="wb-stage">` (все три ветки: JSON, невалидный конфиг, топология с `TracePanel` и `NodeInspector`), `<footer className="wb-statusbar">`, `ConfigSettingsDialog`, `ShortcutsDialog`, `GeoDataDialog`, `VersionsDialog` и диалог сброса черновика. Ничего из этого не переписывается — меняются только источники значений (`draft.*` вместо локальных переменных). Каркас, в который они укладываются:

```tsx
export function Workbench({
  draft, kind, back, title, subtitle, actions, save, onOpenRecipes, children,
}: WorkbenchProps) {
  const navigate = useNavigate()
  const panelToken = usePanelToken()

  return (
    <div className="workbench">
      <header className="wb-topbar">
        <Button variant="ghost" onClick={() => navigate(back.to)}>{back.label}</Button>
        <div className="wb-title">
          <h1>{title}</h1>
          {subtitle && <span className="eyebrow">{subtitle}</span>}
        </div>

        {/* иконки отмены/возврата/справки — как было */}
        <div className="wb-iconbar">…</div>
        <div className="segmented">…</div>

        <span className="spacer" />
        {draft.dirty && <Chip dir="none">черновик</Chip>}
        <Button variant="ghost" disabled={draft.parsedConfig === undefined}
          onClick={() => draft.setSettingsOpen(true)}>Настройки конфига</Button>
        {actions}
        <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>Geo-базы</Button>
        <Button variant="ghost" onClick={() => setVersionsOpen(true)}>Версии</Button>
        <Button variant="ghost" disabled={!draft.dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        {save}
      </header>

      <div className="wb-stage">{/* JsonView / EmptyState / TopologyView + TracePanel + NodeInspector */}</div>

      <footer className="wb-statusbar">{/* счётчики, PanelTokenNotice, IssueList */}</footer>

      {/* ConfigSettingsDialog, ShortcutsDialog, GeoDataDialog, VersionsDialog, диалог сброса */}
      {children}
    </div>
  )
}
```

Требования к переносу:
- `TopologyView` получает `profileUuid={draft.docKey}` (проп называется так исторически — это ключ позиций узлов, переименование в отдельной задаче не делаем), `config={draft.parsedConfig}`, `ctx={draft.ctx}`, `selectedId`, `onSelect`, `onChangeConfig={draft.changeConfig}`, `trace`, `issues={draft.nodeIssues}`, `focus`, `onOpenRecipes` и прежние `dockExtra`/`dockRow`.
- `NodeInspector` получает `draft.applyNode`, `draft.moveSelected`, `draft.removeSelected`, `draft.setupObservatory`, `draft.setSelectedNode(null)` на закрытие.
- `VersionsDialog` получает `kind`, `docUuid={draft.docKey}`, `docName={title}`, `currentText={draft.text}` и `onRestore={(text) => { draft.writeDraft(text, { history: true }); draft.setSelectedNode(null) }}`.
- Локальное состояние `versionsOpen`/`resetOpen` живёт внутри `Workbench` — оно ничьё больше.
- Текст ошибки сохранения приходит из мутации страницы и рисуется в статус-баре ровно там, где рисовался: `{statusExtra}` встаёт на место прежнего `{saveError && <span className="field-error">{saveError}</span>}`, сразу после `PanelTokenNotice`.
- Диалоги страницы (`SaveDialog`, конфликт, `CheckReportDialog`, `RecipesDialog`) уходят в `children` и рендерятся последними, внутри `<div className="workbench">`.

- [ ] **Step 4: Ужать `EditorPage`**

`EditorInner` после переноса состоит из: загрузки профиля, `ctx`, вызова `useConfigDraft`, мутации сохранения с её состоянием (`saveOpen`, `conflict`), профильных диалогов (`SaveDialog`, конфликт, `CheckReportDialog`, `RecipesDialog`) и вызова `Workbench` с `actions` (кнопка «Проверить конфиг»), `save` (кнопка «Сохранить в панель»), `statusExtra` (текст ошибки сохранения) и `onOpenRecipes`.

Целевой размер файла — меньше 300 строк. Тексты кнопок, заголовки и разметка не меняются.

- [ ] **Step 5: Полная проверка**

Run из корня: `npm test && npm run typecheck -w frontend && npm run e2e -w frontend`
Expected: всё зелёное **без правок существующих тестов и e2e**. Если e2e падает — рефакторинг изменил поведение; чинить код, а не тест.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/editor/Workbench.tsx frontend/src/features/editor/EditorPage.tsx frontend/src/features/editor/useConfigDraft.ts frontend/test/workbench.test.tsx
git commit -m "refactor(frontend): оболочка редактора вынесена в Workbench"
```

---

### Task 10: Карточка группы на холсте, отметки подстановки в разборе трассы, стили

После плана 1 узлы `inj:` строятся, но React Flow не знает типа `inject` — на холсте их нет. Здесь появляется карточка, стиль и отметка «это подставит панель» в разборе трассы. **Весь `tokens.css` в этой волне принадлежит только этой задаче.**

**Files:**
- Modify: `frontend/src/features/topology/nodes.tsx`
- Modify: `frontend/src/features/diagnostics/TracePanel.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/topology-inject-node.test.tsx` (создать)

**Interfaces:**
- Consumes: `InjectNodeData` из `entities/graph/types`; `TraceWinner.injected`/`injectedTags` из `entities/xray/trace` (задача 4).
- Produces: `nodeTypes.inject`; CSS-классы `.fnode-inj`, `.metric-predicted` и правило подсветки `[data-accepts~='inj']` — последнее нужно задаче 11.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/topology-inject-node.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { nodeTypes } from '../src/features/topology/nodes'
import type { InjectNodeData } from '../src/entities/graph/types'

function renderNode(data: InjectNodeData) {
  const Node = nodeTypes.inject!
  return render(
    <ReactFlowProvider>
      {/* NodeProps шире, чем нужно карточке: подаём то, что она читает */}
      <Node {...({ data, selected: false } as never)} />
    </ReactFlowProvider>,
  )
}

describe('карточка группы подстановки', () => {
  it('в nodeTypes есть тип inject', () => {
    expect(nodeTypes.inject).toBeDefined()
  })

  it('показывает селектор, пул и предсказанные теги', () => {
    renderNode({
      kind: 'inject',
      index: 0,
      selector: 'тег ~ ^RU-',
      selectFrom: 'HIDDEN',
      scheme: 'prefix',
      tags: ['proxy', 'proxy-2', 'proxy-3'],
    })
    expect(screen.getByText('тег ~ ^RU-')).toBeInTheDocument()
    expect(screen.getByText('HIDDEN')).toBeInTheDocument()
    expect(screen.getByText(/proxy-3/)).toBeInTheDocument()
  })

  it('для тегов панели теги не выдумываются', () => {
    renderNode({
      kind: 'inject',
      index: 0,
      selector: 'тег как у получателя',
      scheme: 'panel',
      tags: [],
    })
    expect(screen.getByText(/задаст панель/)).toBeInTheDocument()
  })

  it('без выбранного способа именования это названо ошибкой конфигурации', () => {
    renderNode({ kind: 'inject', index: 0, selector: 'по списку: 2', scheme: 'none', tags: [] })
    expect(screen.getByText(/не задан/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/topology-inject-node.test.tsx`
Expected: FAIL — `nodeTypes.inject` не определён.

- [ ] **Step 3: Добавить карточку**

В `frontend/src/features/topology/nodes.tsx`:
- в `frame()` дописать `kind === 'inject' ? 'fnode-inj' : ''`;
- в `ENTER_DELAY` дописать `inject: 280` (та же колонка, что у выходов, — волна должна дойти до них одновременно);
- добавить компонент и зарегистрировать тип:

```tsx
function InjectNode({ data, selected }: { data: InjectNodeData; selected?: boolean }) {
  return (
    <div className={frame('inject', selected)} style={enter('inject')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">подстановка</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.selector}</div>
      <div className="metrics">
        {/* Пул по умолчанию задаёт панель, а не документ */}
        <Metric accent>{data.selectFrom ?? 'HIDDEN'}</Metric>
        {data.scheme === 'prefix' && <Metric>{data.tags.join(', ')}</Metric>}
        {data.scheme === 'panel' && <Metric>теги задаст панель</Metric>}
        {data.scheme === 'none' && <Metric>способ именования не задан</Metric>}
      </div>
      {/* Гнезда-источника нет: из группы никуда не ведут — её выходы создаст панель */}
    </div>
  )
}
```

```tsx
export const nodeTypes = {
  …
  inject: InjectNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>
```

- [ ] **Step 4: Отметить подстановку в разборе трассы**

В `frontend/src/features/diagnostics/TracePanel.tsx`, в блоке `trace-winner`:
- ветку «ни одно правило не совпало» дополнить случаем подстановки:

```tsx
          <>
            <span className="muted">
              {winner.injected
                ? 'Ни одно правило не совпало — трафик уйдёт в первый выход, а его подставит панель'
                : 'Ни одно правило не совпало — трафик уходит в первый выход'}
            </span>
            {winner.outboundTag && (
              <span className="metric metric-accent">{winner.outboundTag}</span>
            )}
            {winner.injected && <span className="metric metric-predicted">{winner.injected.selector}</span>}
          </>
```

- у победившего правила показать ту же отметку рядом с тегом:

```tsx
            {winner.injected && (
              <span className="metric metric-predicted" title="Выход подставит панель — в документе его нет">
                подстановка: {winner.injected.selector}
              </span>
            )}
```

- кандидатов балансера различать по происхождению:

```tsx
            {winner.balancerCandidates?.map((tag) => (
              <span
                key={tag}
                className={
                  winner.injectedTags?.includes(tag)
                    ? 'metric metric-predicted'
                    : 'metric metric-accent'
                }
                title={winner.injectedTags?.includes(tag) ? 'Тег предсказан по префиксу' : undefined}
              >
                {tag}
              </span>
            ))}
```

- [ ] **Step 5: Дописать стили**

В `frontend/src/shared/ui/tokens.css`, в секцию узлов графа, рядом с `.fnode-bal`:

```css
/* Группа подстановки — выход, которого в документе нет: янтарь выхода, но рамка
   пунктиром. Пунктир и есть сообщение: содержимое появится только у клиента. */
.fnode-inj { --node-hue: var(--ember); --node-select: var(--ember); border-style: dashed; }
.fnode-inj::before {
  content: '';
  position: absolute;
  top: 9px;
  bottom: 9px;
  right: -1px;
  width: 2px;
  border-radius: 2px;
  background: var(--node-hue);
  opacity: 0.85;
}
```

Рядом с `.metric-accent`:

```css
/* Предсказанное значение: его настоящий вид знает только панель */
.metric-predicted {
  color: var(--ember);
  border-style: dashed;
}
```

Если у `.metric` нет рамки, добавить в `.metric-predicted` `border: 1px dashed var(--ember-line)` — иначе пунктир не проявится; сверить с существующим правилом `.metric` в файле.

И к правилу подсветки целей коммутации добавить колонку групп (пригодится задаче 11):

```css
[data-accepts~='rule'] .react-flow__node[data-id^='rule:'] .fnode,
[data-accepts~='out'] .react-flow__node[data-id^='out:'] .fnode,
[data-accepts~='inj'] .react-flow__node[data-id^='inj:'] .fnode,
[data-accepts~='bal'] .react-flow__node[data-id^='bal:'] .fnode {
```

и то же самое во втором правиле (подсветка левых гнёзд) — обе группы селекторов дополняются строкой про `inj`.

- [ ] **Step 6: Прогнать тесты**

Run из корня: `npm test && npm run typecheck -w frontend && npm run build -w frontend`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/topology/nodes.tsx frontend/src/features/diagnostics/TracePanel.tsx frontend/src/shared/ui/tokens.css frontend/test/topology-inject-node.test.tsx
git commit -m "feat(frontend): группа подстановки на холсте и в разборе трассы"
```

---

### Task 11: Холст знает про группы подстановки

Три доработки `TopologyView`: колонка групп подсвечивается как цель кабеля, подсветка победившей трассы доходит до группы, а разрыв ребра у балансера с префиксом группы больше не предлагает разворот, когда разворот сломал бы подстановку.

**Files:**
- Modify: `frontend/src/features/topology/TopologyView.tsx`
- Test: `frontend/test/topology-inject-edges.test.ts` (создать)

**Interfaces:**
- Consumes: `edgeId`, `outboundTargets` из `entities/graph/edgeIds` (задача 5); `blockingInjectPrefix` из `entities/xray` (задача 6); CSS-правило `[data-accepts~='inj']` (задача 10).
- Produces: `tracedEdgeIds` доводит подсветку до `inj:<index>`; `TARGET_KINDS` пополняется `'inj'`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/topology-inject-edges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isValidConnection, tracedEdgeIds } from '../src/features/topology/TopologyView'
import { traceRoute, type GeoAnswers, type XrayConfig } from '../src/entities/xray'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }

const config = (): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: {
      rules: [{ type: 'field', domain: ['example.com'], inboundTag: ['socks'], outboundTag: 'proxy' }],
    },
  }) as unknown as XrayConfig

describe('подсветка трассы через группу подстановки', () => {
  it('ребро победителя ведёт к узлу группы, а не к несуществующему выходу', () => {
    const trace = traceRoute(config(), { address: 'example.com', network: 'tcp' }, NO_GEO)
    const ids = tracedEdgeIds(trace, config())
    expect([...ids]).toContain('e:rule:0->inj:0')
    expect([...ids]).toContain('e:in:socks->rule:0')
    expect([...ids]).not.toContain('e:rule:0->out:proxy')
  })

  it('кандидат балансера из группы подсвечивается один раз', () => {
    const withBal = {
      ...config(),
      routing: {
        rules: [{ type: 'field', domain: ['example.com'], balancerTag: 'bal' }],
        balancers: [{ tag: 'bal', selector: ['proxy'] }],
      },
    } as unknown as XrayConfig
    const trace = traceRoute(withBal, { address: 'example.com', network: 'tcp' }, NO_GEO)
    const ids = [...tracedEdgeIds(trace, withBal)]
    expect(ids.filter((id) => id === 'e:bal:bal->inj:0')).toHaveLength(1)
  })
})

describe('коммутация в группу', () => {
  it('правило и балансер могут вести в группу, а группа никуда не ведёт', () => {
    expect(isValidConnection({ source: 'rule:0', target: 'inj:0' })).toBe(true)
    expect(isValidConnection({ source: 'bal:b', target: 'inj:0' })).toBe(true)
    expect(isValidConnection({ source: 'inj:0', target: 'out:direct' })).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/topology-inject-edges.test.ts`
Expected: FAIL — `tracedEdgeIds` строит `e:rule:0->out:proxy`.

- [ ] **Step 3: Перевести `tracedEdgeIds` на общий хелпер**

В `frontend/src/features/topology/TopologyView.tsx` заменить тело:

```ts
export function tracedEdgeIds(result: TraceResult | undefined, config: XrayConfig): Set<string> {
  const ids = new Set<string>()
  const index = result?.winner?.ruleIndex
  if (index === undefined || index === null) return ids
  const rule = config.routing?.rules?.[index]
  if (!rule) return ids
  // Тот же резолвер, что у buildGraph: иначе подсветка целится в узел, которого нет
  const targetFor = outboundTargets(config)
  const inboundTags = (config.inbounds ?? []).map((i) => i.tag)
  const scope = rule.inboundTag?.length
    ? rule.inboundTag.filter((t) => inboundTags.includes(t))
    : inboundTags
  for (const tag of scope) ids.add(edgeId(`in:${tag}`, `rule:${index}`))
  if (rule.outboundTag) {
    const target = targetFor(rule.outboundTag)
    if (target !== undefined) ids.add(edgeId(`rule:${index}`, target))
  }
  if (rule.balancerTag) {
    ids.add(edgeId(`rule:${index}`, `bal:${rule.balancerTag}`))
    // Победителя среди кандидатов редактор не знает — подсвечиваем всех.
    // Set сам схлопывает несколько предсказанных тегов одной группы в одно ребро.
    for (const tag of result?.winner?.balancerCandidates ?? []) {
      const target = targetFor(tag)
      if (target !== undefined) ids.add(edgeId(`bal:${rule.balancerTag}`, target))
    }
  }
  return ids
}
```

Импорт: `import { edgeId, outboundTargets } from '../../entities/graph/edgeIds'`.

- [ ] **Step 4: Подсветить колонку групп как цель кабеля**

```ts
/** Колонки, куда вообще можно воткнуть кабель. Ключ — префикс id узла. */
const TARGET_KINDS = ['rule', 'out', 'bal', 'inj'] as const
```

Ничего больше менять не нужно: `PatchbayState` выводит набор из `isValidConnection`, а оформление уже лежит в `tokens.css` (задача 10).

- [ ] **Step 5: Не предлагать разворот там, где он сломает подстановку**

В обработчике `onEdgesDelete` и диалоге разворота: `expandSelector` теперь сам возвращает тот же конфиг, если префикс неразрешим, поэтому кнопка «Развернуть префикс» в этом случае обманывала бы. Перед показом диалога спросить `blockingInjectPrefix`:

```ts
  const blocked = expand ? blockingInjectPrefix(config, expand.balancerTag, expand.outboundTag) : undefined
```

и в самом диалоге:

```tsx
      <Dialog open={expand !== null} title="Убрать выход из балансера" onClose={() => setExpand(null)}>
        {blocked !== undefined ? (
          <>
            <p>
              Префикс «{blocked}» ловит и выход «{expand?.outboundTag}», и группу подстановки.
              Развернуть его в точные теги нельзя: сколько серверов подставит панель, знает только
              она — в селекторе замёрзли бы три предсказанных тега.
            </p>
            <p className="muted">
              Переименуйте выход так, чтобы он не попадал под префикс, либо правьте селектор в форме
              балансера.
            </p>
            <div className="row">
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setExpand(null)}>Понятно</Button>
            </div>
          </>
        ) : (
          <>
            {/* существующий текст и кнопка «Развернуть префикс» — без изменений */}
          </>
        )}
      </Dialog>
```

Импорт `blockingInjectPrefix` добавить к существующему импорту из `../../entities/xray`.

- [ ] **Step 6: Прогнать тесты**

Run из корня: `npm test && npm run typecheck -w frontend && npm run e2e -w frontend`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/topology/TopologyView.tsx frontend/test/topology-inject-edges.test.ts
git commit -m "feat(frontend): холст доводит трассу и кабели до групп подстановки"
```

---

### Task 12: Форма группы подстановки

Инвариант «ровно один способ именования из трёх» форма делает **невыразимым**: выбор одного снимает остальные — тот же приём, что уже применён к паре `outboundTag`/`balancerTag`.

**Files:**
- Create: `frontend/src/features/inspector/InjectGroupForm.tsx`
- Modify: `frontend/src/features/topology/NodeInspector.tsx`
- Modify: `frontend/src/entities/xray/inject.ts` (экспорт `TAG_SCHEME_KEYS`, функция `withTagScheme`)
- Modify: `frontend/src/entities/graph/mutations.ts` (взять `TAG_SCHEME_KEYS` из общего места)
- Test: `frontend/test/inject-group-form.test.tsx` (создать)

**Interfaces:**
- Consumes: `SELECT_FROM`, `SELECTOR_TYPES`, `predictedTags`, `tagScheme`, `describeSelector` из `entities/xray/inject`; `SelectField`, `TextField`, `StringListField` из `features/inspector/fields`.
- Produces: `InjectGroupForm({ value, onChange })`; `withTagScheme(group, scheme)` в `inject.ts`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/inject-group-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InjectGroupForm } from '../src/features/inspector/InjectGroupForm'
import { selectOption, selectedValue } from './helpers'

describe('форма группы подстановки', () => {
  it('показывает предсказанные теги для префиксной схемы', () => {
    render(<InjectGroupForm value={{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }} onChange={() => {}} />)
    expect(screen.getByText(/proxy, proxy-2, proxy-3/)).toBeInTheDocument()
  })

  it('смена способа именования снимает остальные — состояние «два сразу» невыразимо', async () => {
    const onChange = vi.fn()
    render(<InjectGroupForm value={{ selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy' }} onChange={onChange} />)
    await selectOption('Способ именования тегов', 'тег хоста')
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ useHostTagAsTag: true }),
    )
    const next = onChange.mock.calls[0]![0] as Record<string, unknown>
    expect(next.tagPrefix).toBeUndefined()
    expect(next.useHostRemarkAsTag).toBeUndefined()
  })

  it('для тегов панели честно предупреждает, что связи не выводятся', () => {
    render(<InjectGroupForm value={{ selector: { type: 'tagRegex' }, useHostRemarkAsTag: true }} onChange={() => {}} />)
    expect(screen.getByText(/знает только панель/)).toBeInTheDocument()
  })

  it('параметр селектора зависит от его типа', async () => {
    const onChange = vi.fn()
    render(<InjectGroupForm value={{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p' }} onChange={onChange} />)
    // У sameTagAsRecipient параметра нет
    expect(screen.queryByLabelText('Регулярное выражение')).not.toBeInTheDocument()
    await selectOption('Тип селектора', 'tagRegex — по регулярке на тег хоста')
    expect(onChange).toHaveBeenCalled()
  })

  it('пул по умолчанию показан как HIDDEN', () => {
    render(<InjectGroupForm value={{ selector: { type: 'uuids' } }} onChange={() => {}} />)
    expect(selectedValue('Пул выбора хостов')).toContain('HIDDEN')
  })
})
```

Сверить имена хелперов с `frontend/test/helpers.ts` — используются те же, что и в остальных тестах форм.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/inject-group-form.test.tsx`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Вынести перечень ключей схемы в `inject.ts`**

В `frontend/src/entities/xray/inject.ts`:

```ts
/**
 * Ключи способа именования. Их ровно три, и одновременно допустим только один —
 * поэтому любая правка одного снимает остальные два. Перечень общий для мутаций
 * графа и формы инспектора: разъехавшись, они позволили бы собрать невозможное.
 */
export const TAG_SCHEME_KEYS = ['tagPrefix', 'useHostRemarkAsTag', 'useHostTagAsTag'] as const

export type TagSchemeKey = (typeof TAG_SCHEME_KEYS)[number]

/** Переключает способ именования, снимая два остальных ключа */
export function withTagScheme(group: InjectGroup, key: TagSchemeKey, prefix = 'proxy'): InjectGroup {
  const next: Record<string, unknown> = { ...group }
  for (const k of TAG_SCHEME_KEYS) delete next[k]
  if (key === 'tagPrefix') next.tagPrefix = group.tagPrefix || prefix
  else next[key] = true
  return next as InjectGroup
}
```

В `frontend/src/entities/graph/mutations.ts` удалить локальную константу `TAG_SCHEME_KEYS` и импортировать её из `../xray/inject` — поведение `updateInjectGroup` не меняется.

- [ ] **Step 4: Написать форму**

Создать `frontend/src/features/inspector/InjectGroupForm.tsx`:

```tsx
// Группа подстановки: панель выберет по селектору хосты, построит из них
// outbound'ы и вставит в начало массива. Способ именования тегов ровно один из
// трёх — форма делает состояние «два сразу» невыразимым.

import {
  predictedTags,
  tagScheme,
  withTagScheme,
  type InjectGroup,
  type TagSchemeKey,
} from '../../entities/xray'
import { SelectField, StringListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const SELECTOR_OPTIONS: Option[] = [
  { value: 'sameTagAsRecipient', label: 'sameTagAsRecipient — хост с тем же тегом, что у получателя' },
  { value: 'tagRegex', label: 'tagRegex — по регулярке на тег хоста' },
  { value: 'remarkRegex', label: 'remarkRegex — по регулярке на примечание' },
  { value: 'uuids', label: 'uuids — по списку хостов' },
]

const POOL_OPTIONS: Option[] = [
  { value: 'HIDDEN', label: 'HIDDEN — скрытые хосты (по умолчанию)' },
  { value: 'NOT_HIDDEN', label: 'NOT_HIDDEN — видимые хосты' },
  { value: 'ALL', label: 'ALL — все хосты' },
]

const SCHEME_OPTIONS: Option[] = [
  { value: 'tagPrefix', label: 'префикс — proxy, proxy-2, proxy-3…' },
  { value: 'useHostRemarkAsTag', label: 'примечание хоста' },
  { value: 'useHostTagAsTag', label: 'тег хоста' },
]

function currentSchemeKey(group: InjectGroup): TagSchemeKey | '' {
  if (group.useHostRemarkAsTag === true) return 'useHostRemarkAsTag'
  if (group.useHostTagAsTag === true) return 'useHostTagAsTag'
  if (typeof group.tagPrefix === 'string') return 'tagPrefix'
  return ''
}

export function InjectGroupForm({
  value,
  onChange,
}: {
  value: Obj
  onChange: (next: Obj) => void
}) {
  const group = value as InjectGroup
  const selectorType = (group.selector?.type as string | undefined) ?? ''
  const scheme = tagScheme(group)
  const schemeKey = currentSchemeKey(group)
  const tags = predictedTags(group)

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <SelectField
        label="Тип селектора"
        hint="Как панель отберёт хосты для этой группы"
        value={selectorType}
        options={SELECTOR_OPTIONS}
        onChange={(type) =>
          patch((draft) => {
            const selector = (draft.selector as Obj | undefined) ?? {}
            // Параметр принадлежит типу: смена типа делает чужой параметр мусором
            delete selector.pattern
            delete selector.values
            selector.type = type
            draft.selector = selector
          })
        }
      />

      {(selectorType === 'tagRegex' || selectorType === 'remarkRegex') && (
        <TextField
          label="Регулярное выражение"
          mono
          hint={
            selectorType === 'tagRegex'
              ? 'Проверяется против тега хоста в панели, например ^RU-'
              : 'Проверяется против примечания хоста'
          }
          value={group.selector?.pattern}
          onChange={(pattern) =>
            patch((draft) => {
              const selector = (draft.selector as Obj | undefined) ?? {}
              if (pattern === undefined || pattern === '') delete selector.pattern
              else selector.pattern = pattern
              draft.selector = selector
            })
          }
        />
      )}

      {selectorType === 'uuids' && (
        <StringListField
          label="UUID хостов"
          mono
          hint="Список uuid из панели; пустой список не подставит ни одного сервера"
          value={group.selector?.values}
          onChange={(values) =>
            patch((draft) => {
              const selector = (draft.selector as Obj | undefined) ?? {}
              if (values === undefined || values.length === 0) delete selector.values
              else selector.values = values
              draft.selector = selector
            })
          }
        />
      )}

      <SelectField
        label="Пул выбора хостов"
        hint="Из каких хостов панели выбирать. Не задано — панель возьмёт HIDDEN"
        value={(group.selectFrom as string | undefined) ?? 'HIDDEN'}
        options={POOL_OPTIONS}
        onChange={(selectFrom) => patch((draft) => { draft.selectFrom = selectFrom })}
      />

      <SelectField
        label="Способ именования тегов"
        hint="Ровно один из трёх: выбор снимает остальные"
        value={schemeKey}
        options={SCHEME_OPTIONS}
        onChange={(key) => onChange(withTagScheme(group, key as TagSchemeKey) as Obj)}
      />

      {schemeKey === 'tagPrefix' && (
        <TextField
          label="Префикс тегов"
          mono
          hint="Первый выход получит сам префикс, следующие — префикс с номером"
          value={group.tagPrefix}
          onChange={(tagPrefix) =>
            patch((draft) => {
              if (tagPrefix === undefined || tagPrefix === '') delete draft.tagPrefix
              else draft.tagPrefix = tagPrefix
            })
          }
        />
      )}

      {scheme === 'prefix' && (
        <p className="field-hint">
          Правила и балансеры смогут ссылаться на {tags.join(', ')} — редактор проверяет такие
          ссылки. Сколько серверов подставится на самом деле, знает панель.
        </p>
      )}
      {scheme === 'panel' && (
        <p className="field-warning">
          Теги выходов знает только панель — редактор не может проверить ссылки на них, и проверки
          «неизвестный outbound» и «у балансера нет кандидатов» отключаются для всего документа.
        </p>
      )}
      {scheme === 'none' && (
        <p className="field-error">
          Способ именования не выбран — панель не сможет назвать подставленные выходы.
        </p>
      )}
    </>
  )
}
```

Сверить сигнатуры `SelectField`/`TextField`/`StringListField` с `features/inspector/fields.tsx` и подогнать имена пропсов под фактические.

- [ ] **Step 5: Подключить форму к инспектору**

В `frontend/src/features/topology/NodeInspector.tsx`:
- в `KIND_LABEL` дописать `inject: 'подстановка'`;
- в цепочку определения `kind` дописать ветку `nodeId.startsWith('inj:') ? 'inject'`;
- `rootKind` для `inject` — `null`: секции `remnawave` в словаре `docSchema` нет, и автоподсказки там врали бы (на вкладке «JSON узла» остаётся подсветка);
- добавить ветку рендера рядом с остальными формами:

```tsx
            {parsedNode !== null && kind === 'inject' && (
              <InjectGroupForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
              />
            )}
```

- [ ] **Step 6: Прогнать тесты**

Run из корня: `npm test && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/inspector/InjectGroupForm.tsx frontend/src/features/topology/NodeInspector.tsx frontend/src/entities/xray/inject.ts frontend/src/entities/graph/mutations.ts frontend/test/inject-group-form.test.tsx
git commit -m "feat(frontend): форма группы подстановки в инспекторе"
```

---

### Task 13: Список шаблонов, создание, удаление и переключатель разделов

**Files:**
- Create: `frontend/src/features/nav/SectionSwitch.tsx`
- Create: `frontend/src/features/templates/TemplatesPage.tsx`
- Create: `frontend/src/features/templates/CreateTemplateDialog.tsx`
- Modify: `frontend/src/features/profiles/ProfilesPage.tsx` (переключатель в шапку)
- Modify: `frontend/src/App.tsx` (маршрут `/templates`)
- Test: `frontend/test/templates-page.test.tsx` (создать)

**Interfaces:**
- Consumes: `useTemplates`, `useCreateTemplate`, `useDeleteTemplate` (задача 8); `useDraftStore` (для бейджа черновика); `usePositionsStore` (сброс позиций при удалении).
- Produces: `TemplatesPage`, `CreateTemplateDialog`, `SectionSwitch`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/templates-page.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplatesPage } from '../src/features/templates/TemplatesPage'

const TEMPLATES = [
  {
    uuid: 'a0000000-0000-4000-8000-000000000001',
    viewPosition: 0,
    name: 'Xray Default',
    tags: ['prod'],
    templateType: 'XRAY_JSON',
    templateJson: { outbounds: [] },
    encodedTemplateYaml: null,
  },
  {
    uuid: 'a0000000-0000-4000-8000-000000000002',
    viewPosition: 1,
    name: 'Mihomo',
    templateType: 'MIHOMO',
    templateJson: null,
    encodedTemplateYaml: 'eA==',
  },
]

function mockFetch(json: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  )
}

afterEach(() => vi.restoreAllMocks())

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/templates']}>
        <TemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('список шаблонов', () => {
  it('показывает шаблоны панели с типом', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    expect(await screen.findByText('Xray Default')).toBeInTheDocument()
    expect(screen.getByText('XRAY_JSON')).toBeInTheDocument()
  })

  // Прятать нельзя: список обязан отражать содержимое панели целиком
  it('неподдерживаемый тип показан, но без ссылки в редактор', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    expect(await screen.findByText('Mihomo')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mihomo' })).not.toBeInTheDocument()
    expect(screen.getByText(/откройте в панели/)).toBeInTheDocument()
  })

  it('XRAY_JSON открывается ссылкой в редактор', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    const link = await screen.findByRole('link', { name: 'Xray Default' })
    expect(link).toHaveAttribute('href', `/templates/${TEMPLATES[0]!.uuid}`)
  })

  it('пустой список предлагает создать первый шаблон', async () => {
    mockFetch({ templates: [] })
    renderPage()
    expect(await screen.findByText(/Шаблонов пока нет/)).toBeInTheDocument()
  })

  it('удаление спрашивает подтверждение', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    await screen.findByText('Xray Default')
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[0]!)
    await waitFor(() => expect(screen.getByText(/нельзя отменить/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/templates-page.test.tsx`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Переключатель разделов**

Создать `frontend/src/features/nav/SectionSwitch.tsx`:

```tsx
// Два раздела панели, которые правит редактор: конфиг-профили нод и шаблоны
// подписок. Переключатель стоит в шапке обоих списков — иначе о втором разделе
// узнать неоткуда.

import { Link, useLocation } from 'react-router'

export function SectionSwitch() {
  const { pathname } = useLocation()
  const onTemplates = pathname.startsWith('/templates')
  return (
    <nav className="segmented" aria-label="Разделы">
      <Link className="btn" to="/" aria-current={onTemplates ? undefined : 'page'} aria-pressed={!onTemplates}>
        Профили
      </Link>
      <Link className="btn" to="/templates" aria-current={onTemplates ? 'page' : undefined} aria-pressed={onTemplates}>
        Шаблоны
      </Link>
    </nav>
  )
}
```

Сверить класс кнопки с тем, что рисует `shared/ui/Button` (`.btn` либо другой): визуально ссылки обязаны совпасть с кнопками сегментированного переключателя редактора. Если класс другой — взять фактический.

- [ ] **Step 4: Диалог создания**

Создать `frontend/src/features/templates/CreateTemplateDialog.tsx` по образцу `CreateProfileDialog`, без выбора рецепта: панель создаёт шаблон пустым, а каркас заливает бэкенд (`STARTER_XRAY_TEMPLATE`).

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateTemplate } from '../../shared/api'
import { Button, Dialog, TextInput } from '../../shared/ui'

// Ограничение самой панели Remnawave (проверено на 3.4.3). Расширять нельзя:
// панель откажет всё равно, только позже и по-английски.
const NAME_RE = /^[A-Za-z0-9_\s-]{2,30}$/

export function CreateTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const create = useCreateTemplate()
  const navigate = useNavigate()
  const valid = NAME_RE.test(name)
  const invalid = name !== '' && !valid

  return (
    <Dialog open={open} title="Создать шаблон подписки" onClose={onClose}>
      {/* Разметка поля — как в CreateProfileDialog: лейбл связан по htmlFor */}
      <div className="field">
        <label className="field-label" htmlFor="template-name">
          Имя шаблона
        </label>
        <TextInput
          id="template-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Xray Default"
        />
        {invalid && (
          <span className="field-error">Имя: 2–30 символов, латиница, цифры, пробел, - и _</span>
        )}
        {create.isError && <span className="field-error">{(create.error as Error).message}</span>}
      </div>
      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button
          variant="primary"
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              { name },
              {
                onSuccess: (template) => {
                  onClose()
                  setName('')
                  // Создали — сразу открываем: пустой шаблон в списке бесполезен
                  navigate(`/templates/${template.uuid}`)
                },
              },
            )
          }
        >
          Создать
        </Button>
      </div>
    </Dialog>
  )
}
```

- [ ] **Step 5: Страница списка**

Создать `frontend/src/features/templates/TemplatesPage.tsx` по образцу `ProfilesPage`: та же `.page`/`.masthead`/`.profile-grid` раскладка и та же карточка `Card`. Существенные отличия:

```tsx
const EDITABLE: TemplateType = 'XRAY_JSON'

function TemplateCard({ template, hasDraft, index, onDelete }: …) {
  const editable = template.templateType === EDITABLE
  return (
    <Card className="profile-card" style={{ '--enter-delay': `${Math.min(index, 8) * 45}ms` } as CSSProperties}>
      <div className="row">
        <h2>
          {editable ? (
            <Link className="card-link" to={`/templates/${template.uuid}`}>{template.name}</Link>
          ) : (
            template.name
          )}
        </h2>
        <span className="spacer" />
        <Chip dir="none">{template.templateType}</Chip>
        {hasDraft && <Chip dir="none">черновик</Chip>}
        <button type="button" className="icon-btn" aria-label="Удалить" onClick={onDelete}>
          {/* та же иконка корзины, что в ProfileCard */}
        </button>
      </div>
      {!editable && (
        // Прятать такие шаблоны нельзя: список обязан отражать панель целиком
        <p className="muted">Редактор пока не поддерживает этот тип — откройте в панели Remnawave.</p>
      )}
      {template.tags?.length ? (
        <div className="row-wrap">{template.tags.map((t) => <Chip key={t} dir="none">{t}</Chip>)}</div>
      ) : null}
    </Card>
  )
}
```

Шапка: `<SectionSwitch />`, заголовок «Шаблоны подписок», счётчик, кнопка «Создать шаблон», кнопка «Выйти» — как в `ProfilesPage`. Пустое состояние: заголовок «Шаблонов пока нет», подсказка «Создайте первый — он сразу появится в панели Remnawave». Удаление: тот же диалог подтверждения, в `onSuccess` — `useDraftStore.getState().clearDraft(uuid)` и `usePositionsStore.getState().resetPositions(uuid)`.

- [ ] **Step 6: Переключатель в список профилей и маршрут**

В `frontend/src/features/profiles/ProfilesPage.tsx` добавить `<SectionSwitch />` в `.masthead` перед `<span className="spacer" />`.

В `frontend/src/App.tsx`:

```tsx
const TemplatesPage = lazy(() =>
  import('./features/templates/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
)
```

и маршрут:

```tsx
            <Route
              path="/templates"
              element={
                <RequireAuth>
                  <TemplatesPage />
                </RequireAuth>
              }
            />
```

- [ ] **Step 7: Прогнать тесты**

Run из корня: `npm test && npm run typecheck -w frontend && npm run e2e -w frontend && npm run build -w frontend`
Expected: PASS. Тест списка профилей, если он проверял содержимое шапки строго, поправить под появившийся переключатель.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/features/nav frontend/src/features/templates frontend/src/features/profiles/ProfilesPage.tsx frontend/src/App.tsx frontend/test/templates-page.test.tsx
git commit -m "feat(frontend): список шаблонов, создание и удаление"
```

---

### Task 14: Страница редактора шаблона

**Files:**
- Create: `frontend/src/features/templates/TemplateEditorPage.tsx`
- Modify: `frontend/src/App.tsx` (маршрут `/templates/:uuid`)
- Test: `frontend/test/template-editor.test.tsx` (создать)

**Interfaces:**
- Consumes: `useConfigDraft` (задача 7), `Workbench` (задача 9), `useTemplate`/`useSaveTemplate` и `ConflictError` (задача 8), `SaveDialog` из `features/editor`.
- Produces: `TemplateEditorPage`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/template-editor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from '../src/features/templates/TemplateEditorPage'

const UUID = 'a0000000-0000-4000-8000-000000000001'

const TEMPLATE_JSON = {
  remnawave: {
    addVirtualHostAsOutbound: false,
    injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' }],
  },
  log: { loglevel: 'warning' },
  inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: {} }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

function mockPanel(type = 'XRAY_JSON') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/api/panel/token')
        ? { expiresAt: null, daysLeft: null, expired: false, expiringSoon: false }
        : {
            template: {
              uuid: UUID,
              viewPosition: 0,
              name: 'Xray Default',
              templateType: type,
              templateJson: type === 'XRAY_JSON' ? TEMPLATE_JSON : null,
              encodedTemplateYaml: null,
            },
            hash: 'b'.repeat(64),
          }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

afterEach(() => vi.restoreAllMocks())

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/templates/${UUID}`]}>
        <Routes>
          <Route path="/templates/:uuid" element={<TemplateEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('редактор шаблона', () => {
  it('открывает шаблон в общей оболочке', async () => {
    mockPanel()
    renderEditor()
    expect(await screen.findByRole('heading', { name: 'Xray Default' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Топология' })).toBeInTheDocument()
  })

  // Ровно то, чего в шаблоне быть не должно
  it('в топбаре нет проверки ядром и рецептов', async () => {
    mockPanel()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })
    expect(screen.queryByRole('button', { name: 'Проверить конфиг' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Рецепт/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Куда пойдёт трафик' })).toBeInTheDocument()
  })

  it('YAML-шаблон не открывается, а объясняет почему', async () => {
    mockPanel('MIHOMO')
    renderEditor()
    expect(await screen.findByText(/только шаблоны XRAY_JSON/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/template-editor.test.tsx`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать страницу**

Создать `frontend/src/features/templates/TemplateEditorPage.tsx`:

```tsx
// Редактор шаблона подписки. Отличий от редактора профиля ровно четыре: база
// черновика — хэш содержимого (updatedAt у шаблонов нет), сохранение шлёт
// expectedHash, контекст графа пуст (сквадов у шаблона нет), а проверки ядром и
// рецептов в топбаре нет — они про конфиг ноды, а не про клиентскую подписку.

import { useState } from 'react'
import { useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useSaveTemplate,
  useTemplate,
  type SubscriptionTemplate,
} from '../../shared/api'
import { Button, Dialog } from '../../shared/ui'
import { SaveDialog } from '../editor/SaveDialog'
import { Workbench } from '../editor/Workbench'
import { useConfigDraft } from '../editor/useConfigDraft'

// Контекст графа у шаблона пуст: buildGraph уже фильтрует сквады по реально
// существующим тегам inbound'ов, поэтому колонка сквадов просто не появится.
const NO_CONTEXT = {}

function TemplateEditor({ template, hash }: { template: SubscriptionTemplate; hash: string }) {
  const qc = useQueryClient()
  const draft = useConfigDraft({
    docKey: template.uuid,
    panelConfig: template.templateJson,
    baseVersion: hash,
    ctx: NO_CONTEXT,
  })
  const save = useSaveTemplate(template.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<{ template: SubscriptionTemplate; hash?: string } | null>(null)

  function doSave(expectedHash: string) {
    save.mutate(
      { templateJson: draft.validation.config, expectedHash },
      {
        onSuccess: () => {
          draft.clearAfterSave()
          setSaveOpen(false)
          setConflict(null)
        },
        onError: (err) => {
          if (err instanceof ConflictError) {
            setSaveOpen(false)
            // Роут шаблонов кладёт в `current` шаблон, а рядом — его хэш
            setConflict({ template: err.current as SubscriptionTemplate, hash: err.hash })
          }
        },
      },
    )
  }

  const saveError =
    save.isError && !(save.error instanceof ConflictError) ? (save.error as Error).message : undefined

  return (
    <Workbench
      draft={draft}
      kind="templates"
      back={{ to: '/templates', label: '← Шаблоны' }}
      title={template.name}
      subtitle={`шаблон ${template.templateType}`}
      statusExtra={saveError && <span className="field-error">{saveError}</span>}
      save={
        <Button
          variant="primary"
          disabled={draft.hasErrors || !draft.dirty || save.isPending}
          onClick={() => setSaveOpen(true)}
        >
          Сохранить в панель
        </Button>
      }
    >
      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        original={draft.panelText}
        modified={draft.text}
        issues={draft.validation.issues}
        busy={save.isPending}
        onConfirm={() => doSave(draft.baseVersion)}
        error={saveError}
      />

      <Dialog open={conflict !== null} title="Конфликт версий" onClose={() => setConflict(null)}>
        {/* У шаблонов нет updatedAt — сказать «когда» нечем, только «что» */}
        <p>Шаблон был изменён в панели после того, как вы его открыли. Выберите, что делать:</p>
        <div className="row">
          <span className="spacer" />
          <Button
            variant="ghost"
            onClick={() => {
              if (!conflict) return
              draft.adoptPanelVersion()
              qc.setQueryData(['templates', template.uuid], {
                template: conflict.template,
                hash: conflict.hash,
              })
              qc.invalidateQueries({ queryKey: ['templates'], exact: true })
              setConflict(null)
            }}
          >
            Загрузить версию панели
          </Button>
          <Button
            variant="danger"
            disabled={save.isPending || draft.hasErrors || conflict?.hash === undefined}
            onClick={() => {
              if (conflict?.hash) doSave(conflict.hash)
            }}
          >
            Перезаписать
          </Button>
        </div>
      </Dialog>
    </Workbench>
  )
}

export function TemplateEditorPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const query = useTemplate(uuid!)

  if (query.isPending) return <main style={{ padding: 24 }} className="muted">Загрузка шаблона…</main>
  if (query.isError) {
    return <main style={{ padding: 24 }} className="field-error">{(query.error as Error).message}</main>
  }
  const { template, hash } = query.data
  // YAML-типы держат содержимое в encodedTemplateYaml, а templateJson у них null:
  // открыть их этим редактором нельзя, и молчать об этом — худшее из решений
  if (template.templateType !== 'XRAY_JSON') {
    return (
      <main style={{ padding: 24 }}>
        <p>
          Редактор пока умеет только шаблоны XRAY_JSON, а «{template.name}» — {template.templateType}.
          Откройте его в панели Remnawave.
        </p>
        <Button variant="ghost" onClick={() => window.history.back()}>← Шаблоны</Button>
      </main>
    )
  }
  return <TemplateEditor template={template} hash={hash} />
}
```

- [ ] **Step 4: Маршрут**

В `frontend/src/App.tsx`:

```tsx
const TemplateEditorPage = lazy(() =>
  import('./features/templates/TemplateEditorPage').then((m) => ({ default: m.TemplateEditorPage })),
)
```

```tsx
            <Route
              path="/templates/:uuid"
              element={
                <RequireAuth>
                  <TemplateEditorPage />
                </RequireAuth>
              }
            />
```

- [ ] **Step 5: Прогнать тесты**

Run из корня: `npm test && npm run typecheck -w frontend && npm run build -w frontend`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/templates/TemplateEditorPage.tsx frontend/src/App.tsx frontend/test/template-editor.test.tsx
git commit -m "feat(frontend): редактор шаблона подписки"
```

---

### Task 15: E2E-сценарии шаблонов

**Files:**
- Modify: `frontend/e2e/mocks.ts` (моки шаблонов)
- Create: `frontend/e2e/templates.spec.ts`

**Interfaces:**
- Consumes: `mockApi`, `pickOption` из `frontend/e2e/helpers.ts` и `mocks.ts`.
- Produces: `mockTemplates(page)` — отдельная функция, чтобы существующие спеки профилей не начали получать лишние маршруты.

- [ ] **Step 1: Добавить моки**

В `frontend/e2e/mocks.ts`:

```ts
export const TEMPLATE_UUID = '22222222-2222-4222-8222-222222222222'

export const TEMPLATE_JSON = {
  remnawave: {
    addVirtualHostAsOutbound: false,
    injectHosts: [
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
    ],
  },
  log: { loglevel: 'warning' },
  inbounds: [
    { tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { udp: true } },
  ],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{ type: 'field', domain: ['ya.ru'], outboundTag: 'proxy' }] },
}

export const TEMPLATE = {
  uuid: TEMPLATE_UUID,
  viewPosition: 0,
  name: 'Xray Default',
  tags: ['prod'],
  templateType: 'XRAY_JSON',
  templateJson: TEMPLATE_JSON,
  encodedTemplateYaml: null,
}

const TEMPLATE_HASH = 'c'.repeat(64)

/**
 * Маршруты шаблонов. Отдельно от mockApi: спекам профилей они не нужны, а
 * лишний перехват маскировал бы настоящие запросы.
 * `conflict: true` заставляет PATCH отвечать 409 — сценарий конфликта.
 */
export async function mockTemplates(page: Page, opts: { conflict?: boolean } = {}) {
  await page.route('**/api/templates', (r) => {
    if (r.request().method() === 'POST') {
      return r.fulfill({
        status: 201,
        json: { template: { ...TEMPLATE, uuid: '33333333-3333-4333-8333-333333333333', name: 'New One' } },
      })
    }
    return r.fulfill({ json: { templates: [TEMPLATE, {
      uuid: '44444444-4444-4444-8444-444444444444',
      viewPosition: 1,
      name: 'Mihomo',
      templateType: 'MIHOMO',
      templateJson: null,
      encodedTemplateYaml: 'eA==',
    }] } })
  })

  await page.route(`**/api/templates/${TEMPLATE_UUID}/backups`, (r) =>
    r.fulfill({ json: { backups: [] } }),
  )

  await page.route(`**/api/templates/${TEMPLATE_UUID}`, (r) => {
    const method = r.request().method()
    if (method === 'DELETE') return r.fulfill({ json: { ok: true } })
    if (method === 'PATCH') {
      if (opts.conflict) {
        return r.fulfill({
          status: 409,
          json: {
            message: 'Шаблон был изменён в панели после открытия',
            current: TEMPLATE,
            hash: 'd'.repeat(64),
          },
        })
      }
      return r.fulfill({ json: { template: TEMPLATE, hash: TEMPLATE_HASH } })
    }
    return r.fulfill({ json: { template: TEMPLATE, hash: TEMPLATE_HASH } })
  })
}
```

- [ ] **Step 2: Написать спеку**

Создать `frontend/e2e/templates.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { mockApi, mockTemplates, TEMPLATE_UUID } from './mocks'
import { pickOption } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('список шаблонов открывается переключателем из профилей', async ({ page }) => {
  await mockTemplates(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'Шаблоны' }).click()
  await expect(page.getByRole('link', { name: 'Xray Default' })).toBeVisible()
  // Неподдерживаемый тип виден, но не кликается
  await expect(page.getByText('Mihomo')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mihomo' })).toHaveCount(0)
})

test('группа подстановки нарисована на холсте и правится формой', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  const group = page.locator('.react-flow__node[data-id="inj:0"]')
  await expect(group).toBeVisible()
  await expect(group).toContainText('proxy')
  await group.click()
  await pickOption(page, 'Пул выбора хостов', 'ALL — все хосты')
  await expect(page.getByRole('button', { name: 'Сохранить в панель' })).toBeEnabled()
})

test('в топбаре шаблона нет проверки ядром и рецептов', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await expect(page.getByRole('button', { name: 'Проверить конфиг' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Рецепт/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Куда пойдёт трафик' })).toBeVisible()
})

test('трассировка называет подстановку, а не выдуманный выход', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await page.getByLabel(/Адрес|Куда/).first().fill('ya.ru')
  await expect(page.getByText(/подстановка|подставит панель/)).toBeVisible({ timeout: 5000 })
})

test('сохранение проходит и черновик исчезает', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.locator('.react-flow__node[data-id="inj:0"]').click()
  await pickOption(page, 'Пул выбора хостов', 'ALL — все хосты')
  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  await page.getByRole('button', { name: /Сохранить|Подтвердить/ }).last().click()
  await expect(page.getByText('черновик')).toHaveCount(0)
})

test('конфликт по хэшу предлагает загрузить версию панели', async ({ page }) => {
  await mockTemplates(page, { conflict: true })
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.locator('.react-flow__node[data-id="inj:0"]').click()
  await pickOption(page, 'Пул выбора хостов', 'ALL — все хосты')
  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  await page.getByRole('button', { name: /Сохранить|Подтвердить/ }).last().click()
  await expect(page.getByText('Конфликт версий')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Загрузить версию панели' })).toBeVisible()
})

test('создание уводит в редактор нового шаблона', async ({ page }) => {
  await mockTemplates(page)
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Создать шаблон' }).click()
  await page.getByLabel('Имя шаблона').fill('New One')
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page).toHaveURL(/\/templates\/33333333/)
})

test('удаление спрашивает подтверждение', async ({ page }) => {
  await mockTemplates(page)
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Удалить' }).first().click()
  await expect(page.getByText(/нельзя отменить/)).toBeVisible()
})
```

Точные подписи кнопок и полей сверить с получившимся UI; менять UI под тест нельзя, менять тест под UI — можно.

- [ ] **Step 3: Прогнать e2e**

Run из каталога `frontend`: `npm run e2e`
Expected: все спеки зелёные, включая прежние.

- [ ] **Step 4: Коммит**

```bash
git add frontend/e2e/mocks.ts frontend/e2e/templates.spec.ts
git commit -m "test(frontend): e2e шаблонов подписки"
```

---

### Task 16: Документация

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (короткий абзац о разделе шаблонов)

- [ ] **Step 1: Обновить `CLAUDE.md`**

Дополнить разделы, ничего не переписывая целиком:

- в «Что это» — что редактор работает с двумя сущностями панели: конфиг-профилями нод и шаблонами подписок;
- в «Backend» — `routes/templates.ts` (пять роутов, PATCH сравнивает **хэш содержимого**, потому что `updatedAt` у шаблонов нет), `templates/hash.ts` (канонизация: рекурсивная сортировка ключей, порядок массивов сохраняется), `templates/starter.ts`, пространство бэкапов `DATA_DIR/backups/templates/<uuid>/`, `routes/nameSchema.ts` (регулярка зеркалит панель), контрактный тест типов против `@remnawave/backend-contract`;
- в «Frontend» — `entities/xray/inject.ts` (директива `remnawave.injectHosts`, предсказание тегов и его границы), узел графа `inj:<index>` в колонке выходов, `entities/graph/edgeIds.ts` (единственная схема id рёбер), `features/editor/useConfigDraft.ts` + `Workbench.tsx` (общая оболочка двух редакторов), `features/templates/*`;
- в «Особенности домена» — три пункта: панель вставляет инжектируемые outbound'ы **в начало массива** (отсюда дефолтный маршрут трассировки); при `useHostRemarkAsTag`/`useHostTagAsTag` теги знает только панель, и проверки ссылок подавляются целиком; `expandSelector` не разворачивает префиксы, ловящие инжектируемые теги;
- в «Документация» — упомянуть спеку и оба плана шаблонов.

- [ ] **Step 2: Обновить `README.md`**

Добавить в описание возможностей абзац: редактор правит и шаблоны подписок (XRAY_JSON), показывая группы подстановки `remnawave.injectHosts` как узлы графа; YAML-типы (Mihomo, Clash, Stash) видны в списке, но правятся в панели.

- [ ] **Step 3: Коммит**

```bash
git add CLAUDE.md README.md
git commit -m "docs: раздел шаблонов подписок"
```

---

### Task 17: Проверка записи на живой панели

Контракт чтения и записи уже проверялся в плане 1, но UI-путь целиком (создание из диалога → правка формой → сохранение с хэшем → конфликт → удаление) вживую не проходил ни разу.

**Files:**
- Временный файл вне репозитория (в каталоге для временных файлов сессии), в git не попадает.

- [ ] **Step 1: Поднять локальную сборку против настоящей панели**

Run из корня: `npm run build && npm run dev` с рабочим `.env` (боевой `REMNAWAVE_URL` и свежий токен) и `npm run dev:frontend` во второй консоли.

- [ ] **Step 2: Пройти сценарий руками**

1. `/templates` — список показывает все шаблоны панели, включая YAML-типы, и не показывает лишнего.
2. Создать шаблон с именем `Plan2 Smoke` — открывается редактор, на холсте есть узел группы `inj:0`, в колонке выходов.
3. Поменять пул выбора на `ALL` формой, сохранить — панель приняла, черновик исчез.
4. Изменить тот же шаблон **в панели** и попробовать сохранить ещё раз — появился диалог конфликта; «Загрузить версию панели» подтягивает свежую версию.
5. «Куда пойдёт трафик» на домене из правила — в разборе назван выход подстановки, а не выдуманный `proxy`.
6. «Версии» — виден бэкап, снятый перед сохранением; сравнение с черновиком открывается.
7. Удалить `Plan2 Smoke` — исчез и из редактора, и из панели.

- [ ] **Step 3: Убедиться, что чужие шаблоны не тронуты**

Сверить список шаблонов панели до и после: изменённым должен быть только `Plan2 Smoke`, и его в конце не остаётся.

- [ ] **Step 4: Зафиксировать результат**

```bash
git status --porcelain   # пусто: временный файл в репозиторий не попал
git commit --allow-empty -m "chore: UI шаблонов проверен на живой панели 3.4.3"
```

Если что-то из шагов не сработало — это находка, а не повод пропустить шаг: чинить и прогонять сценарий заново.

---


---

### Task 18: Разрыв рёбер, ведущих в группы подстановки

Добавлена по итогам ревью задачи 11. План 1 отложил этот вопрос словами «пока
рёбра не отрисованы и не удаляемы пользователем, он не горит» — задача 10 их
отрисовала, и он загорелся. Сейчас `disconnectEdge` не знает целей `inj:<index>`,
поэтому разрыв такого кабеля возвращает тот же конфиг: React Flow уже убрал ребро
из своего состояния, а пересборки графа не будет (конфиг-то не изменился), и
кабель молча исчезает с холста, ничего не изменив в документе. Это ложь
интерфейса, а не просто отсутствие фичи.

**Files:**
- Modify: `frontend/src/entities/graph/mutations.ts`
- Modify: `frontend/src/features/topology/TopologyView.tsx`
- Test: `frontend/test/graph-inject-disconnect.test.ts` (создать)

**Interfaces:**
- Consumes: `predictedTags`, `injectGroupsOf` из `entities/xray/inject`; `matchPrefixes` из `entities/xray/balancers`.
- Produces: `disconnectEdge` понимает `e:rule:<i>->inj:<g>` и `e:bal:<tag>->inj:<g>`; экспортируется `blockingGroupPrefix(config, balancerTag, groupIndex): string | undefined` из `entities/graph/mutations.ts`.

**Семантика, симметричная существующей:**

| Ребро | Что делает разрыв | Почему так |
|---|---|---|
| `rule:<i> -> inj:<g>` | удаляет правило целиком | ровно как `rule -> out`: правило без назначения бессмысленно |
| `bal:<tag> -> inj:<g>` | убирает из селектора префиксы, ловящие эту группу | обратная операция к `attachInjectGroupToBalancer`, которая их туда и добавила |
| `bal:<tag> -> inj:<g>`, где префикс ловит ещё и статический выход | ТОТ ЖЕ конфиг | убрать группу, не потеряв статического кандидата, нечем — тот же тупик, что у `blockingInjectPrefix` в обратную сторону |

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/graph-inject-disconnect.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { blockingGroupPrefix, disconnectEdge } from '../src/entities/graph/mutations'
import type { XrayConfig } from '../src/entities/xray'

const base = (selector: string[], outbounds: string[]): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    outbounds: outbounds.map((tag) => ({ tag, protocol: 'freedom' })),
    routing: {
      balancers: [{ tag: 'bal', selector }],
      rules: [
        { type: 'field', domain: ['a.test'], outboundTag: 'proxy' },
        { type: 'field', domain: ['b.test'], outboundTag: 'direct' },
      ],
    },
  }) as unknown as XrayConfig

describe('разрыв ребра «правило → группа»', () => {
  it('удаляет правило целиком, как и ребро правило → выход', () => {
    const next = disconnectEdge(base(['proxy'], ['direct']), 'e:rule:0->inj:0')
    expect(next.routing!.rules).toHaveLength(1)
    expect(next.routing!.rules![0]!.domain).toEqual(['b.test'])
  })

  it('несуществующее правило не роняет и ничего не портит', () => {
    const config = base(['proxy'], ['direct'])
    const next = disconnectEdge(config, 'e:rule:9->inj:0')
    expect(next.routing!.rules).toHaveLength(2)
  })
})

describe('разрыв ребра «балансер → группа»', () => {
  it('убирает из селектора префикс, ловящий группу', () => {
    const next = disconnectEdge(base(['proxy', 'eu-'], ['eu-1']), 'e:bal:bal->inj:0')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-'])
  })

  it('убирает все префиксы, ловящие эту группу', () => {
    const next = disconnectEdge(base(['proxy', 'proxy-', 'eu-'], ['eu-1']), 'e:bal:bal->inj:0')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-'])
  })

  // Тот же тупик, что у blockingInjectPrefix, только с другой стороны
  it('префикс, ловящий заодно статический выход, убрать нельзя — тот же конфиг', () => {
    const config = base(['proxy'], ['proxy-eu'])
    expect(blockingGroupPrefix(config, 'bal', 0)).toBe('proxy')
    expect(disconnectEdge(config, 'e:bal:bal->inj:0')).toBe(config)
  })

  it('обычный разрыв блокировкой не считается', () => {
    expect(blockingGroupPrefix(base(['proxy', 'eu-'], ['eu-1']), 'bal', 0)).toBeUndefined()
  })

  it('неизвестный балансер возвращает тот же конфиг', () => {
    const config = base(['proxy'], ['direct'])
    expect(disconnectEdge(config, 'e:bal:нет-такого->inj:0')).toBe(config)
  })

  it('группа с тегами от панели префиксов не имеет — ребра к ней не бывает', () => {
    const config = {
      remnawave: { injectHosts: [{ selector: { type: 'tagRegex' }, useHostTagAsTag: true }] },
      outbounds: [{ tag: 'direct' }],
      routing: { balancers: [{ tag: 'bal', selector: ['direct'] }], rules: [] },
    } as unknown as XrayConfig
    expect(disconnectEdge(config, 'e:bal:bal->inj:0')).toBe(config)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run из каталога `frontend`: `npx vitest run test/graph-inject-disconnect.test.ts`
Expected: FAIL — `blockingGroupPrefix` не экспортируется, `disconnectEdge` возвращает тот же конфиг.

- [ ] **Step 3: Научить `disconnectEdge` целям `inj:`**

В `frontend/src/entities/graph/mutations.ts`, рядом с остальными регулярками рёбер:

```ts
// Цели-группы: тег такого выхода в конфиге отсутствует, поэтому ребро ведёт к
// узлу группы, а не к out:<tag>
const EDGE_RULE_INJ = /^e:rule:(\d+)->inj:(\d+)$/
const EDGE_BAL_INJ = /^e:bal:(.+)->inj:(\d+)$/
```

Рядом с `blockingInjectPrefix` по смыслу, но в этом файле:

```ts
/**
 * Префикс селектора, который ловит и группу, и статический выход. Убрать группу
 * из балансера, не потеряв статического кандидата, таким префиксом нельзя —
 * это тот же тупик, что у blockingInjectPrefix, только с другой стороны.
 */
export function blockingGroupPrefix(
  config: XrayConfig,
  balancerTag: string,
  groupIndex: number,
): string | undefined {
  const group = config.remnawave?.injectHosts?.[groupIndex]
  const balancer = (config.routing?.balancers ?? []).find((b) => b.tag === balancerTag)
  if (!group || !balancer) return undefined
  const tags = predictedTags(group)
  if (tags.length === 0) return undefined
  const statics = (config.outbounds ?? []).map((o) => o.tag)
  return (balancer.selector ?? [])
    .filter((p) => matchPrefixes(tags, [p]).length > 0)
    .find((p) => matchPrefixes(statics, [p]).length > 0)
}
```

И две ветки в `disconnectEdge`, перед возвратом по умолчанию:

```ts
  const ruleInj = EDGE_RULE_INJ.exec(edgeId)
  if (ruleInj) {
    // Правило без назначения бессмысленно — удаляем целиком, как и для rule→out
    const next = clone(config)
    next.routing?.rules?.splice(Number(ruleInj[1]), 1)
    return next
  }
  const balInj = EDGE_BAL_INJ.exec(edgeId)
  if (balInj) {
    const groupIndex = Number(balInj[2])
    const group = config.remnawave?.injectHosts?.[groupIndex]
    const i = balancerIndex(config, balInj[1]!)
    // Теги группы, которые знает только панель, префиксом не ловятся вовсе —
    // такого ребра и не бывает
    const tags = group ? predictedTags(group) : []
    if (i === -1 || tags.length === 0) return config
    if (blockingGroupPrefix(config, balInj[1]!, groupIndex) !== undefined) return config
    const selector = config.routing!.balancers![i]!.selector ?? []
    const next = clone(config)
    next.routing!.balancers![i]!.selector = selector.filter(
      (p) => matchPrefixes(tags, [p]).length === 0,
    )
    return next
  }
```

Импорты `predictedTags` и `matchPrefixes` в этом файле уже есть либо добавляются.

- [ ] **Step 4: Объяснить тупик на холсте**

В `frontend/src/features/topology/TopologyView.tsx` разрыв ребра к группе, упёршийся
в общий префикс, сейчас молча ничего не делает. Диалог для этого уже есть — он
рассказывает про неразрешимый префикс; расширяем его на второй случай.

Рядом с `EDGE_BAL_OUT` добавить:

```ts
const EDGE_BAL_INJ = /^e:bal:(.+)->inj:(\d+)$/
```

В `onEdgesDelete`, там где считается `pending`, распознать и второй случай:

```ts
        const inj = EDGE_BAL_INJ.exec(edge.id)
        if (next === before && inj) {
          const prefix = blockingGroupPrefix(next, inj[1]!, Number(inj[2]))
          if (prefix !== undefined) setGroupBlock({ balancerTag: inj[1]!, prefix })
        }
```

и завести под это состояние рядом с `expand`:

```ts
  const [groupBlock, setGroupBlock] = useState<{ balancerTag: string; prefix: string } | null>(null)
```

плюс диалог тем же языком, что и соседний:

```tsx
      <Dialog
        open={groupBlock !== null}
        title="Убрать группу из балансера"
        onClose={() => setGroupBlock(null)}
      >
        <p>
          Префикс «{groupBlock?.prefix}» ловит и группу подстановки, и обычный выход балансера
          «{groupBlock?.balancerTag}». Убрать одну группу, не потеряв статического кандидата, им
          нельзя.
        </p>
        <p className="muted">
          Разведите их: переименуйте статический выход либо задайте группе другой префикс тегов в
          её форме.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setGroupBlock(null)}>
            Понятно
          </Button>
        </div>
      </Dialog>
```

- [ ] **Step 5: Прогнать тесты**

Run из корня: `npm test && npm run typecheck -w frontend && npm run e2e -w frontend`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/graph/mutations.ts frontend/src/features/topology/TopologyView.tsx frontend/test/graph-inject-disconnect.test.ts
git commit -m "feat(frontend): разрыв кабеля к группе подстановки"
```
## Что этот план НЕ делает

- **Редакторы MIHOMO, CLASH, STASH, SINGBOX, XRAY_BASE64.** Порядок следующих итераций задан пользователем: Mihomo, Clash, Stash, затем Sing-box. Их содержимое лежит в `encodedTemplateYaml`, а не в `templateJson`, и требует своего разбора и своего графа.
- **Проверка шаблона ядром Xray и рецепты.** Ядру пришлось бы снимать объект `remnawave` и подставлять фиктивные outbound'ы вместо инжектируемых.
- **Редактирование `tags` шаблона.** Редактор их сохраняет и показывает, но не правит.
- **Перестановка шаблонов (`viewPosition`).**
- **Переименование пропа `profileUuid` у `TopologyView`** в нейтральное `docKey`: механическая правка, задевающая много файлов и тестов сразу, — отдельным коммитом, когда шаблоны устоятся.
- **Автоподсказки JSON для секции `remnawave`.** `docSchema` её не знает, и на вкладке «JSON узла» у группы работает только подсветка. Словарь дописывается отдельно — вместе с ним же стоит покрыть и остальные незадокументированные секции.

## Долги, оставленные планом 2

Собраны по итогам финального ревью ветки и живой проверки. Ни один не ломает
работающий код — это места, где решение отложено сознательно.

- **`fallbackTag` мимо `outboundTargets`.** Ребро запасного выхода балансера
  строится своим кодом; если fallback указывает на инжектируемый тег, ребро
  ведёт в несуществующий `out:<tag>`. Свести на общий резолвер из
  `entities/graph/edgeIds.ts`.
- **Предсказанный тег перекрывает статический outbound.** `tagPrefix: 'proxy'`
  при существующем outbound'е `proxy` даёт два разных выхода под одним именем;
  редактор молчит. Нужно предупреждение валидации.
- **Осиротевшие `updateInjectGroup`/`removeInjectGroup`.** Вторая реализация
  правила «ровно один ключ схемы из трёх», без единого потребителя после того,
  как форма пошла через `applyNodeJson`. Удалить.
- **`tagPrefix` удаляется на пустом вводе.** Пользователь стирает поле, чтобы
  набрать новое значение, — схема на этот момент переключается на `none`.
  Хранить пустую строку до ухода фокуса.
- **Пустой `pattern` у правила инжекта** не вызывает предупреждения.
- **`NAME_RE`** продублирована фронтендом и бэкендом — вынести в `shared/lib`.
- **`draftStore`/`positionsStore` живут в одном пространстве ключей** для
  профилей и шаблонов. Uuid профиля и шаблона могут совпасть — тогда черновик
  одного документа откроется в другом. Разделить префиксом вида документа.
- **`templateJson: null` у шаблона `XRAY_JSON`.** Панель такое отдаёт для
  только что созданного пустого шаблона; поведение редактора не определено.
- **`docker-compose.yml` тянет образ из ghcr, а не собирает исходники.** Это
  верно для пользователей и неверно для разработки: собранная локально ветка
  не попадает в контейнер, и раздел шаблонов «пропадает». Развилку с
  `docker-compose.build.yml` стоит сделать заметнее в README и в шапке самого
  compose-файла.
- **`test/intellisense.test.ts` флейкует под нагрузкой.** `ensureSyntaxTree`
  считает бюджет по стенным часам, и на загруженной машине разбор не успевает
  за 5 с. Изолированный прогон всегда зелёный. Дать тесту свой таймаут либо
  бюджет побольше.

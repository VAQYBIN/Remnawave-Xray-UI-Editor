# Схема форм и полный редактор Mihomo — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Редактор шаблонов Mihomo на общем слое схемы и форм: шаблон собирается с нуля кнопками, формами и панелью «Документ», ни разу не открывая вкладку YAML, а якоря, слияния и комментарии авторского файла переживают правки.

**Architecture:** Словарь Mihomo становится деревом `FieldSchema` по ветвям (`entities/mihomo/schema/*`), формы рисует общий `SchemaForm`, панель «Документ» — общий `DocPanel`, извлечённый из `SingboxDocPanel`. Писатель `applyMihomoOps` работает в двух режимах: правка существующего собственного скаляра — сплайс по диапазону (байты вне правки не меняются), всё структурное — `Document` библиотеки `yaml` с перепечаткой `toString({ lineWidth: 0 })`. Замки остаются у алиаса и слияния и получают действие «Развернуть значение здесь». Маркер `# LEAVE THIS LINE!` декоративен: узлы подстановки рисуются по правилу панели. Статические серверы получают узел `proxy:<имя>`; провайдер, набор правил, подсписок и вход заводятся с холста и из панели; переименование ведёт ссылки по единому перечню `referencesTo`. Шесть рецептов на обобщённом движке.

**Tech Stack:** React 19, TypeScript, Vite, vitest + jsdom + @testing-library, Playwright, `yaml` ^2.9 (`parseDocument`, `Document.setIn/deleteIn/getIn`, `toString`), CodeMirror 6, существующий UI-кит `shared/ui`; бэкенд Fastify (одна правка в `mihomo/dummyProxies.ts`).

**Spec:** `docs/superpowers/specs/2026-09-09-schema-forms-mihomo-design.md`

## Global Constraints

- Язык UI, сообщений об ошибках, комментариев в коде и документации — русский; коммиты — английский conventional style (`feat(frontend): …`, `fix(frontend): …`, `refactor(frontend): …`, `test(frontend): …`, `docs: …`).
- Комментарий в коде объясняет ПОЧЕМУ, а не что; стиль соседних файлов обязателен.
- Запрет `doc.toString()` для Mihomo снят ТОЛЬКО для структурных операций (решение владельца 2): правка существующего собственного однострочного скаляра в блочном отображении остаётся сплайсом и не меняет байты вне правки; всё остальное — `Document` + `toString({ lineWidth: 0 })`. Второй печатающий путь вне `entities/mihomo/write.ts` и бэкендного `dummyProxies.ts` не заводится.
- Операция, чей путь проходит через алиас (`*имя`) или через ключ, пришедший слиянием (`<<:`), НЕ применяется и попадает в `refused` с причиной. Материализация — только по явному действию пользователя (решение 5).
- Маркер `# LEAVE THIS LINE!` декоративен (решение 6): узел `hosts:root` рисуется всегда, `hosts:<группа>` — у каждой группы без `remnawave.include-proxies: false` либо с `include-all`/`include-all-proxies`. Ни одна проверка, узел или отказ не читает маркер.
- Схема сквозная: незнакомый ключ доезжает до текста нетронутым и не порождает диагностику; в форме он всегда виден на чтение (решение 7).
- Ключи ядра и панели пишутся дословно: kebab-case у ядра (`include-proxies`), camelCase у корневого `remnawave.includeHiddenHosts`.
- Общий слой (`shared/schema`, `features/inspector/schema`) расширяется только аддитивно. Тесты Xray-профиля, Xray-шаблона и sing-box — контрольная группа: ни один их файл не меняется. Извлечение `DocPanel` (задача 2) обязано оставить `test/singbox-doc-panel.test.tsx` зелёным без правок.
- Тесты Mihomo — предмет изменения: тесты, утверждавшие маркер, сплайсы для структуры и запертые flow-поля, переписываются под новые контракты в задаче, которая меняет контракт, а не удаляются молча.
- Мутационная приёмка каждого значимого изменения: сломать → красный именованный тест → восстановить обратной правкой (не `git checkout --`) → зелёный; мутация никогда не замена на пустую строку.
- Три тестовых контура фронтенда не пересекаются: vitest берёт `test/**/*.test.{ts,tsx}`, Playwright — `e2e/*.spec.ts`, `tsc --noEmit` не проверяет `e2e`.
- Фикстуры фронтенда читаются через Vite `?raw` (`mihomoFixture` в `test/helpers.ts`). Их байты в рабочей копии зависят от `core.autocrlf` машины (в индексе LF, на Windows CRLF): тест, которому нужен CRLF-документ, строит его сам (`replace(/\r?\n/g, '\r\n')`), а тест, которому нужен LF-документ, — тоже сам (`replace(/\r\n/g, '\n')`). Ни один тест не утверждает окончания строк фикстуры.
- Файлы репозитория в рабочей копии могут быть CRLF; правки — инструментом Edit.
- Каталог источников наборов правил — статический список `.mrs` в коде; каждая ссылка проверена 200 (см. задачу 18); бэкенд их не скачивает.
- Субагенты не коммитят: контроллер запускает typecheck и vitest и коммитит по одной задаче (`git add` по путям задачи).

## Что уже есть и на что план опирается

| Готовое | Где | Как используется |
|---|---|---|
| Общий слой части 1: `FieldSchema`, `resolve.ts` (`fieldsAt`, `fieldAt`, `valueAt`, `visibleFields`, `unknownKeys`, `deprecatedAt`, `walkSchema`, `isRecord`), `ops.ts` (`DocOp`, `Lock`, `DocWriter`, `applyOps`) | `frontend/src/shared/schema/*` | расширяется аддитивно в задаче 1; `applyOps` над `md.json` НЕ используется — писатель Mihomo свой |
| `SchemaForm`, `labels.ts`, `typeSelect.ts` (`typeOptions`, `typeHint`) | `frontend/src/features/inspector/schema/*` | формы Mihomo; `SchemaForm` получает кнопку действия замка, `map` со списками и элемент `port` |
| Строители схемы `str/num/bool/en/strs/nums/obj/objs/map/when/whenNot/withWhen/removed/tagLabel` | `frontend/src/entities/singbox/schema/shared.ts` | переезжают в `shared/schema/build.ts`; sing-box реэкспортирует их оттуда, его тесты не меняются |
| `SingboxDocPanel` (разделы-объекты и разделы-списки) | `frontend/src/features/topology/SingboxDocPanel.tsx` | обобщается в `features/inspector/schema/DocPanel.tsx`; остаётся тонкой обёрткой |
| Инспектор sing-box: обёртка писателя, `recordSlot`, `PSEUDO_NODES` | `frontend/src/features/topology/SingboxInspector.tsx` | образец для `MihomoInspector` |
| `MenuButton`, `addFromMenu` | `frontend/src/shared/ui/MenuButton.tsx`, `features/topology/SingboxTopology.tsx` | меню «+ Добавить» Mihomo |
| Модель Mihomo: `parse.ts` (`MihomoDoc`, `rangeOf`, `sectionNode`), `merge.ts` (`mergedNode`, `mergedHas`, `dealias`), `rules.ts` (`parseRule`, `formatRule`, `splitTopLevel`, `ruleEntriesOf`, `rulesOf`, `RULE_TYPES`), `groups.ts` (`groupsOf`, `providersOf`, `ruleProvidersOf`, `subRuleEntries`), `resolve.ts` (`BUILTIN_TARGETS`, `resolveTarget`), `locate.ts` (`locateMihomo`, `pathAt`) | `frontend/src/entities/mihomo/*` | остаются; `groups.ts` теряет `hasMarker` и получает `proxiesOf`; `resolve.ts` получает вид `proxy` |
| Сплайс-примитивы `applyEdits`, `scalar`, `detectIndentStep`, `newlineOf`, `afterBlock`, `originAt`, `readFieldAt`, `setFieldAt`, `removeFieldAt` | `frontend/src/entities/mihomo/edits.ts` | режим сплайса писателя; остальные функции файла удаляются в задаче 17 |
| Граф Mihomo: `buildMihomoGraph`, `layoutMihomo`, `groupDepths`, `mihomoNodeIdForPath`, `mihomoIssueCounts`, `connectMihomo`, `disconnectMihomo`, `refusalText` | `frontend/src/entities/graph/mihomo/*` | узел `proxy:<имя>`, операции вместо `TextEdit[]` |
| Хук `useMihomoDraft` и адаптер `mihomoAdapter` | `frontend/src/features/editor/*` | хук становится `DocWriter` |
| Обобщённые рецепты: `Recipe<TModel, TParams>`, `RecipesDialog<TModel>`, `RecipeEntry` | `frontend/src/shared/recipes/types.ts`, `features/recipes/RecipesDialog.tsx` | реестр и формы рецептов Mihomo |
| `WARP_PEER`, хук `useWarpAccount` | `frontend/src/entities/xray/recipes/warp.ts`, `shared/api` | рецепт WARP |
| Тест-помощники `selectOption`, `optionLabels`, `selectOptionIn`, `selectedValue`, `mihomoFixture`, `makeWriter` | `frontend/test/helpers.ts`, `frontend/test/schemaHelpers.ts` | все компонентные тесты плана |
| Моки e2e `mockApi`, `mockMihomo`, `MIHOMO_YAML`, `pickOption` | `frontend/e2e/mocks.ts`, `e2e/helpers.ts` | сценарий «с нуля» получает подмену содержимого |
| Бэкенд `withDummyProxies` и его тесты | `backend/src/mihomo/dummyProxies.ts`, `backend/test/mihomo-test.test.ts` | правило групп без маркера |

## Структура файлов

**Создаются**

| Файл | Ответственность |
|---|---|
| `frontend/src/shared/schema/build.ts` | строители полей и `uniqueName` — общие для ядер |
| `frontend/src/features/inspector/schema/DocPanel.tsx` | общая панель «Документ»: разделы object / list / map |
| `frontend/src/entities/mihomo/schema/shared.ts` | перечисления и фрагменты Mihomo: IP-версии, отпечатки, клиентский TLS, транспорты, smux, обфускации |
| `frontend/src/entities/mihomo/schema/root.ts` | корневые скаляры и объекты `tls`, `geox-url`, `external-controller-cors`, `remnawave` |
| `frontend/src/entities/mihomo/schema/misc.ts` | `profile`, `ntp`, `experimental`, `hosts` |
| `frontend/src/entities/mihomo/schema/dns.ts` | `dns` целиком |
| `frontend/src/entities/mihomo/schema/tun.ts` | `tun` целиком (и повторно у входа `tun`) |
| `frontend/src/entities/mihomo/schema/sniffer.ts` | `sniffer` с вложенным `sniff` |
| `frontend/src/entities/mihomo/schema/proxies.ts` | серверы `proxies[]` по типам, транспорты по `network` |
| `frontend/src/entities/mihomo/schema/groups.ts` | `proxy-groups[]` |
| `frontend/src/entities/mihomo/schema/providers.ts` | `proxy-providers` и `rule-providers` (записи отображений) |
| `frontend/src/entities/mihomo/schema/listeners.ts` | `listeners[]` по типам и `tunnels[]` |
| `frontend/src/entities/mihomo/schema/index.ts` | `MIHOMO_SCHEMA`, `mihomoFieldsAt`, `mihomoFieldAt`, `mihomoRefs`, `MIHOMO_DOC_SECTIONS`, перечисления типов |
| `frontend/src/entities/mihomo/write.ts` | `applyMihomoOps`, `mihomoLockAt`, `materializeAt`, `renameKeyAt` |
| `frontend/src/entities/mihomo/refs.ts` | `referenceSites`, `referencesTo`, `renameAt`, `namesOf` |
| `frontend/src/entities/mihomo/starters.ts` | заготовки записей и `nodeIdOfMihomo` |
| `frontend/src/entities/mihomo/recipes/{apply,catalog,split,ads,dns,local,private,warp,index}.ts` | рецепты |
| `frontend/src/features/inspector/Mihomo{Group,Proxy,Provider,RuleProvider,Listener,SubRule}Form.tsx` | формы на `SchemaForm` |
| `frontend/src/features/topology/MihomoDocPanel.tsx` | разделы Mihomo поверх `DocPanel` |
| `frontend/src/features/recipes/mihomoRecipes.tsx` | формы параметров рецептов |
| тесты: `test/schema-build.test.ts`, `test/schema-form-mihomo.test.tsx`, `test/doc-panel.test.tsx`, `test/mihomo-schema.test.ts`, `test/mihomo-schema-proxies.test.ts`, `test/mihomo-write.test.ts`, `test/mihomo-refs.test.ts`, `test/mihomo-starters.test.ts`, `test/mihomo-group-form.test.tsx`, `test/mihomo-proxy-form.test.tsx`, `test/mihomo-provider-form.test.tsx`, `test/mihomo-subrule-form.test.tsx`, `test/mihomo-doc-panel.test.tsx`, `test/mihomo-recipes.test.ts`, `test/mihomo-recipes-dialog.test.tsx` | по задачам |

**Изменяются**: `shared/schema/{types,index}.ts`, `features/inspector/schema/SchemaForm.tsx`, `entities/singbox/schema/shared.ts` (только реэкспорт строителей), `features/topology/SingboxDocPanel.tsx`, `entities/mihomo/{parse,groups,inject,validate,resolve,search,index,edits}.ts`, `entities/graph/mihomo/{buildGraph,mutations,locate,types}.ts`, `features/editor/{useMihomoDraft,mihomoAdapter}.ts`, `features/editor/mihomoIntellisense/{context,complete,hover}.ts`, `features/inspector/MihomoRuleForm.tsx`, `features/topology/{MihomoInspector,MihomoTopology,mihomoNodes}.tsx`, `features/templates/MihomoEditorPage.tsx`, `shared/ui/tokens.css`, `e2e/{mocks.ts,mihomo.spec.ts}`, `backend/src/mihomo/dummyProxies.ts`, `backend/test/mihomo-test.test.ts`, `CLAUDE.md`, `README.md`, спека.

**Удаляются** (задача 17): `entities/mihomo/docSchema.ts`, `entities/mihomo/marker.ts`, `features/inspector/MihomoFieldsForm.tsx`, `features/editor/MihomoSectionsDialog.tsx`, тесты `mihomo-doc-schema.test.ts`, `mihomo-sections-dialog.test.tsx`, `mihomo-edits-fields.test.ts` и мёртвые функции `edits.ts`.

## Волны исполнения (для контроллера)

Файлы задач одной волны не пересекаются; агенты не коммитят.

| Волна | Задачи | Зависимости |
|---|---|---|
| 1 | 1 (общий слой), 3 (схема: shared/root/misc/dns/tun/sniffer), 4 (схема серверов), 6 (писатель), 8 (маркер декоративен, бэкенд) | — |
| 2 | 2 (DocPanel), 5 (корень схемы), 7 (ссылки и переименование), 9 (граф и мутации) | 2←1; 5←3,4; 7←6; 9←6,8 |
| 3 | 10 (хук), 11 (формы группы/сервера/провайдера), 12 (формы правила/подсписка/набора/входа), 15 (подсказки), 16 (валидация), 18 (рецепты) | 10←6,7,9; 11,12←1,5; 15←5; 16←5,7; 18←5,6 |
| 4 | 13 (инспектор и панель «Документ»), 14 (док, узлы, стили), 19 (страница: рецепты, панель) | 13←2,10,11,12; 14←9,10; 19←13,18 |
| 5 | 17 (чистка), 20 (e2e) | 17←все; 20←19 |
| 6 | 21 (документация) | 17, 20 |

Модели субагентов: задачи 3, 4, 5, 8, 17, 21 — механические (дешёвая модель); 1, 2, 7, 9, 11, 12, 14, 15, 16, 18, 19, 20 — стандартная; 6, 10, 13 — многофайловая интеграция с судьбой документа (стандартная модель, ревью — более сильная). Финальное ревью ветки — самая сильная доступная модель.

---
## Часть A. Общий слой (аддитивно)

### Task 1: Расширения общего слоя: строители, замок с действием, раздел `map`, элемент `port`, отображение со списками

**Files:**
- Create: `frontend/src/shared/schema/build.ts`
- Modify: `frontend/src/shared/schema/types.ts`, `frontend/src/shared/schema/index.ts`
- Modify: `frontend/src/entities/singbox/schema/shared.ts` (строители — реэкспорт из `shared/schema/build`, тела удаляются)
- Modify: `frontend/src/features/inspector/schema/SchemaForm.tsx`
- Test: `frontend/test/schema-build.test.ts`, `frontend/test/schema-form-mihomo.test.tsx`

**Interfaces:**
- Consumes: `FieldSchema`, `ListItemSchema`, `Lock`, `DocSection`, `RefKind` из `shared/schema/types.ts`; `SchemaForm` части 1; `KeyValueField`, `StringListField` из `features/inspector`.
- Produces:
  - `shared/schema/build.ts`: `str, num, bool, map, en, strs, nums, ports, obj, objs, when, whenNot, withWhen, removed, tagLabel, nameLabel, uniqueName(taken: Iterable<string>, base: string): string` (те же сигнатуры, что были в `entities/singbox/schema/shared.ts`, плюс `ports`, `nameLabel`, `uniqueName`).
  - `types.ts`: `LockAction { label: string; run: () => void }`, `Lock.action?: LockAction`; `RefKind` += `'proxy-target' | 'provider' | 'sub-rule'`; `ListItemSchema.kind` += `'port'`; `FieldSchema.values?: 'string' | 'strings'` (только `kind: 'map'`); `DocSection.kind` += `'map'`.
  - `SchemaForm`: под запертым полем кнопка `lock.action.label`; `map` со `values: 'strings'` читает значение записи строкой либо списком и пишет списком; элемент `port` пишет число, если строка целиком из цифр.

- [ ] **Step 1: Тест строителей и `uniqueName`**

`frontend/test/schema-build.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { map, nameLabel, ports, str, uniqueName, when } from '../src/shared/schema'

describe('строители схемы', () => {
  it('ports — список элементов port; map принимает values', () => {
    expect(ports('ports', 'Порты.')).toEqual({ key: 'ports', doc: 'Порты.', kind: 'list', item: { kind: 'port' } })
    expect(map('hosts', 'Хосты.', { values: 'strings' })).toEqual({ key: 'hosts', doc: 'Хосты.', kind: 'map', values: 'strings' })
    expect(str('a', 'A', { when: when('type', 'x') })).toEqual({ key: 'a', doc: 'A', kind: 'string', when: { key: 'type', in: ['x'] } })
  })

  it('nameLabel — имя записи, иначе номер', () => {
    expect(nameLabel({ name: 'VPN' }, 0)).toBe('VPN')
    expect(nameLabel({}, 2)).toBe('#3')
  })

  it('uniqueName нумерует через дефис, начиная со второго', () => {
    expect(uniqueName([], 'provider')).toBe('provider')
    expect(uniqueName(['provider'], 'provider')).toBe('provider-2')
    expect(uniqueName(['provider', 'provider-2'], 'provider')).toBe('provider-3')
  })
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/schema-build.test.ts`
Expected: FAIL — `ports`, `nameLabel`, `uniqueName` не экспортируются из `shared/schema`.

- [ ] **Step 3: `shared/schema/build.ts` и правки типов**

Создать `frontend/src/shared/schema/build.ts` — ПЕРЕНОС строителей из `entities/singbox/schema/shared.ts` (тела дословно те же, что там сейчас: `str`, `num`, `bool`, `map`, `en`, `strs`, `nums`, `obj`, `objs`, `when`, `whenNot`, `withWhen`, `removed`, `tagLabel`) плюс три новых:

```ts
// Строители полей схемы — общие для ядер: описание поля собирается одной
// строкой, а не объектным литералом на пять строк. Переехали сюда из
// entities/singbox/schema/shared.ts, когда второе ядро (Mihomo) стало писать
// свою схему: копия строителей разошлась бы с первой на первом же новом виде поля.

import type { Condition, Deprecation, EnumValue, FieldSchema, ListItemSchema } from './types'

type Extra = Partial<Omit<FieldSchema, 'key' | 'doc' | 'kind'>>

export const str = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'string', ...extra })
export const num = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'number', ...extra })
export const bool = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'boolean', ...extra })
/** Отображение строка → строка; `values: 'strings'` — строка либо список строк (пишется списком) */
export const map = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'map', ...extra })

export const en = (key: string, doc: string, values: (string | EnumValue)[], extra: Extra = {}): FieldSchema => ({
  key, doc, kind: 'enum', enum: values.map((v) => (typeof v === 'string' ? { value: v } : v)), ...extra,
})

export const strs = (key: string, doc: string, extra: Extra & { values?: (string | EnumValue)[]; ref?: FieldSchema['ref'] } = {}): FieldSchema => {
  const { values, ref, ...rest } = extra
  const item: ListItemSchema = { kind: 'string' }
  if (values !== undefined) item.enum = values.map((v) => (typeof v === 'string' ? { value: v } : v))
  if (ref !== undefined) item.ref = ref
  return { key, doc, kind: 'list', item, ...rest }
}

export const nums = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'number' }, ...extra })

/** Список портов: число либо строка-диапазон (`[80, 8080-8880]`); строка из одних цифр пишется числом */
export const ports = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'port' }, ...extra })

export const obj = (key: string, doc: string, fields: FieldSchema[], extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'object', fields, ...extra })

export const objs = (
  key: string, doc: string, fields: FieldSchema[],
  item: Pick<ListItemSchema, 'label' | 'starter'> = {}, extra: Extra = {},
): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'object', fields, ...item }, ...extra })

export const when = (key: string, ...values: string[]): Condition => ({ key, in: values })
export const whenNot = (key: string, ...values: string[]): Condition => ({ key, notIn: values })
export const withWhen = (fields: FieldSchema[], cond: Condition): FieldSchema[] => fields.map((f) => ({ ...f, when: cond }))
export const removed = (since: string, replacement: string): Deprecation => ({ since, replacement })

export const tagLabel = (value: unknown, index: number): string => {
  const tag = (value as { tag?: unknown } | null)?.tag
  return typeof tag === 'string' && tag !== '' ? tag : `#${index + 1}`
}

/** Подпись элемента списка у ядер, адресующих запись ключом `name` (Mihomo) */
export const nameLabel = (value: unknown, index: number): string => {
  const name = (value as { name?: unknown } | null)?.name
  return typeof name === 'string' && name !== '' ? name : `#${index + 1}`
}

/**
 * Уникальное имя в пространстве `taken`: `base`, `base-2`, `base-3`… Тот же
 * приём, что `uniqueTag` у sing-box; живёт здесь, потому что нужен и записям
 * отображений панели «Документ» (`provider`, `provider-2`), у которых тега нет.
 */
export function uniqueName(taken: Iterable<string>, base: string): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!set.has(candidate)) return candidate
  }
}
```

`frontend/src/shared/schema/types.ts` — правки (только добавления):

```ts
export type RefKind = 'outbound' | 'inbound' | 'dns-server' | 'rule-set' | 'proxy-target' | 'provider' | 'sub-rule'

export interface ListItemSchema {
  /** `port` — число либо строка-диапазон портов; строка из одних цифр пишется числом */
  kind: 'string' | 'number' | 'object' | 'port'
  // … остальное без изменений
}

export interface FieldSchema {
  // … без изменений, плюс:
  /**
   * kind: map — вид значений. `strings`: значение записи ядро принимает и
   * строкой, и списком (nameserver-policy, hosts); форма читает оба вида и
   * пишет всегда списком — то же правило, что у списка-скаляра части 1.
   */
  values?: 'string' | 'strings'
}

export interface DocSection {
  // …
  /** object — форма по схеме; list — записи по индексу; map — записи по имени */
  kind: 'object' | 'list' | 'map'
}
```

`frontend/src/shared/schema/ops.ts` — `Lock`:

```ts
/** Действие, снимающее замок по явному выбору пользователя (материализация якоря у Mihomo) */
export interface LockAction {
  label: string
  run: () => void
}

export interface Lock {
  reason: string
  action?: LockAction
}
```

`frontend/src/shared/schema/index.ts`: добавить `export * from './build'`.

`frontend/src/entities/singbox/schema/shared.ts`: удалить тела строителей и `type Extra`, вместо них одна строка

```ts
export { str, num, bool, map, en, strs, nums, obj, objs, when, whenNot, withWhen, removed, tagLabel } from '../../../shared/schema/build'
```

Импорты `Condition`, `Deprecation`, `ListItemSchema` в этом файле, ставшие неиспользуемыми, убрать; `FieldSchema`, `EnumValue` остаются (перечисления и фрагменты ниже). Файл по-прежнему `export *`-ится из `entities/singbox/schema/index.ts`, поэтому все потребители sing-box видят те же имена.

- [ ] **Step 4: Прогнать тест и контрольную группу sing-box**

Run: `cd frontend && npx vitest run test/schema-build.test.ts test/singbox-schema.test.ts test/schema-form.test.tsx && npm run typecheck`
Expected: PASS без правок sing-box-тестов; typecheck чистый.

- [ ] **Step 5: Тест `SchemaForm`: действие замка, `map` со списками, элемент `port`**

`frontend/test/schema-form-mihomo.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SchemaForm } from '../src/features/inspector/schema/SchemaForm'
import { map, ports, str } from '../src/shared/schema'
import type { DocOp, DocWriter } from '../src/shared/schema'

const FIELDS = [
  str('name', 'Имя.'),
  map('hosts', 'Хосты.', { values: 'strings' }),
  ports('ports', 'Порты.'),
]

describe('SchemaForm: расширения части 2', () => {
  it('замок с действием рисует кнопку и зовёт run', async () => {
    const run = vi.fn()
    const writer: DocWriter = {
      apply: vi.fn(),
      lockAt: (path) => (path.at(-1) === 'name' ? { reason: 'Через якорь.', action: { label: 'Развернуть значение здесь', run } } : null),
    }
    render(<SchemaForm fields={FIELDS} value={{ name: 'a' }} path={[]} writer={writer} />)
    expect(screen.getByText('Через якорь.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Развернуть значение здесь' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('map со strings читает строку и список, пишет списком', async () => {
    const ops: DocOp[] = []
    const writer: DocWriter = { apply: (next) => ops.push(...next), lockAt: () => null }
    render(
      <SchemaForm fields={FIELDS} value={{ hosts: { 'a.com': '1.1.1.1', 'b.com': ['2.2.2.2', '3.3.3.3'] } }} path={[]} writer={writer} />,
    )
    const values = screen.getAllByPlaceholderText('Значение') as HTMLInputElement[]
    expect(values.map((v) => v.value)).toEqual(['1.1.1.1', '2.2.2.2, 3.3.3.3'])
    await userEvent.type(values[0]!, ', 4.4.4.4')
    expect(ops.at(-1)).toEqual({
      op: 'set', path: ['hosts'],
      value: { 'a.com': ['1.1.1.1', '4.4.4.4'], 'b.com': ['2.2.2.2', '3.3.3.3'] },
    })
  })

  it('элемент port: цифры пишутся числом, диапазон — строкой', async () => {
    const ops: DocOp[] = []
    const writer: DocWriter = { apply: (next) => ops.push(...next), lockAt: () => null }
    render(<SchemaForm fields={FIELDS} value={{ ports: [80] }} path={[]} writer={writer} />)
    const area = screen.getByLabelText('ports')
    await userEvent.type(area, '\n8080-8880')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['ports'], value: [80, '8080-8880'] })
  })
})
```

- [ ] **Step 6: Запустить — красный**

Run: `cd frontend && npx vitest run test/schema-form-mihomo.test.tsx`
Expected: FAIL — кнопки действия нет; значение-список у `map` рисуется на чтение (`SHAPE_NOTE`), а не строкой; `port` печатает строку `'80'`.

- [ ] **Step 7: Правки `SchemaForm.tsx`**

1. `ReadOnly` получает необязательный проп `action?: LockAction` и рисует после подсказки:

```tsx
{action ? (
  <Button variant="ghost" onClick={action.run}>
    {action.label}
  </Button>
) : null}
```

В `row(field)` ветка замка: `<ReadOnly key={field.key} label={field.key} doc={field.doc} note={lock.reason} action={lock.action} value={current} />`. Импорт `LockAction` из `shared/schema`.

2. `scalarFitsListItem`: `port` принимает и строку, и число:

```ts
const kind = item?.kind ?? 'string'
if (kind === 'port') return typeof value === 'string' || typeof value === 'number'
```

3. В `listRow` перед веткой `item.kind === 'number'`:

```tsx
if (item.kind === 'port') {
  // Порт — число, диапазон — строка: `[80, 8080-8880]` ядро читает именно так,
  // а `"80"` строкой — уже другое значение для его разборщика диапазонов
  return (
    <StringListField
      key={field.key}
      label={field.key}
      hint={hint}
      value={list.length > 0 ? list.map((v) => String(v)) : undefined}
      onChange={(v) => setOrRemove(field.key, v?.map((s) => (/^\d+$/.test(s) ? Number(s) : s)))}
    />
  )
}
```

4. Ветка `case 'map'`:

```tsx
case 'map': {
  const raw = isRecord(current) ? current : undefined
  if (field.values === 'strings') {
    // Значение записи — строка либо список: показываем через запятую,
    // пишем всегда списком (то же правило, что у списка-скаляра)
    const shown = raw === undefined ? undefined
      : Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.map(String).join(', ') : String(v)]))
    return (
      <KeyValueField
        key={field.key}
        label={field.key}
        hint={hint}
        value={shown}
        onChange={(v) =>
          setOrRemove(
            field.key,
            v === undefined ? undefined
              : Object.fromEntries(Object.entries(v).map(([k, s]) => [k, s.split(',').map((t) => t.trim()).filter(Boolean)])),
          )
        }
      />
    )
  }
  const map = raw as Record<string, string> | undefined
  return <KeyValueField key={field.key} label={field.key} hint={hint} value={map} onChange={(v) => setOrRemove(field.key, v)} />
}
```

`shapeFits` для `map` остаётся `isRecord(value)` — список в значении записи формой не считается.

- [ ] **Step 8: Прогнать тесты, контрольную группу и typecheck**

Run: `cd frontend && npx vitest run test/schema-form-mihomo.test.tsx test/schema-form.test.tsx test/singbox-outbound-form.test.tsx test/singbox-doc-panel.test.tsx && npm run typecheck`
Expected: PASS; файлы sing-box не правились.

- [ ] **Step 9: Мутационная проверка**

Мутация: в ветке `port` заменить `Number(s)` на `s` → красным падает «элемент port: цифры пишутся числом». Восстановить обратной правкой. Мутация 2: убрать `action.run` из `onClick` → красным «замок с действием». Восстановить.

- [ ] **Step 10: Отчёт**

Контроллер коммитит: `feat(frontend): schema builders shared across cores, lock actions, map lists and port items`.

### Task 2: Общая панель «Документ» `DocPanel` с разделами по имени

**Files:**
- Create: `frontend/src/features/inspector/schema/DocPanel.tsx`
- Modify: `frontend/src/features/topology/SingboxDocPanel.tsx` (становится обёрткой)
- Test: `frontend/test/doc-panel.test.tsx`; контрольная группа `frontend/test/singbox-doc-panel.test.tsx` без правок

**Interfaces:**
- Consumes: `DocSection`, `DocWriter`, `FieldSchema`, `RefKind`, `SchemaPath`, `valueAt`, `isRecord`, `uniqueName` из `shared/schema`; `SchemaForm`; `CollapsibleSection`, `Button`.
- Produces:

```ts
export type DocRefs = Partial<Record<RefKind, string[]>>
export interface DocEntryFormProps { value: Record<string, unknown>; path: SchemaPath; writer: DocWriter; refs: DocRefs }
export interface DocListSpec<TDoc> {
  addLabel: string
  removeLabel: (index: number) => string
  titleOf: (item: unknown, index: number) => string
  starter: (doc: TDoc) => unknown
  Form: (props: DocEntryFormProps) => ReactNode
}
export interface DocMapSpec<TDoc> {
  addLabel: string
  removeLabel: (name: string) => string
  /** Основа имени новой записи: `provider` → `provider`, `provider-2`, … */
  baseName: string
  starter: (doc: TDoc, name: string) => unknown
  Form: (props: DocEntryFormProps) => ReactNode
}
export interface DocPanelProps<TDoc> {
  sections: DocSection[]
  doc: TDoc
  writer: DocWriter
  refs: DocRefs
  fieldsAt: (path: SchemaPath, doc: TDoc) => FieldSchema[] | undefined
  fieldAt: (path: SchemaPath, doc: TDoc) => FieldSchema | undefined
  /** Значение по пути: у модельных ядер — сам документ, у Mihomo — снимок `md.json` */
  valueOf: (doc: TDoc, path: SchemaPath) => unknown
  lists?: Record<string, DocListSpec<TDoc>>
  maps?: Record<string, DocMapSpec<TDoc>>
}
export function DocPanel<TDoc>(props: DocPanelProps<TDoc>): ReactNode
```

Ключ в `lists`/`maps` — `section.path.join('.')`.

- [ ] **Step 1: Тест общей панели на синтетической схеме (раздел `map`)**

`frontend/test/doc-panel.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DocPanel } from '../src/features/inspector/schema/DocPanel'
import { fieldAt, fieldsAt, obj, str, valueAt, type DocSection, type FieldSchema } from '../src/shared/schema'
import { SchemaForm } from '../src/features/inspector/schema/SchemaForm'
import { makeWriter } from './schemaHelpers'

const SCHEMA: FieldSchema[] = [
  obj('providers', 'Провайдеры.', []),
  obj('general', 'Общие.', [str('mode', 'Режим.')]),
]
const SECTIONS: DocSection[] = [
  { title: 'Общие', path: ['general'], kind: 'object' },
  { title: 'Провайдеры', path: ['providers'], kind: 'map' },
]
const ENTRY = [str('url', 'Ссылка.')]

function renderPanel(doc: Record<string, unknown>) {
  const { ops, writer } = makeWriter()
  render(
    <DocPanel
      sections={SECTIONS}
      doc={doc}
      writer={writer}
      refs={{}}
      fieldsAt={(path, d) => fieldsAt(SCHEMA, path, d)}
      fieldAt={(path, d) => fieldAt(SCHEMA, path, d)}
      valueOf={(d, path) => valueAt(d, path)}
      maps={{
        providers: {
          addLabel: '+ Провайдер',
          removeLabel: (name) => `Удалить провайдера ${name}`,
          baseName: 'provider',
          starter: () => ({ url: '' }),
          Form: (p) => <SchemaForm fields={ENTRY} value={p.value} path={p.path} writer={p.writer} />,
        },
      }}
    />,
  )
  return ops
}

describe('DocPanel: раздел по имени', () => {
  it('перечисляет записи, заводит новую под уникальным именем и удаляет по имени', async () => {
    const ops = renderPanel({ providers: { provider: { url: 'u' } } })
    await userEvent.click(screen.getByRole('button', { name: 'Провайдеры' }))
    const region = screen.getByRole('region', { name: 'Провайдеры' })
    expect(within(region).getByText('provider')).toBeInTheDocument()
    expect(within(region).getByLabelText('url')).toHaveValue('u')
    await userEvent.click(within(region).getByRole('button', { name: '+ Провайдер' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['providers', 'provider-2'], value: { url: '' } })
    await userEvent.click(within(region).getByRole('button', { name: 'Удалить провайдера provider' }))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['providers', 'provider'] })
  })

  it('раздел-объект без записи заводится стартером или пустым объектом', async () => {
    const ops = renderPanel({})
    await userEvent.click(screen.getByRole('button', { name: 'Общие' }))
    await userEvent.click(screen.getByRole('button', { name: 'Завести раздел' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['general'], value: {} })
  })
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/doc-panel.test.tsx`
Expected: FAIL — модуля `DocPanel` нет.

- [ ] **Step 3: `DocPanel.tsx`**

```tsx
// Общая панель «Документ»: разделы корня, у которых узлов на холсте нет.
// Раздел-объект рисуется формой по схеме, раздел-список — карточками с формой
// на элемент, раздел-отображение — карточками по имени записи. Панель не знает
// ни ядра, ни писателя: спуск по схеме, значение по пути и формы записей
// приходят пропсами — так `SingboxDocPanel` и `MihomoDocPanel` остаются
// тонкими обёртками, а не двумя копиями одной разметки.

import type { ReactNode } from 'react'
import {
  isRecord,
  uniqueName,
  type DocSection,
  type DocWriter,
  type FieldSchema,
  type RefKind,
  type SchemaPath,
} from '../../../shared/schema'
import { Button, CollapsibleSection } from '../../../shared/ui'
import { SchemaForm } from './SchemaForm'

export type DocRefs = Partial<Record<RefKind, string[]>>

export interface DocEntryFormProps {
  value: Record<string, unknown>
  path: SchemaPath
  writer: DocWriter
  refs: DocRefs
}

export interface DocListSpec<TDoc> {
  addLabel: string
  removeLabel: (index: number) => string
  titleOf: (item: unknown, index: number) => string
  starter: (doc: TDoc) => unknown
  Form: (props: DocEntryFormProps) => ReactNode
}

export interface DocMapSpec<TDoc> {
  addLabel: string
  removeLabel: (name: string) => string
  /** Основа имени новой записи; уникальность — `uniqueName` по ключам раздела */
  baseName: string
  starter: (doc: TDoc, name: string) => unknown
  Form: (props: DocEntryFormProps) => ReactNode
}

export interface DocPanelProps<TDoc> {
  sections: DocSection[]
  doc: TDoc
  writer: DocWriter
  refs: DocRefs
  fieldsAt: (path: SchemaPath, doc: TDoc) => FieldSchema[] | undefined
  fieldAt: (path: SchemaPath, doc: TDoc) => FieldSchema | undefined
  /** Значение по пути: у модельных ядер — сам документ, у Mihomo — снимок значений */
  valueOf: (doc: TDoc, path: SchemaPath) => unknown
  lists?: Record<string, DocListSpec<TDoc>>
  maps?: Record<string, DocMapSpec<TDoc>>
}

function OrderButtons({ path, index, length, writer }: { path: SchemaPath; index: number; length: number; writer: DocWriter }) {
  return (
    <div className="list-editor-order">
      <button type="button" className="chip-order" aria-label={`Переместить элемент ${index + 1} выше`} disabled={index === 0}
        onClick={() => writer.apply([{ op: 'move', path, from: index, to: index - 1 }])}>↑</button>
      <button type="button" className="chip-order" aria-label={`Переместить элемент ${index + 1} ниже`} disabled={index === length - 1}
        onClick={() => writer.apply([{ op: 'move', path, from: index, to: index + 1 }])}>↓</button>
    </div>
  )
}

function ListSection<TDoc>({ section, spec, p }: { section: DocSection; spec: DocListSpec<TDoc>; p: DocPanelProps<TDoc> }) {
  const raw = p.valueOf(p.doc, section.path)
  const items = Array.isArray(raw) ? raw : []
  return (
    <div className="list-editor">
      {items.length === 0 && <p className="muted">Записей пока нет — кнопка ниже заведёт первую.</p>}
      {items.map((item, i) => (
        // Ключ — позиция: она и есть адрес записи, а имени у неё может не быть
        <div key={i} className="list-editor-card">
          <div className="list-editor-body">
            <span className="eyebrow">{spec.titleOf(item, i)}</span>
            <spec.Form value={isRecord(item) ? item : {}} path={[...section.path, i]} writer={p.writer} refs={p.refs} />
          </div>
          <OrderButtons path={section.path} index={i} length={items.length} writer={p.writer} />
          <button type="button" className="chip-x" aria-label={spec.removeLabel(i)}
            onClick={() => p.writer.apply([{ op: 'remove', path: [...section.path, i] }])}>✕</button>
        </div>
      ))}
      <Button onClick={() => p.writer.apply([{ op: 'insert', path: section.path, index: items.length, value: spec.starter(p.doc) }])}>
        {spec.addLabel}
      </Button>
    </div>
  )
}

/**
 * Раздел-отображение: записи адресуются именем. Новая запись заводится под
 * именем-заготовкой (`provider`, `provider-2`, …) — имя правится в форме
 * записи, как у групп; порядка у записей нет, YAML-отображение его не обещает.
 */
function MapSection<TDoc>({ section, spec, p }: { section: DocSection; spec: DocMapSpec<TDoc>; p: DocPanelProps<TDoc> }) {
  const raw = p.valueOf(p.doc, section.path)
  const entries = isRecord(raw) ? Object.entries(raw) : []
  return (
    <div className="list-editor">
      {entries.length === 0 && <p className="muted">Записей пока нет — кнопка ниже заведёт первую.</p>}
      {entries.map(([name, item]) => (
        <div key={name} className="list-editor-card">
          <div className="list-editor-body">
            <span className="eyebrow">{name}</span>
            <spec.Form value={isRecord(item) ? item : {}} path={[...section.path, name]} writer={p.writer} refs={p.refs} />
          </div>
          <button type="button" className="chip-x" aria-label={spec.removeLabel(name)}
            onClick={() => p.writer.apply([{ op: 'remove', path: [...section.path, name] }])}>✕</button>
        </div>
      ))}
      <Button
        onClick={() => {
          const name = uniqueName(entries.map(([n]) => n), spec.baseName)
          p.writer.apply([{ op: 'set', path: [...section.path, name], value: spec.starter(p.doc, name) }])
        }}
      >
        {spec.addLabel}
      </Button>
    </div>
  )
}

function ObjectSection<TDoc>({ section, p }: { section: DocSection; p: DocPanelProps<TDoc> }) {
  const value = p.valueOf(p.doc, section.path)
  // Пустой путь — сам корень документа: он есть всегда, даже когда пуст
  const field = section.path.length === 0 ? undefined : p.fieldAt(section.path, p.doc)
  if (!isRecord(value) && section.path.length > 0) {
    return (
      <>
        <p className="muted">{field?.doc ?? ''} Раздела в документе нет.</p>
        <Button onClick={() => p.writer.apply([{ op: 'set', path: section.path, value: field?.starter?.() ?? {} }])}>Завести раздел</Button>
      </>
    )
  }
  return (
    <SchemaForm
      fields={p.fieldsAt(section.path, p.doc) ?? []}
      value={isRecord(value) ? value : {}}
      path={section.path}
      writer={p.writer}
      refs={p.refs}
      skip={section.skip}
    />
  )
}

export function DocPanel<TDoc>(p: DocPanelProps<TDoc>) {
  return (
    <>
      {p.sections.map((section) => {
        const key = section.path.join('.')
        const list = p.lists?.[key]
        const map = p.maps?.[key]
        return (
          <CollapsibleSection key={key} title={section.title} region>
            {section.kind === 'list' && list ? (
              <ListSection section={section} spec={list} p={p} />
            ) : section.kind === 'map' && map ? (
              <MapSection section={section} spec={map} p={p} />
            ) : (
              <ObjectSection section={section} p={p} />
            )}
          </CollapsibleSection>
        )
      })}
    </>
  )
}
```

- [ ] **Step 4: `SingboxDocPanel.tsx` — обёртка**

Оставить в файле `LISTS` (с типом `Record<string, DocListSpec<SingboxDoc>>`, формы записей те же), `tagOr`, и заменить `ListSection`/`ObjectSection`/тело компонента на:

```tsx
export function SingboxDocPanel({ doc, writer, refs }: { doc: SingboxDoc; writer: DocWriter; refs: DocRefs }) {
  return (
    <DocPanel
      sections={SINGBOX_DOC_SECTIONS}
      doc={doc}
      writer={writer}
      refs={refs}
      fieldsAt={singboxFieldsAt}
      fieldAt={singboxFieldAt}
      valueOf={valueAt}
      lists={LISTS}
    />
  )
}
```

Импорты: `DocPanel`, `DocListSpec`, `DocRefs` из `../inspector/schema/DocPanel`; `valueAt` из `shared/schema`. Тип `Refs` заменить на `DocRefs`. Разметка карточек, подписи кнопок (`+ Сервер`, `Удалить сервер #1`, `Завести раздел`, «Записей пока нет — кнопка ниже заведёт первую.») и `region` у секций сохраняются дословно — контрольный тест держится на них.

- [ ] **Step 5: Прогнать оба теста и typecheck**

Run: `cd frontend && npx vitest run test/doc-panel.test.tsx test/singbox-doc-panel.test.tsx test/singbox-inspector.test.tsx && npm run typecheck`
Expected: PASS; `test/singbox-doc-panel.test.tsx` не правился.

- [ ] **Step 6: Мутация**

В `MapSection` заменить `uniqueName(entries.map(([n]) => n), spec.baseName)` на `spec.baseName` → красным «заводит новую под уникальным именем». Восстановить.

- [ ] **Step 7: Отчёт**

Коммит контроллера: `refactor(frontend): extract the shared DocPanel with map sections from the sing-box document panel`.
## Часть B. Модель Mihomo

Источники схемы: `wiki.metacubex.one/config/*` и канонический аннотированный `docs/config.yaml` ядра
(`raw.githubusercontent.com/MetaCubeX/mihomo/Meta/docs/config.yaml`, ветка `Meta`, снят 2026-09-09).
Правило покрытия: каждый ключ страницы документации и канонического файла для соответствующего
раздела присутствует в схеме, включая устаревшие. Значения `deprecated.since` — по пометкам
канонического файла и wiki; где точной версии нет, ставится строка `'Meta'` (ветка) с заменой.

### Task 3: Схема Mihomo: общие фрагменты, корень, misc, DNS, TUN, снифер

**Files:**
- Create: `frontend/src/entities/mihomo/schema/shared.ts`, `root.ts`, `misc.ts`, `dns.ts`, `tun.ts`, `sniffer.ts`
- Test: `frontend/test/mihomo-schema.test.ts` (часть, дополняется в задаче 5)

**Interfaces:**
- Consumes: строители из `shared/schema` (задача 1).
- Produces:
  - `shared.ts`: `IP_VERSION_VALUES`, `FINGERPRINT_VALUES`, `CLIENT_TLS_FIELDS`, `ECH_OPTS_FIELDS`, `REALITY_OPTS_FIELDS`, `SHADOW_TLS_OPTS_FIELDS`, `RESTLS_OPTS_FIELDS`, `JLS_OPTS_FIELDS`, `SMUX_FIELDS`, `WS_OPTS_FIELDS`, `H2_OPTS_FIELDS`, `HTTP_OPTS_FIELDS`, `GRPC_OPTS_FIELDS`, `XHTTP_OPTS_FIELDS`, `MKCP_OPTS_FIELDS`, `MEKYA_OPTS_FIELDS`, `KCP_FIELDS`, `IP_STACK_FIELDS`, `TLS_SERVER_FIELDS`, `dialerProxy(extra?)`.
  - `root.ts`: `ROOT_FIELDS: FieldSchema[]` (только скаляры и объекты корня; контейнеры-разделы добавляет `index.ts`).
  - `misc.ts`: `PROFILE_FIELDS`, `NTP_FIELDS`, `EXPERIMENTAL_FIELDS`, `hostsField`.
  - `dns.ts`: `DNS_FIELDS`; `tun.ts`: `TUN_FIELDS`; `sniffer.ts`: `SNIFFER_FIELDS`.

- [ ] **Step 1: Тест на форму и ключевые факты ветвей**

`frontend/test/mihomo-schema.test.ts` (первая версия; задача 5 добавит проверки корня):

```ts
import { describe, expect, it } from 'vitest'
import { DNS_FIELDS } from '../src/entities/mihomo/schema/dns'
import { ROOT_FIELDS } from '../src/entities/mihomo/schema/root'
import { SNIFFER_FIELDS } from '../src/entities/mihomo/schema/sniffer'
import { TUN_FIELDS } from '../src/entities/mihomo/schema/tun'
import { NTP_FIELDS } from '../src/entities/mihomo/schema/misc'
import { deprecatedAt, visibleFields, type FieldSchema } from '../src/shared/schema'

const keys = (fields: FieldSchema[]) => fields.map((f) => f.key)
const field = (fields: FieldSchema[], key: string) => fields.find((f) => f.key === key)!

describe('схема Mihomo: корень, dns, tun, sniffer', () => {
  it('корень описывает порты, режим, geo и API целиком', () => {
    for (const k of ['mixed-port', 'port', 'socks-port', 'redir-port', 'tproxy-port', 'allow-lan', 'bind-address',
      'lan-allowed-ips', 'lan-disallowed-ips', 'authentication', 'skip-auth-prefixes', 'mode', 'log-level', 'ipv6',
      'unified-delay', 'tcp-concurrent', 'interface-name', 'routing-mark', 'find-process-mode', 'global-client-fingerprint',
      'keep-alive-idle', 'keep-alive-interval', 'disable-keep-alive', 'geodata-mode', 'geodata-loader', 'geo-auto-update',
      'geo-update-interval', 'geox-url', 'geosite-matcher', 'global-ua', 'etag-support', 'external-controller',
      'external-controller-tls', 'external-controller-unix', 'external-controller-pipe', 'external-controller-cors',
      'external-controller-routing-mark', 'secret', 'external-ui', 'external-ui-name', 'external-ui-url',
      'external-doh-server', 'tls', 'remnawave', 'enable-process']) {
      expect(keys(ROOT_FIELDS), k).toContain(k)
    }
    expect(field(ROOT_FIELDS, 'enable-process').deprecated?.replacement).toMatch(/find-process-mode/)
    expect(field(ROOT_FIELDS, 'remnawave').panelKey).toBe(true)
    expect(keys(field(ROOT_FIELDS, 'tls').fields!)).toEqual(['certificate', 'private-key', 'client-auth-type', 'client-auth-cert', 'ech-key', 'custom-certifactes'])
  })

  it('dns: nameserver-policy и hosts-подобные отображения принимают списки; fallback-filter.geosite устарел', () => {
    expect(field(DNS_FIELDS, 'nameserver-policy')).toMatchObject({ kind: 'map', values: 'strings' })
    expect(field(DNS_FIELDS, 'proxy-server-nameserver-policy')).toMatchObject({ kind: 'map', values: 'strings' })
    expect(field(DNS_FIELDS, 'fake-ip-filter-mode').enum!.map((e) => e.value)).toEqual(['blacklist', 'whitelist', 'rule'])
    const ff = field(DNS_FIELDS, 'fallback-filter').fields!
    expect(deprecatedAt(ff, { geosite: ['gfw'] })).toHaveLength(1)
  })

  it('tun: inet4/inet6-route-* устарели с заменой на route-address', () => {
    for (const k of ['inet4-route-address', 'inet6-route-address', 'inet4-route-exclude-address', 'inet6-route-exclude-address']) {
      expect(field(TUN_FIELDS, k).deprecated?.replacement).toMatch(/route-/)
    }
    expect(field(TUN_FIELDS, 'stack').enum!.map((e) => e.value)).toEqual(['system', 'gvisor', 'mixed'])
  })

  it('sniffer.sniff — вложенный объект с портами по протоколу; sniffing и port-whitelist устарели', () => {
    const sniff = field(SNIFFER_FIELDS, 'sniff').fields!
    expect(keys(sniff)).toEqual(['HTTP', 'TLS', 'QUIC'])
    expect(field(field(sniff, 'HTTP').fields!, 'ports').item).toEqual({ kind: 'port' })
    expect(field(SNIFFER_FIELDS, 'sniffing').deprecated).toBeDefined()
    expect(field(SNIFFER_FIELDS, 'port-whitelist').deprecated).toBeDefined()
    expect(visibleFields(SNIFFER_FIELDS, {})).toHaveLength(SNIFFER_FIELDS.length)
  })

  it('ntp.dialer-proxy — ссылка на цель маршрута', () => {
    expect(field(NTP_FIELDS, 'dialer-proxy').ref).toBe('proxy-target')
  })
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-schema.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: `schema/shared.ts`**

```ts
// Перечисления и фрагменты, которые Mihomo переиспользует между ветвями:
// версия IP, отпечатки, клиентский TLS с ECH/Reality/ShadowTLS/Restls/JLS,
// транспорты по `network`, smux, mKCP/Mekya, серверный TLS у входов.
// Фрагмент описан один раз и вставляется по месту — копия разошлась бы с
// первой на первом же ключе.
//
// Источники: wiki.metacubex.one/config/proxies/* и канонический docs/config.yaml
// ядра (ветка Meta, 2026-09-09).

import { bool, en, map, num, obj, str, strs, type FieldSchema, type EnumValue } from '../../../shared/schema'

type Extra = Partial<Omit<FieldSchema, 'key' | 'doc' | 'kind'>>

export const IP_VERSION_VALUES: EnumValue[] = [
  { value: 'dual', doc: 'Обе версии (по умолчанию).' },
  { value: 'ipv4', doc: 'Только IPv4.' },
  { value: 'ipv6', doc: 'Только IPv6.' },
  { value: 'ipv4-prefer', doc: 'Двойной стек, предпочитая IPv4.' },
  { value: 'ipv6-prefer', doc: 'Двойной стек, предпочитая IPv6.' },
]

export const FINGERPRINT_VALUES: EnumValue[] = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'none'].map((value) => ({ value }))

export const CONGESTION_VALUES: EnumValue[] = ['cubic', 'new_reno', 'bbr'].map((value) => ({ value }))
export const BBR_PROFILE_VALUES: EnumValue[] = ['standard', 'conservative', 'aggressive'].map((value) => ({ value }))

/** Ссылка на цель маршрута: группа, статический сервер или встроенная цель */
export const dialerProxy = (extra: Extra = {}): FieldSchema =>
  str('dialer-proxy', 'Через какую группу или сервер устанавливать соединение — цепочка прокси.', { ref: 'proxy-target', ...extra })

export const ECH_OPTS_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить Encrypted Client Hello.'),
  str('config', 'Конфигурация ECH в base64; пусто — запросить через DNS.'),
  str('query-server-name', 'Домен для DNS-запроса конфигурации ECH.'),
]

export const REALITY_OPTS_FIELDS: FieldSchema[] = [
  str('public-key', 'Публичный ключ сервера Reality.'),
  str('short-id', 'Короткий идентификатор.'),
  bool('support-x25519mlkem768', 'Постквантовый обмен ключами, если сервер его поддерживает.'),
]

export const SHADOW_TLS_OPTS_FIELDS: FieldSchema[] = [
  num('version', 'Версия ShadowTLS: 1, 2 или 3; пусто — 2.', { min: 1 }),
  str('password', 'Пароль ShadowTLS.'),
]

export const RESTLS_OPTS_FIELDS: FieldSchema[] = [
  str('password', 'Пароль Restls.'),
  en('version-hint', 'Версия TLS сервера-прикрытия.', ['tls12', 'tls13']),
  str('restls-script', 'Сценарий Restls, скрывающий поведение после рукопожатия.'),
]

export const JLS_OPTS_FIELDS: FieldSchema[] = [
  str('username', 'Имя пользователя JLS.'),
  str('password', 'Пароль JLS.'),
]

/**
 * Клиентский TLS сервера: общий для vmess, vless, trojan, http, socks5,
 * anytls, trusttunnel. Имя сервера у ядра двоякое: `servername` у vmess/vless,
 * `sni` у остальных — оба ключа описаны, форма показывает тот, что стоит.
 */
export const CLIENT_TLS_FIELDS: FieldSchema[] = [
  bool('tls', 'Включить TLS.'),
  str('servername', 'Имя сервера для SNI (vmess, vless).'),
  str('sni', 'Имя сервера для SNI (trojan, hysteria, tuic, anytls и другие).'),
  strs('alpn', 'Список протоколов ALPN.'),
  bool('skip-cert-verify', 'Не проверять сертификат сервера.'),
  str('name-cert-verify', 'Проверять только DNSName сертификата, не трогая SNI.'),
  str('fingerprint', 'SHA-256 отпечаток сертификата сервера (SSL pinning).'),
  en('client-fingerprint', 'Чей отпечаток TLS-клиента изображать (uTLS).', FINGERPRINT_VALUES),
  str('certificate', 'Клиентский сертификат в PEM или путь к нему (mTLS).'),
  str('private-key', 'Клиентский ключ в PEM или путь к нему (mTLS).'),
  obj('ech-opts', 'Encrypted Client Hello.', ECH_OPTS_FIELDS),
  obj('reality-opts', 'Reality на стороне клиента.', REALITY_OPTS_FIELDS),
  obj('shadow-tls-opts', 'ShadowTLS поверх TLS; SNI берётся из servername/sni.', SHADOW_TLS_OPTS_FIELDS),
  obj('restls-opts', 'Restls поверх TLS.', RESTLS_OPTS_FIELDS),
  obj('jls-opts', 'JLS поверх TLS.', JLS_OPTS_FIELDS),
]

export const SMUX_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить мультиплексирование.'),
  en('protocol', 'Протокол мультиплексирования.', ['smux', 'yamux', 'h2mux']),
  num('max-connections', 'Максимум соединений; несовместимо с max-streams.'),
  num('min-streams', 'Минимум потоков до открытия нового соединения; несовместимо с max-streams.'),
  num('max-streams', 'Максимум потоков в соединении; несовместимо с двумя полями выше.'),
  bool('padding', 'Дополнять пакеты (нужен sing-box ≥ 1.3-beta9 на сервере).'),
  bool('statistic', 'Показывать нижележащие соединения в панели.'),
  bool('only-tcp', 'Не применять smux к UDP.'),
  obj('brutal-opts', 'TCP Brutal.', [bool('enabled', 'Включить Brutal.'), str('up', 'Отдача, например 50 Mbps.'), str('down', 'Приём, например 100 Mbps.')]),
]

export const WS_OPTS_FIELDS: FieldSchema[] = [
  str('path', 'Путь WebSocket.'),
  map('headers', 'Заголовки запроса (Host и другие).'),
  num('max-early-data', 'Размер ранних данных.'),
  str('early-data-header-name', 'Заголовок для ранних данных, например Sec-WebSocket-Protocol.'),
  bool('v2ray-http-upgrade', 'HTTPUpgrade вместо WebSocket.'),
  bool('v2ray-http-upgrade-fast-open', 'Быстрое открытие HTTPUpgrade.'),
]

export const H2_OPTS_FIELDS: FieldSchema[] = [
  strs('host', 'Домены HTTP/2.'),
  str('path', 'Путь HTTP/2.'),
]

export const HTTP_OPTS_FIELDS: FieldSchema[] = [
  str('method', 'Метод HTTP-запроса.'),
  strs('path', 'Пути запроса; клиент выбирает случайный.'),
  map('headers', 'Заголовки; значение — список строк.', { values: 'strings' }),
]

export const GRPC_OPTS_FIELDS: FieldSchema[] = [
  str('grpc-service-name', 'Имя gRPC-службы.'),
  str('grpc-user-agent', 'User-Agent gRPC-клиента.'),
  num('ping-interval', 'Интервал проверки живости, секунд; 0 — выключено.'),
  num('max-connections', 'Максимум соединений; несовместимо с max-streams.'),
  num('min-streams', 'Минимум потоков до нового соединения.'),
  num('max-streams', 'Максимум потоков в соединении.'),
]

const XMUX_FIELDS: FieldSchema[] = [
  str('max-concurrency', 'Одновременных потоков, например 16-32.'),
  str('max-connections', 'Максимум соединений.'),
  str('c-max-reuse-times', 'Сколько раз переиспользовать соединение.'),
  str('h-max-request-times', 'Максимум запросов на соединение.'),
  str('h-max-reusable-secs', 'Секунд жизни соединения.'),
  num('h-keep-alive-period', 'Период keep-alive.'),
]

export const XHTTP_OPTS_FIELDS: FieldSchema[] = [
  str('path', 'Путь XHTTP.'),
  str('host', 'Заголовок Host.'),
  en('mode', 'Режим XHTTP.', ['auto', 'stream-one', 'stream-up', 'packet-up']),
  map('headers', 'Дополнительные заголовки.'),
  bool('no-grpc-header', 'Не слать gRPC-заголовок.'),
  str('x-padding-bytes', 'Размер дополнения, например 100-1000.'),
  bool('x-padding-obfs-mode', 'Обфускация дополнения.'),
  str('x-padding-key', 'Ключ дополнения.'),
  str('x-padding-header', 'Заголовок дополнения.'),
  en('x-padding-placement', 'Где стоит дополнение.', ['queryInHeader', 'cookie', 'header', 'query']),
  en('x-padding-method', 'Способ дополнения.', ['repeat-x', 'tokenish']),
  en('uplink-http-method', 'Метод восходящих запросов.', ['POST', 'PUT', 'PATCH', 'DELETE']),
  en('session-placement', 'Где передаётся идентификатор сессии.', ['path', 'query', 'cookie', 'header']),
  str('session-key', 'Ключ идентификатора сессии.'),
  en('seq-placement', 'Где передаётся номер последовательности.', ['path', 'query', 'cookie', 'header']),
  str('seq-key', 'Ключ номера последовательности.'),
  en('uplink-data-placement', 'Где передаются восходящие данные.', ['body', 'cookie', 'header']),
  str('uplink-data-key', 'Ключ восходящих данных.'),
  num('uplink-chunk-size', 'Размер порции восходящих данных вне тела.'),
  num('sc-max-each-post-bytes', 'Максимум байт в одном POST.'),
  num('sc-min-posts-interval-ms', 'Минимальный интервал между POST, мс.'),
  obj('reuse-settings', 'Переиспользование соединений (XMUX).', XMUX_FIELDS),
  obj('download-settings', 'Отдельное соединение для загрузки: свои path, host, headers, reuse-settings и параметры сервера.', [
    str('path', 'Путь.'), str('host', 'Host.'), map('headers', 'Заголовки.'), obj('reuse-settings', 'XMUX загрузки.', XMUX_FIELDS),
    str('server', 'Сервер загрузки.'), num('port', 'Порт.'), bool('tls', 'TLS.'), strs('alpn', 'ALPN.'),
    obj('ech-opts', 'ECH.', ECH_OPTS_FIELDS), obj('reality-opts', 'Reality.', REALITY_OPTS_FIELDS),
    obj('shadow-tls-opts', 'ShadowTLS.', SHADOW_TLS_OPTS_FIELDS), obj('restls-opts', 'Restls.', RESTLS_OPTS_FIELDS), obj('jls-opts', 'JLS.', JLS_OPTS_FIELDS),
    bool('skip-cert-verify', 'Не проверять сертификат.'), str('name-cert-verify', 'DNSName сертификата.'), str('fingerprint', 'Отпечаток сертификата.'),
    str('certificate', 'Клиентский сертификат.'), str('private-key', 'Клиентский ключ.'), str('servername', 'SNI.'),
    en('client-fingerprint', 'Отпечаток TLS-клиента.', FINGERPRINT_VALUES),
  ]),
]

export const KCP_FIELDS: FieldSchema[] = [
  num('mtu', 'Максимальный размер пакета.'),
  num('tti', 'Интервал передачи, мс.'),
  num('uplink-capacity', 'Ёмкость отдачи, МБ/с.'),
  num('downlink-capacity', 'Ёмкость приёма, МБ/с.'),
  bool('congestion', 'Контроль перегрузки.'),
  num('write-buffer', 'Буфер записи, байт.'),
  num('read-buffer', 'Буфер чтения, байт.'),
  str('seed', 'Seed аутентификации AES-GCM; пусто — умолчание.'),
  en('header', 'Маскировка заголовка.', ['none', 'srtp', 'utp', 'wechat-video', 'dtls', 'wireguard']),
]

export const MKCP_OPTS_FIELDS: FieldSchema[] = KCP_FIELDS

export const MEKYA_OPTS_FIELDS: FieldSchema[] = [
  str('url', 'Адрес Mekya-сервера.'),
  num('max-write-delay', 'Максимальная задержка агрегации после первого пакета, мс.'),
  num('max-request-size', 'Максимальный размер одного HTTP-запроса, байт.'),
  num('polling-interval-initial', 'Начальный интервал опроса, мс.'),
  num('h2-pool-size', 'Размер пула соединений HTTP/2.'),
  obj('kcp', 'Параметры KCP внутри Mekya.', KCP_FIELDS),
]

export const IP_STACK_FIELDS: FieldSchema[] = [
  en('mode', 'Реализация IP-стека.', ['auto', 'gvisor', 'mips']),
  en('congestion-controller', 'Алгоритм перегрузки TCP (кроме gVisor).', ['cubic', 'reno', 'bbr', 'bbr3']),
]

/** Серверный TLS у входов: сертификат, mTLS, ECH */
export const TLS_SERVER_FIELDS: FieldSchema[] = [
  str('certificate', 'Сертификат сервера в PEM или путь к нему.'),
  str('private-key', 'Ключ сервера в PEM или путь к нему.'),
  en('client-auth-type', 'Проверка клиентского сертификата (mTLS).', ['', 'request', 'require-any', 'verify-if-given', 'require-and-verify']),
  str('client-auth-cert', 'Сертификат для проверки клиентов.'),
  str('ech-key', 'Ключи ECH (mihomo generate ech-keypair).'),
]
```

- [ ] **Step 4: `schema/root.ts`**

```ts
// Корень документа: скаляры и объекты настроек. Контейнеры-разделы (proxies,
// proxy-groups, rules, dns, tun, …) добавляет index.ts — у них свои ветви.

import { bool, en, map, num, obj, removed, str, strs, type FieldSchema } from '../../../shared/schema'
import { FINGERPRINT_VALUES, TLS_SERVER_FIELDS } from './shared'

export const ROOT_FIELDS: FieldSchema[] = [
  num('port', 'Порт HTTP(S)-входа.'),
  num('socks-port', 'Порт SOCKS5-входа.'),
  num('redir-port', 'Порт прозрачного проксирования (redirect, Linux/macOS, только TCP).'),
  num('tproxy-port', 'Порт прозрачного проксирования (TPROXY, Linux, TCP и UDP).'),
  num('mixed-port', 'Порт смешанного HTTP(S)+SOCKS5 входа.'),
  bool('allow-lan', 'Разрешить подключаться к портам ядра другим устройствам сети.'),
  str('bind-address', 'Адрес привязки входящих портов при allow-lan; * — все.'),
  strs('lan-allowed-ips', 'Подсети, которым разрешён доступ при allow-lan.'),
  strs('lan-disallowed-ips', 'Подсети, которым доступ запрещён; приоритет выше разрешённых.'),
  strs('authentication', 'Пары «пользователь:пароль» для http/socks/mixed входов.'),
  strs('skip-auth-prefixes', 'Подсети, которым авторизация не нужна.'),
  en('mode', 'Общий режим работы.', [
    { value: 'rule', doc: 'По правилам маршрутизации.' },
    { value: 'global', doc: 'Весь трафик через одну выбранную группу.' },
    { value: 'direct', doc: 'Весь трафик напрямую.' },
  ]),
  en('log-level', 'Уровень логирования ядра.', ['silent', 'error', 'warning', 'info', 'debug']),
  bool('ipv6', 'Разрешить IPv6; false блокирует AAAA и соединения по IPv6.'),
  bool('unified-delay', 'Единообразный расчёт задержки без влияния рукопожатия.'),
  bool('tcp-concurrent', 'Открывать TCP сразу по всем IP из DNS-ответа, оставляя первое успешное.'),
  str('interface-name', 'Исходящий сетевой интерфейс по умолчанию.'),
  num('routing-mark', 'fwmark исходящих соединений (Linux).'),
  en('find-process-mode', 'Определение процесса-источника соединения.', [
    { value: 'always', doc: 'Определять всегда.' },
    { value: 'strict', doc: 'Когда это нужно правилам (по умолчанию).' },
    { value: 'off', doc: 'Не определять — рекомендуется на роутерах.' },
  ]),
  en('global-client-fingerprint', 'Глобальный отпечаток TLS-клиента для серверов без своего.', FINGERPRINT_VALUES),
  num('keep-alive-idle', 'Простой соединения до начала TCP keep-alive, секунд.'),
  num('keep-alive-interval', 'Интервал TCP keep-alive, секунд.'),
  bool('disable-keep-alive', 'Отключить TCP keep-alive (на Android принудительно).'),
  bool('geodata-mode', 'Geo-базы в формате .dat (true) вместо .mmdb/.mrs.'),
  en('geodata-loader', 'Загрузчик geo-баз.', [
    { value: 'standard', doc: 'Разбирает базу целиком в память.' },
    { value: 'memconservative', doc: 'Экономит память (по умолчанию).' },
  ]),
  bool('geo-auto-update', 'Автообновление geo-баз ядром.'),
  num('geo-update-interval', 'Период автообновления, часов.'),
  obj('geox-url', 'Свои ссылки на geo-базы.', [
    str('geoip', 'Ссылка на geoip.dat.'), str('geosite', 'Ссылка на geosite.dat.'), str('mmdb', 'Ссылка на geoip.metadb.'), str('asn', 'Ссылка на базу ASN.'),
  ]),
  en('geosite-matcher', 'Реализация матчера geosite.', ['succinct', 'mph']),
  str('global-ua', 'User-Agent для скачивания провайдеров и geo-баз.'),
  bool('etag-support', 'ETag при скачивании внешних ресурсов.'),
  str('external-controller', 'Адрес:порт RESTful API.'),
  str('external-controller-tls', 'Адрес:порт RESTful API по HTTPS (нужен блок tls).'),
  str('external-controller-unix', 'Unix-сокет RESTful API (secret не проверяется).'),
  str('external-controller-pipe', 'Named pipe RESTful API в Windows (secret не проверяется).'),
  obj('external-controller-cors', 'CORS для RESTful API.', [strs('allow-origins', 'Разрешённые источники.'), bool('allow-private-network', 'Разрешить приватную сеть.')]),
  num('external-controller-routing-mark', 'fwmark сокета API (Linux).'),
  str('secret', 'Секрет доступа к RESTful API.'),
  str('external-ui', 'Каталог веб-панели.'),
  str('external-ui-name', 'Подкаталог веб-панели.'),
  str('external-ui-url', 'Откуда скачать веб-панель (zip или tgz).'),
  str('external-doh-server', 'Путь DoH-сервера на порту API, например /dns-query.'),
  obj('tls', 'Сертификат RESTful API по HTTPS и доверенные сертификаты.', [
    ...TLS_SERVER_FIELDS,
    strs('custom-certifactes', 'Дополнительные корневые сертификаты в PEM (ключ ядра с опечаткой — так в ядре).'),
  ]),
  obj('remnawave', 'Ключи панели Remnawave; в подписку не попадают.', [
    bool('includeHiddenHosts', 'Подставлять и скрытые (hidden) хосты профиля, а не только видимые.', { panelKey: true }),
  ], { panelKey: true }),
  bool('enable-process', 'Устаревший переключатель сопоставления по процессам.', { deprecated: removed('Meta', 'ключ find-process-mode') }),
]
```

- [ ] **Step 5: `schema/misc.ts`**

```ts
import { bool, en, map, num, str, type FieldSchema } from '../../../shared/schema'
import { dialerProxy } from './shared'

export const PROFILE_FIELDS: FieldSchema[] = [
  bool('store-selected', 'Запоминать выбор участника группы между перезапусками.'),
  bool('store-fake-ip', 'Сохранять соответствие домен → fake-ip между перезапусками.'),
  bool('tracing', 'Трассировка профиля.'),
]

export const NTP_FIELDS: FieldSchema[] = [
  bool('enable', 'Синхронизировать время по NTP.'),
  bool('write-to-system', 'Записывать время в системные часы (нужны права).'),
  str('server', 'NTP-сервер, по умолчанию time.apple.com.'),
  num('port', 'Порт NTP, по умолчанию 123.'),
  num('interval', 'Период синхронизации, минут.'),
  dialerProxy({ doc: 'Через какую группу или сервер ходить к NTP; по умолчанию напрямую.' }),
]

export const EXPERIMENTAL_FIELDS: FieldSchema[] = [
  bool('quic-go-disable-gso', 'Отключить GSO у quic-go (обход проблем на некоторых Linux).'),
  bool('quic-go-disable-ecn', 'Отключить ECN у quic-go.'),
  bool('dialer-ip4p-convert', 'Преобразование адреса IP4P для обхода NAT.'),
]

/** Раздел hosts: домен → IP, список IP, псевдоним или спецзначение lan */
export const hostsField = (): FieldSchema =>
  map('hosts', 'Соответствие домен → адрес, как /etc/hosts: значение — IP, список IP, домен-псевдоним или lan (адреса всех интерфейсов). Шаблоны *.example.com и .example.com допустимы.', { values: 'strings' })
```

Импорт `en` в `misc.ts` не нужен — убрать его из списка импортов.

- [ ] **Step 6: `schema/dns.ts`**

```ts
import { bool, en, map, num, obj, removed, str, strs, type FieldSchema } from '../../../shared/schema'

export const DNS_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить встроенный DNS-резолвер ядра; иначе используется системный DNS.'),
  en('cache-algorithm', 'Алгоритм кэша DNS-ответов.', [
    { value: 'lru', doc: 'Вытеснение давно не запрашивавшихся записей (по умолчанию).' },
    { value: 'arc', doc: 'Адаптивный кэш — лучше держит частые записи.' },
  ]),
  bool('prefer-h3', 'Пробовать HTTP/3 для DoH параллельно с обычным.'),
  str('listen', 'Адрес:порт, на котором ядро отдаёт DNS (udp и tcp).'),
  bool('ipv6', 'Отвечать на AAAA-запросы; false — пустой ответ.'),
  num('ipv6-timeout', 'Сколько ждать AAAA при двухстековом запросе, мс.'),
  bool('use-hosts', 'Учитывать секцию hosts при резолвинге.'),
  bool('use-system-hosts', 'Читать системный файл hosts.'),
  bool('respect-rules', 'Ходить к DNS-серверам с учётом правил маршрутизации; нужен непустой proxy-server-nameserver.'),
  strs('default-nameserver', 'Бутстрап-DNS: только IP, резолвит адреса остальных серверов.'),
  en('enhanced-mode', 'Режим выдачи адресов.', [
    { value: 'fake-ip', doc: 'Клиенту отдаётся фиктивный IP, домен уходит в правила.' },
    { value: 'redir-host', doc: 'Отдаётся настоящий IP.' },
  ]),
  str('fake-ip-range', 'Подсеть IPv4 фиктивных адресов.'),
  str('fake-ip-range6', 'Подсеть IPv6 фиктивных адресов.'),
  strs('fake-ip-filter', 'Домены без fake-ip: домен, шаблон, rule-set:<имя>, geosite:<категория>; в режиме rule — строки правил с целью fake-ip/real-ip.'),
  en('fake-ip-filter-mode', 'Смысл списка fake-ip-filter.', [
    { value: 'blacklist', doc: 'Перечисленным fake-ip не выдаётся (по умолчанию).' },
    { value: 'whitelist', doc: 'fake-ip выдаётся только перечисленным.' },
    { value: 'rule', doc: 'Список — правила с целью fake-ip или real-ip.' },
  ]),
  num('fake-ip-ttl', 'TTL ответа fake-ip; менять не рекомендуется.'),
  strs('nameserver', 'Основные DNS-серверы: udp://, tcp://, tls://, https://, quic://, dhcp://<интерфейс>, system, rcode://; суффикс #<группа> — через прокси, #RULES — по правилам, h3=true, ecs=, skip-cert-verify=true.'),
  strs('fallback', 'Резервные DNS-серверы на случай подмены ответа.'),
  obj('fallback-filter', 'Когда брать ответ fallback.', [
    bool('geoip', 'Проверять страну ответа по geoip.'),
    str('geoip-code', 'Код «чистой» страны, по умолчанию CN.'),
    strs('ipcidr', 'Подсети, считающиеся подменёнными.'),
    strs('domain', 'Домены, которые сразу идут через fallback.'),
    strs('geosite', 'Категории geosite через fallback.', { deprecated: removed('Meta', 'nameserver-policy') }),
  ]),
  bool('fallback-lazy-query', 'Сначала проверить ответ nameserver фильтром и только потом слать fallback.'),
  strs('proxy-server-nameserver', 'DNS только для доменов самих прокси-серверов.'),
  map('proxy-server-nameserver-policy', 'То же по доменам: домен, +.домен, geosite:, rule-set: → сервер или список серверов.', { values: 'strings' }),
  strs('direct-nameserver', 'DNS только для доменов прямого выхода.'),
  bool('direct-nameserver-follow-policy', 'Учитывать nameserver-policy для direct-nameserver.'),
  map('nameserver-policy', 'Домен, +.домен, geosite:<кат1>,<кат2> или rule-set:<имя1>,<имя2> → сервер либо список серверов.', { values: 'strings' }),
]
```

- [ ] **Step 7: `schema/tun.ts` и `schema/sniffer.ts`**

```ts
// tun.ts
import { bool, en, num, nums, removed, str, strs, type FieldSchema } from '../../../shared/schema'

export const TUN_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить TUN-интерфейс: система отдаёт ядру весь трафик.'),
  en('stack', 'Реализация сетевого стека.', [
    { value: 'system', doc: 'Системный стек — стабильнее, ниже нагрузка.' },
    { value: 'gvisor', doc: 'Пользовательский стек — больше изоляции.' },
    { value: 'mixed', doc: 'TCP через system, UDP через gvisor.' },
  ]),
  str('device', 'Имя интерфейса TUN; на macOS обязателен префикс utun.'),
  strs('dns-hijack', 'Адреса host:port, DNS-запросы к которым перехватывает ядро.'),
  bool('auto-route', 'Автоматически прописать системные маршруты через TUN.'),
  bool('auto-redirect', 'Автонастройка iptables/nftables для TCP (Linux); требует auto-route.'),
  bool('auto-detect-interface', 'Автоматически определять исходящий интерфейс.'),
  bool('strict-route', 'Строгая маршрутизация: трафик не утечёт мимо TUN.'),
  strs('route-address', 'Свои маршруты вместо маршрута по умолчанию при auto-route.'),
  strs('route-exclude-address', 'Подсети, исключённые из маршрутизации через TUN.'),
  strs('route-address-set', 'Наборы правил (rule-providers) с подсетями, добавляемыми в firewall (Linux, nftables).', { ref: 'rule-set' }),
  strs('route-exclude-address-set', 'Наборы правил с подсетями, исключаемыми из маршрутизации (Linux, nftables).', { ref: 'rule-set' }),
  strs('include-interface', 'Маршрутизировать только эти интерфейсы; несовместимо с exclude-interface.'),
  strs('exclude-interface', 'Не маршрутизировать эти интерфейсы.'),
  nums('include-uid', 'Маршрутизировать только эти UID (Linux, требует auto-route).'),
  strs('include-uid-range', 'Диапазоны UID для маршрутизации, например 1000:9999.'),
  nums('exclude-uid', 'Исключённые UID.'),
  strs('exclude-uid-range', 'Исключённые диапазоны UID.'),
  strs('include-mac-address', 'Маршрутизировать только эти MAC-адреса (Linux, auto-route и auto-redirect).'),
  strs('exclude-mac-address', 'Исключённые MAC-адреса.'),
  nums('include-android-user', 'Пользователи Android, чей трафик маршрутизируется.'),
  strs('include-package', 'Android-приложения, чей трафик маршрутизируется.'),
  strs('exclude-package', 'Android-приложения, чей трафик TUN не перехватывает.'),
  num('mtu', 'MTU интерфейса TUN.'),
  bool('gso', 'Generic Segmentation Offload (Linux).'),
  num('gso-max-size', 'Максимальный размер блока GSO.'),
  num('udp-timeout', 'Таймаут NAT-сессии UDP, секунд.'),
  num('iproute2-table-index', 'Индекс таблицы маршрутизации для auto-route (Linux).'),
  num('iproute2-rule-index', 'Индекс правила ip rule (Linux).'),
  bool('endpoint-independent-nat', 'Endpoint-Independent NAT.'),
  bool('disable-icmp-forwarding', 'Не форвардить ICMP (борьба с петлёй ICMP; ping перестаёт показывать RTT).'),
  num('file-descriptor', 'Уже открытый дескриптор TUN от внешнего лаунчера.'),
  strs('inet4-route-address', 'Маршруты IPv4 (старый синтаксис).', { deprecated: removed('Meta', 'route-address') }),
  strs('inet6-route-address', 'Маршруты IPv6 (старый синтаксис).', { deprecated: removed('Meta', 'route-address') }),
  strs('inet4-route-exclude-address', 'Исключения IPv4 (старый синтаксис).', { deprecated: removed('Meta', 'route-exclude-address') }),
  strs('inet6-route-exclude-address', 'Исключения IPv6 (старый синтаксис).', { deprecated: removed('Meta', 'route-exclude-address') }),
]
```

```ts
// sniffer.ts
import { bool, obj, ports, removed, strs, type FieldSchema } from '../../../shared/schema'

const protocol = (key: string, doc: string, withOverride: boolean): FieldSchema =>
  obj(key, doc, [
    ports('ports', 'Порты, на которых снифить; число или диапазон.'),
    ...(withOverride ? [bool('override-destination', 'Подменять адрес назначения найденным доменом; перекрывает общий override-destination.')] : []),
  ])

export const SNIFFER_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить определение домена назначения по трафику.'),
  bool('force-dns-mapping', 'Снифить трафик, распознанный как redir-host.'),
  bool('parse-pure-ip', 'Снифить и там, где домен изначально не известен.'),
  bool('override-destination', 'Подменять адрес назначения найденным доменом (общее умолчание).'),
  obj('sniff', 'Настройки по протоколам: порты и override-destination для каждого.', [
    protocol('HTTP', 'HTTP: по умолчанию порт 80.', true),
    protocol('TLS', 'TLS/SNI: по умолчанию порт 443.', true),
    protocol('QUIC', 'QUIC: по умолчанию порт 443.', true),
  ]),
  strs('force-domain', 'Домены, для которых снифинг выполняется всегда.'),
  strs('skip-domain', 'Домены, для которых результат снифинга пропускается.'),
  strs('skip-src-address', 'Подсети источника без снифинга.'),
  strs('skip-dst-address', 'Подсети назначения без снифинга.'),
  strs('sniffing', 'Список протоколов (старый синтаксис).', { deprecated: removed('Meta', 'объект sniff') }),
  strs('port-whitelist', 'Порты для снифинга (старый синтаксис).', { deprecated: removed('Meta', 'ports внутри объекта sniff') }),
]
```

Тест ждёт у `HTTP.ports` `item: { kind: 'port' }` и у всех трёх протоколов одинаковую форму: `override-destination` есть у каждого (канонический файл показывает его у HTTP, wiki — «у каждого протокола»), поэтому `withOverride` везде `true`; параметр оставлен ради читаемости вызова.

- [ ] **Step 8: Прогнать тест и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-schema.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Мутация**

Убрать `deprecated` у `enable-process` → красным «корень описывает…». Восстановить.

- [ ] **Step 10: Отчёт**

Коммит: `feat(frontend): mihomo schema branches for the root, dns, tun, sniffer and misc sections`.
### Task 4: Схема серверов `proxies[]` по типам

**Files:**
- Create: `frontend/src/entities/mihomo/schema/proxies.ts`
- Test: `frontend/test/mihomo-schema-proxies.test.ts`

**Interfaces:**
- Consumes: строители; фрагменты из `schema/shared.ts` (задача 3).
- Produces: `PROXY_TYPE_VALUES: EnumValue[]`, `PROXY_FIELDS: FieldSchema[]` (поля одной записи `proxies[]`; общие поля без `when`, протокольные — `when('type', …)`, транспортные — `when('network', …)`), `SS_CIPHER_VALUES`, `NETWORK_VALUES`.

- [ ] **Step 1: Тест**

`frontend/test/mihomo-schema-proxies.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROXY_FIELDS, PROXY_TYPE_VALUES } from '../src/entities/mihomo/schema/proxies'
import { visibleFields } from '../src/shared/schema'

const visible = (value: Record<string, unknown>) => visibleFields(PROXY_FIELDS, value).map((f) => f.key)

describe('схема серверов Mihomo', () => {
  it('все типы канонического config.yaml описаны', () => {
    const types = PROXY_TYPE_VALUES.map((e) => e.value)
    for (const t of ['direct', 'dns', 'http', 'socks5', 'ss', 'ssr', 'snell', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2',
      'tuic', 'wireguard', 'tailscale', 'zerotier', 'openvpn', 'masque', 'shadowquic', 'ssh', 'mieru', 'sudoku', 'anytls',
      'trusttunnel', 'gost-relay', 'rematch']) {
      expect(types, t).toContain(t)
    }
  })

  it('поля появляются по типу: vless видит uuid и flow, ss — cipher и plugin, wireguard — ключи и peers', () => {
    expect(visible({ type: 'vless' })).toEqual(expect.arrayContaining(['uuid', 'flow', 'packet-encoding', 'encryption', 'network', 'tls', 'servername', 'reality-opts']))
    expect(visible({ type: 'vless' })).not.toContain('cipher')
    expect(visible({ type: 'ss' })).toEqual(expect.arrayContaining(['cipher', 'password', 'plugin', 'plugin-opts', 'udp-over-tcp', 'smux']))
    expect(visible({ type: 'wireguard' })).toEqual(expect.arrayContaining(['private-key', 'public-key', 'pre-shared-key', 'ip', 'ipv6', 'reserved', 'peers', 'amnezia-wg-option', 'mtu']))
    expect(visible({ type: 'direct' })).not.toContain('server')
    expect(visible({ type: 'dns' })).not.toContain('server')
  })

  it('транспортные объекты появляются по network', () => {
    expect(visible({ type: 'vmess', network: 'ws' })).toContain('ws-opts')
    expect(visible({ type: 'vmess', network: 'ws' })).not.toContain('grpc-opts')
    expect(visible({ type: 'vmess', network: 'grpc' })).toContain('grpc-opts')
    expect(visible({ type: 'vless', network: 'xhttp' })).toContain('xhttp-opts')
    expect(visible({ type: 'vmess', network: 'mkcp' })).toContain('mkcp-opts')
    expect(visible({ type: 'vmess', network: 'mekya' })).toContain('mekya-opts')
    expect(visible({ type: 'vmess', network: 'h2' })).toContain('h2-opts')
    expect(visible({ type: 'vmess', network: 'http' })).toContain('http-opts')
  })

  it('общие поля есть у всех сетевых типов: name, type, server, port, udp, ip-version, dialer-proxy', () => {
    for (const t of ['ss', 'vmess', 'trojan', 'hysteria2', 'tuic', 'socks5']) {
      expect(visible({ type: t })).toEqual(expect.arrayContaining(['name', 'type', 'server', 'port', 'udp', 'ip-version', 'dialer-proxy', 'interface-name', 'routing-mark']))
    }
  })
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-schema-proxies.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: `schema/proxies.ts`**

```ts
// Запись `proxies[]`: сервер клиента. Общие поля видны всем типам, кроме тех,
// у которых нет сети (`direct`, `dns`, `rematch`, `tailscale`, `zerotier`);
// протокольные привязаны к `type`, транспортные — к `network`. Список типов —
// канонический docs/config.yaml ядра (ветка Meta, 2026-09-09) плюс
// wiki.metacubex.one/config/proxies/*.
//
// В шаблоне подписки серверы почти всегда подставляет панель; статические
// записи здесь — direct-«псевдоним», WireGuard/WARP, цепочки. Полнота схемы —
// решение владельца (часть 2, вопрос 1): форма обязана уметь любой тип, который
// умеет ядро, а не только те, что кладёт панель.

import { bool, en, map, num, obj, objs, str, strs, when, whenNot, withWhen, type EnumValue, type FieldSchema } from '../../../shared/schema'
import {
  BBR_PROFILE_VALUES, CLIENT_TLS_FIELDS, CONGESTION_VALUES, ECH_OPTS_FIELDS, FINGERPRINT_VALUES, GRPC_OPTS_FIELDS, H2_OPTS_FIELDS,
  HTTP_OPTS_FIELDS, IP_STACK_FIELDS, IP_VERSION_VALUES, JLS_OPTS_FIELDS, MEKYA_OPTS_FIELDS, MKCP_OPTS_FIELDS, RESTLS_OPTS_FIELDS,
  SHADOW_TLS_OPTS_FIELDS, SMUX_FIELDS, WS_OPTS_FIELDS, XHTTP_OPTS_FIELDS, dialerProxy,
} from './shared'

export const PROXY_TYPE_VALUES: EnumValue[] = [
  { value: 'direct', doc: 'Прямой выход с заданным интерфейсом или fwmark.' },
  { value: 'dns', doc: 'Перехват DNS-запросов во встроенный резолвер.' },
  { value: 'http', doc: 'HTTP(S)-прокси.' },
  { value: 'socks5', doc: 'SOCKS5.' },
  { value: 'ss', doc: 'Shadowsocks.' },
  { value: 'ssr', doc: 'ShadowsocksR.' },
  { value: 'snell', doc: 'Snell.' },
  { value: 'vmess', doc: 'VMess.' },
  { value: 'vless', doc: 'VLESS.' },
  { value: 'trojan', doc: 'Trojan.' },
  { value: 'hysteria', doc: 'Hysteria (первая версия).' },
  { value: 'hysteria2', doc: 'Hysteria 2.' },
  { value: 'tuic', doc: 'TUIC v4/v5.' },
  { value: 'wireguard', doc: 'WireGuard.' },
  { value: 'tailscale', doc: 'Tailscale (tsnet).' },
  { value: 'zerotier', doc: 'ZeroTier.' },
  { value: 'openvpn', doc: 'OpenVPN.' },
  { value: 'masque', doc: 'MASQUE (HTTP/3 или HTTP/2).' },
  { value: 'shadowquic', doc: 'ShadowQUIC.' },
  { value: 'ssh', doc: 'SSH-туннель.' },
  { value: 'mieru', doc: 'Mieru.' },
  { value: 'sudoku', doc: 'Sudoku.' },
  { value: 'anytls', doc: 'AnyTLS.' },
  { value: 'trusttunnel', doc: 'TrustTunnel.' },
  { value: 'gost-relay', doc: 'Ретранслятор GOST для цепочек через dialer-proxy.' },
  { value: 'rematch', doc: 'Повторный подбор правил с другой меткой или подсписком.' },
]

/** Типы без собственного сетевого адреса: общие поля server/port им не нужны */
const NO_ADDRESS = ['direct', 'dns', 'rematch', 'tailscale', 'zerotier']

export const SS_CIPHER_VALUES: EnumValue[] = [
  'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb', 'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr',
  'rc4-md5', 'chacha20-ietf', 'xchacha20', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
].map((value) => ({ value }))

export const NETWORK_VALUES: EnumValue[] = [
  { value: 'tcp' }, { value: 'ws', doc: 'WebSocket.' }, { value: 'http', doc: 'HTTP-маскировка.' }, { value: 'h2', doc: 'HTTP/2.' },
  { value: 'grpc' }, { value: 'xhttp', doc: 'XHTTP (SplitHTTP).' }, { value: 'mkcp', doc: 'mKCP.' }, { value: 'mekya', doc: 'Mekya.' },
]

const TLS_MIRROR_FIELDS: FieldSchema[] = [
  str('primary-key', 'Главный ключ, 32 байта в base64.'),
  strs('explicit-nonce-ciphersuites', 'Шифросьюты TLS 1.2 с явным nonce (числа).'),
  obj('defer-instance-derived-write-time', 'Задержка перед первой записью.', [num('base-nanoseconds', 'Фиксированная задержка, нс.'), num('uniform-random-multiplier-nanoseconds', 'Верхняя граница случайной добавки, нс.')]),
  obj('transport-layer-padding', 'Дополнение транспортного уровня.', [bool('enabled', 'Включить.')]),
  obj('connection-enrolment', 'Подтверждение регистрации соединения (совместимость с v2ray).', [str('primary-egress-outbound', 'Тег управляющего выхода; у mihomo пусто.')]),
  bool('sequence-watermarking-enabled', 'Водяные знаки последовательности.'),
  obj('embedded-traffic-generator', 'Генератор HTTP-трафика-носителя; шаги описаны в тексте.', []),
]

const PLUGIN_OPTS_FIELDS: FieldSchema[] = [
  en('mode', 'Режим плагина: tls/http у obfs, websocket у v2ray-plugin и gost-plugin.', ['tls', 'http', 'websocket']),
  str('host', 'Домен маскировки или Host.'),
  str('path', 'Путь (websocket).'),
  bool('tls', 'TLS у websocket (wss).'),
  bool('mux', 'Мультиплексирование websocket.'),
  map('headers', 'Заголовки websocket.'),
  str('fingerprint', 'Отпечаток сертификата сервера.'),
  str('certificate', 'Клиентский сертификат (mTLS).'),
  str('private-key', 'Клиентский ключ (mTLS).'),
  bool('skip-cert-verify', 'Не проверять сертификат.'),
  str('name-cert-verify', 'DNSName для проверки сертификата.'),
  bool('v2ray-http-upgrade', 'HTTPUpgrade вместо WebSocket.'),
  bool('v2ray-http-upgrade-fast-open', 'Быстрое открытие HTTPUpgrade.'),
  obj('ech-opts', 'ECH у websocket.', ECH_OPTS_FIELDS),
  str('password', 'Пароль shadow-tls, restls, jls.'),
  num('version', 'Версия shadow-tls: 1, 2 или 3.', { min: 1 }),
  strs('alpn', 'ALPN у shadow-tls/jls.'),
  str('version-hint', 'Версия TLS сервера-прикрытия у restls: tls12 или tls13.'),
  str('restls-script', 'Сценарий restls.'),
  str('username', 'Имя пользователя jls.'),
  // kcptun
  str('key', 'Общий секрет kcptun.'),
  en('crypt', 'Шифр kcptun.', ['aes', 'aes-128', 'aes-128-gcm', 'aes-192', 'salsa20', 'blowfish', 'twofish', 'cast5', '3des', 'tea', 'xtea', 'xor', 'none', 'null']),
  num('conn', 'Число UDP-соединений kcptun.'),
  num('autoexpire', 'Срок жизни UDP-соединения, секунд; 0 — не истекает.'),
  num('scavengettl', 'Сколько живёт истёкшее соединение, секунд.'),
  num('mtu', 'MTU пакетов UDP.'),
  num('ratelimit', 'Ограничение скорости, байт/с; 0 — без ограничения.'),
  num('sndwnd', 'Окно отправки, пакетов.'),
  num('rcvwnd', 'Окно приёма, пакетов.'),
  num('datashard', 'Reed-Solomon: доля данных.'),
  num('parityshard', 'Reed-Solomon: доля чётности.'),
  num('dscp', 'DSCP.'),
  bool('nocomp', 'Без сжатия.'),
  bool('acknodelay', 'Слать ACK сразу.'),
  num('nodelay', 'nodelay kcptun.'), num('interval', 'interval kcptun.'), num('resend', 'resend kcptun.'),
  num('sockbuf', 'Буфер сокета, байт.'), num('smuxver', 'Версия smux: 1 или 2.'), num('smuxbuf', 'Буфер де-мультиплексора, байт.'),
  num('framesize', 'Максимальный кадр smux.'), num('streambuf', 'Буфер потока, байт.'), num('keepalive', 'Интервал heartbeat, секунд.'),
]

const WG_PEER_FIELDS: FieldSchema[] = [
  str('server', 'Адрес пира.'), num('port', 'Порт пира.'), str('public-key', 'Публичный ключ пира.'),
  str('pre-shared-key', 'Общий ключ.'), strs('allowed-ips', 'Разрешённые подсети; обязательны у пира.'), strs('reserved', 'Зарезервированные байты (числа или base64).'),
]

const AMNEZIA_FIELDS: FieldSchema[] = [
  num('version', 'Версия реализации AmneziaWG; 3 — новая, остальные — прежняя.'),
  num('jc', 'Jc.'), num('jmin', 'Jmin.'), num('jmax', 'Jmax.'), num('s1', 'S1.'), num('s2', 'S2.'), num('s3', 'S3 (v1.5+).'), num('s4', 'S4 (v1.5+).'),
  str('h1', 'H1 (число или диапазон в v2+).'), str('h2', 'H2.'), str('h3', 'H3.'), str('h4', 'H4.'),
  str('i1', 'I1 (v1.5+).'), str('i2', 'I2.'), str('i3', 'I3.'), str('i4', 'I4.'), str('i5', 'I5.'),
  str('j1', 'J1 (только v1.5).'), str('j2', 'J2 (только v1.5).'), str('j3', 'J3 (только v1.5).'), num('itime', 'itime (только v1.5).'),
  str('header-protection-key', 'Ключ защиты заголовка (v3+).'), str('content-padding-addition', 'Дополнение содержимого, например 0-32 (v3+).'),
  num('rekey-after-time', 'Секунд до смены ключа (v3+).'), num('rekey-timeout', 'Таймаут смены ключа (v3+).'), num('reject-after-time', 'Секунд до отказа (v3+).'),
  num('keepalive-timeout', 'Таймаут keepalive (v3+).'), num('max-handshake-attempts', 'Попыток рукопожатия (v3+).'),
  bool('random-trailers', 'Случайные хвосты (v3.1+).'), bool('disable-cookies', 'Отключить cookies (v3.1+).'),
]

const REALM_OPTS_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить Realm.'), str('server-url', 'Адрес сервера Realm.'), str('token', 'Токен.'), str('realm-id', 'Идентификатор realm.'),
  strs('stun-servers', 'STUN-серверы.'), str('sni', 'SNI к server-url.'), bool('skip-cert-verify', 'Не проверять сертификат server-url.'),
  str('name-cert-verify', 'DNSName сертификата server-url.'), str('fingerprint', 'Отпечаток сертификата server-url.'),
  str('certificate', 'Клиентский сертификат.'), str('private-key', 'Клиентский ключ.'), strs('alpn', 'ALPN к server-url.'), str('proxy', 'Через какой прокси ходить к server-url.', { ref: 'proxy-target' }),
]

const QUIC_TUNING: FieldSchema[] = [
  num('recv-window-conn', 'Окно приёма соединения.'), num('recv-window', 'Окно приёма потока.'), bool('disable-mtu-discovery', 'Не искать MTU.'),
  num('cwnd', 'Начальное окно перегрузки.'), en('bbr-profile', 'Профиль BBR.', BBR_PROFILE_VALUES), num('max-datagram-frame-size', 'Максимальный кадр датаграммы.'),
]

const ip = (t: string, ...values: string[]) => when('type', t, ...values)

export const PROXY_FIELDS: FieldSchema[] = [
  str('name', 'Имя сервера: на него ссылаются группы и правила.'),
  en('type', 'Протокол сервера.', PROXY_TYPE_VALUES),
  str('server', 'Адрес сервера.', { when: whenNot('type', ...NO_ADDRESS) }),
  num('port', 'Порт сервера.', { when: whenNot('type', ...NO_ADDRESS) }),
  bool('udp', 'Разрешить UDP через сервер.', { when: whenNot('type', 'dns', 'rematch') }),
  en('ip-version', 'Какую версию IP использовать для сервера.', IP_VERSION_VALUES, { when: whenNot('type', 'dns', 'rematch') }),
  str('interface-name', 'Исходящий интерфейс для этого сервера.', { when: whenNot('type', 'dns', 'rematch') }),
  num('routing-mark', 'fwmark для этого сервера (Linux).', { when: whenNot('type', 'dns', 'rematch') }),
  bool('tfo', 'TCP Fast Open.', { when: whenNot('type', ...NO_ADDRESS) }),
  bool('mptcp', 'Multipath TCP.', { when: whenNot('type', ...NO_ADDRESS) }),
  dialerProxy({ when: whenNot('type', 'direct', 'dns', 'rematch') }),
  obj('smux', 'Мультиплексирование (sing-mux) поверх ss, vmess, vless, trojan.', SMUX_FIELDS, { when: ip('ss', 'vmess', 'vless', 'trojan') }),

  // http / socks5
  str('username', 'Имя пользователя.', { when: ip('http', 'socks5', 'ssh', 'mieru', 'shadowquic', 'trusttunnel', 'openvpn', 'gost-relay') }),
  str('password', 'Пароль.', { when: ip('http', 'socks5', 'ss', 'ssr', 'trojan', 'hysteria2', 'tuic', 'ssh', 'mieru', 'shadowquic', 'anytls', 'trusttunnel', 'openvpn', 'gost-relay') }),
  map('headers', 'Заголовки HTTP-прокси.', { when: ip('http') }),
  ...withWhen(CLIENT_TLS_FIELDS, ip('http', 'socks5', 'vmess', 'vless', 'trojan', 'anytls', 'trusttunnel', 'gost-relay', 'hysteria', 'hysteria2', 'tuic', 'shadowquic', 'snell')),

  // shadowsocks
  en('cipher', 'Шифр Shadowsocks.', SS_CIPHER_VALUES, { when: ip('ss', 'ssr') }),
  bool('udp-over-tcp', 'UDP поверх TCP (sing-box UoT).', { when: ip('ss') }),
  num('udp-over-tcp-version', 'Версия UoT: 1 или 2.', { when: ip('ss'), min: 1 }),
  en('plugin', 'Плагин обфускации.', ['obfs', 'v2ray-plugin', 'shadow-tls', 'restls', 'gost-plugin', 'jls', 'kcptun'], { when: ip('ss') }),
  obj('plugin-opts', 'Параметры плагина: набор зависит от plugin.', PLUGIN_OPTS_FIELDS, { when: ip('ss') }),

  // ssr
  str('obfs', 'Обфускация SSR либо hysteria/hysteria2 (obfs_str, salamander, gecko).', { when: ip('ssr', 'hysteria', 'hysteria2') }),
  str('protocol', 'Протокол SSR либо протокол hysteria (udp, wechat-video, faketcp).', { when: ip('ssr', 'hysteria') }),
  str('obfs-param', 'Параметр обфускации SSR.', { when: ip('ssr') }),
  str('protocol-param', 'Параметр протокола SSR.', { when: ip('ssr') }),

  // snell
  str('psk', 'Общий ключ Snell.', { when: ip('snell') }),
  num('version', 'Версия Snell: 1–5.', { when: ip('snell'), min: 1 }),
  bool('reuse', 'Переиспользование соединений (Snell v4/v5).', { when: ip('snell') }),
  obj('obfs-opts', 'Обфускация Snell.', [
    en('mode', 'Режим.', ['http', 'tls', 'shadow-tls', 'restls', 'jls']), str('host', 'Домен маскировки.'), str('password', 'Пароль shadow-tls/restls/jls.'),
    num('version', 'Версия shadow-tls.'), strs('alpn', 'ALPN.'), str('version-hint', 'Версия TLS restls.'), str('username', 'Имя пользователя jls.'),
  ], { when: ip('snell') }),

  // vmess / vless
  str('uuid', 'UUID пользователя.', { when: ip('vmess', 'vless', 'tuic') }),
  num('alterId', 'alterId VMess.', { when: ip('vmess') }),
  en('cipher', 'Шифр VMess.', ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none'], { when: ip('vmess') }),
  str('flow', 'Поток XTLS: xtls-rprx-vision у VLESS; xtls-rprx-origin/direct у Trojan.', { when: ip('vless', 'trojan') }),
  bool('flow-show', 'Показывать поток (Trojan XTLS).', { when: ip('trojan') }),
  en('packet-encoding', 'Кодирование пакетов.', ['packetaddr', 'xudp'], { when: ip('vmess', 'vless') }),
  str('encryption', 'VLESS encryption: строка mlkem768x25519plus… либо пусто.', { when: ip('vless') }),
  bool('global-padding', 'Глобальное дополнение VMess.', { when: ip('vmess') }),
  bool('authenticated-length', 'Аутентифицированная длина VMess.', { when: ip('vmess') }),
  obj('tlsmirror-opts', 'TLS-mirror: TLS-носитель с настройками из servername/alpn/… этой записи.', TLS_MIRROR_FIELDS, { when: ip('vmess') }),
  en('network', 'Транспорт.', NETWORK_VALUES, { when: ip('vmess', 'vless', 'trojan') }),
  obj('ws-opts', 'Параметры WebSocket.', WS_OPTS_FIELDS, { when: when('network', 'ws') }),
  obj('h2-opts', 'Параметры HTTP/2.', H2_OPTS_FIELDS, { when: when('network', 'h2') }),
  obj('http-opts', 'Параметры HTTP-маскировки.', HTTP_OPTS_FIELDS, { when: when('network', 'http') }),
  obj('grpc-opts', 'Параметры gRPC.', GRPC_OPTS_FIELDS, { when: when('network', 'grpc') }),
  obj('xhttp-opts', 'Параметры XHTTP.', XHTTP_OPTS_FIELDS, { when: when('network', 'xhttp') }),
  obj('mkcp-opts', 'Параметры mKCP.', MKCP_OPTS_FIELDS, { when: when('network', 'mkcp') }),
  obj('mekya-opts', 'Параметры Mekya.', MEKYA_OPTS_FIELDS, { when: when('network', 'mekya') }),

  // trojan
  obj('ss-opts', 'Shadowsocks внутри Trojan (как в trojan-go).', [bool('enabled', 'Включить.'), en('method', 'Шифр.', ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']), str('password', 'Пароль.')], { when: ip('trojan') }),

  // hysteria / hysteria2
  str('ports', 'Порты прыжков, например 1000,2000-3000; port при этом обязателен.', { when: ip('hysteria', 'hysteria2') }),
  str('hop-interval', 'Интервал смены порта, секунд или диапазон 15-30.', { when: ip('hysteria2') }),
  str('auth-str', 'Пароль Hysteria.', { when: ip('hysteria') }),
  str('up', 'Скорость отдачи, например 30 Mbps.', { when: ip('hysteria', 'hysteria2', 'shadowquic') }),
  str('down', 'Скорость приёма, например 200 Mbps.', { when: ip('hysteria', 'hysteria2', 'shadowquic') }),
  str('obfs-password', 'Пароль обфускации Hysteria 2.', { when: ip('hysteria2') }),
  num('obfs-min-packet-size', 'Минимальный размер пакета (gecko).', { when: ip('hysteria2') }),
  num('obfs-max-packet-size', 'Максимальный размер пакета (gecko).', { when: ip('hysteria2') }),
  bool('fast-open', 'Быстрое открытие (Hysteria, TUIC).', { when: ip('hysteria', 'tuic') }),
  obj('realm-opts', 'Hysteria 2 Realm.', REALM_OPTS_FIELDS, { when: ip('hysteria2') }),
  num('handshake-timeout', 'Таймаут рукопожатия, секунд; 0 — только внешний таймаут.', { when: ip('hysteria2', 'masque', 'openvpn') }),
  num('initial-stream-receive-window', 'quic-go: начальное окно потока.', { when: ip('hysteria2') }),
  num('max-stream-receive-window', 'quic-go: максимальное окно потока.', { when: ip('hysteria2') }),
  num('initial-connection-receive-window', 'quic-go: начальное окно соединения.', { when: ip('hysteria2') }),
  num('max-connection-receive-window', 'quic-go: максимальное окно соединения.', { when: ip('hysteria2') }),

  // tuic
  str('token', 'Токен TUIC v4.', { when: ip('tuic') }),
  str('ip', 'IP сервера в обход DNS (TUIC) либо адрес интерфейса (WireGuard, MASQUE).', { when: ip('tuic', 'wireguard', 'masque') }),
  num('heartbeat-interval', 'Интервал heartbeat, мс.', { when: ip('tuic') }),
  bool('disable-sni', 'Не отправлять SNI.', { when: ip('tuic') }),
  bool('reduce-rtt', '0-RTT рукопожатие.', { when: ip('tuic') }),
  num('request-timeout', 'Таймаут запроса, мс.', { when: ip('tuic') }),
  en('udp-relay-mode', 'Режим UDP-ретрансляции.', ['native', 'quic'], { when: ip('tuic') }),
  en('congestion-controller', 'Алгоритм перегрузки QUIC.', CONGESTION_VALUES, { when: ip('tuic', 'shadowquic', 'masque', 'trusttunnel') }),
  num('max-udp-relay-packet-size', 'Максимальный UDP-пакет.', { when: ip('tuic') }),
  num('max-open-streams', 'Максимум открытых потоков.', { when: ip('tuic', 'shadowquic') }),
  bool('udp-over-stream', 'UDP поверх потока (расширение Meta).', { when: ip('tuic', 'shadowquic') }),
  num('udp-over-stream-version', 'Версия UDP поверх потока.', { when: ip('tuic') }),
  ...withWhen(QUIC_TUNING, ip('hysteria', 'hysteria2', 'tuic', 'shadowquic', 'trusttunnel')),

  // wireguard
  str('ipv6', 'Адрес IPv6 интерфейса.', { when: ip('wireguard', 'masque') }),
  str('private-key', 'Приватный ключ.', { when: ip('wireguard', 'masque') }),
  str('public-key', 'Публичный ключ сервера.', { when: ip('wireguard', 'masque') }),
  str('pre-shared-key', 'Общий ключ WireGuard.', { when: ip('wireguard') }),
  strs('reserved', 'Зарезервированные байты: строка base64 или три числа.', { when: ip('wireguard') }),
  num('persistent-keepalive', 'Keepalive, секунд.', { when: ip('wireguard') }),
  obj('ip-stack', 'Реализация IP-стека и алгоритм перегрузки.', IP_STACK_FIELDS, { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),
  bool('remote-dns-resolve', 'Резолвить домены удалённо через туннель.', { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),
  strs('dns', 'DNS-серверы внутри туннеля (при remote-dns-resolve).', { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),
  num('refresh-server-ip-interval', 'Пересчитывать IP сервера каждые N секунд; 0 — только при старте.', { when: ip('wireguard') }),
  objs('peers', 'Пиры WireGuard; при непустом списке server/port/public-key записи игнорируются.', WG_PEER_FIELDS, { label: (v, i) => `пир #${i + 1}` }, { when: ip('wireguard') }),
  obj('amnezia-wg-option', 'Параметры AmneziaWG.', AMNEZIA_FIELDS, { when: ip('wireguard') }),
  num('mtu', 'MTU туннеля.', { when: ip('wireguard', 'zerotier', 'openvpn', 'masque') }),

  // tailscale / zerotier
  str('hostname', 'Имя устройства Tailscale.', { when: ip('tailscale') }),
  str('auth-key', 'Ключ авторизации Tailscale.', { when: ip('tailscale') }),
  str('control-url', 'Адрес control-сервера (Headscale).', { when: ip('tailscale') }),
  str('state-dir', 'Каталог состояния.', { when: ip('tailscale', 'zerotier') }),
  bool('ephemeral', 'Эфемерный узел.', { when: ip('tailscale') }),
  bool('accept-routes', 'Принимать subnet routes.', { when: ip('tailscale') }),
  str('exit-node', 'Выходной узел: IP или auto:any.', { when: ip('tailscale') }),
  bool('exit-node-allow-lan-access', 'Доступ к LAN при выходном узле.', { when: ip('tailscale') }),
  str('planet', 'Файл planet ZeroTier.', { when: ip('zerotier') }),
  num('physical-mtu', 'MTU UDP-нагрузки ZeroTier.', { when: ip('zerotier') }),
  num('primary-port', 'Основной UDP-порт ZeroTier.', { when: ip('zerotier') }),
  num('secondary-port', 'Второй UDP-порт; -1 — выключен.', { when: ip('zerotier'), min: -1 }),
  en('tcp-fallback-mode', 'Резерв через TCP-ретранслятор.', ['auto', 'force', 'disable'], { when: ip('zerotier') }),
  str('tcp-fallback-relay', 'Адрес TCP-ретранслятора.', { when: ip('zerotier') }),
  str('remote-trace-target', 'Узел для диагностических трасс.', { when: ip('zerotier') }),
  num('remote-trace-level', 'Уровень трасс.', { when: ip('zerotier') }),
  bool('low-bandwidth', 'Экономить фоновый трафик.', { when: ip('zerotier') }),
  bool('encrypted-hello', 'Шифрованный HELLO.', { when: ip('zerotier') }),
  objs('orbit', 'Федеративные корни (moons).', [str('world', 'ID мира.'), str('seed', 'ID узла-корня.')], { label: (_v, i) => `moon #${i + 1}` }, { when: ip('zerotier') }),

  // openvpn
  en('proto', 'Транспорт OpenVPN.', ['udp', 'tcp'], { when: ip('openvpn') }),
  str('dev', 'Устройство OpenVPN; только tun.', { when: ip('openvpn') }),
  strs('data-ciphers', 'Список шифров канала данных.', { when: ip('openvpn') }),
  str('data-ciphers-fallback', 'Шифр на случай неудачного согласования.', { when: ip('openvpn') }),
  str('auth', 'HMAC: MD5, SHA1, SHA256, SHA384, SHA512.', { when: ip('openvpn') }),
  en('comp-lzo', 'Сжатие LZO.', ['yes', 'no', 'adaptive'], { when: ip('openvpn') }),
  str('ca', 'Сертификат CA в PEM.', { when: ip('openvpn') }),
  str('cert', 'Сертификат клиента в PEM.', { when: ip('openvpn') }),
  str('key', 'Ключ клиента в PEM (OpenVPN) либо ключ Sudoku.', { when: ip('openvpn', 'sudoku') }),
  str('tls-auth', 'Статический ключ tls-auth.', { when: ip('openvpn') }),
  str('key-direction', 'Направление tls-auth: 0 или 1.', { when: ip('openvpn') }),
  str('tls-crypt', 'Статический ключ tls-crypt.', { when: ip('openvpn') }),
  str('tls-crypt-v2', 'Клиентский ключ tls-crypt-v2.', { when: ip('openvpn') }),
  map('peer-info', 'Пары peer-info для сервера.', { when: ip('openvpn') }),
  num('ping', 'Интервал ping.', { when: ip('openvpn') }),
  num('ping-restart', 'Перезапуск без ответа, секунд.', { when: ip('openvpn') }),
  num('tran-window', 'Сколько секунд старый ключ данных живёт после смены.', { when: ip('openvpn') }),

  // ssh
  str('privateKey', 'Путь к приватному ключу SSH (ключ ядра в camelCase).', { when: ip('ssh') }),
  str('private-key-passphrase', 'Пароль к ключу SSH.', { when: ip('ssh') }),
  strs('host-key', 'Ожидаемые ключи хоста.', { when: ip('ssh') }),
  strs('host-key-algorithms', 'Алгоритмы ключа хоста.', { when: ip('ssh') }),

  // mieru
  str('port-range', 'Диапазон портов Mieru; несовместимо с port.', { when: ip('mieru') }),
  en('transport', 'Транспорт Mieru.', ['TCP', 'UDP'], { when: ip('mieru') }),
  en('multiplexing', 'Уровень мультиплексирования.', ['MULTIPLEXING_OFF', 'MULTIPLEXING_LOW', 'MULTIPLEXING_MIDDLE', 'MULTIPLEXING_HIGH'], { when: ip('mieru') }),
  en('handshake-mode', 'Режим рукопожатия.', ['HANDSHAKE_STANDARD', 'HANDSHAKE_NO_WAIT'], { when: ip('mieru') }),
  str('traffic-pattern', 'Строка base64, подстраивающая сетевое поведение.', { when: ip('mieru') }),

  // sudoku
  en('aead-method', 'AEAD Sudoku.', ['chacha20-poly1305', 'aes-128-gcm', 'none'], { when: ip('sudoku') }),
  num('padding-min', 'Минимальная доля дополнения, %.', { when: ip('sudoku') }),
  num('padding-max', 'Максимальная доля дополнения, %.', { when: ip('sudoku') }),
  en('table-type', 'Таблица байтов.', ['prefer_ascii', 'prefer_entropy', 'up_ascii_down_entropy', 'up_entropy_down_ascii'], { when: ip('sudoku') }),
  str('custom-table', 'Своя таблица байтов (2 x, 2 p, 4 v).', { when: ip('sudoku') }),
  strs('custom-tables', 'Список своих таблиц; перекрывает custom-table.', { when: ip('sudoku') }),
  en('multiplex', 'Мультиплексирование Sudoku.', ['off', 'auto', 'on'], { when: ip('sudoku') }),
  obj('httpmask', 'HTTP-маскировка Sudoku.', [
    bool('disable', 'Отключить маскировку.'), en('mode', 'Режим.', ['legacy', 'stream', 'poll', 'auto', 'ws']), bool('tls', 'HTTPS/WSS.'),
    str('host', 'Host/SNI.'), str('path-root', 'Префикс путей.'), en('multiplex', 'Мультиплексирование (старый ключ).', ['off', 'auto', 'on']),
  ], { when: ip('sudoku') }),
  bool('enable-pure-downlink', 'Чистый нисходящий поток Sudoku.', { when: ip('sudoku') }),

  // anytls / trusttunnel / shadowquic
  str('client-metadata', 'Метаданные клиента для сервера AnyTLS.', { when: ip('anytls') }),
  num('idle-session-check-interval', 'Интервал проверки простаивающих сессий, секунд.', { when: ip('anytls') }),
  num('idle-session-timeout', 'Таймаут простаивающей сессии, секунд.', { when: ip('anytls') }),
  num('min-idle-session', 'Минимум простаивающих сессий.', { when: ip('anytls') }),
  bool('health-check', 'Проверка живости TrustTunnel.', { when: ip('trusttunnel') }),
  bool('quic', 'QUIC вместо TCP (TrustTunnel).', { when: ip('trusttunnel') }),
  num('max-connections', 'Максимум соединений (TrustTunnel).', { when: ip('trusttunnel') }),
  num('min-streams', 'Минимум потоков до нового соединения (TrustTunnel).', { when: ip('trusttunnel') }),
  num('max-streams', 'Максимум потоков в соединении (TrustTunnel).', { when: ip('trusttunnel') }),
  strs('quic-versions', 'Версии QUIC: v1, v2.', { when: ip('shadowquic') }),
  bool('zero-rtt', '0-RTT ShadowQUIC.', { when: ip('shadowquic') }),
  num('keep-alive-interval', 'Интервал keep-alive, мс.', { when: ip('shadowquic') }),

  // masque / gost-relay / rematch
  en('network', 'Режим MASQUE.', ['h3', 'h3-l4proxy', 'h2'], { when: ip('masque') }),
  bool('mux', 'Мультиплексирование GOST relay.', { when: ip('gost-relay') }),
  bool('forward', 'Режим форварда GOST relay: сервер сам выбирает цель.', { when: ip('gost-relay') }),
  str('target-rematch-name', 'Новая метка для REMATCH-NAME.', { when: ip('rematch') }),
  str('target-sub-rule', 'Подсписок, которым продолжить подбор.', { when: ip('rematch'), ref: 'sub-rule' }),

  // zerotier network id (строка, не транспорт)
  str('network', 'ID сети ZeroTier (16 hex-символов).', { when: ip('zerotier') }),
]
```

Импорты сверить с использованием (в `proxies.ts` нужны не все фрагменты `shared.ts`): `tsc` с `noUnusedLocals` не пропустит лишние.

Два поля `network` с разными условиями (транспорт vmess/vless/trojan, режим masque, id сети zerotier) законны: `fieldsAt` фильтрует по `when`, и в форме видно ровно одно. Так же и `cipher` (ss/ssr против vmess), `ip`, `key`, `password`, `obfs`, `protocol`: один ключ, разные описания по типу.

- [ ] **Step 4: Прогнать тест и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-schema-proxies.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Мутация**

Убрать `{ when: when('network', 'ws') }` у `ws-opts` → красным «транспортные объекты появляются по network» (`grpc` покажет `ws-opts`). Восстановить.

- [ ] **Step 6: Отчёт**

Коммит: `feat(frontend): mihomo proxy schema for every core proxy type`.

### Task 5: Группы, провайдеры, наборы, входы, туннели и корень схемы

**Files:**
- Create: `frontend/src/entities/mihomo/schema/groups.ts`, `providers.ts`, `listeners.ts`, `index.ts`
- Modify: `frontend/test/mihomo-schema.test.ts` (добавить блок корня)

**Interfaces:**
- Consumes: ветви задач 3, 4; `groupsOf`, `proxiesOf` (задача 8), `providersOf`, `ruleProvidersOf`, `subRuleNames` из `entities/mihomo/groups.ts`; `BUILTIN_TARGETS` из `resolve.ts`.
- Produces:
  - `GROUP_TYPE_VALUES`, `GROUP_FIELDS`; `PROVIDER_FIELDS` (запись proxy-providers), `RULE_PROVIDER_FIELDS`; `LISTENER_TYPE_VALUES`, `LISTENER_FIELDS`, `TUNNEL_FIELDS`.
  - `index.ts`: `MIHOMO_SCHEMA: FieldSchema[]`, `mihomoFieldsAt(path, json)`, `mihomoFieldAt(path, json)`, `mihomoRefs(md): DocRefs`, `MIHOMO_DOC_SECTIONS: DocSection[]`, реэкспорт всех ветвей.

- [ ] **Step 1: Дополнить тест корня**

Добавить в `frontend/test/mihomo-schema.test.ts`:

```ts
import { MIHOMO_DOC_SECTIONS, MIHOMO_SCHEMA, mihomoFieldAt, mihomoFieldsAt, mihomoRefs } from '../src/entities/mihomo/schema'
import { GROUP_FIELDS } from '../src/entities/mihomo/schema/groups'
import { LISTENER_FIELDS, LISTENER_TYPE_VALUES } from '../src/entities/mihomo/schema/listeners'
import { PROVIDER_FIELDS, RULE_PROVIDER_FIELDS } from '../src/entities/mihomo/schema/providers'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { walkSchema } from '../src/shared/schema'

describe('схема Mihomo: корень и помощники', () => {
  it('корень содержит все разделы документа', () => {
    for (const k of ['proxies', 'proxy-groups', 'proxy-providers', 'rule-providers', 'rules', 'sub-rules', 'dns', 'hosts', 'tun', 'sniffer',
      'profile', 'ntp', 'experimental', 'listeners', 'tunnels', 'mode', 'remnawave']) {
      expect(keys(MIHOMO_SCHEMA), k).toContain(k)
    }
  })

  it('спуск по пути: элемент proxy-groups, запись proxy-providers, sub-rules', () => {
    const json = { 'proxy-groups': [{ name: 'a', type: 'url-test' }], 'proxy-providers': { p: { type: 'http' } } }
    expect(keys(mihomoFieldsAt(['proxy-groups', 0], json)!)).toContain('tolerance')
    expect(keys(mihomoFieldsAt(['proxy-providers', 'p'], json)!)).toContain('health-check')
    expect(mihomoFieldAt(['rule-providers', 'x', 'behavior'], {})?.enum!.map((e) => e.value)).toEqual(['domain', 'ipcidr', 'classical'])
    expect(mihomoFieldAt(['sub-rules'], {})?.kind).toBe('map')
  })

  it('у каждого deprecated есть замена, у каждого ref — известный вид', () => {
    const refs = new Set(['outbound', 'inbound', 'dns-server', 'rule-set', 'proxy-target', 'provider', 'sub-rule'])
    const walk = (fields: FieldSchema[]) => {
      for (const f of fields) {
        if (f.deprecated) expect(f.deprecated.replacement, f.key).not.toBe('')
        if (f.ref) expect(refs.has(f.ref), f.key).toBe(true)
        if (f.item?.ref) expect(refs.has(f.item.ref), f.key).toBe(true)
        if (f.fields) walk(f.fields)
        if (f.item?.fields) walk(f.item.fields)
      }
    }
    walk(MIHOMO_SCHEMA)
  })

  it('mihomoRefs: цели маршрута — группы, статические серверы и встроенные; провайдеры, наборы, подсписки', () => {
    const md = parseMihomo(['proxies:', '  - name: s1', '    type: direct', 'proxy-groups:', '  - name: G', '    type: select',
      'proxy-providers:', '  P: {type: http, url: u}', 'rule-providers:', '  R: {type: http, behavior: domain, url: u}',
      'sub-rules:', '  S: []', ''].join('\n'))
    const refs = mihomoRefs(md)
    expect(refs['proxy-target']).toEqual(['G', 's1', 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'])
    expect(refs.provider).toEqual(['P'])
    expect(refs['rule-set']).toEqual(['R'])
    expect(refs['sub-rule']).toEqual(['S'])
  })

  it('разделы панели «Документ»: порядок и виды', () => {
    expect(MIHOMO_DOC_SECTIONS.map((s) => [s.title, s.kind])).toEqual([
      ['Общие', 'object'], ['DNS', 'object'], ['TUN', 'object'], ['Снифер', 'object'], ['Профиль', 'object'], ['NTP', 'object'],
      ['Экспериментальное', 'object'], ['Входы', 'list'], ['Туннели', 'list'], ['Наборы правил', 'map'], ['Провайдеры', 'map'], ['Подсписки', 'map'],
    ])
    expect(MIHOMO_DOC_SECTIONS[0]!.skip).toEqual(expect.arrayContaining(['proxies', 'proxy-groups', 'rules', 'dns', 'tun', 'sniffer', 'profile', 'ntp', 'experimental', 'listeners', 'tunnels', 'rule-providers', 'proxy-providers', 'sub-rules']))
  })

  it('walkSchema обходит группы, серверы, провайдеров и входы', () => {
    const json = { 'proxy-groups': [{ name: 'a', type: 'relay' }], listeners: [{ name: 'l', type: 'mixed' }], 'proxy-providers': { p: { type: 'http' } } }
    const seen: string[] = []
    walkSchema(MIHOMO_SCHEMA, json, (path) => seen.push(path.join('.')))
    expect(seen).toEqual(expect.arrayContaining(['', 'proxy-groups.0', 'listeners.0']))
  })

  it('группа: relay устарел, remnawave — ключи панели', () => {
    expect(field(GROUP_FIELDS, 'type').enum!.find((e) => e.value === 'relay')?.deprecated).toBeDefined()
    expect(field(GROUP_FIELDS, 'remnawave').panelKey).toBe(true)
    expect(field(PROVIDER_FIELDS, 'payload').item?.kind).toBe('object')
    expect(field(RULE_PROVIDER_FIELDS, 'format').enum!.map((e) => e.value)).toEqual(['yaml', 'text', 'mrs'])
    expect(LISTENER_TYPE_VALUES.map((e) => e.value)).toEqual(expect.arrayContaining(['socks', 'http', 'mixed', 'redir', 'tproxy', 'tun', 'shadowsocks', 'vmess', 'vless', 'trojan', 'anytls', 'mieru', 'sudoku', 'tuic', 'shadowquic', 'hysteria2', 'hysteria2-realm', 'trusttunnel', 'tunnel', 'snell']))
    expect(field(LISTENER_FIELDS, 'port').item?.kind).toBeUndefined()
    expect(field(LISTENER_FIELDS, 'port').kind).toBe('string')
  })
})
```

`port` у входа — строка: ядро принимает и число, и список диапазонов `200,204,401-429`; форма читает число как строку и пишет число, если строка целиком из цифр (см. форму входа, задача 12).

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-schema.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: `schema/groups.ts`**

```ts
import { bool, en, num, obj, removed, str, strs, type EnumValue, type FieldSchema } from '../../../shared/schema'

export const GROUP_TYPE_VALUES: EnumValue[] = [
  { value: 'select', doc: 'Выбор вручную из списка участников.' },
  { value: 'url-test', doc: 'Автовыбор самого быстрого по проверке url.' },
  { value: 'fallback', doc: 'Первый живой по порядку списка.' },
  { value: 'load-balance', doc: 'Распределение соединений между участниками.' },
  { value: 'relay', doc: 'Цепочка через участников по очереди.', deprecated: removed('Meta', 'поле dialer-proxy у сервера или провайдера') },
]

export const GROUP_FIELDS: FieldSchema[] = [
  str('name', 'Имя группы. На него ссылаются правила и другие группы.'),
  en('type', 'Как группа выбирает участника.', GROUP_TYPE_VALUES),
  strs('proxies', 'Участники, перечисленные вручную: серверы, группы и встроенные цели. Панель допишет подставленные хосты В КОНЕЦ.', { ref: 'proxy-target' }),
  strs('use', 'Провайдеры (proxy-providers), чьи серверы входят в группу.', { ref: 'provider' }),
  str('url', 'Адрес проверки живости для url-test, fallback и load-balance.'),
  num('interval', 'Период проверки живости, секунд; 0 — выключить.'),
  bool('lazy', 'Не проверять, пока группа не используется.'),
  num('timeout', 'Таймаут проверки живости, мс.'),
  num('max-failed-times', 'Сколько неудач подряд переводят участника в недоступные.'),
  num('tolerance', 'На сколько мс новый лидер должен обгонять текущего, чтобы его сменить (url-test).'),
  en('strategy', 'Способ распределения у load-balance.', [
    { value: 'round-robin', doc: 'По очереди.' },
    { value: 'consistent-hashing', doc: 'Один адрес всегда через одного участника.' },
    { value: 'sticky-sessions', doc: 'Сессия закрепляется за участником.' },
  ]),
  str('filter', 'Регулярное выражение: в группу попадут только подходящие имена серверов.'),
  str('exclude-filter', 'Регулярное выражение: подходящие имена исключаются.'),
  str('exclude-type', 'Типы серверов, которые в группу не берутся, через |.'),
  bool('include-all', 'Взять все серверы и всех провайдеров сразу.'),
  bool('include-all-proxies', 'Взять все серверы из корневого proxies.'),
  bool('include-all-providers', 'Взять серверы всех объявленных провайдеров.'),
  bool('disable-udp', 'Не пускать через группу UDP.'),
  bool('hidden', 'Не показывать группу в клиенте.'),
  str('icon', 'Адрес иконки группы для клиента.'),
  str('expected-status', 'Коды ответа, считающиеся успехом проверки, например 204 или 200/302.'),
  str('default-selected', 'Участник, выбранный по умолчанию у select.', { ref: 'proxy-target' }),
  str('empty-fallback', 'Запасной сервер при пустой группе (только сервер, не группа).', { ref: 'proxy-target' }),
  obj('remnawave', 'Ключи панели Remnawave; в подписку не попадают.', [
    bool('include-proxies', 'false — панель НЕ дописывает подставленные хосты в эту группу; true у группы ничего не значит.', { panelKey: true }),
    bool('select-random-proxy', 'Положить в группу один случайный хост.', { panelKey: true }),
    bool('shuffle-proxies-order', 'Положить все хосты в случайном порядке.', { panelKey: true }),
  ], { panelKey: true }),
  str('interface-name', 'Исходящий интерфейс группы.', { deprecated: removed('Meta', 'тот же ключ у сервера') }),
  num('routing-mark', 'fwmark группы.', { deprecated: removed('Meta', 'тот же ключ у сервера') }),
]
```

- [ ] **Step 4: `schema/providers.ts`**

```ts
import { bool, en, map, num, obj, objs, str, strs, when, type FieldSchema } from '../../../shared/schema'
import { IP_VERSION_VALUES, dialerProxy } from './shared'
import { PROXY_FIELDS } from './proxies'

const SOURCE_TYPES = [
  { value: 'http', doc: 'Скачать по url.' },
  { value: 'file', doc: 'Взять из локального файла (path).' },
  { value: 'inline', doc: 'Содержимое задано прямо в шаблоне (payload).' },
]

const HEALTH_CHECK_FIELDS: FieldSchema[] = [
  bool('enable', 'Включить периодическую проверку живости.'),
  str('url', 'Адрес проверки живости.'),
  num('interval', 'Период проверки, секунд.'),
  bool('lazy', 'Не проверять, пока провайдер не используется.'),
  num('timeout', 'Таймаут проверки, мс.'),
  str('expected-status', 'Ожидаемые коды ответа.'),
]

const OVERRIDE_FIELDS: FieldSchema[] = [
  str('additional-prefix', 'Префикс к именам всех серверов провайдера.'),
  str('additional-suffix', 'Суффикс к именам.'),
  objs('proxy-name', 'Замена имени по регулярному выражению.', [str('pattern', 'Шаблон.'), str('target', 'Замена (поддерживает $1).')], { label: (v, i) => `замена #${i + 1}` }),
  bool('skip-cert-verify', 'Не проверять сертификаты.'),
  str('name-cert-verify', 'DNSName для проверки сертификата.'),
  bool('udp', 'Разрешить UDP.'),
  bool('udp-over-tcp', 'UDP поверх TCP.'),
  bool('tfo', 'TCP Fast Open.'),
  bool('mptcp', 'Multipath TCP.'),
  str('down', 'Скорость приёма, например 50 Mbps.'),
  str('up', 'Скорость отдачи.'),
  dialerProxy(),
  str('interface-name', 'Исходящий интерфейс.'),
  num('routing-mark', 'fwmark (Linux).'),
  en('ip-version', 'Версия IP.', IP_VERSION_VALUES),
  strs('override-expr', 'Выражения в стиле yq v4; применяются после фиксированных полей по порядку.'),
]

/** Запись `proxy-providers.<имя>` */
export const PROVIDER_FIELDS: FieldSchema[] = [
  en('type', 'Откуда брать список серверов.', SOURCE_TYPES),
  str('url', 'Адрес скачивания.', { when: when('type', 'http') }),
  str('path', 'Локальный путь файла или кэша.', { when: when('type', 'http', 'file') }),
  num('interval', 'Период обновления, секунд.', { when: when('type', 'http') }),
  str('proxy', 'Через какую группу или сервер скачивать.', { ref: 'proxy-target', when: when('type', 'http') }),
  num('size-limit', 'Предел размера файла, байт; 0 — без предела.', { when: when('type', 'http') }),
  str('age-secret-key', 'Ключ расшифровки age-armor.', { when: when('type', 'http', 'file') }),
  map('header', 'HTTP-заголовки скачивания; значение — список строк.', { values: 'strings', when: when('type', 'http') }),
  obj('health-check', 'Проверка живости серверов провайдера.', HEALTH_CHECK_FIELDS),
  str('filter', 'Регулярное выражение: в провайдер попадут только подходящие имена.'),
  str('exclude-filter', 'Регулярное выражение: подходящие имена исключаются.'),
  str('exclude-type', 'Типы серверов, которые не берутся, через |.'),
  dialerProxy({ when: when('type', 'inline') }),
  objs('payload', 'Серверы прямо в шаблоне (type: inline).', PROXY_FIELDS, { label: (v, i) => ((v as { name?: unknown } | null)?.name as string) || `сервер #${i + 1}`, starter: () => ({ name: '', type: 'ss', server: '', port: 443 }) }, { when: when('type', 'inline') }),
  obj('override', 'Перекрытие полей серверов при загрузке.', OVERRIDE_FIELDS),
  obj('remnawave', 'Ключи панели Remnawave; в подписку не попадают.', [
    bool('include-proxies', 'true — панель подменит payload полными объектами подставленных хостов (для цепочки через dialer-proxy).', { panelKey: true }),
  ], { panelKey: true }),
]

/** Запись `rule-providers.<имя>` */
export const RULE_PROVIDER_FIELDS: FieldSchema[] = [
  en('type', 'Откуда брать содержимое набора.', SOURCE_TYPES),
  en('behavior', 'Формат содержимого.', [
    { value: 'domain', doc: 'Список доменов.' },
    { value: 'ipcidr', doc: 'Список подсетей.' },
    { value: 'classical', doc: 'Классические строки правил.' },
  ]),
  en('format', 'Формат файла.', [
    { value: 'yaml', doc: 'YAML (по умолчанию).' },
    { value: 'text', doc: 'Текст, по записи на строку.' },
    { value: 'mrs', doc: 'Двоичный формат mihomo; только domain и ipcidr.' },
  ], { when: when('type', 'http', 'file') }),
  str('url', 'Адрес скачивания.', { when: when('type', 'http') }),
  str('path', 'Локальный путь файла.', { when: when('type', 'http', 'file') }),
  str('path-in-bundle', 'Путь внутри BundleMRS.7z для распаковки при отсутствии файла.', { when: when('type', 'http', 'file') }),
  num('interval', 'Период обновления, секунд.', { when: when('type', 'http') }),
  str('proxy', 'Через какую группу или сервер скачивать.', { ref: 'proxy-target', when: when('type', 'http') }),
  num('size-limit', 'Предел размера файла, байт.', { when: when('type', 'http') }),
  map('header', 'HTTP-заголовки скачивания.', { values: 'strings', when: when('type', 'http') }),
  strs('payload', 'Содержимое прямо в шаблоне (type: inline).', { when: when('type', 'inline') }),
]
```

- [ ] **Step 5: `schema/listeners.ts`**

```ts
import { bool, en, map, num, obj, objs, str, strs, when, whenNot, type EnumValue, type FieldSchema } from '../../../shared/schema'
import { BBR_PROFILE_VALUES, CONGESTION_VALUES, KCP_FIELDS, TLS_SERVER_FIELDS } from './shared'
import { SS_CIPHER_VALUES } from './proxies'
import { TUN_FIELDS } from './tun'

export const LISTENER_TYPE_VALUES: EnumValue[] = [
  { value: 'socks', doc: 'SOCKS5.' }, { value: 'http', doc: 'HTTP(S).' }, { value: 'mixed', doc: 'HTTP(S) и SOCKS на одном порту.' },
  { value: 'redir', doc: 'Прозрачный (redirect).' }, { value: 'tproxy', doc: 'Прозрачный (TPROXY).' }, { value: 'tun', doc: 'TUN-интерфейс.' },
  { value: 'shadowsocks' }, { value: 'vmess' }, { value: 'vless' }, { value: 'trojan' }, { value: 'anytls' }, { value: 'mieru' }, { value: 'sudoku' },
  { value: 'tuic' }, { value: 'shadowquic' }, { value: 'hysteria2' }, { value: 'hysteria2-realm', doc: 'HTTP-сервер Realm для Hysteria 2.' },
  { value: 'trusttunnel' }, { value: 'tunnel', doc: 'Проброс порта на цель.' }, { value: 'snell' },
]

const lt = (...values: string[]) => when('type', ...values)
const USERS_LIST = objs('users', 'Пользователи входа.', [str('username', 'Имя.'), str('password', 'Пароль.'), str('uuid', 'UUID (vmess, vless).'), num('alterId', 'alterId (vmess).'), str('flow', 'Поток XTLS (vless).')], { label: (v, i) => ((v as { username?: unknown } | null)?.username as string) || `пользователь #${i + 1}` })

const SHADOW_TLS_SERVER: FieldSchema = obj('shadow-tls', 'ShadowTLS на входе.', [
  bool('enable', 'Включить.'), num('version', 'Версия 1–3.'), str('password', 'Пароль (v2).'),
  objs('users', 'Пользователи (v3).', [str('name', 'Имя.'), str('password', 'Пароль.')], { label: (v, i) => ((v as { name?: unknown } | null)?.name as string) || `#${i + 1}` }),
  obj('handshake', 'Куда проксировать рукопожатие.', [str('dest', 'Адрес:порт.'), str('proxy', 'Через какой прокси.')]),
])
const RES_TLS_SERVER: FieldSchema = obj('res-tls', 'Restls на входе.', [
  bool('enable', 'Включить.'), str('dest', 'Адрес:порт прикрытия.'), str('password', 'Пароль.'), str('restls-script', 'Сценарий.'),
  num('min-record-len', 'Минимальная длина записи.'), str('proxy', 'Через какой прокси.'), num('rate-limit', 'Ограничение fallback, бит/с.'),
])
const JLS_SERVER: FieldSchema = obj('jls-config', 'JLS на входе.', [
  bool('enable', 'Включить.'), objs('users', 'Пользователи.', [str('username', 'Имя.'), str('password', 'Пароль.')], { label: (v, i) => ((v as { username?: unknown } | null)?.username as string) || `#${i + 1}` }),
  str('dest', 'Адрес:порт прикрытия.'), str('sni', 'SNI прикрытия.'), strs('alpn', 'ALPN.'), str('proxy', 'Через какой прокси.'), num('rate-limit', 'Ограничение, бит/с.'),
])
const REALITY_SERVER: FieldSchema = obj('reality-config', 'Reality на входе; несовместим с certificate/private-key.', [
  str('dest', 'Адрес:порт прикрытия.'), str('private-key', 'Приватный ключ (mihomo generate reality-keypair).'), strs('short-id', 'Короткие идентификаторы.'), strs('server-names', 'Имена серверов.'),
  obj('limit-fallback-upload', 'Ограничение отдачи непрошедших проверку.', [num('after-bytes', 'После байт.'), num('bytes-per-sec', 'Базовая скорость.'), num('burst-bytes-per-sec', 'Пиковая скорость.')]),
  obj('limit-fallback-download', 'Ограничение приёма непрошедших проверку.', [num('after-bytes', 'После байт.'), num('bytes-per-sec', 'Базовая скорость.'), num('burst-bytes-per-sec', 'Пиковая скорость.')]),
])

export const LISTENER_FIELDS: FieldSchema[] = [
  str('name', 'Имя входа; на него ссылается правило IN-NAME.'),
  en('type', 'Тип входа.', LISTENER_TYPE_VALUES),
  str('listen', 'Адрес прослушивания; по умолчанию 0.0.0.0.', { when: whenNot('type', 'tun') }),
  str('port', 'Порт либо список диапазонов: 200,204,401-429.', { when: whenNot('type', 'tun') }),
  num('routing-mark', 'fwmark сокета (Linux).', { when: whenNot('type', 'tun') }),
  str('rule', 'Подсписок правил вместо основного списка.', { ref: 'sub-rule' }),
  str('proxy', 'Отдавать весь трафик входа этой группе или серверу, минуя правила.', { ref: 'proxy-target' }),
  bool('udp', 'Разрешить UDP.', { when: lt('socks', 'mixed', 'tproxy', 'snell') }),
  { ...USERS_LIST, when: lt('socks', 'http', 'mixed', 'vmess', 'vless', 'trojan', 'shadowquic') },
  ...TLS_SERVER_FIELDS.map((f) => ({ ...f, when: lt('socks', 'http', 'mixed', 'vmess', 'vless', 'trojan', 'anytls', 'tuic', 'hysteria2') })),
  bool('allow-insecure', 'Разрешить вход без TLS (только за nginx/caddy).', { when: lt('vless', 'trojan', 'anytls') }),
  // shadowsocks
  str('password', 'Пароль.', { when: lt('shadowsocks') }),
  en('cipher', 'Шифр.', SS_CIPHER_VALUES, { when: lt('shadowsocks') }),
  obj('simple-obfs', 'simple-obfs на входе.', [bool('enable', 'Включить.'), en('mode', 'Режим.', ['http', 'tls'])], { when: lt('shadowsocks') }),
  obj('kcp-tun', 'kcptun на входе.', [bool('enable', 'Включить.'), str('key', 'Секрет.'), str('crypt', 'Шифр.'), str('mode', 'Профиль.'), num('conn', 'Соединений.'), num('autoexpire', 'Срок жизни.'), num('scavengettl', 'TTL истёкших.'), num('ratelimit', 'Ограничение.'), num('mtu', 'MTU.'), num('sndwnd', 'Окно отправки.'), num('rcvwnd', 'Окно приёма.'), num('datashard', 'Данные RS.'), num('parityshard', 'Чётность RS.'), num('dscp', 'DSCP.'), bool('nocomp', 'Без сжатия.'), bool('acknodelay', 'ACK сразу.'), num('nodelay', 'nodelay.'), num('interval', 'interval.'), num('resend', 'resend.'), num('sockbuf', 'Буфер.'), num('smuxver', 'Версия smux.'), num('smuxbuf', 'Буфер smux.'), num('framesize', 'Кадр.'), num('streambuf', 'Буфер потока.'), num('keepalive', 'Keepalive.')], { when: lt('shadowsocks') }),
  { ...SHADOW_TLS_SERVER, when: lt('shadowsocks', 'snell', 'vmess', 'vless', 'trojan', 'anytls') },
  { ...RES_TLS_SERVER, when: lt('shadowsocks', 'snell', 'vmess', 'vless', 'trojan', 'anytls') },
  { ...JLS_SERVER, when: lt('shadowsocks', 'snell', 'vmess', 'vless', 'trojan', 'anytls') },
  { ...REALITY_SERVER, when: lt('vmess', 'vless', 'trojan') },
  // snell
  str('psk', 'Общий ключ Snell.', { when: lt('snell') }),
  num('version', 'Версия Snell 1–5.', { when: lt('snell') }),
  obj('obfs-opts', 'Обфускация Snell.', [en('mode', 'Режим.', ['http', 'tls']), str('host', 'Домен.')], { when: lt('snell') }),
  // vmess / vless / trojan
  str('ws-path', 'Путь WebSocket; непусто — транспорт ws.', { when: lt('vmess', 'vless', 'trojan') }),
  str('grpc-service-name', 'Имя gRPC-службы; непусто — транспорт grpc.', { when: lt('vmess', 'vless', 'trojan') }),
  obj('mkcp-config', 'mKCP на входе.', [bool('enable', 'Включить.'), ...KCP_FIELDS], { when: lt('vmess') }),
  obj('mekya-config', 'Mekya на входе.', [bool('enable', 'Включить.'), num('max-write-size', 'Максимум байт в ответе.'), num('max-write-duration-ms', 'Максимум длительности ответа, мс.'), num('max-simultaneous-write-connection', 'Ожидающих запросов на сессию.'), num('packet-writing-buffer', 'Буфер записи.'), obj('kcp', 'KCP.', KCP_FIELDS)], { when: lt('vmess') }),
  obj('tlsmirror-config', 'TLS-mirror на входе.', [str('dest', 'Адрес прикрытия.'), str('primary-key', 'Главный ключ.'), str('proxy', 'Прокси.'), strs('explicit-nonce-ciphersuites', 'Шифросьюты.'), bool('sequence-watermarking-enabled', 'Водяные знаки.')], { when: lt('vmess') }),
  obj('xhttp-config', 'XHTTP на входе.', [str('path', 'Путь.'), str('host', 'Host.'), en('mode', 'Режим.', ['auto', 'stream-one', 'stream-up', 'packet-up']), bool('no-sse-header', 'Без SSE-заголовка.'), str('x-padding-bytes', 'Дополнение.'), bool('x-padding-obfs-mode', 'Обфускация дополнения.'), str('x-padding-key', 'Ключ.'), str('x-padding-header', 'Заголовок.'), str('x-padding-placement', 'Место.'), str('x-padding-method', 'Способ.'), str('uplink-http-method', 'Метод.'), str('session-placement', 'Место сессии.'), str('session-key', 'Ключ сессии.'), str('session-table', 'Таблица сессий.'), str('session-length', 'Длина идентификатора.'), str('seq-placement', 'Место номера.'), str('seq-key', 'Ключ номера.'), str('uplink-data-placement', 'Место данных.'), str('uplink-data-key', 'Ключ данных.'), num('uplink-chunk-size', 'Порция.'), num('sc-max-buffered-posts', 'Буфер POST.'), str('sc-stream-up-server-secs', 'Секунды stream-up.'), num('sc-max-each-post-bytes', 'Максимум байт POST.')], { when: lt('vless') }),
  str('decryption', 'VLESS encryption на сервере.', { when: lt('vless') }),
  obj('ss-option', 'Shadowsocks внутри Trojan.', [bool('enabled', 'Включить.'), en('method', 'Шифр.', ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305']), str('password', 'Пароль.')], { when: lt('trojan') }),
  // tuic / hysteria2 / shadowquic
  strs('token', 'Токены TUIC v4.', { when: lt('tuic') }),
  map('users', 'Пользователи uuid → пароль (tuic v5, hysteria2) или имя → пароль (anytls, mieru).', { when: lt('tuic', 'hysteria2', 'anytls', 'mieru') }),
  en('congestion-controller', 'Алгоритм перегрузки.', CONGESTION_VALUES, { when: lt('tuic', 'shadowquic') }),
  en('bbr-profile', 'Профиль BBR.', BBR_PROFILE_VALUES, { when: lt('tuic', 'hysteria2', 'shadowquic') }),
  num('max-idle-time', 'Максимальный простой, мс.', { when: lt('tuic', 'hysteria2', 'shadowquic') }),
  num('authentication-timeout', 'Таймаут аутентификации, мс.', { when: lt('tuic') }),
  strs('alpn', 'ALPN.', { when: lt('tuic', 'hysteria2', 'shadowquic') }),
  num('max-udp-relay-packet-size', 'Максимальный UDP-пакет.', { when: lt('tuic') }),
  str('up', 'Скорость отдачи.', { when: lt('hysteria2', 'shadowquic') }),
  str('down', 'Скорость приёма.', { when: lt('hysteria2', 'shadowquic') }),
  str('obfs', 'Обфускация: salamander или gecko.', { when: lt('hysteria2') }),
  str('obfs-password', 'Пароль обфускации.', { when: lt('hysteria2') }),
  num('obfs-min-packet-size', 'Минимальный пакет (gecko).', { when: lt('hysteria2') }),
  num('obfs-max-packet-size', 'Максимальный пакет (gecko).', { when: lt('hysteria2') }),
  bool('ignore-client-bandwidth', 'Не учитывать полосу клиента.', { when: lt('hysteria2', 'shadowquic') }),
  str('masquerade', 'Маскировка при неудачной аутентификации: file://, http://, https://.', { when: lt('hysteria2') }),
  obj('realm-opts', 'Realm.', [bool('enable', 'Включить.'), str('server-url', 'Сервер Realm.'), str('token', 'Токен.'), str('realm-id', 'Realm.'), strs('stun-servers', 'STUN.'), str('proxy', 'Прокси к server-url.'), bool('skip-cert-verify', 'Не проверять сертификат.'), str('name-cert-verify', 'DNSName.'), str('sni', 'SNI.'), str('fingerprint', 'Отпечаток.'), str('certificate', 'Сертификат.'), str('private-key', 'Ключ.'), strs('alpn', 'ALPN.')], { when: lt('hysteria2') }),
  obj('jls-upstream', 'Куда уводить не прошедших JLS (shadowquic).', [str('addr', 'Адрес:порт.'), str('sni', 'SNI.'), str('proxy', 'Прокси.'), num('rate-limit', 'Ограничение.')], { when: lt('shadowquic') }),
  strs('quic-versions', 'Версии QUIC.', { when: lt('shadowquic') }),
  bool('zero-rtt', '0-RTT.', { when: lt('shadowquic') }),
  num('cwnd', 'Окно перегрузки.', { when: lt('shadowquic') }),
  num('max-datagram-frame-size', 'Кадр датаграммы.', { when: lt('shadowquic') }),
  num('recv-window-conn', 'Окно приёма соединения.', { when: lt('shadowquic') }),
  num('recv-window', 'Окно приёма.', { when: lt('shadowquic') }),
  bool('disable-mtu-discovery', 'Не искать MTU.', { when: lt('shadowquic') }),
  // hysteria2-realm
  num('max-realms', 'Максимум realm; 0 — без предела.', { when: lt('hysteria2-realm') }),
  num('max-realms-per-ip', 'Максимум realm на IP.', { when: lt('hysteria2-realm') }),
  str('trusted-proxy-header', 'Заголовок с настоящим IP клиента.', { when: lt('hysteria2-realm') }),
  str('realm-name-pattern', 'Регулярное выражение имён realm.', { when: lt('hysteria2-realm') }),
  // mieru / sudoku / anytls
  en('transport', 'Транспорт Mieru.', ['TCP', 'UDP'], { when: lt('mieru') }),
  str('traffic-pattern', 'Строка base64 сетевого поведения.', { when: lt('mieru') }),
  bool('user-hint-is-mandatory', 'Отклонять клиентов без подсказки пользователя.', { when: lt('mieru') }),
  str('key', 'Ключ Sudoku.', { when: lt('sudoku') }),
  en('aead-method', 'AEAD.', ['chacha20-poly1305', 'aes-128-gcm', 'none'], { when: lt('sudoku') }),
  num('padding-min', 'Минимальное дополнение, %.', { when: lt('sudoku') }),
  num('padding-max', 'Максимальное дополнение, %.', { when: lt('sudoku') }),
  en('table-type', 'Таблица байтов.', ['prefer_ascii', 'prefer_entropy', 'up_ascii_down_entropy', 'up_entropy_down_ascii'], { when: lt('sudoku') }),
  str('custom-table', 'Своя таблица.', { when: lt('sudoku') }),
  strs('custom-tables', 'Список таблиц.', { when: lt('sudoku') }),
  num('handshake-timeout', 'Таймаут рукопожатия, секунд.', { when: lt('sudoku') }),
  bool('enable-pure-downlink', 'Чистый нисходящий поток.', { when: lt('sudoku') }),
  obj('httpmask', 'HTTP-маскировка.', [bool('disable', 'Отключить.'), en('mode', 'Режим.', ['legacy', 'stream', 'poll', 'auto', 'ws']), str('path-root', 'Префикс путей.')], { when: lt('sudoku') }),
  str('fallback', 'Куда отдавать обычные HTTP-запросы.', { when: lt('sudoku') }),
  str('padding-scheme', 'Схема дополнения AnyTLS.', { when: lt('anytls') }),
  // tunnel
  strs('network', 'Сети проброса: tcp, udp.', { values: ['tcp', 'udp'], when: lt('tunnel') }),
  str('target', 'Цель проброса host:port.', { when: lt('tunnel') }),
  // tun — те же поля, что у корневого tun (без enable)
  ...TUN_FIELDS.filter((f) => f.key !== 'enable').map((f) => ({ ...f, when: lt('tun') })),
]

/** Элемент `tunnels[]` в развёрнутой форме; однострочная форма (`tcp/udp,addr,target,proxy`) — скаляр, форма его показывает на чтение */
export const TUNNEL_FIELDS: FieldSchema[] = [
  strs('network', 'Сети: tcp, udp.', { values: ['tcp', 'udp'] }),
  str('address', 'Локальный адрес:порт.'),
  str('target', 'Цель host:port.'),
  str('proxy', 'Через какую группу или сервер.', { ref: 'proxy-target' }),
]
```

`users` описан дважды (список объектов и отображение) с непересекающимися `when`: у socks/http/mixed/vmess/vless/trojan/shadowquic — список, у tuic/hysteria2/anytls/mieru — отображение; в форме видно ровно одно.

- [ ] **Step 6: `schema/index.ts`**

```ts
// Корень схемы Mihomo и помощники поверх общего разбора. Ветви собраны из
// своих файлов; здесь только сборка, спуск по пути, имена для ссылок и разделы
// панели «Документ». Прежний плоский словарь docSchema.ts заменён этим деревом:
// формы, подсказки и валидация читают ОДНО описание.

import type { MihomoDoc } from '../parse'
import { groupsOf, providersOf, proxiesOf, ruleProvidersOf, subRuleNames } from '../groups'
import { BUILTIN_TARGETS } from '../resolve'
import { fieldAt, fieldsAt, nameLabel, obj, objs, strs, type DocSection, type FieldSchema, type RefKind, type SchemaPath } from '../../../shared/schema'
import { DNS_FIELDS } from './dns'
import { GROUP_FIELDS } from './groups'
import { LISTENER_FIELDS, TUNNEL_FIELDS } from './listeners'
import { EXPERIMENTAL_FIELDS, NTP_FIELDS, PROFILE_FIELDS, hostsField } from './misc'
import { PROVIDER_FIELDS, RULE_PROVIDER_FIELDS } from './providers'
import { PROXY_FIELDS } from './proxies'
import { ROOT_FIELDS } from './root'
import { SNIFFER_FIELDS } from './sniffer'
import { TUN_FIELDS } from './tun'

export * from './shared'
export * from './root'
export * from './misc'
export * from './dns'
export * from './tun'
export * from './sniffer'
export * from './proxies'
export * from './groups'
export * from './providers'
export * from './listeners'

/**
 * Отображения записей по имени (`proxy-providers`, `rule-providers`,
 * `sub-rules`) описаны как `map` с `fields` записи: `fieldsAt` спускается
 * в них по ИМЕНИ ключа так же, как в элемент списка по индексу — см. правку
 * `resolve.ts` в этой задаче.
 */
const mapOf = (key: string, doc: string, fields: FieldSchema[]): FieldSchema => ({ key, doc, kind: 'map', fields })

export const MIHOMO_SCHEMA: FieldSchema[] = [
  ...ROOT_FIELDS,
  obj('profile', 'Что ядро помнит между перезапусками.', PROFILE_FIELDS),
  obj('experimental', 'Экспериментальные тумблеры.', EXPERIMENTAL_FIELDS),
  obj('ntp', 'Синхронизация времени.', NTP_FIELDS),
  hostsField(),
  obj('dns', 'Встроенный резолвер: серверы, fake-ip, политики по доменам. Работает при enable: true.', DNS_FIELDS, {
    starter: () => ({ enable: true, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16', 'default-nameserver': ['1.1.1.1', '8.8.8.8'], nameserver: ['1.1.1.1', '8.8.8.8'] }),
  }),
  obj('tun', 'Приём всего трафика системы через виртуальный интерфейс.', TUN_FIELDS),
  obj('sniffer', 'Определение домена по содержимому соединения (SNI, Host).', SNIFFER_FIELDS),
  objs('listeners', 'Дополнительные входы сверх портов корня.', LISTENER_FIELDS, { label: nameLabel, starter: () => ({ name: '', type: 'mixed', listen: '127.0.0.1', port: 7890 }) }),
  objs('tunnels', 'Проброс локального порта на цель через прокси.', TUNNEL_FIELDS, { label: (_v, i) => `туннель #${i + 1}`, starter: () => ({ network: ['tcp', 'udp'], address: '127.0.0.1:0', target: '', proxy: '' }) }),
  objs('proxies', 'Серверы. В шаблоне подписки их подставляет панель — В КОНЕЦ этого списка; статические записи ставятся впереди.', PROXY_FIELDS, { label: nameLabel, starter: () => ({ name: '', type: 'direct', udp: true }) }),
  objs('proxy-groups', 'Группы выбора и балансировки.', GROUP_FIELDS, { label: nameLabel, starter: () => ({ name: '', type: 'select' }) }),
  mapOf('proxy-providers', 'Внешние источники серверов.', PROVIDER_FIELDS),
  mapOf('rule-providers', 'Внешние наборы правил.', RULE_PROVIDER_FIELDS),
  strs('rules', 'Правила маршрутизации: сверху вниз, побеждает первое совпавшее.'),
  mapOf('sub-rules', 'Именованные подсписки правил для SUB-RULE.', []),
]

/** Ключи корня, у которых свой раздел панели либо холст: в разделе «Общие» они не повторяются */
export const ROOT_SKIP = ['proxies', 'proxy-groups', 'proxy-providers', 'rule-providers', 'rules', 'sub-rules', 'dns', 'tun', 'sniffer', 'profile', 'ntp', 'experimental', 'listeners', 'tunnels']

export function mihomoFieldsAt(path: SchemaPath, json: unknown): FieldSchema[] | undefined {
  return fieldsAt(MIHOMO_SCHEMA, path, json)
}

export function mihomoFieldAt(path: SchemaPath, json: unknown): FieldSchema | undefined {
  return fieldAt(MIHOMO_SCHEMA, path, json)
}

/**
 * Имена документа для полей со ссылкой. Цель маршрута — ОДНО пространство:
 * группы, статические серверы и встроенные цели адресуются из правила одним
 * полем, и предложить только группы значило бы скрыть половину холста.
 */
export function mihomoRefs(md: MihomoDoc): Partial<Record<RefKind, string[]>> {
  return {
    'proxy-target': [...groupsOf(md).map((g) => g.name), ...proxiesOf(md).map((p) => p.name), ...BUILTIN_TARGETS],
    provider: providersOf(md).map((p) => p.name),
    'rule-set': ruleProvidersOf(md).map((r) => r.name),
    'sub-rule': subRuleNames(md),
  }
}

export const MIHOMO_DOC_SECTIONS: DocSection[] = [
  { title: 'Общие', path: [], kind: 'object', skip: ROOT_SKIP },
  { title: 'DNS', path: ['dns'], kind: 'object' },
  { title: 'TUN', path: ['tun'], kind: 'object' },
  { title: 'Снифер', path: ['sniffer'], kind: 'object' },
  { title: 'Профиль', path: ['profile'], kind: 'object' },
  { title: 'NTP', path: ['ntp'], kind: 'object' },
  { title: 'Экспериментальное', path: ['experimental'], kind: 'object' },
  { title: 'Входы', path: ['listeners'], kind: 'list' },
  { title: 'Туннели', path: ['tunnels'], kind: 'list' },
  { title: 'Наборы правил', path: ['rule-providers'], kind: 'map' },
  { title: 'Провайдеры', path: ['proxy-providers'], kind: 'map' },
  { title: 'Подсписки', path: ['sub-rules'], kind: 'map' },
]
```

Правка `shared/schema/resolve.ts` (аддитивная, в этой же задаче — файл общего слоя, но тесты sing-box не меняются): в `fieldsAt` после ветки `list` добавить спуск в записи `map` с полями:

```ts
if (field.kind === 'map' && field.fields !== undefined) {
  const name = path[i + 1]
  if (typeof name !== 'string') return undefined
  fields = field.fields
  holder = isRecord(next) ? next[name] : undefined
  i += 1
  continue
}
```

и в `fieldAt` цикл снятия хвостовых сегментов заменить проверкой «последний сегмент — не ключ описанного поля»: реализовать `fieldAt` через `fieldsAt(root, path.slice(0, -1))` и поиск по последнему сегменту, а если последний сегмент — число либо имя записи `map` (родитель — поле `map` с `fields`), вернуть поле родителя:

```ts
export function fieldAt(root: FieldSchema[], path: SchemaPath, doc: unknown): FieldSchema | undefined {
  if (path.length === 0) return undefined
  const last = path[path.length - 1]
  const parentPath = path.slice(0, -1)
  if (typeof last === 'string') {
    const hit = fieldsAt(root, parentPath, doc)?.find((f) => f.key === last)
    if (hit !== undefined) return hit
  }
  // Индекс списка либо имя записи отображения: описание у самого поля-контейнера
  return parentPath.length === 0 ? undefined : fieldAt(root, parentPath, doc)
}
```

`walkSchema` спускается и в записи `map` с `fields`: после ветки `list` добавить

```ts
if (field.kind === 'map' && field.fields !== undefined && isRecord(child)) {
  for (const [name, entry] of Object.entries(child)) step(field.fields, entry, [...path, field.key, name])
}
```

Прогнать `test/schema-resolve.test.ts` (часть 1) — без правок зелёный: у sing-box полей `map` с `fields` нет.

- [ ] **Step 7: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-schema.test.ts test/mihomo-schema-proxies.test.ts test/schema-resolve.test.ts test/singbox-schema.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Мутация**

В `mihomoRefs` убрать `...BUILTIN_TARGETS` → красным «mihomoRefs…». Восстановить. Вторая: в `fieldsAt` убрать ветку `map` → красным «спуск по пути…». Восстановить.

- [ ] **Step 9: Отчёт**

Коммит: `feat(frontend): mihomo schema root with groups, providers, listeners and document sections`.
### Task 6: Писатель `applyMihomoOps`: сплайс скаляров, модель для структуры, замки, материализация

**Files:**
- Create: `frontend/src/entities/mihomo/write.ts`
- Modify: `frontend/src/entities/mihomo/parse.ts` (`merge: true`, поле `json`)
- Test: `frontend/test/mihomo-write.test.ts`; `frontend/test/mihomo-parse.test.ts` — одна проверка `json`

**Interfaces:**
- Consumes: `parseMihomo`, `MihomoDoc`, `rangeOf`; `applyEdits`, `newlineOf`, `originAt`, `setFieldAt`, `removeFieldAt` из `edits.ts`; `mergedHas`, `mergedNode`, `dealias` из `merge.ts`; `DocOp`, `SchemaPath` из `shared/schema`; `yaml`: `parseDocument`, `isAlias`, `isMap`, `isSeq`, `isScalar`.
- Produces:

```ts
export interface MihomoDoc { text: string; doc: Document.Parsed; issues: ValidationIssue[]; /** Снимок значений (toJS) — модель для форм, схемы и валидации; {} у пустого или неразбираемого */ json: unknown }
export const LOCK_ALIAS: string
export const LOCK_MERGED: string
export interface MihomoLock { kind: 'alias' | 'merged'; reason: string }
export function mihomoLockAt(md: MihomoDoc, path: SchemaPath): MihomoLock | null
export interface MihomoRefused { op: DocOp; reason: string }
export interface MihomoWriteResult { md: MihomoDoc; refused: MihomoRefused[] }
export function applyMihomoOps(md: MihomoDoc, ops: DocOp[]): MihomoWriteResult
export function materializeAt(md: MihomoDoc, path: SchemaPath): MihomoDoc
export function renameKeyAt(md: MihomoDoc, mapPath: SchemaPath, from: string, to: string): MihomoDoc
```

- [ ] **Step 1: Тесты писателя**

`frontend/test/mihomo-write.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyMihomoOps, LOCK_ALIAS, LOCK_MERGED, materializeAt, mihomoLockAt, renameKeyAt } from '../src/entities/mihomo/write'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { groupsOf, ruleProvidersOf } from '../src/entities/mihomo/groups'
import { rulesOf } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
const lf = (name: Parameters<typeof mihomoFixture>[0]) => mihomoFixture(name).replace(/\r\n/g, '\n')

describe('applyMihomoOps: режим сплайса', () => {
  it('правка существующего скаляра меняет только его байты', () => {
    const md = parseMihomo(lf('simple'))
    const { md: next, refused } = applyMihomoOps(md, [{ op: 'set', path: ['mode'], value: 'global' }])
    expect(refused).toEqual([])
    const before = md.text.split('\n')
    const after = next.text.split('\n')
    expect(after.length).toBe(before.length)
    const changed = after.filter((line, i) => line !== before[i])
    expect(changed).toEqual(['mode: global'])
  })

  it('удаление существующего скаляра забирает только его строку', () => {
    const md = parseMihomo('mode: rule\nlog-level: info # note\nipv6: false\n')
    const { md: next } = applyMihomoOps(md, [{ op: 'remove', path: ['log-level'] }])
    expect(next.text).toBe('mode: rule\nipv6: false\n')
  })
})

describe('applyMihomoOps: режим модели', () => {
  it('новый ключ, новая секция, вставка и перестановка — якоря, алиасы, слияния и комментарии целы', () => {
    const src = lf('bundle')
    const md = parseMihomo(src)
    const { md: next, refused } = applyMihomoOps(md, [
      { op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true },
      { op: 'set', path: ['sniffer', 'sniff', 'QUIC', 'ports'], value: [443] },
      { op: 'insert', path: ['rules'], index: 0, value: 'DOMAIN,a.com,DIRECT' },
      { op: 'move', path: ['proxy-groups'], from: 0, to: 1 },
    ])
    expect(refused).toEqual([])
    expect(next.issues).toEqual([])
    for (const re of [/&\w/g, /\*\w/g, /<<:/g, /#/g]) expect(count(next.text, re)).toBe(count(src, re))
    expect(groupsOf(next)[1]!.hidden).toBe(true)
    expect(rulesOf(next)[0]!.raw).toBe('DOMAIN,a.com,DIRECT')
    expect((next.json as { sniffer: { sniff: { QUIC: { ports: number[] } } } }).sniffer.sniff.QUIC.ports).toEqual([443])
  })

  it('пачка операций считает индексы по уже изменённому документу', () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\n')
    const { md: next } = applyMihomoOps(md, [
      { op: 'insert', path: ['rules'], index: 0, value: 'DOMAIN,a.com,DIRECT' },
      { op: 'insert', path: ['rules'], index: 1, value: 'DOMAIN,b.com,DIRECT' },
      { op: 'remove', path: ['rules', 0] },
    ])
    expect(rulesOf(next).map((r) => r.raw)).toEqual(['DOMAIN,b.com,DIRECT', 'MATCH,DIRECT'])
  })

  it('пустой документ: set заводит корень и промежуточные отображения', () => {
    const { md } = applyMihomoOps(parseMihomo(''), [{ op: 'set', path: ['dns', 'enable'], value: true }])
    expect(md.text).toBe('dns:\n  enable: true\n')
  })

  it('flow-коллекция больше не запирает: вставка в `proxies: []` печатается', () => {
    const md = parseMihomo('proxy-groups:\n  - name: G\n    type: select\n    proxies: []\n')
    const { md: next, refused } = applyMihomoOps(md, [{ op: 'insert', path: ['proxy-groups', 0, 'proxies'], index: 0, value: 'DIRECT' }])
    expect(refused).toEqual([])
    expect(groupsOf(next)[0]!.proxies).toEqual(['DIRECT'])
  })

  it('CRLF-документ остаётся CRLF после перепечатки', () => {
    const md = parseMihomo(mihomoFixture('default').replace(/\r?\n/g, '\r\n'))
    const { md: next } = applyMihomoOps(md, [{ op: 'set', path: ['profile', 'store-selected'], value: true }])
    expect(next.text).not.toMatch(/(^|[^\r])\n/)
  })
})

describe('замки и отказ', () => {
  const DOC = [
    'x:', '  base: &base', '    interval: 300', '  ips: &ips', '    - 10.0.0.0/8',
    'proxy-groups:', '  - name: A', '    type: select', '    <<: *base', 'tun:', '  route-exclude-address: *ips', '',
  ].join('\n')

  it('lockAt: merged у ключа через <<, alias у значения-ссылки и на пути через неё', () => {
    const md = parseMihomo(DOC)
    expect(mihomoLockAt(md, ['proxy-groups', 0, 'interval'])).toEqual({ kind: 'merged', reason: LOCK_MERGED })
    expect(mihomoLockAt(md, ['tun', 'route-exclude-address'])).toEqual({ kind: 'alias', reason: LOCK_ALIAS })
    expect(mihomoLockAt(md, ['tun', 'route-exclude-address', 0])).toEqual({ kind: 'alias', reason: LOCK_ALIAS })
    expect(mihomoLockAt(md, ['proxy-groups', 0, 'name'])).toBeNull()
    expect(mihomoLockAt(md, ['proxy-groups', 0, 'hidden'])).toBeNull()
  })

  it('операция через замок не применяется и названа в refused; остальные применяются', () => {
    const md = parseMihomo(DOC)
    const { md: next, refused } = applyMihomoOps(md, [
      { op: 'set', path: ['proxy-groups', 0, 'interval'], value: 60 },
      { op: 'insert', path: ['tun', 'route-exclude-address'], index: 0, value: '192.168.0.0/16' },
      { op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true },
    ])
    expect(refused.map((r) => r.reason)).toEqual([LOCK_MERGED, LOCK_ALIAS])
    expect(next.text).toContain('interval: 300')
    expect(groupsOf(next)[0]!.hidden).toBe(true)
  })

  it('материализация: merged становится собственным ключом, alias — копией значения; якорь у объявления цел', () => {
    const md = parseMihomo(DOC)
    const a = materializeAt(md, ['proxy-groups', 0, 'interval'])
    expect(mihomoLockAt(a, ['proxy-groups', 0, 'interval'])).toBeNull()
    expect(a.text).toContain('&base')
    const b = materializeAt(a, ['tun', 'route-exclude-address'])
    expect(mihomoLockAt(b, ['tun', 'route-exclude-address'])).toBeNull()
    expect(b.text).toContain('&ips')
    expect((b.json as { tun: { 'route-exclude-address': string[] } }).tun['route-exclude-address']).toEqual(['10.0.0.0/8'])
    const { refused } = applyMihomoOps(b, [{ op: 'set', path: ['proxy-groups', 0, 'interval'], value: 60 }])
    expect(refused).toEqual([])
  })
})

describe('renameKeyAt', () => {
  it('переименовывает ключ отображения на месте, не меняя порядок записей', () => {
    const md = parseMihomo('rule-providers:\n  a: {type: http, url: u}\n  b: {type: file, path: p}\n')
    const next = renameKeyAt(md, ['rule-providers'], 'a', 'ads')
    expect(ruleProvidersOf(next).map((r) => r.name)).toEqual(['ads', 'b'])
  })
})
```

Дополнить `frontend/test/mihomo-parse.test.ts`:

```ts
it('json — снимок значений с развёрнутыми алиасами и слияниями; у пустого текста — {}', () => {
  const md = parseMihomo('x:\n  b: &b\n    k: 1\ny:\n  <<: *b\n  z: *b\n')
  expect(md.json).toEqual({ x: { b: { k: 1 } }, y: { k: 1, z: { k: 1 } } })
  expect(parseMihomo('').json).toEqual({})
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-write.test.ts test/mihomo-parse.test.ts`
Expected: FAIL — `write.ts` нет, `json` нет.

- [ ] **Step 3: `parse.ts`**

`parseDocument(text, { keepSourceTokens: true, merge: true })` и поле `json`:

```ts
export interface MihomoDoc {
  text: string
  doc: Document.Parsed
  issues: ValidationIssue[]
  /**
   * Снимок ЗНАЧЕНИЙ документа (toJS с развёрнутыми алиасами и слияниями) —
   * модель для форм, спуска по схеме и валидации устаревшего. Узлы дерева и
   * диапазоны — по-прежнему в `doc`: писать надо туда, читать значения — отсюда.
   * У пустого и у неразбираемого документа — `{}`: форма на нём рисует «Ещё
   * поля», а не падает на toJS с нерешённым алиасом.
   */
  json: unknown
}

function snapshot(doc: Document.Parsed): unknown {
  try {
    const js: unknown = doc.toJS({ maxAliasCount: -1 })
    return typeof js === 'object' && js !== null && !Array.isArray(js) ? js : {}
  } catch {
    return {}
  }
}
```

и в `parseMihomo`: `return { text, doc, issues, json: snapshot(doc) }`. `merge: true` нужен снимку: без него `<<` остаётся ключом. `mergedNode`/`mergedHas` в `merge.ts` продолжают обходить собственную пару `<<` — с `merge: true` она остаётся в `items`, только с тегом `!!merge`.

- [ ] **Step 4: `write.ts`**

```ts
// Писатель Mihomo: операции DocOp над документом в ДВУХ режимах. Правка
// существующего собственного однострочного скаляра в блочном отображении —
// сплайс по диапазону (байты вне правки не меняются: правка формы читается в
// diff одной строкой). Всё структурное — новый ключ, вложенное отображение,
// элемент списка, порядок, flow-коллекция, многострочный скаляр — Document
// библиотеки yaml с перепечаткой toString({ lineWidth: 0 }). Спайк и тест
// ниже держат инвариант: якоря, алиасы, слияния и комментарии переживают круг.
//
// Отказ вместо порчи: путь через алиас или ключ из слияния не пишется —
// операция уходит в `refused` с причиной, остальные применяются. Форма до
// этого не доводит (спрашивает lockAt), это защита для рецептов и кабелей.
//
// Каждая операция перечитывает документ: следующая считает диапазоны по уже
// изменённому тексту, и пачка операций в одном вызове безопасна.

import { isAlias, isMap, isScalar, isSeq, parseDocument, type Document, type Pair } from 'yaml'
import type { DocOp, SchemaPath } from '../../shared/schema'
import { applyEdits, newlineOf, originAt, removeFieldAt, setFieldAt } from './edits'
import { dealias, mergedHas, mergedNode } from './merge'
import { parseMihomo, type MihomoDoc } from './parse'

export const LOCK_ALIAS = 'Значение приходит через ссылку на якорь «*» — правится в тексте, у объявления якоря.'
export const LOCK_MERGED = 'Значение приходит через слияние «<<:» — правится в тексте, у объявления слитого отображения.'

export interface MihomoLock {
  kind: 'alias' | 'merged'
  reason: string
}

export interface MihomoRefused {
  op: DocOp
  reason: string
}

export interface MihomoWriteResult {
  md: MihomoDoc
  refused: MihomoRefused[]
}

function keyOf(pair: Pair): string | undefined {
  const value = (pair.key as { value?: unknown } | null)?.value
  return typeof value === 'string' ? value : undefined
}

function ownPair(map: unknown, key: string): Pair | undefined {
  return isMap(map) ? map.items.find((p) => keyOf(p) === key) : undefined
}

/**
 * Замок по пути. Обход идёт по СОБСТВЕННЫМ узлам: алиас на любом сегменте —
 * замок alias (значение лежит у объявления якоря, писать сюда значит писать
 * туда); ключ, которого нет среди собственных, но который есть через `<<:` —
 * замок merged. Отсутствующий ключ без слияния — не замок: туда можно писать,
 * промежуточные отображения заведёт режим модели.
 */
export function mihomoLockAt(md: MihomoDoc, path: SchemaPath): MihomoLock | null {
  let node: unknown = md.doc.contents
  for (const step of path) {
    if (isAlias(node)) return { kind: 'alias', reason: LOCK_ALIAS }
    if (typeof step === 'number') {
      if (!isSeq(node)) return null
      node = node.items[step]
      continue
    }
    if (!isMap(node)) return null
    const own = ownPair(node, step)
    if (own === undefined) {
      return mergedHas(md, node, step) ? { kind: 'merged', reason: LOCK_MERGED } : null
    }
    node = own.value
  }
  return isAlias(node) ? { kind: 'alias', reason: LOCK_ALIAS } : null
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}

/** Перепечатка модели с сохранением перевода строки документа */
function print(md: MihomoDoc, doc: Document.Parsed): MihomoDoc {
  let text = doc.toString({ lineWidth: 0 })
  if (newlineOf(md.text) === '\r\n') text = text.replace(/\r?\n/g, '\r\n')
  return parseMihomo(text)
}

function freshDoc(md: MihomoDoc): Document.Parsed {
  return parseDocument(md.text, { keepSourceTokens: true, merge: true })
}

function isScalarValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * Режим сплайса: последний сегмент — строковый ключ БЕЗ точки (составные ключи
 * `setFieldAt` разбирает как путь, а у hosts ключом служит домен с точками),
 * ключ собственный, значение — скаляр, и печать уместилась в одну строку.
 * Всё прочее возвращает null — операция идёт в режим модели.
 */
function spliceOp(md: MihomoDoc, op: DocOp): string | null {
  if (op.op !== 'set' && op.op !== 'remove') return null
  const key = op.path[op.path.length - 1]
  if (typeof key !== 'string' || key.includes('.') || op.path.length === 0) return null
  const parent = op.path.slice(0, -1)
  if (originAt(md, parent, key) !== 'own') return null
  const edits = op.op === 'set'
    ? (isScalarValue(op.value) ? setFieldAt(md, parent, key, op.value) : [])
    : removeFieldAt(md, parent, key)
  return edits.length > 0 ? applyEdits(md.text, edits) : null
}

function applyModelOp(doc: Document.Parsed, op: DocOp): void {
  switch (op.op) {
    case 'set':
      doc.setIn(op.path, op.value)
      return
    case 'remove':
      doc.deleteIn(op.path)
      return
    case 'insert': {
      let seq = doc.getIn(op.path, true)
      if (!isSeq(seq)) {
        seq = doc.createNode([])
        doc.setIn(op.path, seq)
      }
      const list = seq as { items: unknown[] }
      list.items.splice(clamp(op.index, list.items.length), 0, doc.createNode(op.value))
      return
    }
    case 'move': {
      const seq = doc.getIn(op.path, true)
      if (!isSeq(seq)) return
      const items = seq.items as unknown[]
      if (op.from < 0 || op.from >= items.length || op.to < 0 || op.to >= items.length) return
      const [moved] = items.splice(op.from, 1)
      items.splice(op.to, 0, moved)
      return
    }
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}

/** Путь, по которому операция обязана быть свободна от замков: у insert/move — сам список */
function lockPathOf(op: DocOp): SchemaPath {
  return op.path
}

export function applyMihomoOps(md: MihomoDoc, ops: DocOp[]): MihomoWriteResult {
  let current = md
  const refused: MihomoRefused[] = []
  for (const op of ops) {
    const lock = mihomoLockAt(current, lockPathOf(op))
    if (lock !== null) {
      refused.push({ op, reason: lock.reason })
      continue
    }
    const spliced = spliceOp(current, op)
    if (spliced !== null) {
      current = parseMihomo(spliced)
      continue
    }
    const doc = freshDoc(current)
    try {
      applyModelOp(doc, op)
    } catch (e) {
      refused.push({ op, reason: `документ не принял правку: ${(e as Error).message}` })
      continue
    }
    current = print(current, doc)
  }
  return { md: current, refused }
}

/**
 * Материализация: значение из якоря копируется на место — собственным ключом
 * (merged) либо копией узла вместо ссылки (alias). Объявление якоря остаётся
 * нетронутым, остальные его потребители — тоже. Это правка документа
 * пользователя по его явному выбору, а не побочный эффект набора текста.
 */
export function materializeAt(md: MihomoDoc, path: SchemaPath): MihomoDoc {
  const lock = mihomoLockAt(md, path)
  if (lock === null) return md
  const doc = freshDoc(md)
  if (lock.kind === 'merged') {
    const key = path[path.length - 1]
    const parent = doc.getIn(path.slice(0, -1), true)
    if (typeof key !== 'string' || !isMap(parent)) return md
    const source = dealias(md, mergedNode(md, parent, key))
    if (source === undefined) return md
    doc.setIn(path, doc.createNode((source as { toJSON: () => unknown }).toJSON()))
    return print(md, doc)
  }
  // alias: первый сегмент пути, чьё собственное значение — ссылка
  let node: unknown = doc.contents
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    const pair = typeof step === 'string' ? ownPair(node, step) : undefined
    const child: unknown = typeof step === 'number' ? (isSeq(node) ? node.items[step] : undefined) : pair?.value
    if (isAlias(child)) {
      const resolved = child.resolve(doc)
      const copy = doc.createNode((resolved as { toJSON: () => unknown } | undefined)?.toJSON())
      if (pair !== undefined) pair.value = copy
      else if (isSeq(node) && typeof step === 'number') node.items[step] = copy
      return print(md, doc)
    }
    node = child
  }
  return md
}

/** Переименование ключа отображения НА МЕСТЕ: порядок записей сохраняется */
export function renameKeyAt(md: MihomoDoc, mapPath: SchemaPath, from: string, to: string): MihomoDoc {
  const doc = freshDoc(md)
  const map = doc.getIn(mapPath, true)
  const pair = ownPair(map, from)
  if (pair === undefined) return md
  pair.key = doc.createNode(to)
  return print(md, doc)
}
```

Проверка на `isScalar` в импортах: если не используется — убрать импорт.

- [ ] **Step 5: Прогнать тесты, соседние тесты модели и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-write.test.ts test/mihomo-parse.test.ts test/mihomo-edits.test.ts test/mihomo-groups.test.ts test/mihomo-trace.test.ts test/mihomo-validate.test.ts && npm run typecheck`
Expected: PASS. Если `merge: true` сломал что-то в `mihomo-trace`/`validate` (например, обход `<<` через `items`), это дефект теста-соседа: разобрать причину, а не откатывать `merge`.

- [ ] **Step 6: Мутации**

1. В `applyMihomoOps` убрать проверку `lock` → красным «операция через замок не применяется». Восстановить.
2. В `print` убрать восстановление CRLF → красным «CRLF-документ остаётся CRLF». Восстановить.
3. В `spliceOp` вернуть `null` всегда → «правка существующего скаляра меняет только его байты» красный (число строк совпадёт, но комментарий `# note`… — проверить, что именно первый тест падает: перепечатка `simple` меняет flow-пробелы и хвостовые комментарии). Восстановить.

- [ ] **Step 7: Отчёт**

Коммит: `feat(frontend): mihomo model writer with splice and document modes, locks and materialization`.

### Task 7: Ссылки по имени: `referenceSites`, `referencesTo`, `renameAt`

**Files:**
- Create: `frontend/src/entities/mihomo/refs.ts`
- Test: `frontend/test/mihomo-refs.test.ts`

**Interfaces:**
- Consumes: `parseRule`, `formatRule`, `ruleEntriesOf`, `rulesOf`, `splitTopLevel`; `groupsOf`, `providersOf`, `ruleProvidersOf`, `subRuleEntries`; `BUILTIN_TARGETS`; `applyMihomoOps`, `renameKeyAt`; `scalar` из `edits.ts`; `MihomoDoc`.
- Produces:

```ts
export type NamedKind = 'group' | 'proxy' | 'provider' | 'rule-provider' | 'sub-rule'
/** Пространство имён: группы и статические серверы делят его с встроенными целями */
export function namesOf(md: MihomoDoc, kind: NamedKind): string[]
export interface RefSite {
  kind: NamedKind
  name: string
  path: PathParts
  /** scalar — значение целиком; rule — строка правила; policy-key — ключ `rule-set:a,b`; filter-entry — запись `rule-set:<имя>` */
  form: 'scalar' | 'rule' | 'policy-key' | 'filter-entry'
}
export function referenceSites(md: MihomoDoc): RefSite[]
export function referencesTo(md: MihomoDoc, kind: NamedKind, name: string): RefSite[]
export type RenameRefusal = 'empty' | 'taken' | 'unprintable' | 'not-found'
export function renameAt(md: MihomoDoc, kind: NamedKind, from: string, to: string): { md: MihomoDoc; refusal?: RenameRefusal }
export function renameRefusalText(refusal: RenameRefusal): string
```

- [ ] **Step 1: Тест**

```ts
import { describe, expect, it } from 'vitest'
import { referencesTo, referenceSites, renameAt } from '../src/entities/mihomo/refs'
import { parseMihomo } from '../src/entities/mihomo/parse'

const DOC = [
  'dns:', '  nameserver-policy:', '    "rule-set:ads,ru": 8.8.8.8', '  fake-ip-filter:', '    - rule-set:ads',
  'tun:', '  route-exclude-address-set: [ru]',
  'proxies:', '  - name: s1', '    type: direct', '    dialer-proxy: G',
  'proxy-groups:', '  - name: G', '    type: select', '    proxies: [s1, DIRECT]', '    use: [P]', '    default-selected: s1',
  'proxy-providers:', '  P: {type: http, url: u, proxy: G, override: {dialer-proxy: s1}}',
  'rule-providers:', '  ads: {type: http, behavior: domain, url: u, proxy: G}', '  ru: {type: http, behavior: domain, url: u}',
  'listeners:', '  - {name: l, type: mixed, port: 1, proxy: G, rule: sub}',
  'ntp: {enable: true, dialer-proxy: s1}',
  'rules:', '  - RULE-SET,ads,REJECT', '  - AND,((RULE-SET,ru),(NETWORK,udp)),G', '  - SUB-RULE,(NETWORK,tcp),sub', '  - MATCH,G',
  'sub-rules:', '  sub:', '    - DOMAIN,a.com,s1', '',
].join('\n')

describe('referencesTo', () => {
  it('группа: proxies, dialer-proxy, proxy провайдеров и наборов, вход, цель правил', () => {
    const paths = referencesTo(parseMihomo(DOC), 'group', 'G').map((s) => s.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['proxies.0.dialer-proxy', 'proxy-providers.P.proxy', 'rule-providers.ads.proxy', 'listeners.0.proxy', 'rules.1', 'rules.3']))
  })
  it('сервер: участник группы, default-selected, override.dialer-proxy, ntp, правило подсписка', () => {
    const paths = referencesTo(parseMihomo(DOC), 'proxy', 's1').map((s) => s.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['proxy-groups.0.proxies.0', 'proxy-groups.0.default-selected', 'proxy-providers.P.override.dialer-proxy', 'ntp.dialer-proxy', 'sub-rules.sub.0']))
  })
  it('набор правил: RULE-SET в правиле и внутри AND, ключ nameserver-policy, fake-ip-filter, route-*-set', () => {
    const md = parseMihomo(DOC)
    expect(referencesTo(md, 'rule-provider', 'ads').map((s) => [s.path.join('.'), s.form])).toEqual(expect.arrayContaining([
      ['rules.0', 'rule'], ['dns.nameserver-policy.rule-set:ads,ru', 'policy-key'], ['dns.fake-ip-filter.0', 'filter-entry'],
    ]))
    expect(referencesTo(md, 'rule-provider', 'ru').map((s) => s.path.join('.'))).toEqual(expect.arrayContaining(['rules.1', 'tun.route-exclude-address-set.0']))
  })
  it('провайдер и подсписок', () => {
    const md = parseMihomo(DOC)
    expect(referencesTo(md, 'provider', 'P').map((s) => s.path.join('.'))).toEqual(['proxy-groups.0.use.0'])
    expect(referencesTo(md, 'sub-rule', 'sub').map((s) => s.path.join('.'))).toEqual(expect.arrayContaining(['rules.2', 'listeners.0.rule']))
  })
})

describe('renameAt', () => {
  it('переименовывает запись и все ссылки; ссылок на старое имя не остаётся', () => {
    const md = parseMihomo(DOC)
    const { md: next, refusal } = renameAt(md, 'rule-provider', 'ads', 'reklama')
    expect(refusal).toBeUndefined()
    expect(referencesTo(next, 'rule-provider', 'ads')).toEqual([])
    expect(referencesTo(next, 'rule-provider', 'reklama')).toHaveLength(3)
    expect(next.text).toContain('"rule-set:reklama,ru"')
    expect(next.text).toContain('RULE-SET,reklama,REJECT')
    const g = renameAt(next, 'group', 'G', 'VPN')
    expect(referencesTo(g.md, 'group', 'VPN').map((s) => s.path.join('.'))).toContain('rules.3')
    expect(g.md.text).toContain('AND,((RULE-SET,ru),(NETWORK,udp)),VPN')
  })
  it('отказы: пустое, занятое, непечатаемое, не найдено', () => {
    const md = parseMihomo(DOC)
    expect(renameAt(md, 'group', 'G', '').refusal).toBe('empty')
    expect(renameAt(md, 'group', 'G', 's1').refusal).toBe('taken')
    expect(renameAt(md, 'group', 'G', 'DIRECT').refusal).toBe('taken')
    expect(renameAt(md, 'group', 'G', 'a\nb').refusal).toBe('unprintable')
    expect(renameAt(md, 'group', 'X', 'Y').refusal).toBe('not-found')
  })
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-refs.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: `refs.ts`**

```ts
// Ссылки по имени: где в документе упомянуто имя группы, сервера, провайдера,
// набора правил или подсписка. ОДИН перечень мест на два потребителя:
// переименование ведёт ссылки за собой, валидация ищет ссылки в пустоту.
// Второй список разошёлся бы с первым на первом же новом месте ссылки.

import type { DocOp, SchemaPath } from '../../shared/schema'
import type { PathParts } from '../xray/config'
import { scalar } from './edits'
import { groupsOf, providersOf, proxiesOf, ruleProvidersOf, subRuleEntries } from './groups'
import type { MihomoDoc } from './parse'
import { BUILTIN_TARGETS } from './resolve'
import { formatRule, parseRule, ruleEntriesOf, rulesOf } from './rules'
import { applyMihomoOps, renameKeyAt } from './write'

export type NamedKind = 'group' | 'proxy' | 'provider' | 'rule-provider' | 'sub-rule'

export interface RefSite {
  kind: NamedKind
  name: string
  path: PathParts
  form: 'scalar' | 'rule' | 'policy-key' | 'filter-entry'
}

export function namesOf(md: MihomoDoc, kind: NamedKind): string[] {
  switch (kind) {
    case 'group': return groupsOf(md).map((g) => g.name)
    case 'proxy': return proxiesOf(md).map((p) => p.name)
    case 'provider': return providersOf(md).map((p) => p.name)
    case 'rule-provider': return ruleProvidersOf(md).map((r) => r.name)
    case 'sub-rule': return subRuleEntries(md).map((s) => s.name)
  }
}

/** Пространство, в котором имя обязано быть уникальным: цели маршрута делят одно */
function namespace(md: MihomoDoc, kind: NamedKind): string[] {
  if (kind === 'group' || kind === 'proxy') return [...namesOf(md, 'group'), ...namesOf(md, 'proxy'), ...BUILTIN_TARGETS]
  return namesOf(md, kind)
}

const j = (md: MihomoDoc): Record<string, unknown> => (typeof md.json === 'object' && md.json !== null ? (md.json as Record<string, unknown>) : {})
const rec = (v: unknown): Record<string, unknown> | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Вид цели маршрута по имени: группа перед сервером, как у resolveTarget */
function targetKind(md: MihomoDoc, name: string): NamedKind | null {
  if (namesOf(md, 'group').includes(name)) return 'group'
  if (namesOf(md, 'proxy').includes(name)) return 'proxy'
  return null
}

/** Имена наборов внутри условия правила: `(RULE-SET,x)` на любой глубине */
function ruleSetsInPayload(payload: string): string[] {
  const out: string[] = []
  for (const m of payload.matchAll(/\(RULE-SET,([^()]*)\)/g)) out.push(m[1]!.trim())
  return out
}

export function referenceSites(md: MihomoDoc): RefSite[] {
  const sites: RefSite[] = []
  const root = j(md)
  const target = (path: PathParts, value: unknown) => {
    if (typeof value !== 'string' || value === '') return
    const kind = targetKind(md, value)
    // Имя, которого нет ни среди групп, ни среди серверов, — тоже ссылка (на
    // хост панели или опечатку): валидации нужно знать о ней, kind — лучший из
    // возможных; переименование по такому имени никогда не спросят
    sites.push({ kind: kind ?? 'proxy', name: value, path, form: 'scalar' })
  }

  list(root.proxies).forEach((p, i) => target(['proxies', i, 'dialer-proxy'], rec(p)?.['dialer-proxy']))
  list(root['proxy-groups']).forEach((g, i) => {
    const group = rec(g) ?? {}
    list(group.proxies).forEach((name, k) => target(['proxy-groups', i, 'proxies', k], name))
    target(['proxy-groups', i, 'default-selected'], group['default-selected'])
    target(['proxy-groups', i, 'empty-fallback'], group['empty-fallback'])
    list(group.use).forEach((name, k) => {
      if (typeof name === 'string') sites.push({ kind: 'provider', name, path: ['proxy-groups', i, 'use', k], form: 'scalar' })
    })
  })
  for (const [name, p] of Object.entries(rec(root['proxy-providers']) ?? {})) {
    const provider = rec(p) ?? {}
    target(['proxy-providers', name, 'proxy'], provider.proxy)
    target(['proxy-providers', name, 'dialer-proxy'], provider['dialer-proxy'])
    target(['proxy-providers', name, 'override', 'dialer-proxy'], rec(provider.override)?.['dialer-proxy'])
  }
  for (const [name, r] of Object.entries(rec(root['rule-providers']) ?? {})) target(['rule-providers', name, 'proxy'], rec(r)?.proxy)
  list(root.listeners).forEach((l, i) => {
    const listener = rec(l) ?? {}
    target(['listeners', i, 'proxy'], listener.proxy)
    if (typeof listener.rule === 'string') sites.push({ kind: 'sub-rule', name: listener.rule, path: ['listeners', i, 'rule'], form: 'scalar' })
  })
  list(root.tunnels).forEach((t, i) => target(['tunnels', i, 'proxy'], rec(t)?.proxy))
  target(['ntp', 'dialer-proxy'], rec(root.ntp)?.['dialer-proxy'])

  const dns = rec(root.dns) ?? {}
  for (const policyKey of ['nameserver-policy', 'proxy-server-nameserver-policy']) {
    for (const key of Object.keys(rec(dns[policyKey]) ?? {})) {
      if (!key.startsWith('rule-set:')) continue
      for (const name of key.slice('rule-set:'.length).split(',')) {
        sites.push({ kind: 'rule-provider', name: name.trim(), path: ['dns', policyKey, key], form: 'policy-key' })
      }
    }
  }
  list(dns['fake-ip-filter']).forEach((entry, i) => {
    if (typeof entry !== 'string') return
    if (entry.startsWith('rule-set:')) {
      sites.push({ kind: 'rule-provider', name: entry.slice('rule-set:'.length).trim(), path: ['dns', 'fake-ip-filter', i], form: 'filter-entry' })
      return
    }
    const rule = parseRule(entry)
    if (rule?.type === 'RULE-SET' && rule.payload) sites.push({ kind: 'rule-provider', name: rule.payload, path: ['dns', 'fake-ip-filter', i], form: 'rule' })
  })
  const tun = rec(root.tun) ?? {}
  for (const key of ['route-address-set', 'route-exclude-address-set']) {
    list(tun[key]).forEach((name, i) => {
      if (typeof name === 'string') sites.push({ kind: 'rule-provider', name, path: ['tun', key, i], form: 'scalar' })
    })
  }

  const ruleList = (entries: ReturnType<typeof rulesOf>, base: PathParts) => {
    for (const entry of entries) {
      const rule = entry.rule
      if (rule === null) continue
      const at: PathParts = [...base, entry.index]
      if (rule.type === 'RULE-SET' && rule.payload) sites.push({ kind: 'rule-provider', name: rule.payload, path: at, form: 'rule' })
      for (const name of ruleSetsInPayload(rule.payload ?? '')) sites.push({ kind: 'rule-provider', name, path: at, form: 'rule' })
      if (rule.type === 'SUB-RULE') {
        sites.push({ kind: 'sub-rule', name: rule.target, path: at, form: 'rule' })
        continue
      }
      const kind = targetKind(md, rule.target)
      sites.push({ kind: kind ?? 'proxy', name: rule.target, path: at, form: 'rule' })
    }
  }
  ruleList(rulesOf(md), ['rules'])
  for (const { name, node } of subRuleEntries(md)) ruleList(ruleEntriesOf(md, node), ['sub-rules', name])
  return sites
}

export function referencesTo(md: MihomoDoc, kind: NamedKind, name: string): RefSite[] {
  const sameSpace = kind === 'group' || kind === 'proxy' ? ['group', 'proxy'] : [kind]
  return referenceSites(md).filter((s) => sameSpace.includes(s.kind) && s.name === name)
}

export type RenameRefusal = 'empty' | 'taken' | 'unprintable' | 'not-found'

const RENAME_TEXT: Record<RenameRefusal, string> = {
  empty: 'Имя не может быть пустым: по нему на запись ссылаются правила и группы.',
  taken: 'Такое имя уже занято в этом пространстве имён — группы, серверы и встроенные цели адресуются одним полем.',
  unprintable: 'В имени есть перевод строки — одной строкой YAML его не записать.',
  'not-found': 'Записи с таким именем в документе больше нет — она изменилась после отрисовки.',
}

export function renameRefusalText(refusal: RenameRefusal): string {
  return RENAME_TEXT[refusal]
}

/** Строка правила с заменённым именем: цель, RULE-SET снаружи и внутри условий, SUB-RULE */
function renameInRule(raw: string, kind: NamedKind, from: string, to: string): string {
  const rule = parseRule(raw)
  if (rule === null) return raw
  let payload = rule.payload
  if (kind === 'rule-provider' && payload !== undefined) {
    if (rule.type === 'RULE-SET' && payload === from) payload = to
    payload = payload.replace(/\(RULE-SET,([^()]*)\)/g, (m, inner: string) => (inner.trim() === from ? `(RULE-SET,${to})` : m))
  }
  let target = rule.target
  if (kind === 'sub-rule' && rule.type === 'SUB-RULE' && target === from) target = to
  if ((kind === 'group' || kind === 'proxy') && rule.type !== 'SUB-RULE' && target === from) target = to
  return formatRule({ ...rule, payload, target })
}

export function renameAt(md: MihomoDoc, kind: NamedKind, from: string, to: string): { md: MihomoDoc; refusal?: RenameRefusal } {
  if (to.trim() === '') return { md, refusal: 'empty' }
  if (scalar(to) === null) return { md, refusal: 'unprintable' }
  if (!namesOf(md, kind).includes(from)) return { md, refusal: 'not-found' }
  if (to !== from && namespace(md, kind).includes(to)) return { md, refusal: 'taken' }
  if (to === from) return { md }

  const ops: DocOp[] = []
  for (const site of referencesTo(md, kind, from)) {
    const path = site.path as SchemaPath
    switch (site.form) {
      case 'scalar':
        ops.push({ op: 'set', path, value: to })
        break
      case 'filter-entry':
        ops.push({ op: 'set', path, value: `rule-set:${to}` })
        break
      case 'rule': {
        const raw = (valueAtJson(md, path) as string | undefined) ?? ''
        ops.push({ op: 'set', path, value: renameInRule(raw, kind, from, to) })
        break
      }
      case 'policy-key': {
        // Ключ отображения: переименовать сам ключ, значение оставить
        const key = String(path[path.length - 1])
        const nextKey = key.split(',').map((n) => (n.trim() === from || n.trim() === `rule-set:${from}` ? n.replace(from, to) : n)).join(',')
        ops.push({ op: 'set', path: [...path.slice(0, -1), nextKey], value: valueAtJson(md, path) })
        ops.push({ op: 'remove', path })
        break
      }
    }
  }
  // Сама запись: поле name у списка, ключ у отображения
  let next = applyMihomoOps(md, ops).md
  if (kind === 'group') {
    const index = groupsOf(next).find((g) => g.name === from)?.index
    if (index !== undefined) next = applyMihomoOps(next, [{ op: 'set', path: ['proxy-groups', index, 'name'], value: to }]).md
  } else if (kind === 'proxy') {
    const index = proxiesOf(next).find((p) => p.name === from)?.index
    if (index !== undefined) next = applyMihomoOps(next, [{ op: 'set', path: ['proxies', index, 'name'], value: to }]).md
  } else {
    const section = kind === 'provider' ? 'proxy-providers' : kind === 'rule-provider' ? 'rule-providers' : 'sub-rules'
    next = renameKeyAt(next, [section], from, to)
  }
  return { md: next }
}

function valueAtJson(md: MihomoDoc, path: SchemaPath): unknown {
  let cur: unknown = md.json
  for (const step of path) {
    if (typeof step === 'number') { if (!Array.isArray(cur)) return undefined; cur = cur[step] }
    else { const r = rec(cur); if (r === undefined) return undefined; cur = r[step] }
  }
  return cur
}
```

Ключ `policy-key` переименовывается парой операций `set` нового ключа и `remove` старого — порядок записи в отображении меняется, и это принято: `renameKeyAt` тут не годится, потому что новый ключ строится из старого с заменой части.

- [ ] **Step 4: Прогнать тест и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-refs.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Мутация**

В `renameInRule` убрать замену внутри условий (`payload.replace(...)`) → красным «переименовывает запись и все ссылки» на `AND,((RULE-SET,ru)…)` после переименования `ru`? В тесте переименовывается `ads` и группа `G`; добавить в тест переименование `ru` → `russia` с проверкой `AND,((RULE-SET,russia),(NETWORK,udp)),G` ДО мутации, затем мутировать. Восстановить.

- [ ] **Step 6: Отчёт**

Коммит: `feat(frontend): one reference registry for mihomo names with rename that follows every site`.

### Task 8: Маркер декоративен: подстановка по правилу панели, бэкенд

**Files:**
- Modify: `frontend/src/entities/mihomo/inject.ts`, `groups.ts` (убрать `hasMarker`, добавить `proxiesOf`), `index.ts` (экспорты), `validate.ts` (только строки с `hasMarker`), `entities/graph/mihomo/buildGraph.ts` (только `hasRootMarker` → всегда), `features/topology/MihomoInspector.tsx` (только `hostsBasis`/`HostsCard` и импорт `hasRootMarker`), `features/editor/mihomoIntellisense/context.ts` (текст описания `proxies` без маркера)
- Delete: `frontend/src/entities/mihomo/marker.ts`
- Modify: `backend/src/mihomo/dummyProxies.ts`, `backend/test/mihomo-test.test.ts`
- Test: `frontend/test/mihomo-groups.test.ts`, `mihomo-graph.test.ts`, `mihomo-validate.test.ts`, `mihomo-inspector.test.tsx`, `mihomo-mutations.test.ts` (переписать утверждения про маркер)

**Interfaces:**
- Produces: `groups.ts`: `export interface MihomoProxy { index: number; name: string; type?: string; server?: string; range: Range }`, `export function proxiesOf(md): MihomoProxy[]`; `inject.ts`: `panelInjectsHosts(group)`, `groupTakesHosts(group)`, `groupGetsHosts(group)`, `conflictingKeys(group)`; `MihomoGroup` без `hasMarker`, с `includeAllProviders: boolean`.

- [ ] **Step 1: Тесты**

В `frontend/test/mihomo-groups.test.ts` заменить проверки `hasMarker` на:

```ts
it('proxiesOf: статические серверы с именем; запись без имени пропускается', () => {
  const md = parseMihomo('proxies:\n  - name: s1\n    type: direct\n  - type: ss\n  - {name: s2, type: socks5, server: h}\n')
  expect(proxiesOf(md).map((p) => [p.index, p.name, p.type, p.server])).toEqual([[0, 's1', 'direct', undefined], [2, 's2', 'socks5', 'h']])
})
```

Новый файл `frontend/test/mihomo-inject.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupGetsHosts, groupTakesHosts, panelInjectsHosts } from '../src/entities/mihomo/inject'
import { groupsOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'

const group = (yaml: string) => groupsOf(parseMihomo(`proxy-groups:\n  - name: G\n    type: select\n${yaml}`))[0]!

describe('подстановка по правилу панели', () => {
  it('без ключей панель дописывает хосты — маркер не нужен', () => {
    const g = group('')
    expect(panelInjectsHosts(g)).toBe(true)
    expect(groupTakesHosts(g)).toBe(true)
    expect(groupGetsHosts(g)).toBe(true)
  })
  it('include-proxies: false отменяет подстановку; include-all собирает хосты ядром', () => {
    const off = group('    remnawave:\n      include-proxies: false\n')
    expect(panelInjectsHosts(off)).toBe(false)
    expect(groupTakesHosts(off)).toBe(false)
    expect(groupGetsHosts(off)).toBe(false)
    const all = group('    remnawave:\n      include-proxies: false\n    include-all: true\n')
    expect(panelInjectsHosts(all)).toBe(false)
    expect(groupTakesHosts(all)).toBe(true)
    const providers = group('    remnawave:\n      include-proxies: false\n    include-all-providers: true\n')
    expect(groupTakesHosts(providers)).toBe(false)
    expect(groupGetsHosts(providers)).toBe(true)
    const use = group('    remnawave:\n      include-proxies: false\n    use: [p]\n')
    expect(groupGetsHosts(use)).toBe(true)
  })
})
```

В `frontend/test/mihomo-graph.test.ts`: тесты «узел подстановки только при маркере» переписать: `hosts:root` есть всегда у документа-отображения; `hosts:<группа>` у группы без ключей есть, у группы с `include-proxies: false` нет, у неё же с `include-all: true` есть. В `mihomo-validate.test.ts` удалить проверку предупреждения «маркер стоит, но include-proxies: false»; в `mihomo-inspector.test.tsx` — тексты `HostsCard` (см. шаг 4). В `mihomo-mutations.test.ts` — утверждения о `hasMarker` (если есть) снять.

Бэкенд, `backend/test/mihomo-test.test.ts`: тест «заполняет корневой список и группы с маркером» переименовать в «заполняет корневой список и каждую группу без include-proxies: false» и добавить документ без маркера:

```ts
it('группа без маркера тоже получает фиктивные имена — панель дописывает по ключам, а не по комментарию', () => {
  const text = 'proxy-groups:\n  - name: a\n    type: select\n    proxies:\n      - DIRECT\nrules:\n  - MATCH,a\n'
  const config = parse(withDummyProxies(text)) as { proxies: { name: string }[]; 'proxy-groups': { proxies: string[] }[] }
  expect(config['proxy-groups'][0]!.proxies).toEqual(['DIRECT', ...config.proxies.map((p) => p.name)])
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-inject.test.ts test/mihomo-groups.test.ts && cd ../backend && npx vitest run test/mihomo-test.test.ts`
Expected: FAIL.

- [ ] **Step 3: `groups.ts`, `inject.ts`, удаление `marker.ts`**

`groups.ts`: убрать импорт `markerAfterKey` и поле `hasMarker`; в `MihomoGroup` добавить `includeAllProviders: boolean` (`bool(md, item, 'include-all-providers') === true`); добавить:

```ts
export interface MihomoProxy {
  index: number
  name: string
  type?: string
  server?: string
  range: Range
}

/** Статические серверы корневого `proxies`. Запись без имени узлом не становится: адресовать её нечем */
export function proxiesOf(md: MihomoDoc): MihomoProxy[] {
  const node = sectionNode(md, 'proxies')
  if (!isSeq(node)) return []
  const out: MihomoProxy[] = []
  node.items.forEach((item, index) => {
    const range = rangeOf(item)
    const name = str(md, item, 'name')
    if (range === null || name === undefined) return
    out.push({ index, name, type: str(md, item, 'type'), server: str(md, item, 'server'), range })
  })
  return out
}
```

`inject.ts` целиком:

```ts
// Куда панель кладёт хосты — по КЛЮЧАМ документа, а не по комментарию:
// генератор панели (mihomo.generator.service.ts) разбирает YAML в объект,
// комментарии при этом теряются, и `# LEAVE THIS LINE!` — подсказка человеку,
// не адрес. Серверы дописываются В КОНЕЦ корневого proxies всегда, их имена —
// В КОНЕЦ proxies каждой группы без include-proxies: false. Имена хостов при
// этом непредсказуемы: их даёт панель из примечаний хоста.

import type { MihomoGroup } from './groups'

/** Допишет ли панель имена хостов в список этой группы */
export function panelInjectsHosts(group: MihomoGroup): boolean {
  return group.remnawave.includeProxies !== false
}

/**
 * Попадут ли хосты в группу вообще — узел подстановки на холсте. Второе
 * основание — include-all/include-all-proxies: панель ничего не дописывает,
 * но ядро на клиенте соберёт группу из корневого proxies, куда панель хосты
 * уже положила (так устроены группы roscomvpn с include-proxies: false).
 */
export function groupTakesHosts(group: MihomoGroup): boolean {
  return panelInjectsHosts(group) || group.includeAll
}

/** Не останется ли группа пустой — предупреждение валидации; провайдеры сюда входят */
export function groupGetsHosts(group: MihomoGroup): boolean {
  return groupTakesHosts(group) || group.includeAllProviders || group.use.length > 0
}

/** Ключи, взаимно исключающие друг друга: обе выборки сразу невыразимы */
export function conflictingKeys(group: MihomoGroup): boolean {
  return group.remnawave.selectRandomProxy === true && group.remnawave.shuffleProxiesOrder === true
}
```

Удалить `marker.ts`; в `index.ts` убрать `export * from './marker'` и `hasRootMarker` из именованного экспорта, добавить `groupTakesHosts`. Все `import … from './marker'`/`INJECT_MARKER` в `src` должны исчезнуть: `grep -rn "marker\|hasMarker\|hasRootMarker\|INJECT_MARKER" frontend/src` → пусто.

`validate.ts`: ветку `if (group.hasMarker && …)` удалить, оставить `else`-ветку как самостоятельный `if (!groupGetsHosts(group) && group.proxies.length === 0)`.

`buildGraph.ts`: узел подстановки группы — `if (groupTakesHosts(group))`; `getsHosts: groupTakesHosts(group)`; блок `if (hasRootMarker(md))` заменить на `if (isMap(md.doc.contents))` (импорт `isMap` из `yaml`). Комментарий над узлом переписать: панель дописывает серверы в корневой список всегда.

`MihomoInspector.tsx`: `hostsBasis(group)`:

```ts
function hostsBasis(group: MihomoGroup): string {
  if (panelInjectsHosts(group)) return `Панель допишет имена подставленных хостов в конец списка proxies группы «${group.name}».`
  return `У группы «${group.name}» стоит include-all: панель ничего не дописывает, но ядро соберёт хосты из корневого списка proxies, куда панель их положила.`
}
```

`HostsCard` для `owner === 'root'`: условие `hasRootMarker` убрать — корневая карточка показывается всегда, текст: «Серверы подписки панель допишет в конец корневого списка proxies. Если панель подставит хосты, они окажутся здесь, и на них смогут ссылаться группы.» Ветка «Подстановки … больше нет» остаётся для группы, которой не стало.

`mihomoIntellisense/context.ts`: описание `proxies` в `CONTAINER_KEYS` — «Список серверов. Панель дописывает подставленные хосты в конец этого списка; статические записи ставятся впереди.» (сам файл переписывается в задаче 15; здесь — только строка).

- [ ] **Step 4: Бэкенд**

`backend/src/mihomo/dummyProxies.ts`: удалить константу `MARKER`, переменную `marked` и комментарий про вторую копию; условие в цикле групп — `group.proxies = [...proxies, ...names]` без проверки `marked || proxies.length === 0`. Заголовочный комментарий: «Фиктивные имена дописываются в каждую группу без include-proxies: false — так делает генератор панели; маркер-комментарий он не читает».

- [ ] **Step 5: Прогнать тесты и typecheck обоих workspace**

Run: `cd frontend && npx vitest run test/mihomo-inject.test.ts test/mihomo-groups.test.ts test/mihomo-graph.test.ts test/mihomo-validate.test.ts test/mihomo-inspector.test.tsx test/mihomo-mutations.test.ts test/mihomo-topology.test.tsx && npm run typecheck && cd ../backend && npx vitest run test/mihomo-test.test.ts && npm run typecheck`
Expected: PASS; `grep -rn "LEAVE THIS LINE" frontend/src backend/src` находит только `backend/src/templates/starterMihomo.ts`.

- [ ] **Step 6: Мутация**

В `panelInjectsHosts` вернуть `true` всегда → красным тест «include-proxies: false отменяет подстановку». Восстановить. В бэкенде вернуть условие `proxies.length === 0` → красным новый тест. Восстановить.

- [ ] **Step 7: Отчёт**

Коммит: `fix(frontend,backend): mihomo host injection follows panel keys, the marker comment is decorative`.

### Task 9: Граф: узел сервера, подстановка по правилу панели, мутации операциями

**Files:**
- Modify: `frontend/src/entities/mihomo/resolve.ts`, `search.ts`, `trace.ts` (только чтение `resolveTarget` — вид `proxy` считается разрешимой целью)
- Modify: `frontend/src/entities/graph/mihomo/types.ts`, `buildGraph.ts`, `mutations.ts`, `locate.ts`; `frontend/src/entities/graph/search.ts` (только `SearchHit['kind']`); `frontend/src/features/editor/useMihomoDraft.ts` (только `connect`/`disconnect` — см. шаг 5)
- Test: `frontend/test/mihomo-graph.test.ts`, `mihomo-mutations.test.ts` (переписать под операции), `mihomo-locate.test.ts`, `mihomo-resolve.test.ts` (новый, короткий), `mihomo-draft.test.tsx` (только проверка кабеля)

**Interfaces:**
- Consumes: `proxiesOf`, `groupTakesHosts`; `DocOp`; `mihomoLockAt`.
- Produces:
  - `resolve.ts`: `TargetKind = 'group' | 'proxy' | 'provider' | 'builtin' | 'unknown'`; порядок: builtin → group → proxy → provider.
  - `types.ts`: `MihomoProxyNodeData { kind: 'mihomo-proxy'; index: number; name: string; type?: string; server?: string; issueCount?: IssueCount }`.
  - `buildGraph.ts`: узел `proxy:<имя>` (`type: 'mihomoProxy'`) в колонке выходов; рёбра `group:→proxy:`, `rule:→proxy:`, `subrule:→proxy:`; `hosts:root` всегда.
  - `mutations.ts`: `MihomoEditResult { ops: DocOp[]; refusal?: MihomoRefusal }`; `MihomoRefusal = 'invalid-pair' | 'already-connected' | 'rule-target-required' | 'panel-hosts-edge' | 'sub-rule-source' | 'merged-list' | 'alias-list' | 'proxies-not-a-list' | 'not-found'`; `isValidMihomoConnection` принимает цель `proxy`.
  - `locate.ts`: `mihomoNodeIdForPath`: `proxies.<i>` → `proxy:<имя>`; пути `rule-providers`, `dns`, `tun`, `sniffer`, `profile`, `ntp`, `experimental`, `hosts`, `listeners`, `tunnels`, `tls`, `remnawave` и корневые скаляры → `'doc:settings'`.

- [ ] **Step 1: Тесты**

`frontend/test/mihomo-resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { resolveTarget } from '../src/entities/mihomo/resolve'

describe('resolveTarget', () => {
  it('статический сервер — вид proxy; группа с тем же именем побеждает', () => {
    const md = parseMihomo('proxies:\n  - name: s\n    type: direct\n  - name: G\n    type: direct\nproxy-groups:\n  - name: G\n    type: select\n')
    expect(resolveTarget(md, 's')).toBe('proxy')
    expect(resolveTarget(md, 'G')).toBe('group')
    expect(resolveTarget(md, 'DIRECT')).toBe('builtin')
    expect(resolveTarget(md, 'x')).toBe('unknown')
  })
})
```

В `frontend/test/mihomo-graph.test.ts` добавить:

```ts
it('статический сервер — узел proxy:<имя> в колонке выходов; рёбра от группы и правила', () => {
  const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nproxy-groups:\n  - name: G\n    type: select\n    proxies: [s]\nrules:\n  - MATCH,s\n')
  const { nodes, edges } = buildMihomoGraph(md)
  const proxy = nodes.find((n) => n.id === 'proxy:s')!
  expect(proxy.type).toBe('mihomoProxy')
  expect(proxy.data).toMatchObject({ kind: 'mihomo-proxy', name: 's', type: 'direct' })
  expect(proxy.position.x).toBe(nodes.find((n) => n.id === 'hosts:root')!.position.x)
  expect(edges.map((e) => e.id)).toEqual(expect.arrayContaining(['e:group:G->proxy:s', 'e:rule:0->proxy:s']))
})
it('hosts:root есть у любого документа-отображения, даже без ключа proxies', () => {
  expect(buildMihomoGraph(parseMihomo('mode: rule\n')).nodes.some((n) => n.id === 'hosts:root')).toBe(true)
  expect(buildMihomoGraph(parseMihomo('')).nodes).toEqual([])
})
```

`frontend/test/mihomo-mutations.test.ts` переписать под операции. Обязательные проверки:

```ts
it('кабель правило → сервер меняет цель правила одной операцией set', () => {
  const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nrules:\n  - DOMAIN,a.com,DIRECT\n')
  expect(connectMihomo(md, 'rule:0', 'proxy:s')).toEqual({ ops: [{ op: 'set', path: ['rules', 0], value: 'DOMAIN,a.com,s' }] })
})
it('кабель группа → группа дописывает участника; flow-список больше не отказ', () => {
  const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\n    proxies: []\n  - name: B\n    type: select\n')
  expect(connectMihomo(md, 'group:A', 'group:B')).toEqual({ ops: [{ op: 'insert', path: ['proxy-groups', 0, 'proxies'], index: 0, value: 'B' }] })
  expect(connectMihomo(md, 'group:B', 'group:A')).toEqual({ ops: [{ op: 'insert', path: ['proxy-groups', 1, 'proxies'], index: 0, value: 'A' }] })
})
it('отказы: алиас, слияние, не список, подстановка, SUB-RULE, уже соединены', () => {
  const md = parseMihomo(['x:', '  l: &l', '    - DIRECT', '  m: &m', '    proxies: [DIRECT]',
    'proxy-groups:', '  - name: A', '    type: select', '    proxies: *l', '  - name: B', '    type: select', '    <<: *m',
    '  - name: C', '    type: select', '    proxies: oops', '  - name: D', '    type: select', '    proxies: [DIRECT]',
    'rules:', '  - SUB-RULE,(NETWORK,tcp),sub', ''].join('\n'))
  expect(connectMihomo(md, 'group:A', 'builtin:REJECT').refusal).toBe('alias-list')
  expect(connectMihomo(md, 'group:B', 'builtin:REJECT').refusal).toBe('merged-list')
  expect(connectMihomo(md, 'group:C', 'builtin:REJECT').refusal).toBe('proxies-not-a-list')
  expect(connectMihomo(md, 'group:D', 'builtin:DIRECT').refusal).toBe('already-connected')
  expect(connectMihomo(md, 'rule:0', 'group:A').refusal).toBe('sub-rule-source')
  expect(disconnectMihomo(md, 'e:group:D->hosts:D').refusal).toBe('panel-hosts-edge')
  expect(disconnectMihomo(md, 'e:rule:0->subrule:sub').refusal).toBe('rule-target-required')
  expect(disconnectMihomo(md, 'e:group:D->builtin:DIRECT')).toEqual({ ops: [{ op: 'remove', path: ['proxy-groups', 3, 'proxies', 0] }] })
})
```

`frontend/test/mihomo-locate.test.ts`: `mihomoNodeIdForPath(['proxies', 0], md)` → `proxy:s`; `['rule-providers', 'x']`, `['dns', 'enable']`, `['mode']`, `['listeners', 0, 'port']` → `'doc:settings'`; `['proxy-providers', 'p']` → `provider:p`; `['sub-rules', 'x', 0]` → `subrule:x`.

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-resolve.test.ts test/mihomo-graph.test.ts test/mihomo-mutations.test.ts test/mihomo-locate.test.ts`
Expected: FAIL.

- [ ] **Step 3: `resolve.ts`, `types.ts`, `buildGraph.ts`, `locate.ts`, `search.ts`**

`resolve.ts`:

```ts
import { groupsOf, providersOf, proxiesOf } from './groups'
export type TargetKind = 'group' | 'proxy' | 'provider' | 'builtin' | 'unknown'
export function resolveTarget(md: MihomoDoc, name: string): TargetKind {
  if ((BUILTIN_TARGETS as readonly string[]).includes(name)) return 'builtin'
  if (groupsOf(md).some((g) => g.name === name)) return 'group'
  if (proxiesOf(md).some((p) => p.name === name)) return 'proxy'
  if (providersOf(md).some((p) => p.name === name)) return 'provider'
  return 'unknown'
}
```

`buildGraph.ts`: после провайдеров — узлы серверов:

```ts
proxiesOf(md).forEach((proxy) => {
  pushNode({
    id: `proxy:${proxy.name}`,
    type: 'mihomoProxy',
    position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
    data: { kind: 'mihomo-proxy', index: proxy.index, name: proxy.name, type: proxy.type, server: proxy.server },
  })
})
```

и во всех трёх местах разбора целей (`group.proxies`, правила, подсписки) добавить `if (kind === 'proxy') pushEdge(id, \`proxy:${target}\`)`. Порядок обхода в комментарии дополнить: провайдеры → серверы. `hosts:root`: `if (isMap(md.doc.contents))`.

`locate.ts`:

```ts
const SETTINGS_KEYS = new Set(['rule-providers', 'dns', 'tun', 'sniffer', 'profile', 'ntp', 'experimental', 'hosts', 'listeners', 'tunnels', 'tls', 'remnawave'])
// …
if (head === 'proxies' && typeof second === 'number') {
  const name = proxiesOf(md).find((p) => p.index === second)?.name
  return name === undefined ? null : `proxy:${name}`
}
if (typeof head === 'string' && (SETTINGS_KEYS.has(head) || !CANVAS_KEYS.has(head))) return 'doc:settings'
```

где `CANVAS_KEYS = new Set(['rules', 'proxy-groups', 'sub-rules', 'proxy-providers', 'proxies'])`; диагностика уровня всей секции холста (`['proxy-groups']`) по-прежнему `null`. Диагностика с пустым путём — `null`.

`search.ts`: серверы — `nodeId: proxy:<имя>`, `kind: 'mihomo-proxy'`, поля «имя», «тип», «сервер». Тип `SearchHit['kind']` расширить `'mihomo-proxy'` в `entities/graph/search.ts` (аддитивно).

`trace.ts`: там, где вид цели `'unknown'` даёт остановку/примечание, `'proxy'` считать разрешённой конечной целью наравне с `'provider'` (прочитать все `resolveTarget` в файле; правка — добавление `'proxy'` в те же условия, что `'provider'`).

- [ ] **Step 4: `mutations.ts` — операции**

Заменить импорты сплайс-примитивов на `mihomoLockAt` и `proxiesOf`; тип результата:

```ts
export interface MihomoEditResult { ops: DocOp[]; refusal?: MihomoRefusal }
```

`split`/`isValidMihomoConnection`: вид `proxy` добавить в `NodeKind` и в допустимые цели: `to.kind === 'group' || to.kind === 'provider' || to.kind === 'proxy' || to.kind === 'builtin'`.

`connectMihomo`:

```ts
if (from.kind === 'rule') {
  const index = Number(from.rest)
  const entry = rulesOf(md).find((r) => r.index === index)
  if (entry?.rule == null) return { ops: [], refusal: 'not-found' }
  if (entry.rule.type === 'SUB-RULE') return { ops: [], refusal: 'sub-rule-source' }
  if (entry.rule.target === name) return { ops: [], refusal: 'already-connected' }
  return { ops: [{ op: 'set', path: ['rules', index], value: formatRule({ ...entry.rule, target: name }) }] }
}
const group = groupsOf(md).find((g) => g.name === from.rest)
if (group === undefined) return { ops: [], refusal: 'not-found' }
if (group.proxies.includes(name)) return { ops: [], refusal: 'already-connected' }
const lock = mihomoLockAt(md, ['proxy-groups', group.index, 'proxies'])
if (lock?.kind === 'merged') return { ops: [], refusal: 'merged-list' }
if (lock?.kind === 'alias') return { ops: [], refusal: 'alias-list' }
const pair = proxiesPair(md, group.index)
const value = pair?.value
if (value !== undefined && !isSeq(value) && !(isScalar(value) && value.value === null)) return { ops: [], refusal: 'proxies-not-a-list' }
const length = isSeq(value) ? value.items.length : 0
return { ops: [{ op: 'insert', path: ['proxy-groups', group.index, 'proxies'], index: length, value: name }] }
```

`disconnectMihomo`: те же отказы для `hosts`, `rule`/`subrule`, `merged`/`alias`; затем индекс участника `group.proxies.indexOf(name)` (по значениям `groupsOf`, которые уже развернули алиасы? Нет — у группы с алиасом отказ уже выше) → `{ ops: [{ op: 'remove', path: ['proxy-groups', group.index, 'proxies', k] }] }`; `-1` → `not-found`.

`REFUSAL_TEXT`: удалить `flow-list`, `no-proxies-key`, `unprintable-name`, `unprintable-rule`; текст `panel-hosts-edge` переписать без упоминания маркера: «Эту связь создаёт панель, а не документ: она допишет имена хостов в конец списка proxies группы (или ядро соберёт их через include-all). Записи в proxies под это ребро нет — разрывать нечего. Чтобы панель ничего не дописывала, поставьте в форме группы remnawave.include-proxies = false.»

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-resolve.test.ts test/mihomo-graph.test.ts test/mihomo-mutations.test.ts test/mihomo-locate.test.ts test/mihomo-trace.test.ts test/mihomo-trace-acceptance.test.ts test/mihomo-search.test.ts && npm run typecheck`
Expected: PASS. `useMihomoDraft.ts` зовёт `apply(res.edits)` в `connect`/`disconnect` — чтобы typecheck остался зелёным до задачи 10, в ЭТОЙ задаче сделать в хуке минимальную правку (файл `frontend/src/features/editor/useMihomoDraft.ts` входит в задачу 9; задача 10 перепишет его целиком в следующей волне):

```ts
import { applyMihomoOps } from '../../entities/mihomo/write'
// …
function applyOpsNow(ops: DocOp[], select?: string | null) {
  if (md === undefined || ops.length === 0) return
  const { md: next } = applyMihomoOps(md, ops)
  core.writeDraft(next.text, { history: true })
  if (select !== undefined) core.setSelectedNode(select)
}
// connect: setRefusal(res.refusal ?? null); applyOpsNow(res.ops)
// disconnect: то же
```

Тест `test/mihomo-draft.test.tsx` на соединение кабелем (если утверждает `TextEdit`) переписать на проверку текста документа после `connect`.

- [ ] **Step 6: Мутация**

В `resolveTarget` убрать ветку `proxy` → красным `mihomo-resolve` и «статический сервер — узел…» (ребро от группы пропадёт). Восстановить.

- [ ] **Step 7: Отчёт**

Коммит: `feat(frontend): mihomo graph draws static proxies, host injection by panel rule, cable edits as document ops`.
## Часть C. Интерфейс

### Task 10: Хук `useMihomoDraft` как `DocWriter`, стартеры, адаптер

**Files:**
- Create: `frontend/src/entities/mihomo/starters.ts`
- Modify: `frontend/src/features/editor/useMihomoDraft.ts`, `frontend/src/features/editor/mihomoAdapter.ts`, `frontend/src/entities/mihomo/index.ts` (экспорт `write`, `refs`, `starters`)
- Test: `frontend/test/mihomo-starters.test.ts`, `frontend/test/mihomo-draft.test.tsx` (переписать под писатель)

**Interfaces:**
- Consumes: `applyMihomoOps`, `mihomoLockAt`, `materializeAt`; `renameAt`, `renameRefusalText`, `NamedKind`; `connectMihomo`, `disconnectMihomo`, `refusalText`; `uniqueName`; `DocWriter`, `Lock`, `DocOp`, `SchemaPath`.
- Produces:

```ts
// starters.ts
export function startGroup(md: MihomoDoc): Record<string, unknown>      // { name: uniqueName(цели, 'Группа'), type: 'select' }
export function startProxy(md: MihomoDoc): Record<string, unknown>      // { name: uniqueName(цели, 'Сервер'), type: 'direct', udp: true }
export function startProvider(md: MihomoDoc, name: string): Record<string, unknown>      // { type: 'http', url: '', interval: 86400 }
export function startRuleProvider(md: MihomoDoc, name: string): Record<string, unknown>  // { type: 'http', behavior: 'domain', format: 'mrs', url: '', interval: 86400 }
export function startSubRule(): unknown[]                                                // []
export function startListener(md: MihomoDoc): Record<string, unknown>   // { name: uniqueName(имена входов, 'вход'), type: 'mixed', listen: '127.0.0.1', port: 7890 }
export function startTunnel(): Record<string, unknown>                  // { network: ['tcp', 'udp'], address: '127.0.0.1:0', target: '', proxy: '' }
export function providerName(md: MihomoDoc): string                     // uniqueName(провайдеры, 'provider')
export function ruleProviderName(md: MihomoDoc): string                 // uniqueName(наборы, 'ruleset')
export function subRuleName(md: MihomoDoc): string                      // uniqueName(подсписки, 'sub-rule')
export function nextRulePlacement(md: MihomoDoc, selectedRule: number | null): { raw: string; at: number }
```

`nextRulePlacement`: выбрано правило → `{ raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: selectedRule }`; иначе последнее правило `MATCH` → `at: last.index`, та же заготовка; иначе `{ raw: 'MATCH,DIRECT', at: rules.length }`.

```ts
// useMihomoDraft.ts
export interface MihomoDraft extends DocumentDraft<MihomoDoc> {
  md: MihomoDoc | undefined
  writer: DocWriter
  /** Применить операции; select — перенести выбор (null — снять), undefined — оставить */
  applyOps: (ops: DocOp[], select?: string | null) => void
  lockAt: (path: SchemaPath) => Lock | null
  materialize: (path: SchemaPath) => void
  /** Переименование с переносом ссылок; null — успех, иначе текст отказа */
  rename: (kind: NamedKind, from: string, to: string) => string | null
  connect: (source: string, target: string) => void
  disconnect: (edgeIds: string[]) => void
  trace: MihomoTraceResult | undefined
  /** Текст отказа кабеля или писателя; null — отказа нет */
  refusal: string | null
  dismissRefusal: () => void
  checkOpen: boolean; setCheckOpen: (open: boolean) => void
  importOpen: boolean; setImportOpen: (open: boolean) => void
  ruleSetsOpen: boolean; setRuleSetsOpen: (open: boolean) => void
  recipesOpen: boolean; setRecipesOpen: (open: boolean) => void
  ruleSets: RuleSetDescriptor[]
  askedSets: RuleSetQuery[]
  // ── временные обёртки прежнего API; удаляются в задаче 17 вместе с последними потребителями ──
  setField: (parts: PathParts, key: string, value: string | boolean | number) => void
  removeField: (parts: PathParts, key: string) => void
  originOf: (parts: PathParts, key: string) => FieldOrigin
  setListAt: (parts: PathParts, key: string, values: string[]) => void
  renameGroupTo: (index: number, name: string) => void
  addGroupNamed: (name: string) => void
  addRuleText: (raw: string, at?: number) => void
  replaceRule: (index: number, raw: string) => void
  moveSelected: (dir: -1 | 1) => void
  removeSelected: () => void
  sectionsOpen: boolean; setSectionsOpen: (open: boolean) => void
}
```

- [ ] **Step 1: Тесты стартеров**

`frontend/test/mihomo-starters.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { nextRulePlacement, providerName, startGroup, startListener, startProxy } from '../src/entities/mihomo/starters'

describe('стартеры Mihomo', () => {
  it('имена уникальны в пространстве целей: группы, серверы и встроенные', () => {
    const md = parseMihomo('proxies:\n  - name: Группа\n    type: direct\nproxy-groups:\n  - name: Сервер\n    type: select\n')
    expect(startGroup(md)).toEqual({ name: 'Группа-2', type: 'select' })
    expect(startProxy(md)).toEqual({ name: 'Сервер-2', type: 'direct', udp: true })
    expect(providerName(md)).toBe('provider')
    expect(startListener(md)).toEqual({ name: 'вход', type: 'mixed', listen: '127.0.0.1', port: 7890 })
  })
  it('+ Правило: перед выбранным, иначе перед финальным MATCH, иначе MATCH в конец', () => {
    const md = parseMihomo('rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,DIRECT\n')
    expect(nextRulePlacement(md, 1)).toEqual({ raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: 1 })
    expect(nextRulePlacement(md, null)).toEqual({ raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: 1 })
    expect(nextRulePlacement(parseMihomo('rules:\n  - DOMAIN,a.com,DIRECT\n'), null)).toEqual({ raw: 'MATCH,DIRECT', at: 1 })
    expect(nextRulePlacement(parseMihomo(''), null)).toEqual({ raw: 'MATCH,DIRECT', at: 0 })
  })
})
```

- [ ] **Step 2: Тесты хука**

В `frontend/test/mihomo-draft.test.tsx` заменить проверки старого API на:

```tsx
it('applyOps пишет через писатель одним снимком истории; отказ показывается текстом', async () => {
  const { result } = renderDraft('proxy-groups:\n  - name: A\n    type: select\n    proxies: *l\nx:\n  l: &l [DIRECT]\n')
  act(() => result.current.applyOps([{ op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true }]))
  expect(result.current.text).toContain('hidden: true')
  act(() => result.current.applyOps([{ op: 'insert', path: ['proxy-groups', 0, 'proxies'], index: 0, value: 'REJECT' }]))
  expect(result.current.refusal).toBe(LOCK_ALIAS)
  act(() => result.current.undo())
  expect(result.current.text).not.toContain('hidden: true')
})
it('lockAt отдаёт замок с действием «Развернуть значение здесь», materialize снимает его', () => {
  const { result } = renderDraft('x:\n  l: &l [DIRECT]\nproxy-groups:\n  - name: A\n    type: select\n    proxies: *l\n')
  const lock = result.current.lockAt(['proxy-groups', 0, 'proxies'])
  expect(lock?.action?.label).toBe('Развернуть значение здесь')
  act(() => lock!.action!.run())
  expect(result.current.lockAt(['proxy-groups', 0, 'proxies'])).toBeNull()
  expect(result.current.text).toContain('&l')
})
it('rename ведёт ссылки и переносит выбор за узлом', () => {
  const { result } = renderDraft('proxy-groups:\n  - name: A\n    type: select\nrules:\n  - MATCH,A\n')
  act(() => result.current.setSelectedNode('group:A'))
  let refusal: string | null = null
  act(() => { refusal = result.current.rename('group', 'A', 'B') })
  expect(refusal).toBeNull()
  expect(result.current.text).toContain('MATCH,B')
  expect(result.current.selectedNode).toBe('group:B')
  act(() => { refusal = result.current.rename('group', 'B', 'DIRECT') })
  expect(refusal).toMatch(/занято/)
})
it('disconnect разрывает несколько рёбер одной пачкой', () => {
  const { result } = renderDraft('proxy-groups:\n  - name: A\n    type: select\n    proxies: [DIRECT, REJECT]\n')
  act(() => result.current.disconnect(['e:group:A->builtin:DIRECT', 'e:group:A->builtin:REJECT']))
  expect(groupsOf(result.current.md!)[0]!.proxies).toEqual([])
})
```

`renderDraft` — существующий помощник файла (renderHook над `useMihomoDraft` с `QueryClientProvider`); если его нет, завести по образцу `singbox-draft.test.tsx`.

- [ ] **Step 3: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-starters.test.ts test/mihomo-draft.test.tsx`
Expected: FAIL.

- [ ] **Step 4: `starters.ts`**

```ts
// Заготовки записей для меню «+ Добавить» и панели «Документ»: минимум, который
// ядро примет и который сразу виден на холсте. Имя уникально в пространстве,
// где оно адресует узел: группы, серверы и встроенные цели — одно (правило
// ссылается на них одним полем). У группы нет `proxies`: панель допишет хосты
// и так, а пустой список печатался бы flow-скобками.

import { uniqueName } from '../../shared/schema'
import { groupsOf, providersOf, proxiesOf, ruleProvidersOf, subRuleNames } from './groups'
import type { MihomoDoc } from './parse'
import { BUILTIN_TARGETS } from './resolve'
import { rulesOf } from './rules'

const targets = (md: MihomoDoc): string[] => [...groupsOf(md).map((g) => g.name), ...proxiesOf(md).map((p) => p.name), ...BUILTIN_TARGETS]

const listenerNames = (md: MihomoDoc): string[] => {
  const root = md.json as { listeners?: unknown } | null
  return (Array.isArray(root?.listeners) ? root.listeners : [])
    .map((l) => (l as { name?: unknown } | null)?.name)
    .filter((n): n is string => typeof n === 'string')
}

export function startGroup(md: MihomoDoc): Record<string, unknown> {
  return { name: uniqueName(targets(md), 'Группа'), type: 'select' }
}

/** direct — единственный вид статического сервера, документированный панелью («без прокси») */
export function startProxy(md: MihomoDoc): Record<string, unknown> {
  return { name: uniqueName(targets(md), 'Сервер'), type: 'direct', udp: true }
}

export function providerName(md: MihomoDoc): string {
  return uniqueName(providersOf(md).map((p) => p.name), 'provider')
}
export function ruleProviderName(md: MihomoDoc): string {
  return uniqueName(ruleProvidersOf(md).map((r) => r.name), 'ruleset')
}
export function subRuleName(md: MihomoDoc): string {
  return uniqueName(subRuleNames(md), 'sub-rule')
}

export function startProvider(_md: MihomoDoc, _name: string): Record<string, unknown> {
  return { type: 'http', url: '', interval: 86400 }
}
export function startRuleProvider(_md: MihomoDoc, _name: string): Record<string, unknown> {
  return { type: 'http', behavior: 'domain', format: 'mrs', url: '', interval: 86400 }
}
export function startSubRule(): unknown[] {
  return []
}
export function startListener(md: MihomoDoc): Record<string, unknown> {
  return { name: uniqueName(listenerNames(md), 'вход'), type: 'mixed', listen: '127.0.0.1', port: 7890 }
}
export function startTunnel(): Record<string, unknown> {
  return { network: ['tcp', 'udp'], address: '127.0.0.1:0', target: '', proxy: '' }
}

/**
 * Куда и чем «+ Правило» заводит правило. Перед выбранным — самое частое
 * намерение писателя; иначе перед финальным MATCH: в Mihomo выигрывает первое
 * совпавшее, и правило ПОСЛЕ MATCH рождалось бы мёртвым. Второй MATCH перед
 * финальным сделал бы мёртвым уже финальный, поэтому заготовка — безобидное
 * DOMAIN-SUFFIX. Правил нет вовсе или список кончается обычным правилом —
 * MATCH,DIRECT в конец, где он уместен.
 */
export function nextRulePlacement(md: MihomoDoc, selectedRule: number | null): { raw: string; at: number } {
  const rules = rulesOf(md)
  if (selectedRule !== null && rules.some((r) => r.index === selectedRule)) {
    return { raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: selectedRule }
  }
  const last = rules[rules.length - 1]
  if (last?.rule?.type === 'MATCH') return { raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: last.index }
  return { raw: 'MATCH,DIRECT', at: rules.length }
}
```

- [ ] **Step 5: `mihomoAdapter.ts`**

`parse: (text) => { const md = parseMihomo(text); return { model: md, issues: validateMihomo(md) } }` — модель есть всегда: пустой документ — законная отправная точка сценария «с нуля», холст на нём показывает док с «+ Добавить». Комментарий про «гасим только когда разбирать нечего» заменить объяснением.

- [ ] **Step 6: `useMihomoDraft.ts`**

Заменить старые импорты `edits`/`groups` на `applyMihomoOps`, `mihomoLockAt`, `materializeAt` (`entities/mihomo/write`), `renameAt`, `renameRefusalText`, `NamedKind` (`entities/mihomo/refs`), `readFieldAt`, `originAt`, `setFieldAt`, `removeFieldAt`, `setListAt` (`edits` — только для временных обёрток), `rulesOf`, `groupsOf`, `proxiesOf`. Ядро:

```ts
const [refusal, setRefusal] = useState<string | null>(null)
const [recipesOpen, setRecipesOpen] = useState(false)
// Ref со свежим документом: writer обязан держать тождество между рендерами
// (формы memo'ят по нему), а операции — читать актуальный md
const mdRef = useRef(md)
mdRef.current = md

const applyOpsNow = useCallback((ops: DocOp[], select?: string | null) => {
  const current = mdRef.current
  if (current === undefined || ops.length === 0) return
  const { md: next, refused } = applyMihomoOps(current, ops)
  if (refused.length > 0) setRefusal(refused[0]!.reason)
  if (next !== current) core.writeDraft(next.text, { history: true })
  if (select !== undefined) core.setSelectedNode(select)
}, [core.writeDraft, core.setSelectedNode])

const materialize = useCallback((path: SchemaPath) => {
  const current = mdRef.current
  if (current === undefined) return
  const next = materializeAt(current, path)
  if (next !== current) core.writeDraft(next.text, { history: true })
}, [core.writeDraft])

const lockAt = useCallback((path: SchemaPath): Lock | null => {
  const current = mdRef.current
  if (current === undefined) return null
  const lock = mihomoLockAt(current, path)
  return lock === null ? null : { reason: lock.reason, action: { label: 'Развернуть значение здесь', run: () => materialize(path) } }
}, [materialize])

const writer = useMemo<DocWriter>(() => ({ apply: (ops) => applyOpsNow(ops), lockAt }), [applyOpsNow, lockAt])

const rename = useCallback((kind: NamedKind, from: string, to: string): string | null => {
  const current = mdRef.current
  if (current === undefined) return null
  const res = renameAt(current, kind, from, to)
  if (res.refusal !== undefined) return renameRefusalText(res.refusal)
  if (res.md === current) return null
  // Узел адресуется именем: без переноса выбора инспектор закрылся бы прямо во время ввода
  const prefix = kind === 'group' ? 'group:' : kind === 'proxy' ? 'proxy:' : kind === 'provider' ? 'provider:' : kind === 'sub-rule' ? 'subrule:' : null
  core.writeDraft(res.md.text, { history: true })
  if (prefix !== null && core.selectedNode === `${prefix}${from}`) core.setSelectedNode(`${prefix}${to}`)
  return null
}, [core.writeDraft, core.selectedNode, core.setSelectedNode])
```

`connect`: `const res = connectMihomo(md, source, target); setRefusal(res.refusal ? refusalText(res.refusal) : null); applyOpsNow(res.ops)`. `disconnect(edgeIds)`: собрать `ops` по всем рёбрам ОДНИМ вызовом `applyOpsNow` — операции удаления считают индексы по уже изменённому документу (писатель перечитывает после каждой); первый отказ — в `refusal`. Порядок: рёбра с большим индексом участника первыми не нужны — писатель применяет по одной с перечитыванием, но `disconnectMihomo` считает индекс по ИСХОДНОМУ `md`; поэтому применять по одному: `for (const id of edgeIds) { const res = disconnectMihomo(mdRef.current!, id); …; applyOpsNow(res.ops) }` — каждый шаг пишет черновик; чтобы история получила ОДИН снимок, собрать текст вручную: `let cur = md; for … { const r = applyMihomoOps(cur, res.ops); cur = r.md }; core.writeDraft(cur.text, { history: true })`. Так и сделать.

Временные обёртки (`setField` и прочие) реализовать через `applyOpsNow`: `setField(parts, key, value)` → `applyOpsNow([{ op: 'set', path: [...parts, ...key.split('.')], value }])`; `removeField` → `remove`; `setListAt` → `set` списком; `renameGroupTo(index, name)` → `rename('group', groupsOf(md)[index].name, name)`; `addGroupNamed(name)` → `insert` в `proxy-groups` `{ name, type: 'select' }` с выбором `group:<name>`; `addRuleText(raw, at)` → `insert` в `rules`; `replaceRule(index, raw)` → `set ['rules', index]`; `moveSelected/removeSelected` → `move`/`remove` для выбранного правила или группы; `originOf` → `originAt`; `sectionsOpen` — состояние. Каждая помечена `/** @deprecated удаляется в задаче 17 */`.

- [ ] **Step 7: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-starters.test.ts test/mihomo-draft.test.tsx test/mihomo-editor-page.test.tsx test/mihomo-inspector.test.tsx test/mihomo-topology.test.tsx && npm run typecheck`
Expected: PASS (старые компоненты работают через обёртки).

- [ ] **Step 8: Мутация**

В `applyOpsNow` убрать `setRefusal` → красным «отказ показывается текстом». Восстановить. В `rename` убрать перенос выбора → красным «переносит выбор». Восстановить.

- [ ] **Step 9: Отчёт**

Коммит: `feat(frontend): mihomo draft becomes a DocWriter with materialization, rename and batch disconnect`.

### Task 11: Формы на `SchemaForm`: поле имени, общая именованная форма, группа, сервер, провайдер, набор, вход

**Files:**
- Create: `frontend/src/features/inspector/MihomoNameField.tsx`, `MihomoNamedForm.tsx`, `MihomoGroupForm.tsx`, `MihomoProxyForm.tsx`, `MihomoProviderForm.tsx`, `MihomoRuleProviderForm.tsx`, `MihomoListenerForm.tsx`
- Test: `frontend/test/mihomo-group-form.test.tsx`, `mihomo-proxy-form.test.tsx`, `mihomo-provider-form.test.tsx`

**Interfaces:**
- Consumes: `SchemaForm`, `typeOptions`, `typeHint`; `GROUP_FIELDS`, `GROUP_TYPE_VALUES`, `PROXY_FIELDS`, `PROXY_TYPE_VALUES`, `PROVIDER_FIELDS`, `RULE_PROVIDER_FIELDS`, `LISTENER_FIELDS`, `LISTENER_TYPE_VALUES`; `DocWriter`, `DocRefs`, `SchemaPath`, `visibleFields`.
- Produces:

```tsx
export interface MihomoEntryFormProps {
  value: Record<string, unknown>
  path: SchemaPath
  writer: DocWriter
  refs: DocRefs
  /** Имя записи: у списков — value.name, у отображений — последний сегмент пути; форма его не читает сама */
  name: string
  /** Переименование с переносом ссылок; null — успех, иначе текст отказа, который поле покажет */
  onRename: (to: string) => string | null
}
export function MihomoNameField({ value, hint, onRename }: { value: string; hint: string; onRename: (to: string) => string | null }): ReactNode
export function MihomoNamedForm(p: MihomoEntryFormProps & { fields: FieldSchema[]; typeValues: EnumValue[]; typeLabel: string; typeHint?: string; nameHint: string; skip?: string[] }): ReactNode
export function MihomoGroupForm(p: MihomoEntryFormProps): ReactNode
export function MihomoProxyForm(p: MihomoEntryFormProps): ReactNode
export function MihomoProviderForm(p: MihomoEntryFormProps): ReactNode
export function MihomoRuleProviderForm(p: MihomoEntryFormProps): ReactNode
export function MihomoListenerForm(p: MihomoEntryFormProps): ReactNode
```

- [ ] **Step 1: Тесты**

`frontend/test/mihomo-group-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoGroupForm } from '../src/features/inspector/MihomoGroupForm'
import { mihomoRefs } from '../src/entities/mihomo/schema'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { makeWriter } from './schemaHelpers'
import { optionLabels, selectOption } from './helpers'

const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nproxy-groups:\n  - name: G\n    type: select\n    proxies: [s]\n    remnawave:\n      include-proxies: false\n')
const value = (md.json as { 'proxy-groups': Record<string, unknown>[] })['proxy-groups'][0]!

describe('MihomoGroupForm', () => {
  it('имя, тип, участники по целям документа, ключи панели видны', async () => {
    const { ops, writer } = makeWriter()
    const onRename = vi.fn(() => null)
    render(<MihomoGroupForm value={value} path={['proxy-groups', 0]} writer={writer} refs={mihomoRefs(md)} name="G" onRename={onRename} />)
    expect(screen.getByLabelText('Имя')).toHaveValue('G')
    expect(await optionLabels('Тип')).toEqual(['(не задано)', 'select', 'url-test', 'fallback', 'load-balance'])
    expect(screen.getByRole('button', { name: 's', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DIRECT', pressed: false })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'include-proxies' })).toBeInTheDocument()
    await selectOption('Тип', 'url-test')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['proxy-groups', 0, 'type'], value: 'url-test' })
    await userEvent.type(screen.getByLabelText('Имя'), '2')
    expect(onRename).toHaveBeenLastCalledWith('G2')
  })

  it('устаревший тип relay не предлагается, но текущий проходит сквозь с подсказкой', async () => {
    const { writer } = makeWriter()
    render(<MihomoGroupForm value={{ ...value, type: 'relay' }} path={['proxy-groups', 0]} writer={writer} refs={mihomoRefs(md)} name="G" onRename={() => null} />)
    expect(await optionLabels('Тип')).toEqual(['(не задано)', 'relay', 'select', 'url-test', 'fallback', 'load-balance'])
    expect(screen.getByText(/dialer-proxy/)).toBeInTheDocument()
  })

  it('отказ переименования показывается у поля, набранное не теряется', async () => {
    const { writer } = makeWriter()
    render(<MihomoGroupForm value={value} path={['proxy-groups', 0]} writer={writer} refs={mihomoRefs(md)} name="G" onRename={(to) => (to === 's' ? 'Имя занято.' : null)} />)
    await userEvent.clear(screen.getByLabelText('Имя'))
    await userEvent.type(screen.getByLabelText('Имя'), 's')
    expect(screen.getByText('Имя занято.')).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toHaveValue('s')
  })
})
```

`frontend/test/mihomo-proxy-form.test.tsx`:

```tsx
it('тип меняет набор полей: у vless есть uuid, у direct — нет server', async () => {
  const { writer } = makeWriter()
  const { rerender } = render(<MihomoProxyForm value={{ name: 's', type: 'direct' }} path={['proxies', 0]} writer={writer} refs={{}} name="s" onRename={() => null} />)
  expect(screen.queryByLabelText('server')).toBeNull()
  rerender(<MihomoProxyForm value={{ name: 's', type: 'vless', server: 'h', port: 443, uuid: 'u' }} path={['proxies', 0]} writer={writer} refs={{}} name="s" onRename={() => null} />)
  expect(screen.getByLabelText('server')).toHaveValue('h')
  expect(screen.getByLabelText('uuid')).toHaveValue('u')
})
it('замок с действием у значения-ссылки', async () => {
  const { writer } = makeWriter([{ path: ['proxies', 0, 'server'], reason: 'Через якорь.' }])
  render(<MihomoProxyForm value={{ name: 's', type: 'socks5', server: 'h' }} path={['proxies', 0]} writer={writer} refs={{}} name="s" onRename={() => null} />)
  expect(screen.getByText('Через якорь.')).toBeInTheDocument()
})
```

`frontend/test/mihomo-provider-form.test.tsx`: провайдер `inline` показывает `payload` карточками с формой сервера и кнопкой «+ Добавить», по нажатию — `insert` со стартером `{ name: '', type: 'ss', server: '', port: 443 }`; у `http` виден `url`, `payload` не виден; `MihomoRuleProviderForm` у `mrs` показывает `behavior` селектом без `classical`? — нет: `format: mrs` не ограничивает `behavior` схемой; проверить только, что `format` и `behavior` — селекты, `url` виден у `http`.

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-group-form.test.tsx test/mihomo-proxy-form.test.tsx test/mihomo-provider-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `MihomoNameField.tsx`**

```tsx
// Поле имени записи: имя адресует узел во всём документе, и пишется оно не
// операцией set, а переименованием с переносом ссылок. Набранное держится
// локально: переименование может быть отклонено (имя занято), и поле обязано
// показывать набранное вместе с причиной, а не откатывать его к документу.
// Документ перебивает буфер, когда имя изменилось не отсюда (undo, версия).

import { useId, useState } from 'react'
import { TextInput } from '../../shared/ui'
import { Field } from './fields'

export function MihomoNameField({ value, hint, onRename }: { value: string; hint: string; onRename: (to: string) => string | null }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  const [error, setError] = useState<string | null>(null)
  if (seen !== value) {
    setSeen(value)
    setText(value)
    setError(null)
  }
  return (
    <Field label="Имя" hint={hint} controlId={id}>
      <TextInput
        id={id}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setError(onRename(e.target.value))
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </Field>
  )
}
```

- [ ] **Step 4: `MihomoNamedForm.tsx` и обёртки**

```tsx
// Одна форма на все именованные записи Mihomo: имя, тип и всё остальное по
// схеме. Главных полей ровно два — остальное SchemaForm поднимет наверх само,
// если оно заполнено (server и port у настоящего сервера, url у провайдера).

import type { ReactNode } from 'react'
import type { EnumValue, FieldSchema, SchemaPath, DocWriter } from '../../shared/schema'
import type { DocRefs } from './schema/DocPanel'
import { SelectField } from './fields'
import { MihomoNameField } from './MihomoNameField'
import { SchemaForm } from './schema/SchemaForm'
import { typeHint, typeOptions } from './schema/typeSelect'

export interface MihomoEntryFormProps {
  value: Record<string, unknown>
  path: SchemaPath
  writer: DocWriter
  refs: DocRefs
  name: string
  onRename: (to: string) => string | null
}

export function MihomoNamedForm({
  value, path, writer, refs, name, onRename, fields, typeValues, typeLabel, nameHint, skip = [],
}: MihomoEntryFormProps & { fields: FieldSchema[]; typeValues: EnumValue[]; typeLabel: string; nameHint: string; skip?: string[] }): ReactNode {
  const type = typeof value.type === 'string' ? value.type : ''
  return (
    <>
      <MihomoNameField value={name} hint={nameHint} onRename={onRename} />
      <SelectField
        label="Тип"
        hint={typeHint(typeValues, type) ?? typeLabel}
        value={type}
        options={typeOptions(typeValues, type, true)}
        onChange={(v) => writer.apply([v === '' ? { op: 'remove', path: [...path, 'type'] } : { op: 'set', path: [...path, 'type'], value: v }])}
      />
      <SchemaForm fields={fields} value={value} path={path} writer={writer} refs={refs} skip={['name', 'type', ...skip]} showPanelKeys />
    </>
  )
}
```

Обёртки (каждая — свой файл, 10 строк): `MihomoGroupForm` — `GROUP_FIELDS`, `GROUP_TYPE_VALUES`, `typeLabel: 'Как группа выбирает участника.'`, `nameHint: 'На имя ссылаются правила и другие группы; переименование ведёт ссылки за собой.'`; `MihomoProxyForm` — `PROXY_FIELDS`, `PROXY_TYPE_VALUES`; `MihomoProviderForm` — `PROVIDER_FIELDS` + `typeValues` из `PROVIDER_FIELDS.find(type).enum`; `MihomoRuleProviderForm` — `RULE_PROVIDER_FIELDS`; `MihomoListenerForm` — `LISTENER_FIELDS`, `LISTENER_TYPE_VALUES`. Ключи панели у групп и провайдеров видны всегда (`showPanelKeys`): это и есть главный рычаг подстановки.

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-group-form.test.tsx test/mihomo-proxy-form.test.tsx test/mihomo-provider-form.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Мутация**

В `MihomoNameField` убрать `setError(onRename(...))` → красным «отказ переименования показывается». Восстановить.

- [ ] **Step 7: Отчёт**

Коммит: `feat(frontend): mihomo group, proxy, provider, rule-set and listener forms on SchemaForm`.

### Task 12: Форма правила на писателе и форма подсписка

**Files:**
- Modify: `frontend/src/features/inspector/MihomoRuleForm.tsx`; `frontend/src/features/topology/MihomoInspector.tsx` (только строка вызова формы правила — см. шаг 4)
- Create: `frontend/src/features/inspector/MihomoSubRuleForm.tsx`
- Test: `frontend/test/mihomo-rule-form.test.tsx` (переписать под писатель), `frontend/test/mihomo-subrule-form.test.tsx`

**Interfaces:**
- Consumes: `parseRule`, `formatRule`, `RULE_TYPES`, `NO_PAYLOAD`, `RULE_MODIFIERS`, `BUILTIN_TARGETS`; `valueAt`; `DocWriter`, `DocRefs`.
- Produces:

```tsx
export function MihomoRuleForm({ raw, path, writer, refs }: { raw: string; path: SchemaPath; writer: DocWriter; refs: DocRefs }): ReactNode
export function MihomoSubRuleForm({ rules, path, writer, refs, name, onRename }: { rules: string[]; path: SchemaPath; writer: DocWriter; refs: DocRefs; name: string; onRename: (to: string) => string | null }): ReactNode
```

`MihomoRuleForm`: `raw` — строка правила (декодированное значение скаляра), `path` — путь строки (`['rules', i]` либо `['sub-rules', name, i]`); правка — `writer.apply([{ op: 'set', path, value: formatRule(next) }])`; цель — `refs['proxy-target']` (не SUB-RULE) либо `refs['sub-rule']`. Проверка обратимости `roundTrips` и тексты отказа — как сегодня. Пропы `md`, `index`, `draft` уходят. Неразбираемая строка (`parseRule(raw) === null`) — прежнее сообщение «правьте её на вкладке YAML».

`MihomoSubRuleForm`: имя (`MihomoNameField`, `onRename`), список правил карточками: заголовок `#N`, `MihomoRuleForm` с `path: [...path, i]`, стрелки порядка (`move` по `path`), удаление (`remove [...path, i]`), кнопка «+ Правило» — `insert` в `path` с `nextRulePlacement`-подобной логикой ВНУТРИ подсписка: в конец `MATCH`-без-цели не нужен — вставляется `DOMAIN-SUFFIX,example.com,DIRECT` в конец (подсписок без MATCH нормален: непопадание выводит в основной список). Разметка карточек — как у `ListSection` в `DocPanel` (`list-editor-card`, `chip-order`, `chip-x`).

- [ ] **Step 1: Тесты**

`mihomo-rule-form.test.tsx` переписать: рендер `<MihomoRuleForm raw="DOMAIN-SUFFIX,a.com,G" path={['rules', 0]} writer={writer} refs={{ 'proxy-target': ['G', 'DIRECT'], 'sub-rule': ['s'] }} />`; смена типа → `set ['rules', 0]` с новой строкой; ввод запятой в значение → отказ у поля, `ops` не растёт; `SUB-RULE` → цель из `refs['sub-rule']`; путь подсписка `['sub-rules', 's', 1]` уходит в операцию как есть. Сохранить существующие сценарии (обратимость, модификаторы, «своё имя»).

`mihomo-subrule-form.test.tsx`:

```tsx
it('подсписок: карточки правил, порядок, удаление, добавление, переименование', async () => {
  const { ops, writer } = makeWriter()
  const onRename = vi.fn(() => null)
  render(<MihomoSubRuleForm rules={['DOMAIN,a.com,DIRECT', 'MATCH,REJECT']} path={['sub-rules', 's']} writer={writer} refs={{ 'proxy-target': ['DIRECT', 'REJECT'] }} name="s" onRename={onRename} />)
  expect(screen.getAllByLabelText('Тип')).toHaveLength(2)
  await userEvent.click(screen.getByRole('button', { name: 'Переместить элемент 2 выше' }))
  expect(ops.at(-1)).toEqual({ op: 'move', path: ['sub-rules', 's'], from: 1, to: 0 })
  await userEvent.click(screen.getByRole('button', { name: 'Удалить элемент 1' }))
  expect(ops.at(-1)).toEqual({ op: 'remove', path: ['sub-rules', 's', 0] })
  await userEvent.click(screen.getByRole('button', { name: '+ Правило' }))
  expect(ops.at(-1)).toEqual({ op: 'insert', path: ['sub-rules', 's'], index: 2, value: 'DOMAIN-SUFFIX,example.com,DIRECT' })
  await userEvent.type(screen.getByLabelText('Имя'), '2')
  expect(onRename).toHaveBeenLastCalledWith('s2')
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-rule-form.test.tsx test/mihomo-subrule-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`MihomoRuleForm.tsx`: пропы `{ raw, path, writer, refs }`; внутри `const rule = parseRule(raw)`; `commit` → `writer.apply([{ op: 'set', path, value: formatRule(next) }])`; `known = isSubRule ? refs['sub-rule'] ?? [] : refs['proxy-target'] ?? []`; `key` компоненты `RuleFields` — `path.join('.')` (сброс локального состояния при переходе на другое правило). Импорты `groupsOf`/`providersOf`/`subRuleNames`/`rulesOf`/`MihomoDraft` убрать.

`MihomoSubRuleForm.tsx`:

```tsx
export function MihomoSubRuleForm({ rules, path, writer, refs, name, onRename }: Props) {
  return (
    <>
      <MihomoNameField value={name} hint="На подсписок ссылается правило SUB-RULE и вход (listeners[].rule)." onRename={onRename} />
      <div className="list-editor">
        {rules.length === 0 && <p className="muted">Правил пока нет — кнопка ниже заведёт первое.</p>}
        {rules.map((raw, i) => (
          <div key={i} className="list-editor-card">
            <div className="list-editor-body">
              <span className="eyebrow">#{i + 1}</span>
              <MihomoRuleForm raw={raw} path={[...path, i]} writer={writer} refs={refs} />
            </div>
            <div className="list-editor-order">
              <button type="button" className="chip-order" aria-label={`Переместить элемент ${i + 1} выше`} disabled={i === 0} onClick={() => writer.apply([{ op: 'move', path, from: i, to: i - 1 }])}>↑</button>
              <button type="button" className="chip-order" aria-label={`Переместить элемент ${i + 1} ниже`} disabled={i === rules.length - 1} onClick={() => writer.apply([{ op: 'move', path, from: i, to: i + 1 }])}>↓</button>
            </div>
            <button type="button" className="chip-x" aria-label={`Удалить элемент ${i + 1}`} onClick={() => writer.apply([{ op: 'remove', path: [...path, i] }])}>✕</button>
          </div>
        ))}
        <Button onClick={() => writer.apply([{ op: 'insert', path, index: rules.length, value: 'DOMAIN-SUFFIX,example.com,DIRECT' }])}>+ Правило</Button>
      </div>
      <p className="muted">Подсписок без MATCH нормален: если ни одно правило не совпало, проход возвращается в основной список.</p>
    </>
  )
}
```

- [ ] **Step 4: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-rule-form.test.tsx test/mihomo-subrule-form.test.tsx && npm run typecheck`
Expected: PASS. `MihomoInspector` пока рендерит `MihomoRuleForm` по старым пропам — typecheck здесь упадёт на `MihomoInspector.tsx`; чтобы этого не было, в ЭТОЙ задаче в `MihomoInspector.tsx` сменить ОДНУ строку вызова: `<MihomoRuleForm raw={rulesOf(md).find((r) => r.index === ruleIndex)?.raw ?? ''} path={['rules', ruleIndex]} writer={draft.writer} refs={mihomoRefs(md)} />` (импорты `mihomoRefs`). Файл инспектора целиком переписывает задача 13 (следующая волна).

- [ ] **Step 5: Мутация**

В `MihomoSubRuleForm` кнопку «+ Правило» заставить вставлять по индексу 0 → красным «добавление». Восстановить.

- [ ] **Step 6: Отчёт**

Коммит: `feat(frontend): mihomo rule form writes through the document writer; sub-rules get an editable form`.
### Task 13: Инспектор Mihomo: виды узлов, писатель, порядок и удаление, панель «Документ»

**Files:**
- Modify: `frontend/src/features/topology/MihomoInspector.tsx` (переписывается целиком)
- Create: `frontend/src/features/topology/MihomoDocPanel.tsx`
- Test: `frontend/test/mihomo-inspector.test.tsx` (переписать), `frontend/test/mihomo-doc-panel.test.tsx`

**Interfaces:**
- Consumes: `DocPanel`, `DocListSpec`, `DocMapSpec`, `DocRefs`; `MIHOMO_DOC_SECTIONS`, `mihomoFieldsAt`, `mihomoFieldAt`, `mihomoRefs`; формы задач 11–12; стартеры; `MihomoDraft` (задача 10); `groupsOf`, `proxiesOf`, `providersOf`, `subRuleEntries`, `rulesOf`, `ruleEntriesOf`, `panelInjectsHosts`, `groupTakesHosts`; `BUILTIN_TARGETS`.
- Produces:

```tsx
export function MihomoDocPanel({ draft, md }: { draft: MihomoDraft; md: MihomoDoc }): ReactNode
export function MihomoInspector({ draft, md, nodeId, onClose }: Props): ReactNode
// виды: 'group' | 'rule' | 'proxy' | 'provider' | 'hosts' | 'subrule' | 'builtin' | 'settings' | 'other'
// PSEUDO_NODES = { 'doc:settings': 'settings' }
```

Правила:
- Формы получают `writer = draft.writer` без обёртки инспектора: имя пишется через `onRename → draft.rename(kind, name, to)`, а не операцией `set`, поэтому отказа на пустом имени в писателе нет — его даёт `renameAt` (`empty`). Выбор за узлом переносит `draft.rename`.
- Порядок («порядок: N из M», «Выше»/«Ниже») и удаление: правило (`['rules']`), группа (`['proxy-groups']`), сервер (`['proxies']`); у провайдера и подсписка — только «Удалить» (`remove ['proxy-providers', name]` / `['sub-rules', name]`). Перестановка правила ведёт выбор `rule:<index±1>`.
- `hosts` — карточка задачи 8; `builtin` — как сегодня; `settings` — `MihomoDocPanel`.

- [ ] **Step 1: Тесты**

`frontend/test/mihomo-inspector.test.tsx` переписать. Помощник `draftStub` собирает объект с `writer: { apply: vi.fn(), lockAt: () => null }`, `rename: vi.fn(() => null)`, `applyOps: vi.fn()`, `setSelectedNode: vi.fn()`, `selectedNode: null`, `lockAt: () => null`. Проверки:

```tsx
it('группа: форма группы, порядок и удаление через операции', async () => {
  const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\n  - name: B\n    type: select\n')
  const draft = draftStub({ selectedNode: 'group:B' })
  render(<MihomoInspector draft={draft} md={md} nodeId="group:B" />)
  expect(screen.getByText('порядок: 2 из 2')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Переместить выше' }))
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'move', path: ['proxy-groups'], from: 1, to: 0 }])
  await userEvent.click(screen.getByRole('button', { name: 'Удалить группу' }))
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'remove', path: ['proxy-groups', 1] }], null)
})
it('сервер и провайдер: свои формы; у провайдера только удаление по имени', async () => {
  const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nproxy-providers:\n  P: {type: http, url: u}\n')
  const { rerender } = render(<MihomoInspector draft={draftStub({ selectedNode: 'proxy:s' })} md={md} nodeId="proxy:s" />)
  expect(screen.getByText('сервер')).toBeInTheDocument()
  expect(screen.getByLabelText('Имя')).toHaveValue('s')
  const draft = draftStub({ selectedNode: 'provider:P' })
  rerender(<MihomoInspector draft={draft} md={md} nodeId="provider:P" />)
  expect(screen.queryByText(/порядок:/)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Удалить провайдера' }))
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'remove', path: ['proxy-providers', 'P'] }], null)
})
it('переименование идёт через draft.rename с видом записи', async () => {
  const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\n')
  const draft = draftStub({ selectedNode: 'group:A' })
  render(<MihomoInspector draft={draft} md={md} nodeId="group:A" />)
  await userEvent.type(screen.getByLabelText('Имя'), 'B')
  expect(draft.rename).toHaveBeenLastCalledWith('group', 'A', 'AB')
})
it('подсписок редактируется формой; правило подсписка пишет по пути sub-rules', async () => {
  const md = parseMihomo('sub-rules:\n  s:\n    - DOMAIN,a.com,DIRECT\n')
  const draft = draftStub({ selectedNode: 'subrule:s' })
  render(<MihomoInspector draft={draft} md={md} nodeId="subrule:s" />)
  await selectOption('Тип', 'DOMAIN-SUFFIX')
  expect(draft.writer.apply).toHaveBeenLastCalledWith([{ op: 'set', path: ['sub-rules', 's', 0], value: 'DOMAIN-SUFFIX,a.com,DIRECT' }])
})
it('doc:settings открывает панель «Документ»', () => {
  const md = parseMihomo('mode: rule\n')
  render(<MihomoInspector draft={draftStub({ selectedNode: 'doc:settings' })} md={md} nodeId="doc:settings" />)
  expect(screen.getByText('документ')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Общие' })).toBeInTheDocument()
})
```

`frontend/test/mihomo-doc-panel.test.tsx`:

```tsx
it('раздел «Общие» — корневые скаляры без контейнеров; DNS заводится стартером', async () => {
  const md = parseMihomo('mode: rule\nproxy-groups: []\n')
  const draft = draftStub()
  render(<MihomoDocPanel draft={draft} md={md} />)
  await userEvent.click(screen.getByRole('button', { name: 'Общие' }))
  const general = screen.getByRole('region', { name: 'Общие' })
  expect(within(general).getByLabelText('mode')).toBeInTheDocument()
  expect(within(general).queryByText('proxy-groups')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'DNS' }))
  await userEvent.click(within(screen.getByRole('region', { name: 'DNS' })).getByRole('button', { name: 'Завести раздел' }))
  expect(draft.writer.apply).toHaveBeenLastCalledWith([{ op: 'set', path: ['dns'], value: expect.objectContaining({ enable: true, 'enhanced-mode': 'fake-ip' }) }])
})
it('наборы правил — записи по имени с формой набора; «+ Набор правил» заводит ruleset', async () => {
  const md = parseMihomo('rule-providers:\n  ads: {type: http, behavior: domain, url: u}\n')
  const draft = draftStub()
  render(<MihomoDocPanel draft={draft} md={md} />)
  await userEvent.click(screen.getByRole('button', { name: 'Наборы правил' }))
  const region = screen.getByRole('region', { name: 'Наборы правил' })
  expect(within(region).getByLabelText('Имя')).toHaveValue('ads')
  expect(within(region).getByLabelText('url')).toHaveValue('u')
  await userEvent.click(within(region).getByRole('button', { name: '+ Набор правил' }))
  expect(draft.writer.apply).toHaveBeenLastCalledWith([{ op: 'set', path: ['rule-providers', 'ruleset'], value: { type: 'http', behavior: 'domain', format: 'mrs', url: '', interval: 86400 } }])
})
it('входы — список с формой входа; подсписки — форма подсписка', async () => {
  const md = parseMihomo('listeners:\n  - {name: l, type: mixed, port: 1}\nsub-rules:\n  s: [MATCH,DIRECT]\n')
  const draft = draftStub()
  render(<MihomoDocPanel draft={draft} md={md} />)
  await userEvent.click(screen.getByRole('button', { name: 'Входы' }))
  expect(within(screen.getByRole('region', { name: 'Входы' })).getByLabelText('Имя')).toHaveValue('l')
  await userEvent.click(screen.getByRole('button', { name: 'Подсписки' }))
  expect(within(screen.getByRole('region', { name: 'Подсписки' })).getByRole('button', { name: '+ Правило' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-inspector.test.tsx test/mihomo-doc-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `MihomoDocPanel.tsx`**

```tsx
// Разделы документа Mihomo поверх общего DocPanel. Записи отображений
// (наборы, провайдеры, подсписки) адресуются именем — форма получает его из
// пути, переименование идёт через draft.rename с переносом ссылок.

import { MIHOMO_DOC_SECTIONS, mihomoFieldAt, mihomoFieldsAt, mihomoRefs, type MihomoDoc } from '../../entities/mihomo'
import { startListener, startProvider, startRuleProvider, startSubRule, startTunnel } from '../../entities/mihomo/starters'
import { valueAt } from '../../shared/schema'
import { DocPanel, type DocListSpec, type DocMapSpec } from '../inspector/schema/DocPanel'
import { SchemaForm } from '../inspector/schema/SchemaForm'
import { MihomoListenerForm } from '../inspector/MihomoListenerForm'
import { MihomoProviderForm } from '../inspector/MihomoProviderForm'
import { MihomoRuleProviderForm } from '../inspector/MihomoRuleProviderForm'
import { MihomoSubRuleForm } from '../inspector/MihomoSubRuleForm'
import type { MihomoDraft } from '../editor/useMihomoDraft'

const nameOfPath = (path: (string | number)[]) => String(path[path.length - 1])

export function MihomoDocPanel({ draft, md }: { draft: MihomoDraft; md: MihomoDoc }) {
  const refs = mihomoRefs(md)
  const lists: Record<string, DocListSpec<MihomoDoc>> = {
    listeners: {
      addLabel: '+ Вход', removeLabel: (i) => `Удалить вход #${i + 1}`,
      titleOf: (item, i) => ((item as { name?: unknown } | null)?.name as string) || `вход #${i + 1}`,
      starter: startListener,
      Form: (p) => <MihomoListenerForm {...p} name={String(p.value.name ?? '')} onRename={(to) => { p.writer.apply([{ op: 'set', path: [...p.path, 'name'], value: to }]); return null }} />,
    },
    tunnels: {
      addLabel: '+ Туннель', removeLabel: (i) => `Удалить туннель #${i + 1}`, titleOf: (_i, i) => `туннель #${i + 1}`, starter: startTunnel,
      Form: (p) => <SchemaForm fields={mihomoFieldsAt(p.path, md.json) ?? []} value={p.value} path={p.path} writer={p.writer} refs={p.refs} />,
    },
  }
  const maps: Record<string, DocMapSpec<MihomoDoc>> = {
    'rule-providers': {
      addLabel: '+ Набор правил', removeLabel: (n) => `Удалить набор ${n}`, baseName: 'ruleset', starter: startRuleProvider,
      Form: (p) => <MihomoRuleProviderForm {...p} name={nameOfPath(p.path)} onRename={(to) => draft.rename('rule-provider', nameOfPath(p.path), to)} />,
    },
    'proxy-providers': {
      addLabel: '+ Провайдер', removeLabel: (n) => `Удалить провайдера ${n}`, baseName: 'provider', starter: startProvider,
      Form: (p) => <MihomoProviderForm {...p} name={nameOfPath(p.path)} onRename={(to) => draft.rename('provider', nameOfPath(p.path), to)} />,
    },
    'sub-rules': {
      addLabel: '+ Подсписок', removeLabel: (n) => `Удалить подсписок ${n}`, baseName: 'sub-rule', starter: () => startSubRule(),
      Form: (p) => {
        const rules = valueAt(md.json, p.path)
        return <MihomoSubRuleForm rules={Array.isArray(rules) ? rules.map(String) : []} path={p.path} writer={p.writer} refs={p.refs} name={nameOfPath(p.path)} onRename={(to) => draft.rename('sub-rule', nameOfPath(p.path), to)} />
      },
    },
  }
  return (
    <DocPanel
      sections={MIHOMO_DOC_SECTIONS}
      doc={md}
      writer={draft.writer}
      refs={refs}
      fieldsAt={(path, d) => mihomoFieldsAt(path, d.json)}
      fieldAt={(path, d) => mihomoFieldAt(path, d.json)}
      valueOf={(d, path) => valueAt(d.json, path)}
      lists={lists}
      maps={maps}
    />
  )
}
```

Имя входа — не ссылка (на него ссылается только `IN-NAME`, чей разбор в `referenceSites` не входит): пишется операцией `set`, без `draft.rename`.

`DocMapSpec.Form` для подсписка получает `value` объектом (`isRecord(item) ? item : {}`) — для списка это `{}`; поэтому правила читаются заново из `md.json` по пути. В `DocPanel.MapSection` ничего менять не нужно.

- [ ] **Step 4: `MihomoInspector.tsx`**

Переписать по образцу `SingboxInspector`: `Kind`, `KIND_LABEL` (`group: 'группа'`, `rule: 'правило'`, `proxy: 'сервер'`, `provider: 'провайдер'`, `hosts: 'подстановка'`, `subrule: 'подсписок'`, `builtin: 'встроенная цель'`, `settings: 'документ'`, `other: 'узел'`), `REMOVE_LABEL` (`group: 'Удалить группу'`, `rule: 'Удалить правило'`, `proxy: 'Удалить сервер'`, `provider: 'Удалить провайдера'`, `subrule: 'Удалить подсписок'`), `PSEUDO_NODES`, `kindOf`.

```ts
function recordSlot(md: MihomoDoc, kind: Kind, name: string): { list: SchemaPath; index: number; length: number } | null {
  if (kind === 'rule') { const rules = rulesOf(md); const index = Number(name); return rules.some((r) => r.index === index) ? { list: ['rules'], index, length: rules.length } : null }
  if (kind === 'group') { const groups = groupsOf(md); const g = groups.find((x) => x.name === name); return g ? { list: ['proxy-groups'], index: g.index, length: groups.length } : null }
  if (kind === 'proxy') { const proxies = proxiesOf(md); const p = proxies.find((x) => x.name === name); return p ? { list: ['proxies'], index: p.index, length: proxies.length } : null }
  return null
}
function removePath(md: MihomoDoc, kind: Kind, name: string, slot: ReturnType<typeof recordSlot>): SchemaPath | null {
  if (slot !== null) return [...slot.list, slot.index]
  if (kind === 'provider') return providersOf(md).some((p) => p.name === name) ? ['proxy-providers', name] : null
  if (kind === 'subrule') return subRuleEntries(md).some((s) => s.name === name) ? ['sub-rules', name] : null
  return null
}
```

Тело: `refs = useMemo(() => mihomoRefs(md), [md])`; карточки:

- `group` → `<MihomoGroupForm value={valueAt(md.json, ['proxy-groups', g.index])} path={['proxy-groups', g.index]} writer={draft.writer} refs={refs} name={g.name} onRename={(to) => draft.rename('group', g.name, to)} />`; группы нет → «Группы «…» в документе больше нет.»
- `proxy` → `MihomoProxyForm` по `proxiesOf`; `provider` → `MihomoProviderForm` по `['proxy-providers', name]`; `rule` → `<MihomoRuleForm raw={entry.raw} path={['rules', index]} …/>` (для `entry.rule === null` форма сама скажет про YAML); `subrule` → `MihomoSubRuleForm` с `rules` из `ruleEntriesOf(md, node).map((e) => valueAt(md.json, ['sub-rules', name, e.index]) as string)`; `hosts`, `builtin` — как сегодня (карточка задачи 8); `settings` → `<MihomoDocPanel draft={draft} md={md} />`.
- Шапка: `slot !== null` → «порядок: N из M», «Выше»/«Ниже» (`draft.applyOps([{ op: 'move', … }])`, для правила — с выбором `rule:<index±1>`); подвал: `removePath !== null` → кнопка `REMOVE_LABEL[kind]` → `draft.applyOps([{ op: 'remove', path }], null)`.

Кнопка «Удалить» у записи с `raw`, разобранной как `null`, остаётся — удалить неразбираемую строку правила можно.

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-inspector.test.tsx test/mihomo-doc-panel.test.tsx test/mihomo-editor-page.test.tsx && npm run typecheck`
Expected: PASS. `MihomoEditorPage` пока зовёт `draft.setSectionsOpen` — обёртка задачи 10 ещё есть, typecheck зелёный.

- [ ] **Step 6: Мутация**

В `recordSlot` для `proxy` вернуть `null` → красным «сервер и провайдер…»? Нет — тот тест не проверяет порядок сервера; добавить в тест группы проверку `порядок:` для сервера либо мутировать ветку `group` → красным «порядок: 2 из 2». Восстановить.

- [ ] **Step 7: Отчёт**

Коммит: `feat(frontend): mihomo inspector on schema forms with order, deletion and the document panel`.

### Task 14: Док: меню «+ Добавить», «+ Правило» по месту, «Документ»; карточка сервера; стили гнёзд

**Files:**
- Modify: `frontend/src/features/topology/MihomoTopology.tsx`, `mihomoNodes.tsx`, `frontend/src/shared/ui/tokens.css` (одна строка селектора `data-accepts`)
- Test: `frontend/test/mihomo-topology.test.tsx`, `mihomo-topology-canvas-props.test.tsx` (обновить `targetKinds`), `mihomo-nodes.test.tsx` (если есть; иначе проверка карточки сервера в `mihomo-topology.test.tsx`)

**Interfaces:**
- Consumes: `MenuButton`, `MenuItem`; стартеры; `nextRulePlacement`; `MihomoDraft.applyOps`, `setSelectedNode`, `refusal`, `disconnect(edgeIds)`.
- Produces: `export const ADD_ITEMS: MenuItem[]` (`group` «Группа», `proxy` «Сервер», `provider` «Провайдер», `rule-provider` «Набор правил», `sub-rule` «Подсписок», `listener` «Вход»); `export function addFromMenu(draft: Pick<MihomoDraft, 'applyOps' | 'setSelectedNode'>, md: MihomoDoc, id: string): void`; `MIHOMO_TARGET_KINDS = ['group', 'provider', 'proxy', 'builtin']`; удаляются `nextGroupName`, `nextRulePlacement` (переехал в стартеры), диалог `multiCut`.

- [ ] **Step 1: Тесты**

В `frontend/test/mihomo-topology.test.tsx`:

```tsx
it('меню «+ Добавить»: группа и сервер выбираются на холсте, набор и подсписок открывают панель «Документ»', () => {
  const md = parseMihomo('proxy-groups:\n  - name: Группа\n    type: select\n')
  const draft = { applyOps: vi.fn(), setSelectedNode: vi.fn() }
  addFromMenu(draft, md, 'group')
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'insert', path: ['proxy-groups'], index: 1, value: { name: 'Группа-2', type: 'select' } }], 'group:Группа-2')
  addFromMenu(draft, md, 'proxy')
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'insert', path: ['proxies'], index: 0, value: { name: 'Сервер', type: 'direct', udp: true } }], 'proxy:Сервер')
  addFromMenu(draft, md, 'provider')
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'set', path: ['proxy-providers', 'provider'], value: { type: 'http', url: '', interval: 86400 } }], 'provider:provider')
  addFromMenu(draft, md, 'rule-provider')
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'set', path: ['rule-providers', 'ruleset'], value: expect.objectContaining({ behavior: 'domain' }) }], 'doc:settings')
  addFromMenu(draft, md, 'sub-rule')
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'set', path: ['sub-rules', 'sub-rule'], value: [] }], 'subrule:sub-rule')
  addFromMenu(draft, md, 'listener')
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'insert', path: ['listeners'], index: 0, value: expect.objectContaining({ type: 'mixed' }) }], 'doc:settings')
})
it('«+ Правило» вставляет перед выбранным, а на пустом документе заводит rules', async () => {
  const md = parseMihomo('rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,DIRECT\n')
  const draft = draftStub({ selectedNode: 'rule:1' })
  render(<MihomoTopology draft={draft} md={md} />)
  await userEvent.click(screen.getByRole('button', { name: '+ Правило' }))
  expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'insert', path: ['rules'], index: 1, value: 'DOMAIN-SUFFIX,example.com,DIRECT' }], 'rule:1')
})
it('кнопка «Документ» выбирает doc:settings', async () => { … expect(draft.setSelectedNode).toHaveBeenCalledWith('doc:settings') })
```

Существующие тесты про `nextGroupName`, `nextRulePlacement` из топологии и про диалог «За раз разрывается одна связь» удалить (поведение снято); `onEdgesDelete` с двумя рёбрами теперь зовёт `draft.disconnect([id1, id2])`.

`mihomo-topology-canvas-props.test.tsx`: `targetKinds` содержит `'proxy'`.

Карточка сервера: `mihomoNodeTypes.mihomoProxy` рендерит `fnode-kind` = тип, заголовок = имя, метрику `server` (если есть), гнездо-цель есть, гнезда-источника нет.

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-topology.test.tsx test/mihomo-topology-canvas-props.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `MihomoTopology.tsx`**

```ts
export const ADD_ITEMS: MenuItem[] = [
  { id: 'group', label: 'Группа' }, { id: 'proxy', label: 'Сервер' }, { id: 'provider', label: 'Провайдер' },
  { id: 'rule-provider', label: 'Набор правил' }, { id: 'sub-rule', label: 'Подсписок' }, { id: 'listener', label: 'Вход' },
]

/**
 * Заводит запись со стартером и переносит выбор: у записи с узлом — на узел,
 * у записи без узла (набор, вход) — на панель «Документ», где она и правится.
 */
export function addFromMenu(draft: Pick<MihomoDraft, 'applyOps' | 'setSelectedNode'>, md: MihomoDoc, id: string): void {
  const root = md.json as Record<string, unknown>
  const len = (key: string) => (Array.isArray(root[key]) ? (root[key] as unknown[]).length : 0)
  switch (id) {
    case 'group': { const v = startGroup(md); draft.applyOps([{ op: 'insert', path: ['proxy-groups'], index: len('proxy-groups'), value: v }], `group:${v.name as string}`); return }
    case 'proxy': { const v = startProxy(md); draft.applyOps([{ op: 'insert', path: ['proxies'], index: len('proxies'), value: v }], `proxy:${v.name as string}`); return }
    case 'provider': { const name = providerName(md); draft.applyOps([{ op: 'set', path: ['proxy-providers', name], value: startProvider(md, name) }], `provider:${name}`); return }
    case 'rule-provider': { const name = ruleProviderName(md); draft.applyOps([{ op: 'set', path: ['rule-providers', name], value: startRuleProvider(md, name) }], 'doc:settings'); return }
    case 'sub-rule': { const name = subRuleName(md); draft.applyOps([{ op: 'set', path: ['sub-rules', name], value: startSubRule() }], `subrule:${name}`); return }
    case 'listener': draft.applyOps([{ op: 'insert', path: ['listeners'], index: len('listeners'), value: startListener(md) }], 'doc:settings'); return
    default: return
  }
}
```

Док: `<Button onClick={() => { const { raw, at } = nextRulePlacement(md, selectedRuleIndex(draft.selectedNode)); draft.applyOps([{ op: 'insert', path: ['rules'], index: at, value: raw }], \`rule:${at}\`) }}>+ Правило</Button>`, `<MenuButton label="+ Добавить" items={ADD_ITEMS} onPick={(id) => addFromMenu(draft, md, id)} />`, `<Button variant="ghost" onClick={() => draft.setSelectedNode('doc:settings')}>Документ</Button>`. `onEdgesDelete` → `draft.disconnect(deleted.map((e) => e.id))`; состояние `multiCut` и его диалог удалить. Диалог отказа: `open={draft.refusal !== null}`, текст — `draft.refusal` (строка). `MIHOMO_TARGET_KINDS = ['group', 'provider', 'proxy', 'builtin'] as const`. Подсказка пустого холста: «Редактор не нашёл в документе ни одной группы, правила, сервера или провайдера. Заведите их кнопками ниже или впишите на вкладке YAML.»

- [ ] **Step 4: `mihomoNodes.tsx` и `tokens.css`**

Карточка сервера:

```tsx
function MihomoProxyNode({ data, selected }: { data: MihomoProxyNodeData; selected?: boolean }) {
  return (
    <div className={frame('proxy', selected)} style={enter('proxy')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.type ?? 'сервер'}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.name}</div>
      {data.server && <div className="metrics"><Metric>{data.server}</Metric></div>}
      {/* Гнезда-источника нет: сервер — конец маршрута */}
    </div>
  )
}
```

`frame`: `kind === 'proxy' ? 'fnode-out' : ''`; `ENTER_DELAY.proxy = 180`; `mihomoNodeTypes.mihomoProxy = MihomoProxyNode`. В `tokens.css` в оба селектора `data-accepts` добавить `[data-accepts~='proxy'] .react-flow__node[data-id^='proxy:'] .fnode` и парный `.react-flow__handle-left`.

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-topology.test.tsx test/mihomo-topology-canvas-props.test.tsx test/mihomo-editor-page.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Мутация**

В `addFromMenu` для `group` передать `select` как `null` → красным «меню…». Восстановить.

- [ ] **Step 7: Отчёт**

Коммит: `feat(frontend): mihomo dock adds groups, servers, providers, rule sets, sub-rules and listeners; rules insert in place`.

### Task 15: Подсказки YAML по дереву схемы

**Files:**
- Modify: `frontend/src/features/editor/mihomoIntellisense/context.ts`, `complete.ts`, `hover.ts`, `index.ts`
- Test: `frontend/test/mihomo-intellisense.test.ts`, `mihomo-hover.test.ts` (переписать под схему)

**Interfaces:**
- Consumes: `mihomoFieldsAt`, `mihomoFieldAt`, `mihomoRefs`; `pathAt`; `FieldSchema`, `visibleFields`.
- Produces:

```ts
export interface MihomoCursor {
  /** Путь до отображения, которому принадлежит курсор */
  path: SchemaPath
  /** Поля схемы этого места; undefined — схема места не знает (элемент списка строк, flow) */
  fields: FieldSchema[] | undefined
  existingKeys: string[]
  mode: 'key' | 'value'
  key?: string
}
export function contextAt(text: string, pos: number): MihomoCursor | null
export function fieldFor(cursor: MihomoCursor, key: string): FieldSchema | undefined
export function hoverAt(text: string, pos: number): MihomoHover | null  // { key, field: FieldSchema, from, to }
```

`CONTAINER_KEYS`, `containerKey`, `plainContainerKeys`, `nestedNamespace`, `MihomoSectionName`, `sectionOf`, `withinSection` удаляются: описание контейнера — `doc` поля схемы (`obj`/`objs`/`map`), вложенные отображения — `fields` объекта.

- [ ] **Step 1: Тесты**

Переписать сценарии `mihomo-intellisense.test.ts` на схему: ключи корня предлагают `dns`, `proxies`, `rules`… с `info` из схемы; внутри `proxy-groups[0]` при `type: url-test` предлагают `tolerance`, а `strategy` — тоже (условий по типу у группы схема не ставит); внутри `proxies[0]` при `type: vless` предлагают `uuid` и не предлагают `cipher`; внутри `ws-opts` — `path`, `headers`; значения `enum`/`boolean`; значения `ref` (`proxy: ` у провайдера) — имена целей документа; `sniffer.sniff.HTTP` — `ports`, `override-destination`. Hover: `enable-process` показывает устаревшее с заменой; `dns` показывает `doc` раздела; `remnawave` в группе — «Ключи панели Remnawave…».

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-intellisense.test.ts test/mihomo-hover.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`context.ts`: оставить арифметику пути по отступам (`containerOf`, `segmentColumn`, `listOf`, `keyOf`, `child`, `nodeAt`, `VALUE_RE`, `KEY_INDENT_RE`), заменить `sectionOf` на `mihomoFieldsAt(path, md.json)`: `contextAt` возвращает `{ path, fields, existingKeys, mode, key }`; для строки, заводящей новый элемент списка объектов (`- ` под `proxy-groups`/`proxies`/`listeners`), поля — `mihomoFieldsAt([...path, 0], md.json)` с holder `{}` (элемента ещё нет): реализовать как `fieldsAt` по пути со свежим индексом, где `valueAt` даёт `undefined` — `fieldsAt` это допускает (описание есть у элемента, которого нет). `fieldFor(cursor, key)` — `cursor.fields?.find((f) => f.key === key)`.

`complete.ts`: ключи — `cursor.fields` минус `existingKeys`, `info: field.doc` (+ `deprecatedNote` при `deprecated`), `detail: field.kind`, суффикс `: ` у скаляров и `:` + перевод строки с отступом у `object`/`list`/`map`; значения — `enum` (с `doc`), `boolean` → `true`/`false`, `ref` → `mihomoRefs(md)[field.ref]`, элемент списка с `enum` (`network` у tunnels). Никаких `SECTION_KEYS`/контейнеров: контейнеры корня — те же поля схемы.

`hover.ts`: `hoverAt` берёт путь строки (`pathAt` + `containerOf`), `field = mihomoFieldAt([...path, key], md.json)`; тултип — `doc`, `kind`, известные значения `enum`, пометка устаревшего. Тип `MihomoContainerKey` удалить, `MihomoHover.field: FieldSchema`.

`index.ts` — реэкспорт без удалённых имён; `hoverTooltipDom` без изменений.

- [ ] **Step 4: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-intellisense.test.ts test/mihomo-hover.test.ts test/mihomo-yaml-locate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Мутация**

В `complete.ts` не вычитать `existingKeys` → красным тест «не предлагает уже введённые ключи» (если его нет — добавить). Восстановить.

- [ ] **Step 6: Отчёт**

Коммит: `feat(frontend): mihomo YAML completion and hover read the schema tree`.

### Task 16: Валидация: устаревшее по схеме, ссылки по единому перечню

**Files:**
- Modify: `frontend/src/entities/mihomo/validate.ts`
- Test: `frontend/test/mihomo-validate.test.ts`

**Interfaces:**
- Consumes: `walkSchema`, `deprecatedAt`, `MIHOMO_SCHEMA`; `referenceSites`, `namesOf`; `groupGetsHosts`, `conflictingKeys`; `RULE_TYPES`, `RULE_MODIFIERS`, `ruleEntriesOf`, `rulesOf`, `subRuleEntries`.
- Produces: `validateMihomo(md)` — прежние проверки минус проверки ссылок в `checkRuleList` и в цикле групп (их даёт `referenceSites`) плюс устаревшее.

- [ ] **Step 1: Тесты**

Добавить в `mihomo-validate.test.ts`:

```ts
it('устаревшие ключи и значения — предупреждение с заменой по пути', () => {
  const md = parseMihomo('enable-process: true\nproxy-groups:\n  - name: G\n    type: relay\ntun:\n  inet4-route-address: [0.0.0.0/1]\n')
  const issues = validateMihomo(md).filter((i) => i.message.startsWith('Устарело'))
  expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['enable-process', 'proxy-groups.0.type', 'tun.inet4-route-address']))
  expect(issues.every((i) => i.level === 'warning')).toBe(true)
})
it('ссылки в пустоту — по всем местам ссылок: dialer-proxy, nameserver-policy, listeners[].rule, tunnels[].proxy', () => {
  const md = parseMihomo('dns:\n  nameserver-policy:\n    "rule-set:nope": 1.1.1.1\nproxies:\n  - name: s\n    type: direct\n    dialer-proxy: ghost\nlisteners:\n  - {name: l, type: mixed, port: 1, rule: nosub}\ntunnels:\n  - {network: [tcp], address: a, target: b, proxy: ghost}\n')
  const paths = validateMihomo(md).filter((i) => i.level === 'warning').map((i) => i.path)
  expect(paths).toEqual(expect.arrayContaining(['dns.nameserver-policy.rule-set:nope', 'proxies.0.dialer-proxy', 'listeners.0.rule', 'tunnels.0.proxy']))
})
it('ссылка на статический сервер — не предупреждение', () => {
  const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nrules:\n  - MATCH,s\n')
  expect(validateMihomo(md).filter((i) => i.path === 'rules.0')).toEqual([])
})
```

Существующие тесты про «не найдено среди групп и провайдеров» продолжают проходить: текст сообщения сохраняется у сайтов вида `proxy`/`group`; для `provider` — «Провайдер «…» не объявлен в proxy-providers», `rule-provider` — «Набор правил «…» не объявлен в rule-providers», `sub-rule` — «Ссылка на подсписок правил «…», которого нет в sub-rules».

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

В `validateMihomo`:

```ts
// Устаревшее — обходом дерева по схеме: второй список путей отставал бы от схемы
walkSchema(MIHOMO_SCHEMA, md.json, (path, fields, value) => {
  for (const d of deprecatedAt(fields, value)) {
    const at = [...path, d.key] as PathParts
    const what = d.value === undefined ? `Ключ «${d.key}»` : `Значение «${d.value}» у ${d.key}`
    issues.push(issue(at, `Устарело с ${d.deprecation.since}: ${what} — ${d.deprecation.replacement}`, 'warning'))
  }
})

// Ссылки в пустоту — по единому перечню мест ссылок
const declared = { group: new Set(namesOf(md, 'group')), proxy: new Set(namesOf(md, 'proxy')), provider: new Set(namesOf(md, 'provider')), 'rule-provider': new Set(namesOf(md, 'rule-provider')), 'sub-rule': new Set(namesOf(md, 'sub-rule')) }
const seenSite = new Set<string>()
for (const site of referenceSites(md)) {
  const key = `${site.path.join('.')}|${site.kind}|${site.name}`
  if (seenSite.has(key)) continue
  seenSite.add(key)
  const known = site.kind === 'group' || site.kind === 'proxy'
    ? declared.group.has(site.name) || declared.proxy.has(site.name) || (BUILTIN_TARGETS as readonly string[]).includes(site.name)
    : declared[site.kind].has(site.name)
  if (known) continue
  issues.push(issue(site.path, UNKNOWN_TEXT[site.kind](site.name), 'warning'))
}
```

где `UNKNOWN_TEXT`: `group`/`proxy` → `«${n}» не найдено среди групп и серверов — если это не имя хоста от панели, ссылка не разрешится`; `provider` → `Провайдер «${n}» не объявлен в proxy-providers`; `rule-provider` → `Набор правил «${n}» не объявлен в rule-providers`; `sub-rule` → `Ссылка на подсписок правил «${n}», которого нет в sub-rules`. Из `checkRuleList` убрать проверки `RULE-SET`, `SUB-RULE` и `resolveTarget`; из цикла групп — проверку `group.proxies` по `resolveTarget`. Правило с `SUB-RULE` по-прежнему выходит из `checkRuleList` без проверки цели как группы. Тест «Правило задано алиасом» — остаётся.

- [ ] **Step 4: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-validate.test.ts test/mihomo-draft.test.tsx test/mihomo-trace-acceptance.test.ts && npm run typecheck`
Expected: PASS; на фикстурах `roscomvpn`/`bundle`/`simple` число предупреждений не выросло, кроме устаревшего `enable-process` (bundle, simple) — зафиксировать в тесте фикстур явно.

- [ ] **Step 5: Мутация**

Убрать `walkSchema` → красным «устаревшие ключи…». Восстановить.

- [ ] **Step 6: Отчёт**

Коммит: `feat(frontend): mihomo validation reports deprecated keys by schema and dangling names by the reference registry`.
## Часть D. Рецепты, страница, чистка, e2e, документация

### Task 17: Чистка: старый словарь, формы секций, мёртвые сплайсы и временные обёртки хука

**Files:**
- Delete: `frontend/src/entities/mihomo/docSchema.ts`, `frontend/src/features/inspector/MihomoFieldsForm.tsx`, `frontend/src/features/editor/MihomoSectionsDialog.tsx`, `frontend/test/mihomo-doc-schema.test.ts`, `frontend/test/mihomo-sections-dialog.test.tsx`, `frontend/test/mihomo-edits-fields.test.ts`
- Modify: `frontend/src/entities/mihomo/edits.ts` (удалить `setGroupField`, `setListAt`, `renameGroup`, `setRuleTarget`, `removeRule`, `addRule`, `addGroup`, `removeGroup`, `moveMihomoRule`, `replaceRuleText`, `fieldOrigin`, `lastScalarPair`, `nullValueEnd`, `indentAt` — если больше не нужны сплайсу `setFieldAt`/`removeFieldAt`; оставить `TextEdit`, `applyEdits`, `scalar`, `detectIndentStep`, `FieldOrigin`, `isFlowNode` (если читает кто-то ещё — иначе удалить), `newlineOf`, `afterBlock`, `originAt`, `setFieldAt` (только ветка существующего ключа), `removeFieldAt`, `readFieldAt`), `frontend/src/entities/mihomo/index.ts`, `frontend/src/features/editor/useMihomoDraft.ts` (удалить обёртки `@deprecated`), `frontend/test/mihomo-edits.test.ts` (оставить тесты живых функций; CRLF-блок переписать под `applyMihomoOps`)

Порядок: сначала `grep -rn "setGroupField\|setListAt\|renameGroup\|setRuleTarget\|removeRule\|addRule\|addGroup\|removeGroup\|moveMihomoRule\|replaceRuleText\|fieldOrigin\|MihomoFieldsForm\|MihomoSectionsDialog\|MIHOMO_SECTIONS\|fieldsOf\|sectionForKey\|setField\b\|removeField\b\|originOf\|renameGroupTo\|addGroupNamed\|addRuleText\|replaceRule\|moveSelected\|removeSelected\|sectionsOpen" frontend/src` — потребителей быть не должно, кроме самих удаляемых файлов; затем удаление; `setFieldAt`: ветка «ключа нет — вставить после якорной пары» удаляется (режим модели заводит ключи), функция отказывает `[]` на отсутствующем ключе. Тесты `mihomo-edits.test.ts` про вставку нового ключа сплайсом переписать под `applyMihomoOps` (документ получает ключ режимом модели) либо удалить, если проверяли только сплайс.

- [ ] **Step 1: Удалить файлы и функции, прогнать всё**

Run: `cd frontend && npm run typecheck && npx vitest run`
Expected: typecheck чистый, vitest зелёный; `wc -l src/entities/mihomo/edits.ts` заметно меньше 1224.

- [ ] **Step 2: Отчёт**

Коммит: `refactor(frontend): drop the flat mihomo dictionary, section dialog and dead splice writers`.

### Task 18: Рецепты Mihomo: каталог, примитивы, шесть рецептов, реестр

**Files:**
- Create: `frontend/src/entities/mihomo/recipes/apply.ts`, `catalog.ts`, `split.ts`, `ads.ts`, `dns.ts`, `local.ts`, `private.ts`, `warp.ts`, `index.ts`
- Test: `frontend/test/mihomo-recipes.test.ts`

**Interfaces:**
- Consumes: `applyMihomoOps`; `Recipe`, `RecipePlan`, `RecipeChange`, `RecipeNote`; `WARP_PEER` (`entities/xray/recipes/warp.ts`); `rulesOf`, `ruleProvidersOf`, `groupsOf`, `proxiesOf`; `valueAt`.
- Produces:

```ts
// apply.ts
export interface EnsureResult { md: MihomoDoc; status: 'add' | 'exists'; notes: RecipeNote[] }
/** Применить операции; отказ писателя — заметка плана, а не молчание */
export function applyOrNote(md: MihomoDoc, ops: DocOp[]): { md: MihomoDoc; notes: RecipeNote[] }
export function ensureScalar(md: MihomoDoc, path: SchemaPath, value: string | number | boolean): EnsureResult   // есть любое значение → exists
export function ensureListEntry(md: MihomoDoc, listPath: SchemaPath, entry: unknown, placement: 'start' | 'end' | 'before-match'): EnsureResult  // сравнение строк/объектов канонически
export function ensureMapEntry(md: MihomoDoc, mapPath: SchemaPath, name: string, value: Record<string, unknown>): EnsureResult   // есть запись с именем → exists
export function beforeFinalMatch(md: MihomoDoc): number
// catalog.ts
export interface RuleSetSource { id: string; name: string; title: string; url: string; behavior: 'domain' | 'ipcidr' }
export const RULE_SET_CATALOG: RuleSetSource[]
export function sourceById(id: string): RuleSetSource | undefined
// index.ts
export const MIHOMO_RECIPES: Recipe<MihomoDoc, any>[]
```

Каталог — `.mrs` из `MetaCubeX/meta-rules-dat`, ветка `meta`: `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/<name>.mrs` и `…/geo/geoip/<name>.mrs`. Все 14 ссылок проверены 2026-09-09 (`curl -sI`, ответ 200): geosite `category-ads-all`, `private`, `category-ru`, `youtube`, `telegram`, `discord`, `whatsapp`, `tiktok`, `netflix`, `openai`, `google`; geoip `private`, `ru`, `telegram`. Имена записей — как у каталога sing-box (`geosite-category-ads-all`, `geoip-private`, …), чтобы один и тот же набор в двух шаблонах назывался одинаково.

Рецепты (`plan(md, params)`):

| id | params / defaults | что делает |
|---|---|---|
| `split` | `{ sets: string[] = ['geosite-youtube'], target: string = '' }` | для каждого набора `ensureMapEntry(['rule-providers'], name, { type: 'http', behavior, format: 'mrs', url, interval: 86400 })`; правило `RULE-SET,<name>,<target>` (+`,no-resolve` у ipcidr) `ensureListEntry(['rules'], raw, 'before-match')` по каждому набору; `validate`: наборы непусты, цель непуста |
| `ads` | `{}` | набор `geosite-category-ads-all`; правило `RULE-SET,geosite-category-ads-all,REJECT` в начало (`'start'`); заметка: «Реклама режется на маршруте; DNS-блокировка — nameserver-policy с rcode://success, если нужно» |
| `dns` | `{ remote: string = 'https://1.1.1.1/dns-query', local: string = '1.1.1.1', fakeIp: boolean = true }` | `ensureScalar(['dns','enable'], true)`; при `fakeIp` — `enhanced-mode: fake-ip`, `fake-ip-range: 198.18.0.1/16`; `ensureListEntry(['dns','default-nameserver'], local, 'end')`, `ensureListEntry(['dns','nameserver'], remote, 'end')`; `ensureListEntry(['dns','fake-ip-filter'], …, 'end')` для `*.lan`, `+.local`, `localhost` и, если в `rule-providers` есть `geosite-private`, для `rule-set:geosite-private`; `ensureScalar(['profile','store-fake-ip'], true)`; заданные значения не перезаписываются — `exists` |
| `local` | `{ port: number = 7890, allowLan: boolean = false }` | `ensureScalar(['mixed-port'], port)`; при `allowLan` — `ensureScalar(['allow-lan'], true)` |
| `private` | `{}` | `ensureMapEntry(['rule-providers'], 'geoip-private', { type: 'inline', behavior: 'ipcidr', payload: [16 подсетей стартера панели: 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4, 255.255.255.255/32] })`; правило `RULE-SET,geoip-private,DIRECT,no-resolve` в начало |
| `warp` | `{ name: string = 'WARP', privateKey: string = '', addresses: string[] = ['172.16.0.2/32'], reserved: number[] = [], mtu: number = 1280, group: boolean = false }` | запись `proxies[]`: `{ name, type: 'wireguard', server: host(WARP_PEER.endpoint), port, ip: addresses[0] без /32, ipv6: adresses[1] без маски (если есть), private-key, public-key: WARP_PEER.publicKey, reserved (если непуст), udp: true, mtu }` — `ensureListEntry(['proxies'], entry, 'start')` по имени (сравнение объектов по `name`); при `group` — `ensureListEntry(['proxy-groups'], { name: 'WARP', type: 'select', proxies: [name] }, 'end')` по имени; `validate`: имя и ключ непусты |

Сравнение записей в `ensureListEntry`: объект с `name` — по имени; строка — дословно; прочее — канонический JSON (та же `canonical`, что у sing-box `apply.ts`, скопировать функцию — общего модуля между ядрами для неё нет, три строки).

- [ ] **Step 1: Тесты**

`frontend/test/mihomo-recipes.test.ts`: для каждого рецепта — план на пустом документе (`parseMihomo('')`) и на стартере панели (`mihomoFixture('default')`): `changes` со статусами `add`; повторное применение к `plan.model` даёт все `exists` и тот же текст; `split`: правило встаёт перед `MATCH` у `default`; `ads`/`private`: правило первым; `dns` на `default` (где `dns.enable` уже есть) отвечает `exists` на `enable`; `warp`: сервер первым в `proxies`, `group: true` заводит группу; отказ писателя (алиас на `rules: *r`) → заметка с текстом замка, `changes` без `add`; каталог: все `url` начинаются с `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/` и кончаются `.mrs`, `id` уникальны.

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-recipes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`apply.ts`:

```ts
import type { DocOp, SchemaPath } from '../../../shared/schema'
import { valueAt } from '../../../shared/schema'
import type { RecipeNote } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { rulesOf } from '../rules'
import { applyMihomoOps } from '../write'

export interface EnsureResult { md: MihomoDoc; status: 'add' | 'exists'; notes: RecipeNote[] }

export function applyOrNote(md: MihomoDoc, ops: DocOp[]): { md: MihomoDoc; notes: RecipeNote[] } {
  const res = applyMihomoOps(md, ops)
  return { md: res.md, notes: res.refused.map((r) => ({ text: `Правка ${r.op.path.join('.')} не применена: ${r.reason}` })) }
}

function canonical(value: unknown): string { /* как в entities/singbox/recipes/apply.ts */ }

function sameEntry(a: unknown, b: unknown): boolean {
  const an = (a as { name?: unknown } | null)?.name
  const bn = (b as { name?: unknown } | null)?.name
  if (typeof an === 'string' && typeof bn === 'string') return an === bn
  return canonical(a) === canonical(b)
}

export function beforeFinalMatch(md: MihomoDoc): number {
  const rules = rulesOf(md)
  const last = rules[rules.length - 1]
  return last?.rule?.type === 'MATCH' ? last.index : rules.length
}

export function ensureListEntry(md: MihomoDoc, listPath: SchemaPath, entry: unknown, placement: 'start' | 'end' | 'before-match'): EnsureResult {
  const raw = valueAt(md.json, listPath)
  const list = Array.isArray(raw) ? raw : []
  if (list.some((item) => sameEntry(item, entry))) return { md, status: 'exists', notes: [] }
  const index = placement === 'start' ? 0 : placement === 'end' ? list.length : beforeFinalMatch(md)
  const res = applyOrNote(md, [{ op: 'insert', path: listPath, index, value: entry }])
  return { md: res.md, status: res.notes.length > 0 ? 'exists' : 'add', notes: res.notes }
}

export function ensureMapEntry(md: MihomoDoc, mapPath: SchemaPath, name: string, value: Record<string, unknown>): EnsureResult {
  const raw = valueAt(md.json, mapPath)
  if (typeof raw === 'object' && raw !== null && name in (raw as object)) return { md, status: 'exists', notes: [] }
  const res = applyOrNote(md, [{ op: 'set', path: [...mapPath, name], value }])
  return { md: res.md, status: res.notes.length > 0 ? 'exists' : 'add', notes: res.notes }
}

export function ensureScalar(md: MihomoDoc, path: SchemaPath, value: string | number | boolean): EnsureResult {
  if (valueAt(md.json, path) !== undefined) return { md, status: 'exists', notes: [] }
  const res = applyOrNote(md, [{ op: 'set', path, value }])
  return { md: res.md, status: res.notes.length > 0 ? 'exists' : 'add', notes: res.notes }
}
```

`index.ts` собирает `MIHOMO_RECIPES` в порядке `split, ads, dns, local, private, warp` с `title`/`summary` по образцу `entities/singbox/recipes/index.ts`: «Разделить трафик по наборам правил», «Блокировка рекламы», «DNS с fake-ip», «Локальный вход», «Локальные сети напрямую», «WARP-сервер».

- [ ] **Step 4: Прогнать тест и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-recipes.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Мутация**

В `ensureListEntry` убрать проверку `sameEntry` → красным «повторное применение даёт exists». Восстановить.

- [ ] **Step 6: Отчёт**

Коммит: `feat(frontend): six mihomo recipes over the document writer with a verified rule-set catalog`.

### Task 19: Страница редактора: панель «Документ» вместо диалога секций, рецепты, пустой документ

**Files:**
- Create: `frontend/src/features/recipes/mihomoRecipes.tsx`
- Modify: `frontend/src/features/templates/MihomoEditorPage.tsx`
- Test: `frontend/test/mihomo-recipes-dialog.test.tsx`, `frontend/test/mihomo-editor-page.test.tsx`

**Interfaces:**
- Consumes: `RecipesDialog<MihomoDoc>`, `RecipeEntry`; `MIHOMO_RECIPES`, `RULE_SET_CATALOG`, типы параметров; `mihomoRefs`; `useWarpAccount`; `MihomoDraft.recipesOpen/setRecipesOpen`, `writeDraft`.
- Produces: `export const MIHOMO_RECIPE_ENTRIES: RecipeEntry<MihomoDoc, any>[]`; страница: кнопка топбара «Рецепты» (`draft.setRecipesOpen(true)`), `RecipesDialog` с `model={md}`, `print={(m) => m.text}`, `onApply={(m) => { draft.writeDraft(m.text, { history: true }); draft.setRecipesOpen(false) }}`, `onOpenGeo` не передаётся; кнопка «Секции документа» и `MihomoSectionsDialog` удалены; ветка `md === undefined` с `EmptyState` удалена (модель есть всегда), холст рисуется и на пустом документе.

Формы рецептов — по образцу `singboxRecipes.tsx`: `split` — `MultiSelectField` по `RULE_SET_CATALOG` и `SelectField` цели по `mihomoRefs(model)['proxy-target']`; `ads` — без полей (`Form: () => null`); `dns` — `remote`, `local`, `CheckboxField fakeIp`; `local` — `NumberField port`, `CheckboxField allowLan`; `private` — без полей; `warp` — `name`, `privateKey` с кнопкой «Получить ключи» (`useWarpAccount`, как у sing-box: `privateKey`, `addresses`, `reserved` из ответа), `addresses` `StringListField`, `mtu`, `CheckboxField group`.

- [ ] **Step 1: Тесты**

`mihomo-recipes-dialog.test.tsx`: диалог с `MIHOMO_RECIPE_ENTRIES` на `parseMihomo(mihomoFixture('default'))` показывает шесть рецептов; выбор «Блокировка рекламы» даёт предпросмотр с `add` записями; «Применить» зовёт `onApply` с моделью, чей `text` содержит `RULE-SET,geosite-category-ads-all,REJECT`; `split` без цели показывает ошибку валидации «Укажите цель».

`mihomo-editor-page.test.tsx`: кнопки «Секции документа» нет, «Рецепты» есть и открывает диалог; шаблон с `encodedTemplateYaml: null` показывает холст с «+ Добавить» (а не `EmptyState`); прежние проверки страницы сохраняются.

- [ ] **Step 2: Запустить — красный**

Run: `cd frontend && npx vitest run test/mihomo-recipes-dialog.test.tsx test/mihomo-editor-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Реализация** — по описанию выше; в `MihomoEditorPage` импорт `MihomoSectionsDialog` и обращения к `draft.sectionsOpen`/`setSectionsOpen` убрать (сама обёртка в хуке живёт до задачи 17, она удалит её вместе с последним потребителем — этим файлом); `canvas` строится всегда: `md` берётся как `draft.md!`? Нет — `DocumentDraft.model` типизирован `T | undefined`; адаптер отдаёт модель всегда, поэтому в странице `const md = draft.md ?? parseMihomo('')` с комментарием, что ветка для типов.

- [ ] **Step 4: Прогнать тесты и typecheck**

Run: `cd frontend && npx vitest run test/mihomo-recipes-dialog.test.tsx test/mihomo-editor-page.test.tsx test/recipes-dialog.test.tsx test/singbox-recipes-dialog.test.tsx && npm run typecheck`
Expected: PASS; тесты диалога Xray и sing-box не менялись.

- [ ] **Step 5: Мутация**

В `onApply` не звать `writeDraft` → красным тест страницы (добавить проверку: после «Применить» текст черновика содержит правило). Восстановить.

- [ ] **Step 6: Отчёт**

Коммит: `feat(frontend): mihomo editor page gets recipes and the document panel; empty templates open on the canvas`.

### Task 20: E2E: шаблон Mihomo с нуля кнопками; правка группы остаётся сплайсом

**Files:**
- Modify: `frontend/e2e/mocks.ts` (`mockMihomo(page, { core?, template? })`), `frontend/e2e/mihomo.spec.ts`

- [ ] **Step 1: Мок**

`mockMihomo(page, opts: { core?: …; template?: string | null } = {})`: при `template !== undefined` ответ `/api/templates/<uuid>` — `{ template: { ...MIHOMO_TEMPLATE, encodedTemplateYaml: template === null ? null : b64(template) }, hash: MIHOMO_HASH }`.

- [ ] **Step 2: Сценарий**

```ts
test.describe('с нуля', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await mockMihomo(page, { template: null })
    await page.goto(`/templates/${MIHOMO_UUID}`)
    await expect(page.getByRole('button', { name: '+ Добавить' })).toBeVisible()
  })

  test('шаблон собирается кнопками и формами, вкладка YAML не открывается', async ({ page }) => {
    const patches: string[] = []
    await page.route('**/api/templates/*', async (route) => {
      if (route.request().method() === 'PATCH') patches.push(route.request().postData() ?? '')
      await route.fallback()
    })
    const inspector = page.locator('aside.wb-inspector')
    const add = async (item: string) => {
      await page.getByRole('button', { name: '+ Добавить' }).click()
      await page.getByRole('menuitem', { name: item }).click()
    }

    await add('Группа')
    await expect(inspector.getByLabel('Имя')).toHaveValue('Группа')
    await add('Сервер')
    await expect(page.locator(node('proxy:Сервер'))).toBeVisible()
    await add('Провайдер')
    await expect(page.locator(node('provider:provider'))).toBeVisible()
    await add('Набор правил')
    await expect(inspector.getByRole('region', { name: 'Наборы правил' })).toBeVisible()
    await add('Подсписок')
    await expect(page.locator(node('subrule:sub-rule'))).toBeVisible()
    await add('Вход')

    await page.getByRole('button', { name: '+ Правило' }).click()
    await expect(inspector.getByLabel('Тип')).toBeVisible()
    await pickOption(page, inspector.getByLabel('Тип'), 'DOMAIN-SUFFIX')
    await inspector.getByLabel('Значение').fill('example.com')

    await page.getByRole('button', { name: 'Документ' }).click()
    await inspector.getByRole('button', { name: 'DNS' }).click()
    await inspector.getByRole('region', { name: 'DNS' }).getByRole('button', { name: 'Завести раздел' }).click()

    await page.getByRole('button', { name: 'Рецепты' }).click()
    await page.getByRole('dialog').getByText('Локальные сети напрямую').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Применить' }).click()

    await page.getByRole('button', { name: 'Сохранить в панель' }).click()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect.poll(() => patches.length).toBe(1)
    const yaml = Buffer.from(JSON.parse(patches[0]!).encodedTemplateYaml, 'base64').toString('utf8')
    expect(yaml).toContain('- name: Группа')
    expect(yaml).toContain('- name: Сервер')
    expect(yaml).toContain('provider:')
    expect(yaml).toContain('ruleset:')
    expect(yaml).toContain('sub-rule:')
    expect(yaml).toContain('- name: вход')
    expect(yaml).toContain('DOMAIN-SUFFIX,example.com,DIRECT')
    expect(yaml).toContain('enhanced-mode: fake-ip')
    expect(yaml).toContain('RULE-SET,geoip-private,DIRECT,no-resolve')
  })
})
```

Порядок правил: «+ Правило» на пустом документе завёл `MATCH,DIRECT` (`nextRulePlacement` без правил), затем форма сменила тип на `DOMAIN-SUFFIX` и значение — ожидание `DOMAIN-SUFFIX,example.com,DIRECT` верно.

Существующий тест «правка группы правит документ точечно и не трогает маркер» остаётся: правка `filter` у группы — НОВЫЙ ключ, то есть режим модели; строка `# LEAVE THIS LINE!` и якоря переживают перепечатку, но число строк и позиции могут сдвинуться (пустые строки между разделами сохраняются `yaml`). Переписать ожидания: `filter: RU` присутствует; `# LEAVE THIS LINE!` присутствует; правка СУЩЕСТВУЮЩЕГО скаляра (второй шаг теста: `log-level` → `debug` через панель «Документ») меняет ровно одну строку — это и есть проверка сплайса через интерфейс. Заголовок теста: «правка формы: новый ключ перепечатывает документ без потерь, существующий — точечно».

- [ ] **Step 3: Прогнать e2e Mihomo и всю пачку**

Run: `cd frontend && npx playwright test e2e/mihomo.spec.ts && npm run e2e`
Expected: PASS.

- [ ] **Step 4: Отчёт**

Коммит: `test(frontend): e2e builds a mihomo template from scratch without the YAML tab`.

### Task 21: Документация

**Files:**
- Modify: `CLAUDE.md` (разделы про Mihomo: «текст владеет файлом», сплайсы, маркер, `MihomoSectionsDialog`, `docSchema.ts` питает формы и подсказки, `LOCK_NOTE`, «отказ вместо порчи», «разрыв по одному ребру»), `README.md` (счётчики тестов, бейдж; e2e-файлы), `docs/superpowers/specs/2026-09-09-schema-forms-mihomo-design.md` (статус «выполнен планом …», раздел «Расхождения со спекой» с находками исполнения)

- [ ] **Step 1: `CLAUDE.md`**

Переписать абзацы:
- «Шаблоны Mihomo … текст владеет файлом»: два режима писателя (`entities/mihomo/write.ts`), инвариант сплайса и инвариант перепечатки; `doc.toString()` разрешён только там; `json` — снимок значений.
- «Отказ вместо порчи»: замки `alias`/`merged` и действие «Развернуть значение здесь»; flow больше не запирает; `refused`.
- Маркер: панель не читает; узлы по `panelInjectsHosts`/`groupTakesHosts`; бэкенд `dummyProxies` — то же правило.
- Словарь: `entities/mihomo/schema/*` на общем формате питает формы (`MihomoNamedForm`, панель `MihomoDocPanel`), подсказки и валидацию; `docSchema.ts` удалён.
- Инспектор: виды узлов, `proxy:<имя>`, порядок/удаление, `doc:settings`; меню «+ Добавить»; «+ Правило» по месту; разрыв нескольких рёбер.
- Ссылки: `referenceSites`/`renameAt` — один перечень для валидации и переименования.
- Рецепты Mihomo: каталог `.mrs`, `applyOrNote`.
- Общий слой: `DocPanel`, `Lock.action`, `map` со `strings`, элемент `port`, строители в `shared/schema/build.ts`.

- [ ] **Step 2: README и спека**

README: бейдж и счётчики по факту (`npx vitest run` обоих workspace, число e2e-файлов `ls frontend/e2e/*.spec.ts | wc -l`). Спека: статус, «расхождения со спекой» — всё, что контроллер записал в леджер как ruling с отклонением от текста спеки.

- [ ] **Step 3: Отчёт**

Коммит: `docs: mihomo editor on the shared schema forms and the two-mode writer`.

## Самопроверка плана

1. **Покрытие спеки.** Общий слой (`Lock.action`, `DocSection map`, `values`, `port`, `RefKind`, `DocPanel`) — задачи 1–2. Схема по таблице охвата — 3–5; `hosts` и `tls` полями корня — 3, 5. Писатель, два режима, CRLF, `refused`, замки, материализация — 6; `renameKeyAt` — 6. Переименование с переносом ссылок и единый перечень — 7, 16. Маркер декоративен, `hosts:root` всегда, бэкенд — 8. Граф: `proxy:<имя>`, коммутация, разрыв нескольких рёбер — 9, 10, 14. Хук-писатель — 10. Формы по таблице — 11–12; порядок и удаление у любого узла в списке — 13. Панель «Документ» с разделами по таблице — 5, 13. Меню «+ Добавить» и «+ Правило» по месту — 14. Валидация устаревшего и ссылок — 16. Подсказки по схеме — 15. Рецепты — 18–19. E2E «с нуля» — 20. Документация — 21. Диалог «Секции документа» удалён — 17, 19. Вне охвата (CLASH/STASH, конструктор логики, `override-expr`, автоматическая материализация) — задач нет намеренно.
2. **Заглушек нет:** каждая задача несёт код и тесты; «по образцу файла X» указано только там, где файл X существует в репозитории и назван путём.
3. **Согласованность имён:** `applyMihomoOps`/`mihomoLockAt`/`materializeAt`/`renameKeyAt` (6) → 7, 9, 10, 18; `referenceSites`/`referencesTo`/`renameAt`/`namesOf`/`NamedKind` (7) → 10, 16; `proxiesOf`/`groupTakesHosts`/`panelInjectsHosts`/`groupGetsHosts` (8) → 9, 13, 16; `MIHOMO_SCHEMA`/`mihomoFieldsAt`/`mihomoFieldAt`/`mihomoRefs`/`MIHOMO_DOC_SECTIONS` (5) → 11–16, 18–19; `DocPanel`/`DocListSpec`/`DocMapSpec`/`DocRefs` (2) → 13; `MihomoEntryFormProps`/формы (11–12) → 13; стартеры (10) → 13, 14; `MihomoDraft` (10) → 13, 14, 19; `MIHOMO_RECIPES` (18) → 19. `md.json` (6) читают 5, 7, 11–16, 18.

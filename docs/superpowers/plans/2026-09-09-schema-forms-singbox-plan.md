# Схема форм и полный редактор sing-box — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Общий слой схемы и форм на три ядра и собранный на нём редактор sing-box, в котором шаблон собирается с нуля кнопками и формами, ни разу не открывая вкладку JSON.

**Architecture:** Словарь становится деревом `FieldSchema` в `shared/schema` с условными ключами, вложенными объектами и списками; один рекурсивный рендерер `SchemaForm` рисует любую ветвь и эмитит операции по пути в `DocWriter`, которые модельные ядра применяют к копии объекта. Sing-box получает полную схему ядра 1.13/1.14 по ветвям, формы на `SchemaForm` с ручными главными полями, панель «Документ» псевдоузлом, меню «+ Добавить», порядок у всех списков, валидацию устаревшего и ссылок, подсказки по `schemaAt` и шесть рецептов на обобщённом движке.

**Tech Stack:** React 19, TypeScript, Vite, vitest + jsdom + @testing-library, Playwright, CodeMirror 6 (`@codemirror/lang-json`), `zod` (разбор), существующий UI-кит `shared/ui`.

**Spec:** `docs/superpowers/specs/2026-09-09-schema-forms-singbox-full-ui-design.md`

## Global Constraints

- Язык UI, сообщений об ошибках, комментариев в коде и документации — русский; коммиты — английский conventional style (`feat(frontend): …`, `fix(frontend): …`, `docs: …`).
- Комментарий в коде объясняет ПОЧЕМУ, а не что; стиль соседних файлов обязателен.
- Формы и мутации sing-box работают ПО МОДЕЛИ (копия, правка копии, запись); `doc.toString()` во фронтенде по-прежнему не используется (запрет снят только для Mihomo и только со второй части).
- Схема разбора сквозная: незнакомый ключ доезжает до текста нетронутым и НЕ порождает диагностику. Ключ, которого нет в схеме, но есть в документе, ВСЕГДА виден в форме на чтение (решение владельца № 6).
- Панель нацелена на sing-box 1.13.x; удалённые типы и ключи документ не теряет: форма показывает их с подсказкой замены, валидация — предупреждением.
- Тесты Xray-профиля и Mihomo — контрольная группа: ни один их файл не меняется (в задаче 6 обобщение движка рецептов обязано оставить их зелёными без правок). `CheckboxField` и формы Xray не трогаются.
- Мутационная приёмка каждого значимого изменения: сломать → красный именованный тест → восстановить обратной правкой (не `git checkout --`) → зелёный; мутация никогда не замена на пустую строку.
- Три тестовых контура фронтенда не пересекаются: vitest берёт `test/**/*.test.{ts,tsx}`, Playwright — `e2e/*.spec.ts`, `tsc --noEmit` не проверяет `e2e`.
- Фикстуры фронтенда читаются через Vite `?raw` (`singboxFixture` в `test/helpers.ts`); Node-типов в `frontend/tsconfig.json` нет.
- Файлы репозитория в рабочей копии могут быть CRLF; правки — инструментом Edit.
- Каталог источников наборов правил — статический список в коде; бэкенд ссылки не скачивает, они уходят в документ пользователя.

## Что уже есть и на что план опирается

| Готовое | Где | Как используется |
|---|---|---|
| Примитивы полей `Field`, `TextField`, `NumberField`, `SelectField`, `StringListField`, `CheckboxField`, `MultiSelectField` | `frontend/src/features/inspector/fields.tsx` | `SchemaForm` собирается из них; `NumberField` расширяется, `TriStateField` добавляется рядом |
| `KeyValueField`, `ListEditor` | `frontend/src/features/inspector/collections.tsx` | карта строк для `kind: 'map'`; `ListEditor` получает перестановку |
| `Select` с портальным списком и `computePosition` | `frontend/src/shared/ui/Select.tsx` | `MenuButton` переиспользует `computePosition` и классы `.select-pop`/`.select-option` |
| `CollapsibleSection` | `frontend/src/shared/ui/CollapsibleSection.tsx` | вложенные объекты и «Ещё поля (N)» |
| `SingboxExtraFields` | `frontend/src/features/inspector/SingboxExtraFields.tsx` | образец поведения «заполненные сверху, остальное под сворачиваемым блоком»; удаляется в задаче 21 |
| Плоский словарь `SINGBOX_SECTIONS` и `docPath.ts` | `frontend/src/entities/singbox/docSchema.ts`, `docPath.ts` | русские описания ключей переезжают в новую схему; оба файла удаляются в задаче 21 |
| Мутации графа `connectSingbox`, `disconnectSingbox`, `addRule`, `moveRule`, `removeAt`, `outboundByTag`, `withOutboundAt`, `outboundSlotOf` | `frontend/src/entities/graph/singbox/mutations.ts` | остаются; рядом появляются `insertAt`, `moveAt`, `removeAtPath`, `uniqueTag` |
| `useDocumentDraft`/`useSingboxDraft` с `changeDoc` | `frontend/src/features/editor/useSingboxDraft.ts` | хук становится `DocWriter` |
| Инспектор с псевдоузлами `doc:rule-sets`, `doc:dns-servers` и `DocList` | `frontend/src/features/topology/SingboxInspector.tsx` | псевдоузлы уходят в панель «Документ» (`doc:settings`) |
| Реестр рецептов Xray и `RecipesDialog` | `frontend/src/entities/xray/recipes/*`, `frontend/src/features/recipes/RecipesDialog.tsx` | диалог становится обобщённым, реестр Xray — первым экземпляром |
| Хук `useWarpAccount` | `frontend/src/shared/api/hooks.ts` | рецепт «WARP-эндпоинт» |
| Тест-помощники `selectOption`, `optionLabels`, `selectedValue`, `singboxFixture` | `frontend/test/helpers.ts` | все компонентные тесты плана |
| Моки e2e `mockApi`, `mockSingbox`, `SINGBOX_JSON` | `frontend/e2e/mocks.ts` | сценарий «с нуля» получает свой документ |

## Структура файлов

**Создаются**

| Файл | Ответственность |
|---|---|
| `frontend/src/shared/schema/types.ts` | типы схемы: `FieldSchema`, `FieldKind`, `EnumValue`, `Condition`, `RefKind`, `ListItemSchema`, `Deprecation`, `DocSection`, `SchemaPath` |
| `frontend/src/shared/schema/resolve.ts` | чистые функции по схеме: `conditionHolds`, `visibleFields`, `valueAt`, `fieldsAt`, `fieldAt`, `unknownKeys`, `deprecatedAt` |
| `frontend/src/shared/schema/ops.ts` | `DocOp`, `Lock`, `DocWriter`, `applyOps` |
| `frontend/src/shared/schema/index.ts` | реэкспорт |
| `frontend/src/shared/ui/MenuButton.tsx` | кнопка-меню с портальным списком действий |
| `frontend/src/features/inspector/schema/SchemaForm.tsx` | рекурсивный рендерер формы по схеме |
| `frontend/src/features/inspector/schema/labels.ts` | подписи и тексты рендерера: заметки об устаревшем, неизвестном ключе, замке |
| `frontend/src/shared/recipes/types.ts` | обобщённые `Recipe`, `RecipePlan`, `RecipeChange`, `RecipeNote` |
| `frontend/src/features/recipes/xrayRecipes.tsx` | шесть рецептов Xray как записи обобщённого диалога |
| `frontend/src/entities/singbox/schema/shared.ts` | строители полей и общие фрагменты: dial, listen, tls, transport, multiplex, udp_over_tcp, domain_resolver, перечисления |
| `frontend/src/entities/singbox/schema/outbounds.ts` | поля выходов всех типов и групп |
| `frontend/src/entities/singbox/schema/endpoints.ts` | поля конечных точек wireguard/tailscale |
| `frontend/src/entities/singbox/schema/inbounds.ts` | поля входов |
| `frontend/src/entities/singbox/schema/dns.ts` | корень `dns`, серверы всех типов, DNS-правила с действиями |
| `frontend/src/entities/singbox/schema/route.ts` | корень `route`, правила маршрута с действиями, наборы правил и headless-правила |
| `frontend/src/entities/singbox/schema/misc.ts` | `log`, `ntp`, `certificate`, `experimental` |
| `frontend/src/entities/singbox/schema/index.ts` | `SINGBOX_SCHEMA`, `singboxFieldsAt`, `singboxFieldAt`, `singboxRefs`, `SINGBOX_DOC_SECTIONS`, `enumValuesOf` |
| `frontend/src/entities/singbox/starters.ts` | стартеры записей для меню «+ Добавить» и разделов панели «Документ» |
| `frontend/src/entities/singbox/recipes/*.ts` | движок рецептов sing-box: примитивы `ensure*`, каталог наборов, шесть рецептов, реестр |
| `frontend/src/features/inspector/SingboxDnsRuleForm.tsx` | форма DNS-правила |
| `frontend/src/features/topology/SingboxDocPanel.tsx` | панель «Документ»: разделы, заведение раздела, списки |
| `frontend/src/features/recipes/singboxRecipes.tsx` | формы параметров рецептов sing-box и реестр записей диалога |
| `frontend/test/schemaHelpers.ts` | `makeWriter()` для тестов форм |
| тесты `frontend/test/schema-*.test.*`, `singbox-schema-*.test.ts`, `singbox-doc-panel.test.tsx`, `singbox-recipes.test.ts`, `menu-button.test.tsx`, `recipes-generic.test.tsx` | по задачам |

**Меняются**

| Файл | Что меняется |
|---|---|
| `frontend/src/features/inspector/fields.tsx` | `NumberField` получает `hint`, `integer`, `min`; добавляется `TriStateField` |
| `frontend/src/features/inspector/collections.tsx` | `ListEditor` получает `reorder` |
| `frontend/src/shared/ui/index.ts` | экспорт `MenuButton` |
| `frontend/src/shared/ui/tokens.css` | стили `.menu-item`, `.tristate`, `.list-editor-order` |
| `frontend/src/features/recipes/RecipesDialog.tsx` | обобщается по модели |
| `frontend/src/features/editor/EditorPage.tsx` | передаёт `XRAY_RECIPES` |
| `frontend/src/entities/singbox/index.ts` | реэкспорт схемы и стартеров, позже удаление старых реэкспортов |
| `frontend/src/entities/singbox/validate.ts` | предупреждения по `deprecatedAt`, проверки ссылок DNS |
| `frontend/src/entities/graph/singbox/mutations.ts` | `insertAt`, `moveAt`, `removeAtPath`, `uniqueTag` |
| `frontend/src/entities/graph/singbox/locate.ts` | пути панели «Документ» ведут в `doc:settings` |
| `frontend/src/features/editor/useSingboxDraft.ts` | `applyOps`, `lockAt`, `writer`, `recipesOpen` |
| `frontend/src/features/editor/singboxIntellisense/{context,complete,hover}.ts` | поля по `singboxFieldsAt` |
| `frontend/src/features/inspector/Singbox{Outbound,Inbound,Rule,RuleSet,DnsServer}Form.tsx` | на `SchemaForm`, контракт `path` + `writer` |
| `frontend/src/features/topology/SingboxInspector.tsx` | обёртка писателя, порядок у всех списков, `doc:settings`, удаление `DocList` |
| `frontend/src/features/topology/SingboxTopology.tsx` | меню «+ Добавить», кнопка «Документ» |
| `frontend/src/features/templates/SingboxEditorPage.tsx` | кнопка «Рецепты» и диалог |
| `frontend/e2e/mocks.ts`, `frontend/e2e/singbox.spec.ts` | документ `{}` и сценарий «с нуля» |
| `CLAUDE.md`, `README.md`, спека | документация |

**Удаляются (задача 21)**: `entities/singbox/docSchema.ts`, `entities/singbox/docPath.ts`, `features/inspector/SingboxExtraFields.tsx`, тесты `singbox-doc-schema.test.ts`, `singbox-doc-path.test.ts`.

## Волны исполнения (для контроллера)

Файловые множества внутри волны не пересекаются; агенты не коммитят и не запускают полный набор.

| Волна | Задачи | Зависимости |
|---|---|---|
| 1 | 1, 2, 3, 4, 6 | нет |
| 2 | 5, 7 | 5 ← 1, 2, 3; 7 ← 1 |
| 3 | 8, 9, 10, 11, 12, 14 | 8–12 ← 7; 14 — независима |
| 4 | 13 | ← 8–12 |
| 5 | 15, 16, 19 | ← 5, 13, 14 |
| 6 | 17, 18 | 17 ← 15, 16; 18 ← 4, 14 |
| 7 | 20, 21 | ← 17, 18, 19 |
| 8 | 22, 23 | 22 ← 6, 14, 17; 23 ← 17, 18 |
| 9 | 24 | ← всё |

Между волнами контроллер прогоняет `npm run typecheck -w frontend`, `npm test -w frontend`, коммитит path-limited и после волны 8 запускает `npm run e2e -w frontend`.

---

## Часть A. Общий слой

### Task 1: Типы схемы и разбор схемы

**Files:**
- Create: `frontend/src/shared/schema/types.ts`
- Create: `frontend/src/shared/schema/resolve.ts`
- Create: `frontend/src/shared/schema/index.ts`
- Test: `frontend/test/schema-resolve.test.ts`

**Interfaces:**
- Consumes: ничего из проекта.
- Produces: типы `SchemaPath`, `FieldKind`, `Deprecation`, `EnumValue`, `Condition`, `RefKind`, `ListItemSchema`, `FieldSchema`, `DocSection`; функции `conditionHolds(cond, value)`, `visibleFields(fields, value)`, `valueAt(doc, path)`, `fieldsAt(root, path, doc)`, `fieldAt(root, path, doc)`, `unknownKeys(fields, value)`, `deprecatedAt(fields, value)`, `isRecord(value)`.

Отклонения от спеки, принятые планом (оба аддитивные): у поля появляется вид `map` (отображение строка → строка: заголовки транспорта, `predefined` у сервера hosts, `torrc`) — без него такие ключи были бы объектом без полей и показывались бы только на чтение; у условия появляется `notIn` — dial-поля выхода нужны всем типам, КРОМЕ `selector`/`urltest`, и перечислять все остальные типы значило бы забыть новый при первом же добавлении.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/schema-resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  conditionHolds,
  deprecatedAt,
  fieldAt,
  fieldsAt,
  unknownKeys,
  valueAt,
  visibleFields,
  type FieldSchema,
} from '../src/shared/schema'

const TLS: FieldSchema = {
  key: 'tls',
  doc: 'TLS',
  kind: 'object',
  fields: [
    { key: 'enabled', doc: 'Включён', kind: 'boolean' },
    { key: 'server_name', doc: 'Имя', kind: 'string' },
  ],
}

const OUTBOUND: FieldSchema[] = [
  {
    key: 'type',
    doc: 'Тип',
    kind: 'enum',
    enum: [
      { value: 'direct' },
      { value: 'vless' },
      { value: 'block', deprecated: { since: '1.13.0', replacement: 'действие правила reject' } },
    ],
  },
  { key: 'tag', doc: 'Тег', kind: 'string' },
  { key: 'uuid', doc: 'UUID', kind: 'string', when: { key: 'type', in: ['vless'] } },
  { key: 'detour', doc: 'Через выход', kind: 'string', ref: 'outbound', when: { key: 'type', notIn: ['selector'] } },
  { ...TLS, when: { key: 'type', in: ['vless'] } },
  {
    key: 'override_port',
    doc: 'Порт',
    kind: 'number',
    deprecated: { since: '1.11.0', replacement: 'route-options.override_port' },
  },
]

const ROOT: FieldSchema[] = [
  { key: 'log', doc: 'Журнал', kind: 'object', fields: [{ key: 'level', doc: 'Уровень', kind: 'string' }] },
  { key: 'outbounds', doc: 'Выходы', kind: 'list', item: { kind: 'object', fields: OUTBOUND } },
  { key: 'tags', doc: 'Теги', kind: 'list', item: { kind: 'string' } },
]

const DOC = {
  log: { level: 'warn' },
  outbounds: [
    { type: 'vless', tag: 'a', uuid: 'u', tls: { enabled: true } },
    { type: 'selector', tag: 'g' },
  ],
  tags: ['x'],
}

describe('условия видимости', () => {
  it('in и notIn сравнивают значение соседа как строку, отсутствие — пустая строка', () => {
    expect(conditionHolds({ key: 'type', in: ['vless'] }, { type: 'vless' })).toBe(true)
    expect(conditionHolds({ key: 'type', in: ['vless'] }, { type: 'direct' })).toBe(false)
    expect(conditionHolds({ key: 'type', in: [''] }, {})).toBe(true)
    expect(conditionHolds({ key: 'type', notIn: ['selector'] }, { type: 'selector' })).toBe(false)
    expect(conditionHolds({ key: 'type', notIn: ['selector'] }, {})).toBe(true)
    expect(conditionHolds(undefined, {})).toBe(true)
    // Число тоже сравнивается строкой: у DNS-правила ip_version — число
    expect(conditionHolds({ key: 'v', in: ['4'] }, { v: 4 })).toBe(true)
  })

  it('visibleFields скрывает поле, чьё условие не выполнено, и не трогает остальные', () => {
    expect(visibleFields(OUTBOUND, { type: 'direct' }).map((f) => f.key)).toEqual([
      'type', 'tag', 'detour', 'override_port',
    ])
    expect(visibleFields(OUTBOUND, { type: 'vless' }).map((f) => f.key)).toContain('uuid')
  })
})

describe('спуск по пути', () => {
  it('valueAt читает вложенное значение и отвечает undefined мимо документа', () => {
    expect(valueAt(DOC, ['outbounds', 0, 'tag'])).toBe('a')
    expect(valueAt(DOC, ['outbounds', 5, 'tag'])).toBeUndefined()
    expect(valueAt(DOC, [])).toBe(DOC)
  })

  it('fieldsAt отдаёт поля объекта по пути с учётом условий', () => {
    expect(fieldsAt(ROOT, [], DOC)).toBe(ROOT)
    expect(fieldsAt(ROOT, ['log'], DOC)?.map((f) => f.key)).toEqual(['level'])
    expect(fieldsAt(ROOT, ['outbounds', 0], DOC)?.map((f) => f.key)).toContain('uuid')
    expect(fieldsAt(ROOT, ['outbounds', 1], DOC)?.map((f) => f.key)).not.toContain('uuid')
    expect(fieldsAt(ROOT, ['outbounds', 0, 'tls'], DOC)?.map((f) => f.key)).toEqual(['enabled', 'server_name'])
  })

  it('fieldsAt молчит там, где схема ничего не описывает', () => {
    expect(fieldsAt(ROOT, ['nope'], DOC)).toBeUndefined()
    expect(fieldsAt(ROOT, ['tags', 0], DOC)).toBeUndefined()
    expect(fieldsAt(ROOT, ['outbounds'], DOC)).toBeUndefined()
    expect(fieldsAt(ROOT, ['log', 'level', 'x'], DOC)).toBeUndefined()
  })

  it('элемент списка без объекта в документе всё равно описан: путь, а не значение, решает', () => {
    // Новая запись ещё не вставлена, а подсказке уже нужны её поля
    expect(fieldsAt(ROOT, ['outbounds', 7], DOC)?.map((f) => f.key)).toContain('tag')
  })

  it('fieldAt отдаёт поле последнего ключа; для индекса — поле списка', () => {
    expect(fieldAt(ROOT, ['outbounds', 0, 'uuid'], DOC)?.key).toBe('uuid')
    expect(fieldAt(ROOT, ['outbounds', 0], DOC)?.key).toBe('outbounds')
    expect(fieldAt(ROOT, ['outbounds', 0, 'tls', 'enabled'], DOC)?.kind).toBe('boolean')
    expect(fieldAt(ROOT, ['zzz'], DOC)).toBeUndefined()
  })
})

describe('неизвестное и устаревшее', () => {
  it('unknownKeys называет ключи документа, которых нет в схеме, включая скрытые условием — нет', () => {
    expect(unknownKeys(OUTBOUND, { type: 'direct', tag: 'd', extra: 1, uuid: 'x' })).toEqual(['extra'])
  })

  it('deprecatedAt находит устаревший ключ и устаревшее значение перечисления', () => {
    const found = deprecatedAt(OUTBOUND, { type: 'block', override_port: 1 })
    expect(found).toEqual([
      { key: 'type', value: 'block', deprecation: { since: '1.13.0', replacement: 'действие правила reject' } },
      { key: 'override_port', deprecation: { since: '1.11.0', replacement: 'route-options.override_port' } },
    ])
    expect(deprecatedAt(OUTBOUND, { type: 'direct' })).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/schema-resolve.test.ts`
Expected: FAIL — модуль `../src/shared/schema` не найден.

- [ ] **Step 3: Написать типы**

`frontend/src/shared/schema/types.ts`:

```ts
// Единая форма описания документа для трёх ядер. Дерево, а не плоские
// секции: вложенный объект описан на месте, условные ключи привязаны к
// значению соседа (протокол, тип, security), список знает свой элемент.
//
// Слой ничего не знает о ядрах: `entities/<ядро>/schema` экспортирует своё
// дерево, `features/inspector/schema` его рисует. Описание здесь — данные без
// зависимостей, и потому они годятся и подсказкам текстовой вкладки, и
// валидации, и формам одновременно.

/** Путь в документе: ключи отображений и индексы списков. Структурно совпадает с `PathParts` диагностик */
export type SchemaPath = (string | number)[]

/**
 * `map` — отображение строка → строка (заголовки транспорта, hosts). Без него
 * такие ключи были бы объектом без полей и показывались бы только на чтение.
 */
export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'list' | 'object' | 'map'

export interface Deprecation {
  /** Версия ядра, с которой ключ или значение считается устаревшим либо удалённым */
  since: string
  /** Чем заменить — по-русски, одной фразой; попадает и в подсказку формы, и в диагностику */
  replacement: string
}

export interface EnumValue {
  value: string
  doc?: string
  deprecated?: Deprecation
}

/**
 * Условие видимости по соседу в том же объекте. Значение соседа сравнивается
 * СТРОКОЙ, отсутствие — пустая строка: так `in: ['']` описывает «действие не
 * задано», а числовой `ip_version: 4` совпадает с `in: ['4']`.
 * `notIn` нужен там, где проще назвать исключения: dial-поля выхода нужны всем
 * типам, кроме групп, и список «всех остальных» устарел бы на первом новом типе.
 */
export interface Condition {
  key: string
  in?: string[]
  notIn?: string[]
}

/** Значение — тег другой записи документа: форма даёт выбор из существующих тегов */
export type RefKind = 'outbound' | 'inbound' | 'dns-server' | 'rule-set'

export interface ListItemSchema {
  kind: 'string' | 'number' | 'object'
  /** kind: object — поля элемента */
  fields?: FieldSchema[]
  /** kind: string — известные значения элемента (network: tcp/udp) */
  enum?: EnumValue[]
  /** kind: string — элемент ссылается на тег */
  ref?: RefKind
  /** Подпись элемента-объекта в списке: тег, имя или номер */
  label?: (value: unknown, index: number) => string
  /** Значение нового элемента по кнопке «Добавить» */
  starter?: () => unknown
}

export interface FieldSchema {
  key: string
  /** Русское описание: подпись формы, tooltip подсказки, текст hover */
  doc: string
  kind: FieldKind
  /** kind: enum — известные значения. Подсказка, а не ограничение: чужое значение проходит сквозь */
  enum?: EnumValue[]
  /** kind: object — вложенные поля */
  fields?: FieldSchema[]
  /** kind: list — элемент списка */
  item?: ListItemSchema
  /** Показывать, только когда условие по соседу выполнено */
  when?: Condition
  deprecated?: Deprecation
  /** Версия ядра, с которой ключ существует — только для подсказки, не для запрета */
  since?: string
  /** Значение — тег другой записи документа */
  ref?: RefKind
  /** kind: number — целое (по умолчанию да) и нижняя граница; отрицательные разрешены при min < 0 */
  integer?: boolean
  min?: number
  /** Ключ панели, а не ядра: в отданном клиенту документе его не будет */
  panelKey?: boolean
  /** Значение по умолчанию при заведении объекта */
  starter?: () => unknown
}

/** Раздел панели «Документ»: секция корня целиком либо список записей без узлов на холсте */
export interface DocSection {
  title: string
  path: SchemaPath
  /** object — форма по схеме; list — редактор списка с формой на элемент */
  kind: 'object' | 'list'
  /** Ключи секции, которые рисуются отдельными разделами или холстом и здесь не повторяются */
  skip?: string[]
}
```

- [ ] **Step 4: Написать разбор схемы**

`frontend/src/shared/schema/resolve.ts`:

```ts
// Чистые функции по схеме: где в дереве описано место документа и что там
// известно. Ни рендерера, ни ядра здесь нет — только схема и значение.

import type { Condition, Deprecation, FieldSchema, SchemaPath } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Значение соседа как строка; отсутствие и null — пустая строка */
function siblingText(value: unknown, key: string): string {
  const raw = isRecord(value) ? value[key] : undefined
  return raw === undefined || raw === null ? '' : String(raw)
}

export function conditionHolds(cond: Condition | undefined, value: unknown): boolean {
  if (cond === undefined) return true
  const current = siblingText(value, cond.key)
  if (cond.in !== undefined && !cond.in.includes(current)) return false
  if (cond.notIn !== undefined && cond.notIn.includes(current)) return false
  return true
}

/** Поля, чьё условие выполнено или отсутствует */
export function visibleFields(fields: FieldSchema[], value: unknown): FieldSchema[] {
  return fields.filter((field) => conditionHolds(field.when, value))
}

/** Значение по пути; мимо документа — undefined, пустой путь — сам документ */
export function valueAt(doc: unknown, path: SchemaPath): unknown {
  let cur: unknown = doc
  for (const step of path) {
    if (typeof step === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[step]
    } else {
      if (!isRecord(cur)) return undefined
      cur = cur[step]
    }
  }
  return cur
}

/**
 * Поля объекта по пути в документе. Индекс списка идёт следом за ключом
 * списка и не меняет описание: элемент списка — тот же вид объекта, что назвал
 * ключ. Значение по пути НУЖНО только условиям `when`: описание есть и у
 * элемента, которого в документе ещё нет, — подсказке и кнопке добавления
 * оно нужно ДО записи.
 */
export function fieldsAt(root: FieldSchema[], path: SchemaPath, doc: unknown): FieldSchema[] | undefined {
  let fields = root
  let holder: unknown = doc
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    if (typeof step !== 'string') return undefined
    const field = visibleFields(fields, holder).find((f) => f.key === step)
    if (field === undefined) return undefined
    const next = isRecord(holder) ? holder[step] : undefined
    if (field.kind === 'object') {
      fields = field.fields ?? []
      holder = next
      continue
    }
    if (field.kind === 'list') {
      const index = path[i + 1]
      // Путь кончился на самом списке: у списка полей нет, они у элемента
      if (typeof index !== 'number' || field.item?.kind !== 'object') return undefined
      fields = field.item.fields ?? []
      holder = Array.isArray(next) ? next[index] : undefined
      i += 1
      continue
    }
    return undefined
  }
  return fields
}

/**
 * Поле, описывающее значение по пути. Для индекса списка — поле самого списка:
 * у элемента отдельного описания нет, оно в `item`.
 */
export function fieldAt(root: FieldSchema[], path: SchemaPath, doc: unknown): FieldSchema | undefined {
  let end = path.length
  while (end > 0 && typeof path[end - 1] === 'number') end -= 1
  if (end === 0) return undefined
  const parent = fieldsAt(root, path.slice(0, end - 1), doc)
  const key = path[end - 1]
  return parent?.find((f) => f.key === key)
}

/** Ключи документа, которых нет среди полей (видимых или скрытых условием) */
export function unknownKeys(fields: FieldSchema[], value: unknown): string[] {
  if (!isRecord(value)) return []
  const known = new Set(fields.map((f) => f.key))
  return Object.keys(value).filter((key) => !known.has(key))
}

export interface DeprecatedEntry {
  key: string
  /** Устаревшее ЗНАЧЕНИЕ перечисления; отсутствует, когда устарел сам ключ */
  value?: string
  deprecation: Deprecation
}

/** Устаревшие ключи и значения перечислений, которые в объекте действительно стоят */
export function deprecatedAt(fields: FieldSchema[], value: unknown): DeprecatedEntry[] {
  if (!isRecord(value)) return []
  const found: DeprecatedEntry[] = []
  for (const field of fields) {
    const current = value[field.key]
    if (current === undefined) continue
    if (field.deprecated !== undefined) {
      found.push({ key: field.key, deprecation: field.deprecated })
      continue
    }
    if (field.kind === 'enum' && field.enum !== undefined && typeof current === 'string') {
      const hit = field.enum.find((e) => e.value === current && e.deprecated !== undefined)
      if (hit?.deprecated !== undefined) {
        found.push({ key: field.key, value: current, deprecation: hit.deprecated })
      }
    }
  }
  return found
}
```

`frontend/src/shared/schema/index.ts`:

```ts
export * from './types'
export * from './resolve'
export * from './ops'
```

(`./ops` появится в задаче 2; до неё оставьте строку `export * from './ops'` закомментированной с пометкой «задача 2» — иначе typecheck упадёт на отсутствующем модуле. Если задачи 1 и 2 исполняются одной волной, контроллер раскомментирует строку при сборке волны.)

- [ ] **Step 5: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/schema-resolve.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 6: Мутации**

1. В `conditionHolds` заменить `!cond.in.includes(current)` на `cond.in.includes(current)` — тест условий красный. Вернуть.
2. В `fieldsAt` убрать `i += 1` после списка — тест «элемент списка без объекта…» и тест спуска красные. Вернуть.
3. В `deprecatedAt` убрать `continue` после устаревшего ключа — тест устаревшего не краснеет: значит, ветка перечисления не сработает на `override_port` без enum. Это НЕ дефект теста — оставьте как есть, но добавьте случай «устаревший ключ с enum» в тест: поле `{ key: 'legacy', kind: 'enum', enum: [{ value: 'a' }], deprecated: {...} }` со значением `'a'` даёт ровно одну запись. Мутация «убрать continue» на нём красная. Вернуть.

- [ ] **Step 7: Typecheck и коммит**

Run: `npm run typecheck -w frontend`
Expected: 0 ошибок.

```bash
git add frontend/src/shared/schema frontend/test/schema-resolve.test.ts
git commit -m "feat(frontend): schema types and resolvers shared by the three editors"
```

---

### Task 2: Операции писателя

**Files:**
- Create: `frontend/src/shared/schema/ops.ts`
- Modify: `frontend/src/shared/schema/index.ts` (раскомментировать `export * from './ops'`)
- Test: `frontend/test/schema-ops.test.ts`

**Interfaces:**
- Consumes: `SchemaPath` из задачи 1.
- Produces: `DocOp`, `Lock`, `DocWriter`, `applyOps<T>(model: T, ops: DocOp[]): T`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/schema-ops.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyOps, type DocOp } from '../src/shared/schema'

const DOC = {
  outbounds: [{ type: 'direct', tag: 'a' }, { type: 'direct', tag: 'b' }],
  route: { final: 'a' },
}

describe('applyOps', () => {
  it('не мутирует вход', () => {
    const before = structuredClone(DOC)
    applyOps(DOC, [{ op: 'set', path: ['route', 'final'], value: 'b' }])
    expect(DOC).toEqual(before)
  })

  it('set пишет по пути и создаёт промежуточные объекты и списки', () => {
    const next = applyOps({}, [{ op: 'set', path: ['dns', 'servers', 0, 'tag'], value: 'x' }])
    expect(next).toEqual({ dns: { servers: [{ tag: 'x' }] } })
  })

  it('remove снимает ключ и вырезает элемент списка; мимо документа — ничего', () => {
    const a = applyOps(DOC, [{ op: 'remove', path: ['route', 'final'] }])
    expect(a.route).toEqual({})
    const b = applyOps(DOC, [{ op: 'remove', path: ['outbounds', 0] }])
    expect(b.outbounds.map((o) => o.tag)).toEqual(['b'])
    expect(applyOps(DOC, [{ op: 'remove', path: ['nope', 'x'] }])).toEqual(DOC)
  })

  it('insert зажимает индекс и заводит список, которого нет', () => {
    const a = applyOps(DOC, [{ op: 'insert', path: ['outbounds'], index: 99, value: { tag: 'c' } }])
    expect(a.outbounds.map((o) => o.tag)).toEqual(['a', 'b', 'c'])
    const b = applyOps(DOC, [{ op: 'insert', path: ['outbounds'], index: -5, value: { tag: 'z' } }])
    expect(b.outbounds[0]!.tag).toBe('z')
    const c = applyOps({}, [{ op: 'insert', path: ['inbounds'], index: 0, value: { tag: 'i' } }])
    expect(c).toEqual({ inbounds: [{ tag: 'i' }] })
  })

  it('move переставляет элемент, за границами не делает ничего', () => {
    const a = applyOps(DOC, [{ op: 'move', path: ['outbounds'], from: 1, to: 0 }])
    expect(a.outbounds.map((o) => o.tag)).toEqual(['b', 'a'])
    expect(applyOps(DOC, [{ op: 'move', path: ['outbounds'], from: 0, to: 5 }])).toEqual(DOC)
    expect(applyOps(DOC, [{ op: 'move', path: ['route'], from: 0, to: 1 }])).toEqual(DOC)
  })

  it('операции применяются по порядку, каждая видит результат предыдущей', () => {
    const ops: DocOp[] = [
      { op: 'insert', path: ['outbounds'], index: 0, value: { tag: 'n' } },
      { op: 'set', path: ['outbounds', 0, 'type'], value: 'vless' },
    ]
    expect(applyOps(DOC, ops).outbounds[0]).toEqual({ tag: 'n', type: 'vless' })
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/schema-ops.test.ts`
Expected: FAIL — `applyOps` не экспортирован.

- [ ] **Step 3: Написать операции**

`frontend/src/shared/schema/ops.ts`:

```ts
// Операции писателя. Форма не отдаёт наружу целое значение: она эмитит
// операции по пути, и одна и та же форма служит модельным ядрам (копия объекта)
// и Mihomo (сплайс или правка модели yaml). Здесь — применение к JSON-модели.

import type { SchemaPath } from './types'
import { isRecord } from './resolve'

export type DocOp =
  | { op: 'set'; path: SchemaPath; value: unknown }
  | { op: 'remove'; path: SchemaPath }
  | { op: 'insert'; path: SchemaPath; index: number; value: unknown }
  | { op: 'move'; path: SchemaPath; from: number; to: number }

export interface Lock {
  /** Почему значение по этому пути правится только в тексте — по-русски, форма показывает как есть */
  reason: string
}

export interface DocWriter {
  apply(ops: DocOp[]): void
  /** null — правится; иначе форма рисует поле на чтение с причиной */
  lockAt(path: SchemaPath): Lock | null
}

/**
 * Контейнер по пути. `create` заводит недостающие звенья: ключ → объект,
 * индекс → список. Так `set` по несуществующему пути и заводит секцию
 * панели «Документ» — отдельной операции «создать раздел» не нужно.
 */
function containerAt(root: unknown, path: SchemaPath, create: boolean): unknown {
  let cur: unknown = root
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    const nextStep = path[i + 1]
    if (typeof step === 'number') {
      if (!Array.isArray(cur)) return undefined
      if (cur[step] === undefined) {
        if (!create) return undefined
        cur[step] = typeof nextStep === 'number' ? [] : {}
      }
      cur = cur[step]
    } else {
      if (!isRecord(cur)) return undefined
      if (cur[step] === undefined) {
        if (!create) return undefined
        cur[step] = typeof nextStep === 'number' ? [] : {}
      }
      cur = cur[step]
    }
  }
  return cur
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}

/** Применение к копии: вход держит React, и правка на месте не вызвала бы перерисовку */
export function applyOps<T>(model: T, ops: DocOp[]): T {
  const next = structuredClone(model) as unknown
  for (const op of ops) {
    if (op.op === 'set') {
      const parent = containerAt(next, op.path.slice(0, -1), true)
      const last = op.path[op.path.length - 1]
      if (last === undefined) continue
      if (typeof last === 'number') {
        if (Array.isArray(parent)) parent[last] = op.value
      } else if (isRecord(parent)) {
        parent[last] = op.value
      }
      continue
    }
    if (op.op === 'remove') {
      const parent = containerAt(next, op.path.slice(0, -1), false)
      const last = op.path[op.path.length - 1]
      if (typeof last === 'number') {
        if (Array.isArray(parent) && last < parent.length) parent.splice(last, 1)
      } else if (last !== undefined && isRecord(parent)) {
        delete parent[last]
      }
      continue
    }
    if (op.op === 'insert') {
      const parent = containerAt(next, op.path.slice(0, -1), true)
      const last = op.path[op.path.length - 1]
      if (typeof last !== 'string' || !isRecord(parent)) continue
      if (parent[last] === undefined) parent[last] = []
      const list = parent[last]
      if (!Array.isArray(list)) continue
      list.splice(clamp(op.index, list.length), 0, op.value)
      continue
    }
    const list = containerAt(next, op.path, false)
    if (!Array.isArray(list)) continue
    if (op.from < 0 || op.from >= list.length || op.to < 0 || op.to >= list.length) continue
    const [moved] = list.splice(op.from, 1)
    list.splice(op.to, 0, moved)
  }
  return next as T
}
```

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/schema-ops.test.ts test/schema-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Мутации**

1. В `applyOps` заменить `structuredClone(model)` на `model` — тест «не мутирует вход» красный. Вернуть.
2. В `insert` убрать `clamp` (использовать `op.index` как есть) — тест про зажим индекса красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/shared/schema frontend/test/schema-ops.test.ts
git commit -m "feat(frontend): path-based document operations for schema forms"
```

---

### Task 3: Примитивы полей: тристейт, числа с границами, перестановка в списке

**Files:**
- Modify: `frontend/src/features/inspector/fields.tsx` (`NumberField`, новый `TriStateField`)
- Modify: `frontend/src/features/inspector/collections.tsx` (`ListEditor`)
- Modify: `frontend/src/shared/ui/tokens.css` (стили `.tristate`, `.list-editor-order`)
- Test: `frontend/test/schema-fields.test.tsx`

**Interfaces:**
- Produces: `NumberField({ label, hint?, value, onChange, placeholder?, integer?, min? })`; `TriStateField({ label, hint?, value: boolean | undefined, onChange })`; `ListEditor` с новым пропом `reorder?: boolean`.
- `CheckboxField` не меняется: он остаётся у форм Xray с их семантикой «false — снять ключ».

- [ ] **Step 1: Написать падающий тест**

`frontend/test/schema-fields.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NumberField, TriStateField } from '../src/features/inspector/fields'
import { ListEditor } from '../src/features/inspector/collections'

describe('TriStateField', () => {
  it('три состояния: не задано, да, нет — и явное false выразимо', async () => {
    const onChange = vi.fn()
    render(<TriStateField label="auto_route" value={undefined} onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'auto_route' })
    expect(screen.getByRole('button', { name: 'не задано' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'нет' }))
    expect(onChange).toHaveBeenLastCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: 'да' }))
    expect(onChange).toHaveBeenLastCalledWith(true)
    await userEvent.click(screen.getByRole('button', { name: 'не задано' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(group).toBeInTheDocument()
  })

  it('показывает текущее false нажатым', () => {
    render(<TriStateField label="x" value={false} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'нет' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('NumberField', () => {
  it('по умолчанию берёт только неотрицательные целые', async () => {
    const onChange = vi.fn()
    render(<NumberField label="n" value={undefined} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('n'), '-1')
    expect(onChange).not.toHaveBeenCalledWith(-1)
  })

  it('с min < 0 принимает отрицательные, с integer: false — дробные', async () => {
    const onChange = vi.fn()
    render(<NumberField label="m" value={undefined} onChange={onChange} min={-10} integer={false} />)
    const input = screen.getByLabelText('m')
    await userEvent.type(input, '-2.5')
    expect(onChange).toHaveBeenLastCalledWith(-2.5)
  })

  it('ниже min не пишет', async () => {
    const onChange = vi.fn()
    render(<NumberField label="k" value={undefined} onChange={onChange} min={1024} />)
    await userEvent.type(screen.getByLabelText('k'), '5')
    expect(onChange).not.toHaveBeenCalledWith(5)
  })

  it('подсказка рендерится', () => {
    render(<NumberField label="p" hint="Порт сервера." value={1} onChange={vi.fn()} />)
    expect(screen.getByText('Порт сервера.')).toBeInTheDocument()
  })
})

describe('ListEditor с перестановкой', () => {
  const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
  it('стрелки меняют соседей местами и гаснут на краях', async () => {
    const onChange = vi.fn()
    render(
      <ListEditor
        label="список"
        value={items}
        onChange={onChange}
        createItem={() => ({ name: '' })}
        addLabel="+ Ещё"
        reorder
        renderItem={(item) => <span>{item.name}</span>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Переместить элемент 1 выше' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Переместить элемент 3 ниже' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить элемент 2 выше' }))
    expect(onChange).toHaveBeenCalledWith([{ name: 'b' }, { name: 'a' }, { name: 'c' }])
  })

  it('без reorder стрелок нет', () => {
    render(
      <ListEditor
        label="список"
        value={items}
        onChange={vi.fn()}
        createItem={() => ({ name: '' })}
        addLabel="+ Ещё"
        renderItem={(item) => <span>{item.name}</span>}
      />,
    )
    expect(screen.queryByRole('button', { name: /Переместить/ })).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/schema-fields.test.tsx`
Expected: FAIL — `TriStateField` не экспортирован, у `NumberField` нет `min`.

- [ ] **Step 3: Расширить `NumberField` и добавить `TriStateField`**

В `frontend/src/features/inspector/fields.tsx` заменить `NumberField` целиком:

```tsx
/**
 * Число. По умолчанию — неотрицательное целое (порты, счётчики): именно так
 * читались все прежние поля. Схема может разрешить дробное (`integer: false`)
 * и отрицательное (`min < 0`); ввод ниже `min` не пишется — форма не подменяет
 * набранное, она его просто не принимает.
 */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  integer = true,
  min,
}: {
  label: string
  hint?: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
  integer?: boolean
  min?: number
}) {
  const allowNegative = min !== undefined && min < 0
  const pattern = integer
    ? allowNegative ? /^-?\d+$/ : /^\d+$/
    : allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/
  return (
    <Field label={label} hint={hint}>
      <TextInput
        value={value === undefined ? '' : String(value)}
        placeholder={placeholder}
        inputMode={integer && !allowNegative ? 'numeric' : 'decimal'}
        onChange={(e) => {
          const t = e.target.value.trim()
          if (t === '') return onChange(undefined)
          if (!pattern.test(t)) return
          const n = Number(t)
          if (min !== undefined && n < min) return
          onChange(n)
        }}
      />
    </Field>
  )
}

/**
 * Булево поле с ТРЕМЯ состояниями. `CheckboxField` снимает ключ на false — для
 * форм Xray это верно (false там всегда умолчание), а у sing-box явное
 * `set_system_proxy: false` или `auto_route: false` — реальные значения, и
 * снять ключ значило бы записать другое. Стиль — сегменты, как у переключателя
 * «Форма / JSON узла».
 */
export function TriStateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean | undefined
  onChange: (v: boolean | undefined) => void
}) {
  const states: { v: boolean | undefined; text: string }[] = [
    { v: undefined, text: 'не задано' },
    { v: true, text: 'да' },
    { v: false, text: 'нет' },
  ]
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented tristate" role="group" aria-label={label}>
        {states.map((s) => (
          <button
            key={s.text}
            type="button"
            className="btn"
            aria-pressed={value === s.v}
            onClick={() => onChange(s.v)}
          >
            {s.text}
          </button>
        ))}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}
```

`useId` уже импортирован; `TextInput` тоже. Важно: `NumberField` до правки не имел `hint` — добавленный проп ничего не ломает у существующих вызовов.

- [ ] **Step 4: Перестановка в `ListEditor`**

В `frontend/src/features/inspector/collections.tsx` заменить `ListEditor`:

```tsx
/**
 * Повторяемые карточки объектов. `reorder` включает стрелки: у списков, где
 * порядок значим (пиры, серверы DNS), без них порядок правился бы только текстом.
 */
export function ListEditor<T extends object>({
  label,
  hint,
  value,
  onChange,
  createItem,
  addLabel,
  renderItem,
  reorder = false,
}: {
  label: string
  hint?: string
  value: T[] | undefined
  onChange: (v: T[] | undefined) => void
  createItem: () => T
  addLabel: string
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode
  reorder?: boolean
}) {
  const items = value ?? []
  const move = (from: number, to: number) => {
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    onChange(next)
  }
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="list-editor">
        {items.map((item, i) => (
          <div key={i} className="list-editor-card">
            <div className="list-editor-body">
              {renderItem(item, (patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))), i)}
            </div>
            {reorder && (
              <div className="list-editor-order">
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`Переместить элемент ${i + 1} выше`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`Переместить элемент ${i + 1} ниже`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
              </div>
            )}
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить элемент ${i + 1}`}
              onClick={() => {
                const next = items.filter((_, idx) => idx !== i)
                onChange(next.length > 0 ? next : undefined)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <Button onClick={() => onChange([...items, createItem()])}>{addLabel}</Button>
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}
```

В `frontend/src/shared/ui/tokens.css` рядом с `.list-editor` добавить:

```css
/* Стрелки порядка у карточки списка: стоят столбиком между телом и крестиком */
.list-editor-order { display: flex; flex-direction: column; gap: 2px; }
.list-editor-order .chip-x:disabled { opacity: 0.35; cursor: default; }
/* Тристейт — те же сегменты, что у «Форма / JSON узла», но во всю ширину поля */
.tristate { align-self: flex-start; }
```

- [ ] **Step 5: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/schema-fields.test.tsx test/inbound-form.test.tsx test/stream-form.test.tsx`
Expected: PASS — новый файл и два существующих потребителя `NumberField`/`ListEditor` из форм Xray.

- [ ] **Step 6: Мутации**

1. В `TriStateField` заменить `aria-pressed={value === s.v}` на `aria-pressed={false}` — тест «показывает текущее false» красный. Вернуть.
2. В `NumberField` убрать проверку `n < min` — тест «ниже min не пишет» красный. Вернуть.
3. В `ListEditor.move` поменять местами `from`/`to` при splice — тест стрелок красный. Вернуть.

- [ ] **Step 7: Typecheck и коммит**

```bash
git add frontend/src/features/inspector/fields.tsx frontend/src/features/inspector/collections.tsx frontend/src/shared/ui/tokens.css frontend/test/schema-fields.test.tsx
git commit -m "feat(frontend): tri-state boolean, bounded numbers and reorderable list editor"
```

---

### Task 4: Кнопка-меню `MenuButton`

**Files:**
- Create: `frontend/src/shared/ui/MenuButton.tsx`
- Modify: `frontend/src/shared/ui/index.ts`
- Modify: `frontend/src/shared/ui/tokens.css` (стили `.menu-item`)
- Test: `frontend/test/menu-button.test.tsx`

**Interfaces:**
- Consumes: `computePosition` из `shared/ui/Select.tsx` (уже экспортирован).
- Produces: `MenuButton({ label, items: MenuItem[], onPick, variant?, 'aria-label'? })`, `MenuItem = { id: string; label: string; disabled?: boolean }`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/menu-button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MenuButton } from '../src/shared/ui'

const ITEMS = [
  { id: 'inbound', label: 'Вход' },
  { id: 'outbound', label: 'Выход' },
  { id: 'locked', label: 'Недоступно', disabled: true },
]

describe('MenuButton', () => {
  it('закрыт по умолчанию, открывается кликом и показывает пункты', async () => {
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: '+ Добавить' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Вход', 'Выход', 'Недоступно'])
  })

  it('выбор пункта зовёт onPick с id и закрывает меню', async () => {
    const onPick = vi.fn()
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Выход' }))
    expect(onPick).toHaveBeenCalledWith('outbound')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('отключённый пункт не выбирается', async () => {
    const onPick = vi.fn()
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    expect(screen.getByRole('menuitem', { name: 'Недоступно' })).toBeDisabled()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Недоступно' }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Escape закрывает меню и не всплывает наружу', async () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <MenuButton label="+ Добавить" items={ITEMS} onPick={vi.fn()} />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(outer).not.toHaveBeenCalled()
  })

  it('стрелки двигают фокус по пунктам, Enter выбирает', async () => {
    const onPick = vi.fn()
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith('outbound')
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/menu-button.test.tsx`
Expected: FAIL — `MenuButton` не экспортирован.

- [ ] **Step 3: Реализовать**

`frontend/src/shared/ui/MenuButton.tsx`:

```tsx
// Кнопка-меню: одна кнопка дока вместо восьми. Список едет порталом по тем же
// правилам, что у Select: внутри модального <dialog> — в сам диалог (top layer
// не пробивается z-index'ом), иначе в body; позиция — computePosition оттуда же.

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { computePosition } from './Select'

export interface MenuItem {
  id: string
  label: string
  disabled?: boolean
}

interface Props {
  label: string
  items: MenuItem[]
  onPick: (id: string) => void
  variant?: 'primary' | 'ghost' | 'danger'
  'aria-label'?: string
}

export function MenuButton({ label, items, onPick, variant, 'aria-label': ariaLabel }: Props) {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [pos, setPos] = useState<ReturnType<typeof computePosition> | null>(null)
  const [active, setActive] = useState(0)

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current
    const rect = trigger?.getBoundingClientRect()
    if (rect) setPos(computePosition(rect, window.innerHeight))
    setContainer(trigger?.closest('dialog') ?? document.body)
    setActive(items.findIndex((i) => !i.disabled))
    setOpen(true)
  }, [items])

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const pick = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item || item.disabled) return
      onPick(item.id)
      closeMenu()
    },
    [items, onPick, closeMenu],
  )

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  /** Следующий доступный пункт в направлении dir, по кругу */
  function step(from: number, dir: 1 | -1): number {
    if (items.length === 0) return -1
    let i = from
    for (let n = 0; n < items.length; n += 1) {
      i = (i + dir + items.length) % items.length
      if (!items[i]!.disabled) return i
    }
    return from
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      // Клавишу потребило меню: глобальный Escape закрыл бы заодно инспектор
      e.stopPropagation()
      closeMenu()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => step(i, 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => step(i, -1))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
      return
    }
    if (e.key === 'Tab') setOpen(false)
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {label}
      </Button>
      {open &&
        container &&
        createPortal(
          <div
            ref={popRef}
            id={menuId}
            role="menu"
            className="select-pop"
            style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.width, maxHeight: pos.maxHeight } : undefined}
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="select-option menu-item"
                data-active={index === active ? 'true' : undefined}
                disabled={item.disabled}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                {item.label}
              </button>
            ))}
          </div>,
          container,
        )}
    </>
  )
}
```

`Button` должен уметь принимать `ref`: откройте `frontend/src/shared/ui/Button.tsx`; если компонент объявлен как `export function Button({ variant, className, ...rest }: Props)`, где `Props extends ButtonHTMLAttributes<HTMLButtonElement>`, то в React 19 `ref` приходит обычным пропом, и `<button ref={rest.ref}>` работает без `forwardRef` — убедитесь, что `ref` доходит до `<button>` (в React 19 `ref` внутри `...rest` — да). Если `Button` разворачивает пропы явно и `ref` теряется, добавьте его в деструктуризацию и передайте на `<button>`.

В `frontend/src/shared/ui/index.ts` добавить: `export { MenuButton, type MenuItem } from './MenuButton'`.

В `frontend/src/shared/ui/tokens.css` рядом с `.select-option` добавить:

```css
/* Пункт меню — та же строка, что у опции списка, но это кнопка: ей нужен сброс рамки */
.menu-item { width: 100%; border: none; background: transparent; text-align: left; font: inherit; color: inherit; }
.menu-item:disabled { opacity: 0.45; cursor: default; }
```

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/menu-button.test.tsx`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Мутации**

1. В `pick` убрать проверку `item.disabled` — тест отключённого пункта красный. Вернуть.
2. В обработчике Escape убрать `e.stopPropagation()` — тест «не всплывает наружу» красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/shared/ui/MenuButton.tsx frontend/src/shared/ui/index.ts frontend/src/shared/ui/tokens.css frontend/src/shared/ui/Button.tsx frontend/test/menu-button.test.tsx
git commit -m "feat(frontend): menu button on the shared portal list"
```

---

### Task 5: Рендерер `SchemaForm`

**Files:**
- Create: `frontend/src/features/inspector/schema/SchemaForm.tsx`
- Create: `frontend/src/features/inspector/schema/labels.ts`
- Create: `frontend/test/schemaHelpers.ts`
- Test: `frontend/test/schema-form.test.tsx`

**Interfaces:**
- Consumes: задача 1 (`FieldSchema`, `visibleFields`, `unknownKeys`, `deprecatedAt`, `isRecord`), задача 2 (`DocOp`, `DocWriter`, `applyOps`), задача 3 (`TriStateField`, `NumberField`, `ListEditor` c `reorder`), существующие `TextField`, `SelectField`, `StringListField`, `KeyValueField`, `CollapsibleSection`, `TextInput`, `Button`.
- Produces:

```ts
export interface SchemaFormProps {
  fields: FieldSchema[]
  value: Record<string, unknown>
  /** Абсолютный путь объекта `value` в документе — операции строятся от него */
  path: SchemaPath
  writer: DocWriter
  /** Ключи, которые уже нарисовал вызывающий: второй раз их не рисуем */
  skip?: string[]
  /** Теги документа для полей со ссылкой */
  refs?: Partial<Record<RefKind, string[]>>
  /** Рисовать ли ключи панели (panelKey) */
  showPanelKeys?: boolean
}
export function SchemaForm(props: SchemaFormProps): JSX.Element
```

и в `labels.ts`: `deprecatedNote(d: Deprecation): string`, `UNKNOWN_KEY_NOTE`, `SHAPE_NOTE`, `NOT_SET`.

Правила рендерера (из спеки, зафиксированы тестами ниже):
1. Порядок: сначала заполненные поля, затем `CollapsibleSection` «Ещё поля (N)» с незаполненными. Вложенные объекты и списки объектов считаются заполненными, когда ключ есть в значении.
2. Подпись поля — сам ключ, подсказка — `doc`; у устаревшего ключа или устаревшего текущего значения к подсказке добавляется `deprecatedNote`.
3. `string` → `TextField`; `number` → `NumberField` с `integer`/`min`; `boolean` → `TriStateField`; `enum` → `SelectField` с пунктом «(не задано)», текущим значением вне списка как собственным пунктом и, для устаревших значений, пометкой в подписи; `ref` → `SelectField` по `refs[field.ref]` с тем же сквозным пропуском; `map` → `KeyValueField`; `list` строк → `StringListField` (для `item.enum` — `MultiSelectField`); `list` чисел → `StringListField` с разбором чисел; `list` объектов → карточки с заголовком `item.label`, кнопками «выше/ниже/удалить» и «+ Добавить» (стартер элемента или `{}`), внутри — рекурсивный `SchemaForm`; `object` → `CollapsibleSection` (открыт, если ключ заполнен) с рекурсивным `SchemaForm` по `value[key] ?? {}`.
4. Значение не той формы, что ждёт схема (строка там, где объект; объект там, где строка), — `TextInput readOnly` с JSON и `SHAPE_NOTE`.
5. Ключ документа, которого нет в схеме, — `TextInput readOnly` с JSON и `UNKNOWN_KEY_NOTE`; никогда не скрывается.
6. `writer.lockAt(path)` ≠ null — поле на чтение с причиной.
7. Каждая правка — один `DocOp`: пустая строка, пустой список и «(не задано)» — `remove`; иначе `set`. Списки объектов — `insert`/`move`/`remove` по индексу.
8. `panelKey` рендерится только при `showPanelKeys`.

- [ ] **Step 1: Помощник для тестов**

`frontend/test/schemaHelpers.ts`:

```ts
import type { DocOp, DocWriter, Lock, SchemaPath } from '../src/shared/schema'

/** Писатель-ловушка: копит операции и отвечает замком по заданным путям */
export function makeWriter(locks: { path: SchemaPath; reason: string }[] = []) {
  const ops: DocOp[] = []
  const writer: DocWriter = {
    apply: (next) => ops.push(...next),
    lockAt: (path): Lock | null => {
      const hit = locks.find((l) => JSON.stringify(l.path) === JSON.stringify(path))
      return hit ? { reason: hit.reason } : null
    },
  }
  return { ops, writer }
}
```

- [ ] **Step 2: Написать падающий тест**

`frontend/test/schema-form.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SchemaForm } from '../src/features/inspector/schema/SchemaForm'
import type { FieldSchema } from '../src/shared/schema'
import { optionLabels, selectOption, selectedValue } from './helpers'
import { makeWriter } from './schemaHelpers'

const FIELDS: FieldSchema[] = [
  { key: 'tag', doc: 'Имя.', kind: 'string' },
  {
    key: 'type',
    doc: 'Тип.',
    kind: 'enum',
    enum: [{ value: 'direct' }, { value: 'vless' }, { value: 'block', deprecated: { since: '1.13.0', replacement: 'reject' } }],
  },
  { key: 'server_port', doc: 'Порт.', kind: 'number', min: 1 },
  { key: 'tcp_fast_open', doc: 'TFO.', kind: 'boolean' },
  { key: 'uuid', doc: 'UUID.', kind: 'string', when: { key: 'type', in: ['vless'] } },
  { key: 'detour', doc: 'Через.', kind: 'string', ref: 'outbound' },
  { key: 'alpn', doc: 'ALPN.', kind: 'list', item: { kind: 'string' } },
  { key: 'port', doc: 'Порты.', kind: 'list', item: { kind: 'number' } },
  { key: 'headers', doc: 'Заголовки.', kind: 'map' },
  {
    key: 'tls',
    doc: 'TLS.',
    kind: 'object',
    fields: [{ key: 'enabled', doc: 'Вкл.', kind: 'boolean' }, { key: 'server_name', doc: 'SNI.', kind: 'string' }],
  },
  {
    key: 'peers',
    doc: 'Пиры.',
    kind: 'list',
    item: {
      kind: 'object',
      fields: [{ key: 'address', doc: 'Адрес.', kind: 'string' }],
      label: (v) => `пир ${(v as { address?: string }).address ?? '?'}`,
      starter: () => ({ address: '' }),
    },
  },
  { key: 'remnawave', doc: 'Панель.', kind: 'object', panelKey: true, fields: [{ key: 'includeProxies', doc: 'Ключ.', kind: 'boolean' }] },
  { key: 'old', doc: 'Старое.', kind: 'string', deprecated: { since: '1.11.0', replacement: 'new' } },
]

const PATH = ['outbounds', 0]

describe('SchemaForm: раскладка', () => {
  it('заполненные поля сверху, незаполненные под «Ещё поля (N)»', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a', type: 'direct' }} path={PATH} writer={writer} />)
    expect(screen.getByLabelText('tag')).toHaveValue('a')
    // uuid скрыт условием, remnawave — ключ панели: оба не считаются
    expect(screen.getByRole('button', { name: /Ещё поля \(9\)/ })).toBeInTheDocument()
  })

  it('skip убирает поля, нарисованные вызывающим', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a' }} path={PATH} writer={writer} skip={['tag']} />)
    expect(screen.queryByLabelText('tag')).toBeNull()
  })

  it('условное поле появляется вместе со значением соседа', () => {
    const { writer } = makeWriter()
    const { rerender } = render(<SchemaForm fields={FIELDS} value={{ type: 'direct' }} path={PATH} writer={writer} />)
    expect(screen.queryByText('uuid')).toBeNull()
    rerender(<SchemaForm fields={FIELDS} value={{ type: 'vless' }} path={PATH} writer={writer} />)
    expect(screen.getByText('uuid')).toBeInTheDocument()
  })
})

describe('SchemaForm: операции', () => {
  it('строка пишет set, пустая строка — remove', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a' }} path={PATH} writer={writer} />)
    await userEvent.type(screen.getByLabelText('tag'), 'b')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tag'], value: 'ab' })
    await userEvent.clear(screen.getByLabelText('tag'))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['outbounds', 0, 'tag'] })
  })

  it('тристейт пишет явное false', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tcp_fast_open: true }} path={PATH} writer={writer} />)
    await userEvent.click(screen.getByRole('button', { name: 'нет' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tcp_fast_open'], value: false })
  })

  it('перечисление: чужое значение проходит сквозь, устаревшее объяснено, «(не задано)» снимает ключ', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ type: 'block' }} path={PATH} writer={writer} />)
    expect(selectedValue('type')).toBe('block')
    expect(await optionLabels('type')).toContain('block')
    expect(screen.getByText(/1\.13\.0.*reject/)).toBeInTheDocument()
    await selectOption('type', '(не задано)')
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['outbounds', 0, 'type'] })
  })

  it('ссылка предлагает теги документа плюс текущее значение', async () => {
    const { ops, writer } = makeWriter()
    render(
      <SchemaForm fields={FIELDS} value={{ detour: 'gone' }} path={PATH} writer={writer} refs={{ outbound: ['direct', 'proxy'] }} />,
    )
    expect(await optionLabels('detour')).toEqual(['(не задано)', 'gone', 'direct', 'proxy'])
    await selectOption('detour', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'detour'], value: 'proxy' })
  })

  it('список чисел пишет числа, а не строки', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ port: [80] }} path={PATH} writer={writer} />)
    await userEvent.type(screen.getByLabelText('port'), '\n443')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'port'], value: [80, 443] })
  })

  it('вложенный объект пишет по полному пути и заводится записью, когда его нет', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{}} path={PATH} writer={writer} />)
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    await userEvent.click(screen.getByRole('button', { name: 'tls' }))
    await userEvent.type(screen.getByLabelText('server_name'), 'x')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tls', 'server_name'], value: 'x' })
  })

  it('список объектов: добавить, переставить, удалить — операции по индексу', async () => {
    const { ops, writer } = makeWriter()
    render(
      <SchemaForm fields={FIELDS} value={{ peers: [{ address: 'a' }, { address: 'b' }] }} path={PATH} writer={writer} />,
    )
    const list = screen.getByRole('group', { name: 'peers' })
    expect(within(list).getByText('пир a')).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: '+ Добавить' }))
    expect(ops.at(-1)).toEqual({ op: 'insert', path: ['outbounds', 0, 'peers'], index: 2, value: { address: '' } })
    await userEvent.click(within(list).getByRole('button', { name: 'Переместить элемент 2 выше' }))
    expect(ops.at(-1)).toEqual({ op: 'move', path: ['outbounds', 0, 'peers'], from: 1, to: 0 })
    await userEvent.click(within(list).getByRole('button', { name: 'Удалить элемент 1' }))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['outbounds', 0, 'peers', 0] })
  })

  it('карта строк пишет объект', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ headers: { Host: 'a' } }} path={PATH} writer={writer} />)
    const host = screen.getAllByPlaceholderText('Значение')[0]!
    await userEvent.type(host, 'b')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'headers'], value: { Host: 'ab' } })
  })
})

describe('SchemaForm: чтение вместо порчи', () => {
  it('неизвестный ключ виден на чтение и никогда не скрыт', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ mystery: { a: 1 } }} path={PATH} writer={writer} />)
    const field = screen.getByLabelText('mystery')
    expect(field).toHaveAttribute('readonly')
    expect(field).toHaveValue('{"a":1}')
    expect(screen.getByText(/неизвестен словарю/)).toBeInTheDocument()
  })

  it('значение не той формы показано на чтение с объяснением', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tls: 'oops', tag: { x: 1 } }} path={PATH} writer={writer} />)
    expect(screen.getByLabelText('tag')).toHaveAttribute('readonly')
    expect(screen.getAllByText(/развёрнут|не той формы/i).length).toBeGreaterThan(0)
  })

  it('замок писателя показывает причину и запрещает правку', () => {
    const { writer } = makeWriter([{ path: ['outbounds', 0, 'tag'], reason: 'Заполняет панель.' }])
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a' }} path={PATH} writer={writer} />)
    expect(screen.getByLabelText('tag')).toHaveAttribute('readonly')
    expect(screen.getByText('Заполняет панель.')).toBeInTheDocument()
  })

  it('устаревший ключ несёт подсказку с версией и заменой', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ old: 'v' }} path={PATH} writer={writer} />)
    expect(screen.getByText(/1\.11\.0.*new/)).toBeInTheDocument()
  })

  it('ключ панели рисуется только по просьбе', () => {
    const { writer } = makeWriter()
    const { rerender } = render(<SchemaForm fields={FIELDS} value={{ remnawave: { includeProxies: false } }} path={PATH} writer={writer} />)
    expect(screen.queryByRole('button', { name: 'remnawave' })).toBeNull()
    rerender(<SchemaForm fields={FIELDS} value={{ remnawave: { includeProxies: false } }} path={PATH} writer={writer} showPanelKeys />)
    expect(screen.getByRole('button', { name: 'remnawave' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/schema-form.test.tsx`
Expected: FAIL — модуль `SchemaForm` не найден.

- [ ] **Step 4: Тексты рендерера**

`frontend/src/features/inspector/schema/labels.ts`:

```ts
// Тексты рендерера собраны в одном месте: их проверяют тесты и документация,
// а разбросанные по JSX строки разъезжались бы при первой правке.

import type { Deprecation } from '../../../shared/schema'

export const NOT_SET = '(не задано)'

export const UNKNOWN_KEY_NOTE = 'Ключ неизвестен словарю: правится на вкладке JSON.'

export const SHAPE_NOTE =
  'Значение записано в развёрнутой форме, не той, что ждёт словарь; правится на вкладке JSON.'

export function deprecatedNote(d: Deprecation): string {
  return `Устарело с ${d.since}: ${d.replacement}.`
}

export function moreFieldsTitle(count: number): string {
  return `Ещё поля (${count})`
}
```

- [ ] **Step 5: Реализовать `SchemaForm`**

`frontend/src/features/inspector/schema/SchemaForm.tsx`:

```tsx
// Рекурсивный рендерер формы по схеме. Один на три ядра: он не знает, что
// рисует, — знает схема. Каждая правка уходит писателю ОДНОЙ операцией по
// абсолютному пути; форма никогда не отдаёт наружу целое значение.
//
// Три правила честности, ради которых он написан:
// 1) ключ, которого нет в схеме, виден на чтение и не скрывается никогда;
// 2) значение не той формы (строка вместо объекта) — на чтение с объяснением;
// 3) замок писателя — на чтение с его причиной.

import { useId, type ReactNode } from 'react'
import {
  deprecatedAt,
  isRecord,
  unknownKeys,
  visibleFields,
  type DocOp,
  type DocWriter,
  type FieldSchema,
  type RefKind,
  type SchemaPath,
} from '../../../shared/schema'
import { Button, CollapsibleSection, TextInput, type SelectOption } from '../../../shared/ui'
import { KeyValueField } from '../collections'
import {
  Field,
  MultiSelectField,
  NumberField,
  SelectField,
  StringListField,
  TextField,
  TriStateField,
} from '../fields'
import { NOT_SET, SHAPE_NOTE, UNKNOWN_KEY_NOTE, deprecatedNote, moreFieldsTitle } from './labels'

export interface SchemaFormProps {
  fields: FieldSchema[]
  value: Record<string, unknown>
  /** Абсолютный путь объекта `value` в документе — операции строятся от него */
  path: SchemaPath
  writer: DocWriter
  /** Ключи, которые уже нарисовал вызывающий: второй раз их не рисуем */
  skip?: string[]
  /** Теги документа для полей со ссылкой */
  refs?: Partial<Record<RefKind, string[]>>
  /** Рисовать ли ключи панели */
  showPanelKeys?: boolean
}

/** Поле на чтение: JSON значения и причина, почему оно не правится здесь */
function ReadOnly({ label, hint, value }: { label: string; hint: string; value: unknown }) {
  const id = useId()
  return (
    <Field label={label} hint={hint} controlId={id}>
      <TextInput id={id} readOnly value={JSON.stringify(value ?? null)} />
    </Field>
  )
}

/** Текущее значение вне списка — собственный пункт: молча подменять его первым нельзя */
function withCurrent(options: SelectOption[], current: string): SelectOption[] {
  if (current === '' || options.some((o) => o.value === current)) return options
  return [options[0]!, { value: current, label: current }, ...options.slice(1)]
}

function shapeFits(field: FieldSchema, value: unknown): boolean {
  if (value === undefined) return true
  switch (field.kind) {
    case 'string':
    case 'enum':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'list':
      return Array.isArray(value)
    case 'object':
    case 'map':
      return isRecord(value)
  }
}

function isFilled(value: unknown): boolean {
  return value !== undefined
}

export function SchemaForm({ fields, value, path, writer, skip = [], refs = {}, showPanelKeys = false }: SchemaFormProps) {
  const skipped = new Set(skip)
  const shown = visibleFields(fields, value).filter((f) => !skipped.has(f.key) && (showPanelKeys || !f.panelKey))
  const filled = shown.filter((f) => isFilled(value[f.key]))
  const rest = shown.filter((f) => !isFilled(value[f.key]))
  const unknown = unknownKeys(fields, value).filter((k) => !skipped.has(k))
  const deprecated = new Map(deprecatedAt(fields, value).map((d) => [d.key, d.deprecation]))

  const emit = (op: DocOp) => writer.apply([op])
  const at = (key: string): SchemaPath => [...path, key]
  const setOrRemove = (key: string, next: unknown) => {
    const empty =
      next === undefined ||
      next === '' ||
      (Array.isArray(next) && next.length === 0)
    emit(empty ? { op: 'remove', path: at(key) } : { op: 'set', path: at(key), value: next })
  }

  function hintOf(field: FieldSchema): string {
    const d = deprecated.get(field.key) ?? field.deprecated
    return d === undefined ? field.doc : `${field.doc} ${deprecatedNote(d)}`
  }

  function row(field: FieldSchema): ReactNode {
    const current = value[field.key]
    const lock = writer.lockAt(at(field.key))
    if (lock !== null) return <ReadOnly key={field.key} label={field.key} hint={`${field.doc} ${lock.reason}`} value={current} />
    if (!shapeFits(field, current)) return <ReadOnly key={field.key} label={field.key} hint={`${field.doc} ${SHAPE_NOTE}`} value={current} />
    const hint = hintOf(field)

    switch (field.kind) {
      case 'string':
        if (field.ref !== undefined) {
          const tags = refs[field.ref] ?? []
          const cur = typeof current === 'string' ? current : ''
          return (
            <SelectField
              key={field.key}
              label={field.key}
              hint={hint}
              value={cur}
              options={withCurrent([{ value: '', label: NOT_SET }, ...tags.map((t) => ({ value: t, label: t }))], cur)}
              onChange={(v) => setOrRemove(field.key, v)}
            />
          )
        }
        return (
          <TextField
            key={field.key}
            label={field.key}
            hint={hint}
            value={typeof current === 'string' ? current : undefined}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      case 'number':
        return (
          <NumberField
            key={field.key}
            label={field.key}
            hint={hint}
            value={typeof current === 'number' ? current : undefined}
            integer={field.integer}
            min={field.min}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      case 'boolean':
        return (
          <TriStateField
            key={field.key}
            label={field.key}
            hint={hint}
            value={typeof current === 'boolean' ? current : undefined}
            onChange={(v) => (v === undefined ? emit({ op: 'remove', path: at(field.key) }) : emit({ op: 'set', path: at(field.key), value: v }))}
          />
        )
      case 'enum': {
        const cur = typeof current === 'string' ? current : ''
        const options = [{ value: '', label: NOT_SET }, ...(field.enum ?? []).map((e) => ({ value: e.value, label: e.value }))]
        return (
          <SelectField
            key={field.key}
            label={field.key}
            hint={hint}
            value={cur}
            options={withCurrent(options, cur)}
            onChange={(v) => setOrRemove(field.key, v)}
          />
        )
      }
      case 'map': {
        const map = isRecord(current) ? current : {}
        const rows = Object.entries(map).map(([k, v]) => ({ key: k, value: String(v) }))
        return (
          <KeyValueField
            key={field.key}
            label={field.key}
            hint={hint}
            value={rows}
            onChange={(next) => {
              const obj: Record<string, string> = {}
              for (const r of next ?? []) obj[r.key] = r.value
              setOrRemove(field.key, Object.keys(obj).length === 0 ? undefined : obj)
            }}
          />
        )
      }
      case 'list':
        return listRow(field, current, hint)
      case 'object': {
        const inner = isRecord(current) ? current : {}
        return (
          <CollapsibleSection key={field.key} title={field.key} defaultOpen={isFilled(current)}>
            <p className="muted" style={{ margin: 0 }}>{hint}</p>
            <SchemaForm fields={field.fields ?? []} value={inner} path={at(field.key)} writer={writer} refs={refs} showPanelKeys={showPanelKeys} />
          </CollapsibleSection>
        )
      }
    }
  }

  function listRow(field: FieldSchema, current: unknown, hint: string): ReactNode {
    const item = field.item ?? { kind: 'string' as const }
    const list = Array.isArray(current) ? current : []
    if (item.kind === 'object') {
      const key = field.key
      return (
        <div key={key} className="field" role="group" aria-label={key}>
          <span className="field-label">{key}</span>
          <div className="list-editor">
            {list.map((entry, i) => (
              <div key={i} className="list-editor-card">
                <div className="list-editor-body">
                  <span className="eyebrow">{item.label?.(entry, i) ?? `${key} #${i + 1}`}</span>
                  <SchemaForm
                    fields={item.fields ?? []}
                    value={isRecord(entry) ? entry : {}}
                    path={[...at(key), i]}
                    writer={writer}
                    refs={refs}
                    showPanelKeys={showPanelKeys}
                  />
                </div>
                <div className="list-editor-order">
                  <button type="button" className="chip-x" aria-label={`Переместить элемент ${i + 1} выше`} disabled={i === 0} onClick={() => emit({ op: 'move', path: at(key), from: i, to: i - 1 })}>↑</button>
                  <button type="button" className="chip-x" aria-label={`Переместить элемент ${i + 1} ниже`} disabled={i === list.length - 1} onClick={() => emit({ op: 'move', path: at(key), from: i, to: i + 1 })}>↓</button>
                </div>
                <button type="button" className="chip-x" aria-label={`Удалить элемент ${i + 1}`} onClick={() => emit({ op: 'remove', path: [...at(key), i] })}>✕</button>
              </div>
            ))}
            <Button onClick={() => emit({ op: 'insert', path: at(key), index: list.length, value: item.starter?.() ?? {} })}>+ Добавить</Button>
          </div>
          <span className="field-hint">{hint}</span>
        </div>
      )
    }
    if (item.kind === 'number') {
      return (
        <StringListField
          key={field.key}
          label={field.key}
          hint={hint}
          value={list.map((v) => String(v))}
          onChange={(v) => setOrRemove(field.key, v?.map((s) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s)))}
        />
      )
    }
    if (item.enum !== undefined) {
      const options = withCurrentAll(item.enum.map((e) => ({ value: e.value, label: e.value })), list.map(String))
      return (
        <MultiSelectField
          key={field.key}
          label={field.key}
          hint={hint}
          options={options}
          value={list.length > 0 ? list.map(String) : undefined}
          onChange={(v) => setOrRemove(field.key, v)}
        />
      )
    }
    return (
      <StringListField
        key={field.key}
        label={field.key}
        hint={hint}
        value={list.length > 0 ? list.map(String) : undefined}
        onChange={(v) => setOrRemove(field.key, v)}
      />
    )
  }

  return (
    <>
      {filled.map(row)}
      {unknown.map((key) => (
        <ReadOnly key={`unknown:${key}`} label={key} hint={UNKNOWN_KEY_NOTE} value={value[key]} />
      ))}
      {rest.length > 0 && (
        <CollapsibleSection title={moreFieldsTitle(rest.length)}>{rest.map(row)}</CollapsibleSection>
      )}
    </>
  )
}

/** Значения документа вне перечисления добавляются пунктами — битая ссылка должна быть видима и снимаема */
function withCurrentAll(options: SelectOption[], current: string[]): SelectOption[] {
  const all = [...options]
  for (const c of current) if (!all.some((o) => o.value === c)) all.push({ value: c, label: c })
  return all
}
```

Замечания для исполнителя:
- `KeyValueField` читает значение при монтировании (см. комментарий в `collections.tsx`) — оборачивайте карту в `key`, зависящий от `JSON.stringify(current)`, только если тест на карту не проходит из-за устаревшего буфера; в описанном тесте одно изменение, буфера хватает.
- `StringListField` тоже держит локальный текст: перерисовка с новым значением ждёт remount. Внутри `SchemaForm` это проявится только при внешней смене документа — инспектор уже монтирует формы с `key={shownId}`.
- Числовой список: не число пишется строкой как есть — подменять набранное форма не вправе (тот же выбор, что в `SingboxRuleForm.port`).
- `CollapsibleSection` рендерит заголовок кнопкой — тест ищет `getByRole('button', { name: 'tls' })`. Проверьте, что так и есть; если заголовок не кнопка, добавьте `aria-expanded`-кнопку внутрь `CollapsibleSection` (это общий компонент: изменение обязано оставить зелёными существующие тесты, которые его используют).

- [ ] **Step 6: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/schema-form.test.tsx`
Expected: PASS, 16 тестов.

- [ ] **Step 7: Мутации**

1. Убрать `unknown.map(...)` из вывода — тест «неизвестный ключ виден» красный. Вернуть.
2. В `setOrRemove` заменить условие пустоты на `false` — тест «пустая строка — remove» красный. Вернуть.
3. В `shapeFits` вернуть `true` всегда — тест «значение не той формы» красный. Вернуть.
4. В `row` убрать ветку замка — тест замка красный. Вернуть.

- [ ] **Step 8: Typecheck и коммит**

```bash
git add frontend/src/features/inspector/schema frontend/test/schemaHelpers.ts frontend/test/schema-form.test.tsx
git commit -m "feat(frontend): schema-driven form renderer emitting path operations"
```

---

### Task 6: Обобщённый движок рецептов

**Files:**
- Create: `frontend/src/shared/recipes/types.ts`
- Create: `frontend/src/features/recipes/xrayRecipes.tsx`
- Modify: `frontend/src/features/recipes/RecipesDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx:150-160` (монтирование диалога)
- Test: `frontend/test/recipes-generic.test.tsx`; контрольная группа — существующие тесты диалога рецептов (найти: `grep -l RecipesDialog frontend/test/*.tsx`) должны пройти без правок.

**Interfaces:**
- Produces в `shared/recipes/types.ts`:

```ts
export interface RecipeChange { status: 'add' | 'exists'; text: string }
export interface RecipeNote { text: string; needsGeo?: true }
export interface RecipePlan<TModel> { model: TModel; changes: RecipeChange[]; notes: RecipeNote[] }
export interface Recipe<TModel, TParams> {
  id: string
  title: string
  summary: string
  defaults: TParams
  validate(params: TParams): string | null
  plan(model: TModel, params: TParams): RecipePlan<TModel>
}
```

- Produces в `RecipesDialog.tsx`:

```ts
export interface RecipeEntry<TModel, TParams = unknown> {
  recipe: Recipe<TModel, TParams>
  Form: (props: { value: TParams; onChange: (v: TParams) => void; model: TModel }) => ReactNode
}
export function RecipesDialog<TModel>(props: {
  open: boolean
  model: TModel
  entries: RecipeEntry<TModel, any>[]
  /** Текст для diff: у JSON-документов — JSON.stringify(model, null, 2) */
  print: (model: TModel) => string
  onApply: (model: TModel) => void
  onOpenGeo?: () => void
  onClose: () => void
}): JSX.Element
```

- Produces в `xrayRecipes.tsx`: `XRAY_RECIPES: RecipeEntry<XrayConfig>[]` — шесть записей поверх существующих `planWarp`/`planTorrent`/… и форм `WarpForm`, `TorrentForm`, `BlockForm`, `ChainForm`, `BalanceForm`; `RecipePlan` Xray (`config`) переводится в обобщённый (`model`) обёрткой, сами файлы `entities/xray/recipes/*` не меняются.

- [ ] **Step 1: Написать падающий тест на обобщённый диалог**

`frontend/test/recipes-generic.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecipesDialog, type RecipeEntry } from '../src/features/recipes/RecipesDialog'
import { TextField } from '../src/features/inspector/fields'

interface Model { items: string[] }
interface Params { name: string }

const ADD: RecipeEntry<Model, Params> = {
  recipe: {
    id: 'add',
    title: 'Добавить элемент',
    summary: 'Кладёт имя в список',
    defaults: { name: 'x' },
    validate: (p) => (p.name.trim() === '' ? 'Укажите имя' : null),
    plan: (m, p) =>
      m.items.includes(p.name)
        ? { model: m, changes: [{ status: 'exists', text: `${p.name} — уже есть` }], notes: [] }
        : { model: { items: [...m.items, p.name] }, changes: [{ status: 'add', text: p.name }], notes: [{ text: 'заметка' }] },
  },
  Form: ({ value, onChange }) => (
    <TextField label="Имя" value={value.name} onChange={(v) => onChange({ name: v ?? '' })} />
  ),
}

describe('обобщённый диалог рецептов', () => {
  it('показывает план по модели и применяет его', async () => {
    const onApply = vi.fn()
    render(
      <RecipesDialog open model={{ items: [] }} entries={[ADD]} print={(m) => JSON.stringify(m)} onApply={onApply} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /Добавить элемент/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.getByText('заметка')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(onApply).toHaveBeenCalledWith({ items: ['x'] })
  })

  it('без новых изменений кнопка «Применить» выключена, ошибка параметров видна', async () => {
    render(
      <RecipesDialog open model={{ items: ['x'] }} entries={[ADD]} print={(m) => JSON.stringify(m)} onApply={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Имя'))
    expect(screen.getByText('Укажите имя')).toBeInTheDocument()
  })

  it('закрытый диалог не рисует форм', () => {
    render(
      <RecipesDialog open={false} model={{ items: [] }} entries={[ADD]} print={(m) => JSON.stringify(m)} onApply={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.queryByLabelText('Имя')).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/recipes-generic.test.tsx`
Expected: FAIL — у `RecipesDialog` нет пропа `entries`.

- [ ] **Step 3: Типы и обобщение диалога**

`frontend/src/shared/recipes/types.ts`:

```ts
// Рецепт над моделью документа — движок один на три ядра. План возвращает
// новую модель, список изменений для предпросмотра и заметки; вход не
// мутируется, повторное применение не добавляет ничего (идемпотентность —
// забота самого рецепта, а не диалога).

export interface RecipeChange {
  status: 'add' | 'exists'
  text: string
}

/** needsGeo включает в диалоге кнопку «Geo-базы» — у ядер без geo-баз её нет */
export interface RecipeNote {
  text: string
  needsGeo?: true
}

export interface RecipePlan<TModel> {
  model: TModel
  changes: RecipeChange[]
  notes: RecipeNote[]
}

export interface Recipe<TModel, TParams> {
  id: string
  title: string
  summary: string
  defaults: TParams
  validate(params: TParams): string | null
  plan(model: TModel, params: TParams): RecipePlan<TModel>
}
```

`frontend/src/features/recipes/RecipesDialog.tsx` — переписать целиком:

```tsx
// Диалог рецептов, обобщённый по модели: список слева, форма параметров и
// предпросмотр справа, diff по кнопке. Реестр Xray стал первым экземпляром
// (`xrayRecipes.tsx`), поведение и разметка у него прежние — его тесты
// контрольная группа этого обобщения.

import { useMemo, useState, type ReactNode } from 'react'
import type { Recipe, RecipePlan } from '../../shared/recipes/types'
import { Button, Dialog } from '../../shared/ui'
import { DiffView } from '../editor/DiffView'

export interface RecipeEntry<TModel, TParams = unknown> {
  recipe: Recipe<TModel, TParams>
  Form: (props: { value: TParams; onChange: (v: TParams) => void; model: TModel }) => ReactNode
}

interface Props<TModel> {
  open: boolean
  model: TModel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- параметры у рецептов разные, пара recipe/Form согласована внутри записи
  entries: RecipeEntry<TModel, any>[]
  /** Текст для diff: у JSON-документов — JSON.stringify(model, null, 2) */
  print: (model: TModel) => string
  onApply: (model: TModel) => void
  /** Кнопка «Geo-базы» у заметок с needsGeo; у ядер без geo-баз не передаётся */
  onOpenGeo?: () => void
  onClose: () => void
}

export function RecipesDialog<TModel>({ open, model, entries, print, onApply, onOpenGeo, onClose }: Props<TModel>) {
  const [id, setId] = useState(entries[0]?.recipe.id ?? '')
  // Параметры всех рецептов держим сразу: переключение списка не теряет введённое
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(entries.map((e) => [e.recipe.id, e.recipe.defaults])),
  )
  const [diff, setDiff] = useState(false)

  const entry = entries.find((e) => e.recipe.id === id) ?? entries[0]
  const current = entry === undefined ? undefined : params[entry.recipe.id] ?? entry.recipe.defaults

  // Закрытый диалог не считает план и не рисует формы: иначе их поля и кнопки
  // остаются в дереве доступности и перехватывают поиск по подписям на всей странице
  const plan = useMemo<RecipePlan<TModel>>(
    () => (open && entry ? entry.recipe.plan(model, current) : { model, changes: [], notes: [] }),
    [open, entry, model, current],
  )
  const error = entry ? entry.recipe.validate(current) : null
  const canApply = error === null && plan.changes.some((c) => c.status === 'add')

  function apply() {
    onApply(plan.model)
    setDiff(false)
    onClose()
  }

  return (
    <Dialog open={open} title="Рецепты" onClose={onClose} wide>
      {!open || entry === undefined ? null : diff ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Слева — текущий черновик, справа — каким он станет после рецепта.
          </p>
          <DiffView original={print(model)} modified={print(plan.model)} maxHeight="55vh" />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setDiff(false)}>
              ← К параметрам
            </Button>
            <span className="spacer" />
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="recipes-layout">
            <div className="recipe-list">
              {entries.map((e) => (
                <button
                  key={e.recipe.id}
                  type="button"
                  className={e.recipe.id === entry.recipe.id ? 'recipe-item recipe-item-active' : 'recipe-item'}
                  aria-pressed={e.recipe.id === entry.recipe.id}
                  onClick={() => setId(e.recipe.id)}
                >
                  <span className="recipe-item-title">{e.recipe.title}</span>
                  <span className="recipe-item-summary">{e.recipe.summary}</span>
                </button>
              ))}
            </div>

            <div className="recipe-body">
              <entry.Form
                value={current}
                model={model}
                onChange={(v) => setParams({ ...params, [entry.recipe.id]: v })}
              />

              <h3 className="recipe-preview-title">Будет добавлено</h3>
              <ul className="recipe-changes" aria-label="Изменения рецепта">
                {plan.changes.map((c, i) => (
                  <li key={`${c.text}:${i}`} className={c.status === 'add' ? 'recipe-add' : 'recipe-exists'}>
                    <span aria-hidden="true">{c.status === 'add' ? '+' : '✓'}</span> {c.text}
                  </li>
                ))}
              </ul>

              {plan.notes.map((n) => (
                <p key={n.text} className="recipe-note">
                  {n.text}
                  {n.needsGeo === true && onOpenGeo !== undefined && (
                    <Button variant="ghost" onClick={onOpenGeo}>
                      Geo-базы
                    </Button>
                  )}
                </p>
              ))}

              {error !== null && <span className="field-error">{error}</span>}
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <span className="spacer" />
            <Button onClick={() => setDiff(true)}>Показать diff</Button>
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
```

- [ ] **Step 4: Реестр Xray как первый экземпляр**

`frontend/src/features/recipes/xrayRecipes.tsx`:

```tsx
// Шесть рецептов Xray-профиля как записи обобщённого диалога. Сами рецепты
// (`entities/xray/recipes`) не меняются: их план отдаёт `config`, обёртка
// переводит его в `model`. Поля форм получают теги из модели здесь, а не через
// пропы диалога — у диалога модели вида документа больше нет.

import type { XrayConfig } from '../../entities/xray'
import {
  BALANCE_DEFAULTS,
  BLOCK_DEFAULTS,
  CHAIN_DEFAULTS,
  RECIPES,
  TORRENT_DEFAULTS,
  WARP_DEFAULTS,
  planAds,
  planBalance,
  planChain,
  planPrivate,
  planTorrent,
  planWarp,
  validateBalance,
  validateBlock,
  validateChain,
  validateWarp,
  type BalanceParams,
  type BlockParams,
  type ChainParams,
  type RecipeId,
  type RecipePlan as XrayPlan,
  type TorrentParams,
  type WarpParams,
} from '../../entities/xray'
import type { RecipePlan } from '../../shared/recipes/types'
import { BalanceForm } from './forms/BalanceForm'
import { BlockForm } from './forms/BlockForm'
import { ChainForm } from './forms/ChainForm'
import { TorrentForm } from './forms/TorrentForm'
import { WarpForm } from './forms/WarpForm'
import type { RecipeEntry } from './RecipesDialog'

function toModel(plan: XrayPlan): RecipePlan<XrayConfig> {
  return { model: plan.config, changes: plan.changes, notes: plan.notes }
}

function meta(id: RecipeId): { id: string; title: string; summary: string } {
  const found = RECIPES.find((r) => r.id === id)!
  return { id: found.id, title: found.title, summary: found.summary }
}

const inboundTags = (c: XrayConfig) =>
  (c.inbounds ?? []).map((i) => i.tag).filter((t): t is string => typeof t === 'string')
const outboundTags = (c: XrayConfig) =>
  (c.outbounds ?? []).map((o) => o.tag).filter((t): t is string => typeof t === 'string')

const warp: RecipeEntry<XrayConfig, WarpParams> = {
  recipe: { ...meta('warp'), defaults: WARP_DEFAULTS, validate: validateWarp, plan: (m, p) => toModel(planWarp(m, p)) },
  Form: ({ value, onChange }) => <WarpForm value={value} onChange={onChange} />,
}
const torrent: RecipeEntry<XrayConfig, TorrentParams> = {
  recipe: { ...meta('torrent'), defaults: TORRENT_DEFAULTS, validate: validateBlock, plan: (m, p) => toModel(planTorrent(m, p)) },
  Form: ({ value, onChange, model }) => <TorrentForm value={value} inboundTags={inboundTags(model)} onChange={onChange} />,
}
const ads: RecipeEntry<XrayConfig, BlockParams> = {
  recipe: { ...meta('ads'), defaults: BLOCK_DEFAULTS, validate: validateBlock, plan: (m, p) => toModel(planAds(m, p)) },
  Form: ({ value, onChange }) => <BlockForm value={value} onChange={onChange} />,
}
const priv: RecipeEntry<XrayConfig, BlockParams> = {
  recipe: { ...meta('private'), defaults: BLOCK_DEFAULTS, validate: validateBlock, plan: (m, p) => toModel(planPrivate(m, p)) },
  Form: ({ value, onChange }) => <BlockForm value={value} onChange={onChange} />,
}
const chain: RecipeEntry<XrayConfig, ChainParams> = {
  recipe: { ...meta('chain'), defaults: CHAIN_DEFAULTS, validate: validateChain, plan: (m, p) => toModel(planChain(m, p)) },
  Form: ({ value, onChange, model }) => <ChainForm value={value} outboundTags={outboundTags(model)} onChange={onChange} />,
}
const balance: RecipeEntry<XrayConfig, BalanceParams> = {
  recipe: { ...meta('balance'), defaults: BALANCE_DEFAULTS, validate: validateBalance, plan: (m, p) => toModel(planBalance(m, p)) },
  Form: ({ value, onChange, model }) => <BalanceForm value={value} outboundTags={outboundTags(model)} onChange={onChange} />,
}

/** Порядок — как в RECIPES: warp, torrent, ads, private, chain, balance */
export const XRAY_RECIPES: RecipeEntry<XrayConfig, any>[] = [warp, torrent, ads, priv, chain, balance]
```

Проверьте экспорт из `entities/xray/index.ts`: `RECIPES`, `planWarp` и остальные там есть (`recipes/index.ts` реэкспортирует `./warp`, `./block`, `./chain`, `./balance`); если `entities/xray/index.ts` не реэкспортирует `./recipes`, импортируйте из `'../../entities/xray/recipes'`.

В `frontend/src/features/editor/EditorPage.tsx` монтирование заменить на:

```tsx
<RecipesDialog
  open={recipesOpen}
  model={draft.config}
  entries={XRAY_RECIPES}
  print={(c) => JSON.stringify(c, null, 2)}
  onApply={(next) => { /* прежний обработчик onApply — без изменений */ }}
  onOpenGeo={/* прежний */}
  onClose={() => setRecipesOpen(false)}
/>
```

(имена `draft.config`/обработчиков возьмите из текущего кода на строках 150–160 — меняются только `config` → `model` и появление `entries`/`print`).

- [ ] **Step 5: Запустить новый тест и контрольную группу**

Run: `cd frontend && npx vitest run test/recipes-generic.test.tsx $(grep -l RecipesDialog test/*.tsx | tr '\n' ' ')`
Expected: PASS без правок существующих тестов. Если существующий тест рендерит `<RecipesDialog config={...}>` напрямую (а не через страницу), правка контракта его сломает — тогда, и только тогда, поменяйте в нём `config=` на `model=` плюс `entries={XRAY_RECIPES}` и `print`, и зафиксируйте это в отчёте как единственное отклонение от «без правок».

- [ ] **Step 6: Мутации**

1. В `canApply` заменить `some((c) => c.status === 'add')` на `true` — тест «кнопка выключена» красный. Вернуть.
2. В `plan` убрать условие `open &&` — тест «закрытый диалог не рисует форм» не краснеет (форма рисуется по `!open ? null`), а вот план считается впустую: добавьте в тест `expect(spy).not.toHaveBeenCalled()` по `vi.fn()`-обёртке над `plan`, и мутация красная. Вернуть.

- [ ] **Step 7: Typecheck и коммит**

```bash
git add frontend/src/shared/recipes frontend/src/features/recipes/RecipesDialog.tsx frontend/src/features/recipes/xrayRecipes.tsx frontend/src/features/editor/EditorPage.tsx frontend/test/recipes-generic.test.tsx
git commit -m "feat(frontend): recipe engine generalised over the document model"
```

---

## Часть B. Sing-box целиком

Схема ядра пишется по ветвям, каждая ветвь — свой файл и своя задача; сборка корня — задача 13. Все ветви используют строители и фрагменты из `schema/shared.ts` (задача 7). Русские описания ключей из старого `docSchema.ts` переносятся дословно, где ключ тот же.

Правило совпадающих ключей: у одного объекта два описания одного ключа допустимы, только если их условия `when` взаимно исключают друг друга (например, `version` у `socks` — перечисление строк, у `shadowtls` — число). Тест полноты в задаче 13 проверяет это по каждому значению `type`.

Версии ядра в `since`/`deprecated` взяты со страниц `sing-box.sagernet.org/configuration/*` на 2026-09-09 и перечислены прямо в коде; исполнитель не меняет их по памяти.

### Task 7: Строители и общие фрагменты схемы

**Files:**
- Create: `frontend/src/entities/singbox/schema/shared.ts`
- Test: `frontend/test/singbox-schema-shared.test.ts`

**Interfaces:**
- Consumes: типы задачи 1.
- Produces: строители `str`, `num`, `bool`, `en`, `strs`, `nums`, `obj`, `objs`, `map`, `when`, `whenNot`, `withWhen`, `removed`, `tagLabel`; перечисления `STRATEGY_VALUES`, `NETWORK_VALUES`, `NETWORK_TYPE_VALUES`, `FINGERPRINT_VALUES`, `SS_METHOD_VALUES`, `SNIFFER_VALUES`; фрагменты `DOMAIN_RESOLVER_FIELDS`, `DIAL_FIELDS`, `LISTEN_FIELDS`, `TLS_FIELDS`, `TRANSPORT_FIELDS`, `MULTIPLEX_FIELDS`, `UDP_OVER_TCP_FIELDS`; готовые поля `tlsObject(extra?)`, `transportObject(extra?)`, `multiplexObject(extra?)`, `domainResolverObject(key, doc, extra?)`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/singbox-schema-shared.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DIAL_FIELDS,
  LISTEN_FIELDS,
  MULTIPLEX_FIELDS,
  TLS_FIELDS,
  TRANSPORT_FIELDS,
  en,
  obj,
  str,
  tagLabel,
  when,
  whenNot,
  withWhen,
} from '../src/entities/singbox/schema/shared'
import { visibleFields } from '../src/shared/schema'

const keys = (f: { key: string }[]) => f.map((x) => x.key)

describe('строители', () => {
  it('собирают поле нужного вида и не теряют дополнительных свойств', () => {
    expect(str('tag', 'Имя.', { ref: 'outbound' })).toEqual({ key: 'tag', doc: 'Имя.', kind: 'string', ref: 'outbound' })
    expect(en('type', 'Тип.', ['a', { value: 'b', doc: 'Б' }]).enum).toEqual([{ value: 'a' }, { value: 'b', doc: 'Б' }])
    expect(obj('tls', 'TLS.', [str('x', 'X.')]).fields).toHaveLength(1)
    expect(when('type', 'vless', 'vmess')).toEqual({ key: 'type', in: ['vless', 'vmess'] })
    expect(whenNot('type', 'selector')).toEqual({ key: 'type', notIn: ['selector'] })
  })

  it('withWhen вешает условие на каждое поле фрагмента, не трогая исходник', () => {
    const cond = when('type', 'tun')
    const out = withWhen(LISTEN_FIELDS, cond)
    expect(out.every((f) => f.when === cond)).toBe(true)
    expect(LISTEN_FIELDS.every((f) => f.when === undefined)).toBe(true)
  })

  it('tagLabel подписывает элемент тегом либо номером', () => {
    expect(tagLabel({ tag: 'wg' }, 0)).toBe('wg')
    expect(tagLabel({}, 2)).toBe('#3')
  })
})

describe('фрагменты ядра', () => {
  it('dial-поля: ключевые есть, domain_strategy устарел с 1.12.0 в пользу domain_resolver', () => {
    expect(keys(DIAL_FIELDS)).toEqual(expect.arrayContaining([
      'detour', 'bind_interface', 'inet4_bind_address', 'inet6_bind_address', 'bind_address_no_port',
      'routing_mark', 'reuse_addr', 'netns', 'connect_timeout', 'tcp_fast_open', 'tcp_multi_path',
      'disable_tcp_keep_alive', 'tcp_keep_alive', 'tcp_keep_alive_interval', 'udp_fragment',
      'domain_resolver', 'network_strategy', 'network_type', 'fallback_network_type', 'fallback_delay',
      'domain_strategy',
    ]))
    const legacy = DIAL_FIELDS.find((f) => f.key === 'domain_strategy')!
    expect(legacy.deprecated?.since).toBe('1.12.0')
    expect(legacy.deprecated?.replacement).toMatch(/domain_resolver/)
    expect(DIAL_FIELDS.find((f) => f.key === 'detour')?.ref).toBe('outbound')
  })

  it('listen-поля: sniff-группа устарела с 1.11.0', () => {
    expect(keys(LISTEN_FIELDS)).toEqual(expect.arrayContaining([
      'listen', 'listen_port', 'tcp_fast_open', 'tcp_multi_path', 'udp_fragment', 'udp_timeout', 'detour',
      'sniff', 'sniff_override_destination', 'sniff_timeout', 'domain_strategy', 'udp_disable_domain_unmapping',
    ]))
    for (const k of ['sniff', 'sniff_override_destination', 'sniff_timeout', 'domain_strategy', 'udp_disable_domain_unmapping']) {
      expect(LISTEN_FIELDS.find((f) => f.key === k)?.deprecated?.since, k).toBe('1.11.0')
    }
  })

  it('tls: клиентские поля, utls и reality вложены, серверных ключей нет', () => {
    expect(keys(TLS_FIELDS)).toEqual(expect.arrayContaining([
      'enabled', 'disable_sni', 'server_name', 'insecure', 'alpn', 'min_version', 'max_version',
      'cipher_suites', 'certificate', 'certificate_path', 'fragment', 'fragment_fallback_delay',
      'record_fragment', 'ech', 'utls', 'reality',
    ]))
    expect(keys(TLS_FIELDS)).not.toContain('key')
    const utls = TLS_FIELDS.find((f) => f.key === 'utls')!
    expect(keys(utls.fields!)).toEqual(['enabled', 'fingerprint'])
    expect(utls.fields!.find((f) => f.key === 'fingerprint')?.enum?.map((e) => e.value)).toContain('chrome')
    const reality = TLS_FIELDS.find((f) => f.key === 'reality')!
    expect(keys(reality.fields!)).toEqual(['enabled', 'public_key', 'short_id'])
  })

  it('transport: поля по типу; у ws есть max_early_data, у grpc — service_name', () => {
    const t = TRANSPORT_FIELDS
    expect(visibleFields(t, { type: 'ws' }).map((f) => f.key)).toEqual(expect.arrayContaining(['path', 'headers', 'max_early_data', 'early_data_header_name']))
    expect(visibleFields(t, { type: 'grpc' }).map((f) => f.key)).toEqual(expect.arrayContaining(['service_name', 'idle_timeout', 'ping_timeout', 'permit_without_stream']))
    expect(visibleFields(t, { type: 'quic' }).map((f) => f.key)).toEqual(['type'])
  })

  it('multiplex: протоколы и brutal', () => {
    expect(keys(MULTIPLEX_FIELDS)).toEqual(['enabled', 'protocol', 'max_connections', 'min_streams', 'max_streams', 'padding', 'brutal'])
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-schema-shared.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/singbox/schema/shared.ts`:

```ts
// Строители полей и фрагменты, которые ядро переиспользует между ветвями:
// dial-поля (у выходов, конечных точек, части DNS-серверов, ntp), listen-поля
// (у входов, кроме tun), tls, transport, multiplex. Фрагмент описан один раз и
// вставляется по месту: вторая копия разошлась бы с первой на первом же ключе.
//
// Версии в since/deprecated — со страниц sing-box.sagernet.org/configuration/*
// на 2026-09-09. Панель нацелена на 1.13.x; ключи 1.14 описаны как существующие
// (пометка since), удалённые — как устаревшие с заменой: документ с ними
// открывается без потерь.

import type {
  Condition,
  Deprecation,
  EnumValue,
  FieldSchema,
  ListItemSchema,
} from '../../../shared/schema'

type Extra = Partial<Omit<FieldSchema, 'key' | 'doc' | 'kind'>>

export const str = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'string', ...extra })
export const num = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'number', ...extra })
export const bool = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'boolean', ...extra })
export const map = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'map', ...extra })

export const en = (key: string, doc: string, values: (string | EnumValue)[], extra: Extra = {}): FieldSchema => ({
  key,
  doc,
  kind: 'enum',
  enum: values.map((v) => (typeof v === 'string' ? { value: v } : v)),
  ...extra,
})

/** Список строк; `values` — известные значения элементов (network: tcp/udp) */
export const strs = (key: string, doc: string, extra: Extra & { values?: (string | EnumValue)[]; ref?: FieldSchema['ref'] } = {}): FieldSchema => {
  const { values, ref, ...rest } = extra
  const item: ListItemSchema = { kind: 'string' }
  if (values !== undefined) item.enum = values.map((v) => (typeof v === 'string' ? { value: v } : v))
  if (ref !== undefined) item.ref = ref
  return { key, doc, kind: 'list', item, ...rest }
}

export const nums = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'number' }, ...extra })

export const obj = (key: string, doc: string, fields: FieldSchema[], extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'object', fields, ...extra })

/** Список объектов; `item` — подпись и стартер элемента */
export const objs = (
  key: string,
  doc: string,
  fields: FieldSchema[],
  item: Pick<ListItemSchema, 'label' | 'starter'> = {},
  extra: Extra = {},
): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'object', fields, ...item }, ...extra })

export const when = (key: string, ...values: string[]): Condition => ({ key, in: values })
export const whenNot = (key: string, ...values: string[]): Condition => ({ key, notIn: values })

/** Копия фрагмента с условием на каждом поле; исходный фрагмент не трогается */
export const withWhen = (fields: FieldSchema[], cond: Condition): FieldSchema[] => fields.map((f) => ({ ...f, when: cond }))

export const removed = (since: string, replacement: string): Deprecation => ({ since, replacement })

/** Подпись элемента списка: тег, иначе номер */
export const tagLabel = (value: unknown, index: number): string => {
  const tag = (value as { tag?: unknown } | null)?.tag
  return typeof tag === 'string' && tag !== '' ? tag : `#${index + 1}`
}

// ── перечисления ──────────────────────────────────────────────────────────

export const STRATEGY_VALUES: EnumValue[] = [
  { value: 'prefer_ipv4', doc: 'Сначала IPv4, потом IPv6.' },
  { value: 'prefer_ipv6', doc: 'Сначала IPv6, потом IPv4.' },
  { value: 'ipv4_only', doc: 'Только IPv4.' },
  { value: 'ipv6_only', doc: 'Только IPv6.' },
]

export const NETWORK_VALUES: EnumValue[] = [{ value: 'tcp' }, { value: 'udp' }]

export const NETWORK_TYPE_VALUES: EnumValue[] = [{ value: 'wifi' }, { value: 'cellular' }, { value: 'ethernet' }, { value: 'other' }]

export const FINGERPRINT_VALUES: EnumValue[] = ['chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized'].map((value) => ({ value }))

export const SS_METHOD_VALUES: EnumValue[] = [
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'none', 'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
  'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr', 'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb', 'rc4-md5', 'chacha20-ietf', 'xchacha20',
].map((value) => ({ value }))

export const SNIFFER_VALUES: EnumValue[] = ['http', 'tls', 'quic', 'stun', 'dns', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp'].map((value) => ({ value }))

// ── фрагменты ─────────────────────────────────────────────────────────────

/** Поля объекта domain_resolver; по форме совпадают с действием route DNS-правила без `action` */
export const DOMAIN_RESOLVER_FIELDS: FieldSchema[] = [
  str('server', 'Тег DNS-сервера, которым разрешать домены.', { ref: 'dns-server' }),
  en('strategy', 'Какие адреса запрашивать.', STRATEGY_VALUES),
  bool('disable_cache', 'Не кэшировать ответы.'),
  bool('disable_optimistic_cache', 'Не отдавать протухший кэш до обновления.', { since: '1.14.0' }),
  num('rewrite_ttl', 'Переписать TTL ответа, секунд.'),
  str('client_subnet', 'EDNS0 client-subnet для запроса.'),
  bool('remove_client_subnet', 'Не отправлять client-subnet.', { since: '1.14.0' }),
  str('timeout', 'Таймаут запроса, например 10s.', { since: '1.14.0' }),
]

export const domainResolverObject = (key: string, doc: string, extra: Extra = {}): FieldSchema =>
  obj(key, doc, DOMAIN_RESOLVER_FIELDS, extra)

/** Dial-поля: как ядро устанавливает исходящее соединение */
export const DIAL_FIELDS: FieldSchema[] = [
  str('detour', 'Через какой выход устанавливать это соединение — цепочка прокси. При заданном detour остальные dial-поля не действуют.', { ref: 'outbound' }),
  str('bind_interface', 'Имя сетевого интерфейса, с которого выходить.'),
  str('inet4_bind_address', 'Исходящий адрес IPv4.'),
  str('inet6_bind_address', 'Исходящий адрес IPv6.'),
  bool('bind_address_no_port', 'Не резервировать порт при привязке адреса (Linux).', { since: '1.13.0' }),
  num('routing_mark', 'Метка netfilter для исходящих соединений (Linux).'),
  bool('reuse_addr', 'Переиспользовать адрес слушателя.'),
  str('netns', 'Сетевое пространство имён Linux: имя, путь или тег.', { since: '1.12.0' }),
  str('connect_timeout', 'Таймаут установки соединения, например 5s.'),
  bool('tcp_fast_open', 'TCP Fast Open.'),
  bool('tcp_multi_path', 'Multipath TCP.'),
  bool('disable_tcp_keep_alive', 'Отключить TCP keep-alive.', { since: '1.13.0' }),
  str('tcp_keep_alive', 'Первый keep-alive через это время, по умолчанию 5m.', { since: '1.13.0' }),
  str('tcp_keep_alive_interval', 'Интервал keep-alive, по умолчанию 75s.', { since: '1.13.0' }),
  bool('udp_fragment', 'Разрешить фрагментацию UDP.'),
  domainResolverObject('domain_resolver', 'Каким DNS-сервером разрешать домен сервера. С 1.14 при доменном адресе обязателен.', { since: '1.12.0' }),
  en('network_strategy', 'Стратегия выбора сети у графических клиентов.', ['default', 'hybrid', 'fallback'], { since: '1.11.0' }),
  strs('network_type', 'Предпочитаемые типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  strs('fallback_network_type', 'Запасные типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  str('fallback_delay', 'Задержка перед запасной сетью, по умолчанию 300ms.', { since: '1.11.0' }),
  en('domain_strategy', 'Какие адреса запрашивать для домена сервера.', STRATEGY_VALUES, {
    deprecated: removed('1.12.0', 'объект domain_resolver с полем strategy'),
  }),
]

/** Listen-поля: как вход слушает. У tun свой набор, listen-полей у него нет */
export const LISTEN_FIELDS: FieldSchema[] = [
  str('listen', 'Адрес, который слушает вход.'),
  num('listen_port', 'Порт, который слушает вход.'),
  str('bind_interface', 'Интерфейс, к которому привязан слушатель.', { since: '1.12.0' }),
  num('routing_mark', 'Метка netfilter (Linux).', { since: '1.12.0' }),
  bool('reuse_addr', 'Переиспользовать адрес слушателя.', { since: '1.12.0' }),
  str('netns', 'Сетевое пространство имён Linux.', { since: '1.12.0' }),
  bool('tcp_fast_open', 'TCP Fast Open.'),
  bool('tcp_multi_path', 'Multipath TCP.'),
  bool('disable_tcp_keep_alive', 'Отключить TCP keep-alive.', { since: '1.13.0' }),
  str('tcp_keep_alive', 'Первый keep-alive через это время, по умолчанию 5m.', { since: '1.13.0' }),
  str('tcp_keep_alive_interval', 'Интервал keep-alive, по умолчанию 75s.', { since: '1.13.0' }),
  bool('udp_fragment', 'Разрешить фрагментацию UDP.'),
  str('udp_timeout', 'Время жизни NAT-записи UDP, по умолчанию 5m.'),
  str('detour', 'Передать принятое соединение другому входу.', { ref: 'inbound' }),
  bool('sniff', 'Определять протокол соединения.', { deprecated: removed('1.11.0', 'правило маршрута с action: sniff') }),
  bool('sniff_override_destination', 'Подменять адрес назначения найденным доменом.', { deprecated: removed('1.11.0', 'действие sniff и route-options') }),
  str('sniff_timeout', 'Время на определение протокола.', { deprecated: removed('1.11.0', 'поле timeout действия sniff') }),
  en('domain_strategy', 'Как разрешать домен назначения.', STRATEGY_VALUES, { deprecated: removed('1.11.0', 'правило маршрута с action: resolve') }),
  bool('udp_disable_domain_unmapping', 'Не сопоставлять UDP-ответы обратно с доменом.', { deprecated: removed('1.11.0', 'поле udp_disable_domain_unmapping действия route-options') }),
]

const TLS_VERSION_VALUES: EnumValue[] = ['1.0', '1.1', '1.2', '1.3'].map((value) => ({ value }))

/** Клиентский TLS. Серверных ключей (key, key_path, acme, client_authentication) здесь нет */
export const TLS_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить TLS.'),
  en('engine', 'Реализация TLS.', ['go', 'apple', 'windows'], { since: '1.14.0' }),
  bool('disable_sni', 'Не отправлять имя сервера в ClientHello.'),
  str('server_name', 'Имя сервера для проверки сертификата и SNI.'),
  bool('insecure', 'Принимать любой сертификат.'),
  strs('alpn', 'Список протоколов ALPN.'),
  en('min_version', 'Минимальная версия TLS.', TLS_VERSION_VALUES),
  en('max_version', 'Максимальная версия TLS.', TLS_VERSION_VALUES),
  strs('cipher_suites', 'Разрешённые шифры для TLS 1.0–1.2.'),
  strs('curve_preferences', 'Предпочитаемые кривые.', { since: '1.13.0' }),
  str('certificate', 'Доверенный сертификат сервера в PEM.'),
  str('certificate_path', 'Путь к файлу доверенного сертификата.'),
  strs('certificate_public_key_sha256', 'Отпечатки публичного ключа сервера (base64 SHA-256).', { since: '1.13.0' }),
  strs('client_certificate', 'Клиентский сертификат в PEM (mTLS).', { since: '1.13.0' }),
  str('client_certificate_path', 'Путь к клиентскому сертификату.', { since: '1.13.0' }),
  strs('client_key', 'Клиентский ключ в PEM.', { since: '1.13.0' }),
  str('client_key_path', 'Путь к клиентскому ключу.', { since: '1.13.0' }),
  bool('fragment', 'Дробить ClientHello на несколько сегментов TCP.', { since: '1.12.0' }),
  str('fragment_fallback_delay', 'Ждать столько перед откатом без дробления, по умолчанию 500ms.', { since: '1.12.0' }),
  bool('record_fragment', 'Дробить ClientHello на несколько TLS-записей.', { since: '1.12.0' }),
  str('spoof', 'Поддельное имя сервера для подмены SNI.', { since: '1.14.0' }),
  en('spoof_method', 'Способ подмены.', ['wrong-sequence', 'wrong-checksum', 'wrong-ack', 'wrong-md5', 'wrong-timestamp'], { since: '1.14.0' }),
  bool('kernel_tx', 'kTLS на отправку (Linux).', { since: '1.13.0' }),
  bool('kernel_rx', 'kTLS на приём (Linux).', { since: '1.13.0' }),
  str('handshake_timeout', 'Таймаут рукопожатия, по умолчанию 15s.', { since: '1.14.0' }),
  obj('ech', 'Encrypted Client Hello.', [
    bool('enabled', 'Включить ECH.'),
    strs('config', 'Конфигурация ECH в PEM.'),
    str('config_path', 'Путь к файлу конфигурации ECH.'),
    str('query_server_name', 'Домен для запроса HTTPS-записи с конфигурацией.', { since: '1.13.0' }),
    bool('pq_signature_schemes_enabled', 'Постквантовые схемы подписи.', { deprecated: removed('1.12.0', 'ключ удалён в 1.13, уберите его') }),
    bool('dynamic_record_sizing_disabled', 'Отключить динамический размер записей.', { deprecated: removed('1.12.0', 'ключ удалён в 1.13, уберите его') }),
  ]),
  obj('utls', 'Отпечаток TLS-клиента (uTLS).', [
    bool('enabled', 'Включить uTLS.'),
    en('fingerprint', 'Чей отпечаток изображать; пусто — chrome.', FINGERPRINT_VALUES),
  ]),
  obj('reality', 'Reality на стороне клиента.', [
    bool('enabled', 'Включить Reality.'),
    str('public_key', 'Публичный ключ сервера.'),
    str('short_id', 'Короткий идентификатор: hex до 8 знаков.'),
  ]),
]

export const tlsObject = (extra: Extra = {}): FieldSchema => obj('tls', 'Настройки TLS соединения с сервером.', TLS_FIELDS, extra)

/** Транспорт V2Ray; поля зависят от `type` */
export const TRANSPORT_FIELDS: FieldSchema[] = [
  en('type', 'Вид транспорта.', [
    { value: 'http', doc: 'HTTP/2.' },
    { value: 'ws', doc: 'WebSocket.' },
    { value: 'quic', doc: 'QUIC — дополнительных полей нет.' },
    { value: 'grpc', doc: 'gRPC.' },
    { value: 'httpupgrade', doc: 'HTTPUpgrade.' },
  ]),
  strs('host', 'Список доменов: клиент выбирает случайный.', { when: when('type', 'http') }),
  str('host', 'Домен в заголовке Host.', { when: when('type', 'httpupgrade') }),
  str('path', 'Путь HTTP-запроса.', { when: when('type', 'http', 'ws', 'httpupgrade') }),
  str('method', 'Метод HTTP-запроса.', { when: when('type', 'http') }),
  map('headers', 'Дополнительные заголовки HTTP.', { when: when('type', 'http', 'ws', 'httpupgrade') }),
  str('idle_timeout', 'Простой соединения до проверки живости, по умолчанию 15s.', { when: when('type', 'http', 'grpc') }),
  str('ping_timeout', 'Ожидание ответа на проверку живости, по умолчанию 15s.', { when: when('type', 'http', 'grpc') }),
  num('max_early_data', 'Размер ранних данных в запросе; 0 — выключено.', { when: when('type', 'ws') }),
  str('early_data_header_name', 'Заголовок для ранних данных; Sec-WebSocket-Protocol для совместимости с Xray.', { when: when('type', 'ws') }),
  str('service_name', 'Имя gRPC-службы, по умолчанию TunService.', { when: when('type', 'grpc') }),
  bool('permit_without_stream', 'Слать проверки живости без активных потоков.', { when: when('type', 'grpc') }),
]

export const transportObject = (extra: Extra = {}): FieldSchema => obj('transport', 'Транспорт поверх TLS: WebSocket, gRPC, HTTP/2, HTTPUpgrade, QUIC.', TRANSPORT_FIELDS, extra)

export const MULTIPLEX_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить мультиплексирование.'),
  en('protocol', 'Протокол мультиплексирования; пусто — h2mux.', ['smux', 'yamux', 'h2mux']),
  num('max_connections', 'Максимум соединений.'),
  num('min_streams', 'Минимум потоков до открытия нового соединения.'),
  num('max_streams', 'Максимум потоков в соединении; несовместимо с двумя полями выше.'),
  bool('padding', 'Дополнять пакеты.'),
  obj('brutal', 'TCP Brutal: требует модуль ядра Linux.', [
    bool('enabled', 'Включить Brutal.'),
    num('up_mbps', 'Отдача, Мбит/с.'),
    num('down_mbps', 'Приём, Мбит/с.'),
  ]),
]

export const multiplexObject = (extra: Extra = {}): FieldSchema => obj('multiplex', 'Мультиплексирование соединений.', MULTIPLEX_FIELDS, extra)

export const UDP_OVER_TCP_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить UDP поверх TCP.'),
  num('version', 'Версия протокола: 1 или 2; пусто — 2.', { min: 1 }),
]
```

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-schema-shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Мутации**

1. В `withWhen` вернуть `fields` без копии (мутировать исходник) — тест «не трогая исходник» красный. Вернуть.
2. Убрать `deprecated` у `domain_strategy` в `DIAL_FIELDS` — тест dial красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/schema/shared.ts frontend/test/singbox-schema-shared.test.ts
git commit -m "feat(frontend): shared sing-box schema fragments and field builders"
```

---

### Task 8: Схема выходов и конечных точек

**Files:**
- Create: `frontend/src/entities/singbox/schema/outbounds.ts`
- Create: `frontend/src/entities/singbox/schema/endpoints.ts`
- Test: `frontend/test/singbox-schema-outbounds.test.ts`

**Interfaces:**
- Consumes: задача 7.
- Produces: `OUTBOUND_TYPE_VALUES: EnumValue[]`, `OUTBOUND_FIELDS: FieldSchema[]`, `SERVER_OUTBOUND_TYPES: string[]`, `ENDPOINT_TYPE_VALUES: EnumValue[]`, `ENDPOINT_FIELDS: FieldSchema[]`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/singbox-schema-outbounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ENDPOINT_FIELDS, ENDPOINT_TYPE_VALUES } from '../src/entities/singbox/schema/endpoints'
import { OUTBOUND_FIELDS, OUTBOUND_TYPE_VALUES } from '../src/entities/singbox/schema/outbounds'
import { visibleFields } from '../src/shared/schema'

const keysFor = (type: string) => visibleFields(OUTBOUND_FIELDS, { type }).map((f) => f.key)

describe('схема выходов', () => {
  it('типы: живые без пометки, block/dns/wireguard устарели с заменой', () => {
    const values = OUTBOUND_TYPE_VALUES.map((e) => e.value)
    expect(values).toEqual(expect.arrayContaining([
      'direct', 'selector', 'urltest', 'vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'hysteria',
      'tuic', 'anytls', 'shadowtls', 'ssh', 'tor', 'socks', 'http', 'naive', 'snell', 'bridge', 'block', 'dns', 'wireguard',
    ]))
    for (const t of ['block', 'dns', 'wireguard']) {
      const e = OUTBOUND_TYPE_VALUES.find((v) => v.value === t)!
      expect(e.deprecated?.since, t).toBeDefined()
      expect(e.deprecated?.replacement, t).not.toBe('')
    }
    expect(OUTBOUND_TYPE_VALUES.find((v) => v.value === 'block')?.deprecated?.replacement).toMatch(/reject/)
    expect(OUTBOUND_TYPE_VALUES.find((v) => v.value === 'dns')?.deprecated?.replacement).toMatch(/hijack-dns/)
    expect(OUTBOUND_TYPE_VALUES.find((v) => v.value === 'wireguard')?.deprecated?.replacement).toMatch(/endpoints/)
  })

  it('vless: uuid, flow, tls, transport, multiplex и dial-поля; серверных ключей у группы нет', () => {
    const vless = keysFor('vless')
    expect(vless).toEqual(expect.arrayContaining(['server', 'server_port', 'uuid', 'flow', 'packet_encoding', 'network', 'tls', 'transport', 'multiplex', 'detour', 'domain_resolver']))
    expect(vless).not.toContain('outbounds')
    const sel = keysFor('selector')
    expect(sel).toEqual(expect.arrayContaining(['outbounds', 'default', 'interrupt_exist_connections', 'remnawave']))
    expect(sel).not.toContain('server')
    expect(sel).not.toContain('detour')
  })

  it('urltest: url, interval, tolerance, idle_timeout', () => {
    expect(keysFor('urltest')).toEqual(expect.arrayContaining(['outbounds', 'url', 'interval', 'tolerance', 'idle_timeout', 'interrupt_exist_connections']))
  })

  it('shadowsocks: method из полного списка, plugin, udp_over_tcp; hysteria2: obfs объектом, hysteria: obfs строкой', () => {
    const ss = visibleFields(OUTBOUND_FIELDS, { type: 'shadowsocks' })
    expect(ss.find((f) => f.key === 'method')?.enum?.map((e) => e.value)).toContain('2022-blake3-aes-128-gcm')
    expect(ss.map((f) => f.key)).toEqual(expect.arrayContaining(['password', 'plugin', 'plugin_opts', 'udp_over_tcp', 'multiplex']))
    expect(visibleFields(OUTBOUND_FIELDS, { type: 'hysteria2' }).find((f) => f.key === 'obfs')?.kind).toBe('object')
    expect(visibleFields(OUTBOUND_FIELDS, { type: 'hysteria' }).find((f) => f.key === 'obfs')?.kind).toBe('string')
    expect(keysFor('hysteria2')).toEqual(expect.arrayContaining(['up_mbps', 'down_mbps', 'password', 'server_ports', 'hop_interval', 'tls']))
  })

  it('у каждого типа ключи в видимом наборе не повторяются', () => {
    for (const { value } of OUTBOUND_TYPE_VALUES) {
      const keys = keysFor(value)
      expect(new Set(keys).size, value).toBe(keys.length)
    }
  })

  it('remnawave — ключ панели с includeProxies внутри', () => {
    const panel = OUTBOUND_FIELDS.find((f) => f.key === 'remnawave')!
    expect(panel.panelKey).toBe(true)
    expect(panel.fields?.map((f) => f.key)).toEqual(['includeProxies'])
  })

  it('у всех полей непустое русское описание', () => {
    const walk = (fields: typeof OUTBOUND_FIELDS): void => {
      for (const f of fields) {
        expect(f.doc.trim(), f.key).not.toBe('')
        if (f.fields) walk(f.fields)
        if (f.item?.fields) walk(f.item.fields)
      }
    }
    walk(OUTBOUND_FIELDS)
    walk(ENDPOINT_FIELDS)
  })
})

describe('схема конечных точек', () => {
  it('wireguard: адреса, ключ, пиры списком объектов', () => {
    expect(ENDPOINT_TYPE_VALUES.map((e) => e.value)).toEqual(expect.arrayContaining(['wireguard', 'tailscale']))
    const wg = visibleFields(ENDPOINT_FIELDS, { type: 'wireguard' })
    expect(wg.map((f) => f.key)).toEqual(expect.arrayContaining(['system', 'name', 'mtu', 'address', 'private_key', 'listen_port', 'peers', 'workers', 'detour']))
    const peers = wg.find((f) => f.key === 'peers')!
    expect(peers.item?.kind).toBe('object')
    expect(peers.item?.fields?.map((f) => f.key)).toEqual(['address', 'port', 'public_key', 'pre_shared_key', 'allowed_ips', 'persistent_keepalive_interval', 'reserved'])
  })

  it('tailscale: auth_key, exit_node и прочее; полей wireguard нет', () => {
    const ts = visibleFields(ENDPOINT_FIELDS, { type: 'tailscale' }).map((f) => f.key)
    expect(ts).toEqual(expect.arrayContaining(['state_directory', 'auth_key', 'control_url', 'ephemeral', 'hostname', 'accept_routes', 'exit_node', 'exit_node_allow_lan_access', 'advertise_routes', 'advertise_exit_node', 'udp_timeout']))
    expect(ts).not.toContain('peers')
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-schema-outbounds.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Схема выходов**

`frontend/src/entities/singbox/schema/outbounds.ts`:

```ts
// Выходы: серверы всех протоколов, группы и прямой выход — один список полей,
// развёрнутый условиями по `type`. Один и тот же ключ у разных типов описан
// разными полями (obfs у hysteria2 — объект, у hysteria — строка): условия
// взаимно исключают друг друга, и в видимом наборе ключ один.
//
// Источник: sing-box.sagernet.org/configuration/outbound/* на 2026-09-09.
// Генератор панели подставляет в группы только vless, trojan, shadowsocks и
// hysteria2 — это записано в docs у соответствующих значений type.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  DIAL_FIELDS,
  NETWORK_VALUES,
  SS_METHOD_VALUES,
  UDP_OVER_TCP_FIELDS,
  bool,
  en,
  map,
  multiplexObject,
  num,
  obj,
  removed,
  str,
  strs,
  tlsObject,
  transportObject,
  when,
  whenNot,
  withWhen,
} from './shared'

export const GROUP_TYPES = ['selector', 'urltest']

/** Типы с адресом сервера */
export const SERVER_OUTBOUND_TYPES = [
  'vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'hysteria', 'tuic', 'anytls', 'shadowtls', 'ssh', 'socks', 'http', 'naive', 'snell',
]

const TLS_TYPES = ['vless', 'vmess', 'trojan', 'hysteria2', 'hysteria', 'tuic', 'anytls', 'shadowtls', 'http', 'naive']
const TRANSPORT_TYPES = ['vless', 'vmess', 'trojan']
const MULTIPLEX_TYPES = ['vless', 'vmess', 'trojan', 'shadowsocks']
const NETWORK_TYPES = ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'hysteria', 'tuic', 'socks', 'snell', 'direct']
/** Типы без dial-полей: группы и записи без соединения наружу */
const NO_DIAL_TYPES = [...GROUP_TYPES, 'block', 'dns', 'bridge']

export const OUTBOUND_TYPE_VALUES: EnumValue[] = [
  { value: 'direct', doc: 'Прямое соединение, минуя прокси.' },
  { value: 'selector', doc: 'Группа с ручным выбором. Панель заменит её список тегами серверов подписки.' },
  { value: 'urltest', doc: 'Группа с автовыбором по задержке. Панель заменит её список тегами серверов подписки.' },
  { value: 'vless', doc: 'Сервер VLESS.' },
  { value: 'trojan', doc: 'Сервер Trojan.' },
  { value: 'shadowsocks', doc: 'Сервер Shadowsocks.' },
  { value: 'hysteria2', doc: 'Сервер Hysteria2.' },
  { value: 'vmess', doc: 'Сервер VMess. Панель такие серверы в группы не добавляет.' },
  { value: 'hysteria', doc: 'Сервер Hysteria первой версии. Панель такие серверы в группы не добавляет.' },
  { value: 'tuic', doc: 'Сервер TUIC. Панель такие серверы в группы не добавляет.' },
  { value: 'anytls', doc: 'Сервер AnyTLS (ядро 1.12 и новее). Панель такие серверы в группы не добавляет.' },
  { value: 'shadowtls', doc: 'ShadowTLS: маскировка TLS-рукопожатия под чужой сайт.' },
  { value: 'ssh', doc: 'SSH-туннель.' },
  { value: 'tor', doc: 'Встроенный Tor; в сборку по умолчанию не входит.' },
  { value: 'socks', doc: 'Прокси SOCKS. Панель такие серверы в группы не добавляет.' },
  { value: 'http', doc: 'Прокси HTTP. Панель такие серверы в группы не добавляет.' },
  { value: 'naive', doc: 'NaïveProxy (ядро 1.13 и новее).' },
  { value: 'snell', doc: 'Snell (ядро 1.13 и новее).' },
  { value: 'bridge', doc: 'Мост в системный интерфейс (ядро 1.14 и новее).' },
  { value: 'block', doc: 'Выход-заглушка.', deprecated: removed('1.13.0', 'правило маршрута с action: reject') },
  { value: 'dns', doc: 'Выход для DNS.', deprecated: removed('1.13.0', 'правила маршрута с action: sniff и action: hijack-dns') },
  { value: 'wireguard', doc: 'WireGuard как выход.', deprecated: removed('1.13.0', 'запись type: wireguard в списке endpoints') },
]

const server = when('type', ...SERVER_OUTBOUND_TYPES)

export const OUTBOUND_FIELDS: FieldSchema[] = [
  en('type', 'Тип выхода: протокол сервера, группа выбора или прямой выход.', OUTBOUND_TYPE_VALUES),
  str('tag', 'Имя выхода. По нему на выход ссылаются правила и группы.'),
  str('server', 'Адрес сервера.', { when: server }),
  num('server_port', 'Порт сервера.', { when: server }),

  // ── общие для нескольких протоколов ──
  str('uuid', 'UUID пользователя.', { when: when('type', 'vless', 'vmess', 'tuic') }),
  str('password', 'Пароль.', { when: when('type', 'trojan', 'shadowsocks', 'hysteria2', 'tuic', 'anytls', 'shadowtls', 'socks', 'http', 'naive', 'ssh') }),
  str('username', 'Имя пользователя.', { when: when('type', 'socks', 'http', 'naive') }),
  en('network', 'Транспорт: tcp или udp; пусто — оба.', NETWORK_VALUES, { when: when('type', ...NETWORK_TYPES) }),
  en('packet_encoding', 'Кодирование UDP-пакетов; пусто — xudp.', ['packetaddr', 'xudp'], { when: when('type', 'vless', 'vmess') }),

  // ── vless ──
  en('flow', 'Поток XTLS; пусто — без него.', ['xtls-rprx-vision'], { when: when('type', 'vless') }),

  // ── vmess ──
  en('security', 'Шифрование VMess; пусто — auto.', ['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr'], { when: when('type', 'vmess') }),
  num('alter_id', 'AlterID: 0 — AEAD, 1 — старый режим.', { when: when('type', 'vmess') }),
  bool('global_padding', 'Дополнять пакеты.', { when: when('type', 'vmess') }),
  bool('authenticated_length', 'Аутентифицировать длину.', { when: when('type', 'vmess') }),

  // ── shadowsocks ──
  en('method', 'Шифр Shadowsocks.', SS_METHOD_VALUES, { when: when('type', 'shadowsocks') }),
  en('plugin', 'SIP003-плагин.', ['obfs-local', 'v2ray-plugin'], { when: when('type', 'shadowsocks') }),
  str('plugin_opts', 'Параметры плагина.', { when: when('type', 'shadowsocks') }),
  obj('udp_over_tcp', 'UDP поверх TCP; несовместимо с multiplex.', UDP_OVER_TCP_FIELDS, { when: when('type', 'shadowsocks', 'socks', 'naive') }),

  // ── hysteria2 ──
  strs('server_ports', 'Диапазоны портов для прыжков, например 2080:3000.', { when: when('type', 'hysteria2', 'hysteria'), since: '1.11.0' }),
  str('hop_interval', 'Период смены порта, по умолчанию 30s.', { when: when('type', 'hysteria2', 'hysteria'), since: '1.11.0' }),
  str('hop_interval_max', 'Верхняя граница случайного периода смены порта.', { when: when('type', 'hysteria2'), since: '1.14.0' }),
  num('up_mbps', 'Отдача, Мбит/с; пусто — управление перегрузкой BBR.', { when: when('type', 'hysteria2', 'hysteria') }),
  num('down_mbps', 'Приём, Мбит/с.', { when: when('type', 'hysteria2', 'hysteria') }),
  obj('obfs', 'Обфускация QUIC.', [
    en('type', 'Вид обфускации.', ['salamander', { value: 'gecko', doc: 'Ядро 1.14 и новее.' }]),
    str('password', 'Пароль обфускации.'),
  ], { when: when('type', 'hysteria2') }),
  bool('brutal_debug', 'Отладка Brutal.', { when: when('type', 'hysteria2') }),

  // ── hysteria (v1) ──
  str('up', 'Отдача строкой, например 100 Mbps; альтернатива up_mbps.', { when: when('type', 'hysteria') }),
  str('down', 'Приём строкой, например 100 Mbps; альтернатива down_mbps.', { when: when('type', 'hysteria') }),
  str('obfs', 'Пароль обфускации.', { when: when('type', 'hysteria') }),
  str('auth', 'Пароль аутентификации в base64.', { when: when('type', 'hysteria') }),
  str('auth_str', 'Пароль аутентификации открытым текстом.', { when: when('type', 'hysteria') }),
  num('recv_window_conn', 'Окно приёма соединения.', { when: when('type', 'hysteria'), deprecated: removed('1.14.0', 'stream_receive_window') }),
  num('recv_window', 'Окно приёма.', { when: when('type', 'hysteria'), deprecated: removed('1.14.0', 'connection_receive_window') }),
  bool('disable_mtu_discovery', 'Не искать MTU.', { when: when('type', 'hysteria'), deprecated: removed('1.14.0', 'disable_path_mtu_discovery') }),

  // ── tuic ──
  en('congestion_control', 'Управление перегрузкой; пусто — cubic.', ['cubic', 'new_reno', 'bbr'], { when: when('type', 'tuic') }),
  en('udp_relay_mode', 'Режим UDP; пусто — native.', ['native', 'quic'], { when: when('type', 'tuic') }),
  bool('udp_over_stream', 'UDP поверх потока; несовместимо с udp_relay_mode.', { when: when('type', 'tuic') }),
  bool('zero_rtt_handshake', 'Рукопожатие 0-RTT.', { when: when('type', 'tuic') }),
  str('heartbeat', 'Период проверки живости, по умолчанию 10s.', { when: when('type', 'tuic') }),

  // ── anytls ──
  str('idle_session_check_interval', 'Как часто проверять простаивающие сессии, по умолчанию 30s.', { when: when('type', 'anytls') }),
  str('idle_session_timeout', 'Через сколько закрывать простаивающую сессию, по умолчанию 30s.', { when: when('type', 'anytls') }),
  num('min_idle_session', 'Сколько простаивающих сессий держать.', { when: when('type', 'anytls') }),
  str('client_metadata', 'Метаданные клиента.', { when: when('type', 'anytls'), since: '1.13.16' }),

  // ── shadowtls ──
  num('version', 'Версия ShadowTLS: 1, 2 или 3.', { when: when('type', 'shadowtls'), min: 1 }),

  // ── socks ──
  en('version', 'Версия SOCKS; пусто — 5.', ['4', '4a', '5'], { when: when('type', 'socks') }),

  // ── http ──
  str('path', 'Путь HTTP-запроса.', { when: when('type', 'http') }),
  map('headers', 'Дополнительные заголовки HTTP.', { when: when('type', 'http') }),

  // ── naive ──
  num('insecure_concurrency', 'Параллельных туннелей.', { when: when('type', 'naive') }),
  map('extra_headers', 'Дополнительные заголовки HTTP.', { when: when('type', 'naive') }),
  str('stream_receive_window', 'Окно приёма потока.', { when: when('type', 'naive') }),
  bool('quic', 'Использовать QUIC вместо HTTP/2.', { when: when('type', 'naive') }),
  en('quic_congestion_control', 'Управление перегрузкой QUIC; пусто — cubic.', ['bbr', 'bbr2', 'cubic', 'reno'], { when: when('type', 'naive') }),
  str('quic_session_receive_window', 'Окно приёма сессии QUIC.', { when: when('type', 'naive') }),

  // ── snell ──
  num('version', 'Версия Snell: 4 или 6.', { when: when('type', 'snell'), min: 4 }),
  str('psk', 'Общий ключ.', { when: when('type', 'snell') }),
  str('userkey', 'Ключ пользователя на многопользовательском сервере.', { when: when('type', 'snell') }),
  bool('reuse', 'Переиспользовать соединения.', { when: when('type', 'snell') }),
  en('obfs_mode', 'Обфускация (только версия 4); пусто — none.', ['none', 'http'], { when: when('type', 'snell') }),
  str('obfs_host', 'Host для обфускации http, по умолчанию bing.com.', { when: when('type', 'snell') }),
  en('mode', 'Режим трафика (только версия 6); пусто — default.', ['default', 'unshaped', 'unsafe-raw'], { when: when('type', 'snell') }),

  // ── ssh ──
  str('user', 'Пользователь SSH, по умолчанию root.', { when: when('type', 'ssh') }),
  strs('private_key', 'Приватный ключ в PEM, построчно.', { when: when('type', 'ssh') }),
  str('private_key_path', 'Путь к приватному ключу.', { when: when('type', 'ssh') }),
  str('private_key_passphrase', 'Пароль к приватному ключу.', { when: when('type', 'ssh') }),
  strs('host_key', 'Ожидаемые ключи хоста.', { when: when('type', 'ssh') }),
  strs('host_key_algorithms', 'Алгоритмы ключа хоста.', { when: when('type', 'ssh') }),
  str('client_version', 'Строка версии клиента.', { when: when('type', 'ssh') }),
  strs('cipher', 'Шифры.', { when: when('type', 'ssh'), since: '1.14.0' }),
  strs('mac', 'Алгоритмы MAC.', { when: when('type', 'ssh'), since: '1.14.0' }),
  strs('kex_algorithm', 'Алгоритмы обмена ключами.', { when: when('type', 'ssh'), since: '1.14.0' }),

  // ── tor ──
  str('executable_path', 'Путь к исполняемому файлу Tor.', { when: when('type', 'tor') }),
  strs('extra_args', 'Дополнительные аргументы Tor.', { when: when('type', 'tor') }),
  str('data_directory', 'Каталог данных Tor; без него каждый запуск очень медленный.', { when: when('type', 'tor') }),
  map('torrc', 'Параметры torrc.', { when: when('type', 'tor') }),

  // ── direct ──
  str('override_address', 'Подменять адрес назначения.', { when: when('type', 'direct'), deprecated: removed('1.11.0', 'поле override_address действия route-options') }),
  num('override_port', 'Подменять порт назначения.', { when: when('type', 'direct'), deprecated: removed('1.11.0', 'поле override_port действия route-options') }),

  // ── bridge ──
  str('interface', 'Интерфейс для исходящего трафика.', { when: when('type', 'bridge') }),
  str('bridge_name', 'Префикс имени TUN-моста.', { when: when('type', 'bridge') }),
  num('iproute2_table_index', 'Таблица маршрутов (Linux).', { when: when('type', 'bridge') }),
  num('iproute2_rule_index', 'Индекс правила маршрутизации (Linux).', { when: when('type', 'bridge') }),

  // ── группы ──
  strs('outbounds', 'Список выходов группы. Панель заменит его целиком: у urltest — тегами серверов, у selector — серверами и группами urltest. Чтобы список остался вашим, поставьте remnawave.includeProxies = false.', { ref: 'outbound', when: when('type', ...GROUP_TYPES) }),
  str('default', 'Выход, выбранный в группе изначально.', { ref: 'outbound', when: when('type', 'selector') }),
  str('url', 'Адрес для замера задержки в группе urltest.', { when: when('type', 'urltest') }),
  str('interval', 'Период повторного замера задержки, например 3m.', { when: when('type', 'urltest') }),
  num('tolerance', 'На сколько миллисекунд новый выход должен быть быстрее, чтобы группа переключилась.', { when: when('type', 'urltest') }),
  str('idle_timeout', 'Через сколько без трафика замеры останавливаются, по умолчанию 30m.', { when: when('type', 'urltest') }),
  bool('interrupt_exist_connections', 'Разрывать ли текущие соединения при смене выбранного выхода.', { when: when('type', ...GROUP_TYPES) }),
  obj('remnawave', 'Ключи панели: в конфиге, который получит клиент, их не будет.', [
    bool('includeProxies', 'false — не заполнять список этой группы серверами подписки.'),
  ], { panelKey: true, when: when('type', ...GROUP_TYPES) }),

  // ── общие объекты ──
  tlsObject({ when: when('type', ...TLS_TYPES) }),
  transportObject({ when: when('type', ...TRANSPORT_TYPES) }),
  multiplexObject({ when: when('type', ...MULTIPLEX_TYPES) }),

  // ── dial-поля: всем, кроме групп и записей без соединения ──
  ...withWhen(DIAL_FIELDS, whenNot('type', ...NO_DIAL_TYPES)),
]
```

- [ ] **Step 4: Схема конечных точек**

`frontend/src/entities/singbox/schema/endpoints.ts`:

```ts
// Конечные точки: WireGuard и Tailscale — «протокол с входом и выходом»
// (ядро 1.11 и новее). На холсте они рисуются тем же узлом out:<tag>, что и
// выходы, но поля у них свои — отсюда отдельная ветвь.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import { DIAL_FIELDS, bool, num, nums, objs, str, strs, when } from './shared'

export const ENDPOINT_TYPE_VALUES: EnumValue[] = [
  { value: 'wireguard', doc: 'Интерфейс WireGuard (ядро 1.11 и новее).' },
  { value: 'tailscale', doc: 'Узел Tailscale (ядро 1.12 и новее).' },
]

const wg = when('type', 'wireguard')
const ts = when('type', 'tailscale')

export const ENDPOINT_FIELDS: FieldSchema[] = [
  { key: 'type', doc: 'Вид конечной точки.', kind: 'enum', enum: ENDPOINT_TYPE_VALUES },
  str('tag', 'Имя конечной точки: по нему на неё ссылаются правила и группы.'),

  // ── wireguard ──
  bool('system', 'Использовать системный интерфейс; требует прав.', { when: wg }),
  str('name', 'Имя системного интерфейса.', { when: wg }),
  num('mtu', 'MTU интерфейса, по умолчанию 1408.', { when: wg }),
  strs('address', 'Адреса интерфейса с префиксом, IPv4 и IPv6.', { when: wg }),
  str('private_key', 'Приватный ключ в base64.', { when: wg }),
  num('listen_port', 'Локальный порт.', { when: wg }),
  objs('peers', 'Пиры WireGuard.', [
    str('address', 'Адрес пира.'),
    num('port', 'Порт пира.'),
    str('public_key', 'Публичный ключ пира.'),
    str('pre_shared_key', 'Общий ключ пира.'),
    strs('allowed_ips', 'Разрешённые подсети, например 0.0.0.0/0.'),
    num('persistent_keepalive_interval', 'Период keep-alive, секунд; 0 — выключено.'),
    nums('reserved', 'Три зарезервированных байта.'),
  ], {
    label: (v, i) => {
      const address = (v as { address?: unknown } | null)?.address
      return typeof address === 'string' && address !== '' ? address : `пир #${i + 1}`
    },
    starter: () => ({ address: '', port: 51820, public_key: '', allowed_ips: ['0.0.0.0/0', '::/0'] }),
  }, { when: wg }),
  num('workers', 'Число рабочих потоков; пусто — по числу ядер.', { when: wg }),
  bool('on_demand', 'Разрешить отключение, когда точка не нужна.', { when: wg, since: '1.15.0' }),

  // ── tailscale ──
  str('state_directory', 'Каталог состояния, по умолчанию tailscale.', { when: ts }),
  str('auth_key', 'Ключ входа; без него ядро печатает ссылку для входа.', { when: ts }),
  str('control_url', 'Сервер координации, по умолчанию controlplane.tailscale.com.', { when: ts }),
  bool('ephemeral', 'Регистрировать узел как временный.', { when: ts }),
  str('hostname', 'Имя узла; пусто — системное.', { when: ts, since: '1.14.0' }),
  bool('accept_routes', 'Принимать анонсированные маршруты.', { when: ts }),
  str('exit_node', 'Выходной узел: имя или адрес.', { when: ts }),
  bool('exit_node_allow_lan_access', 'Пускать локальную сеть через выходной узел.', { when: ts }),
  strs('advertise_routes', 'Анонсируемые подсети.', { when: ts }),
  bool('advertise_exit_node', 'Анонсировать себя выходным узлом.', { when: ts }),
  strs('advertise_tags', 'Теги ACL.', { when: ts, since: '1.13.0' }),
  num('listen_port', 'Порт WireGuard.', { when: ts, since: '1.14.0' }),
  num('relay_server_port', 'Порт релея.', { when: ts, since: '1.13.0' }),
  strs('relay_server_static_endpoints', 'Статические адреса релея.', { when: ts, since: '1.13.0' }),
  bool('system_interface', 'Создавать системный TUN.', { when: ts, since: '1.13.0' }),
  str('system_interface_name', 'Имя системного TUN.', { when: ts, since: '1.13.0' }),
  num('system_interface_mtu', 'MTU системного TUN.', { when: ts, since: '1.13.0' }),
  str('udp_timeout', 'Время жизни NAT-записи UDP, по умолчанию 5m.', { when: ts }),
  bool('ssh_server', 'Встроенный SSH-сервер.', { when: ts, since: '1.14.0' }),
  str('taildrop_directory', 'Каталог для файлов Taildrop.', { when: ts, since: '1.14.0' }),

  // ── dial-поля у обоих ──
  ...DIAL_FIELDS,
]
```

`listen_port` описан дважды с взаимоисключающими условиями намеренно: у wireguard и у tailscale это разные поля с разной семантикой, и общее описание соврало бы одному из них.

- [ ] **Step 5: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-schema-outbounds.test.ts`
Expected: PASS. Если тест уникальности ключей падает на каком-то типе, у двух полей с одним ключом условия пересекаются — сузьте `when`, не удаляйте поле.

- [ ] **Step 6: Мутации**

1. Убрать `deprecated` у значения `block` — тест типов красный. Вернуть.
2. У поля `outbounds` группы заменить `when` на `when('type', 'selector')` — тест urltest красный. Вернуть.
3. Добавить второе поле `str('server', …)` без `when` — тест уникальности красный. Убрать.

- [ ] **Step 7: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/schema/outbounds.ts frontend/src/entities/singbox/schema/endpoints.ts frontend/test/singbox-schema-outbounds.test.ts
git commit -m "feat(frontend): sing-box schema for outbounds and endpoints"
```

---

### Task 9: Схема входов

**Files:**
- Create: `frontend/src/entities/singbox/schema/inbounds.ts`
- Test: `frontend/test/singbox-schema-inbounds.test.ts`

**Interfaces:**
- Consumes: задача 7.
- Produces: `INBOUND_TYPE_VALUES`, `INBOUND_FIELDS`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/singbox-schema-inbounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { INBOUND_FIELDS, INBOUND_TYPE_VALUES } from '../src/entities/singbox/schema/inbounds'
import { visibleFields } from '../src/shared/schema'

const keysFor = (type: string) => visibleFields(INBOUND_FIELDS, { type }).map((f) => f.key)

describe('схема входов', () => {
  it('типы клиента', () => {
    expect(INBOUND_TYPE_VALUES.map((e) => e.value)).toEqual(['tun', 'mixed', 'socks', 'http', 'direct', 'shadowsocks', 'redirect', 'tproxy'])
  })

  it('tun: полный набор полей и вложенный platform.http_proxy; listen-полей нет', () => {
    const tun = keysFor('tun')
    expect(tun).toEqual(expect.arrayContaining([
      'interface_name', 'address', 'mtu', 'auto_route', 'iproute2_table_index', 'iproute2_rule_index',
      'auto_redirect', 'auto_redirect_input_mark', 'auto_redirect_output_mark', 'strict_route',
      'route_address', 'route_exclude_address', 'route_address_set', 'route_exclude_address_set',
      'endpoint_independent_nat', 'stack', 'include_interface', 'exclude_interface', 'include_uid',
      'include_uid_range', 'exclude_uid', 'exclude_uid_range', 'include_android_user', 'include_package',
      'exclude_package', 'platform', 'inet4_address', 'inet6_address', 'gso',
    ]))
    expect(tun).not.toContain('listen')
    const platform = visibleFields(INBOUND_FIELDS, { type: 'tun' }).find((f) => f.key === 'platform')!
    const proxy = platform.fields!.find((f) => f.key === 'http_proxy')!
    expect(proxy.fields!.map((f) => f.key)).toEqual(['enabled', 'server', 'server_port', 'bypass_domain', 'match_domain'])
    for (const k of ['inet4_address', 'inet6_address', 'gso']) {
      expect(visibleFields(INBOUND_FIELDS, { type: 'tun' }).find((f) => f.key === k)?.deprecated, k).toBeDefined()
    }
  })

  it('mixed: listen-поля, users и set_system_proxy; sniff устарел', () => {
    const mixed = visibleFields(INBOUND_FIELDS, { type: 'mixed' })
    expect(mixed.map((f) => f.key)).toEqual(expect.arrayContaining(['listen', 'listen_port', 'users', 'set_system_proxy', 'sniff']))
    expect(mixed.find((f) => f.key === 'users')?.item?.fields?.map((f) => f.key)).toEqual(['username', 'password'])
    expect(mixed.find((f) => f.key === 'sniff')?.deprecated?.since).toBe('1.11.0')
  })

  it('shadowsocks: method, password, users с name; direct: network и override', () => {
    const ss = visibleFields(INBOUND_FIELDS, { type: 'shadowsocks' })
    expect(ss.map((f) => f.key)).toEqual(expect.arrayContaining(['method', 'password', 'users', 'managed', 'multiplex', 'network']))
    expect(ss.find((f) => f.key === 'users')?.item?.fields?.map((f) => f.key)).toEqual(['name', 'password'])
    expect(keysFor('direct')).toEqual(expect.arrayContaining(['network', 'override_address', 'override_port']))
  })

  it('у каждого типа ключи в видимом наборе не повторяются', () => {
    for (const { value } of INBOUND_TYPE_VALUES) {
      const keys = keysFor(value)
      expect(new Set(keys).size, value).toBe(keys.length)
    }
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-schema-inbounds.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/singbox/schema/inbounds.ts`:

```ts
// Входы клиента. У tun свой набор полей (listen-полей у него нет), остальные
// наследуют listen-поля. Серверные протоколы (vless, vmess и прочие) в
// клиентском шаблоне входами не бывают и не описаны.
//
// Источник: sing-box.sagernet.org/configuration/inbound/* на 2026-09-09.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  LISTEN_FIELDS,
  MULTIPLEX_FIELDS,
  NETWORK_VALUES,
  SS_METHOD_VALUES,
  TLS_FIELDS,
  bool,
  en,
  num,
  nums,
  obj,
  objs,
  removed,
  str,
  strs,
  when,
  whenNot,
  withWhen,
} from './shared'

export const INBOUND_TYPE_VALUES: EnumValue[] = [
  { value: 'tun', doc: 'Виртуальный сетевой интерфейс: забирает весь трафик системы.' },
  { value: 'mixed', doc: 'Локальный прокси HTTP и SOCKS на одном порту.' },
  { value: 'socks', doc: 'Локальный прокси SOCKS.' },
  { value: 'http', doc: 'Локальный прокси HTTP.' },
  { value: 'direct', doc: 'Туннель: всё принятое уходит по заданному адресу.' },
  { value: 'shadowsocks', doc: 'Сервер Shadowsocks на клиенте.' },
  { value: 'redirect', doc: 'Перехват через REDIRECT (Linux, macOS).' },
  { value: 'tproxy', doc: 'Перехват через TPROXY (Linux).' },
]

const tun = when('type', 'tun')
const proxy = when('type', 'mixed', 'socks', 'http')

export const INBOUND_FIELDS: FieldSchema[] = [
  en('type', 'Тип входа.', INBOUND_TYPE_VALUES),
  str('tag', 'Имя входа: на него ссылается условие inbound в правилах.'),

  // ── tun ──
  str('interface_name', 'Имя создаваемого интерфейса tun; пусто — выберет ядро.', { when: tun }),
  str('netns', 'Сетевое пространство имён Linux.', { when: tun, since: '1.14.0' }),
  strs('address', 'Адреса виртуального интерфейса tun с префиксом.', { when: tun }),
  num('mtu', 'Размер MTU интерфейса tun.', { when: tun }),
  en('dns_mode', 'Как обходиться с DNS на интерфейсе; пусто — hijack.', ['disabled', 'native', 'hijack'], { when: tun, since: '1.14.0' }),
  strs('dns_address', 'Адреса DNS, объявляемые интерфейсом.', { when: tun, since: '1.14.0' }),
  bool('auto_route', 'Прописывать системные маршруты в интерфейс tun.', { when: tun }),
  num('iproute2_table_index', 'Таблица маршрутов, по умолчанию 2022.', { when: tun }),
  num('iproute2_rule_index', 'Индекс правила маршрутизации, по умолчанию 9000.', { when: tun }),
  bool('auto_redirect', 'Перехватывать трафик через nftables (Linux).', { when: tun }),
  str('auto_redirect_input_mark', 'Метка входящих, по умолчанию 0x2023.', { when: tun }),
  str('auto_redirect_output_mark', 'Метка исходящих, по умолчанию 0x2024.', { when: tun }),
  str('auto_redirect_reset_mark', 'Метка сброса, по умолчанию 0x2025.', { when: tun, since: '1.13.0' }),
  num('auto_redirect_nfqueue', 'Номер очереди nfqueue, по умолчанию 100.', { when: tun, since: '1.13.0' }),
  num('auto_redirect_iproute2_fallback_rule_index', 'Индекс запасного правила, по умолчанию 32768.', { when: tun }),
  bool('exclude_mptcp', 'Не перехватывать MPTCP.', { when: tun, since: '1.13.0' }),
  strs('loopback_address', 'Адреса, которые считаются петлёй.', { when: tun, since: '1.12.0' }),
  bool('strict_route', 'Строгая маршрутизация: закрывает пути в обход туннеля.', { when: tun }),
  strs('route_address', 'Подсети, которые заворачивать в туннель.', { when: tun }),
  strs('route_exclude_address', 'Подсети, которые в туннель не заворачивать.', { when: tun }),
  strs('route_address_set', 'Наборы правил с подсетями для туннеля.', { when: tun, ref: 'rule-set' }),
  strs('route_exclude_address_set', 'Наборы правил с подсетями в обход туннеля.', { when: tun, ref: 'rule-set' }),
  bool('endpoint_independent_nat', 'NAT, не зависящий от адреса назначения; только стек gvisor.', { when: tun }),
  str('udp_timeout', 'Время жизни NAT-записи UDP, по умолчанию 5m.', { when: tun }),
  en('stack', 'Сетевой стек интерфейса tun.', ['system', 'gvisor', 'mixed'], { when: tun }),
  strs('include_interface', 'Интерфейсы, чей трафик заворачивать (Linux).', { when: tun }),
  strs('exclude_interface', 'Интерфейсы, чей трафик не трогать (Linux).', { when: tun }),
  nums('include_uid', 'UID, чей трафик заворачивать (Linux).', { when: tun }),
  strs('include_uid_range', 'Диапазоны UID, например 1000:99999.', { when: tun }),
  nums('exclude_uid', 'UID, чей трафик не трогать (Linux).', { when: tun }),
  strs('exclude_uid_range', 'Диапазоны UID в обход.', { when: tun }),
  nums('include_android_user', 'Пользователи Android, чей трафик заворачивать.', { when: tun }),
  strs('include_package', 'Пакеты Android, чей трафик заворачивать.', { when: tun }),
  strs('exclude_package', 'Пакеты Android в обход туннеля.', { when: tun }),
  strs('include_mac_address', 'MAC-адреса, чей трафик заворачивать (Linux).', { when: tun, since: '1.14.0' }),
  strs('exclude_mac_address', 'MAC-адреса в обход (Linux).', { when: tun, since: '1.14.0' }),
  obj('platform', 'Настройки графических клиентов.', [
    obj('http_proxy', 'Системный HTTP-прокси, который клиент объявляет вместе с tun.', [
      bool('enabled', 'Включить системный прокси.'),
      str('server', 'Адрес прокси.'),
      num('server_port', 'Порт прокси.'),
      strs('bypass_domain', 'Домены в обход прокси.'),
      strs('match_domain', 'Домены только через прокси (Apple).'),
    ]),
  ], { when: tun }),
  strs('inet4_address', 'Адреса IPv4 интерфейса.', { when: tun, deprecated: removed('1.10.0', 'address') }),
  strs('inet6_address', 'Адреса IPv6 интерфейса.', { when: tun, deprecated: removed('1.10.0', 'address') }),
  strs('inet4_route_address', 'Маршруты IPv4.', { when: tun, deprecated: removed('1.10.0', 'route_address') }),
  strs('inet6_route_address', 'Маршруты IPv6.', { when: tun, deprecated: removed('1.10.0', 'route_address') }),
  strs('inet4_route_exclude_address', 'Исключения IPv4.', { when: tun, deprecated: removed('1.10.0', 'route_exclude_address') }),
  strs('inet6_route_exclude_address', 'Исключения IPv6.', { when: tun, deprecated: removed('1.10.0', 'route_exclude_address') }),
  bool('gso', 'Generic segmentation offload.', { when: tun, deprecated: removed('1.11.0', 'ключ больше не действует, уберите его') }),

  // ── listen-поля: всем, кроме tun ──
  ...withWhen(LISTEN_FIELDS, whenNot('type', 'tun')),

  // ── mixed / socks / http ──
  objs('users', 'Пользователи прокси; пусто — без авторизации.', [
    str('username', 'Имя пользователя.'),
    str('password', 'Пароль.'),
  ], { label: (v, i) => String((v as { username?: unknown } | null)?.username ?? `#${i + 1}`), starter: () => ({ username: '', password: '' }) }, { when: proxy }),
  bool('set_system_proxy', 'Прописывать этот вход системным прокси.', { when: proxy }),
  obj('tls', 'TLS входа HTTP.', TLS_FIELDS, { when: when('type', 'http') }),

  // ── direct / tproxy / shadowsocks ──
  en('network', 'Слушать tcp, udp или оба.', NETWORK_VALUES, { when: when('type', 'direct', 'tproxy', 'shadowsocks') }),
  str('override_address', 'Адрес, куда уходит всё принятое.', { when: when('type', 'direct') }),
  num('override_port', 'Порт, куда уходит всё принятое.', { when: when('type', 'direct') }),

  // ── shadowsocks ──
  en('method', 'Шифр Shadowsocks.', SS_METHOD_VALUES, { when: when('type', 'shadowsocks') }),
  str('password', 'Пароль сервера.', { when: when('type', 'shadowsocks') }),
  objs('users', 'Пользователи многопользовательского сервера.', [
    str('name', 'Имя пользователя.'),
    str('password', 'Пароль пользователя.'),
  ], { label: (v, i) => String((v as { name?: unknown } | null)?.name ?? `#${i + 1}`), starter: () => ({ name: '', password: '' }) }, { when: when('type', 'shadowsocks') }),
  bool('managed', 'Управляемые пользователи через SSM API.', { when: when('type', 'shadowsocks') }),
  obj('multiplex', 'Мультиплексирование.', MULTIPLEX_FIELDS, { when: when('type', 'shadowsocks') }),
]
```

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-schema-inbounds.test.ts`
Expected: PASS.

- [ ] **Step 5: Мутации**

1. Заменить `whenNot('type', 'tun')` у listen-полей на `when('type', 'tun')` — тест tun («listen-полей нет») и тест mixed красные. Вернуть.
2. Убрать `deprecated` у `gso` — тест tun красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/schema/inbounds.ts frontend/test/singbox-schema-inbounds.test.ts
git commit -m "feat(frontend): sing-box schema for inbounds"
```

---

### Task 10: Схема DNS: корень, серверы, правила и действия

**Files:**
- Create: `frontend/src/entities/singbox/schema/dns.ts`
- Test: `frontend/test/singbox-schema-dns.test.ts`

**Interfaces:**
- Consumes: задача 7.
- Produces: `DNS_SERVER_TYPE_VALUES`, `DNS_SERVER_FIELDS`, `DNS_RULE_ACTION_VALUES`, `DNS_RULE_FIELDS`, `DNS_FIELDS`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/singbox-schema-dns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DNS_FIELDS, DNS_RULE_FIELDS, DNS_SERVER_FIELDS, DNS_SERVER_TYPE_VALUES } from '../src/entities/singbox/schema/dns'
import { visibleFields } from '../src/shared/schema'

const serverKeys = (type: string) => visibleFields(DNS_SERVER_FIELDS, { type }).map((f) => f.key)
const ruleKeys = (action: string) => visibleFields(DNS_RULE_FIELDS, action === '' ? {} : { action }).map((f) => f.key)

describe('схема dns', () => {
  it('корень: servers и rules списками, final ссылкой на сервер, independent_cache и fakeip устарели', () => {
    const keys = DNS_FIELDS.map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['servers', 'rules', 'final', 'strategy', 'disable_cache', 'disable_expire', 'independent_cache', 'cache_capacity', 'optimistic', 'timeout', 'reverse_mapping', 'client_subnet', 'fakeip']))
    expect(DNS_FIELDS.find((f) => f.key === 'final')?.ref).toBe('dns-server')
    expect(DNS_FIELDS.find((f) => f.key === 'servers')?.item?.fields).toBe(DNS_SERVER_FIELDS)
    expect(DNS_FIELDS.find((f) => f.key === 'rules')?.item?.fields).toBe(DNS_RULE_FIELDS)
    expect(DNS_FIELDS.find((f) => f.key === 'fakeip')?.deprecated?.replacement).toMatch(/fakeip/)
    expect(DNS_FIELDS.find((f) => f.key === 'independent_cache')?.deprecated?.since).toBe('1.14.0')
  })

  it('серверы: типы 1.12+, у tls есть tls-объект, у fakeip — диапазоны, у local — prefer_go; legacy address устарел', () => {
    expect(DNS_SERVER_TYPE_VALUES.map((e) => e.value)).toEqual(expect.arrayContaining(['local', 'hosts', 'tcp', 'udp', 'tls', 'quic', 'https', 'h3', 'dhcp', 'mdns', 'fakeip', 'tailscale', 'openconnect', 'openvpn', 'resolved']))
    expect(serverKeys('tls')).toEqual(expect.arrayContaining(['server', 'server_port', 'tls', 'detour', 'domain_resolver']))
    expect(serverKeys('https')).toEqual(expect.arrayContaining(['path', 'headers', 'tls']))
    expect(serverKeys('fakeip')).toEqual(expect.arrayContaining(['inet4_range', 'inet6_range']))
    expect(serverKeys('fakeip')).not.toContain('detour')
    expect(serverKeys('local')).toEqual(expect.arrayContaining(['prefer_go', 'neighbor_domain']))
    expect(serverKeys('hosts')).toEqual(expect.arrayContaining(['path', 'predefined']))
    expect(serverKeys('tailscale')).toEqual(expect.arrayContaining(['endpoint', 'accept_default_resolvers', 'accept_search_domain']))
    const legacy = DNS_SERVER_FIELDS.find((f) => f.key === 'address')!
    expect(legacy.deprecated?.since).toBe('1.12.0')
    // legacy-поля видны при пустом type — именно так выглядит старый документ
    expect(serverKeys('')).toEqual(expect.arrayContaining(['address', 'address_resolver', 'address_strategy', 'strategy']))
  })

  it('у каждого типа сервера ключи не повторяются', () => {
    for (const { value } of DNS_SERVER_TYPE_VALUES) {
      const keys = serverKeys(value)
      expect(new Set(keys).size, value).toBe(keys.length)
    }
  })

  it('правила: матчеры, server как поле действия route (и без action), reject и predefined со своими полями', () => {
    const base = ruleKeys('')
    expect(base).toEqual(expect.arrayContaining(['inbound', 'query_type', 'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'source_ip_cidr', 'port', 'process_name', 'clash_mode', 'rule_set', 'invert', 'action', 'server', 'disable_cache', 'rewrite_ttl', 'client_subnet']))
    expect(ruleKeys('route')).toContain('server')
    expect(ruleKeys('reject')).toEqual(expect.arrayContaining(['method', 'no_drop']))
    expect(ruleKeys('reject')).not.toContain('server')
    expect(ruleKeys('predefined')).toEqual(expect.arrayContaining(['rcode', 'answer', 'ns', 'extra']))
    expect(ruleKeys('route-options')).toContain('rewrite_ttl')
    expect(ruleKeys('route-options')).not.toContain('server')
    expect(DNS_RULE_FIELDS.find((f) => f.key === 'server')?.ref).toBe('dns-server')
    expect(DNS_RULE_FIELDS.find((f) => f.key === 'rule_set')?.item?.ref).toBe('rule-set')
    expect(DNS_RULE_FIELDS.find((f) => f.key === 'outbound')?.deprecated?.since).toBe('1.12.0')
  })

  it('логическое правило вкладывает те же правила', () => {
    const rules = DNS_RULE_FIELDS.find((f) => f.key === 'rules')!
    expect(rules.item?.fields).toBe(DNS_RULE_FIELDS)
    expect(ruleKeys('')).toEqual(expect.arrayContaining(['type', 'mode', 'rules']))
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-schema-dns.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/singbox/schema/dns.ts`:

```ts
// DNS: серверы всех типов (1.12 и новее — типизированные, legacy-форма
// описана как устаревшая), правила с действиями и корневые ключи.
//
// Поля действия у правила лежат ПЛОСКО, рядом с матчерами: `server`,
// `disable_cache` и прочие — это поля действия route, которое подразумевается
// при отсутствующем `action`. Условие `in: ['', 'route']` и означает «действие
// не задано или route».
//
// Источник: sing-box.sagernet.org/configuration/dns/* на 2026-09-09.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  DIAL_FIELDS,
  NETWORK_TYPE_VALUES,
  STRATEGY_VALUES,
  TLS_FIELDS,
  bool,
  en,
  map,
  num,
  nums,
  obj,
  objs,
  removed,
  str,
  strs,
  tagLabel,
  when,
  withWhen,
} from './shared'

export const DNS_SERVER_TYPE_VALUES: EnumValue[] = [
  { value: 'local', doc: 'Системный резолвер устройства.' },
  { value: 'hosts', doc: 'Файл hosts и предопределённые записи (ядро 1.12 и новее).' },
  { value: 'tcp', doc: 'DNS поверх TCP.' },
  { value: 'udp', doc: 'DNS поверх UDP.' },
  { value: 'tls', doc: 'DNS поверх TLS (DoT).' },
  { value: 'quic', doc: 'DNS поверх QUIC (DoQ).' },
  { value: 'https', doc: 'DNS поверх HTTPS (DoH).' },
  { value: 'h3', doc: 'DNS поверх HTTP/3.' },
  { value: 'dhcp', doc: 'Сервер из DHCP.' },
  { value: 'mdns', doc: 'Многоадресный DNS (ядро 1.14 и новее).' },
  { value: 'fakeip', doc: 'Выдаёт подставные адреса из заданного диапазона.' },
  { value: 'tailscale', doc: 'Резолвер узла Tailscale.' },
  { value: 'openconnect', doc: 'Резолвер OpenConnect (ядро 1.14 и новее).' },
  { value: 'openvpn', doc: 'Резолвер OpenVPN (ядро 1.14 и новее).' },
  { value: 'resolved', doc: 'systemd-resolved (ядро 1.12 и новее).' },
]

const NET_SERVERS = ['tcp', 'udp', 'tls', 'quic', 'https', 'h3']
const TLS_SERVERS = ['tls', 'quic', 'https', 'h3']
const DIAL_SERVERS = [...NET_SERVERS, 'dhcp', 'tailscale', 'openconnect', 'openvpn', 'resolved']
const LEGACY = when('type', '')

export const DNS_SERVER_FIELDS: FieldSchema[] = [
  en('type', 'Транспорт запроса. Пусто — старый формат сервера с полем address (удалён в ядре 1.14).', DNS_SERVER_TYPE_VALUES),
  str('tag', 'Имя сервера: по нему на него ссылаются правила DNS.'),
  str('server', 'Адрес DNS-сервера.', { when: when('type', ...NET_SERVERS) }),
  num('server_port', 'Порт сервера; пусто — стандартный для транспорта.', { when: when('type', ...NET_SERVERS) }),
  str('path', 'Путь запроса DoH, по умолчанию /dns-query.', { when: when('type', 'https', 'h3') }),
  map('headers', 'Дополнительные заголовки DoH.', { when: when('type', 'https', 'h3') }),
  obj('tls', 'TLS соединения с сервером.', TLS_FIELDS, { when: when('type', ...TLS_SERVERS) }),
  bool('prefer_go', 'Резолвить самостоятельно, а не через платформу.', { when: when('type', 'local'), since: '1.13.0' }),
  strs('neighbor_domain', 'Суффиксы имён соседей, разрешаемых через mDNS.', { when: when('type', 'local'), since: '1.14.0' }),
  strs('path', 'Пути к файлам hosts; пусто — системный.', { when: when('type', 'hosts') }),
  map('predefined', 'Предопределённые записи: домен → адрес.', { when: when('type', 'hosts') }),
  str('interface', 'Интерфейс, на котором слушать DHCP; пусто — умолчание.', { when: when('type', 'dhcp') }),
  strs('interface', 'Интерфейсы для mDNS-запросов; пусто — все.', { when: when('type', 'mdns') }),
  str('inet4_range', 'Диапазон подставных адресов IPv4 для fakeip.', { when: when('type', 'fakeip') }),
  str('inet6_range', 'Диапазон подставных адресов IPv6 для fakeip.', { when: when('type', 'fakeip') }),
  str('endpoint', 'Тег конечной точки, через которую резолвить.', { ref: 'outbound', when: when('type', 'tailscale', 'openconnect', 'openvpn') }),
  str('service', 'Тег службы resolved.', { when: when('type', 'resolved') }),
  bool('accept_default_resolvers', 'Принимать резолверы по умолчанию для запросов вне зоны.', { when: when('type', 'tailscale', 'openconnect', 'openvpn', 'resolved') }),
  bool('accept_search_domain', 'Повторять однокомпонентные запросы с доменами поиска.', { when: when('type', 'tailscale', 'openconnect', 'openvpn'), since: '1.14.0' }),

  // ── legacy-форма: без type ──
  str('address', 'Адрес сервера старого формата, например tls://1.1.1.1 или local.', { when: LEGACY, deprecated: removed('1.12.0', 'сервер с полем type и адресом в server') }),
  str('address_resolver', 'Тег сервера, которым резолвить домен адреса.', { when: LEGACY, ref: 'dns-server', deprecated: removed('1.12.0', 'поле domain_resolver') }),
  en('address_strategy', 'Стратегия резолва домена адреса.', STRATEGY_VALUES, { when: LEGACY, deprecated: removed('1.12.0', 'поле strategy внутри domain_resolver') }),
  en('strategy', 'Какие адреса запрашивать по умолчанию.', STRATEGY_VALUES, { when: LEGACY, deprecated: removed('1.12.0', 'поле strategy в правиле DNS') }),
  str('client_subnet', 'EDNS0 client-subnet.', { when: LEGACY, deprecated: removed('1.12.0', 'поле client_subnet в правиле DNS') }),

  // ── dial-поля: сетевым серверам ──
  ...withWhen(DIAL_FIELDS, when('type', ...DIAL_SERVERS, '')),
]

export const DNS_RULE_ACTION_VALUES: EnumValue[] = [
  { value: 'route', doc: 'Отправить запрос серверу из поля server. Действие по умолчанию.' },
  { value: 'route-options', doc: 'Изменить параметры запроса, подбор продолжается.' },
  { value: 'reject', doc: 'Отклонить запрос.' },
  { value: 'predefined', doc: 'Ответить заранее заданной записью (ядро 1.12 и новее).' },
  { value: 'evaluate', doc: 'Спросить сервер и запомнить ответ под тегом (ядро 1.14 и новее).' },
  { value: 'respond', doc: 'Ответить ранее запомненным ответом (ядро 1.14 и новее).' },
]

const routeLike = when('action', '', 'route', 'evaluate')
const options = when('action', '', 'route', 'evaluate', 'route-options')

export const DNS_RULE_FIELDS: FieldSchema[] = [
  // ── матчеры ──
  strs('inbound', 'Теги входов, с которых пришёл запрос.', { ref: 'inbound' }),
  num('ip_version', 'Вид запроса: 4 — A, 6 — AAAA.', { since: '1.14.0' }),
  strs('query_type', 'Типы DNS-запросов: A, AAAA, HTTPS или число.'),
  strs('query_client_subnet', 'Подсети client-subnet запроса.', { since: '1.14.0' }),
  bool('query_dnssec', 'Запрос с битом DNSSEC OK.', { since: '1.14.0' }),
  en('network', 'Транспорт запроса.', [{ value: 'tcp' }, { value: 'udp' }]),
  strs('auth_user', 'Пользователи входа.'),
  strs('protocol', 'Протокол, определённый сниффингом.'),
  strs('domain', 'Полное совпадение домена.'),
  strs('domain_suffix', 'Суффикс домена.'),
  strs('domain_keyword', 'Подстрока в домене.'),
  strs('domain_regex', 'Регулярное выражение по домену.'),
  strs('source_ip_cidr', 'Подсеть источника.'),
  bool('source_ip_is_private', 'Источник из частного диапазона.'),
  nums('source_port', 'Порт источника.'),
  strs('source_port_range', 'Диапазон портов источника, например 1000:2000.'),
  nums('port', 'Порт назначения.'),
  strs('port_range', 'Диапазон портов назначения.'),
  strs('process_name', 'Имя процесса.'),
  strs('process_path', 'Путь процесса.'),
  strs('process_path_regex', 'Регулярное выражение по пути процесса.'),
  strs('package_name', 'Пакет Android.'),
  strs('package_name_regex', 'Регулярное выражение по пакету Android.', { since: '1.14.0' }),
  strs('user', 'Пользователь системы (Linux).'),
  nums('user_id', 'UID пользователя (Linux).'),
  str('clash_mode', 'Режим, выбранный в клиенте через Clash API.'),
  strs('network_type', 'Тип сети графического клиента.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  bool('network_is_expensive', 'Сеть с тарификацией.', { since: '1.11.0' }),
  bool('network_is_constrained', 'Режим экономии трафика (Apple).', { since: '1.11.0' }),
  obj('interface_address', 'Адреса по интерфейсам: имя → подсети.', [], { since: '1.13.0' }),
  obj('network_interface_address', 'Адреса по типам сети: тип → подсети.', [], { since: '1.13.0' }),
  strs('default_interface_address', 'Подсети интерфейса по умолчанию.', { since: '1.13.0' }),
  strs('source_mac_address', 'MAC-адреса источника.', { since: '1.14.0' }),
  strs('source_hostname', 'Имена хостов источника из DHCP.', { since: '1.14.0' }),
  strs('preferred_by', 'Домены, предпочитаемые указанными серверами.', { since: '1.14.0' }),
  strs('wifi_ssid', 'SSID сети Wi-Fi.'),
  strs('wifi_bssid', 'BSSID сети Wi-Fi.'),
  strs('rule_set', 'Теги наборов правил.', { ref: 'rule-set' }),
  bool('rule_set_ip_cidr_match_source', 'ip_cidr наборов сравнивать с источником.'),
  bool('match_response', 'Сравнивать поля ответа.', { since: '1.14.0' }),
  bool('ip_accept_any', 'Ответ содержит хотя бы один адрес.', { since: '1.12.0' }),
  str('response_rcode', 'Код ответа.', { since: '1.14.0' }),
  strs('response_answer', 'Записи answer ответа.', { since: '1.14.0' }),
  strs('response_ns', 'Записи ns ответа.', { since: '1.14.0' }),
  strs('response_extra', 'Записи extra ответа.', { since: '1.14.0' }),
  bool('invert', 'Обратить результат проверки условий.'),
  strs('ip_cidr', 'Подсети адреса в ответе.', { deprecated: removed('1.14.0', 'match_response: true и поля ответа') }),
  bool('ip_is_private', 'Адрес в ответе частный.', { deprecated: removed('1.14.0', 'match_response: true и поля ответа') }),
  bool('rule_set_ip_cidr_accept_empty', 'Пустой ответ считать совпадением.', { deprecated: removed('1.14.0', 'сопоставление ответа') }),
  strs('outbound', 'Выходы, чьи домены серверов резолвить этим правилом.', { deprecated: removed('1.12.0', 'поле domain_resolver у выхода') }),

  // ── действие и его поля ──
  en('action', 'Что сделать с запросом. Без этого поля — route.', DNS_RULE_ACTION_VALUES),
  str('server', 'Тег DNS-сервера, которому уйдёт запрос.', { ref: 'dns-server', when: routeLike }),
  str('tag', 'Метка запомненного ответа.', { when: when('action', 'evaluate'), since: '1.14.0' }),
  bool('speculative', 'Спрашивать наперёд.', { when: routeLike, since: '1.14.0' }),
  en('strategy', 'Какие адреса запрашивать.', STRATEGY_VALUES, { when: routeLike, deprecated: removed('1.14.0', 'strategy сервера или domain_resolver') }),
  bool('disable_cache', 'Не кэшировать ответ.', { when: options }),
  bool('disable_optimistic_cache', 'Не отдавать протухший кэш.', { when: options, since: '1.14.0' }),
  num('rewrite_ttl', 'Переписать TTL ответа.', { when: options }),
  str('timeout', 'Таймаут запроса.', { when: options, since: '1.14.0' }),
  str('client_subnet', 'EDNS0 client-subnet.', { when: options }),
  bool('remove_client_subnet', 'Не отправлять client-subnet.', { when: options, since: '1.14.0' }),
  en('method', 'Как отклонять: default — REFUSED, drop — молча.', ['default', 'drop'], { when: when('action', 'reject') }),
  bool('no_drop', 'Не переходить в drop после частых срабатываний.', { when: when('action', 'reject') }),
  en('rcode', 'Код ответа.', ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'], { when: when('action', 'predefined') }),
  strs('answer', 'Записи answer текстом.', { when: when('action', 'predefined') }),
  strs('ns', 'Записи ns текстом.', { when: when('action', 'predefined') }),
  strs('extra', 'Записи extra текстом.', { when: when('action', 'predefined') }),
  bool('race', 'Сопоставлять правила параллельно.', { since: '1.14.0' }),

  // ── логическое правило ──
  en('type', 'logical — правило объединяет вложенные правила по «и» либо «или».', ['logical']),
  en('mode', 'Для логического правила: and — все вложенные, or — хотя бы одно.', ['and', 'or']),
]

// Вложенные правила логического правила описаны тем же списком: своя копия
// разошлась бы с оригиналом на первом же поле. Ссылка на себя — после
// объявления, иначе TS не даст сослаться на ещё не созданный массив
DNS_RULE_FIELDS.push(
  objs('rules', 'Вложенные правила логического правила.', DNS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
)

export const DNS_FIELDS: FieldSchema[] = [
  objs('servers', 'DNS-серверы: у каждого свой тег, тип и адрес.', DNS_SERVER_FIELDS, {
    label: tagLabel,
    starter: () => ({ tag: '', type: 'udp', server: '' }),
  }),
  objs('rules', 'Правила DNS: какой запрос каким сервером разрешать. Считаются отдельно от правил маршрута.', DNS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
  str('final', 'Сервер для запросов, не совпавших ни с одним правилом DNS; пусто — первый в списке.', { ref: 'dns-server' }),
  en('strategy', 'Какие адреса запрашивать по умолчанию.', STRATEGY_VALUES),
  bool('disable_cache', 'Отключить кэш DNS.'),
  bool('disable_expire', 'Не считать кэш просроченным.'),
  bool('independent_cache', 'Держать отдельный кэш для каждого сервера.', { deprecated: removed('1.14.0', 'optimistic и store_dns в cache_file') }),
  num('cache_capacity', 'Ёмкость LRU-кэша; меньше 1024 не учитывается.', { since: '1.11.0' }),
  bool('optimistic', 'Отдавать протухший кэш сразу и обновлять в фоне.', { since: '1.14.0' }),
  str('timeout', 'Таймаут одного запроса, по умолчанию 10s.', { since: '1.14.0' }),
  bool('reverse_mapping', 'Запоминать соответствие адреса и домена для обратного поиска.'),
  str('client_subnet', 'EDNS0 client-subnet по умолчанию.', { since: '1.9.0' }),
  obj('fakeip', 'Старый блок fakeip.', [
    bool('enabled', 'Включить fakeip.'),
    str('inet4_range', 'Диапазон IPv4.'),
    str('inet6_range', 'Диапазон IPv6.'),
  ], { deprecated: removed('1.12.0', 'сервер с type: fakeip в списке servers') }),
]
```

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-schema-dns.test.ts`
Expected: PASS. Если тест уникальности красный на `path` или `interface` — это два поля с разными условиями (`https|h3` и `hosts`; `dhcp` и `mdns`), их условия не пересекаются; проверьте, что `when` стоит у обоих.

- [ ] **Step 5: Мутации**

1. У поля `server` правила заменить `routeLike` на `when('action', 'route')` — тест «server как поле действия route (и без action)» красный. Вернуть.
2. Убрать `push` вложенных `rules` — тест логического правила красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/schema/dns.ts frontend/test/singbox-schema-dns.test.ts
git commit -m "feat(frontend): sing-box schema for dns servers and rules"
```

---

### Task 11: Схема маршрута: корень, правила с действиями, наборы правил

**Files:**
- Create: `frontend/src/entities/singbox/schema/route.ts`
- Test: `frontend/test/singbox-schema-route.test.ts`

**Interfaces:**
- Consumes: задача 7.
- Produces: `ROUTE_RULE_ACTION_VALUES`, `ROUTE_RULE_FIELDS`, `HEADLESS_RULE_FIELDS`, `RULE_SET_FIELDS`, `ROUTE_FIELDS`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/singbox-schema-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HEADLESS_RULE_FIELDS, ROUTE_FIELDS, ROUTE_RULE_ACTION_VALUES, ROUTE_RULE_FIELDS, RULE_SET_FIELDS } from '../src/entities/singbox/schema/route'
import { visibleFields } from '../src/shared/schema'

const ruleKeys = (action: string) => visibleFields(ROUTE_RULE_FIELDS, action === '' ? {} : { action }).map((f) => f.key)
const setKeys = (type: string) => visibleFields(RULE_SET_FIELDS, { type }).map((f) => f.key)

describe('схема маршрута', () => {
  it('корень: final ссылкой на выход, default_domain_resolver объектом, geoip/geosite устарели', () => {
    const keys = ROUTE_FIELDS.map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['rules', 'rule_set', 'final', 'auto_detect_interface', 'override_android_vpn', 'default_interface', 'default_mark', 'default_domain_resolver', 'default_network_strategy', 'default_network_type', 'default_fallback_network_type', 'default_fallback_delay', 'default_http_client', 'find_process', 'geoip', 'geosite', 'default_domain_strategy']))
    expect(ROUTE_FIELDS.find((f) => f.key === 'final')?.ref).toBe('outbound')
    expect(ROUTE_FIELDS.find((f) => f.key === 'default_domain_resolver')?.kind).toBe('object')
    expect(ROUTE_FIELDS.find((f) => f.key === 'geoip')?.deprecated?.replacement).toMatch(/rule_set/)
  })

  it('действия правила: все семь, outbound только у route и bypass, sniff и resolve со своими полями', () => {
    expect(ROUTE_RULE_ACTION_VALUES.map((e) => e.value)).toEqual(['route', 'route-options', 'reject', 'hijack-dns', 'sniff', 'resolve', 'bypass'])
    expect(ruleKeys('')).toContain('outbound')
    expect(ruleKeys('route')).toContain('outbound')
    expect(ruleKeys('bypass')).toContain('outbound')
    expect(ruleKeys('reject')).not.toContain('outbound')
    expect(ruleKeys('reject')).toEqual(expect.arrayContaining(['method', 'no_drop']))
    expect(ruleKeys('sniff')).toEqual(expect.arrayContaining(['sniffer', 'timeout']))
    expect(ruleKeys('resolve')).toEqual(expect.arrayContaining(['server', 'strategy', 'disable_cache', 'rewrite_ttl', 'client_subnet']))
    expect(ruleKeys('route-options')).toEqual(expect.arrayContaining(['override_address', 'override_port', 'udp_disable_domain_unmapping', 'udp_connect', 'udp_timeout', 'tls_fragment']))
    expect(ruleKeys('route')).toContain('override_port')
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'outbound')?.ref).toBe('outbound')
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'server')?.ref).toBe('dns-server')
  })

  it('матчеры правила: полный набор, geosite/geoip устарели', () => {
    expect(ruleKeys('')).toEqual(expect.arrayContaining(['inbound', 'ip_version', 'network', 'auth_user', 'protocol', 'client', 'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'source_ip_cidr', 'source_ip_is_private', 'ip_cidr', 'ip_is_private', 'source_port', 'source_port_range', 'port', 'port_range', 'process_name', 'process_path', 'process_path_regex', 'package_name', 'user', 'user_id', 'clash_mode', 'network_type', 'network_is_expensive', 'network_is_constrained', 'wifi_ssid', 'wifi_bssid', 'rule_set', 'rule_set_ip_cidr_match_source', 'invert', 'type', 'mode', 'rules', 'geosite', 'geoip', 'source_geoip']))
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'geosite')?.deprecated?.since).toBe('1.8.0')
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'rules')?.item?.fields).toBe(ROUTE_RULE_FIELDS)
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'sniffer')?.item?.enum?.map((e) => e.value)).toContain('bittorrent')
  })

  it('наборы правил: remote с url и download_detour (устарел с 1.14), local с path, inline с headless-правилами', () => {
    expect(setKeys('remote')).toEqual(expect.arrayContaining(['tag', 'format', 'url', 'update_interval', 'download_detour', 'initial_path', 'http_client']))
    expect(setKeys('local')).toEqual(expect.arrayContaining(['tag', 'format', 'path']))
    expect(setKeys('local')).not.toContain('url')
    expect(setKeys('inline')).toContain('rules')
    expect(setKeys('inline')).not.toContain('format')
    expect(RULE_SET_FIELDS.find((f) => f.key === 'download_detour')?.deprecated?.since).toBe('1.14.0')
    expect(RULE_SET_FIELDS.find((f) => f.key === 'rules')?.item?.fields).toBe(HEADLESS_RULE_FIELDS)
    const headless = HEADLESS_RULE_FIELDS.map((f) => f.key)
    expect(headless).toEqual(expect.arrayContaining(['domain', 'domain_suffix', 'ip_cidr', 'port', 'process_name', 'query_type', 'invert', 'type', 'mode', 'rules']))
    for (const k of ['inbound', 'clash_mode', 'rule_set', 'action', 'outbound']) expect(headless, k).not.toContain(k)
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-schema-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/singbox/schema/route.ts`:

```ts
// Маршрут: корневые ключи, правила с действиями, наборы правил. Поля действия
// у правила лежат плоско, как у DNS: `outbound` — поле действия route, которое
// подразумевается при отсутствующем `action`.
//
// Источник: sing-box.sagernet.org/configuration/route/*, rule-set/* на 2026-09-09.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import {
  NETWORK_TYPE_VALUES,
  SNIFFER_VALUES,
  STRATEGY_VALUES,
  bool,
  domainResolverObject,
  en,
  num,
  nums,
  obj,
  objs,
  removed,
  str,
  strs,
  tagLabel,
  when,
} from './shared'

export const ROUTE_RULE_ACTION_VALUES: EnumValue[] = [
  { value: 'route', doc: 'Отправить в выход из поля outbound.' },
  { value: 'route-options', doc: 'Изменить параметры маршрута. Подбор правил продолжается.' },
  { value: 'reject', doc: 'Отклонить соединение.' },
  { value: 'hijack-dns', doc: 'Перехватить DNS-запрос во внутренний резолвер.' },
  { value: 'sniff', doc: 'Определить протокол соединения. Подбор правил продолжается.' },
  { value: 'resolve', doc: 'Разрешить домен в адреса. Подбор правил продолжается.' },
  { value: 'bypass', doc: 'Пропустить мимо ядра в системный стек (Linux с auto_redirect, ядро 1.13 и новее).' },
]

/** Матчеры, общие для правила маршрута и headless-правила набора */
const COMMON_MATCHERS: FieldSchema[] = [
  strs('domain', 'Полное совпадение домена.'),
  strs('domain_suffix', 'Суффикс домена. Без ведущей точки совпадает и сам домен, и его поддомены; с ведущей точкой — только поддомены.'),
  strs('domain_keyword', 'Подстрока в домене.'),
  strs('domain_regex', 'Регулярное выражение по домену.'),
  strs('source_ip_cidr', 'Подсеть источника.'),
  strs('ip_cidr', 'Подсеть адреса назначения.'),
  nums('source_port', 'Порт источника.'),
  strs('source_port_range', 'Диапазон портов источника, например 1000:2000.'),
  nums('port', 'Порт назначения.'),
  strs('port_range', 'Диапазон портов назначения, например 1000:2000.'),
  strs('process_name', 'Имя процесса.'),
  strs('process_path', 'Путь процесса.'),
  strs('process_path_regex', 'Регулярное выражение по пути процесса.'),
  strs('package_name', 'Пакет Android.'),
  strs('package_name_regex', 'Регулярное выражение по пакету Android.', { since: '1.14.0' }),
  strs('network_type', 'Тип сети графического клиента.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  bool('network_is_expensive', 'Сеть с тарификацией.', { since: '1.11.0' }),
  bool('network_is_constrained', 'Режим экономии трафика (Apple).', { since: '1.11.0' }),
  obj('network_interface_address', 'Адреса по типам сети: тип → подсети.', [], { since: '1.13.0' }),
  strs('default_interface_address', 'Подсети интерфейса по умолчанию.', { since: '1.13.0' }),
  strs('wifi_ssid', 'SSID сети Wi-Fi.'),
  strs('wifi_bssid', 'BSSID сети Wi-Fi.'),
  bool('invert', 'Обратить результат проверки условий.'),
  en('type', 'logical — правило объединяет вложенные правила по «и» либо «или».', ['logical']),
  en('mode', 'Для логического правила: and — все вложенные, or — хотя бы одно.', ['and', 'or']),
]

const routeLike = when('action', '', 'route', 'bypass')
const options = when('action', '', 'route', 'bypass', 'route-options')

export const ROUTE_RULE_FIELDS: FieldSchema[] = [
  strs('inbound', 'Теги входов, с которых пришло соединение.', { ref: 'inbound' }),
  num('ip_version', 'Версия IP: 4 или 6.'),
  strs('network', 'Транспорт: tcp, udp или icmp.', { values: [{ value: 'tcp' }, { value: 'udp' }, { value: 'icmp', doc: 'Ядро 1.13 и новее.' }] }),
  strs('auth_user', 'Пользователи входа.'),
  strs('protocol', 'Протокол, определённый сниффингом. Редактор его предсказать не может.', { values: SNIFFER_VALUES }),
  strs('client', 'Клиент, определённый сниффингом.', { values: [{ value: 'chromium' }, { value: 'safari' }, { value: 'firefox' }, { value: 'quic-go' }], since: '1.10.0' }),
  ...COMMON_MATCHERS,
  bool('source_ip_is_private', 'Источник из частного диапазона.'),
  bool('ip_is_private', 'Адрес назначения принадлежит частному диапазону.'),
  strs('user', 'Пользователь системы (Linux).'),
  nums('user_id', 'UID пользователя (Linux).'),
  str('clash_mode', 'Режим, выбранный в клиенте через Clash API. Документом не задаётся.'),
  obj('interface_address', 'Адреса по интерфейсам: имя → подсети.', [], { since: '1.13.0' }),
  strs('preferred_by', 'Выходы, предпочитающие адрес назначения.', { since: '1.13.0' }),
  strs('source_mac_address', 'MAC-адреса источника.', { since: '1.14.0' }),
  strs('source_hostname', 'Имена хостов источника из DHCP.', { since: '1.14.0' }),
  strs('rule_set', 'Теги наборов правил. Содержимое набора лежит по ссылке, редактор его не скачивает.', { ref: 'rule-set' }),
  bool('rule_set_ip_cidr_match_source', 'ip_cidr наборов сравнивать с источником.'),
  strs('geosite', 'Категории geosite.', { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  strs('geoip', 'Категории geoip.', { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  strs('source_geoip', 'Категории geoip источника.', { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  bool('rule_set_ipcidr_match_source', 'Старое имя rule_set_ip_cidr_match_source.', { deprecated: removed('1.10.0', 'rule_set_ip_cidr_match_source') }),

  // ── действие и его поля ──
  en('action', 'Что сделать с соединением. Без этого поля правило считается маршрутным.', ROUTE_RULE_ACTION_VALUES),
  str('outbound', 'Тег выхода, в который уйдёт совпавшее соединение.', { ref: 'outbound', when: routeLike }),
  str('override_address', 'Подменить адрес назначения.', { when: options }),
  num('override_port', 'Подменить порт назначения.', { when: options }),
  en('network_strategy', 'Стратегия выбора сети.', ['default', 'hybrid', 'fallback'], { when: options, since: '1.11.0' }),
  strs('network_type', 'Предпочитаемые типы сети.', { values: NETWORK_TYPE_VALUES, when: when('action', 'route-options'), since: '1.11.0' }),
  strs('fallback_network_type', 'Запасные типы сети.', { values: NETWORK_TYPE_VALUES, when: options, since: '1.11.0' }),
  str('fallback_delay', 'Задержка перед запасной сетью.', { when: options, since: '1.11.0' }),
  bool('udp_disable_domain_unmapping', 'Не сопоставлять UDP-ответы обратно с доменом.', { when: options }),
  bool('udp_connect', 'Подключённый UDP.', { when: options }),
  str('udp_timeout', 'Время жизни UDP-сессии.', { when: options }),
  bool('tls_fragment', 'Дробить ClientHello на сегменты.', { when: options, since: '1.12.0' }),
  str('tls_fragment_fallback_delay', 'Откат без дробления через это время, по умолчанию 500ms.', { when: options, since: '1.12.0' }),
  bool('tls_record_fragment', 'Дробить ClientHello на TLS-записи.', { when: options, since: '1.12.0' }),
  str('tls_spoof', 'Поддельное имя сервера.', { when: options, since: '1.14.0' }),
  en('tls_spoof_method', 'Способ подмены.', ['wrong-sequence', 'wrong-checksum', 'wrong-ack', 'wrong-md5', 'wrong-timestamp'], { when: options, since: '1.14.0' }),
  en('method', 'Как отклонять: default — сброс, drop — молча, reply — ответ ICMP.', ['default', 'drop', 'reply'], { when: when('action', 'reject') }),
  bool('no_drop', 'Не переходить в drop после частых срабатываний.', { when: when('action', 'reject') }),
  strs('sniffer', 'Какие снифферы включить; пусто — все.', { values: SNIFFER_VALUES, when: when('action', 'sniff') }),
  str('timeout', 'Время на определение протокола, по умолчанию 300ms.', { when: when('action', 'sniff') }),
  str('server', 'Тег DNS-сервера для резолва.', { ref: 'dns-server', when: when('action', 'resolve') }),
  en('strategy', 'Какие адреса запрашивать.', STRATEGY_VALUES, { when: when('action', 'resolve') }),
  bool('disable_cache', 'Не кэшировать ответ.', { when: when('action', 'resolve'), since: '1.12.0' }),
  bool('disable_optimistic_cache', 'Не отдавать протухший кэш.', { when: when('action', 'resolve'), since: '1.14.0' }),
  num('rewrite_ttl', 'Переписать TTL ответа.', { when: when('action', 'resolve'), since: '1.12.0' }),
  str('client_subnet', 'EDNS0 client-subnet.', { when: when('action', 'resolve'), since: '1.12.0' }),
]

// `network_type` описан дважды: у route-options это отдельное поле действия,
// а общий матчер того же имени стоит в COMMON_MATCHERS без условия. Чтобы в
// видимом наборе ключ был один, матчер получает условие «не route-options»
{
  const matcher = ROUTE_RULE_FIELDS.find((f) => f.key === 'network_type' && f.when === undefined)!
  matcher.when = { key: 'action', notIn: ['route-options'] }
}

ROUTE_RULE_FIELDS.push(
  objs('rules', 'Вложенные правила логического правила.', ROUTE_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
)

/** Правило внутри набора: без входов, режима Clash, наборов и действия */
export const HEADLESS_RULE_FIELDS: FieldSchema[] = [
  strs('query_type', 'Типы DNS-запросов.'),
  strs('network', 'Транспорт: tcp или udp.', { values: [{ value: 'tcp' }, { value: 'udp' }] }),
  ...COMMON_MATCHERS,
]

HEADLESS_RULE_FIELDS.push(
  objs('rules', 'Вложенные правила логического правила.', HEADLESS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }),
)

const remote = when('type', 'remote')

export const RULE_SET_FIELDS: FieldSchema[] = [
  str('tag', 'Имя набора: по нему на набор ссылаются правила.'),
  en('type', 'Откуда берётся набор.', [
    { value: 'remote', doc: 'Скачивается по ссылке.' },
    { value: 'local', doc: 'Читается из файла на устройстве.' },
    { value: 'inline', doc: 'Записан прямо в конфиге (ядро 1.10 и новее).' },
  ]),
  en('format', 'Формат набора: binary (.srs) или source (.json).', ['binary', 'source'], { when: when('type', 'remote', 'local') }),
  str('path', 'Путь к локальному файлу набора.', { when: when('type', 'local') }),
  str('url', 'Ссылка на удалённый набор.', { when: remote }),
  str('initial_path', 'Локальный файл, с которого начать до первой загрузки.', { when: remote, since: '1.14.0' }),
  str('http_client', 'Тег HTTP-клиента для загрузки.', { when: remote, since: '1.14.0' }),
  str('update_interval', 'Как часто обновлять набор, например 1d.', { when: remote }),
  str('download_detour', 'Через какой выход скачивать набор.', { ref: 'outbound', when: remote, deprecated: removed('1.14.0', 'http_client') }),
  objs('rules', 'Правила набора.', HEADLESS_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({}),
  }, { when: when('type', 'inline') }),
]

export const ROUTE_FIELDS: FieldSchema[] = [
  objs('rules', 'Правила маршрутизации по порядку: выигрывает первое совпавшее.', ROUTE_RULE_FIELDS, {
    label: (_v, i) => `правило #${i + 1}`,
    starter: () => ({ domain: [], outbound: 'direct' }),
  }),
  objs('rule_set', 'Наборы правил: локальные файлы, удалённые .srs по ссылке или встроенные.', RULE_SET_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'remote', tag: '', format: 'binary', url: '' }),
  }),
  str('final', 'Выход для трафика, не совпавшего ни с одним правилом. Если поле пусто, ядро возьмёт ПЕРВЫЙ выход из outbounds.', { ref: 'outbound' }),
  bool('auto_detect_interface', 'Определять исходящий интерфейс автоматически.'),
  bool('override_android_vpn', 'Перехватывать ли трафик другого VPN на Android.'),
  str('default_interface', 'Исходящий интерфейс по умолчанию.'),
  num('default_mark', 'Метка исходящих соединений в Linux.'),
  domainResolverObject('default_domain_resolver', 'Каким DNS-сервером разрешать домены при исходящих соединениях.', { since: '1.12.0' }),
  en('default_network_strategy', 'Стратегия выбора сети по умолчанию.', ['default', 'hybrid', 'fallback'], { since: '1.11.0' }),
  strs('default_network_type', 'Предпочитаемые типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  strs('default_fallback_network_type', 'Запасные типы сети.', { values: NETWORK_TYPE_VALUES, since: '1.11.0' }),
  str('default_fallback_delay', 'Задержка перед запасной сетью.', { since: '1.11.0' }),
  str('default_http_client', 'Каким HTTP-клиентом скачивать удалённые наборы правил.', { since: '1.14.0' }),
  bool('find_process', 'Искать процесс соединения даже без правил по процессу.'),
  bool('find_neighbor', 'Опрашивать соседей по сети.', { since: '1.14.0' }),
  strs('dhcp_lease_files', 'Файлы аренды DHCP для имён хостов.', { since: '1.14.0' }),
  obj('geoip', 'Старая база geoip.', [], { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  obj('geosite', 'Старая база geosite.', [], { deprecated: removed('1.8.0', 'наборы правил rule_set') }),
  en('default_domain_strategy', 'Стратегия резолва доменов по умолчанию.', STRATEGY_VALUES, { deprecated: removed('1.12.0', 'default_domain_resolver') }),
]
```

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-schema-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Мутации**

1. У `outbound` заменить `routeLike` на `when('action', 'route')` — тест действий («outbound без action») красный. Вернуть.
2. Добавить в `HEADLESS_RULE_FIELDS` поле `str('clash_mode', …)` — тест наборов красный. Убрать.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/schema/route.ts frontend/test/singbox-schema-route.test.ts
git commit -m "feat(frontend): sing-box schema for route, rules and rule sets"
```

---

### Task 12: Схема log, ntp, certificate, experimental

**Files:**
- Create: `frontend/src/entities/singbox/schema/misc.ts`
- Test: `frontend/test/singbox-schema-misc.test.ts`

**Interfaces:**
- Consumes: задача 7.
- Produces: `LOG_FIELDS`, `NTP_FIELDS`, `CERTIFICATE_FIELDS`, `EXPERIMENTAL_FIELDS`.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/singbox-schema-misc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CERTIFICATE_FIELDS, EXPERIMENTAL_FIELDS, LOG_FIELDS, NTP_FIELDS } from '../src/entities/singbox/schema/misc'

describe('схема log/ntp/certificate/experimental', () => {
  it('log: уровень перечислением', () => {
    expect(LOG_FIELDS.map((f) => f.key)).toEqual(['disabled', 'level', 'output', 'timestamp'])
    expect(LOG_FIELDS.find((f) => f.key === 'level')?.enum?.map((e) => e.value)).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic'])
  })

  it('ntp: сервер, порт, интервал и dial-поля', () => {
    expect(NTP_FIELDS.map((f) => f.key)).toEqual(expect.arrayContaining(['enabled', 'server', 'server_port', 'interval', 'detour']))
  })

  it('certificate: хранилище и списки', () => {
    expect(CERTIFICATE_FIELDS.map((f) => f.key)).toEqual(['store', 'certificate', 'certificate_path', 'certificate_directory_path'])
  })

  it('experimental: cache_file, clash_api и v2ray_api с листьями; store_rdrc устарел', () => {
    const cache = EXPERIMENTAL_FIELDS.find((f) => f.key === 'cache_file')!
    expect(cache.fields?.map((f) => f.key)).toEqual(expect.arrayContaining(['enabled', 'path', 'cache_id', 'store_fakeip', 'store_rdrc', 'rdrc_timeout', 'store_dns']))
    expect(cache.fields?.find((f) => f.key === 'store_rdrc')?.deprecated?.since).toBe('1.14.0')
    const clash = EXPERIMENTAL_FIELDS.find((f) => f.key === 'clash_api')!
    expect(clash.fields?.map((f) => f.key)).toEqual(expect.arrayContaining(['external_controller', 'external_ui', 'external_ui_download_url', 'external_ui_download_detour', 'secret', 'default_mode', 'access_control_allow_origin', 'access_control_allow_private_network']))
    expect(clash.fields?.find((f) => f.key === 'external_ui_download_detour')?.ref).toBe('outbound')
    const v2 = EXPERIMENTAL_FIELDS.find((f) => f.key === 'v2ray_api')!
    expect(v2.fields?.find((f) => f.key === 'stats')?.fields?.map((f) => f.key)).toEqual(['enabled', 'inbounds', 'outbounds', 'users'])
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-schema-misc.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/singbox/schema/misc.ts`:

```ts
// Секции без графа: журнал, время, сертификаты, экспериментальное. Все они
// живут в панели «Документ».

import type { FieldSchema } from '../../../shared/schema'
import { DIAL_FIELDS, bool, en, num, obj, removed, str, strs } from './shared'

export const LOG_FIELDS: FieldSchema[] = [
  bool('disabled', 'Не писать журнал вовсе.'),
  en('level', 'Уровень журнала; пусто — info.', ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic']),
  str('output', 'Файл журнала; задан — в консоль не пишется.'),
  bool('timestamp', 'Печатать время записи.'),
]

export const NTP_FIELDS: FieldSchema[] = [
  bool('enabled', 'Включить встроенную синхронизацию времени.'),
  str('server', 'Сервер NTP.'),
  num('server_port', 'Порт NTP, по умолчанию 123.'),
  str('interval', 'Период синхронизации, по умолчанию 30m.'),
  ...DIAL_FIELDS,
]

export const CERTIFICATE_FIELDS: FieldSchema[] = [
  en('store', 'Какое хранилище корневых сертификатов брать; пусто — system.', ['system', 'mozilla', 'chrome', 'none']),
  strs('certificate', 'Дополнительные доверенные сертификаты в PEM.'),
  strs('certificate_path', 'Пути к файлам сертификатов.'),
  strs('certificate_directory_path', 'Каталоги с сертификатами.'),
]

export const EXPERIMENTAL_FIELDS: FieldSchema[] = [
  obj('cache_file', 'Файл кэша: адреса fakeip и выбранные в группах выходы переживают перезапуск. Нужен удалённым наборам правил.', [
    bool('enabled', 'Включить файл кэша.'),
    str('path', 'Путь к файлу, по умолчанию cache.db.'),
    str('cache_id', 'Идентификатор кэша для нескольких конфигов с одним файлом.'),
    bool('store_fakeip', 'Хранить соответствия fakeip.'),
    bool('store_rdrc', 'Хранить кэш отклонённых ответов.', { deprecated: removed('1.14.0', 'store_dns') }),
    str('rdrc_timeout', 'Время жизни кэша отклонённых ответов.', { deprecated: removed('1.14.0', 'store_dns') }),
    bool('store_dns', 'Хранить кэш DNS.', { since: '1.14.0' }),
    str('buffer_size', 'Размер буфера записи.', { since: '1.15.0' }),
    str('flush_interval', 'Период сброса на диск.', { since: '1.15.0' }),
  ]),
  obj('clash_api', 'Внешний интерфейс управления: порт, панель и режим по умолчанию.', [
    str('external_controller', 'Адрес API, например 127.0.0.1:9090.'),
    str('external_ui', 'Каталог веб-панели.'),
    str('external_ui_download_url', 'Откуда скачать веб-панель.'),
    str('external_ui_download_detour', 'Через какой выход скачивать панель.', { ref: 'outbound' }),
    str('secret', 'Секрет API.'),
    str('default_mode', 'Режим по умолчанию; пусто — Rule.'),
    strs('access_control_allow_origin', 'Разрешённые Origin для CORS.', { since: '1.10.0' }),
    bool('access_control_allow_private_network', 'Разрешить доступ из частной сети.', { since: '1.10.0' }),
  ]),
  obj('v2ray_api', 'gRPC API V2Ray; в сборку по умолчанию не входит.', [
    str('listen', 'Адрес API; пусто — выключен.'),
    obj('stats', 'Статистика трафика.', [
      bool('enabled', 'Включить статистику.'),
      strs('inbounds', 'Входы для подсчёта.', { ref: 'inbound' }),
      strs('outbounds', 'Выходы для подсчёта.', { ref: 'outbound' }),
      strs('users', 'Пользователи для подсчёта.'),
    ]),
  ]),
]
```

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-schema-misc.test.ts`
Expected: PASS.

- [ ] **Step 5: Мутация**

Убрать `deprecated` у `store_rdrc` — тест experimental красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/schema/misc.ts frontend/test/singbox-schema-misc.test.ts
git commit -m "feat(frontend): sing-box schema for log, ntp, certificate and experimental"
```

---

### Task 13: Сборка корня схемы, помощники и тест полноты

**Files:**
- Create: `frontend/src/entities/singbox/schema/index.ts`
- Modify: `frontend/src/entities/singbox/index.ts` (добавить `export * from './schema'`)
- Test: `frontend/test/singbox-schema.test.ts`

**Interfaces:**
- Consumes: задачи 7–12; `SingboxDoc`, `outboundsOf`, `ruleSetTagsOf` из модели.
- Produces:

```ts
export const SINGBOX_SCHEMA: FieldSchema[]
export function singboxFieldsAt(path: SchemaPath, doc: unknown): FieldSchema[] | undefined
export function singboxFieldAt(path: SchemaPath, doc: unknown): FieldSchema | undefined
export function singboxRefs(doc: SingboxDoc): Record<RefKind, string[]>
export function singboxEnum(path: SchemaPath, doc: unknown): EnumValue[]
export const SINGBOX_DOC_SECTIONS: DocSection[]
```

Имена `SINGBOX_SCHEMA`, `singboxFieldsAt`, `singboxRefs`, `SINGBOX_DOC_SECTIONS` не совпадают ни с одним экспортом старого `docSchema.ts` — оба модуля живут рядом до задачи 21.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/singbox-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import {
  SINGBOX_DOC_SECTIONS,
  SINGBOX_SCHEMA,
  singboxEnum,
  singboxFieldAt,
  singboxFieldsAt,
  singboxRefs,
} from '../src/entities/singbox/schema'
import type { FieldSchema } from '../src/shared/schema'
import { singboxFixture } from './helpers'

function walk(fields: FieldSchema[], seen = new Set<FieldSchema[]>(), visit: (f: FieldSchema) => void) {
  if (seen.has(fields)) return
  seen.add(fields)
  for (const f of fields) {
    visit(f)
    if (f.fields) walk(f.fields, seen, visit)
    if (f.item?.fields) walk(f.item.fields, seen, visit)
  }
}

describe('корень схемы sing-box', () => {
  it('описывает все секции корня', () => {
    expect(SINGBOX_SCHEMA.map((f) => f.key)).toEqual(['log', 'dns', 'ntp', 'certificate', 'endpoints', 'inbounds', 'outbounds', 'route', 'experimental', 'http_clients', 'services'])
  })

  it('у каждого поля дерева непустое описание, у устаревшего — замена, у ссылки — известный вид', () => {
    const refs = new Set(['outbound', 'inbound', 'dns-server', 'rule-set'])
    walk(SINGBOX_SCHEMA, new Set(), (f) => {
      expect(f.doc.trim(), f.key).not.toBe('')
      if (f.deprecated) expect(f.deprecated.replacement.trim(), f.key).not.toBe('')
      if (f.ref) expect(refs.has(f.ref), f.key).toBe(true)
      if (f.item?.ref) expect(refs.has(f.item.ref), f.key).toBe(true)
      for (const e of f.enum ?? []) if (e.deprecated) expect(e.deprecated.replacement.trim(), e.value).not.toBe('')
    })
  })

  it('спуск по пути в живом документе: группа и сервер различаются по типу', () => {
    const doc = parseSingbox(singboxFixture('bundle')).doc!
    const group = singboxFieldsAt(['outbounds', 0], doc)!.map((f) => f.key)
    expect(group).toContain('outbounds')
    expect(group).not.toContain('server')
    expect(singboxFieldsAt(['route', 'rules', 0], doc)!.map((f) => f.key)).toContain('rule_set')
    expect(singboxFieldsAt(['dns', 'servers', 0], doc)!.map((f) => f.key)).toContain('tag')
    expect(singboxFieldsAt(['dns', 'rules', 0], doc)!.map((f) => f.key)).toContain('server')
    expect(singboxFieldsAt(['experimental', 'cache_file'], doc)!.map((f) => f.key)).toContain('enabled')
    expect(singboxFieldsAt(['nope'], doc)).toBeUndefined()
  })

  it('legacy-документ: сервер без type видит поле address, выход block описан', () => {
    const doc = parseSingbox(singboxFixture('legacy')).doc!
    const server = singboxFieldsAt(['dns', 'servers', 0], doc)!.map((f) => f.key)
    expect(server).toContain('address')
    expect(singboxEnum(['outbounds', 0, 'type'], doc).map((e) => e.value)).toContain('block')
  })

  it('singboxFieldAt и singboxEnum', () => {
    const doc = { outbounds: [{ type: 'vless', tag: 'a' }] }
    expect(singboxFieldAt(['outbounds', 0, 'flow'], doc)?.kind).toBe('enum')
    expect(singboxEnum(['outbounds', 0, 'flow'], doc).map((e) => e.value)).toEqual(['xtls-rprx-vision'])
    expect(singboxEnum(['outbounds', 0, 'tag'], doc)).toEqual([])
  })

  it('singboxRefs собирает теги по обоим спискам выходов, входам, серверам DNS и наборам', () => {
    const doc = parseSingbox(`{
      "inbounds": [{"type":"tun","tag":"tun-in"}],
      "outbounds": [{"type":"direct","tag":"direct"}],
      "endpoints": [{"type":"wireguard","tag":"wg"}],
      "dns": {"servers": [{"type":"local","tag":"dns-local"}]},
      "route": {"rule_set": [{"type":"remote","tag":"ads","url":"u"}]}
    }`).doc!
    expect(singboxRefs(doc)).toEqual({
      outbound: ['direct', 'wg'],
      inbound: ['tun-in'],
      'dns-server': ['dns-local'],
      'rule-set': ['ads'],
    })
  })

  it('разделы панели «Документ» ведут в существующие поля схемы и не повторяют холст', () => {
    for (const section of SINGBOX_DOC_SECTIONS) {
      const field = singboxFieldAt(section.path, {})
      expect(field, section.title).toBeDefined()
      expect(field!.kind, section.title).toBe(section.kind === 'list' ? 'list' : 'object')
    }
    const route = SINGBOX_DOC_SECTIONS.find((s) => s.path.join('.') === 'route')!
    expect(route.skip).toEqual(expect.arrayContaining(['rules', 'rule_set']))
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-schema.test.ts`
Expected: FAIL — модуль `schema/index.ts` не найден.

- [ ] **Step 3: Реализовать**

`frontend/src/entities/singbox/schema/index.ts`:

```ts
// Корень схемы sing-box и помощники поверх общего разбора. Ветви собраны из
// своих файлов; здесь только сборка, спуск по пути и теги для ссылок.
//
// Целевая версия ядра у панели — 1.13.x; ключи 1.14 помечены since, удалённые
// — deprecated с заменой. Схема ОПИСЫВАЕТ, а не ограничивает: незнакомый ключ
// проходит в документ и не считается ошибкой (см. parse.ts).

import {
  fieldAt,
  fieldsAt,
  type DocSection,
  type EnumValue,
  type FieldSchema,
  type RefKind,
  type SchemaPath,
} from '../../../shared/schema'
import { outboundsOf } from '../outbounds'
import { ruleSetTagsOf } from '../rules'
import type { SingboxDoc } from '../types'
import { DNS_FIELDS } from './dns'
import { ENDPOINT_FIELDS } from './endpoints'
import { INBOUND_FIELDS } from './inbounds'
import { CERTIFICATE_FIELDS, EXPERIMENTAL_FIELDS, LOG_FIELDS, NTP_FIELDS } from './misc'
import { OUTBOUND_FIELDS } from './outbounds'
import { ROUTE_FIELDS } from './route'
import { DIAL_FIELDS, obj, objs, str, tagLabel } from './shared'

export * from './shared'
export * from './outbounds'
export * from './endpoints'
export * from './inbounds'
export * from './dns'
export * from './route'
export * from './misc'

export const SINGBOX_SCHEMA: FieldSchema[] = [
  obj('log', 'Журнал ядра: уровень и вывод.', LOG_FIELDS),
  obj('dns', 'Разрешение имён: свои серверы и свои правила, отдельные от маршрута.', DNS_FIELDS, {
    starter: () => ({
      servers: [
        { tag: 'dns-remote', type: 'tls', server: '1.1.1.1' },
        { tag: 'dns-local', type: 'local' },
      ],
      final: 'dns-local',
    }),
  }),
  obj('ntp', 'Синхронизация времени: нужна там, где системные часы врут, а TLS этого не прощает.', NTP_FIELDS),
  obj('certificate', 'Хранилище доверенных сертификатов.', CERTIFICATE_FIELDS, { since: '1.12.0' }),
  objs('endpoints', 'Конечные точки WireGuard и Tailscale (ядро 1.11 и новее).', ENDPOINT_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'wireguard', tag: '', address: [], private_key: '', peers: [] }),
  }),
  objs('inbounds', 'Входы клиента: чем ядро принимает трафик системы.', INBOUND_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'mixed', tag: '', listen: '127.0.0.1', listen_port: 2080 }),
  }),
  objs('outbounds', 'Выходы: серверы, группы выбора и прямой выход. Серверы подписки панель дописывает в КОНЕЦ этого списка.', OUTBOUND_FIELDS, {
    label: tagLabel,
    starter: () => ({ type: 'direct', tag: '' }),
  }),
  obj('route', 'Маршрутизация: правила, наборы правил и выход по умолчанию.', ROUTE_FIELDS, { starter: () => ({}) }),
  obj('experimental', 'Экспериментальные разделы: Clash API и файл кэша.', EXPERIMENTAL_FIELDS, {
    starter: () => ({ cache_file: { enabled: true } }),
  }),
  objs('http_clients', 'Именованные HTTP-клиенты: через них ядро скачивает наборы правил.', [str('tag', 'Имя клиента.'), ...DIAL_FIELDS], { label: tagLabel }, { since: '1.14.0' }),
  objs('services', 'Встроенные службы ядра (например, DERP или resolved).', [str('type', 'Тип службы.'), str('tag', 'Имя службы.')], { label: tagLabel }, { since: '1.13.0' }),
]

export function singboxFieldsAt(path: SchemaPath, doc: unknown): FieldSchema[] | undefined {
  return fieldsAt(SINGBOX_SCHEMA, path, doc)
}

export function singboxFieldAt(path: SchemaPath, doc: unknown): FieldSchema | undefined {
  return fieldAt(SINGBOX_SCHEMA, path, doc)
}

/** Известные значения перечисления по пути; пусто, если поле не перечисление */
export function singboxEnum(path: SchemaPath, doc: unknown): EnumValue[] {
  return singboxFieldAt(path, doc)?.enum ?? []
}

const tagsOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map((item) => (item as { tag?: unknown } | null)?.tag)
    .filter((t): t is string => typeof t === 'string' && t !== '')

/**
 * Теги документа для полей со ссылкой. Выходы — по ОБОИМ спискам: узел
 * out:<tag> граф рисует и по endpoints, и не назови мы такой тег, форма правила
 * предложила бы выбрать не всё, что на холсте.
 */
export function singboxRefs(doc: SingboxDoc): Record<RefKind, string[]> {
  return {
    outbound: [...tagsOf(outboundsOf(doc)), ...tagsOf(doc.endpoints)],
    inbound: tagsOf(doc.inbounds),
    'dns-server': tagsOf(doc.dns?.servers),
    'rule-set': ruleSetTagsOf(doc),
  }
}

/**
 * Разделы панели «Документ». Правила маршрута живут на холсте, наборы и
 * списки DNS — своими разделами: у секции-объекта они пропускаются, иначе
 * появились бы дважды.
 */
export const SINGBOX_DOC_SECTIONS: DocSection[] = [
  { title: 'Общие', path: ['log'], kind: 'object' },
  { title: 'DNS', path: ['dns'], kind: 'object', skip: ['servers', 'rules'] },
  { title: 'DNS-серверы', path: ['dns', 'servers'], kind: 'list' },
  { title: 'DNS-правила', path: ['dns', 'rules'], kind: 'list' },
  { title: 'Маршрут', path: ['route'], kind: 'object', skip: ['rules', 'rule_set'] },
  { title: 'Наборы правил', path: ['route', 'rule_set'], kind: 'list' },
  { title: 'Экспериментальное', path: ['experimental'], kind: 'object' },
  { title: 'NTP', path: ['ntp'], kind: 'object' },
  { title: 'Сертификаты', path: ['certificate'], kind: 'object' },
]
```

В `frontend/src/entities/singbox/index.ts` добавить строку `export * from './schema'` ПЕРЕД `export * from './docSchema'`. Экспорты не пересекаются по именам; если typecheck сообщит о конфликте имён — переименуйте конфликтующее в схеме (старый словарь уходит в задаче 21, его имена менять нельзя).

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-schema.test.ts test/singbox-schema-*.test.ts`
Expected: PASS.

- [ ] **Step 5: Мутации**

1. В `singboxRefs` убрать `...tagsOf(doc.endpoints)` — тест refs красный. Вернуть.
2. У раздела «Маршрут» убрать `skip` — тест разделов красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/schema/index.ts frontend/src/entities/singbox/index.ts frontend/test/singbox-schema.test.ts
git commit -m "feat(frontend): assemble the sing-box schema root with refs and document sections"
```

---

### Task 14: Писатель черновика, обобщённые мутации и стартеры

**Files:**
- Create: `frontend/src/entities/singbox/starters.ts`
- Modify: `frontend/src/entities/singbox/index.ts` (добавить `export * from './starters'`)
- Modify: `frontend/src/entities/graph/singbox/mutations.ts` (добавить `outboundSlot`, `insertAt`, `moveAt`, `removeAtPath`; `moveRule` переписать через `moveAt`)
- Modify: `frontend/src/features/editor/useSingboxDraft.ts` (`applyOps`, `lockAt`, `writer`)
- Test: `frontend/test/singbox-starters.test.ts`, `frontend/test/singbox-mutations.test.ts` (добавить блок), `frontend/test/singbox-draft.test.tsx` (добавить блок)

**Interfaces:**
- Consumes: `applyOps`, `DocOp`, `DocWriter`, `Lock` (задача 2); `panelFillsGroup`, `outboundsOf` из модели.
- Produces:

```ts
// entities/singbox/starters.ts
export function uniqueTag(taken: Iterable<string>, base: string): string   // base, base-2, base-3…
export function startInbound(doc: SingboxDoc): SingboxInbound     // mixed 127.0.0.1:2080, тег mixed-in
export function startOutbound(doc: SingboxDoc): SingboxOutbound   // direct, тег direct
export function startServer(doc: SingboxDoc): SingboxOutbound     // vless, server '', server_port 443, uuid '', тег server
export function startGroup(doc: SingboxDoc): SingboxOutbound      // selector, outbounds: [], тег select
export function startEndpoint(doc: SingboxDoc): Record<string, unknown> // wireguard, address [], private_key '', peers [], тег wg
export function startDnsServer(doc: SingboxDoc): Record<string, unknown> // udp 1.1.1.1, тег dns
export function startDnsRule(doc: SingboxDoc): SingboxRule        // { domain_suffix: [], server: <первый тег dns.servers или ''> }
export function startRuleSet(doc: SingboxDoc): SingboxRuleSet     // remote binary, тег ruleset
export function nodeIdOf(value: { type?: unknown; tag?: unknown }, list: 'inbounds' | 'outbounds' | 'endpoints'): string | null

// entities/graph/singbox/mutations.ts
export function outboundSlot(doc, tag): { key: 'outbounds' | 'endpoints'; at: number } | null
export function insertAt(doc, listPath: SchemaPath, value: unknown, index?: number): SingboxDoc
export function moveAt(doc, listPath: SchemaPath, index: number, dir: -1 | 1): SingboxEditResult
export function removeAtPath(doc, path: SchemaPath): SingboxDoc

// features/editor/useSingboxDraft.ts — SingboxDraft получает:
applyOps: (ops: DocOp[]) => void
lockAt: (path: SchemaPath) => Lock | null
writer: DocWriter
```

- [ ] **Step 1: Тесты стартеров**

`frontend/test/singbox-starters.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  nodeIdOf,
  startDnsRule,
  startDnsServer,
  startEndpoint,
  startGroup,
  startInbound,
  startOutbound,
  startRuleSet,
  startServer,
  uniqueTag,
} from '../src/entities/singbox/starters'

const DOC = {
  inbounds: [{ type: 'mixed', tag: 'mixed-in' }],
  outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'selector', tag: 'select' }],
  endpoints: [{ type: 'wireguard', tag: 'wg' }],
  dns: { servers: [{ type: 'local', tag: 'dns-local' }] },
}

describe('стартеры', () => {
  it('uniqueTag нумерует занятые с двойки', () => {
    expect(uniqueTag([], 'direct')).toBe('direct')
    expect(uniqueTag(['direct'], 'direct')).toBe('direct-2')
    expect(uniqueTag(['direct', 'direct-2'], 'direct')).toBe('direct-3')
  })

  it('теги выходов уникальны в объединении outbounds и endpoints', () => {
    expect(startOutbound(DOC).tag).toBe('direct-2')
    expect(startGroup(DOC).tag).toBe('select-2')
    expect(startEndpoint(DOC).tag).toBe('wg-2')
    expect(startServer(DOC)).toEqual({ type: 'vless', tag: 'server', server: '', server_port: 443, uuid: '' })
    expect(startInbound(DOC)).toEqual({ type: 'mixed', tag: 'mixed-in-2', listen: '127.0.0.1', listen_port: 2080 })
  })

  it('DNS-правило берёт первый сервер, набор правил — удалённый binary', () => {
    expect(startDnsRule(DOC)).toEqual({ domain_suffix: [], server: 'dns-local' })
    expect(startDnsRule({})).toEqual({ domain_suffix: [], server: '' })
    expect(startDnsServer(DOC)).toEqual({ type: 'udp', tag: 'dns', server: '1.1.1.1' })
    expect(startRuleSet(DOC)).toEqual({ type: 'remote', tag: 'ruleset', format: 'binary', url: '' })
  })

  it('nodeIdOf строит id по списку и типу', () => {
    expect(nodeIdOf({ type: 'mixed', tag: 'a' }, 'inbounds')).toBe('inbound:a')
    expect(nodeIdOf({ type: 'selector', tag: 'g' }, 'outbounds')).toBe('group:g')
    expect(nodeIdOf({ type: 'direct', tag: 'd' }, 'outbounds')).toBe('out:d')
    expect(nodeIdOf({ type: 'wireguard', tag: 'w' }, 'endpoints')).toBe('out:w')
    expect(nodeIdOf({ type: 'direct' }, 'outbounds')).toBeNull()
  })
})
```

- [ ] **Step 2: Тесты мутаций и писателя**

В `frontend/test/singbox-mutations.test.ts` добавить:

```ts
describe('обобщённые мутации по пути', () => {
  const base = parseSingbox(`{
    "inbounds": [{"type":"tun","tag":"a"},{"type":"mixed","tag":"b"}],
    "outbounds": [{"type":"direct","tag":"d"}],
    "endpoints": [{"type":"wireguard","tag":"w"}],
    "dns": {"servers":[{"type":"local","tag":"x"},{"type":"udp","tag":"y","server":"1.1.1.1"}]}
  }`).doc!

  it('insertAt вставляет в конец по умолчанию и заводит список, которого нет', () => {
    const next = insertAt(base, ['outbounds'], { type: 'direct', tag: 'e' })
    expect(next.outbounds!.map((o) => o.tag)).toEqual(['d', 'e'])
    const fresh = insertAt({}, ['route', 'rule_set'], { type: 'remote', tag: 'r' })
    expect(fresh.route!.rule_set!.map((s) => s.tag)).toEqual(['r'])
    expect(base.outbounds!.length).toBe(1)
  })

  it('moveAt переставляет соседей в любом списке и отказывает на краю', () => {
    const moved = moveAt(base, ['dns', 'servers'], 1, -1)
    expect(moved.doc!.dns!.servers!.map((s) => s.tag)).toEqual(['y', 'x'])
    expect(moveAt(base, ['dns', 'servers'], 0, -1).refusal).toBe('not-found')
    expect(moveAt(base, ['nope'], 0, 1).refusal).toBe('not-found')
  })

  it('removeAtPath вырезает элемент; outboundSlot различает списки', () => {
    expect(removeAtPath(base, ['inbounds', 0]).inbounds!.map((i) => i.tag)).toEqual(['b'])
    expect(outboundSlot(base, 'w')).toEqual({ key: 'endpoints', at: 0 })
    expect(outboundSlot(base, 'd')).toEqual({ key: 'outbounds', at: 0 })
    expect(outboundSlot(base, 'zz')).toBeNull()
  })

  it('moveRule по-прежнему работает поверх moveAt', () => {
    const doc = parseSingbox(`{"route":{"rules":[{"domain":["a"],"outbound":"d"},{"domain":["b"],"outbound":"d"}]}}`).doc!
    expect(moveRule(doc, 1, -1).doc!.route!.rules![0]!.domain).toEqual(['b'])
  })
})
```

(импорты `insertAt`, `moveAt`, `removeAtPath`, `outboundSlot` добавить к существующему импорту из `../src/entities/graph/singbox/mutations`).

В `frontend/test/singbox-draft.test.tsx` добавить:

```tsx
describe('черновик как писатель', () => {
  function mount() {
    return renderHook(() =>
      useSingboxDraft({ docKey: 'writer-test', panelJson: PANEL, baseVersion: 'h1' }),
    )
  }

  it('applyOps меняет текст черновика записью в историю', () => {
    const { result } = mount()
    act(() => result.current.applyOps([{ op: 'set', path: ['route', 'final'], value: 'direct' }]))
    expect(JSON.parse(result.current.text).route.final).toBe('direct')
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(JSON.parse(result.current.text).route.final).toBeUndefined()
  })

  it('lockAt закрывает список группы, которую заполняет панель, и молчит про закреплённую', () => {
    const { result } = mount()
    expect(result.current.lockAt(['outbounds', 0, 'outbounds'])?.reason).toMatch(/панел/i)
    act(() => result.current.applyOps([{ op: 'set', path: ['outbounds', 0, 'remnawave'], value: { includeProxies: false } }]))
    expect(result.current.lockAt(['outbounds', 0, 'outbounds'])).toBeNull()
    expect(result.current.lockAt(['outbounds', 1, 'tag'])).toBeNull()
  })

  it('writer — тот же объект между рендерами при неизменном документе', () => {
    const { result, rerender } = mount()
    const first = result.current.writer
    rerender()
    expect(result.current.writer).toBe(first)
  })
})
```

- [ ] **Step 3: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-starters.test.ts test/singbox-mutations.test.ts test/singbox-draft.test.tsx`
Expected: FAIL — нет модуля стартеров, нет `insertAt`, нет `applyOps` у черновика.

- [ ] **Step 4: Стартеры**

`frontend/src/entities/singbox/starters.ts`:

```ts
// Заготовки записей для меню «+ Добавить» и разделов панели «Документ».
// Каждая — минимум, который ядро примет и который сразу виден на холсте; тег
// уникален в своём пространстве имён. У выходов пространство общее с
// конечными точками: узел out:<tag> граф рисует по обоим спискам.

import { outboundsOf } from './outbounds'
import type { SingboxDoc, SingboxInbound, SingboxOutbound, SingboxRule, SingboxRuleSet } from './types'

export function uniqueTag(taken: Iterable<string>, base: string): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!set.has(candidate)) return candidate
  }
}

const tagsOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map((item) => (item as { tag?: unknown } | null)?.tag)
    .filter((t): t is string => typeof t === 'string')

const outboundTags = (doc: SingboxDoc): string[] => [...tagsOf(outboundsOf(doc)), ...tagsOf(doc.endpoints)]

export function startInbound(doc: SingboxDoc): SingboxInbound {
  return { type: 'mixed', tag: uniqueTag(tagsOf(doc.inbounds), 'mixed-in'), listen: '127.0.0.1', listen_port: 2080 }
}

export function startOutbound(doc: SingboxDoc): SingboxOutbound {
  return { type: 'direct', tag: uniqueTag(outboundTags(doc), 'direct') }
}

export function startServer(doc: SingboxDoc): SingboxOutbound {
  return { type: 'vless', tag: uniqueTag(outboundTags(doc), 'server'), server: '', server_port: 443, uuid: '' }
}

/** Список пуст намеренно: его заполнит панель, а «закрепить» можно кнопкой в форме */
export function startGroup(doc: SingboxDoc): SingboxOutbound {
  return { type: 'selector', tag: uniqueTag(outboundTags(doc), 'select'), outbounds: [] }
}

export function startEndpoint(doc: SingboxDoc): Record<string, unknown> {
  return { type: 'wireguard', tag: uniqueTag(outboundTags(doc), 'wg'), address: [], private_key: '', peers: [] }
}

export function startDnsServer(doc: SingboxDoc): Record<string, unknown> {
  return { type: 'udp', tag: uniqueTag(tagsOf(doc.dns?.servers), 'dns'), server: '1.1.1.1' }
}

/** Цель — первый сервер: правило без server ядро не примет, а первый сервер есть у любого рабочего документа */
export function startDnsRule(doc: SingboxDoc): SingboxRule {
  return { domain_suffix: [], server: tagsOf(doc.dns?.servers)[0] ?? '' }
}

export function startRuleSet(doc: SingboxDoc): SingboxRuleSet {
  return { type: 'remote', tag: uniqueTag(tagsOf(doc.route?.rule_set), 'ruleset'), format: 'binary', url: '' }
}

/** Id узла графа для только что вставленной записи — чтобы сразу открыть её в инспекторе */
export function nodeIdOf(value: { type?: unknown; tag?: unknown }, list: 'inbounds' | 'outbounds' | 'endpoints'): string | null {
  const tag = typeof value.tag === 'string' && value.tag !== '' ? value.tag : null
  if (tag === null) return null
  if (list === 'inbounds') return `inbound:${tag}`
  const type = typeof value.type === 'string' ? value.type : ''
  return list === 'outbounds' && (type === 'selector' || type === 'urltest') ? `group:${tag}` : `out:${tag}`
}
```

В `frontend/src/entities/singbox/index.ts` добавить `export * from './starters'`.

- [ ] **Step 5: Мутации по пути**

В `frontend/src/entities/graph/singbox/mutations.ts` добавить импорт `import { applyOps, valueAt, type SchemaPath } from '../../../shared/schema'` и функции:

```ts
/** Где лежит выход с тегом — наружу, с индексом: инспектору нужен порядок в списке */
export function outboundSlot(doc: SingboxDoc, tag: string): { key: 'outbounds' | 'endpoints'; at: number } | null {
  return findOutboundSlot(doc, tag)
}

/** Вставка в любой список по пути; отсутствующий список заводится по месту */
export function insertAt(doc: SingboxDoc, listPath: SchemaPath, value: unknown, index?: number): SingboxDoc {
  const list = valueAt(doc, listPath)
  const length = Array.isArray(list) ? list.length : 0
  return applyOps(doc, [{ op: 'insert', path: listPath, index: index ?? length, value }])
}

/** Перестановка соседей в любом списке; на краю и мимо списка — отказ */
export function moveAt(doc: SingboxDoc, listPath: SchemaPath, index: number, dir: -1 | 1): SingboxEditResult {
  const list = valueAt(doc, listPath)
  const to = index + dir
  if (!Array.isArray(list) || index < 0 || index >= list.length || to < 0 || to >= list.length) {
    return { refusal: 'not-found' }
  }
  return { doc: applyOps(doc, [{ op: 'move', path: listPath, from: index, to }]) }
}

export function removeAtPath(doc: SingboxDoc, path: SchemaPath): SingboxDoc {
  return applyOps(doc, [{ op: 'remove', path }])
}
```

и заменить тело `moveRule`:

```ts
export function moveRule(doc: SingboxDoc, index: number, dir: -1 | 1): SingboxEditResult {
  if (ruleAt(doc, index) === undefined) return { refusal: 'not-found' }
  return moveAt(doc, ['route', 'rules'], index, dir)
}
```

(`outboundSlotOf` остаётся — его использует инспектор до задачи 17.)

- [ ] **Step 6: Черновик как писатель**

В `frontend/src/features/editor/useSingboxDraft.ts`:

```ts
import { applyOps, type DocOp, type DocWriter, type Lock, type SchemaPath } from '../../shared/schema'
import { panelFillsGroup } from '../../entities/singbox'
```

в интерфейс `SingboxDraft` добавить:

```ts
  /** Операции по пути — единица правки форм по схеме */
  applyOps: (ops: DocOp[]) => void
  /** Замок: единственная причина у sing-box — список группы, которую заполняет панель */
  lockAt: (path: SchemaPath) => Lock | null
  writer: DocWriter
```

и в тело хука после `changeDoc`:

```ts
  const applyOpsToDoc = useCallback(
    (ops: DocOp[]) => {
      // Модели может не быть (текст не разбирается): тогда править нечего — форма
      // и не откроется, а операция мимо документа молча ничего не сделала бы
      if (core.model === undefined) return
      core.writeDraft(formatConfig(applyOps(core.model, ops)), { history: true })
    },
    [core],
  )

  const lockAt = useCallback(
    (path: SchemaPath): Lock | null => {
      const [head, index, key] = path
      if (head !== 'outbounds' || typeof index !== 'number' || key !== 'outbounds' || path.length !== 3) return null
      const group = core.model?.outbounds?.[index]
      if (group === undefined || !panelFillsGroup(group)) return null
      return { reason: PANEL_FILLS_LOCK }
    },
    [core.model],
  )

  const writer = useMemo<DocWriter>(() => ({ apply: applyOpsToDoc, lockAt }), [applyOpsToDoc, lockAt])
```

и константу рядом с `NO_CONTEXT`:

```ts
/** Текст замка списка группы: тот же довод, что у отказа кабелю panel-fills-group */
const PANEL_FILLS_LOCK =
  'Список этой группы заполняет панель: она перезапишет его целиком тегами серверов подписки. Чтобы править список руками, закрепите его кнопкой в форме группы.'
```

В возвращаемом объекте: `applyOps: applyOpsToDoc, lockAt, writer`.

- [ ] **Step 7: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-starters.test.ts test/singbox-mutations.test.ts test/singbox-draft.test.tsx`
Expected: PASS.

- [ ] **Step 8: Мутации**

1. В `uniqueTag` начать нумерацию с 1 — тест стартеров красный. Вернуть.
2. В `lockAt` убрать проверку `panelFillsGroup` (возвращать замок всегда для пути списка группы) — тест «молчит про закреплённую» красный. Вернуть.
3. В `moveAt` убрать проверку `to >= list.length` — тест «отказывает на краю» красный. Вернуть.

- [ ] **Step 9: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/starters.ts frontend/src/entities/singbox/index.ts frontend/src/entities/graph/singbox/mutations.ts frontend/src/features/editor/useSingboxDraft.ts frontend/test/singbox-starters.test.ts frontend/test/singbox-mutations.test.ts frontend/test/singbox-draft.test.tsx
git commit -m "feat(frontend): sing-box draft as a document writer with path mutations and starters"
```

---

### Task 15: Форма выхода, группы и конечной точки на `SchemaForm`

**Files:**
- Modify: `frontend/src/features/inspector/SingboxOutboundForm.tsx` (переписать)
- Test: `frontend/test/singbox-forms.test.tsx` (блок формы выхода переписать на новый контракт; блоки других форм не трогать — их правит задача 16)

**Interfaces:**
- Consumes: `SchemaForm` (задача 5), `OUTBOUND_FIELDS`, `OUTBOUND_TYPE_VALUES`, `ENDPOINT_FIELDS`, `ENDPOINT_TYPE_VALUES`, `GROUP_TYPES` (задача 8/13), `deprecatedNote` (задача 5), `makeWriter` (тесты).
- Produces:

```ts
export function SingboxOutboundForm(props: {
  value: SingboxOutbound
  /** Абсолютный путь записи: ['outbounds', i] либо ['endpoints', i] */
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
  /** Запись лежит в endpoints: типы и поля у неё свои */
  isEndpoint?: boolean
}): JSX.Element
```

Главные поля руками: «Тег», «Тип»; у сервера — «Сервер», «Порт сервера»; у группы — «Участники» с замком и кнопкой «Закрепить список»/«Открепить список» (тексты и подписи прежние, e2e на них завязан); у конечной точки — только тег и тип. Остальное — `SchemaForm` по `OUTBOUND_FIELDS` либо `ENDPOINT_FIELDS` со `skip` нарисованных ключей. Пустой тег отдаётся как `set` с `''` — отказ с объяснением делает обёртка писателя в инспекторе (задача 17), форма про это не знает.

- [ ] **Step 1: Переписать тесты формы выхода**

В `frontend/test/singbox-forms.test.tsx` заменить `describe('форма выхода sing-box', …)` целиком:

```tsx
import { makeWriter } from './schemaHelpers'

const REFS = { outbound: ['direct', 'proxy'], inbound: [], 'dns-server': ['dns-local'], 'rule-set': [] }

describe('форма выхода sing-box', () => {
  it('у группы список участников показан на чтение, пока его заполняет панель', () => {
    const { writer } = makeWriter([{ path: ['outbounds', 0, 'outbounds'], reason: 'Список заполняет панель.' }])
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: null }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Участники (список заполняет панель)')).toHaveAttribute('readonly')
    expect(screen.getByText(/Панель перезапишет его целиком/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Участники')).toBeNull()
  })

  it('кнопка закрепления ставит ключ панели одной операцией', async () => {
    const { ops, writer } = makeWriter([{ path: ['outbounds', 0, 'outbounds'], reason: 'x' }])
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: null }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Закрепить список' }))
    expect(ops).toEqual([{ op: 'set', path: ['outbounds', 0, 'remnawave'], value: { includeProxies: false } }])
  })

  it('обратная кнопка снимает ключ целиком, а не ставит true', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: [], remnawave: { includeProxies: false } }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Открепить список' }))
    expect(ops).toEqual([{ op: 'remove', path: ['outbounds', 0, 'remnawave'] }])
  })

  it('закреплённая группа правит участников списком строк', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: ['direct'], remnawave: { includeProxies: false } }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    await userEvent.type(screen.getByLabelText('Участники'), '\nproxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'outbounds'], value: ['direct', 'proxy'] })
  })

  it('у сервера показаны адрес и порт, протокольные поля приходят из схемы', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'vless', tag: 's', server: '1.2.3.4', server_port: 443, uuid: 'u' }} path={['outbounds', 2]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Сервер')).toHaveValue('1.2.3.4')
    expect(screen.getByLabelText('Порт сервера')).toHaveValue('443')
    expect(screen.getByLabelText('uuid')).toHaveValue('u')
    expect(screen.queryByLabelText('Участники')).toBeNull()
    await userEvent.type(screen.getByLabelText('Сервер'), '5')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 2, 'server'], value: '1.2.3.45' })
    // tls, transport, multiplex и dial-поля — под «Ещё поля»
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    expect(screen.getByRole('button', { name: 'tls' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'transport' })).toBeInTheDocument()
  })

  it('смена типа — одна операция; удалённый тип остаётся выбранным и объяснён', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'block', tag: 'b' }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    expect(selectedValue('Тип')).toBe('block')
    expect(screen.getByText(/1\.13\.0/)).toBeInTheDocument()
    await selectOption('Тип', 'direct')
    expect(ops).toEqual([{ op: 'set', path: ['outbounds', 0, 'type'], value: 'direct' }])
  })

  it('пустой тег уходит писателю как set с пустой строкой — отказ объясняет инспектор', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'direct', tag: 'd' }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tag'], value: '' })
  })

  it('конечная точка: типы wireguard/tailscale, пиры списком, полей сервера нет', async () => {
    const { ops, writer } = makeWriter()
    render(
      <SingboxOutboundForm value={{ type: 'wireguard', tag: 'wg', address: ['10.0.0.2/32'], peers: [{ public_key: 'k' }] }} path={['endpoints', 0]} writer={writer} refs={REFS} isEndpoint />,
    )
    expect(await optionLabels('Тип')).toEqual(['wireguard', 'tailscale'])
    expect(screen.queryByLabelText('Сервер')).toBeNull()
    expect(screen.getByRole('group', { name: 'peers' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    expect(ops.at(-1)?.op).toBe('insert')
    expect(ops.at(-1)?.path).toEqual(['endpoints', 0, 'peers'])
  })
})
```

Импорт `SingboxExtraFields` из файла теста удалить вместе с его тестами (компонент уходит в задаче 21; до неё его тесты, если они в этом файле, переносятся в `schema-form.test.tsx` только если проверяют что-то, чего там нет; иначе удаляются).

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-forms.test.tsx`
Expected: FAIL — у формы нет пропов `path`/`writer`.

- [ ] **Step 3: Переписать форму**

`frontend/src/features/inspector/SingboxOutboundForm.tsx`:

```tsx
// Форма выхода sing-box: одна на сервер, группу и конечную точку. Первых двух
// разводит поле `type`, третью — проп `isEndpoint`: тип у неё свой, и по
// документу его не отличить — знает это только СПИСОК, в котором лежит запись.
//
// Главные поля нарисованы руками, всё остальное даёт SchemaForm по ветви
// схемы. Правка — операции по абсолютному пути: форма не знает, где лежит
// запись, и не собирает документ; писатель приходит из инспектора.

import {
  ENDPOINT_FIELDS,
  ENDPOINT_TYPE_VALUES,
  GROUP_TYPES,
  OUTBOUND_FIELDS,
  OUTBOUND_TYPE_VALUES,
  SERVER_OUTBOUND_TYPES,
  panelFillsGroup,
  type SingboxOutbound,
} from '../../entities/singbox'
import type { DocWriter, EnumValue, RefKind, SchemaPath } from '../../shared/schema'
import { Button, TextInput, type SelectOption } from '../../shared/ui'
import { Field, NumberField, SelectField, StringListField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { deprecatedNote } from './schema/labels'

// skip — ровно то, что нарисовано руками: второй раз показывать ключ незачем.
// Списки названы поимённо, а не собраны из JSX: собранный расходился бы с
// разметкой молча, стоило убрать одно поле
const SHOWN_GROUP = ['tag', 'type', 'outbounds', 'remnawave']
const SHOWN_SERVER = ['tag', 'type', 'server', 'server_port']
const SHOWN_ENDPOINT = ['tag', 'type']

const PANEL_NOTE =
  'Список выходов группы. Панель заменит его целиком: у urltest — тегами серверов, у selector — серверами и группами urltest. Чтобы список остался вашим, поставьте remnawave.includeProxies = false.'

/** Варианты схемы плюс текущее значение, если схема его не знает: молча подменять чужой тип первым из списка нельзя */
function typeOptions(values: EnumValue[], current: string): SelectOption[] {
  const options = values.map((e) => ({ value: e.value, label: e.value }))
  return current !== '' && !options.some((o) => o.value === current) ? [{ value: current, label: current }, ...options] : options
}

/** Подсказка под селектом типа: описание значения и, для устаревшего, замена */
function typeHint(values: EnumValue[], current: string): string | undefined {
  const hit = values.find((e) => e.value === current)
  if (hit === undefined) return undefined
  return hit.deprecated === undefined ? hit.doc : `${hit.doc ?? ''} ${deprecatedNote(hit.deprecated)}`.trim()
}

export function SingboxOutboundForm({
  value,
  path,
  writer,
  refs,
  isEndpoint = false,
}: {
  value: SingboxOutbound
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
  isEndpoint?: boolean
}) {
  const isGroup = !isEndpoint && GROUP_TYPES.includes(value.type)
  const isServer = !isEndpoint && SERVER_OUTBOUND_TYPES.includes(value.type)
  const panelFills = !isEndpoint && panelFillsGroup(value)
  const typeValues = isEndpoint ? ENDPOINT_TYPE_VALUES : OUTBOUND_TYPE_VALUES
  const fields = isEndpoint ? ENDPOINT_FIELDS : OUTBOUND_FIELDS
  const at = (key: string): SchemaPath => [...path, key]
  const set = (key: string, next: unknown) => writer.apply([{ op: 'set', path: at(key), value: next }])
  const remove = (key: string) => writer.apply([{ op: 'remove', path: at(key) }])

  return (
    <>
      <TextField
        label="Тег"
        hint="Имя выхода: по нему на него ссылаются правила и группы."
        value={value.tag}
        // Пустой тег — set пустой строки, а не remove: инспектор на него откажет
        // с объяснением, а снятый ключ он бы просто не заметил
        onChange={(v) => set('tag', v ?? '')}
      />
      <SelectField
        label="Тип"
        hint={typeHint(typeValues, value.type)}
        value={value.type}
        options={typeOptions(typeValues, value.type)}
        onChange={(v) => set('type', v)}
      />
      {isServer && (
        <>
          <TextField
            label="Сервер"
            hint="Адрес сервера."
            value={typeof value.server === 'string' ? value.server : undefined}
            onChange={(v) => (v === undefined ? remove('server') : set('server', v))}
          />
          <NumberField
            label="Порт сервера"
            value={typeof value.server_port === 'number' ? value.server_port : undefined}
            onChange={(v) => (v === undefined ? remove('server_port') : set('server_port', v))}
          />
        </>
      )}
      {isGroup &&
        (panelFills ? (
          <>
            <Field label="Участники (список заполняет панель)" hint={PANEL_NOTE}>
              <TextInput readOnly value={(Array.isArray(value.outbounds) ? value.outbounds : []).join('\n')} />
            </Field>
            <Button onClick={() => set('remnawave', { includeProxies: false })}>Закрепить список</Button>
          </>
        ) : (
          <>
            <StringListField
              label="Участники"
              hint="Теги выходов группы по одному в строке. Список закреплён: панель его не тронет."
              value={Array.isArray(value.outbounds) && value.outbounds.length > 0 ? value.outbounds : undefined}
              onChange={(v) => set('outbounds', v ?? [])}
            />
            {/* includeProxies: true — не «как было»: осмысленное значение у ключа ровно одно */}
            <Button variant="ghost" onClick={() => remove('remnawave')}>Открепить список</Button>
          </>
        ))}
      <SchemaForm
        fields={fields}
        value={value as Record<string, unknown>}
        path={path}
        writer={writer}
        refs={refs}
        skip={isEndpoint ? SHOWN_ENDPOINT : isGroup ? SHOWN_GROUP : SHOWN_SERVER}
      />
    </>
  )
}
```

`GROUP_TYPES` и `SERVER_OUTBOUND_TYPES` экспортируются из `schema/outbounds.ts` (задача 8) и доступны через `entities/singbox`. `SchemaForm` для незакреплённой группы нарисовал бы `outbounds` из схемы дважды — потому ключ в `SHOWN_GROUP`.

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-forms.test.tsx`
Expected: блок формы выхода PASS; блоки других форм в этом файле пока красные, если задача 16 ещё не выполнена — это ожидаемо в параллельной волне: запускайте с фильтром `-t "форма выхода"`.

- [ ] **Step 5: Мутации**

1. Убрать `'outbounds'` из `SHOWN_GROUP` — тест «закреплённая группа правит участников» красный (два поля с одной подписью). Вернуть.
2. В кнопке «Закрепить список» писать `{ includeProxies: true }` — тест закрепления красный. Вернуть.

- [ ] **Step 6: Typecheck по своим файлам и коммит**

Typecheck покраснеет в `SingboxInspector.tsx` (старый контракт формы) — это чинит задача 17 в следующей волне; контроллер коммитит волну целиком после неё.

```bash
git add frontend/src/features/inspector/SingboxOutboundForm.tsx frontend/test/singbox-forms.test.tsx
git commit -m "feat(frontend): sing-box outbound form on the schema renderer"
```

---

### Task 16: Формы входа, правила, набора правил, DNS-сервера и новая форма DNS-правила

**Files:**
- Modify: `frontend/src/features/inspector/SingboxInboundForm.tsx`, `SingboxRuleForm.tsx`, `SingboxRuleSetForm.tsx`, `SingboxDnsServerForm.tsx` (переписать)
- Create: `frontend/src/features/inspector/SingboxDnsRuleForm.tsx`
- Test: `frontend/test/singbox-forms.test.tsx` (блоки этих форм), `frontend/test/singbox-dns-rule-form.test.tsx`

**Interfaces:**
- Общий контракт всех пяти форм: `{ value, path: SchemaPath, writer: DocWriter, refs: Partial<Record<RefKind, string[]>> }`.
- Consumes: `INBOUND_FIELDS`, `INBOUND_TYPE_VALUES`, `ROUTE_RULE_FIELDS`, `ROUTE_RULE_ACTION_VALUES`, `RULE_SET_FIELDS`, `DNS_SERVER_FIELDS`, `DNS_SERVER_TYPE_VALUES`, `DNS_RULE_FIELDS`, `DNS_RULE_ACTION_VALUES`, `visibleFields`, `SchemaForm`, `deprecatedNote`.

- [ ] **Step 1: Тесты**

Заменить в `frontend/test/singbox-forms.test.tsx` блоки правила, входа, набора и DNS-сервера на:

```tsx
describe('форма правила sing-box', () => {
  const RULE_REFS = { outbound: ['direct', 'proxy'], inbound: ['tun-in'], 'dns-server': ['dns-local'], 'rule-set': ['ads'] }

  it('действие route показывает выход и пишет его одной операцией', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxRuleForm value={{ domain: ['a.com'], outbound: 'direct' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(selectedValue('Действие')).toBe('route')
    await selectOption('Выход', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'rules', 0, 'outbound'], value: 'proxy' })
  })

  it('смена действия на нетерминальное снимает выход', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxRuleForm value={{ outbound: 'direct' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    await selectOption('Действие', 'sniff')
    expect(ops).toEqual([
      { op: 'set', path: ['route', 'rules', 0, 'action'], value: 'sniff' },
      { op: 'remove', path: ['route', 'rules', 0, 'outbound'] },
    ])
    expect(screen.queryByLabelText('Выход')).toBeNull()
  })

  it('поля действия приходят из схемы: у sniff — sniffer, у reject — method', () => {
    const { writer } = makeWriter()
    const { rerender } = render(<SingboxRuleForm value={{ action: 'sniff' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(screen.getByText('sniffer')).toBeInTheDocument()
    rerender(<SingboxRuleForm value={{ action: 'reject' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(screen.getByText('method')).toBeInTheDocument()
  })

  it('порт назначения пишется числами, пустой список снимает ключ', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxRuleForm value={{ port: [443] }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    await userEvent.type(screen.getByLabelText('Порт назначения'), '\n80')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'rules', 0, 'port'], value: [443, 80] })
    await userEvent.clear(screen.getByLabelText('Порт назначения'))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['route', 'rules', 0, 'port'] })
  })

  it('наборы правил — чипы из документа плюс битая ссылка', async () => {
    const { writer } = makeWriter()
    render(<SingboxRuleForm value={{ rule_set: ['gone'] }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(screen.getByText('gone')).toBeInTheDocument()
    expect(screen.getByText('ads')).toBeInTheDocument()
  })
})

describe('форма входа sing-box', () => {
  it('тег и тип руками, остальное по типу из схемы', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxInboundForm value={{ type: 'tun', tag: 'tun-in', auto_route: true }} path={['inbounds', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Тег')).toHaveValue('tun-in')
    expect(screen.queryByText('listen_port')).toBeNull()
    expect(screen.getByRole('button', { name: 'нет' })).toBeInTheDocument()
    await selectOption('Тип', 'mixed')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['inbounds', 0, 'type'], value: 'mixed' })
  })
})

describe('форма набора правил sing-box', () => {
  it('удалённый набор: ссылка и выход загрузки; встроенный — правила списком', async () => {
    const { ops, writer } = makeWriter()
    const { rerender } = render(<SingboxRuleSetForm value={{ type: 'remote', tag: 'ads', format: 'binary', url: 'u' }} path={['route', 'rule_set', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Ссылка')).toHaveValue('u')
    await selectOption('Скачивать через выход', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'rule_set', 0, 'download_detour'], value: 'proxy' })
    rerender(<SingboxRuleSetForm value={{ type: 'inline', tag: 'mine', rules: [{ domain: ['a'] }] }} path={['route', 'rule_set', 0]} writer={writer} refs={REFS} />)
    expect(screen.queryByLabelText('Ссылка')).toBeNull()
    expect(screen.getByRole('group', { name: 'rules' })).toBeInTheDocument()
  })
})

describe('форма DNS-сервера sing-box', () => {
  it('tls-сервер: адрес, выход и объект tls из схемы; legacy address виден с пометкой', async () => {
    const { ops, writer } = makeWriter()
    const { rerender } = render(<SingboxDnsServerForm value={{ type: 'tls', tag: 'r', server: '1.1.1.1' }} path={['dns', 'servers', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Адрес')).toHaveValue('1.1.1.1')
    await selectOption('Через выход', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['dns', 'servers', 0, 'detour'], value: 'proxy' })
    rerender(<SingboxDnsServerForm value={{ tag: 'old', address: 'tls://1.1.1.1' }} path={['dns', 'servers', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('address')).toHaveValue('tls://1.1.1.1')
    expect(screen.getByText(/1\.12\.0/)).toBeInTheDocument()
  })
})
```

`frontend/test/singbox-dns-rule-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SingboxDnsRuleForm } from '../src/features/inspector/SingboxDnsRuleForm'
import { selectOption, selectedValue } from './helpers'
import { makeWriter } from './schemaHelpers'

const REFS = { outbound: ['direct'], inbound: [], 'dns-server': ['dns-remote', 'dns-local'], 'rule-set': ['ads'] }

describe('форма DNS-правила', () => {
  it('без action считается route и показывает сервер из документа', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDnsRuleForm value={{ domain_suffix: ['a.com'], server: 'dns-remote' }} path={['dns', 'rules', 0]} writer={writer} refs={REFS} />)
    expect(selectedValue('Действие')).toBe('route')
    await selectOption('Сервер', 'dns-local')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['dns', 'rules', 0, 'server'], value: 'dns-local' })
  })

  it('reject снимает сервер и показывает method', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDnsRuleForm value={{ server: 'dns-remote' }} path={['dns', 'rules', 0]} writer={writer} refs={REFS} />)
    await selectOption('Действие', 'reject')
    expect(ops).toEqual([
      { op: 'set', path: ['dns', 'rules', 0, 'action'], value: 'reject' },
      { op: 'remove', path: ['dns', 'rules', 0, 'server'] },
    ])
  })

  it('матчеры DNS приходят из схемы: query_type есть, hijack-dns нет', () => {
    const { writer } = makeWriter()
    render(<SingboxDnsRuleForm value={{ query_type: ['A'] }} path={['dns', 'rules', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('query_type')).toBeInTheDocument()
    expect(screen.queryByText('hijack-dns')).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-forms.test.tsx test/singbox-dns-rule-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Общий помощник селекта типа**

Вынесите `typeOptions`/`typeHint` из задачи 15 в `frontend/src/features/inspector/schema/typeSelect.ts` и импортируйте оттуда в обеих задачах (координация: задача 15 создаёт файл; если он ещё не существует в вашей волне — создайте его с тем же содержимым, контроллер сведёт):

```ts
import type { EnumValue } from '../../../shared/schema'
import type { SelectOption } from '../../../shared/ui'
import { deprecatedNote } from './labels'

/** Варианты схемы плюс текущее значение, если схема его не знает */
export function typeOptions(values: EnumValue[], current: string, notSet = false): SelectOption[] {
  const options = values.map((e) => ({ value: e.value, label: e.value }))
  const head = notSet ? [{ value: '', label: '(не задано)' }] : []
  const extra = current !== '' && !options.some((o) => o.value === current) ? [{ value: current, label: current }] : []
  return [...head, ...extra, ...options]
}

/** Подсказка под селектом: описание значения и, для устаревшего, замена */
export function typeHint(values: EnumValue[], current: string): string | undefined {
  const hit = values.find((e) => e.value === current)
  if (hit === undefined) return undefined
  return hit.deprecated === undefined ? hit.doc : `${hit.doc ?? ''} ${deprecatedNote(hit.deprecated)}`.trim()
}
```

- [ ] **Step 4: Форма входа**

`frontend/src/features/inspector/SingboxInboundForm.tsx`:

```tsx
// Форма входа клиента sing-box: тег и тип руками, остальное — по типу из схемы
// (у tun свои поля, у прокси-входов listen-поля и пользователи).

import { INBOUND_FIELDS, INBOUND_TYPE_VALUES, type SingboxInbound } from '../../entities/singbox'
import type { DocWriter, RefKind, SchemaPath } from '../../shared/schema'
import { SelectField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeHint, typeOptions } from './schema/typeSelect'

const SHOWN = ['tag', 'type']

export function SingboxInboundForm({ value, path, writer, refs }: {
  value: SingboxInbound
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const set = (key: string, next: unknown) => writer.apply([{ op: 'set', path: [...path, key], value: next }])
  return (
    <>
      <TextField
        label="Тег"
        hint="Имя входа: на него ссылается условие inbound в правилах."
        value={value.tag}
        onChange={(v) => set('tag', v ?? '')}
      />
      <SelectField label="Тип" hint={typeHint(INBOUND_TYPE_VALUES, value.type)} value={value.type} options={typeOptions(INBOUND_TYPE_VALUES, value.type)} onChange={(v) => set('type', v)} />
      <SchemaForm fields={INBOUND_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
```

- [ ] **Step 5: Форма правила**

`frontend/src/features/inspector/SingboxRuleForm.tsx` — переписать, сохранив четырнадцать нынешних контролов и их подписи («Действие», «Выход», «Домен (точное совпадение)», «Суффикс домена», «Подстрока в домене», «Регулярное выражение по домену», «IP назначения», «Частный адрес назначения», «Порт назначения», «Диапазон портов», «Наборы правил», «Входы (inbound)», «Протокол», «Режим Clash»):

```tsx
// Форма правила маршрутизации sing-box: главные условия, действие и цель
// руками; остальные матчеры и поля действия — из схемы по значению action.

import { ROUTE_RULE_ACTION_VALUES, ROUTE_RULE_FIELDS, type SingboxRule } from '../../entities/singbox'
import type { DocOp, DocWriter, RefKind, SchemaPath } from '../../shared/schema'
import { type SelectOption } from '../../shared/ui'
import { MultiSelectField, SelectField, StringListField, TextField, TriStateField } from './fields'
import { SchemaForm } from './schema/SchemaForm'

const SHOWN = ['action', 'outbound', 'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr', 'ip_is_private', 'port', 'port_range', 'protocol', 'clash_mode', 'rule_set', 'inbound']

/** Отсутствующее действие означает маршрут — в списке это отдельного значения не требует */
const DEFAULT_ACTION = 'route'
const ACTION_OPTIONS: SelectOption[] = ROUTE_RULE_ACTION_VALUES.map((e) => ({ value: e.value, label: e.value }))
/** Действия с целью-выходом: route и bypass */
const WITH_OUTBOUND = new Set(['route', 'bypass'])

/** Теги документа плюс значения из самого правила: битая ссылка должна быть видима и снимаема из формы */
function tagOptions(known: string[], selected: string[]): SelectOption[] {
  const all = [...known]
  for (const t of selected) if (!all.includes(t)) all.push(t)
  return all.map((v) => ({ value: v, label: v }))
}

const strings = (raw: unknown): string[] | undefined => (Array.isArray(raw) ? raw.map((v) => String(v)) : undefined)

export function SingboxRuleForm({ value, path, writer, refs }: {
  value: SingboxRule
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const action = typeof value.action === 'string' ? value.action : DEFAULT_ACTION
  const outbound = typeof value.outbound === 'string' ? value.outbound : ''
  const at = (key: string): SchemaPath => [...path, key]
  const setOrRemove = (key: string, next: unknown) =>
    writer.apply([next === undefined || next === '' ? { op: 'remove', path: at(key) } : { op: 'set', path: at(key), value: next }])

  const listRow = (key: string, label: string, hint?: string, placeholder?: string) => (
    <StringListField key={key} label={label} hint={hint} placeholder={placeholder} value={strings(value[key])} onChange={(v) => setOrRemove(key, v)} />
  )

  function changeAction(v: string) {
    // Ядро при нетерминальном или не-маршрутном действии поле outbound не
    // читает. Держать его в документе значит показывать связь, которой нет, —
    // поэтому смена действия его убирает, а не прячет
    const ops: DocOp[] = [v === DEFAULT_ACTION ? { op: 'remove', path: at('action') } : { op: 'set', path: at('action'), value: v }]
    if (!WITH_OUTBOUND.has(v) && value.outbound !== undefined) ops.push({ op: 'remove', path: at('outbound') })
    writer.apply(ops)
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>Правила проверяются сверху вниз — срабатывает первое совпавшее.</p>
      <SelectField label="Действие" hint={ROUTE_RULE_ACTION_VALUES.find((e) => e.value === action)?.doc} value={action} options={ACTION_OPTIONS} onChange={changeAction} />
      {WITH_OUTBOUND.has(action) && (
        <SelectField
          label="Выход"
          hint="Тег выхода, в который уйдёт совпавшее соединение."
          value={outbound}
          options={[{ value: '', label: '— не задан —' }, ...tagOptions(refs.outbound ?? [], outbound === '' ? [] : [outbound])]}
          onChange={(v) => setOrRemove('outbound', v)}
        />
      )}
      {listRow('domain', 'Домен (точное совпадение)', undefined, 'example.com')}
      {listRow('domain_suffix', 'Суффикс домена', 'Без ведущей точки совпадает и сам домен, и его поддомены; с точкой — только поддомены.', '.example.com')}
      {listRow('domain_keyword', 'Подстрока в домене')}
      {listRow('domain_regex', 'Регулярное выражение по домену')}
      {listRow('ip_cidr', 'IP назначения', 'IP или подсеть: 10.0.0.0/8', '10.0.0.0/8')}
      <TriStateField label="Частный адрес назначения" hint="Совпадает, когда адрес назначения из частного диапазона." value={typeof value.ip_is_private === 'boolean' ? value.ip_is_private : undefined} onChange={(v) => (v === undefined ? setOrRemove('ip_is_private', undefined) : writer.apply([{ op: 'set', path: at('ip_is_private'), value: v }]))} />
      <StringListField
        label="Порт назначения"
        hint="По одному порту в строке."
        placeholder="443"
        value={strings(value.port)}
        // Ядро ждёт в `port` числа, а поле отдаёт строки: числовую строку приводим обратно; не число пишем как есть — подменять набранное форма не вправе
        onChange={(v) => setOrRemove('port', v?.map((s) => (/^\d+$/.test(s) ? Number(s) : s)))}
      />
      {listRow('port_range', 'Диапазон портов', 'Например 1000:2000', '1000:2000')}
      <MultiSelectField label="Наборы правил" hint="Содержимое набора лежит по ссылке — редактор его не скачивает." options={tagOptions(refs['rule-set'] ?? [], strings(value.rule_set) ?? [])} value={strings(value.rule_set)} onChange={(v) => setOrRemove('rule_set', v)} />
      {listRow('inbound', 'Входы (inbound)', 'Теги входов, с которых пришло соединение.')}
      {listRow('protocol', 'Протокол', 'Определяется сниффингом — редактор его предсказать не может.')}
      <TextField label="Режим Clash" hint="Режим, выбранный в клиенте через Clash API. Документом не задаётся." value={typeof value.clash_mode === 'string' ? value.clash_mode : undefined} onChange={(v) => setOrRemove('clash_mode', v)} />
      <SchemaForm fields={ROUTE_RULE_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
```

- [ ] **Step 6: Форма набора правил и DNS-сервера**

`frontend/src/features/inspector/SingboxRuleSetForm.tsx`:

```tsx
// Форма набора правил sing-box: тег, откуда берётся, формат, ссылка и выход
// загрузки руками; путь, интервал и правила встроенного набора — из схемы.

import { RULE_SET_FIELDS, type SingboxRuleSet } from '../../entities/singbox'
import { visibleFields, type DocWriter, type RefKind, type SchemaPath } from '../../shared/schema'
import { SelectField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeOptions } from './schema/typeSelect'

const SHOWN = ['tag', 'type', 'format', 'url', 'download_detour']
const enumOf = (key: string) => RULE_SET_FIELDS.find((f) => f.key === key)?.enum ?? []

export function SingboxRuleSetForm({ value, path, writer, refs }: {
  value: SingboxRuleSet
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const type = typeof value.type === 'string' ? value.type : ''
  const format = typeof value.format === 'string' ? value.format : ''
  const detour = typeof value.download_detour === 'string' ? value.download_detour : ''
  const visible = new Set(visibleFields(RULE_SET_FIELDS, value).map((f) => f.key))
  const setOrRemove = (key: string, next: unknown) =>
    writer.apply([next === undefined || next === '' ? { op: 'remove', path: [...path, key] } : { op: 'set', path: [...path, key], value: next }])

  return (
    <>
      <TextField label="Тег" hint="Имя набора: по нему на набор ссылаются правила." value={value.tag} onChange={(v) => writer.apply([{ op: 'set', path: [...path, 'tag'], value: v ?? '' }])} />
      <SelectField label="Откуда берётся" value={type} options={typeOptions(enumOf('type'), type, true)} onChange={(v) => setOrRemove('type', v)} />
      {visible.has('format') && (
        <SelectField label="Формат" hint="binary (.srs) или source (.json)." value={format} options={typeOptions(enumOf('format'), format, true)} onChange={(v) => setOrRemove('format', v)} />
      )}
      {visible.has('url') && (
        <TextField label="Ссылка" value={typeof value.url === 'string' ? value.url : undefined} onChange={(v) => setOrRemove('url', v)} />
      )}
      {visible.has('download_detour') && (
        <SelectField
          label="Скачивать через выход"
          hint="Тег выхода, через который клиент загрузит набор. Устарело с 1.14: там это http_client."
          value={detour}
          options={typeOptions((refs.outbound ?? []).map((value) => ({ value })), detour, true)}
          onChange={(v) => setOrRemove('download_detour', v)}
        />
      )}
      <SchemaForm fields={RULE_SET_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
```

`frontend/src/features/inspector/SingboxDnsServerForm.tsx`:

```tsx
// Форма DNS-сервера sing-box: тег, транспорт, адрес и выход руками; всё по
// типу — из схемы. Старый формат (address без type) не скрывается: схема
// показывает его поля с пометкой устаревшего.

import { DNS_SERVER_FIELDS, DNS_SERVER_TYPE_VALUES } from '../../entities/singbox'
import { visibleFields, type DocWriter, type RefKind, type SchemaPath } from '../../shared/schema'
import { SelectField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeHint, typeOptions } from './schema/typeSelect'

const SHOWN = ['tag', 'type', 'server', 'detour']

export function SingboxDnsServerForm({ value, path, writer, refs }: {
  value: Record<string, unknown>
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const type = typeof value.type === 'string' ? value.type : ''
  const detour = typeof value.detour === 'string' ? value.detour : ''
  const visible = new Set(visibleFields(DNS_SERVER_FIELDS, value).map((f) => f.key))
  const setOrRemove = (key: string, next: unknown) =>
    writer.apply([next === undefined || next === '' ? { op: 'remove', path: [...path, key] } : { op: 'set', path: [...path, key], value: next }])

  return (
    <>
      <TextField label="Тег" hint="Имя сервера: по нему на него ссылаются правила DNS." value={typeof value.tag === 'string' ? value.tag : undefined} onChange={(v) => writer.apply([{ op: 'set', path: [...path, 'tag'], value: v ?? '' }])} />
      <SelectField label="Транспорт" hint={typeHint(DNS_SERVER_TYPE_VALUES, type)} value={type} options={typeOptions(DNS_SERVER_TYPE_VALUES, type, true)} onChange={(v) => setOrRemove('type', v)} />
      {visible.has('server') && (
        <TextField label="Адрес" value={typeof value.server === 'string' ? value.server : undefined} onChange={(v) => setOrRemove('server', v)} />
      )}
      {visible.has('detour') && (
        <SelectField label="Через выход" hint="Тег выхода, через который уйдут запросы этого сервера." value={detour} options={typeOptions((refs.outbound ?? []).map((value) => ({ value })), detour, true)} onChange={(v) => setOrRemove('detour', v)} />
      )}
      <SchemaForm fields={DNS_SERVER_FIELDS} value={value} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
```

- [ ] **Step 7: Форма DNS-правила**

`frontend/src/features/inspector/SingboxDnsRuleForm.tsx`:

```tsx
// Форма DNS-правила: действие и сервер руками, матчеры и поля действия — из
// схемы. Отдельная от формы правила маршрута намеренно: цель здесь — сервер,
// а не выход, и действия свои.

import { DNS_RULE_ACTION_VALUES, DNS_RULE_FIELDS, type SingboxRule } from '../../entities/singbox'
import type { DocOp, DocWriter, RefKind, SchemaPath } from '../../shared/schema'
import { SelectField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeOptions } from './schema/typeSelect'

const SHOWN = ['action', 'server']
const DEFAULT_ACTION = 'route'
/** Действия с целью-сервером: route и evaluate */
const WITH_SERVER = new Set(['route', 'evaluate'])

export function SingboxDnsRuleForm({ value, path, writer, refs }: {
  value: SingboxRule
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const action = typeof value.action === 'string' ? value.action : DEFAULT_ACTION
  const server = typeof value.server === 'string' ? value.server : ''
  const at = (key: string): SchemaPath => [...path, key]

  function changeAction(v: string) {
    const ops: DocOp[] = [v === DEFAULT_ACTION ? { op: 'remove', path: at('action') } : { op: 'set', path: at('action'), value: v }]
    if (!WITH_SERVER.has(v) && value.server !== undefined) ops.push({ op: 'remove', path: at('server') })
    writer.apply(ops)
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>Правила DNS проверяются сверху вниз — срабатывает первое совпавшее.</p>
      <SelectField label="Действие" hint={DNS_RULE_ACTION_VALUES.find((e) => e.value === action)?.doc} value={action} options={typeOptions(DNS_RULE_ACTION_VALUES, action)} onChange={changeAction} />
      {WITH_SERVER.has(action) && (
        <SelectField
          label="Сервер"
          hint="Тег DNS-сервера, которому уйдёт запрос."
          value={server}
          options={typeOptions((refs['dns-server'] ?? []).map((value) => ({ value })), server, true)}
          onChange={(v) => writer.apply([v === '' ? { op: 'remove', path: at('server') } : { op: 'set', path: at('server'), value: v }])}
        />
      )}
      <SchemaForm fields={DNS_RULE_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}
```

- [ ] **Step 8: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-forms.test.tsx test/singbox-dns-rule-form.test.tsx`
Expected: PASS (блок формы выхода — при выполненной задаче 15).

- [ ] **Step 9: Мутации**

1. В `SingboxRuleForm.changeAction` убрать `push` снятия `outbound` — тест «снимает выход» красный. Вернуть.
2. В `SingboxDnsRuleForm` заменить `WITH_SERVER` на множество всех действий — тест reject красный. Вернуть.
3. В `SingboxDnsServerForm` убрать проверку `visible.has('server')` — тест legacy (поле «Адрес» появилось бы без `type`) — если не краснеет, добавьте в тест `expect(screen.queryByLabelText('Адрес')).toBeNull()` для legacy-документа. Вернуть.

- [ ] **Step 10: Typecheck по своим файлам и коммит**

```bash
git add frontend/src/features/inspector/SingboxInboundForm.tsx frontend/src/features/inspector/SingboxRuleForm.tsx frontend/src/features/inspector/SingboxRuleSetForm.tsx frontend/src/features/inspector/SingboxDnsServerForm.tsx frontend/src/features/inspector/SingboxDnsRuleForm.tsx frontend/src/features/inspector/schema/typeSelect.ts frontend/test/singbox-forms.test.tsx frontend/test/singbox-dns-rule-form.test.tsx
git commit -m "feat(frontend): sing-box inbound, rule, rule-set and dns forms on the schema renderer"
```

---

### Task 17: Инспектор: обёртка писателя, порядок у всех списков, панель «Документ»

**Files:**
- Create: `frontend/src/features/topology/SingboxDocPanel.tsx`
- Modify: `frontend/src/features/topology/SingboxInspector.tsx` (переписать разводку)
- Modify: `frontend/src/entities/graph/singbox/locate.ts` (пути панели → `doc:settings`)
- Test: `frontend/test/singbox-inspector.test.tsx` (переписать под писателя), `frontend/test/singbox-doc-panel.test.tsx` (новый), `frontend/test/singbox-locate.test.ts` (добавить)

**Interfaces:**
- Consumes: формы задач 15–16, `SINGBOX_DOC_SECTIONS`, `singboxFieldsAt`, `singboxFieldAt`, `singboxRefs`, `valueAt`, `outboundSlot`, `moveAt`, `removeAtPath`, стартеры, `draft.writer`/`applyOps`/`lockAt`.
- Produces: `SingboxDocPanel({ doc, writer, refs })`; в инспекторе — псевдоузел `doc:settings`, обёртка `inspectorWriter`; `singboxNodeIdForPath` возвращает `'doc:settings'` для путей `log`, `dns`, `ntp`, `certificate`, `experimental`, `route.rule_set`, `route.<не rules>`.

Обёртка писателя в инспекторе (`useMemo` по `draft`, `doc`, `shownId`):

```ts
const writer: DocWriter = {
  apply(ops) {
    // Пустой тег — отказ с объяснением: узел адресуется тегом, и стереть его
    // значит убрать узел с холста вместе со способом на него сослаться
    if (ops.some((op) => op.op === 'set' && op.path.at(-1) === 'tag' && op.value === '')) return refuse(EMPTY_TAG_NOTE)
    setNote(null)
    draft.applyOps(ops)
    // Выбор ведём за узлом: смена тега или типа меняет id (группа и сервер живут под разными префиксами)
    follow(ops)
  },
  lockAt: draft.lockAt,
}
```

где `follow(ops)` для вида `out`/`group`/`inbound` находит операцию `set` по пути `[...recordPath, 'tag' | 'type']` и, зная запись после правки (`applyOps(doc, ops)`), считает новый id через `nodeIdOf(record, list)`.

- [ ] **Step 1: Тесты инспектора**

Заменить `makeDraft` и тесты в `frontend/test/singbox-inspector.test.tsx`:

```tsx
import { applyOps, type DocOp, type Lock, type SchemaPath } from '../src/shared/schema'

/** Подставной черновик: правки применяются к документу, чтобы тесты видели результат */
function makeDraft(selectedNode: string | null, doc = DOC) {
  let current = doc
  const applyOpsFn = vi.fn((ops: DocOp[]) => { current = applyOps(current, ops) })
  const draft = {
    selectedNode,
    setSelectedNode: vi.fn(),
    changeDoc: vi.fn(),
    applyOps: applyOpsFn,
    lockAt: vi.fn((path: SchemaPath): Lock | null =>
      path.length === 3 && path[0] === 'outbounds' && path[2] === 'outbounds' ? { reason: 'Список заполняет панель.' } : null,
    ),
  } as unknown as SingboxDraft
  return { draft, doc: () => current }
}
```

и тесты:

```tsx
describe('инспектор sing-box', () => {
  it('выбирает форму по префиксу id узла', () => { /* как было, через makeDraft(...).draft */ })

  it('правка формы уходит операцией в черновик и ведёт выбор за новым тегом', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.type(screen.getByLabelText('Тег'), '2')
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'set', path: ['outbounds', 1, 'tag'], value: 'direct2' }])
    expect(draft.setSelectedNode).toHaveBeenCalledWith('out:direct2')
  })

  it('пустой тег отклоняется с объяснением, документ не трогается', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    expect(draft.applyOps).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/пустым он не остаётся/)
  })

  it('смена типа с direct на selector переводит выбор на group:', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await selectOption('Тип', 'selector')
    expect(draft.setSelectedNode).toHaveBeenCalledWith('group:direct')
  })

  it('порядок показывается у выхода и входа, а не только у правила', async () => {
    const { draft } = makeDraft('out:direct')
    const { rerender } = render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    expect(screen.getByText('порядок: 2 из 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить выше' }))
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'move', path: ['outbounds'], from: 1, to: 0 }])
    rerender(<SingboxInspector draft={makeDraft('inbound:tun-in').draft} doc={DOC} nodeId="inbound:tun-in" />)
    expect(screen.getByText('порядок: 1 из 1')).toBeInTheDocument()
  })

  it('перестановка правила ведёт выбор за ним', async () => {
    const { draft } = makeDraft('rule:1')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="rule:1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Переместить выше' }))
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'move', path: ['route', 'rules'], from: 1, to: 0 }])
    expect(draft.setSelectedNode).toHaveBeenCalledWith('rule:0')
  })

  it('doc:settings открывает панель «Документ»', () => {
    const { draft } = makeDraft('doc:settings')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="doc:settings" />)
    expect(screen.getByText('документ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DNS-серверы' })).toBeInTheDocument()
  })

  it('старые псевдоузлы больше не разводятся', () => {
    const { draft } = makeDraft('doc:rule-sets')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="doc:rule-sets" />)
    expect(screen.getByText('Для этого узла формы нет.')).toBeInTheDocument()
  })

  it('удаление выхода идёт операцией по индексу', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить выход' }))
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'remove', path: ['outbounds', 1] }])
    expect(draft.setSelectedNode).toHaveBeenCalledWith(null)
  })
})
```

Тесты про legacy `block` и про конечную точку из прошлой волны сохранить, переведя на `makeDraft(...).draft`. Тесты, которые проверяли `DocList` наборов и DNS-серверов, удалить — их место занимает `singbox-doc-panel.test.tsx`.

- [ ] **Step 2: Тест панели «Документ»**

`frontend/test/singbox-doc-panel.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { singboxRefs } from '../src/entities/singbox/schema'
import { SingboxDocPanel } from '../src/features/topology/SingboxDocPanel'
import { makeWriter } from './schemaHelpers'

const DOC = parseSingbox(`{
  "log": {"level": "warn"},
  "dns": {"servers": [{"type":"local","tag":"dns-local"}], "rules": [{"domain_suffix":["a"],"server":"dns-local"}], "final": "dns-local"},
  "outbounds": [{"type":"direct","tag":"direct"}],
  "route": {"rules": [], "rule_set": [{"type":"remote","tag":"ads","format":"binary","url":"u"}], "final": "direct"}
}`).doc!

describe('панель «Документ»', () => {
  it('перечисляет разделы; отсутствующий раздел заводится стартером', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    for (const title of ['Общие', 'DNS', 'DNS-серверы', 'DNS-правила', 'Маршрут', 'Наборы правил', 'Экспериментальное', 'NTP', 'Сертификаты']) {
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Экспериментальное' }))
    await userEvent.click(screen.getByRole('button', { name: 'Завести раздел' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['experimental'], value: { cache_file: { enabled: true } } })
  })

  it('раздел-объект правится формой по схеме без ключей, вынесенных в другие разделы', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Маршрут' }))
    const route = screen.getByRole('region', { name: 'Маршрут' })
    expect(within(route).queryByText('rules')).toBeNull()
    expect(within(route).queryByText('rule_set')).toBeNull()
    await selectOptionIn(route, 'final', 'direct')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'final'], value: 'direct' })
  })

  it('раздел-список: добавить, переставить, удалить, форма элемента', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    await userEvent.click(screen.getByRole('button', { name: 'DNS-серверы' }))
    const list = screen.getByRole('region', { name: 'DNS-серверы' })
    expect(within(list).getByLabelText('Тег')).toHaveValue('dns-local')
    await userEvent.click(within(list).getByRole('button', { name: '+ Сервер' }))
    expect(ops.at(-1)).toEqual({ op: 'insert', path: ['dns', 'servers'], index: 1, value: { type: 'udp', tag: 'dns', server: '1.1.1.1' } })
    await userEvent.click(within(list).getByRole('button', { name: 'Удалить сервер #1' }))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['dns', 'servers', 0] })
  })

  it('DNS-правило редактируется своей формой с сервером из документа', async () => {
    const { writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    await userEvent.click(screen.getByRole('button', { name: 'DNS-правила' }))
    const list = screen.getByRole('region', { name: 'DNS-правила' })
    expect(within(list).getByLabelText('Действие')).toBeInTheDocument()
    expect(within(list).getByLabelText('Сервер')).toBeInTheDocument()
  })
})
```

(`selectOptionIn(container, label, value)` — вариант `selectOption` из `test/helpers.ts`, принимающий контейнер: добавьте его в `helpers.ts` рядом с `selectOption`, переиспользуя его тело с `within(container)`.)

- [ ] **Step 3: Тест резолвера путей**

В `frontend/test/singbox-locate.test.ts` добавить:

```ts
it('пути панели «Документ» ведут в doc:settings, правила маршрута — на холст', () => {
  const doc = parseSingbox('{"route":{"rules":[{"outbound":"d"}]},"outbounds":[{"type":"direct","tag":"d"}]}').doc!
  expect(singboxNodeIdForPath(['dns', 'servers', 0, 'tag'], doc)).toBe('doc:settings')
  expect(singboxNodeIdForPath(['dns', 'final'], doc)).toBe('doc:settings')
  expect(singboxNodeIdForPath(['route', 'rule_set', 0], doc)).toBe('doc:settings')
  expect(singboxNodeIdForPath(['route', 'final'], doc)).toBe('doc:settings')
  expect(singboxNodeIdForPath(['experimental', 'cache_file'], doc)).toBe('doc:settings')
  expect(singboxNodeIdForPath(['log'], doc)).toBe('doc:settings')
  expect(singboxNodeIdForPath(['route', 'rules', 0], doc)).toBe('rule:0')
  expect(singboxNodeIdForPath(['outbounds'], doc)).toBeNull()
})
```

- [ ] **Step 4: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-inspector.test.tsx test/singbox-doc-panel.test.tsx test/singbox-locate.test.ts`
Expected: FAIL.

- [ ] **Step 5: Резолвер путей**

В `frontend/src/entities/graph/singbox/locate.ts` перед финальным `return null` в `singboxNodeIdForPath`:

```ts
  // Секции без узлов на холсте живут в панели «Документ»: клик по диагностике
  // открывает её, а не молчит. Правила маршрута обработаны выше — они на холсте
  const DOC_HEADS = new Set(['log', 'dns', 'ntp', 'certificate', 'experimental'])
  if (typeof head === 'string' && DOC_HEADS.has(head)) return 'doc:settings'
  if (head === 'route' && second !== 'rules') return 'doc:settings'
```

(`DOC_HEADS` вынести в константу модуля.)

- [ ] **Step 6: Панель «Документ»**

`frontend/src/features/topology/SingboxDocPanel.tsx`:

```tsx
// Панель «Документ»: разделы корня, у которых узлов на холсте нет. Раздел-объект
// рисуется формой по схеме, раздел-список — карточками с формой на элемент.
// Панель не знает, откуда пришёл писатель: ей всё равно, черновик это или
// ловушка теста.

import type { ReactNode } from 'react'
import {
  SINGBOX_DOC_SECTIONS,
  singboxFieldAt,
  singboxFieldsAt,
  startDnsRule,
  startDnsServer,
  startRuleSet,
  type SingboxDoc,
  type SingboxRule,
  type SingboxRuleSet,
} from '../../entities/singbox'
import { isRecord, valueAt, type DocSection, type DocWriter, type RefKind, type SchemaPath } from '../../shared/schema'
import { Button, CollapsibleSection } from '../../shared/ui'
import { SchemaForm } from '../inspector/schema/SchemaForm'
import { SingboxDnsRuleForm } from '../inspector/SingboxDnsRuleForm'
import { SingboxDnsServerForm } from '../inspector/SingboxDnsServerForm'
import { SingboxRuleSetForm } from '../inspector/SingboxRuleSetForm'

type Refs = Partial<Record<RefKind, string[]>>

/** Списки панели: кнопка добавления, подпись удаления, стартер и форма элемента */
const LISTS: Record<string, {
  addLabel: string
  removeLabel: (i: number) => string
  titleOf: (item: unknown, i: number) => string
  starter: (doc: SingboxDoc) => unknown
  Form: (props: { value: Record<string, unknown>; path: SchemaPath; writer: DocWriter; refs: Refs }) => ReactNode
}> = {
  'dns.servers': {
    addLabel: '+ Сервер',
    removeLabel: (i) => `Удалить сервер #${i + 1}`,
    titleOf: (item, i) => tagOr(item, `сервер #${i + 1}`),
    starter: startDnsServer,
    Form: (p) => <SingboxDnsServerForm value={p.value} path={p.path} writer={p.writer} refs={p.refs} />,
  },
  'dns.rules': {
    addLabel: '+ DNS-правило',
    removeLabel: (i) => `Удалить DNS-правило #${i + 1}`,
    titleOf: (_item, i) => `правило #${i + 1}`,
    starter: startDnsRule,
    Form: (p) => <SingboxDnsRuleForm value={p.value as SingboxRule} path={p.path} writer={p.writer} refs={p.refs} />,
  },
  'route.rule_set': {
    addLabel: '+ Набор правил',
    removeLabel: (i) => `Удалить набор #${i + 1}`,
    titleOf: (item, i) => tagOr(item, `набор #${i + 1}`),
    starter: startRuleSet,
    Form: (p) => <SingboxRuleSetForm value={p.value as SingboxRuleSet} path={p.path} writer={p.writer} refs={p.refs} />,
  },
}

function tagOr(item: unknown, fallback: string): string {
  const tag = (item as { tag?: unknown } | null)?.tag
  return typeof tag === 'string' && tag !== '' ? tag : fallback
}

function ListSection({ section, doc, writer, refs }: { section: DocSection; doc: SingboxDoc; writer: DocWriter; refs: Refs }) {
  const spec = LISTS[section.path.join('.')]!
  const raw = valueAt(doc, section.path)
  const items = Array.isArray(raw) ? raw : []
  return (
    <div className="list-editor">
      {items.length === 0 && <p className="muted">Записей пока нет — кнопка ниже заведёт первую.</p>}
      {items.map((item, i) => (
        // Ключ — позиция: она и есть адрес записи, а тега у неё может не быть
        <div key={i} className="list-editor-card">
          <div className="list-editor-body">
            <span className="eyebrow">{spec.titleOf(item, i)}</span>
            <spec.Form value={isRecord(item) ? item : {}} path={[...section.path, i]} writer={writer} refs={refs} />
          </div>
          <div className="list-editor-order">
            <button type="button" className="chip-x" aria-label={`Переместить элемент ${i + 1} выше`} disabled={i === 0} onClick={() => writer.apply([{ op: 'move', path: section.path, from: i, to: i - 1 }])}>↑</button>
            <button type="button" className="chip-x" aria-label={`Переместить элемент ${i + 1} ниже`} disabled={i === items.length - 1} onClick={() => writer.apply([{ op: 'move', path: section.path, from: i, to: i + 1 }])}>↓</button>
          </div>
          <button type="button" className="chip-x" aria-label={spec.removeLabel(i)} onClick={() => writer.apply([{ op: 'remove', path: [...section.path, i] }])}>✕</button>
        </div>
      ))}
      <Button onClick={() => writer.apply([{ op: 'insert', path: section.path, index: items.length, value: spec.starter(doc) }])}>{spec.addLabel}</Button>
    </div>
  )
}

function ObjectSection({ section, doc, writer, refs }: { section: DocSection; doc: SingboxDoc; writer: DocWriter; refs: Refs }) {
  const value = valueAt(doc, section.path)
  const field = singboxFieldAt(section.path, doc)
  if (!isRecord(value)) {
    return (
      <>
        <p className="muted">{field?.doc ?? ''} Раздела в документе нет.</p>
        <Button onClick={() => writer.apply([{ op: 'set', path: section.path, value: field?.starter?.() ?? {} }])}>Завести раздел</Button>
      </>
    )
  }
  return <SchemaForm fields={singboxFieldsAt(section.path, doc) ?? []} value={value} path={section.path} writer={writer} refs={refs} skip={section.skip} />
}

export function SingboxDocPanel({ doc, writer, refs }: { doc: SingboxDoc; writer: DocWriter; refs: Refs }) {
  return (
    <>
      {SINGBOX_DOC_SECTIONS.map((section) => (
        <CollapsibleSection key={section.path.join('.')} title={section.title} region>
          {section.kind === 'list' ? (
            <ListSection section={section} doc={doc} writer={writer} refs={refs} />
          ) : (
            <ObjectSection section={section} doc={doc} writer={writer} refs={refs} />
          )}
        </CollapsibleSection>
      ))}
    </>
  )
}
```

`CollapsibleSection` получает необязательный проп `region?: boolean`: при нём содержимое оборачивается в `<div role="region" aria-label={title}>` — тесты адресуют раздел по имени. Это правка общего компонента: существующие тесты обязаны остаться зелёными (проп необязательный, разметка без него не меняется).

- [ ] **Step 7: Инспектор**

В `frontend/src/features/topology/SingboxInspector.tsx`:
- `Kind` = `'inbound' | 'rule' | 'group' | 'out' | 'hosts' | 'builtin' | 'settings' | 'other'`; `KIND_LABEL.settings = 'документ'`; `PSEUDO_NODES = { 'doc:settings': 'settings' }`.
- Удалить `DocList`, `writeRuleSets`, `writeDnsServers`, `changeOutbound`, `changeRule`, `changeInbound`; импорты `SingboxDnsServerForm`, `SingboxRuleSetForm` убрать, добавить `SingboxDocPanel`, `singboxRefs`, `nodeIdOf`, `outboundSlot`, `applyOps`.
- `BuiltinCard`: текст из `ROUTE_RULE_ACTION_VALUES.find((e) => e.value === action)?.doc`.
- Позиция в списке:

```ts
/** Где в документе лежит запись выбранного узла — для порядка и удаления */
function recordSlot(doc: SingboxDoc, kind: Kind, name: string): { list: SchemaPath; index: number; length: number } | null {
  if (kind === 'rule') {
    const rules = rulesOf(doc)
    const index = Number(name)
    return rules[index] === undefined ? null : { list: ['route', 'rules'], index, length: rules.length }
  }
  if (kind === 'inbound') {
    const list = Array.isArray(doc.inbounds) ? doc.inbounds : []
    const index = list.findIndex((i) => i.tag === name)
    return index < 0 ? null : { list: ['inbounds'], index, length: list.length }
  }
  if (kind === 'out' || kind === 'group') {
    const slot = outboundSlot(doc, name)
    if (slot === null) return null
    const length = (slot.key === 'endpoints' ? doc.endpoints : doc.outbounds)?.length ?? 0
    return { list: [slot.key], index: slot.at, length }
  }
  return null
}
```

- Обёртка писателя:

```ts
const slot = recordSlot(doc, kind, name)
const refs = useMemo(() => singboxRefs(doc), [doc])
const writer = useMemo<DocWriter>(() => ({
  apply(ops) {
    if (ops.some((op) => op.op === 'set' && op.path[op.path.length - 1] === 'tag' && op.value === '')) {
      refuse(EMPTY_TAG_NOTE)
      return
    }
    setNote(null)
    draft.applyOps(ops)
    if (slot === null || kind === 'rule') return
    const touched = ops.some((op) => op.op === 'set' && op.path.length === slot.list.length + 2 && (op.path.at(-1) === 'tag' || op.path.at(-1) === 'type'))
    if (!touched) return
    const record = valueAt(applyOps(doc, ops), [...slot.list, slot.index]) as { type?: unknown; tag?: unknown }
    const nextId = nodeIdOf(record, slot.list[0] as 'inbounds' | 'outbounds' | 'endpoints')
    if (nextId !== null && nextId !== shownId) draft.setSelectedNode(nextId)
  },
  lockAt: draft.lockAt,
}), [draft, doc, kind, shownId, slot])
```

- Порядок в шапке — для любого `slot !== null`:

```tsx
{slot !== null && (
  <div className="row">
    <span className="muted">порядок: {slot.index + 1} из {slot.length}</span>
    <span className="spacer" />
    <Button variant="ghost" disabled={slot.index <= 0} aria-label="Переместить выше" onClick={() => move(-1)}>Выше</Button>
    <Button variant="ghost" disabled={slot.index >= slot.length - 1} aria-label="Переместить ниже" onClick={() => move(1)}>Ниже</Button>
  </div>
)}
```

с `move(dir)`: `draft.applyOps([{ op: 'move', path: slot.list, from: slot.index, to: slot.index + dir }])`; для `rule` — `draft.setSelectedNode(\`rule:${slot.index + dir}\`)`. Прежние `aria-label` «Переместить правило выше/ниже» меняются на общие — обновите e2e/тесты, которые их ищут (`grep -rn "Переместить правило" frontend/test frontend/e2e`).

- Удаление: `draft.applyOps([{ op: 'remove', path: [...slot.list, slot.index] }])`, затем `setSelectedNode(null)`; для `hosts`/`builtin` кнопки нет, как раньше.
- Рендер форм: `SingboxOutboundForm value path=[...slot.list, slot.index] writer refs isEndpoint={slot.list[0] === 'endpoints'}`; `SingboxRuleForm value path writer refs`; `SingboxInboundForm value path writer refs`; `kind === 'settings'` → `<SingboxDocPanel doc writer refs />`.

- [ ] **Step 8: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-inspector.test.tsx test/singbox-doc-panel.test.tsx test/singbox-locate.test.ts test/collapsible*.test.tsx`
Expected: PASS (последний шаблон — если тест `CollapsibleSection` существует).

- [ ] **Step 9: Мутации**

1. В обёртке писателя убрать проверку пустого тега — тест «пустой тег отклоняется» красный. Вернуть.
2. В `follow` убрать вызов `setSelectedNode` — тест «ведёт выбор за новым тегом» красный. Вернуть.
3. В `locate.ts` убрать ветку `route && second !== 'rules'` — тест резолвера красный. Вернуть.

- [ ] **Step 10: Typecheck и коммит**

```bash
git add frontend/src/features/topology/SingboxDocPanel.tsx frontend/src/features/topology/SingboxInspector.tsx frontend/src/entities/graph/singbox/locate.ts frontend/src/shared/ui/CollapsibleSection.tsx frontend/test/helpers.ts frontend/test/singbox-inspector.test.tsx frontend/test/singbox-doc-panel.test.tsx frontend/test/singbox-locate.test.ts
git commit -m "feat(frontend): sing-box inspector on the document writer with the document panel and ordering everywhere"
```

---

### Task 18: Док: меню «+ Добавить» и кнопка «Документ»

**Files:**
- Modify: `frontend/src/features/topology/SingboxTopology.tsx`
- Test: `frontend/test/singbox-topology.test.tsx`

**Interfaces:**
- Consumes: `MenuButton` (задача 4), стартеры и `nodeIdOf` (задача 14), `draft.applyOps`.
- Produces: пункты меню «Вход», «Выход», «Сервер», «Группа», «Эндпоинт»; кнопка «Документ» (`setSelectedNode('doc:settings')`); функция `addFromMenu(draft, doc, id)` экспортируется ради теста.

- [ ] **Step 1: Тест**

В `frontend/test/singbox-topology.test.tsx` добавить (посмотрите, как там монтируется `SingboxTopology` с подставным черновиком, и повторите приём):

```tsx
import { addFromMenu } from '../src/features/topology/SingboxTopology'

describe('меню «+ Добавить»', () => {
  it('каждый пункт вставляет запись в конец своего списка и выбирает её узел', () => {
    const doc = parseSingbox('{"outbounds":[{"type":"direct","tag":"direct"}]}').doc!
    const draft = { applyOps: vi.fn(), setSelectedNode: vi.fn() } as unknown as SingboxDraft
    addFromMenu(draft, doc, 'group')
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'insert', path: ['outbounds'], index: 1, value: { type: 'selector', tag: 'select', outbounds: [] } }])
    expect(draft.setSelectedNode).toHaveBeenCalledWith('group:select')
    addFromMenu(draft, doc, 'inbound')
    expect(draft.setSelectedNode).toHaveBeenLastCalledWith('inbound:mixed-in')
    addFromMenu(draft, doc, 'endpoint')
    expect(draft.applyOps).toHaveBeenLastCalledWith([expect.objectContaining({ op: 'insert', path: ['endpoints'], index: 0 })])
    expect(draft.setSelectedNode).toHaveBeenLastCalledWith('out:wg')
  })

  it('док показывает меню и кнопку «Документ», старых кнопок нет', async () => {
    // монтирование как в соседних тестах файла
    expect(screen.getByRole('button', { name: '+ Добавить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Документ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Наборы правил' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'DNS' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Вход', 'Выход', 'Сервер', 'Группа', 'Эндпоинт'])
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-topology.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

В `frontend/src/features/topology/SingboxTopology.tsx`:

```ts
import { MenuButton, type MenuItem } from '../../shared/ui'
import { nodeIdOf, startEndpoint, startGroup, startInbound, startOutbound, startServer } from '../../entities/singbox'

const ADD_ITEMS: MenuItem[] = [
  { id: 'inbound', label: 'Вход' },
  { id: 'outbound', label: 'Выход' },
  { id: 'server', label: 'Сервер' },
  { id: 'group', label: 'Группа' },
  { id: 'endpoint', label: 'Эндпоинт' },
]

/**
 * Пункт меню → запись в конец своего списка и выбор нового узла. Чистая
 * функция рядом с nextRule и по той же причине: внутри компонента её не
 * проверить. Тег уникален — стартер считает его по документу.
 */
export function addFromMenu(draft: Pick<SingboxDraft, 'applyOps' | 'setSelectedNode'>, doc: SingboxDoc, id: string): void {
  const plan = {
    inbound: { list: 'inbounds' as const, value: () => startInbound(doc) },
    outbound: { list: 'outbounds' as const, value: () => startOutbound(doc) },
    server: { list: 'outbounds' as const, value: () => startServer(doc) },
    group: { list: 'outbounds' as const, value: () => startGroup(doc) },
    endpoint: { list: 'endpoints' as const, value: () => startEndpoint(doc) },
  }[id]
  if (plan === undefined) return
  const value = plan.value()
  const current = doc[plan.list]
  const index = Array.isArray(current) ? current.length : 0
  draft.applyOps([{ op: 'insert', path: [plan.list], index, value }])
  const nodeId = nodeIdOf(value, plan.list)
  if (nodeId !== null) draft.setSelectedNode(nodeId)
}
```

и в `dockActions`:

```tsx
<>
  <Button onClick={() => draft.changeDoc(addRule(doc, nextRule()))}>+ Правило</Button>
  <MenuButton label="+ Добавить" items={ADD_ITEMS} onPick={(id) => addFromMenu(draft, doc, id)} />
  {/* Секции без узлов на холсте живут в панели «Документ»: одна кнопка вместо кнопки на секцию */}
  <Button variant="ghost" onClick={() => draft.setSelectedNode('doc:settings')}>Документ</Button>
</>
```

Подсказку пустого холста заменить на: «Редактор не нашёл в документе ни одного входа, правила или выхода. Заведите их кнопками ниже — правило, меню «+ Добавить» — или впишите записи на вкладке JSON.»

- [ ] **Step 4: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-topology.test.tsx`
Expected: PASS.

- [ ] **Step 5: Мутация**

В `addFromMenu` заменить `index` на `0` — тест меню («index: 1») красный. Вернуть.

- [ ] **Step 6: Typecheck и коммит**

```bash
git add frontend/src/features/topology/SingboxTopology.tsx frontend/test/singbox-topology.test.tsx
git commit -m "feat(frontend): sing-box dock adds records from a menu and opens the document panel"
```

---

### Task 19: Подсказки JSON по схеме

**Files:**
- Modify: `frontend/src/features/editor/singboxIntellisense/context.ts`, `complete.ts`, `hover.ts`, `index.ts`
- Test: `frontend/test/singbox-intellisense.test.ts` (переписать ожидания), `frontend/test/singbox-hover*.test.ts` если есть

**Interfaces:**
- Consumes: `singboxFieldsAt`, `FieldSchema`, `visibleFields`.
- Produces: `SingboxCursor = { path: SchemaPath; fields: FieldSchema[] | undefined; existingKeys: string[] }`; `singboxFields(cursor)`; `singboxArrayAt(state, array)` возвращает `{ field: FieldSchema | undefined; from }`; `hoverSingboxAt` возвращает `{ key, field: FieldSchema, from, to }`.

Спуск по схеме требует значений соседей (`when` по `type`/`action`), а у подсказок нет разобранной модели — только дерево CodeMirror. Поэтому `context.ts` строит **тень документа** вдоль пути: для каждого объекта пути — объект с его скалярными свойствами (`scalarProp` для всех свойств), для массива — массив с элементом на нужном индексе. Этого достаточно `fieldsAt`: условия читают только скаляры соседей.

- [ ] **Step 1: Переписать тесты**

В `frontend/test/singbox-intellisense.test.ts` заменить ожидания: вместо `cursor.section` проверяется `cursor.fields?.map((f) => f.key)`:
- «корень документа» → содержит `log`, `dns`, `outbounds`;
- «элемент outbounds различает группу и сервер по типу» → у `{"type":"selector"}` есть `outbounds`, нет `server`; у `{"type":"vless"}` есть `uuid`;
- «правило маршрута и вложенное правило логического» → оба содержат `domain_suffix`;
- «внутри правила DNS подсказок нет» ЗАМЕНИТЬ на «внутри правила DNS предлагаются server и query_type, но не hijack-dns»: ключи содержат `server`, `query_type`; значения `action` не содержат `hijack-dns`;
- «описывает и ключ-раздел, за которым стоит не значение» → hover на `remnawave` даёт `field.kind === 'object'` с непустым `doc`;
- «вложенное отображение панели описано и снаружи, и изнутри» → hover на `includeProxies` внутри `remnawave` даёт описание.
- добавить: «устаревшее значение перечисления предлагается с пометкой» — completion значений `type` у outbound содержит `block` с `detail: 'устарело'`.

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-intellisense.test.ts`
Expected: FAIL.

- [ ] **Step 3: Контекст**

В `context.ts` заменить импорты словаря на `import { singboxFieldsAt } from '../../../entities/singbox/schema'` и `import { visibleFields, type FieldSchema, type SchemaPath } from '../../../shared/schema'`; `SingboxCursor`:

```ts
export interface SingboxCursor {
  path: SchemaPath
  /** Поля объекта под курсором по схеме; undefined — схема про это место не знает */
  fields: FieldSchema[] | undefined
  existingKeys: string[]
}
```

Тень документа:

```ts
/** Скаляры объекта: только они нужны условиям when */
function objectScalars(state: EditorState, obj: SyntaxNode): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keysOf(state, obj)) {
    const v = scalarProp(state, obj, key)
    if (v !== undefined) out[key] = v
  }
  return out
}

/**
 * Тень документа вдоль пути: объекты со скалярами, массивы с одним элементом.
 * Разбирать весь документ на каждое нажатие клавиши слишком дорого, а условиям
 * схемы нужны только скаляры соседей по пути.
 */
function shadowDoc(state: EditorState, located: Located, leaf: SyntaxNode): unknown {
  const nodes = located.path.map((_, i) => located.byPath.get(located.path.slice(0, i + 1).join(KEY_SEP)))
  const build = (i: number): unknown => {
    const node = i === located.path.length ? leaf : nodes[i]
    const step = located.path[i]
    const child = i < located.path.length ? build(i + 1) : undefined
    const own = node && node.name === 'Object' ? objectScalars(state, node) : {}
    if (i === located.path.length) return own
    if (typeof step === 'number') {
      const arr: unknown[] = []
      arr[step] = child
      return arr
    }
    return { ...own, [step]: child }
  }
  return build(0)
}
```

`singboxPathAt`:

```ts
export function singboxPathAt(state: EditorState, pos: number): SingboxCursor | null {
  const obj = enclosingObject(treeAt(state, pos).resolveInner(pos, -1))
  if (!obj) return null
  const located = locate(state, obj)
  const shadow = shadowDoc(state, located, obj)
  const fields = singboxFieldsAt(located.path, shadow)
  const own = valueAtShadow(shadow, located.path)
  return { path: located.path, fields: fields === undefined ? undefined : visibleFields(fields, own), existingKeys: keysOf(state, obj) }
}
```

(`valueAtShadow` — `valueAt` из `shared/schema`.) `singboxFields(cursor)` возвращает `cursor.fields ?? []`. `singboxArrayAt`: путь владельца массива → `singboxFieldsAt`, поле по `key`; `nested` и `sectionOf` удалить.

- [ ] **Step 4: Подсказки и наведение**

`complete.ts`: `completionType(field)`: `enum` → `'enum'`, `object`/`map` → `'namespace'`, `list` → `'type'`, иначе `'property'`; `detail: field.kind`; `enumOptions`: для устаревшего значения `detail: 'устарело'`, `info: deprecatedNote(e.deprecated)`; для `list` с `item.enum` — значения из `item.enum`; булевы литералы — по `field.kind === 'boolean'`. `hover.ts`: `field = singboxFields(cursor).find(...)`; ветка `nestedNamespaceDoc` удаляется — у объекта теперь свой `doc`. `index.ts` — комментарий шапки: словарь → схема.

- [ ] **Step 5: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-intellisense.test.ts test/singbox-hover.test.ts`
Expected: PASS (второй файл — если существует).

- [ ] **Step 6: Мутации**

1. В `shadowDoc` вернуть `{}` всегда — тест «различает группу и сервер по типу» красный. Вернуть.
2. В `enumOptions` убрать `detail: 'устарело'` — новый тест красный. Вернуть.

- [ ] **Step 7: Typecheck и коммит**

```bash
git add frontend/src/features/editor/singboxIntellisense frontend/test/singbox-intellisense.test.ts
git commit -m "feat(frontend): sing-box json hints resolved through the schema tree"
```

---

### Task 20: Валидация: устаревшее по схеме и ссылки DNS

**Files:**
- Modify: `frontend/src/entities/singbox/validate.ts`
- Modify: `frontend/src/shared/schema/resolve.ts` (добавить `walkSchema`)
- Test: `frontend/test/singbox-validate.test.ts` (добавить блок), `frontend/test/schema-resolve.test.ts` (добавить тест обхода)

**Interfaces:**
- Produces в `shared/schema`: `walkSchema(root, doc, visit: (path: SchemaPath, fields: FieldSchema[], value: Record<string, unknown>) => void)` — обход всех объектов документа, описанных схемой (объекты и элементы списков объектов; неизвестные ключи не спускаются).
- В `validate.ts`: константа `REMOVED_OUTBOUND_TYPES` удаляется (её текст теперь в схеме); новые предупреждения `deprecated` и проверки ссылок `dns.final`, `dns.rules[].server`, `route.rules[].server`, `route.default_domain_resolver.server`, `outbounds[].domain_resolver.server` (тег DNS-сервера), `dns.rules[].rule_set` (тег набора).

- [ ] **Step 1: Тесты**

В `frontend/test/schema-resolve.test.ts`:

```ts
it('walkSchema обходит объекты и элементы списков по схеме, но не неизвестные ключи', () => {
  const seen: string[] = []
  walkSchema(ROOT, { ...DOC, mystery: { deep: {} } }, (path) => seen.push(path.join('.')))
  expect(seen).toEqual(['', 'log', 'outbounds.0', 'outbounds.0.tls', 'outbounds.1'])
})
```

В `frontend/test/singbox-validate.test.ts`:

```ts
describe('устаревшее и ссылки DNS', () => {
  it('удалённый тип выхода — предупреждение с заменой из схемы', () => {
    const issues = validateSingbox(parseSingbox('{"outbounds":[{"type":"block","tag":"b"}]}').doc!)
    const hit = issues.find((i) => i.parts.join('.') === 'outbounds.0.type')
    expect(hit?.level).toBe('warning')
    expect(hit?.message).toMatch(/1\.13\.0/)
    expect(hit?.message).toMatch(/reject/)
  })

  it('устаревший ключ где угодно в дереве — предупреждение по его пути', () => {
    const doc = parseSingbox('{"inbounds":[{"type":"tun","tag":"t","inet4_address":["10.0.0.1/30"]}],"dns":{"servers":[{"address":"tls://1.1.1.1","tag":"old"}]}}').doc!
    const paths = validateSingbox(doc).filter((i) => /Устарело/.test(i.message)).map((i) => i.parts.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['inbounds.0.inet4_address', 'dns.servers.0.address']))
  })

  it('ссылки на DNS-серверы и наборы проверяются', () => {
    const doc = parseSingbox(`{
      "dns": {"servers":[{"type":"local","tag":"ok"}], "rules":[{"server":"nope","rule_set":["ghost"]}], "final":"gone"},
      "route": {"rules":[{"action":"resolve","server":"nope2"}], "default_domain_resolver": {"server":"nope3"}},
      "outbounds": [{"type":"direct","tag":"d","domain_resolver":{"server":"nope4"}}]
    }`).doc!
    const paths = validateSingbox(doc).map((i) => i.parts.join('.'))
    expect(paths).toEqual(expect.arrayContaining([
      'dns.final', 'dns.rules.0.server', 'dns.rules.0.rule_set', 'route.rules.0.server',
      'route.default_domain_resolver.server', 'outbounds.0.domain_resolver.server',
    ]))
    expect(validateSingbox(parseSingbox('{"dns":{"servers":[{"type":"local","tag":"ok"}],"final":"ok"}}').doc!).filter((i) => i.parts[0] === 'dns')).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/schema-resolve.test.ts test/singbox-validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Обход схемы**

В `frontend/src/shared/schema/resolve.ts`:

```ts
/**
 * Обход документа по схеме: каждый объект, у которого есть описание, — вызов
 * `visit` с его путём, полями (с учётом условий) и значением. Неизвестные
 * ключи не спускаются: схема их не описывает, и сказать о них нечего.
 */
export function walkSchema(
  root: FieldSchema[],
  doc: unknown,
  visit: (path: SchemaPath, fields: FieldSchema[], value: Record<string, unknown>) => void,
): void {
  const step = (fields: FieldSchema[], value: unknown, path: SchemaPath): void => {
    if (!isRecord(value)) return
    const visible = visibleFields(fields, value)
    visit(path, visible, value)
    for (const field of visible) {
      const child = value[field.key]
      if (child === undefined) continue
      if (field.kind === 'object') step(field.fields ?? [], child, [...path, field.key])
      if (field.kind === 'list' && field.item?.kind === 'object' && Array.isArray(child)) {
        child.forEach((item, i) => step(field.item!.fields ?? [], item, [...path, field.key, i]))
      }
    }
  }
  step(root, doc, [])
}
```

- [ ] **Step 4: Валидация**

В `frontend/src/entities/singbox/validate.ts`: удалить `REMOVED_OUTBOUND_TYPES` и ветку про него (проверьте `grep -rn REMOVED_OUTBOUND_TYPES frontend/src` — потребителей больше нет после задачи 15); добавить импорт `deprecatedAt`, `walkSchema` из `shared/schema` и `SINGBOX_SCHEMA` из `./schema`; в конце `validateSingbox` перед `return issues`:

```ts
  // Устаревшее — по схеме, где угодно в дереве. Предупреждение, а не ошибка:
  // документ мог быть сохранён более старой панелью и разбирается нашей сквозной
  // схемой; мешает такой ключ только `sing-box check` на актуальном бинаре
  walkSchema(SINGBOX_SCHEMA, doc, (path, fields, value) => {
    for (const d of deprecatedAt(fields, value)) {
      const what = d.value === undefined ? `Ключ ${d.key}` : `Значение ${d.key}: ${d.value}`
      issues.push(issue([...path, d.key], `${what} — Устарело с ${d.deprecation.since}: ${d.deprecation.replacement}`, 'warning'))
    }
  })

  // Ссылки на DNS-серверы и наборы правил: и то и другое объявляет сам
  // документ, панель сюда ничего не подставляет — неизвестный тег всегда опечатка
  const dnsTags = new Set(tagsOfList(doc.dns?.servers))
  const ruleSetTags = new Set(ruleSetTagsOf(doc))
  const checkDns = (path: PathParts, tag: unknown) => {
    if (typeof tag === 'string' && tag !== '' && !dnsTags.has(tag)) {
      issues.push(issue(path, `DNS-сервер «${tag}» не описан в dns.servers`, 'error'))
    }
  }
  checkDns(['dns', 'final'], doc.dns?.final)
  ;(doc.dns?.rules ?? []).forEach((rule, i) => {
    checkDns(['dns', 'rules', i, 'server'], rule.server)
    const sets = Array.isArray(rule.rule_set) ? rule.rule_set : typeof rule.rule_set === 'string' ? [rule.rule_set] : []
    for (const set of sets) {
      if (typeof set === 'string' && !ruleSetTags.has(set)) {
        issues.push(issue(['dns', 'rules', i, 'rule_set'], `Набор правил «${set}» не описан в route.rule_set`, 'error'))
      }
    }
  })
  rulesOf(doc).forEach((rule, i) => {
    if (rule.action === 'resolve') checkDns(['route', 'rules', i, 'server'], rule.server)
  })
  const resolver = doc.route?.default_domain_resolver
  if (isRecord(resolver)) checkDns(['route', 'default_domain_resolver', 'server'], resolver.server)
  else if (typeof resolver === 'string') checkDns(['route', 'default_domain_resolver'], resolver)
  outbounds.forEach((o, i) => {
    const r = o.domain_resolver
    if (isRecord(r)) checkDns(['outbounds', i, 'domain_resolver', 'server'], r.server)
    else if (typeof r === 'string') checkDns(['outbounds', i, 'domain_resolver'], r)
  })
```

`tagsOfList` — локальный помощник как в `starters.ts`; `isRecord` импортируется из `shared/schema`.

- [ ] **Step 5: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/schema-resolve.test.ts test/singbox-validate.test.ts test/singbox-inspector.test.tsx test/singbox-forms.test.tsx`
Expected: PASS; тесты инспектора/форм про `block` по-прежнему находят текст «1.13» — он теперь из схемы.

- [ ] **Step 6: Мутации**

1. В `walkSchema` убрать спуск в списки — тест обхода красный. Вернуть.
2. Убрать `checkDns(['dns', 'final'], …)` — тест ссылок красный. Вернуть.

- [ ] **Step 7: Typecheck и коммит**

```bash
git add frontend/src/shared/schema/resolve.ts frontend/src/entities/singbox/validate.ts frontend/test/schema-resolve.test.ts frontend/test/singbox-validate.test.ts
git commit -m "feat(frontend): sing-box validation warns on deprecated keys from the schema and checks dns references"
```

---

### Task 21: Чистка: старый словарь, docPath и SingboxExtraFields

**Files:**
- Delete: `frontend/src/entities/singbox/docSchema.ts`, `frontend/src/entities/singbox/docPath.ts`, `frontend/src/features/inspector/SingboxExtraFields.tsx`, `frontend/test/singbox-doc-schema.test.ts`, `frontend/test/singbox-doc-path.test.ts`
- Modify: `frontend/src/entities/singbox/index.ts` (убрать `./docSchema`, `./docPath`), `frontend/src/entities/graph/singbox/mutations.ts` (убрать `outboundSlotOf`, если не используется), всё, что найдёт grep.

- [ ] **Step 1: Найти потребителей**

Run: `cd frontend && grep -rn "docSchema\|docPath\|SingboxExtraFields\|SINGBOX_SECTIONS\|fieldFor(\|nestedFields\|sectionAtPath\|descendSingbox\|outboundSlotOf\|nestedNamespaceDoc" src test e2e`
Expected: только сами удаляемые файлы и их тесты. Всё прочее — правится в этой задаче на импорты из `entities/singbox/schema`.

- [ ] **Step 2: Удалить и поправить**

`git rm` пяти файлов; в `entities/singbox/index.ts` удалить две строки реэкспорта; тесты полноты старого словаря, которые проверяли что-то, чего нет в `singbox-schema.test.ts` («у каждого поля непустое описание», «значения enum не пустые», «ключи настоящих шаблонов описаны на верхнем уровне»), перенести туда как отдельные `it` на `SINGBOX_SCHEMA`.

- [ ] **Step 3: Полный прогон**

Run: `npm run typecheck -w frontend && cd frontend && npx vitest run`
Expected: 0 ошибок, всё зелёное.

- [ ] **Step 4: Коммит**

```bash
git add -A frontend/src/entities/singbox frontend/src/features/inspector frontend/src/entities/graph/singbox frontend/test
git commit -m "refactor(frontend): drop the flat sing-box dictionary in favour of the schema tree"
```

---

### Task 22: Рецепты sing-box

**Files:**
- Create: `frontend/src/entities/singbox/recipes/apply.ts`, `catalog.ts`, `split.ts`, `ads.ts`, `dns.ts`, `local.ts`, `private.ts`, `warp.ts`, `index.ts`
- Create: `frontend/src/features/recipes/singboxRecipes.tsx`
- Modify: `frontend/src/features/editor/useSingboxDraft.ts` (`recipesOpen`, `setRecipesOpen`), `frontend/src/features/templates/SingboxEditorPage.tsx` (кнопка «Рецепты» и `RecipesDialog`)
- Test: `frontend/test/singbox-recipes.test.ts`, `frontend/test/singbox-page.test.tsx` (добавить)

**Interfaces:**
- Consumes: `Recipe`, `RecipePlan` (задача 6), `RecipesDialog`/`RecipeEntry`, `applyOps`, стартеры, `WARP_PEER` из `entities/xray/recipes/warp`, `useWarpAccount`.
- Produces:

```ts
// entities/singbox/recipes/apply.ts
export function sameEntry(a: unknown, b: unknown): boolean                 // глубокое равенство по JSON с сортировкой ключей
export function ensureAt(doc, listPath, entry, matchBy: 'tag' | 'deep', placement: 'start' | 'end'): { doc; status: 'add' | 'exists'; index: number }
export function ensureCacheFile(doc, extra?: Record<string, unknown>): { doc; status }
// catalog.ts
export interface RuleSetSource { id: string; tag: string; title: string; url: string; kind: 'domain' | 'ip' }
export const RULE_SET_CATALOG: RuleSetSource[]
// каждый рецепт: <NAME>_DEFAULTS, validate<Name>(params): string | null, plan<Name>(doc, params): RecipePlan<SingboxDoc>
// index.ts
export const SINGBOX_RECIPES: Recipe<SingboxDoc, any>[]
```

Каталог источников — `MetaCubeX/meta-rules-dat`, ветка `sing`, схема ссылок `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/<имя>.srs` и `…/geo/geoip/<имя>.srs`. Записи: `category-ads-all`, `private` (geosite и geoip), `ru`/`geoip-ru`, `youtube`, `telegram` (geosite и geoip), `discord`, `whatsapp`, `tiktok`, `netflix`, `openai`, `google`. Ссылки других источников (`legiz-ru/sb-rule-sets`) добавляются только после проверки `curl -sI <url>` → 200; непроверенных ссылок в каталоге не бывает.

Рецепты и параметры:

| id | title | params | plan |
|---|---|---|---|
| `split` | Разделить трафик по наборам правил | `{ sets: string[]; outbound: string }` | для каждого набора — `ensureAt(route.rule_set, {type:'remote', tag, format:'binary', url}, 'tag')`; одно правило `{ rule_set: tags, outbound }` в конец `route.rules` (`deep`); `ensureCacheFile` |
| `ads` | Блокировка рекламы | `{ alsoDns: boolean }` | набор `category-ads-all`; правило `{ rule_set: ['geosite-category-ads-all'], action: 'reject' }` в НАЧАЛО; при `alsoDns` — DNS-правило `{ rule_set: [...], action: 'predefined', rcode: 'NXDOMAIN' }` в начало `dns.rules`; `ensureCacheFile` |
| `dns` | DNS с fake-ip | `{ remote: string; detour: string }` | серверы `dns-remote` (tls, server: remote, detour), `dns-local` (local), `dns-fakeip` (fakeip, 198.18.0.0/15, fc00::/18); DNS-правила `{ clash_mode: 'Direct', server: 'dns-local' }`, `{ clash_mode: 'Global', server: 'dns-remote' }`, `{ query_type: ['A', 'AAAA'], server: 'dns-fakeip' }` в конец; `dns.final = 'dns-remote'` если пуст; правила маршрута `{ action: 'sniff' }` и `{ protocol: 'dns', action: 'hijack-dns' }` в начало (в этом порядке); `route.default_domain_resolver = { server: 'dns-local' }` если нет; `ensureCacheFile(doc, { store_fakeip: true })` |
| `local` | Локальный вход | `{ kind: 'mixed' \| 'socks' \| 'http'; port: number; setSystemProxy: boolean }` | `ensureAt(inbounds, { type: kind, tag: kind + '-in', listen: '127.0.0.1', listen_port: port, set_system_proxy? }, 'tag', 'end')` |
| `private` | Локальные сети напрямую | `{ outbound: string }` | правило `{ ip_is_private: true, outbound }` в начало после sniff/hijack (ставится сразу за ведущей серией нетерминальных правил: пройти по списку, пока `action` ∈ NON_TERMINAL_ACTIONS ∪ hijack-dns) |
| `warp` | WARP-эндпоинт | `{ tag: string; privateKey: string; addresses: string[]; reserved: number[]; mtu: number }` | `ensureAt(endpoints, { type: 'wireguard', tag, address: addresses, private_key: privateKey, mtu, peers: [{ address: 'engage.cloudflareclient.com', port: 2408, public_key: WARP_PEER.publicKey, allowed_ips: ['0.0.0.0/0', '::/0'], reserved }] }, 'tag', 'end')` |

`validate*`: `split` — выбран хотя бы один набор и выход; `dns` — непустой `remote`; `local` — порт 1..65535; `private` — непустой выход; `warp` — непустые тег и ключ; `ads` — всегда null.

- [ ] **Step 1: Тесты**

`frontend/test/singbox-recipes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { RULE_SET_CATALOG } from '../src/entities/singbox/recipes/catalog'
import { SINGBOX_RECIPES } from '../src/entities/singbox/recipes'
import { planAds, planDns, planLocal, planPrivate, planSplit, planWarp } from '../src/entities/singbox/recipes'
import { validateSingbox } from '../src/entities/singbox/validate'

const BASE = parseSingbox('{"outbounds":[{"type":"selector","tag":"sel","outbounds":null},{"type":"direct","tag":"direct"}],"route":{"rules":[{"action":"sniff"}],"final":"sel"}}').doc!

describe('каталог источников', () => {
  it('ссылки только meta-rules-dat ветки sing, теги уникальны', () => {
    for (const s of RULE_SET_CATALOG) expect(s.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/MetaCubeX\/meta-rules-dat\/sing\/geo\/(geosite|geoip)\/[a-z0-9-]+\.srs$/)
    expect(new Set(RULE_SET_CATALOG.map((s) => s.tag)).size).toBe(RULE_SET_CATALOG.length)
  })
})

describe('рецепты sing-box', () => {
  it('split заводит наборы, правило в конец и cache_file; повторно — ничего', () => {
    const p = { sets: ['geosite-youtube', 'geoip-telegram'], outbound: 'sel' }
    const first = planSplit(BASE, p)
    expect(first.model.route!.rule_set!.map((s) => s.tag)).toEqual(['geosite-youtube', 'geoip-telegram'])
    expect(first.model.route!.rules!.at(-1)).toEqual({ rule_set: ['geosite-youtube', 'geoip-telegram'], outbound: 'sel' })
    expect(first.model.experimental).toEqual({ cache_file: { enabled: true } })
    expect(first.changes.filter((c) => c.status === 'add').length).toBeGreaterThan(0)
    const second = planSplit(first.model, p)
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model).toEqual(first.model)
    expect(validateSingbox(first.model).filter((i) => i.level === 'error')).toEqual([])
  })

  it('ads ставит reject в начало и DNS-правило по запросу', () => {
    const plan = planAds(BASE, { alsoDns: true })
    expect(plan.model.route!.rules![0]).toEqual({ rule_set: ['geosite-category-ads-all'], action: 'reject' })
    expect(plan.model.dns!.rules![0]).toEqual({ rule_set: ['geosite-category-ads-all'], action: 'predefined', rcode: 'NXDOMAIN' })
  })

  it('dns заводит три сервера, правила, final, sniff/hijack первыми и резолвер', () => {
    const plan = planDns(BASE, { remote: '1.1.1.1', detour: 'sel' })
    const m = plan.model
    expect(m.dns!.servers!.map((s) => s.tag)).toEqual(['dns-remote', 'dns-local', 'dns-fakeip'])
    expect(m.dns!.final).toBe('dns-remote')
    expect(m.route!.rules!.slice(0, 2)).toEqual([{ action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }])
    expect(m.route!.default_domain_resolver).toEqual({ server: 'dns-local' })
    expect(m.experimental!.cache_file).toEqual({ enabled: true, store_fakeip: true })
    expect(planDns(m, { remote: '1.1.1.1', detour: 'sel' }).model).toEqual(m)
  })

  it('local, private и warp идемпотентны', () => {
    const a = planLocal(BASE, { kind: 'mixed', port: 2080, setSystemProxy: true })
    expect(a.model.inbounds).toEqual([{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080, set_system_proxy: true }])
    expect(planLocal(a.model, { kind: 'mixed', port: 2080, setSystemProxy: true }).changes[0]?.status).toBe('exists')
    const b = planPrivate(BASE, { outbound: 'direct' })
    expect(b.model.route!.rules![1]).toEqual({ ip_is_private: true, outbound: 'direct' })
    const c = planWarp(BASE, { tag: 'warp', privateKey: 'k', addresses: ['172.16.0.2/32'], reserved: [], mtu: 1280 })
    expect(c.model.endpoints![0]).toMatchObject({ type: 'wireguard', tag: 'warp', private_key: 'k', mtu: 1280 })
    expect(c.model.endpoints![0]!.peers).toHaveLength(1)
  })

  it('реестр содержит шесть рецептов с уникальными id', () => {
    expect(SINGBOX_RECIPES.map((r) => r.id)).toEqual(['split', 'ads', 'dns', 'local', 'private', 'warp'])
  })
})
```

В `frontend/test/singbox-page.test.tsx` добавить: кнопка «Рецепты» есть в шапке; клик открывает диалог с заголовком «Рецепты»; выбор «Локальный вход» и «Применить» меняет черновик (`inbounds` появляются в тексте JSON-вкладки или через `draft`).

- [ ] **Step 2: Запустить и увидеть красный**

Run: `cd frontend && npx vitest run test/singbox-recipes.test.ts test/singbox-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Примитивы и каталог**

`frontend/src/entities/singbox/recipes/apply.ts`:

```ts
// Примитивы идемпотентности: «завести, если нет». Сравнение по тегу — для
// записей с адресом; глубокое — для правил, у которых адреса нет.

import { applyOps, valueAt, type SchemaPath } from '../../../shared/schema'
import type { SingboxDoc } from '../types'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameEntry(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

export interface EnsureResult {
  doc: SingboxDoc
  status: 'add' | 'exists'
  index: number
}

export function ensureAt(
  doc: SingboxDoc,
  listPath: SchemaPath,
  entry: Record<string, unknown>,
  matchBy: 'tag' | 'deep',
  placement: 'start' | 'end',
): EnsureResult {
  const raw = valueAt(doc, listPath)
  const list = Array.isArray(raw) ? raw : []
  const found = list.findIndex((item) =>
    matchBy === 'tag' ? (item as { tag?: unknown } | null)?.tag === entry.tag : sameEntry(item, entry),
  )
  if (found >= 0) return { doc, status: 'exists', index: found }
  const index = placement === 'start' ? 0 : list.length
  return { doc: applyOps(doc, [{ op: 'insert', path: listPath, index, value: entry }]), status: 'add', index }
}

/** Позиция сразу за ведущей серией нетерминальных правил (sniff, resolve, route-options, hijack-dns) */
export function afterLeadingService(doc: SingboxDoc): number {
  const rules = doc.route?.rules ?? []
  const service = new Set(['sniff', 'resolve', 'route-options', 'hijack-dns'])
  let i = 0
  while (i < rules.length && typeof rules[i]!.action === 'string' && service.has(rules[i]!.action as string)) i += 1
  return i
}

export function ensureCacheFile(doc: SingboxDoc, extra: Record<string, unknown> = {}): { doc: SingboxDoc; status: 'add' | 'exists' } {
  const current = (doc.experimental?.cache_file ?? {}) as Record<string, unknown>
  const next = { ...current, enabled: true, ...extra }
  if (sameEntry(current, next)) return { doc, status: 'exists' }
  return { doc: applyOps(doc, [{ op: 'set', path: ['experimental', 'cache_file'], value: next }]), status: 'add' }
}
```

`frontend/src/entities/singbox/recipes/catalog.ts`:

```ts
// Каталог источников наборов правил. Ссылки статические и только проверенные:
// бэкенд их не скачивает, они уходят в документ пользователя, и ссылка на
// несуществующий файл сломала бы клиенту загрузку конфига.

export interface RuleSetSource {
  id: string
  tag: string
  title: string
  url: string
  kind: 'domain' | 'ip'
}

const GEOSITE = (name: string) => `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/${name}.srs`
const GEOIP = (name: string) => `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geoip/${name}.srs`

export const RULE_SET_CATALOG: RuleSetSource[] = [
  { id: 'geosite-category-ads-all', tag: 'geosite-category-ads-all', title: 'Реклама (category-ads-all)', url: GEOSITE('category-ads-all'), kind: 'domain' },
  { id: 'geosite-private', tag: 'geosite-private', title: 'Локальные домены', url: GEOSITE('private'), kind: 'domain' },
  { id: 'geoip-private', tag: 'geoip-private', title: 'Локальные подсети', url: GEOIP('private'), kind: 'ip' },
  { id: 'geosite-ru', tag: 'geosite-ru', title: 'Домены РФ (category-ru)', url: GEOSITE('category-ru'), kind: 'domain' },
  { id: 'geoip-ru', tag: 'geoip-ru', title: 'Подсети РФ', url: GEOIP('ru'), kind: 'ip' },
  { id: 'geosite-youtube', tag: 'geosite-youtube', title: 'YouTube', url: GEOSITE('youtube'), kind: 'domain' },
  { id: 'geosite-telegram', tag: 'geosite-telegram', title: 'Telegram (домены)', url: GEOSITE('telegram'), kind: 'domain' },
  { id: 'geoip-telegram', tag: 'geoip-telegram', title: 'Telegram (подсети)', url: GEOIP('telegram'), kind: 'ip' },
  { id: 'geosite-discord', tag: 'geosite-discord', title: 'Discord', url: GEOSITE('discord'), kind: 'domain' },
  { id: 'geosite-whatsapp', tag: 'geosite-whatsapp', title: 'WhatsApp', url: GEOSITE('whatsapp'), kind: 'domain' },
  { id: 'geosite-tiktok', tag: 'geosite-tiktok', title: 'TikTok', url: GEOSITE('tiktok'), kind: 'domain' },
  { id: 'geosite-netflix', tag: 'geosite-netflix', title: 'Netflix', url: GEOSITE('netflix'), kind: 'domain' },
  { id: 'geosite-openai', tag: 'geosite-openai', title: 'OpenAI', url: GEOSITE('openai'), kind: 'domain' },
  { id: 'geosite-google', tag: 'geosite-google', title: 'Google', url: GEOSITE('google'), kind: 'domain' },
]

export function sourceById(id: string): RuleSetSource | undefined {
  return RULE_SET_CATALOG.find((s) => s.id === id)
}
```

Перед коммитом проверьте каждую ссылку: `curl -sI <url> | head -1` → `HTTP/2 200`. Имя файла, отвечающее 404 (например, если `category-ru` в ветке `sing` называется иначе), замените на существующее из листинга `https://github.com/MetaCubeX/meta-rules-dat/tree/sing/geo/geosite` и запишите проверку в отчёт.

- [ ] **Step 4: Рецепты**

Пишутся по одному образцу; ниже `split.ts` целиком, остальные — по таблице интерфейсов с той же структурой (`*_DEFAULTS`, `validate*`, `plan*`, `changes` с текстом по-русски, `notes`).

`frontend/src/entities/singbox/recipes/split.ts`:

```ts
import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { ensureAt, ensureCacheFile } from './apply'
import { sourceById } from './catalog'

export interface SplitParams {
  /** id источников из каталога */
  sets: string[]
  /** Тег выхода, куда уйдёт совпавшее */
  outbound: string
}

export const SPLIT_DEFAULTS: SplitParams = { sets: ['geosite-youtube'], outbound: '' }

export function validateSplit(p: SplitParams): string | null {
  if (p.sets.length === 0) return 'Выберите хотя бы один набор правил'
  if (p.outbound.trim() === '') return 'Укажите выход'
  return null
}

export function planSplit(doc: SingboxDoc, p: SplitParams): RecipePlan<SingboxDoc> {
  const changes: RecipeChange[] = []
  let next = doc
  const tags: string[] = []
  for (const id of p.sets) {
    const source = sourceById(id)
    if (source === undefined) continue
    tags.push(source.tag)
    const res = ensureAt(next, ['route', 'rule_set'], { type: 'remote', tag: source.tag, format: 'binary', url: source.url }, 'tag', 'end')
    next = res.doc
    changes.push({ status: res.status, text: res.status === 'add' ? `набор ${source.tag}` : `набор ${source.tag} — уже есть` })
  }
  const rule = ensureAt(next, ['route', 'rules'], { rule_set: tags, outbound: p.outbound }, 'deep', 'end')
  next = rule.doc
  changes.push({ status: rule.status, text: rule.status === 'add' ? `правило: ${tags.join(', ')} → ${p.outbound}` : 'правило уже есть' })
  const cache = ensureCacheFile(next)
  next = cache.doc
  changes.push({ status: cache.status, text: cache.status === 'add' ? 'experimental.cache_file включён' : 'cache_file уже включён' })
  return {
    model: next,
    changes,
    notes: [{ text: 'Наборы скачивает клиент при первом запуске; без включённого cache_file они будут качаться при каждом старте.' }],
  }
}
```

`index.ts` собирает `SINGBOX_RECIPES: Recipe<SingboxDoc, any>[]` из шести модулей в порядке `split, ads, dns, local, private, warp` (заголовки: «Разделить трафик по наборам правил», «Блокировка рекламы», «DNS с fake-ip», «Локальный вход», «Локальные сети напрямую», «WARP-эндпоинт»; summary — по одной фразе из таблицы) и реэкспортирует всё. `warp.ts` импортирует `WARP_PEER` из `'../../xray/recipes/warp'` — общий факт о Cloudflare, второй копии ему не нужно.

- [ ] **Step 5: Формы и страница**

`frontend/src/features/recipes/singboxRecipes.tsx`: `SINGBOX_RECIPE_ENTRIES: RecipeEntry<SingboxDoc, any>[]` — по записи на рецепт; формы из `MultiSelectField` (каталог: `options = RULE_SET_CATALOG.map((s) => ({ value: s.id, label: s.title }))`), `SelectField` по тегам выходов из модели (`singboxRefs(model).outbound`), `NumberField`, `TriStateField`/`CheckboxField`, `TextField`; форма WARP повторяет `WarpForm` Xray (кнопка «Получить ключи» через `useWarpAccount`, заполняющая `privateKey`/`addresses`/`reserved`).

В `useSingboxDraft.ts` добавить `recipesOpen`/`setRecipesOpen` (как `checkOpen`). В `SingboxEditorPage.tsx` в слот `actions` шапки добавить `<Button variant="ghost" onClick={() => draft.setRecipesOpen(true)}>Рецепты</Button>` и смонтировать:

```tsx
{draft.doc !== undefined && (
  <RecipesDialog
    open={draft.recipesOpen}
    model={draft.doc}
    entries={SINGBOX_RECIPE_ENTRIES}
    print={(d) => JSON.stringify(d, null, 2)}
    onApply={(next) => { draft.changeDoc(next); draft.setSelectedNode(null) }}
    onClose={() => draft.setRecipesOpen(false)}
  />
)}
```

- [ ] **Step 6: Запустить и увидеть зелёный**

Run: `cd frontend && npx vitest run test/singbox-recipes.test.ts test/singbox-page.test.tsx test/recipes-generic.test.tsx`
Expected: PASS.

- [ ] **Step 7: Мутации**

1. В `ensureAt` заменить проверку `found >= 0` на `false` — тесты идемпотентности красные. Вернуть.
2. В `planDns` поменять порядок `sniff`/`hijack-dns` — тест dns красный. Вернуть.

- [ ] **Step 8: Typecheck и коммит**

```bash
git add frontend/src/entities/singbox/recipes frontend/src/features/recipes/singboxRecipes.tsx frontend/src/features/editor/useSingboxDraft.ts frontend/src/features/templates/SingboxEditorPage.tsx frontend/test/singbox-recipes.test.ts frontend/test/singbox-page.test.tsx
git commit -m "feat(frontend): six sing-box recipes on the generic recipe engine"
```

---

### Task 23: E2E: шаблон с нуля кнопками

**Files:**
- Modify: `frontend/e2e/mocks.ts` (`mockSingbox` принимает `template?: unknown`)
- Modify: `frontend/e2e/singbox.spec.ts` (обновить подписи кнопок порядка; добавить три сценария)

- [ ] **Step 1: Мок**

В `mockSingbox(page, opts)` добавить `opts.template?: unknown`: маршрут `**/api/templates/${SINGBOX_UUID}` отдаёт `{ template: { ...SINGBOX_TEMPLATE, templateJson: opts.template ?? SINGBOX_JSON }, hash: SINGBOX_HASH }`.

- [ ] **Step 2: Сценарии**

В `frontend/e2e/singbox.spec.ts` (для сценария «с нуля» — свой `test.describe` с собственным `beforeEach`, где `mockSingbox(page, { template: {} })` и ожидание кнопки «+ Добавить» вместо узла группы):

```ts
test.describe('с нуля', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await mockSingbox(page, { template: {} })
    await page.goto(`/templates/${SINGBOX_UUID}`)
    await expect(page.getByRole('button', { name: '+ Добавить' })).toBeVisible()
  })

  test('шаблон собирается кнопками и формами, вкладка JSON не открывается', async ({ page }) => {
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

    await add('Вход')
    await expect(inspector.getByLabel('Тег')).toHaveValue('mixed-in')
    await add('Группа')
    await expect(page.locator(node('group:select'))).toBeVisible()
    await add('Выход')
    await expect(page.locator(node('out:direct'))).toBeVisible()

    await page.getByRole('button', { name: '+ Правило' }).click()
    await expect(inspector.getByLabel('Действие')).toBeVisible()
    await inspector.getByLabel('Суффикс домена').fill('example.com')

    await page.getByRole('button', { name: 'Документ' }).click()
    await inspector.getByRole('button', { name: 'DNS-серверы' }).click()
    await inspector.getByRole('button', { name: '+ Сервер' }).click()
    await inspector.getByRole('button', { name: 'DNS-правила' }).click()
    await inspector.getByRole('button', { name: '+ DNS-правило' }).click()
    await inspector.getByRole('button', { name: 'Наборы правил' }).click()
    await inspector.getByRole('button', { name: '+ Набор правил' }).click()
    await inspector.getByRole('button', { name: 'Маршрут' }).click()
    await inspector.getByRole('button', { name: 'Завести раздел' }).click()
    await pickOption(page, inspector.getByRole('region', { name: 'Маршрут' }).getByLabel('final'), 'select')

    await page.getByRole('button', { name: 'Сохранить в панель' }).click()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect.poll(() => patches.length).toBe(1)
    const body = JSON.parse(patches[0]!).templateJson
    expect(body.inbounds[0].tag).toBe('mixed-in')
    expect(body.outbounds.map((o: { tag: string }) => o.tag)).toEqual(['select', 'direct'])
    expect(body.route.rules[0].domain_suffix).toEqual(['example.com'])
    expect(body.route.final).toBe('select')
    expect(body.dns.servers).toHaveLength(1)
    expect(body.dns.rules).toHaveLength(1)
    expect(body.route.rule_set).toHaveLength(1)
    // Вкладка JSON так и не открывалась
    await expect(page.locator('.cm-editor')).toHaveCount(0)
  })
})

test('порядок выходов меняет маршрут по умолчанию на карточке', async ({ page }) => {
  await page.locator(node('out:direct')).click()
  await expect(page.locator(node('group:Выбор'))).toContainText('по умолчанию')
  await page.locator('aside.wb-inspector').getByRole('button', { name: 'Переместить выше' }).click()
  await expect(page.locator(node('out:direct'))).toContainText('по умолчанию')
})

test('рецепт DNS с fake-ip заводит серверы и правила', async ({ page }) => {
  await page.getByRole('button', { name: 'Рецепты' }).click()
  await page.getByRole('button', { name: /DNS с fake-ip/ }).click()
  await page.getByRole('button', { name: 'Применить' }).click()
  await page.getByRole('button', { name: 'Документ' }).click()
  await page.locator('aside.wb-inspector').getByRole('button', { name: 'DNS-серверы' }).click()
  await expect(page.locator('aside.wb-inspector').getByText('dns-fakeip')).toBeVisible()
})
```

Существующие сценарии: `Переместить правило выше` → `Переместить выше`; сценарий трассировки и прочие не меняются, если не ссылаются на удалённые кнопки дока (`Наборы правил`, `DNS`) — такие ссылки заменить на путь через «Документ». Проверить `SINGBOX_JSON` мока: у группы «Выбор» `outbounds: ['direct']` без `remnawave` — панель её заполняет, бейдж «по умолчанию» на ней (первый выход при пустом `final`).

- [ ] **Step 3: Запустить**

Run: `npm run e2e -w frontend`
Expected: все сценарии зелёные. Playwright для новой версии — `cd frontend && npx playwright install chromium`, если браузер не найден.

- [ ] **Step 4: Коммит**

```bash
git add frontend/e2e/mocks.ts frontend/e2e/singbox.spec.ts
git commit -m "test(frontend): sing-box template built from scratch without the JSON tab"
```

---

### Task 24: Документация

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-09-09-schema-forms-singbox-full-ui-design.md` (статус)

- [ ] **Step 1: CLAUDE.md**

В разделе Frontend:
- Пункт про `entities/singbox`: словарь → «схема-дерево `entities/singbox/schema/*` на общем формате `shared/schema` (`FieldSchema`: условные ключи по соседу, вложенные объекты, списки, `deprecated` с заменой, `ref` на теги); `docPath.ts` и `SingboxExtraFields` удалены — спуск по пути делает `fieldsAt`, единый для форм, подсказок и валидации».
- Новый пункт **«Общий слой схемы и форм»**: `shared/schema` (типы, `fieldsAt`/`visibleFields`/`unknownKeys`/`deprecatedAt`/`walkSchema`, операции `DocOp` и `applyOps`, `DocWriter` с `lockAt`), `features/inspector/schema/SchemaForm.tsx` (правила: заполненные сверху, «Ещё поля (N)», неизвестный ключ всегда виден на чтение, значение не той формы — на чтение, тристейт для булевых, перечисление пропускает чужое значение и объясняет устаревшее, замок писателя с причиной), почему форма эмитит операции, а не значение (Mihomo впереди), `MenuButton`, `TriStateField`, `ListEditor` с `reorder`. Контрольная группа: формы и тесты Xray/Mihomo не тронуты.
- Пункт про псевдоузлы: `doc:rule-sets`/`doc:dns-servers` → один `doc:settings` с панелью «Документ» (`SingboxDocPanel`, разделы `SINGBOX_DOC_SECTIONS`, «Завести раздел» пишет стартер), почему псевдоузел, а не диалог.
- Пункт про инспектор sing-box: обёртка писателя (пустой тег — отказ, выбор ведём за тегом и типом), порядок у любого узла в списке, `outboundSlot`.
- Пункт про док: меню «+ Добавить» со стартерами (`entities/singbox/starters.ts`, уникальность тегов в объединении `outbounds`+`endpoints`), почему меню.
- Пункт про валидацию: устаревшее — `walkSchema` + `deprecatedAt`, ссылки DNS; `REMOVED_OUTBOUND_TYPES` больше нет.
- Пункт про подсказки: тень документа вдоль пути в `singboxIntellisense/context.ts`, почему не полный разбор.
- Пункт про рецепты: обобщённый движок `shared/recipes` + `RecipesDialog` по модели, Xray — первый экземпляр (`xrayRecipes.tsx`), sing-box — `entities/singbox/recipes` (шесть рецептов, каталог источников только с проверенными ссылками, идемпотентность через `ensureAt`).
- В разделе «Документация»: спека части 1 и этот план — выполнены; части 2 и 3 — впереди.

- [ ] **Step 2: README**

Бейдж числа тестов: посчитать суммой `npm test -w backend` и `npm test -w frontend` после задачи 23 и вписать. Абзац про редактор шаблонов: sing-box собирается целиком через интерфейс; рецепты доступны и в шаблоне sing-box.

- [ ] **Step 3: Спека**

Строку «**Статус:**» → «выполнен планом `2026-09-09-schema-forms-singbox-plan.md`».

- [ ] **Step 4: Коммит**

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-09-09-schema-forms-singbox-full-ui-design.md
git commit -m "docs: record the schema-driven forms and the full sing-box editor"
```

---

## Самопроверка плана

**Покрытие спеки.** Схема с условиями, устаревшим, `ref`, стартерами — задачи 1, 7–13 (плюс `map` и `notIn` как аддитивные отклонения, объяснены в задаче 1). `schemaAt` вместо `docPath` — задачи 13 (`singboxFieldsAt`), 19 (подсказки), 21 (удаление). Операции писателя и `lockAt` — задачи 2, 14. `SchemaForm` со всеми правилами спеки — задача 5. Панель «Документ» псевдоузлом со стартерами разделов — задачи 13 (`SINGBOX_DOC_SECTIONS`), 17. Меню «+ Добавить», отдельная «+ Правило», кнопка «Документ» — задача 18. Порядок у выходов, эндпоинтов, входов, DNS-серверов, наборов, DNS-правил — задачи 17 (инспектор), 17 (панель), 5 (списки объектов). Формы с главными полями по таблице спеки — задачи 15, 16 (форма DNS-правила — новая). Валидация устаревшего и ссылок — задача 20. Граф без DNS — не меняется. Рецепты: обобщённый движок — задача 6; шесть рецептов sing-box с каталогом — задача 22. Хук как `DocWriter` — задача 14. E2E «с нуля» — задача 23. Документация — задача 24. Тристейт, `NumberField` с границами, `ListEditor` с перестановкой, `MenuButton` — задачи 3, 4.

**Заглушки.** Проверено: ни «TBD», ни «аналогично задаче N» без кода; в задаче 22 модули `ads/dns/local/private/warp` описаны таблицей параметров и планов с образцом `split.ts` целиком — этого достаточно для транскрипции, каждая ветка плана однозначна. Ссылки каталога подлежат проверке `curl` перед коммитом — это шаг, а не заглушка.

**Согласованность имён.** `SchemaPath`, `FieldSchema`, `DocOp`, `DocWriter`, `Lock`, `applyOps`, `fieldsAt`, `fieldAt`, `visibleFields`, `unknownKeys`, `deprecatedAt`, `walkSchema` — задачи 1, 2, 5, 13, 14, 17, 19, 20. `singboxFieldsAt`, `singboxFieldAt`, `singboxEnum`, `singboxRefs`, `SINGBOX_DOC_SECTIONS` — задачи 13, 17, 19, 22. `outboundSlot`, `insertAt`, `moveAt`, `removeAtPath` — задачи 14, 17. Стартеры `startInbound/…/nodeIdOf` — задачи 14, 17, 18, 22. `typeOptions`/`typeHint` — задачи 15, 16 (файл `schema/typeSelect.ts` создаёт та из них, что идёт первой; обе волны одна). `RecipeEntry`, `RecipesDialog<TModel>` — задачи 6, 22. Контракт форм `{ value, path, writer, refs }` — задачи 15, 16, 17.

**Волны.** Задачи 15 и 16 в одной волне обе создают `schema/typeSelect.ts` с одинаковым содержимым — контроллер оставляет одну копию; в брифах указать, что файл общий и создаётся идентично.

# Редактор шаблонов Mihomo — план 2 (UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести поддержку шаблонов `MIHOMO` до полного паритета с редактором `XRAY_JSON`: своя страница, граф, формы инспектора, YAML-вкладка с подсказками, проверка ядром, импорт из каталога и трассировка — на общей с Xray оболочке, без её копирования.

**Architecture:** Оболочка редактора разбирается на три общих слоя (ядро черновика `useDocumentDraft`, хром `EditorShell`, канвас `GraphCanvas`) и подключается к документу через `DocumentAdapter`. Редактор Xray переезжает на эти слои без единой правки своих тестов — они и есть контрольная группа. Редактор Mihomo строится рядом: своя модель (готова планом 1), свои правки текста сплайсами, свой словарь полей, питающий одновременно формы инспектора и подсказки YAML.

**Tech Stack:** React 19, TypeScript, `@xyflow/react`, CodeMirror 6 (`@codemirror/lang-yaml`), библиотека `yaml` 2.9, zustand-persist, TanStack Query, vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-mihomo-templates-design.md`
**Предшественник:** `docs/superpowers/plans/2026-09-05-mihomo-plan1-core.md` (ядро; выполнен, влит в `dev`). Раздел «Долги, оставленные планом 1» в конце того файла — обязательный вход этого плана, он закрывается задачей 4.

## Global Constraints

Копии требований спеки, обязательные для КАЖДОЙ задачи.

- **Источником истины является текст документа. Модель строится из текста и никогда не печатается обратно.** `doc.toString()` во `frontend/src` запрещён. Любая правка — `TextEdit[]` из `entities/mihomo/edits.ts`, накладываемый `applyEdits`.
- **Отказ вместо порчи.** Значение, пришедшее через якорь или слияние (`<<: *anchor`), из формы не редактируется: поле показывается только для чтения с объяснением, откуда пришло значение. Операция, которая не может выполниться безопасно, возвращает пустой список правок и причину — не «примерно правильную» правку.
- **Имена подставленных панелью хостов непредсказуемы.** Ссылка на неизвестное имя — предупреждение, а не ошибка. Любая формулировка о подставленных хостах — условная («если панель подставит…»).
- **Тесты редактора Xray не меняются ни в одной строке.** Ни `frontend/test/*` про Xray-профиль и Xray-шаблон, ни их ожидания. Если для прохождения теста понадобилась правка теста — поведение уехало, и это дефект задачи, а не теста. Единственное исключение — точечное расширение `SearchHit['kind']` в задаче 6, где тип пополняется новыми членами союза, не трогая существующие.
- **Дизайн-система не расширяется.** Используются существующие `Button`, `Dialog`, `Select`, `Field`, `Chip`, `TextInput`, `Checkbox`, `CollapsibleSection`, `EmptyState` и токены `tokens.css`. Новых компонентов общего назначения не появляется.
- **Язык интерфейса, сообщений и комментариев — русский.** Коммиты — английский conventional style (`feat(frontend): …`).
- **Ключи локальных хранилищ не меняются:** `docStorageKey(docKind, uuid)` → `template:<uuid>`. Тип шаблона на ключ не влияет.
- Тесты запускаются из корня: `npm test -w frontend`, `npm run typecheck -w frontend`, `npm test -w backend`. Один файл: `cd frontend && npx vitest run test/<файл>`.

## Карта файлов

Что создаётся и за что отвечает. Границы проведены так, чтобы общий слой не знал ни одного имени из Xray или Mihomo.

**Общий слой оболочки (задачи 1–3):**

| Файл | Ответственность |
|---|---|
| `frontend/src/features/editor/documentAdapter.ts` | Интерфейс `DocumentAdapter<TModel>` — всё, что ядру черновика нужно знать о документе |
| `frontend/src/features/editor/useDocumentDraft.ts` | Черновик, история, вкладки, выбор узла, поиск, диалоги, хоткеи. Ни одного имени из Xray |
| `frontend/src/features/editor/xrayAdapter.ts` | Реализация адаптера поверх существующего кода Xray |
| `frontend/src/features/editor/EditorShell.tsx` | Хром редактора: топбар, сцена со слотами, статус-бар, диалоги сброса/версий/горячих клавиш |
| `frontend/src/features/topology/GraphCanvas.tsx` | Канвас React Flow: узлы, рёбра, позиции, фокус, патчбей, док, подписи колонок |

**Модель Mihomo (задачи 4–7):**

| Файл | Ответственность |
|---|---|
| `frontend/src/entities/mihomo/docSchema.ts` | Словарь секций и полей Mihomo: описания, типы, enum'ы. Питает формы И подсказки |
| `frontend/src/entities/mihomo/locate.ts` | Путь ↔ место в тексте: `locateMihomo(md, parts)` и обратная `pathAt(md, offset)` |
| `frontend/src/entities/mihomo/search.ts` | Поиск узлов графа по строке |
| `frontend/src/entities/graph/mihomo/locate.ts` | Путь диагностики → id узла графа, счётчики проблем по узлам |
| `frontend/src/entities/mihomo/trace.ts` | Трассировка: куда уйдёт домен или адрес (задача 15) |

**UI Mihomo (задачи 8–14):**

| Файл | Ответственность |
|---|---|
| `frontend/src/features/editor/mihomoAdapter.ts` | Реализация адаптера для Mihomo |
| `frontend/src/features/editor/useMihomoDraft.ts` | Черновик Mihomo: ядро + операции правки текста |
| `frontend/src/features/topology/mihomoNodes.tsx` | Карточки узлов Mihomo для React Flow |
| `frontend/src/features/topology/MihomoTopology.tsx` | Граф Mihomo поверх `GraphCanvas`: док, коммутация, объяснения отказов |
| `frontend/src/features/inspector/MihomoFieldsForm.tsx` | Форма по дескрипторам словаря: одна на все секции с плоскими полями |
| `frontend/src/features/inspector/MihomoRuleForm.tsx` | Форма правила: тип, значение, цель, модификаторы |
| `frontend/src/features/topology/MihomoInspector.tsx` | Разводка узла на форму, кнопки удаления и перестановки |
| `frontend/src/features/editor/YamlView.tsx` | Текстовая вкладка: CodeMirror + YAML + линтер + переход к месту |
| `frontend/src/features/editor/mihomoIntellisense/` | Подсказки ключей и значений, hover — по словарю, через API `yaml` |
| `frontend/src/features/templates/MihomoEditorPage.tsx` | Страница редактора шаблона Mihomo |
| `frontend/src/features/templates/ImportTemplateDialog.tsx` | Импорт из каталога `remnawave/templates` |
| `frontend/src/features/diagnostics/MihomoCheckDialog.tsx` | Отчёт проверки ядром `mihomo -t` |

---

### Task 1: Адаптер документа и ядро черновика

Оболочка сегодня предполагает JSON и Xray во всех слоях. Задача вынимает из `useConfigDraft`
всё, что не зависит от вида документа, и оставляет наверху только специфичное для Xray.
Поведение редактора Xray не меняется — его тесты и есть контрольная группа.

**Files:**
- Create: `frontend/src/features/editor/documentAdapter.ts`
- Create: `frontend/src/features/editor/useDocumentDraft.ts`
- Create: `frontend/src/features/editor/xrayAdapter.ts`
- Modify: `frontend/src/features/editor/useConfigDraft.ts` (переписывается поверх ядра)
- Modify: `frontend/src/features/editor/Workbench.tsx` (обращения к `draft.tab` и методам вкладок)
- Test: `frontend/test/document-draft.test.tsx` (создать)

**Interfaces:**
- Consumes: `validateXrayConfig`, `issueCountsByNode`, `nodeIdForPath`, `searchNodes`,
  `useDraftStore`, `useHistoryStore`, `docStorageKey`, `useHotkeys` — всё существующее.
- Produces:
  - `interface DocumentAdapter<TModel>` — поля `textTabLabel: string`;
    `parse(text: string): { model: TModel | undefined; issues: ValidationIssue[] }`;
    `issueCounts(issues: ValidationIssue[], model: TModel): Record<string, IssueCount>`;
    `nodeIdForPath(parts: PathParts, model: TModel): string | null`;
    `search(model: TModel, ctx: GraphContext, query: string): SearchHit[]`
  - `useDocumentDraft<TModel>(options: DocumentDraftOptions<TModel>): DocumentDraft<TModel>`
  - `interface DocumentDraftOptions<TModel> { docKind: DocKind; docKey: string; panelText: string; baseVersion: string; ctx: GraphContext; adapter: DocumentAdapter<TModel> }`
  - `escapeTarget(state)`, `resolveDraftText(draft, panelText)` — из `useDocumentDraft`
  - `xrayAdapter: DocumentAdapter<XrayConfig>`
  - `ConfigDraft extends DocumentDraft<XrayConfig>` — публичная поверхность редактора Xray
    сохраняется полностью, кроме переименования вкладок (см. решение 3).

**Три решения, принятых здесь; менять их в следующих задачах нельзя без нового обоснования:**

1. **Адаптер несёт ровно то, что читает ядро.** Спека рисует у него ещё `language`,
   `buildGraph`, `locate`, `completion`, `hover`. Их сюда не кладём: граф и текстовая вкладка
   приходят в оболочку слотами (`ReactNode`) от страницы, ядро их не вызывает никогда. Поле,
   которого никто не читает, устаревает молча.
2. **`changeConfig` не обобщается.** У Mihomo единица правки — `TextEdit[]`, а не новая
   модель; общий «применить модель» был бы интерфейсом ради симметрии. Каждый документ
   строит свои операции поверх `writeDraft`.
3. **Вкладки переименованы** из `'topology' | 'json'` в `'graph' | 'text'`, методы —
   `openGraphTab`/`openTextTab`. Проверено, что тесты их не читают:
   `grep -rn "\.tab\b\|openJsonTab\|openTopologyTab" frontend/test/` не даёт совпадений; тесты
   кликают по подписям кнопок, а подписи не меняются. У Mihomo текстовая вкладка называется
   YAML, и имя `openJsonTab` там врало бы.

- [ ] **Step 1: Написать падающий тест ядра**

Создать `frontend/test/document-draft.test.tsx`. Игрушечная модель нужна, чтобы тест ловил
протечку Xray в ядро: если ядро начнёт звать `validateXrayConfig` мимо адаптера, тест
покраснеет на первом же случае.

```tsx
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  escapeTarget,
  resolveDraftText,
  useDocumentDraft,
  type DocumentAdapter,
} from '../src/features/editor/useDocumentDraft'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'

interface ToyModel {
  lines: string[]
}

// Документ — строки текста. Ядро не знает ни JSON, ни YAML, и это тест фиксирует.
const toyAdapter: DocumentAdapter<ToyModel> = {
  textTabLabel: 'TOY',
  parse: (text) => ({
    model: text.includes('!') ? undefined : { lines: text.split('\n') },
    issues: text.includes('!')
      ? [{ parts: [], path: '', message: 'восклицательный знак', level: 'error' as const }]
      : [{ parts: ['lines', 0], path: 'lines.0', message: 'первая строка', level: 'warning' as const }],
  }),
  issueCounts: () => ({ 'line:0': { errors: 0, warnings: 1 } }),
  nodeIdForPath: (parts) => (parts[0] === 'lines' ? `line:${parts[1]}` : null),
  search: (model, _ctx, query) =>
    model.lines
      .map((line, i) => ({
        nodeId: `line:${i}`,
        kind: 'rule' as const,
        title: line,
        matchedOn: 'строка',
      }))
      .filter((h) => query !== '' && h.title.includes(query)),
}

function draft() {
  return renderHook(() =>
    useDocumentDraft({
      docKind: 'template',
      docKey: 'toy-1',
      panelText: 'a\nb',
      baseVersion: 'v1',
      ctx: {},
      adapter: toyAdapter,
    }),
  )
}

describe('ядро черновика', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
  })

  it('без черновика показывает текст панели и не считается изменённым', () => {
    const { result } = draft()
    expect(result.current.text).toBe('a\nb')
    expect(result.current.dirty).toBe(false)
    expect(result.current.storageKey).toBe('template:toy-1')
  })

  it('разбор идёт через адаптер: модель, диагностики и счётчики берутся у него', () => {
    const { result } = draft()
    expect(result.current.model).toEqual({ lines: ['a', 'b'] })
    expect(result.current.warningCount).toBe(1)
    expect(result.current.errorCount).toBe(0)
    expect(result.current.nodeIssues).toEqual({ 'line:0': { errors: 0, warnings: 1 } })
  })

  it('неразобранный документ гасит модель, но не диагностики', () => {
    const { result } = draft()
    act(() => result.current.writeDraft('a!', { history: true }))
    expect(result.current.model).toBeUndefined()
    expect(result.current.hasErrors).toBe(true)
    expect(result.current.nodeIssues).toEqual({})
  })

  it('запись черновика попадает в историю и отменяется', () => {
    const { result } = draft()
    act(() => result.current.writeDraft('c\nd', { history: true }))
    expect(result.current.text).toBe('c\nd')
    expect(result.current.dirty).toBe(true)
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(result.current.text).toBe('a\nb')
  })

  it('на текстовой вкладке история недоступна, а уход с неё пишет один снимок', () => {
    const { result } = draft()
    act(() => result.current.openTextTab())
    act(() => result.current.writeDraft('x', { history: false }))
    expect(result.current.undoAvailable).toBe(false)
    act(() => result.current.openGraphTab())
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(result.current.text).toBe('a\nb')
  })

  it('переход к проблеме зависит от вкладки', () => {
    const { result } = draft()
    const issue = { parts: ['lines', 0], path: 'lines.0', message: 'x', level: 'warning' as const }
    act(() => result.current.selectIssue(issue))
    expect(result.current.selectedNode).toBe('line:0')
    act(() => result.current.openTextTab())
    act(() => result.current.selectIssue(issue))
    expect(result.current.reveal?.parts).toEqual(['lines', 0])
  })

  it('поиск идёт через адаптер', () => {
    const { result } = draft()
    act(() => result.current.setSearchQuery('b'))
    expect(result.current.searchHits.map((h) => h.nodeId)).toEqual(['line:1'])
  })

  it('escapeTarget закрывает слои сверху вниз', () => {
    expect(escapeTarget({ selectedNode: 'x', traceTarget: null, searchQuery: 'q' })).toBe('inspector')
    expect(
      escapeTarget({
        selectedNode: null,
        traceTarget: { address: 'a', port: 443, network: 'tcp' },
        searchQuery: 'q',
      }),
    ).toBe('trace')
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: 'q' })).toBe('search')
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: ' ' })).toBe(null)
  })

  it('resolveDraftText: черновик приоритетнее текста панели', () => {
    expect(resolveDraftText({ text: 'd', baseVersion: 'v', savedAt: 's' }, 'panel')).toBe('d')
    expect(resolveDraftText(undefined, 'panel')).toBe('panel')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/document-draft.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/features/editor/useDocumentDraft"`.

- [ ] **Step 3: Завести интерфейс адаптера**

Создать `frontend/src/features/editor/documentAdapter.ts` целиком:

```ts
// Что оболочке редактора нужно знать о документе, чтобы не знать о нём больше
// ничего. Реализаций две: xrayAdapter (JSON-конфиг Xray) и mihomoAdapter (YAML
// шаблона Mihomo). Ядро черновика (useDocumentDraft) читает ТОЛЬКО отсюда.
//
// Графа и текстовой вкладки здесь нет намеренно: обе приходят в оболочку слотами
// (ReactNode) от страницы, и ядро их не вызывает. Поле, которого никто не читает,
// устаревает молча — заводить его авансом хуже, чем добавить, когда появится
// вызывающий.

import type { PathParts, ValidationIssue } from '../../entities/xray'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import type { SearchHit } from '../../entities/graph/search'

export interface DocumentAdapter<TModel> {
  /** Подпись сегмента текстовой вкладки в топбаре: «JSON» или «YAML» */
  textTabLabel: string
  /**
   * Разбор текста. `model === undefined` — документ не разбирается, граф не
   * строится, оболочка показывает пустое состояние. Диагностики возвращаются в
   * обоих случаях: одна опечатка не должна лишать пользователя объяснения.
   */
  parse(text: string): { model: TModel | undefined; issues: ValidationIssue[] }
  /** Счётчики проблем по id узла графа — рисуются значком на карточке */
  issueCounts(issues: ValidationIssue[], model: TModel): Record<string, IssueCount>
  /** Путь диагностики → id узла графа; null — узла для этого пути нет */
  nodeIdForPath(parts: PathParts, model: TModel): string | null
  /** Поиск узлов по строке запроса */
  search(model: TModel, ctx: GraphContext, query: string): SearchHit[]
}
```

- [ ] **Step 4: Перенести ядро в `useDocumentDraft.ts`**

Создать `frontend/src/features/editor/useDocumentDraft.ts`. Это **перенос без изменения
поведения**: из сегодняшнего `useConfigDraft.ts` переезжают дословно, ничего не правя внутри
тел, `escapeTarget` и вся машинерия хука — черновик, история, вкладки, выбор узла, reveal,
поиск, фокус, флаги диалогов, `useHotkeys`, `resetDraft`, `clearAfterSave`,
`adoptPanelVersion`, `doUndo`, `doRedo`, `writeDraft`, `focusNode`, `toggleTrace`.

Что при переносе меняется — ровно пять мест, и только они:

1. Сигнатура и опции: вместо `panelConfig: unknown` приходит `panelText: string`, добавлено
   поле `adapter`. `panelText` больше не считается через `formatConfig` — он приходит готовым.
2. `resolveEditorText(stored, panelConfig)` → `resolveDraftText(stored, panelText)`:
   ```ts
   export function resolveDraftText(draft: Draft | undefined, panelText: string): string {
     return draft ? draft.text : panelText
   }
   ```
3. Разбор вместо `validateXrayConfig`:
   ```ts
   const parsed = useMemo(() => adapter.parse(text), [adapter, text])
   const model = parsed.model
   const issues = parsed.issues
   const errorCount = issues.filter((i) => i.level === 'error').length
   const hasErrors = errorCount > 0
   const warningCount = issues.length - errorCount
   ```
   Поля `validation` и `parsedConfig` в ядре не появляются вовсе — они остаются в `useConfigDraft`.
4. Вкладки и всё, что от них зависит:
   ```ts
   const [tab, setTab] = useState<'graph' | 'text'>('graph')
   // Текст на момент входа в текстовый редактор: вся текстовая сессия
   // сворачивается в один снимок истории при уходе с вкладки
   const textEntry = useRef<string | null>(null)
   const historyDisabled = tab === 'text'

   function openTextTab() {
     textEntry.current = text
     setTab('text')
     setSelectedNode(null)
     // Панель разбора живёт над канвасом — над текстовым редактором ей не место
     setTraceTarget(null)
     setTraceOpen(false)
   }

   function openGraphTab() {
     const entry = textEntry.current
     if (entry !== null && entry !== text) record(storageKey, entry)
     textEntry.current = null
     setTab('graph')
   }
   ```
   В хоткее `mod+f` условие становится `tab === 'graph'`.
5. Всё, что звало Xray напрямую, зовёт адаптер и защищено проверкой `model === undefined`:
   ```ts
   const searchHits = useMemo(
     () => (model === undefined ? [] : adapter.search(model, ctx, searchQuery)),
     [adapter, model, ctx, searchQuery],
   )
   const nodeIssues = useMemo(
     () => (model === undefined ? {} : adapter.issueCounts(issues, model)),
     [adapter, issues, model],
   )

   // Переход зависит от вкладки: на графе ведём к узлу, в тексте — к месту.
   // Вкладку не переключаем: у части путей узла нет, и прыжок увёл бы в никуда.
   function canSelectIssue(issue: ValidationIssue): boolean {
     if (tab === 'text') return issue.parts.length > 0
     return model !== undefined && adapter.nodeIdForPath(issue.parts, model) !== null
   }

   function selectIssue(issue: ValidationIssue) {
     if (tab === 'text') {
       revealNonce.current += 1
       setReveal({ parts: issue.parts, nonce: revealNonce.current })
       return
     }
     const id = model === undefined ? null : adapter.nodeIdForPath(issue.parts, model)
     if (id) setSelectedNode(id)
   }
   ```

Возвращаемый тип — `DocumentDraft<TModel>`: те же поля, что сегодня отдаёт `useConfigDraft`,
**за вычетом** `validation`, `parsedConfig`, `changeConfig`, `trace`, `settingsOpen`,
`setSettingsOpen`, `applyNode`, `moveSelected`, `removeSelected`, `appendGeoKeyToRule`,
`setupObservatory`, и с добавленными `model: TModel | undefined` и `issues: ValidationIssue[]`.
Поля `traceOpen`, `toggleTrace`, `traceTarget`, `setTraceTarget`, `geoOpen`, `setGeoOpen`
остаются в ядре: у Mihomo трассировка и geo-базы тоже есть, а тип `TraceTarget`
(адрес, порт, сеть, ip) от вида документа не зависит.

- [ ] **Step 5: Убедиться, что тест ядра проходит**

Run: `cd frontend && npx vitest run test/document-draft.test.tsx`
Expected: PASS, 9 тестов.

- [ ] **Step 6: Написать адаптер Xray**

Создать `frontend/src/features/editor/xrayAdapter.ts` целиком:

```ts
// Реализация адаптера поверх существующего кода Xray. Ни одной новой строки
// логики: только раскладка уже работающих функций по полям интерфейса.

import { validateXrayConfig, type XrayConfig } from '../../entities/xray'
import { issueCountsByNode, nodeIdForPath } from '../../entities/graph/locate'
import { searchNodes } from '../../entities/graph/search'
import type { DocumentAdapter } from './documentAdapter'

export const xrayAdapter: DocumentAdapter<XrayConfig> = {
  textTabLabel: 'JSON',
  parse: (text) => {
    const validation = validateXrayConfig(text)
    return {
      // Топология строится только по документу, прошедшему схему
      model: validation.ok ? (validation.config as XrayConfig) : undefined,
      issues: validation.issues,
    }
  },
  issueCounts: (issues, config) => issueCountsByNode(issues, config),
  nodeIdForPath: (parts, config) => nodeIdForPath(parts, config),
  search: (config, ctx, query) => searchNodes(config, ctx, query),
}
```

- [ ] **Step 7: Переписать `useConfigDraft` надстройкой над ядром**

В `frontend/src/features/editor/useConfigDraft.ts` остаются без единой правки тела функции
`formatConfig`, `resolveEditorText`, `nextSelection`, `moveSelectedRule`, `renamedNodeId`,
`traceOf`, константы `NO_GEO` и `TRACE_DEBOUNCE_MS` — их импортирует
`frontend/test/editor-logic.test.ts`, который трогать нельзя. `escapeTarget` переезжает в ядро
и **реэкспортируется** отсюда, чтобы импорт в том же тесте продолжал работать:

```ts
export { escapeTarget } from './useDocumentDraft'
```

Сам хук становится надстройкой:

```ts
export interface ConfigDraft extends DocumentDraft<XrayConfig> {
  validation: ReturnType<typeof validateXrayConfig>
  /** Разобранный конфиг; undefined — документ не проходит схему */
  parsedConfig: XrayConfig | undefined
  changeConfig: (next: XrayConfig) => void
  trace: TraceResult | undefined
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  applyNode: (value: unknown) => void
  moveSelected: (dir: -1 | 1) => void
  removeSelected: () => void
  appendGeoKeyToRule: (key: string) => void
  setupObservatory: (kind: 'observatory' | 'burst', subjects: string[]) => void
}

export function useConfigDraft({
  docKind,
  docKey,
  panelConfig,
  baseVersion,
  ctx,
}: ConfigDraftOptions): ConfigDraft {
  const panelText = useMemo(() => formatConfig(panelConfig), [panelConfig])
  const core = useDocumentDraft({ docKind, docKey, panelText, baseVersion, ctx, adapter: xrayAdapter })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const parsedConfig = core.model
  // validation остаётся публичной: страницы шлют validation.config в панель,
  // а SaveDialog показывает validation.issues
  const validation = useMemo(() => validateXrayConfig(core.text), [core.text])

  const settledTarget = useDebounced(core.traceTarget, TRACE_DEBOUNCE_MS)
  const geoKeys = useMemo(() => (parsedConfig ? geoKeysOf(parsedConfig) : []), [parsedConfig])
  const geoQuery = useGeoMatch(
    settledTarget ? { domain: settledTarget.address, ip: settledTarget.ip, keys: geoKeys } : null,
  )
  const trace = useMemo(
    () => traceOf(parsedConfig, settledTarget, geoQuery.data),
    [parsedConfig, settledTarget, geoQuery.data],
  )

  function changeConfig(next: XrayConfig) {
    if (!parsedConfig) return
    core.writeDraft(formatConfig(next), { history: true })
    core.setSelectedNode(nextSelection(core.selectedNode, parsedConfig, next))
  }

  return {
    ...core,
    validation,
    parsedConfig,
    changeConfig,
    trace,
    settingsOpen,
    setSettingsOpen,
    applyNode: (value) => {
      if (!parsedConfig || !core.selectedNode) return
      changeConfig(applyNodeJson(parsedConfig, core.selectedNode, value))
      // Тег сменился — сменился и id узла: перекрываем сброс выбора из changeConfig
      const renamed = renamedNodeId(core.selectedNode, value)
      if (renamed !== null) core.setSelectedNode(renamed)
    },
    moveSelected: (dir) => {
      if (!parsedConfig) return
      const moved = moveSelectedRule(parsedConfig, core.selectedNode, dir)
      if (!moved) return
      changeConfig(moved.config)
      // Перекрывает nextSelection: число правил не изменилось, но правило переехало
      core.setSelectedNode(moved.selected)
    },
    removeSelected: () => {
      if (!parsedConfig || !core.selectedNode) return
      changeConfig(removeNode(parsedConfig, core.selectedNode))
      core.setSelectedNode(null)
    },
    appendGeoKeyToRule: (key) => {
      if (!parsedConfig) return
      // Категория дописывается в открытое правило, иначе создаётся новое
      const ruleIndex = core.selectedNode?.startsWith('rule:')
        ? Number(core.selectedNode.slice(5))
        : null
      const res = appendGeoKey(parsedConfig, ruleIndex, key)
      if (res.config !== parsedConfig) changeConfig(res.config)
      // Перекрывает сброс выбора: показываем, куда попала категория
      core.setSelectedNode(`rule:${res.ruleIndex}`)
      core.setGeoOpen(false)
    },
    setupObservatory: (kind, subjects) => {
      if (!parsedConfig) return
      changeConfig(ensureObservatorySection(parsedConfig, kind, subjects))
      core.setSelectedNode('obs')
    },
  }
}
```

Импорты привести в порядок: добавить `useState` к React-импорту, убрать `PathParts`,
`ValidationIssue`, `IssueCount`, `SearchHit`, `searchNodes`, `issueCountsByNode`,
`nodeIdForPath`, `useDraftStore`, `useHistoryStore`, `docStorageKey`, `useHotkeys`,
`hasOpenDialog` — здесь они больше не нужны, и `tsc --noEmit` с `noUnusedLocals` их поймает.

- [ ] **Step 8: Подправить `Workbench` под переименованные вкладки**

В `frontend/src/features/editor/Workbench.tsx` заменить пять обращений: в сегментах
`draft.tab === 'topology'` → `draft.tab === 'graph'`, `draft.openTopologyTab` →
`draft.openGraphTab`, `draft.tab === 'json'` → `draft.tab === 'text'`, `draft.openJsonTab` →
`draft.openTextTab`; те же две замены в условиях сцены. Подписи кнопок «Топология» и «JSON»
остаются прежними — на них завязаны тесты.

- [ ] **Step 9: Прогнать весь фронтенд и проверку типов**

Run: `npm test -w frontend && npm run typecheck -w frontend`
Expected: PASS. Тесты Xray обязаны пройти **без единой правки** — это контрольная группа
задачи. Покраснел какой-то из них — поведение уехало: чинить код, а не тест.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/editor frontend/test/document-draft.test.tsx
git commit -m "refactor(frontend): document adapter and shared draft core"
```

### Task 2: Хром редактора — `EditorShell`

`Workbench` сегодня одновременно и хром (топбар, сцена, статус-бар, общие диалоги), и сборка
Xray-канваса с Xray-инспектором. Задача разрезает его по этому шву: хром переезжает в
`EditorShell` со слотами, `Workbench` становится сборкой Xray поверх него. Разметка,
подписи и порядок элементов не меняются — на них завязаны `workbench.test.tsx` и e2e.

**Files:**
- Create: `frontend/src/features/editor/EditorShell.tsx`
- Modify: `frontend/src/features/editor/useDocumentDraft.ts` (добавить тип `EditorShellDraft`)
- Modify: `frontend/src/features/editor/Workbench.tsx` (сборка поверх `EditorShell`)
- Test: `frontend/test/editor-shell.test.tsx` (создать)

**Interfaces:**
- Consumes: `DocumentDraft` из задачи 1.
- Produces:
  - `interface EditorShellDraft` в `useDocumentDraft.ts` — подмножество полей черновика,
    которые читает хром, **без параметра модели**: `docKey`, `storageKey`, `text`, `dirty`,
    `issues`, `errorCount`, `warningCount`, `tab`, `openGraphTab`, `openTextTab`,
    `undoAvailable`, `redoAvailable`, `doUndo`, `doRedo`, `canSelectIssue`, `selectIssue`,
    `issuesOpen`, `setIssuesOpen`, `shortcutsOpen`, `setShortcutsOpen`, `writeDraft`,
    `resetDraft`, `setSelectedNode`. `DocumentDraft<TModel>` объявляется как
    `extends EditorShellDraft` — так хром принимает любой черновик, не зная его модели.
  - `EditorShell(props: EditorShellProps)` с полями: `draft: EditorShellDraft`;
    `kind: 'profiles' | 'templates'`; `back: { to: string; label: string }`; `title: string`;
    `subtitle?: string`; `tabs: { graph: string; text: string }`; `actions?: ReactNode`;
    `save?: ReactNode`; `statusExtra?: ReactNode`; `canvas: ReactNode`; `textView: ReactNode`;
    `children?: ReactNode`.

**Решение: `Настройки конфига` и `Geo-базы` уезжают в слот `actions`.** Обе кнопки
document-specific: первой у Mihomo нет вовсе (её роль играют формы секций в инспекторе),
у второй диалог зависит от того, как документ дописывает geo-категорию в правило. Порядок в
топбаре сохраняется тем, что `Workbench` кладёт их в `actions` первыми.

- [ ] **Step 1: Написать падающий тест хрома**

Создать `frontend/test/editor-shell.test.tsx`. Тест берёт хром отдельно от Xray — если в него
протечёт что-то из конфига, он не соберётся.

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { EditorShell } from '../src/features/editor/EditorShell'
import type { EditorShellDraft } from '../src/features/editor/useDocumentDraft'

function shellDraft(over: Partial<EditorShellDraft> = {}): EditorShellDraft {
  return {
    docKey: 'u-1',
    storageKey: 'template:u-1',
    text: 'текст',
    dirty: false,
    issues: [],
    errorCount: 0,
    warningCount: 0,
    tab: 'graph',
    openGraphTab: vi.fn(),
    openTextTab: vi.fn(),
    undoAvailable: false,
    redoAvailable: false,
    doUndo: vi.fn(),
    doRedo: vi.fn(),
    canSelectIssue: () => true,
    selectIssue: vi.fn(),
    issuesOpen: false,
    setIssuesOpen: vi.fn(),
    shortcutsOpen: false,
    setShortcutsOpen: vi.fn(),
    writeDraft: vi.fn(),
    resetDraft: vi.fn(),
    setSelectedNode: vi.fn(),
    ...over,
  }
}

function renderShell(draft: EditorShellDraft) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditorShell
          draft={draft}
          kind="templates"
          back={{ to: '/templates', label: '← Шаблоны' }}
          title="Документ"
          tabs={{ graph: 'Топология', text: 'YAML' }}
          canvas={<div>канвас</div>}
          textView={<div>текст документа</div>}
          save={<button type="button">Сохранить в панель</button>}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EditorShell', () => {
  it('подписи вкладок приходят пропсом', () => {
    renderShell(shellDraft())
    expect(screen.getByRole('button', { name: 'Топология' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument()
  })

  it('на вкладке графа показывает канвас, на текстовой — текстовый слот', () => {
    const { rerender } = renderShell(shellDraft())
    expect(screen.getByText('канвас')).toBeInTheDocument()
    rerender(<div />)
    renderShell(shellDraft({ tab: 'text' }))
    expect(screen.getByText('текст документа')).toBeInTheDocument()
  })

  it('без проблем статус-бар говорит, что документ валиден', () => {
    renderShell(shellDraft())
    expect(screen.getByText('Конфиг валиден')).toBeInTheDocument()
  })

  it('счётчики проблем раскрываются в список', async () => {
    const issues = [
      { parts: ['rules', 0], path: 'rules.0', message: 'плохое правило', level: 'error' as const },
    ]
    renderShell(shellDraft({ issues, errorCount: 1, issuesOpen: true }))
    expect(screen.getByText('ошибок: 1')).toBeInTheDocument()
    expect(screen.getByText(/плохое правило/)).toBeInTheDocument()
  })

  it('сброс черновика спрашивает подтверждение и только потом зовёт resetDraft', async () => {
    const resetDraft = vi.fn()
    renderShell(shellDraft({ dirty: true, resetDraft }))
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить к версии панели' }))
    expect(resetDraft).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(resetDraft).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/editor-shell.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/features/editor/EditorShell"`.

- [ ] **Step 3: Написать `EditorShell`**

Создать `frontend/src/features/editor/EditorShell.tsx`. В него переезжает из `Workbench.tsx`
дословно: разметка `<header className="wb-topbar">` (кнопка возврата, заголовок с подзаголовком,
`wb-iconbar` с тремя кнопками, `segmented`, `spacer`, чип «черновик»), разметка
`<footer className="wb-statusbar">` целиком вместе с `PanelTokenNotice` и `IssueList`, диалог
сброса, `ShortcutsDialog`, `VersionsDialog`. Меняются ровно три вещи:

```tsx
        <div className="segmented">
          <Button aria-pressed={draft.tab === 'graph'} onClick={draft.openGraphTab}>
            {tabs.graph}
          </Button>
          <Button aria-pressed={draft.tab === 'text'} onClick={draft.openTextTab}>
            {tabs.text}
          </Button>
        </div>
```

```tsx
      <div className="wb-stage">
        {draft.tab === 'text' ? textView : canvas}
      </div>
```

и в статус-баре `draft.validation.issues` → `draft.issues` (три обращения: проверка на
пустоту, условие раскрытия списка и проп `issues` у `IssueList`).

Порядок правой части топбара: `{actions}`, «Версии», «Сбросить к версии панели», `{save}`.
Кнопки «Настройки конфига» и «Geo-базы» отсюда уходят — их приносит `actions`.

- [ ] **Step 4: Собрать `Workbench` поверх хрома**

`Workbench` сохраняет свой публичный пропс-интерфейс (`WorkbenchProps`) целиком: его читают
`EditorPage`, `TemplateEditorPage`, `workbench.test.tsx` и `workbench-topology-props.test.tsx`.
Внутри он теперь строит два слота и передаёт их в `EditorShell`:

```tsx
  const canvas =
    parsedConfig === undefined ? (
      <div className="wb-canvas wb-canvas-empty">
        <EmptyState
          title="Конфиг не проходит валидацию"
          hint="Исправьте ошибки на вкладке JSON — топология строится по валидному документу."
        />
      </div>
    ) : (
      <>
        <div className="wb-canvas">
          <TopologyView … />
        </div>
        {draft.trace && <TracePanel … />}
        {draft.selectedNode && <NodeInspector … />}
      </>
    )

  const textView = (
    <div className="wb-canvas">
      <JsonView
        text={draft.text}
        reveal={draft.reveal}
        onChange={(value) => draft.writeDraft(value, { history: false })}
      />
    </div>
  )
```

Внутренности `TopologyView`, `TracePanel`, `NodeInspector` и `JsonView` переносятся из
сегодняшнего `Workbench` со всеми пропсами дословно.

Кнопки, ушедшие из хрома, собираются в `actions` в прежнем порядке:

```tsx
  const topbarActions = (
    <>
      <Button
        variant="ghost"
        disabled={parsedConfig === undefined}
        onClick={() => draft.setSettingsOpen(true)}
      >
        Настройки конфига
      </Button>
      {actions}
      <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>
        Geo-базы
      </Button>
    </>
  )
```

`ConfigSettingsDialog` и `GeoDataDialog` остаются в `Workbench` и уезжают в `children`
`EditorShell` вместе с `children` страницы. Подписи вкладок — `{ graph: 'Топология', text: 'JSON' }`.

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w frontend && npm run typecheck -w frontend`
Expected: PASS. `workbench.test.tsx`, `workbench-topology-props.test.tsx` и все e2e-сценарии
редактора обязаны пройти без правок.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/editor frontend/test/editor-shell.test.tsx
git commit -m "refactor(frontend): extract EditorShell from Workbench"
```

---

### Task 3: Канвас — `GraphCanvas`

Ту же операцию проделываем с `TopologyView`: обвязка React Flow (позиции, фокус, патчбей,
подписи колонок, док) не знает ни про Xray, ни про Mihomo — она переезжает в `GraphCanvas`.
В `TopologyView` остаётся сборка графа Xray, его коммутация и два его диалога.

**Files:**
- Create: `frontend/src/features/topology/GraphCanvas.tsx`
- Modify: `frontend/src/features/topology/TopologyView.tsx`
- Test: `frontend/test/graph-canvas.test.tsx` (создать)

**Interfaces:**
- Produces: `GraphCanvas(props)` с полями:
  `docKey: string`; `nodes: Node[]`; `edges: Edge[]`;
  `nodeTypes: Record<string, ComponentType<NodeProps>>`; `edgeTypes`;
  `selectedId: string | null`; `onSelect: (id: string | null) => void`;
  `isValidConnection: (conn: { source?: string | null; target?: string | null }) => boolean`;
  `onConnect: (conn: Connection) => void`; `onEdgesDelete?: (deleted: Edge[]) => void`;
  `targetKinds: readonly string[]`; `columns: { kind: string; title: string; x: number }[]`;
  `hint?: ReactNode`; `dockActions?: ReactNode`; `dockExtra?: ReactNode`; `dockRow?: ReactNode`;
  `focus?: { nodeId: string; nonce: number } | null`; `children?: ReactNode`.
  Плюс реэкспортируемые из него `resyncEdges`, `inspectorWidth`.
- Consumes: `usePositionsStore`.

**Требование к совместимости:** `TopologyView` обязан продолжать экспортировать
`isValidConnection`, `applyConnection`, `resyncEdges`, `inspectorWidth`, `traceStateOf`,
`issueBadgeOf`, `tracedEdgeIds` — их импортируют шесть тест-файлов, которые менять нельзя.
`resyncEdges` и `inspectorWidth` переезжают в `GraphCanvas` и реэкспортируются:
`export { inspectorWidth, resyncEdges } from './GraphCanvas'`.

- [ ] **Step 1: Написать падающий тест канваса**

Создать `frontend/test/graph-canvas.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { GraphCanvas } from '../src/features/topology/GraphCanvas'

const NODE_TYPES = {
  box: ({ data }: { data: { label: string } }) => <div>{data.label}</div>,
} as never

function renderCanvas(over: Partial<Parameters<typeof GraphCanvas>[0]> = {}) {
  return render(
    <ReactFlowProvider>
      <GraphCanvas
        docKey="template:u-1"
        nodes={[{ id: 'a', type: 'box', position: { x: 0, y: 0 }, data: { label: 'узел A' } }]}
        edges={[]}
        nodeTypes={NODE_TYPES}
        edgeTypes={{}}
        selectedId={null}
        onSelect={vi.fn()}
        isValidConnection={() => true}
        onConnect={vi.fn()}
        targetKinds={['group']}
        columns={[{ kind: 'box', title: 'колонка', x: 0 }]}
        dockActions={<button type="button">+ Правило</button>}
        {...over}
      />
    </ReactFlowProvider>,
  )
}

describe('GraphCanvas', () => {
  it('рисует узлы переданных типов', () => {
    renderCanvas()
    expect(screen.getByText('узел A')).toBeInTheDocument()
  })

  it('подписи колонок приходят пропсом', () => {
    renderCanvas()
    expect(screen.getByText('колонка')).toBeInTheDocument()
  })

  it('кнопки дока приходят слотом, а «Сбросить расположение» есть всегда', () => {
    renderCanvas()
    expect(screen.getByRole('button', { name: '+ Правило' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сбросить расположение' })).toBeInTheDocument()
  })

  it('раскрытый инструмент уезжает во вторую строку дока', () => {
    const { container } = renderCanvas({ dockRow: <span>вторая строка</span> })
    expect(container.querySelector('.wb-dock-stacked')).not.toBeNull()
    expect(screen.getByText('вторая строка')).toBeInTheDocument()
  })

  it('подсказка пустого графа показывается только когда её передали', async () => {
    renderCanvas({ hint: <p>правил пока нет</p> })
    expect(screen.getByText('правил пока нет')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить расположение' }))
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/graph-canvas.test.tsx`
Expected: FAIL — модуля `GraphCanvas` нет.

- [ ] **Step 3: Перенести обвязку в `GraphCanvas`**

Создать `frontend/src/features/topology/GraphCanvas.tsx`. Из `TopologyView.tsx` переезжают
**дословно, без правки тел**: `resyncEdges`, `inspectorWidth`, компоненты `ViewportShift`,
`FocusNode`, `RemeasureOnEnter`, `PatchbayState`, локальное состояние `nodes`/`edges` с
ресинком по `useEffect`, `onNodesChange` с записью позиций в `usePositionsStore`,
`onEdgesChange`, разметка `<ReactFlow>` со всеми её атрибутами, `<Background>`, `<Controls>`,
`<ViewportPortal>` с подписями колонок и `<Panel position="bottom-center">` с доком.

Меняются четыре места:

1. `PatchbayState` перестаёт быть замкнутым на модульные `TARGET_KINDS` и
   `isValidConnection` — принимает их пропсами:
   ```tsx
   function PatchbayState({
     targetKinds,
     isValidConnection,
   }: {
     targetKinds: readonly string[]
     isValidConnection: (conn: { source?: string | null; target?: string | null }) => boolean
   }) {
     const dom = useStore((s) => s.domNode)
     const zoom = useStore((s) => s.transform[2])
     const connection = useConnection()
     const from = connection.inProgress ? (connection.fromHandle?.nodeId ?? null) : null

     const accepts = useMemo(() => {
       if (from === null) return null
       return targetKinds
         .filter((kind) => isValidConnection({ source: from, target: `${kind}:probe` }))
         .join(' ')
     }, [from, targetKinds, isValidConnection])

     useEffect(() => {
       dom?.style.setProperty('--rf-zoom', String(zoom))
     }, [dom, zoom])

     useEffect(() => {
       if (!dom) return
       if (accepts === null) delete dom.dataset.accepts
       else dom.dataset.accepts = accepts
     }, [dom, accepts])

     return null
   }
   ```
2. Подписи колонок берутся из пропса `columns`, а не из модульной константы `COLUMNS`.
   Фильтрация «показываем только заполненные» тоже переезжает:
   ```tsx
   const filledColumns = useMemo(() => {
     const kinds = new Set(nodes.map((n) => n.data.kind))
     return columns.filter((c) => kinds.has(c.kind))
   }, [nodes, columns])
   ```
   Внимание: считать надо по `nodes` из пропса (полный набор), а не по локальному состоянию —
   иначе на первом рендере до `useEffect`-ресинка подписи мигнут.
3. Подсказка пустого графа — слот `hint`, а не собственное условие `noRules`:
   ```tsx
   {hint && <Panel position="top-center"><div className="canvas-hint">{hint}</div></Panel>}
   ```
4. Первая группа кнопок дока — слот `dockActions`; разделитель перед `dockExtra` и кнопка
   «Сбросить расположение» остаются в канвасе:
   ```tsx
   <div className="wb-dock-row">
     {dockActions}
     <span className="wb-dock-sep" aria-hidden="true" />
     {dockExtra}
     {dockExtra && <span className="wb-dock-sep" aria-hidden="true" />}
     <Button variant="ghost" onClick={() => resetPositions(docKey)}>
       Сбросить расположение
     </Button>
   </div>
   ```

`children` рендерятся последними внутри `<ReactFlow>` — там живут диалоги документа.

- [ ] **Step 4: Пересобрать `TopologyView` поверх канваса**

В `TopologyView.tsx` остаются: `isValidConnection`, `applyConnection`, `traceStateOf`,
`issueBadgeOf`, `tracedEdgeIds`, `ruleIndexOf`, константы `COLUMNS`, `TARGET_KINDS`,
`RULE_INDEX`, `EDGE_BAL_OUT`, `EDGE_BAL_INJ`, сборка графа (`buildGraph` + `layoutColumns` +
декорирование трассой и значками проблем), `onConnect`, `onEdgesDelete` со всей сортировкой
рёбер, состояния `expand`/`groupBlock` и оба диалога. Пропсы `Props` не меняются.

Возвращаемая разметка:

```tsx
  return (
    <GraphCanvas
      docKey={docKey}
      nodes={computed.nodes}
      edges={computed.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      selectedId={selectedId}
      onSelect={onSelect}
      isValidConnection={isValidConnection}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      targetKinds={TARGET_KINDS}
      columns={COLUMNS}
      focus={focus}
      hint={
        noRules ? (
          <>Правил пока нет. Протяните кабель от гнезда inbound к outbound — правило создастся само.</>
        ) : undefined
      }
      dockActions={
        <>
          <Button onClick={() => onChangeConfig(addInbound(config))}>+ Inbound</Button>
          <Button onClick={() => onChangeConfig(addOutbound(config))}>+ Outbound</Button>
          <Button onClick={() => onChangeConfig(addRule(config))}>+ Правило</Button>
          <Button onClick={() => onChangeConfig(addBalancer(config))}>+ Балансер</Button>
          {allowInject && (
            <Button onClick={() => onChangeConfig(addInjectGroup(config))}>+ Подстановка</Button>
          )}
          {onOpenRecipes && <Button onClick={onOpenRecipes}>+ Рецепт</Button>}
        </>
      }
      dockExtra={dockExtra}
      dockRow={dockRow}
    >
      {/* оба диалога — «Убрать выход из балансера» и «Убрать группу из балансера» —
          переносятся сюда без изменений */}
    </GraphCanvas>
  )
```

Первой строкой файла добавить реэкспорт, на который завязан `topology-resync.test.ts`:

```ts
export { inspectorWidth, resyncEdges } from './GraphCanvas'
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w frontend && npm run typecheck -w frontend`
Expected: PASS. Семь тест-файлов топологии и e2e-сценарии коммутации — без правок.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/topology frontend/test/graph-canvas.test.tsx
git commit -m "refactor(frontend): extract GraphCanvas from TopologyView"
```

### Task 4: Долги плана 1

Три пункта из раздела «Долги, оставленные планом 1» закрываются здесь, до того как на них
что-то построят. Четвёртый (тип правила в проверке допустимости соединения) — не код, а
подключение, и закрывается задачей 9, где появляется вызывающий.

**Files:**
- Modify: `frontend/src/entities/graph/mihomo/mutations.ts` (причина отказа)
- Modify: `frontend/src/entities/graph/mihomo/buildGraph.ts` (раскладка по вертикали)
- Modify: `frontend/src/entities/mihomo/edits.ts` (`walkScalars` на объект-опции)
- Modify: `frontend/test/mihomo-mutations.test.ts` (существующие вызовы возвращают объект)
- Modify: `frontend/test/mihomo-graph.test.ts` (добавляется проверка раскладки)

**Interfaces:**
- Produces:
  - `type MihomoRefusal = 'invalid-pair' | 'already-connected' | 'sub-rule-source' | 'flow-list' | 'merged-list' | 'no-proxies-key' | 'unprintable-name' | 'unprintable-rule' | 'not-found'`
  - `interface MihomoEditResult { edits: TextEdit[]; refusal?: MihomoRefusal }`
  - `connectMihomo(md, source, target): MihomoEditResult`
  - `disconnectMihomo(md, edge): MihomoEditResult`
  - `refusalText(refusal: MihomoRefusal): string` — русское объяснение для интерфейса
  - `layoutMihomo(nodes: FlowNode[]): FlowNode[]`
- Consumes: `fieldOrigin` из `entities/mihomo/edits.ts` — им отличается «ключа нет» от
  «ключ пришёл через слияние».

- [ ] **Step 1: Написать падающие тесты причин отказа и раскладки**

Дописать в `frontend/test/mihomo-mutations.test.ts` новый блок. Существующие тесты в этом
файле переписываются механически: `connectMihomo(...)` → `connectMihomo(...).edits`.

```ts
describe('коммутация объясняет отказ', () => {
  it('список в одну строку: правка сломала бы YAML', () => {
    const md = parseMihomo(['proxy-groups:', '  - name: A', '    proxies: [DIRECT]', ''].join('\n'))
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('flow-list')
    expect(refusalText(res.refusal!)).toMatch(/одну строку/)
  })

  it('список участников пришёл через слияние: правка задела бы все места якоря', () => {
    const md = parseMihomo(
      [
        'x-anchors:',
        '  base: &base',
        '    proxies:',
        '      - DIRECT',
        'proxy-groups:',
        '  - name: A',
        '    <<: *base',
        '',
      ].join('\n'),
    )
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.edits).toEqual([])
    expect(res.refusal).toBe('merged-list')
    expect(refusalText(res.refusal!)).toMatch(/якор/)
  })

  it('ключа proxies нет вовсе — структуру группы не выдумываем', () => {
    const md = parseMihomo(['proxy-groups:', '  - name: A', '    type: select', ''].join('\n'))
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.refusal).toBe('no-proxies-key')
  })

  it('имя уже в списке — соединять нечего', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'),
    )
    expect(connectMihomo(md, 'group:A', 'builtin:DIRECT').refusal).toBe('already-connected')
  })

  it('из узла подстановки кабель не тянется', () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n')
    expect(connectMihomo(md, 'hosts:root', 'group:A').refusal).toBe('invalid-pair')
  })

  it('успешная коммутация причины не несёт', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'),
    )
    const res = connectMihomo(md, 'group:A', 'builtin:REJECT')
    expect(res.edits).toHaveLength(1)
    expect(res.refusal).toBeUndefined()
  })

  it('разрыв ребра, которого нет в списке', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'),
    )
    expect(disconnectMihomo(md, 'e:group:A->builtin:REJECT').refusal).toBe('not-found')
  })
})
```

Дописать в `frontend/test/mihomo-graph.test.ts`:

```ts
describe('раскладка по вертикали', () => {
  it('узлы одной колонки не лежат друг на друге', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const graph = buildMihomoGraph(md)
    const laid = layoutMihomo(graph.nodes)
    const byColumn = new Map<number, number[]>()
    for (const node of laid) {
      const column = byColumn.get(node.position.x) ?? []
      column.push(node.position.y)
      byColumn.set(node.position.x, column)
    }
    for (const [, ys] of byColumn) {
      expect(new Set(ys).size).toBe(ys.length)
    }
  })

  it('порядок узлов внутри колонки сохраняется', () => {
    const nodes = [
      { id: 'a', type: 'x', position: { x: 0, y: 0 }, data: { kind: 'k' } },
      { id: 'b', type: 'x', position: { x: 0, y: 0 }, data: { kind: 'k' } },
      { id: 'c', type: 'x', position: { x: 430, y: 0 }, data: { kind: 'k' } },
    ]
    const laid = layoutMihomo(nodes as never)
    expect(laid.map((n) => [n.position.x, n.position.y])).toEqual([
      [0, 0],
      [0, 130],
      [430, 0],
    ])
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd frontend && npx vitest run test/mihomo-mutations.test.ts test/mihomo-graph.test.ts`
Expected: FAIL — `refusalText`/`layoutMihomo` не экспортируются, `res.edits` не существует.

- [ ] **Step 3: Вернуть причину отказа из коммутации**

В `frontend/src/entities/graph/mihomo/mutations.ts` завести тип и словарь объяснений:

```ts
/**
 * Почему коммутация не выполнилась. Пустой список правок сам по себе ничего не
 * объясняет, а кабель, отскакивающий молча, читается как поломка редактора —
 * поэтому причина обязательна и переводится на русский в одном месте.
 */
export type MihomoRefusal =
  | 'invalid-pair'
  | 'already-connected'
  | 'sub-rule-source'
  | 'flow-list'
  | 'merged-list'
  | 'no-proxies-key'
  | 'unprintable-name'
  | 'unprintable-rule'
  | 'not-found'

export interface MihomoEditResult {
  edits: TextEdit[]
  /** undefined — правка построена; иначе список пуст, и здесь причина */
  refusal?: MihomoRefusal
}

const REFUSAL_TEXT: Record<MihomoRefusal, string> = {
  'invalid-pair': 'Такие узлы не соединяются: из узла подстановки кабель не выходит, а правило не может быть целью.',
  'already-connected': 'Эти узлы уже соединены — добавлять нечего.',
  'sub-rule-source': 'У правила SUB-RULE третье поле — имя подсписка из sub-rules, а не группы. Выберите подсписок в форме правила.',
  'flow-list': 'Список записан в одну строку (`[A, B]`). Такую строку правка сплайсом порвала бы — перепишите список в столбик, и кабель заработает.',
  'merged-list': 'Список участников пришёл через якорь (`<<: *anchor`) — правка задела бы все места, где этот якорь используется. Правьте его в тексте, у объявления якоря.',
  'no-proxies-key': 'У группы нет ключа `proxies` — структуру группы редактор не выдумывает. Добавьте ключ в тексте, дальше кабель сработает.',
  'unprintable-name': 'В имени узла есть перевод строки — вставить его одной строкой YAML нельзя.',
  'unprintable-rule': 'Строка правила не печатается в одну строку — правьте её в тексте.',
  'not-found': 'Узла или связи нет в документе.',
}

export function refusalText(refusal: MihomoRefusal): string {
  return REFUSAL_TEXT[refusal]
}
```

`connectMihomo` переписывается на возврат `MihomoEditResult`. Порядок проверок важен: от
самой общей к самой частной, иначе причина будет верной, но бесполезной.

```ts
export function connectMihomo(md: MihomoDoc, source: string, target: string): MihomoEditResult {
  if (!isValidMihomoConnection(source, target)) return { edits: [], refusal: 'invalid-pair' }
  const from = split(source)!
  const name = nameOf(target)

  if (from.kind === 'rule') {
    const index = Number(from.rest)
    const entry = rulesOf(md).find((r) => r.index === index)
    if (entry?.rule == null) return { edits: [], refusal: 'not-found' }
    // Тип правила известен только здесь, где документ на руках
    if (entry.rule.type === 'SUB-RULE') return { edits: [], refusal: 'sub-rule-source' }
    if (entry.rule.target === name) return { edits: [], refusal: 'already-connected' }
    if (isFlowNode(sectionNode(md, 'rules'))) return { edits: [], refusal: 'flow-list' }
    const edits = setRuleTarget(md, index, name)
    // setRuleTarget печатает СТРОКУ ЦЕЛИКОМ: отказать могло и из-за перевода
    // строки в цели, и из-за него же в значении правила — различить нечем, и
    // выдумывать различие вредно: пользователю нужно одно и то же действие
    return edits.length > 0 ? { edits } : { edits: [], refusal: 'unprintable-rule' }
  }

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined) return { edits: [], refusal: 'not-found' }
  if (group.proxies.includes(name)) return { edits: [], refusal: 'already-connected' }

  // «Ключа нет» и «ключ пришёл через слияние» — разные тупики с разным выходом,
  // и разводит их только fieldOrigin: сам proxiesPair видит лишь собственные ключи
  const origin = fieldOrigin(md, group.index, 'proxies')
  if (origin === 'merged') return { edits: [], refusal: 'merged-list' }
  const pair = proxiesPair(md, group.index)
  if (pair === undefined) return { edits: [], refusal: 'no-proxies-key' }
  const list = pair.value
  if (isSeq(list) && list.flow === true) return { edits: [], refusal: 'flow-list' }

  const printedName = scalar(name)
  if (printedName === null) return { edits: [], refusal: 'unprintable-name' }

  // Дальше — существующие две ветки вставки (список с элементами и пустой
  // список/ключ без значения) без изменений, кроме обёртки возврата в { edits }.
  …
}
```

`disconnectMihomo` — тем же способом: `'invalid-pair'` для источника-не-группы,
`'not-found'` для несуществующей группы и для имени, которого нет в списке,
`'flow-list'` для однострочного списка, иначе `{ edits: [правка удаления строки] }`.

Импорты дописать: `fieldOrigin` и `isFlowNode` из `../../mihomo/edits`
(`isFlowNode` там сейчас приватная — экспортировать её из `edits.ts`).

- [ ] **Step 4: Дописать раскладку графа по вертикали**

В `frontend/src/entities/graph/mihomo/buildGraph.ts` добавить в конец файла:

```ts
/**
 * Раскладка по вертикали. `buildMihomoGraph` расставляет узлы по колонкам (x),
 * а y оставляет нулевым: в какой колонке узел окажется, известно только после
 * обхода всех групп. Здесь колонки разбираются по порядку добавления и узлы в
 * каждой раскладываются столбиком.
 *
 * Порядок внутри колонки — это порядок появления узла в графе, то есть порядок
 * объявления сущности в документе. Сортировать по имени нельзя: пользователь
 * ищет группу там, где она стоит в его файле.
 */
export function layoutMihomo(nodes: FlowNode[]): FlowNode[] {
  const rows = new Map<number, number>()
  return nodes.map((node) => {
    const row = rows.get(node.position.x) ?? 0
    rows.set(node.position.x, row + 1)
    return { ...node, position: { x: node.position.x, y: row * MIHOMO_ROW_H } }
  })
}
```

Внимание: `buildMihomoGraph` уже ставит правилам `y: entry.index * MIHOMO_ROW_H`. После
`layoutMihomo` они получат те же значения (правила лежат в колонке `x: 0` подряд и в том же
порядке), так что раскладка не спорит с построением, а обобщает его. Ставить `y` в
`buildMihomoGraph` и дальше не нужно, но и убирать не обязательно — тест на порядок это
фиксирует.

- [ ] **Step 5: Перевести `walkScalars` на объект-опции**

В `frontend/src/entities/mihomo/edits.ts` два соседних булевых позиционных параметра
заменяются одним объектом. Перестановка `insideFlow` и `dnsOnly` местами сегодня не даёт
ни ошибки типов, ни красного теста, а на этой функции держится корректность переименования.

```ts
/** Режим обхода: оба флага взводятся при входе в поддерево и не гаснут */
interface WalkMode {
  insideFlow: boolean
  dnsOnly: boolean
}

function walkScalars(
  node: unknown,
  mode: WalkMode,
  skip: Set<unknown>,
  onScalar: (node: unknown, value: string, mode: WalkMode) => void,
): void {
  if (node === undefined || node === null || skip.has(node)) return
  if (isAlias(node)) return
  if (isScalar(node)) {
    const value = (node as { value?: unknown }).value
    if (typeof value === 'string') onScalar(node, value, mode)
    return
  }
  if (isSeq(node)) {
    const insideFlow = mode.insideFlow || isFlowNode(node)
    for (const item of node.items) walkScalars(item, { ...mode, insideFlow }, skip, onScalar)
    return
  }
  if (isMap(node)) {
    const insideFlow = mode.insideFlow || isFlowNode(node)
    for (const pair of node.items) {
      const key = (pair.key as { value?: unknown } | null)?.value
      if (typeof key === 'string' && EXCLUDED_REFERENCE_KEYS.has(key)) continue
      const dnsOnly = mode.dnsOnly || key === 'dns'
      walkScalars(pair.value, { insideFlow, dnsOnly }, skip, onScalar)
    }
  }
}

const WALK_ROOT: WalkMode = { insideFlow: false, dnsOnly: false }
```

Все три вызывающих места (`hasDanglingReference`, `hasDanglingRuleTarget`, основной проход в
`renameGroup`) переводятся на `WALK_ROOT` и на распаковку режима в колбэке
(`(node, value, mode) => … mode.dnsOnly …`). Комментарий над функцией сохраняется целиком —
он объясняет, почему обход именно такой, и это знание дороже самой функции.

- [ ] **Step 6: Прогнать тесты Mihomo и проверку типов**

Run: `cd frontend && npx vitest run test/mihomo-mutations.test.ts test/mihomo-graph.test.ts test/mihomo-edits.test.ts && cd .. && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/entities frontend/test
git commit -m "fix(frontend): mihomo connection refusals, graph layout, walk options"
```

---

### Task 5: Словарь Mihomo

Один словарь на весь редактор: из него берут поля формы инспектора (задача 10) и подсказки
YAML-вкладки (задача 11). В редакторе Xray словарь и формы намеренно разведены — там формы
редактируют вложенные структуры, а подсказки идут по сырому тексту. Здесь наоборот: почти
всё, что правит форма Mihomo, — плоская пара «ключ → скаляр» в отображении, и два описания
одного и того же разъезжались бы по первому же добавленному ключу.

**Files:**
- Create: `frontend/src/entities/mihomo/docSchema.ts`
- Modify: `frontend/src/entities/mihomo/index.ts` (реэкспорт)
- Test: `frontend/test/mihomo-doc-schema.test.ts` (создать)

**Interfaces:**
- Produces:
  ```ts
  export interface MihomoEnum { value: string; doc?: string }
  export interface MihomoField {
    key: string
    doc: string
    type: 'string' | 'number' | 'boolean' | 'strings'
    enum?: MihomoEnum[]
  }
  export type MihomoSectionName =
    | 'root' | 'proxy-group' | 'proxy-provider' | 'rule-provider'
    | 'dns' | 'tun' | 'sniffer' | 'profile'
  export interface MihomoSection { name: MihomoSectionName; title: string; fields: MihomoField[] }
  export const MIHOMO_SECTIONS: Record<MihomoSectionName, MihomoSection>
  export function fieldsOf(section: MihomoSectionName): MihomoField[]
  export function fieldOf(section: MihomoSectionName, key: string): MihomoField | undefined
  /** Секция, которой принадлежит ключ верхнего уровня: dns → 'dns', tun → 'tun', … */
  export function sectionForKey(key: string): MihomoSectionName | undefined
  ```

Источник значений — официальная документация ядра (wiki.metacubex.one) и руководство панели
`docs/guides/templates/mihomo.md`; ключи `remnawave.*` и `override.*` берутся из таблицы в
спеке дословно.

- [ ] **Step 1: Написать падающий тест словаря**

Создать `frontend/test/mihomo-doc-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  fieldOf,
  fieldsOf,
  MIHOMO_SECTIONS,
  sectionForKey,
} from '../src/entities/mihomo/docSchema'
import { mihomoFixture } from './helpers'
import { parseMihomo } from '../src/entities/mihomo'

describe('словарь Mihomo', () => {
  it('знает поля группы, включая ключи remnawave', () => {
    const keys = fieldsOf('proxy-group').map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'name', 'type', 'proxies', 'use', 'include-all', 'filter', 'exclude-filter',
        'url', 'interval', 'lazy', 'tolerance', 'hidden', 'icon',
        'remnawave.include-proxies', 'remnawave.select-random-proxy',
        'remnawave.shuffle-proxies-order',
      ]),
    )
  })

  it('тип группы — enum из пяти значений ядра', () => {
    expect(fieldOf('proxy-group', 'type')?.enum?.map((e) => e.value)).toEqual([
      'select', 'url-test', 'fallback', 'load-balance', 'relay',
    ])
  })

  it('знает поля провайдера, включая override', () => {
    const keys = fieldsOf('proxy-provider').map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'type', 'url', 'interval', 'remnawave.include-proxies',
        'override.dialer-proxy', 'override.additional-prefix',
      ]),
    )
  })

  it('behavior набора правил — enum, но значение остаётся строкой', () => {
    const field = fieldOf('rule-provider', 'behavior')
    expect(field?.type).toBe('string')
    expect(field?.enum?.map((e) => e.value)).toEqual(['domain', 'ipcidr', 'classical'])
  })

  it('у каждого поля есть русское описание — оно уходит и в форму, и в подсказку', () => {
    for (const section of Object.values(MIHOMO_SECTIONS)) {
      for (const field of section.fields) {
        expect(field.doc, `${section.name}.${field.key}`).not.toBe('')
      }
    }
  })

  it('секция ключа верхнего уровня определяется по имени', () => {
    expect(sectionForKey('dns')).toBe('dns')
    expect(sectionForKey('tun')).toBe('tun')
    expect(sectionForKey('sniffer')).toBe('sniffer')
    expect(sectionForKey('profile')).toBe('profile')
    expect(sectionForKey('mode')).toBeUndefined()
  })

  // Словарь обязан покрывать то, что реально встречается в живых шаблонах:
  // незнакомое поле в форме превращается в «правьте руками», и молча копить
  // такие поля нельзя
  it('покрывает ключи групп из всех трёх эталонных шаблонов', () => {
    const known = new Set(fieldsOf('proxy-group').map((f) => f.key))
    const unknown = new Set<string>()
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      const seq = md.doc.get('proxy-groups') as { items?: unknown[] } | undefined
      for (const item of seq?.items ?? []) {
        for (const pair of (item as { items?: { key?: { value?: unknown } }[] }).items ?? []) {
          const key = pair.key?.value
          if (typeof key === 'string' && key !== '<<' && !known.has(key) && !key.startsWith('remnawave')) {
            unknown.add(key)
          }
        }
      }
    }
    expect([...unknown]).toEqual([])
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/mihomo-doc-schema.test.ts`
Expected: FAIL — модуля `docSchema` нет.

- [ ] **Step 3: Написать словарь**

Создать `frontend/src/entities/mihomo/docSchema.ts`. Скелет и полный набор полей группы —
ниже; секции `proxy-provider`, `rule-provider`, `dns`, `tun`, `sniffer`, `profile`, `root`
заполняются тем же способом.

```ts
// Декларативное описание полей шаблона Mihomo: какие ключи допустимы в каждой
// секции, какие у них значения и что они значат по-русски. Один словарь питает
// и формы инспектора, и подсказки YAML-вкладки.
//
// В редакторе Xray словарь (entities/xray/docSchema.ts) намеренно отделён от
// форм: там формы правят вложенные структуры, а подсказки идут по сырому тексту
// всего конфига. Здесь наоборот — почти каждое поле формы Mihomo есть плоская
// пара «ключ → скаляр» в отображении, и два описания одного и того же
// разъехались бы на первом же добавленном ключе.
//
// Составные ключи вида `remnawave.include-proxies` и `override.dialer-proxy` —
// это путь через вложенное отображение, а не имя ключа с точкой. Разбирает их
// вызывающий (setFieldAt в edits.ts, задача 6).

export interface MihomoEnum {
  value: string
  doc?: string
}

export interface MihomoField {
  /** Ключ или путь через точку внутри секции */
  key: string
  /** Русское описание: подпись-подсказка в форме и tooltip подсказки в тексте */
  doc: string
  type: 'string' | 'number' | 'boolean' | 'strings'
  /**
   * Известные значения. Это ПОДСКАЗКА, а не ограничение: значение остаётся
   * строкой, и незнакомое значение чужого шаблона проходит насквозь — тот же
   * приём, что у `type` группы в groups.ts.
   */
  enum?: MihomoEnum[]
}

export type MihomoSectionName =
  | 'root'
  | 'proxy-group'
  | 'proxy-provider'
  | 'rule-provider'
  | 'dns'
  | 'tun'
  | 'sniffer'
  | 'profile'

export interface MihomoSection {
  name: MihomoSectionName
  /** Заголовок карточки инспектора */
  title: string
  fields: MihomoField[]
}

const GROUP_TYPES: MihomoEnum[] = [
  { value: 'select', doc: 'Выбор вручную из списка участников' },
  { value: 'url-test', doc: 'Автовыбор самого быстрого по проверке url' },
  { value: 'fallback', doc: 'Первый живой по порядку списка' },
  { value: 'load-balance', doc: 'Распределение соединений между участниками' },
  { value: 'relay', doc: 'Цепочка: трафик идёт через участников по очереди' },
]

const PROXY_GROUP_FIELDS: MihomoField[] = [
  { key: 'name', doc: 'Имя группы. На него ссылаются правила и другие группы.', type: 'string' },
  { key: 'type', doc: 'Как группа выбирает участника.', type: 'string', enum: GROUP_TYPES },
  { key: 'proxies', doc: 'Участники, перечисленные вручную: имена хостов, групп и встроенных целей.', type: 'strings' },
  { key: 'use', doc: 'Имена провайдеров (proxy-providers), чьи прокси входят в группу.', type: 'strings' },
  { key: 'include-all', doc: 'Взять все прокси и всех провайдеров сразу.', type: 'boolean' },
  { key: 'include-all-proxies', doc: 'Взять все прокси из корневого proxies.', type: 'boolean' },
  { key: 'include-all-providers', doc: 'Взять прокси всех объявленных провайдеров.', type: 'boolean' },
  { key: 'filter', doc: 'Регулярное выражение: в группу попадут только подходящие ИМЕНА ХОСТОВ.', type: 'string' },
  { key: 'exclude-filter', doc: 'Регулярное выражение: подходящие имена хостов из группы исключаются.', type: 'string' },
  { key: 'exclude-type', doc: 'Типы прокси, которые в группу не берутся, через |.', type: 'string' },
  { key: 'url', doc: 'Адрес проверки живости для url-test и fallback.', type: 'string' },
  { key: 'interval', doc: 'Период проверки живости в секундах.', type: 'number' },
  { key: 'lazy', doc: 'Не проверять, пока группа не используется.', type: 'boolean' },
  { key: 'tolerance', doc: 'Насколько миллисекунд новый лидер должен обгонять текущего, чтобы его сменить.', type: 'number' },
  { key: 'timeout', doc: 'Таймаут проверки живости в миллисекундах.', type: 'number' },
  { key: 'max-failed-times', doc: 'Сколько неудач подряд переводят участника в недоступные.', type: 'number' },
  { key: 'expected-status', doc: 'Коды ответа, считающиеся успехом проверки (например 204 или 200/204).', type: 'string' },
  { key: 'strategy', doc: 'Способ распределения у load-balance.', type: 'string', enum: [
    { value: 'consistent-hashing', doc: 'Один и тот же адрес всегда идёт через одного участника' },
    { value: 'round-robin', doc: 'По очереди' },
    { value: 'sticky-sessions', doc: 'Сессия закрепляется за участником' },
  ] },
  { key: 'disable-udp', doc: 'Не пускать через группу UDP.', type: 'boolean' },
  { key: 'hidden', doc: 'Не показывать группу в клиенте.', type: 'boolean' },
  { key: 'icon', doc: 'Адрес иконки группы для клиента.', type: 'string' },
  { key: 'default-selected', doc: 'Участник, выбранный по умолчанию у select.', type: 'string' },
  { key: 'empty-fallback', doc: 'Что делать, если участников не осталось.', type: 'string' },
  {
    key: 'remnawave.include-proxies',
    doc: 'Ключ панели. У ГРУППЫ значение false отменяет подстановку хостов: в группе останутся только перечисленные вручную. Значение true допустимо только у провайдера.',
    type: 'boolean',
  },
  {
    key: 'remnawave.select-random-proxy',
    doc: 'Ключ панели: положить в группу один случайный хост.',
    type: 'boolean',
  },
  {
    key: 'remnawave.shuffle-proxies-order',
    doc: 'Ключ панели: положить все хосты в случайном порядке.',
    type: 'boolean',
  },
]

export const MIHOMO_SECTIONS: Record<MihomoSectionName, MihomoSection> = {
  'proxy-group': { name: 'proxy-group', title: 'Группа', fields: PROXY_GROUP_FIELDS },
  // остальные секции — тем же способом:
  // proxy-provider: type (enum inline|http|file), url, path, interval, health-check.*,
  //   remnawave.include-proxies, override.dialer-proxy, override.additional-prefix
  // rule-provider: type, behavior (enum domain|ipcidr|classical), format (enum yaml|text|mrs),
  //   url, path, interval
  // dns: enable, listen, ipv6, enhanced-mode (enum fake-ip|redir-host), fake-ip-range,
  //   fake-ip-filter, default-nameserver, nameserver, fallback, proxy-server-nameserver,
  //   nameserver-policy, respect-rules
  // tun: enable, stack (enum system|gvisor|mixed), device, auto-route, auto-detect-interface,
  //   dns-hijack, strict-route, mtu
  // sniffer: enable, force-dns-mapping, parse-pure-ip, override-destination, sniff, skip-domain
  // profile: store-selected, store-fake-ip
  // root: mode (enum rule|global|direct), log-level (enum silent|error|warning|info|debug),
  //   ipv6, unified-delay, tcp-concurrent, mixed-port, socks-port, port, redir-port,
  //   tproxy-port, allow-lan, bind-address, external-controller, secret,
  //   global-client-fingerprint, find-process-mode, keep-alive-interval,
  //   remnawave.includeHiddenHosts
  root: { name: 'root', title: 'Общие настройки', fields: [] },
  'proxy-provider': { name: 'proxy-provider', title: 'Провайдер', fields: [] },
  'rule-provider': { name: 'rule-provider', title: 'Набор правил', fields: [] },
  dns: { name: 'dns', title: 'DNS', fields: [] },
  tun: { name: 'tun', title: 'TUN', fields: [] },
  sniffer: { name: 'sniffer', title: 'Снифер', fields: [] },
  profile: { name: 'profile', title: 'Профиль', fields: [] },
}

export function fieldsOf(section: MihomoSectionName): MihomoField[] {
  return MIHOMO_SECTIONS[section].fields
}

export function fieldOf(section: MihomoSectionName, key: string): MihomoField | undefined {
  return fieldsOf(section).find((f) => f.key === key)
}

const KEY_SECTIONS: Record<string, MihomoSectionName> = {
  dns: 'dns',
  tun: 'tun',
  sniffer: 'sniffer',
  profile: 'profile',
}

/** Секция, которой принадлежит ключ верхнего уровня; undefined — это скаляр корня */
export function sectionForKey(key: string): MihomoSectionName | undefined {
  return KEY_SECTIONS[key]
}
```

Пустые массивы в скелете выше — это **не заготовка к сдаче**: каждая секция заполняется
полями из комментария рядом с ней, с русским описанием у каждого поля. Тест «у каждого поля
есть описание» проходит по всем секциям и на пустом массиве вырождается в тавтологию,
поэтому дописать к нему проверку минимального размера:

```ts
  it('ни одна секция не осталась пустой', () => {
    for (const section of Object.values(MIHOMO_SECTIONS)) {
      expect(section.fields.length, section.name).toBeGreaterThan(1)
    }
  })
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd frontend && npx vitest run test/mihomo-doc-schema.test.ts`
Expected: PASS, 8 тестов. Если тест покрытия ключей групп нашёл незнакомый ключ — дописать
его в словарь с описанием, а не ослаблять тест.

- [ ] **Step 5: Реэкспорт и коммит**

Дописать в `frontend/src/entities/mihomo/index.ts`: `export * from './docSchema'`.

```bash
git add frontend/src/entities/mihomo frontend/test/mihomo-doc-schema.test.ts
git commit -m "feat(frontend): mihomo field dictionary for forms and completions"
```

### Task 6: Адресация — путь ↔ место, путь → узел, поиск

Три вещи, без которых адаптер Mihomo не соберётся: перевод пути диагностики в место в тексте
(и обратно), перевод пути в id узла графа со счётчиками проблем, и поиск узлов.

**Files:**
- Create: `frontend/src/entities/mihomo/locate.ts`
- Create: `frontend/src/entities/mihomo/search.ts`
- Create: `frontend/src/entities/graph/mihomo/locate.ts`
- Modify: `frontend/src/entities/graph/search.ts` (расширение союза `SearchHit['kind']`)
- Modify: `frontend/src/features/topology/SearchBox.tsx` (подписи новых видов)
- Modify: `frontend/src/entities/mihomo/index.ts` (реэкспорт)
- Test: `frontend/test/mihomo-locate.test.ts` (создать)

**Interfaces:**
- Consumes: `MihomoDoc`, `rangeOf`, `Range` из `entities/mihomo/parse`; `groupsOf`,
  `providersOf`, `ruleProvidersOf` из `groups`; `rulesOf` из `rules`.
- Produces:
  - `locateMihomo(md: MihomoDoc, parts: PathParts): Range | null`
  - `pathAt(md: MihomoDoc, offset: number): PathParts`
  - `searchMihomo(md: MihomoDoc, query: string): SearchHit[]`
  - `mihomoNodeIdForPath(parts: PathParts, md: MihomoDoc): string | null`
  - `mihomoIssueCounts(issues: ValidationIssue[], md: MihomoDoc): Record<string, IssueCount>`

**Расширение `SearchHit['kind']`.** Союз пополняется четырьмя членами:
`'mihomo-group' | 'mihomo-rule' | 'mihomo-provider' | 'mihomo-hosts'`. Это единственная
правка общего файла в плане, затрагивающая Xray, и она безопасна: существующие члены и их
использования не трогаются, а `KIND_LABEL` в `SearchBox` — исчерпывающая карта по союзу, и
`tsc` сам потребует дописать четыре подписи («группа», «правило», «провайдер», «подстановка»).
Тесты Xray на это не смотрят.

- [ ] **Step 1: Написать падающий тест адресации**

Создать `frontend/test/mihomo-locate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { locateMihomo, pathAt } from '../src/entities/mihomo/locate'
import { searchMihomo } from '../src/entities/mihomo/search'
import {
  mihomoIssueCounts,
  mihomoNodeIdForPath,
} from '../src/entities/graph/mihomo/locate'
import { validateMihomo } from '../src/entities/mihomo/validate'
import { mihomoFixture } from './helpers'

const DOC = [
  'proxy-groups:',
  '  - name: Основная',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'proxy-providers:',
  '  main:',
  '    type: inline',
  'rules:',
  '  - MATCH,Основная',
  '',
].join('\n')

describe('адресация Mihomo', () => {
  it('путь ведёт к месту в тексте', () => {
    const md = parseMihomo(DOC)
    const range = locateMihomo(md, ['proxy-groups', 0, 'type'])
    expect(range).not.toBeNull()
    expect(DOC.slice(range!.from, range!.to)).toBe('select')
  })

  it('оборвавшийся путь отдаёт глубочайшего найденного предка', () => {
    const md = parseMihomo(DOC)
    const range = locateMihomo(md, ['proxy-groups', 0, 'нет-такого-ключа'])
    expect(DOC.slice(range!.from, range!.to)).toMatch(/^name: Основная/)
  })

  it('ненайденный первый сегмент — null, а не весь документ', () => {
    const md = parseMihomo(DOC)
    expect(locateMihomo(md, ['несуществующая-секция'])).toBeNull()
    expect(locateMihomo(md, [])).toBeNull()
  })

  it('смещение в тексте ведёт к пути', () => {
    const md = parseMihomo(DOC)
    expect(pathAt(md, DOC.indexOf('select'))).toEqual(['proxy-groups', 0, 'type'])
    expect(pathAt(md, DOC.indexOf('inline'))).toEqual(['proxy-providers', 'main', 'type'])
  })

  it('путь и смещение — обратные операции на всех трёх эталонных шаблонах', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      const range = locateMihomo(md, ['proxy-groups', 0, 'name'])
      if (range === null) continue
      expect(pathAt(md, range.from), name).toEqual(['proxy-groups', 0, 'name'])
    }
  })

  it('путь диагностики ведёт к узлу графа', () => {
    const md = parseMihomo(DOC)
    expect(mihomoNodeIdForPath(['proxy-groups', 0, 'type'], md)).toBe('group:Основная')
    expect(mihomoNodeIdForPath(['rules', 0], md)).toBe('rule:0')
    expect(mihomoNodeIdForPath(['proxy-providers', 'main'], md)).toBe('provider:main')
    expect(mihomoNodeIdForPath(['rule-providers', 'нет'], md)).toBeNull()
  })

  it('счётчики проблем садятся на узлы', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    type: select', 'rules:', '  - MATCH,Нет', ''].join('\n'),
    )
    const counts = mihomoIssueCounts(validateMihomo(md), md)
    expect(counts['rule:0']?.warnings).toBeGreaterThan(0)
  })

  it('поиск находит группы, правила и провайдеров и объясняет совпадение', () => {
    const md = parseMihomo(DOC)
    const hits = searchMihomo(md, 'основ')
    expect(hits.map((h) => h.nodeId)).toContain('group:Основная')
    expect(hits.find((h) => h.nodeId === 'group:Основная')?.matchedOn).toBe('имя')
    expect(searchMihomo(md, 'main').map((h) => h.nodeId)).toContain('provider:main')
    expect(searchMihomo(md, 'MATCH').map((h) => h.nodeId)).toContain('rule:0')
    expect(searchMihomo(md, '')).toEqual([])
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd frontend && npx vitest run test/mihomo-locate.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Написать `entities/mihomo/locate.ts`**

```ts
// Путь диагностики ↔ место в тексте. У Xray обе задачи решаются обходом дерева
// CodeMirror (features/editor/jsonLocate.ts и intellisense/context.ts) и стоят
// двух разных обходов. Здесь дешевле: разобранный документ библиотеки `yaml`
// уже несёт диапазоны у каждого узла, и дерево CodeMirror не нужно вовсе —
// заодно снимается вся история с отстающим снимком syntaxTree.

import { isMap, isSeq } from 'yaml'
import type { PathParts } from '../xray/config'
import { rangeOf, type MihomoDoc, type Range } from './parse'

/** Значение ключа отображения по СОБСТВЕННОМУ ключу (слияния не разворачиваем:
 *  место в тексте у слитого значения чужое — оно у объявления якоря) */
function child(node: unknown, part: string | number): unknown {
  if (typeof part === 'number') return isSeq(node) ? node.items[part] : undefined
  if (!isMap(node)) return undefined
  return node.items.find((p) => (p.key as { value?: unknown } | null)?.value === part)?.value
}

/**
 * Место пути в тексте. Путь оборвался на середине — отдаём диапазон
 * глубочайшего найденного предка: у диагностики уровня группы своего ключа
 * может и не быть. Не нашёлся даже первый сегмент — null: подсветить весь
 * документ хуже, чем не подсвечивать ничего (то же решение, что в jsonLocate).
 */
export function locateMihomo(md: MihomoDoc, parts: PathParts): Range | null {
  if (parts.length === 0) return null
  let node: unknown = md.doc.contents
  let deepest: Range | null = null
  for (const part of parts) {
    const next = child(node, part)
    if (next === undefined || next === null) break
    node = next
    // Диапазон запоминаем на каждом шаге: у последнего узла его может не быть
    // (алиас без разрешения), и тогда лучше показать предка, чем ничего
    deepest = rangeOf(node) ?? deepest
  }
  return deepest
}

/** Диапазон пары «ключ: значение» — от начала ключа до конца значения */
function pairRange(pair: { key?: unknown; value?: unknown }): Range | null {
  const key = rangeOf(pair.key)
  const value = rangeOf(pair.value)
  if (key === null) return null
  return { from: key.from, to: value?.to ?? key.to }
}

function covers(range: Range | null, offset: number): boolean {
  return range !== null && offset >= range.from && offset <= range.to
}

/**
 * Путь до узла, в котором стоит смещение. Спуск идёт по диапазонам: узел, чей
 * диапазон накрывает смещение, и есть следующий сегмент. Смещение в «пустом»
 * месте (пробел, начало недописанной строки) не накрывается ничем — тогда
 * возвращается путь до ближайшего охватывающего отображения, и это ровно то,
 * что нужно подсказкам: «какие ключи допустимы ЗДЕСЬ».
 */
export function pathAt(md: MihomoDoc, offset: number): PathParts {
  const parts: PathParts = []
  let node: unknown = md.doc.contents
  for (;;) {
    if (isMap(node)) {
      const pair = node.items.find((p) => covers(pairRange(p), offset))
      const key = (pair?.key as { value?: unknown } | null)?.value
      if (pair === undefined || typeof key !== 'string') return parts
      parts.push(key)
      node = pair.value
      continue
    }
    if (isSeq(node)) {
      const index = node.items.findIndex((item) => covers(rangeOf(item), offset))
      if (index === -1) return parts
      parts.push(index)
      node = node.items[index]
      continue
    }
    return parts
  }
}
```

- [ ] **Step 4: Написать `entities/graph/mihomo/locate.ts`**

```ts
// Соответствие «путь диагностики → узел графа». Живёт в entities/graph/mihomo,
// потому что схему id (`group:<name>`, `rule:<index>`, `provider:<name>`,
// `hosts:<owner>`, `builtin:<name>`) задаёт buildMihomoGraph.

import { groupsOf, providersOf } from '../../mihomo/groups'
import type { MihomoDoc } from '../../mihomo/parse'
import { rulesOf } from '../../mihomo/rules'
import type { PathParts, ValidationIssue } from '../../xray/config'
import type { IssueCount } from '../types'

export function mihomoNodeIdForPath(parts: PathParts, md: MihomoDoc): string | null {
  const [head, second] = parts

  if (head === 'rules' && typeof second === 'number') {
    return rulesOf(md).some((r) => r.index === second) ? `rule:${second}` : null
  }

  if (head === 'proxy-groups') {
    // Диагностика уровня всей секции (кольцо групп) узла не имеет: показать её
    // на первой попавшейся группе значило бы соврать про место проблемы
    if (typeof second !== 'number') return null
    const name = groupsOf(md).find((g) => g.index === second)?.name
    return name === undefined ? null : `group:${name}`
  }

  if (head === 'proxy-providers' && typeof second === 'string') {
    return providersOf(md).some((p) => p.name === second) ? `provider:${second}` : null
  }

  // rule-providers узлами не рисуются — это словарь, а не маршрут (см. спеку)
  return null
}

export function mihomoIssueCounts(
  issues: ValidationIssue[],
  md: MihomoDoc,
): Record<string, IssueCount> {
  const counts: Record<string, IssueCount> = {}
  for (const issue of issues) {
    const id = mihomoNodeIdForPath(issue.parts, md)
    if (!id) continue
    const cur = (counts[id] ??= { errors: 0, warnings: 0 })
    if (issue.level === 'error') cur.errors += 1
    else cur.warnings += 1
  }
  return counts
}
```

- [ ] **Step 5: Написать `entities/mihomo/search.ts`**

Повторяет форму `entities/graph/search.ts`: тот же лимит, та же идея «показываем одну
причину совпадения».

```ts
// Поиск узлов графа Mihomo по строке. Ищем по тому, что человек видит на
// карточке: имя группы, тип, участники; имя и тип провайдера; текст правила.

import { groupsOf, providersOf } from './groups'
import type { MihomoDoc } from './parse'
import { rulesOf } from './rules'
import type { SearchHit } from '../graph/search'

const LIMIT = 20

function firstMatch(
  needle: string,
  fields: { label: string; value: string | string[] | undefined }[],
): string | undefined {
  for (const { label, value } of fields) {
    const text = Array.isArray(value) ? value.join(' ') : (value ?? '')
    if (text.toLowerCase().includes(needle)) return label
  }
  return undefined
}

export function searchMihomo(md: MihomoDoc, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const hits: SearchHit[] = []
  const push = (hit: SearchHit) => {
    if (hits.length < LIMIT) hits.push(hit)
  }

  for (const group of groupsOf(md)) {
    const matchedOn = firstMatch(needle, [
      { label: 'имя', value: group.name },
      { label: 'тип', value: group.type },
      { label: 'участник', value: group.proxies },
      { label: 'провайдер', value: group.use },
      { label: 'фильтр', value: group.filter },
    ])
    if (matchedOn) {
      push({ nodeId: `group:${group.name}`, kind: 'mihomo-group', title: group.name, matchedOn })
    }
  }

  for (const provider of providersOf(md)) {
    const matchedOn = firstMatch(needle, [
      { label: 'имя', value: provider.name },
      { label: 'тип', value: provider.type },
      { label: 'цепочка', value: provider.dialerProxy },
    ])
    if (matchedOn) {
      push({
        nodeId: `provider:${provider.name}`,
        kind: 'mihomo-provider',
        title: provider.name,
        matchedOn,
      })
    }
  }

  for (const entry of rulesOf(md)) {
    const rule = entry.rule
    const matchedOn = firstMatch(needle, [
      { label: 'тип', value: rule?.type },
      { label: 'значение', value: rule?.payload },
      { label: 'цель', value: rule?.target },
      { label: 'текст', value: entry.raw },
    ])
    if (matchedOn) {
      push({
        nodeId: `rule:${entry.index}`,
        kind: 'mihomo-rule',
        title: rule === null ? entry.raw : `${rule.type},${rule.payload ?? ''}`.replace(/,$/, ''),
        matchedOn,
      })
    }
  }

  return hits
}
```

- [ ] **Step 6: Расширить союз видов и подписи**

В `frontend/src/entities/graph/search.ts` дописать в союз `SearchHit['kind']` четыре члена:
`'mihomo-group' | 'mihomo-rule' | 'mihomo-provider' | 'mihomo-hosts'`. В
`frontend/src/features/topology/SearchBox.tsx` дописать в `KIND_LABEL` подписи: «группа»,
«правило», «провайдер», «подстановка». Компилятор потребует этого сам — карта исчерпывающая
по союзу.

- [ ] **Step 7: Прогнать тесты и типы**

Run: `cd frontend && npx vitest run test/mihomo-locate.test.ts && cd .. && npm test -w frontend && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src frontend/test/mihomo-locate.test.ts
git commit -m "feat(frontend): mihomo path/offset addressing, node ids and search"
```

---

### Task 7: Обобщённые правки документа

`edits.ts` умеет менять поле группы, переименовывать группу и работать с правилами. Формам
инспектора нужно больше: править поле любой секции (в том числе вложенный ключ вроде
`remnawave.include-proxies`), снимать поле, заводить и удалять группу, переставлять правило.

**Files:**
- Create: `frontend/src/entities/mihomo/merge.ts` (общий обход `<<`, сегодня в двух копиях)
- Modify: `frontend/src/entities/mihomo/edits.ts`
- Modify: `frontend/src/entities/mihomo/groups.ts` (переход на общий обход)
- Test: `frontend/test/mihomo-edits-fields.test.ts` (создать)

**Interfaces:**
- Produces:
  - `setFieldAt(md: MihomoDoc, parts: PathParts, key: string, value: string | boolean | number): TextEdit[]`
    — `parts` адресует ОТОБРАЖЕНИЕ, `key` — ключ или путь через точку внутри него.
  - `removeFieldAt(md: MihomoDoc, parts: PathParts, key: string): TextEdit[]`
  - `originAt(md: MihomoDoc, parts: PathParts, key: string): FieldOrigin`
  - `readFieldAt(md: MihomoDoc, parts: PathParts, key: string): { value: string | number | boolean | string[] | undefined; origin: FieldOrigin }`
    — чтение с учётом слияний, тем же спуском по составному ключу, что и запись. Формы
    инспектора (задача 10) читают ТОЛЬКО отсюда: отдельный читатель разошёлся бы с
    писателем в трактовке якорей, а это ровно то место, где нельзя ошибиться.
  - `setListAt(md: MihomoDoc, parts: PathParts, key: string, values: string[]): TextEdit[]`
    — замена блочного списка целиком. Отказ (`[]`) на flow-стиле, на значении из слияния и
    на элементе, который не печатается одной строкой.
  - `replaceRuleText(md: MihomoDoc, index: number, raw: string): TextEdit[]` — пересборка
    всей строки правила через сериализатор (та же арифметика, что у `setRuleTarget`).
    `raw`, который не разбирается `parseRule`, даёт отказ: форма не имеет права записать в
    документ то, что сама не читает.
  - `addGroup(md: MihomoDoc, name: string): TextEdit[]`
  - `removeGroup(md: MihomoDoc, index: number): TextEdit[]`
  - `moveMihomoRule(md: MihomoDoc, index: number, dir: -1 | 1): TextEdit[]`
- Consumes: существующие `scalar`, `applyEdits`, `detectIndentStep`, `fieldOrigin`, `rangeOf`.

**Решение: `setGroupField` и `fieldOrigin` становятся тонкими обёртками** над `setFieldAt` и
`originAt` с `parts = ['proxy-groups', index]`. Обёртки сохраняются, потому что на них
завязаны тесты плана 1 (`mihomo-edits.test.ts`) и `mutations.ts`, а их сигнатуры проще для
частого случая. Одной реализации при этом остаётся одна — иначе поведение на якорях
разъедется между «полем группы» и «полем секции», а это ровно тот класс дефекта, ради
которого выбрана вся архитектура.

**Правило вложенного ключа.** `key` вида `remnawave.include-proxies` означает путь: сначала
отображение `remnawave`, потом ключ в нём. Если промежуточного отображения нет, правка
**отказывает** (`[]`), а не создаёт его: вставка вложенного блока в чужой файл — это уже
структурное изменение, и форма вместо кнопки-переключателя покажет подсказку «добавьте
секцию `remnawave` в тексте». Заводить недостающую секцию будет отдельная кнопка, если
задача 10 покажет, что без неё форма беспомощна; авансом не делаем.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/mihomo-edits-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import {
  addGroup,
  applyEdits,
  moveMihomoRule,
  originAt,
  readFieldAt,
  removeFieldAt,
  removeGroup,
  replaceRuleText,
  setFieldAt,
  setListAt,
} from '../src/entities/mihomo/edits'
import { groupsOf } from '../src/entities/mihomo/groups'
import { rulesOf } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

const DOC = [
  'dns:',
  '  enable: true',
  '  enhanced-mode: fake-ip',
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    remnawave:',
  '      include-proxies: false',
  '  - name: B',
  '    type: url-test',
  'rules:',
  '  - DOMAIN,a.com,A',
  '  - MATCH,B',
  '',
].join('\n')

describe('правки полей секций', () => {
  it('меняет скаляр секции верхнего уровня', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, setFieldAt(md, ['dns'], 'enhanced-mode', 'redir-host'))
    expect(next).toContain('enhanced-mode: redir-host')
    expect(next).toContain('enable: true')
  })

  it('меняет вложенный ключ через точку', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, setFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies', true))
    expect(next).toContain('include-proxies: true')
  })

  it('отказывает, когда промежуточной секции нет: структуру не выдумываем', () => {
    const md = parseMihomo(DOC)
    expect(setFieldAt(md, ['proxy-groups', 1], 'remnawave.include-proxies', true)).toEqual([])
  })

  it('снимает поле вместе со строкой', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, removeFieldAt(md, ['proxy-groups', 1], 'type'))
    expect(next).not.toContain('url-test')
    expect(next).toContain('- name: B')
  })

  it('значение из якоря правкой не трогается', () => {
    const text = [
      'x-anchors:',
      '  base: &base',
      '    type: select',
      'proxy-groups:',
      '  - name: A',
      '    <<: *base',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    expect(originAt(md, ['proxy-groups', 0], 'type')).toBe('merged')
    expect(setFieldAt(md, ['proxy-groups', 0], 'type', 'fallback')).toEqual([])
  })

  it('заводит группу в конец секции', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, addGroup(md, 'Новая'))
    const groups = groupsOf(parseMihomo(next))
    expect(groups.map((g) => g.name)).toEqual(['A', 'B', 'Новая'])
    expect(groups[2]!.type).toBe('select')
  })

  it('удаляет группу целиком, не задев соседей', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, removeGroup(md, 0))
    expect(groupsOf(parseMihomo(next)).map((g) => g.name)).toEqual(['B'])
    expect(next).toContain('enhanced-mode: fake-ip')
  })

  it('чтение поля видит и собственный ключ, и пришедший через слияние', () => {
    const md = parseMihomo(DOC)
    expect(readFieldAt(md, ['proxy-groups', 0], 'type')).toEqual({ value: 'select', origin: 'own' })
    expect(readFieldAt(md, ['proxy-groups', 0], 'remnawave.include-proxies').value).toBe(false)
    expect(readFieldAt(md, ['dns'], 'нет-такого').origin).toBe('absent')
  })

  it('замена списка сохраняет отступ и не трогает соседние ключи', () => {
    const text = [
      'proxy-groups:',
      '  - name: A',
      '    proxies:',
      '      - DIRECT',
      '    type: select',
      '',
    ].join('\n')
    const md = parseMihomo(text)
    const next = applyEdits(text, setListAt(md, ['proxy-groups', 0], 'proxies', ['REJECT', 'B']))
    expect(next).toContain('      - REJECT\n      - B\n')
    expect(next).toContain('    type: select')
  })

  it('замена строки правила проходит через сериализатор', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, replaceRuleText(md, 0, 'DOMAIN-KEYWORD,a.com,B'))
    expect(rulesOf(parseMihomo(next))[0]!.rule?.type).toBe('DOMAIN-KEYWORD')
    // Неразбираемый вход — отказ, а не запись мусора в документ
    expect(replaceRuleText(md, 0, 'СОВСЕМ-НЕ-ПРАВИЛО')).toEqual([])
  })

  it('переставляет правило, сохраняя его текст', () => {
    const md = parseMihomo(DOC)
    const next = applyEdits(DOC, moveMihomoRule(md, 0, 1))
    expect(rulesOf(parseMihomo(next)).map((r) => r.raw)).toEqual(['MATCH,B', 'DOMAIN,a.com,A'])
  })

  it('перестановка за границы списка ничего не меняет', () => {
    const md = parseMihomo(DOC)
    expect(moveMihomoRule(md, 0, -1)).toEqual([])
    expect(moveMihomoRule(md, 1, 1)).toEqual([])
  })

  it('на эталонных шаблонах правка поля не трогает байты вне своего диапазона', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const text = mihomoFixture(name)
      const md = parseMihomo(text)
      const group = groupsOf(md)[0]
      if (group === undefined || group.type === undefined) continue
      const edits = setFieldAt(md, ['proxy-groups', group.index], 'type', 'fallback')
      if (edits.length === 0) continue
      const next = applyEdits(text, edits)
      const edit = edits[0]!
      expect(next.slice(0, edit.from), name).toBe(text.slice(0, edit.from))
      expect(next.slice(next.length - (text.length - edit.to)), name).toBe(text.slice(edit.to))
    }
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/mihomo-edits-fields.test.ts`
Expected: FAIL — `setFieldAt` не экспортируется.

- [ ] **Step 3: Обобщить правку поля**

В `frontend/src/entities/mihomo/edits.ts`:

```ts
/** Отображение по пути; undefined — путь не ведёт к отображению */
function mapAt(md: MihomoDoc, parts: PathParts): unknown {
  let node: unknown = md.doc.contents
  for (const part of parts) {
    if (typeof part === 'number') {
      if (!isSeq(node)) return undefined
      node = node.items[part]
      continue
    }
    if (!isMap(node)) return undefined
    node = node.items.find((p) => (p.key as { value?: unknown } | null)?.value === part)?.value
  }
  return isMap(node) ? node : undefined
}

/**
 * Спуск по составному ключу (`remnawave.include-proxies`) до отображения, в
 * котором лежит последний сегмент. Промежуточного отображения нет — undefined:
 * заводить вложенный блок в чужом файле правка не имеет права, это структурное
 * изменение, а не смена значения.
 */
function ownerOf(md: MihomoDoc, map: unknown, key: string): { map: unknown; leaf: string } | undefined {
  const segments = key.split('.')
  const leaf = segments.pop()!
  let node = map
  for (const segment of segments) {
    if (!isMap(node)) return undefined
    node = node.items.find((p) => (p.key as { value?: unknown } | null)?.value === segment)?.value
    node = dealias(md, node)
  }
  return isMap(node) ? { map: node, leaf } : undefined
}

export function originAt(md: MihomoDoc, parts: PathParts, key: string): FieldOrigin {
  const owner = ownerOf(md, mapAt(md, parts), key)
  if (owner === undefined) return 'absent'
  if (ownPair(owner.map, owner.leaf) !== undefined) return 'own'
  return mergedHas(md, owner.map, owner.leaf) ? 'merged' : 'absent'
}

export function setFieldAt(
  md: MihomoDoc,
  parts: PathParts,
  key: string,
  value: string | boolean | number,
): TextEdit[] {
  // Значение из якоря правкой не трогаем: форма показывает такое поле только
  // для чтения — изменение задело бы все места, где используется якорь
  if (originAt(md, parts, key) === 'merged') return []
  const owner = ownerOf(md, mapAt(md, parts), key)
  if (owner === undefined) return []
  // Дальше — та же арифметика, что уже работает в setGroupField: ветка «свой
  // ключ» заменяет диапазон значения через scalar(), ветка «ключа нет»
  // дописывает строку с отступом; отказ на flow-стиле и на многострочной
  // печати сохраняется дословно.
  …
}

export function removeFieldAt(md: MihomoDoc, parts: PathParts, key: string): TextEdit[] {
  if (originAt(md, parts, key) !== 'own') return []
  const owner = ownerOf(md, mapAt(md, parts), key)!
  if (isFlowNode(owner.map)) return []
  const pair = ownPair(owner.map, owner.leaf)!
  const range = pairRangeOf(pair)
  if (range === null) return []
  // Удаление ключа забирает его строки целиком — иначе останется висящий отступ
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', range.to)
  return [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }]
}
```

`scalar()` расширяется до `string | boolean | number` — числовые поля (`interval`,
`tolerance`, `mtu`) идут тем же путём, и отдельная печать чисел породила бы вторую точку,
где можно забыть про однострочность.

`setGroupField(md, groupIndex, key, value)` становится
`setFieldAt(md, ['proxy-groups', groupIndex], key, value)`, а
`fieldOrigin(md, groupIndex, key)` — `originAt(md, ['proxy-groups', groupIndex], key)`.
Тела старых реализаций удаляются: две копии арифметики отступов разъедутся.

- [ ] **Step 4: Дописать операции над группой и порядком правил**

```ts
/**
 * Новая группа в конец `proxy-groups`. Тип `select` и пустой список участников —
 * минимум, который ядро примет и который сразу виден в графе. Маркер подстановки
 * НЕ ставим: где панель подставляет хосты, решает автор шаблона, а угаданный
 * маркер молча изменил бы состав подписки.
 */
export function addGroup(md: MihomoDoc, name: string): TextEdit[] {
  const section = sectionNode(md, 'proxy-groups')
  if (!isSeq(section) || isFlowNode(section)) return []
  const printed = scalar(name)
  if (printed === null) return []
  const step = detectIndentStep(md.text)
  const last = section.items[section.items.length - 1]
  const lastRange = rangeOf(last)
  if (lastRange !== null) {
    // Есть соседи — берём их отступ и вставляем после последней строки элемента.
    // Отступ считаем до дефиса и заменяем его пробелами, как в indentOf: колонка
    // ключа, а не колонка дефиса
    const lineStart = md.text.lastIndexOf('\n', lastRange.from - 1) + 1
    const indent = md.text.slice(lineStart, lastRange.from).replace(/-\s*$/, '')
    const lineEnd = md.text.indexOf('\n', lastRange.to)
    const at = lineEnd === -1 ? md.text.length : lineEnd + 1
    // Без завершающего перевода строки в исходнике точка вставки — конец
    // последней НЕЗАВЕРШЁННОЙ строки: свой `\n` обязателен (находка C1 плана 1)
    const lead = at > 0 && md.text[at - 1] !== '\n' ? '\n' : ''
    return [
      {
        from: at,
        to: at,
        insert: `${lead}${indent}- name: ${printed}\n${indent}  type: select\n${indent}  proxies: []\n`,
      },
    ]
  }
  // Секция пуста (`proxy-groups:` без элементов) — якоря-соседа нет, отступ
  // считаем от строки самого ключа плюс шаг вложенности документа
  const keyPair = (md.doc.contents as { items?: { key?: unknown; value?: unknown }[] }).items?.find(
    (p) => (p.key as { value?: unknown } | null)?.value === 'proxy-groups',
  )
  const keyRange = rangeOf(keyPair?.key)
  if (keyRange === null || keyRange === undefined) return []
  const keyLineStart = md.text.lastIndexOf('\n', keyRange.from - 1) + 1
  const indent = md.text.slice(keyLineStart, keyRange.from) + ' '.repeat(step)
  const lineEnd = md.text.indexOf('\n', keyRange.from)
  const at = lineEnd === -1 ? md.text.length : lineEnd + 1
  const lead = at > 0 && md.text[at - 1] !== '\n' ? '\n' : ''
  return [
    {
      from: at,
      to: at,
      insert: `${lead}${indent}- name: ${printed}\n${indent}  type: select\n${indent}  proxies: []\n`,
    },
  ]
}

/** Удаление группы забирает все её строки: от начала строки с дефисом до начала следующего элемента */
export function removeGroup(md: MihomoDoc, index: number): TextEdit[] {
  const section = sectionNode(md, 'proxy-groups')
  if (!isSeq(section) || isFlowNode(section)) return []
  const item = section.items[index]
  const range = rangeOf(item)
  if (range === null) return []
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const nextRange = rangeOf(section.items[index + 1])
  const to =
    nextRange === null
      ? (() => {
          const lineEnd = md.text.indexOf('\n', range.to)
          return lineEnd === -1 ? md.text.length : lineEnd + 1
        })()
      : md.text.lastIndexOf('\n', nextRange.from - 1) + 1
  return [{ from: lineStart, to, insert: '' }]
}

/**
 * Перестановка правила: две правки, меняющие местами ТЕКСТ строк. Именно текст,
 * а не разобранное правило: строка могла быть в кавычках, с комментарием на
 * конце или заданной алиасом — пересборка из полей потеряла бы это молча.
 */
export function moveMihomoRule(md: MihomoDoc, index: number, dir: -1 | 1): TextEdit[] {
  if (isFlowNode(sectionNode(md, 'rules'))) return []
  const rules = rulesOf(md)
  const from = rules.find((r) => r.index === index)
  const to = rules.find((r) => r.index === index + dir)
  if (from === undefined || to === undefined) return []
  return [
    { from: from.range.from, to: from.range.to, insert: md.text.slice(to.range.from, to.range.to) },
    { from: to.range.from, to: to.range.to, insert: md.text.slice(from.range.from, from.range.to) },
  ]
}
```

Чтение, замена списка и пересборка строки правила — там же:

```ts
/**
 * Значение поля вместе с происхождением. Формы читают ТОЛЬКО отсюда: отдельный
 * читатель разошёлся бы с писателем в трактовке якорей — а это ровно то место,
 * где расхождение стоит порчи чужого файла.
 */
export function readFieldAt(
  md: MihomoDoc,
  parts: PathParts,
  key: string,
): { value: string | number | boolean | string[] | undefined; origin: FieldOrigin } {
  const origin = originAt(md, parts, key)
  if (origin === 'absent') return { value: undefined, origin }
  const owner = ownerOf(md, mapAt(md, parts), key)
  if (owner === undefined) return { value: undefined, origin: 'absent' }
  // Через слияние значение лежит у якоря — читаем его тем же обходом `<<`,
  // которым groups.ts читает behavior и type в живых шаблонах
  const node = dealias(md, mergedNode(md, owner.map, owner.leaf))
  if (isSeq(node)) {
    const json = node.toJSON()
    return {
      value: Array.isArray(json) ? json.filter((v): v is string => typeof v === 'string') : [],
      origin,
    }
  }
  if (!isScalar(node)) return { value: undefined, origin }
  const value = node.value
  return {
    value:
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : undefined,
    origin,
  }
}

/**
 * Замена блочного списка целиком. Диапазон списка заменяется напечатанными
 * строками с тем же отступом, что был у первого элемента (а если элементов не
 * было — отступ ключа плюс шаг вложенности документа).
 */
export function setListAt(
  md: MihomoDoc,
  parts: PathParts,
  key: string,
  values: string[],
): TextEdit[] {
  if (originAt(md, parts, key) !== 'own') return []
  const owner = ownerOf(md, mapAt(md, parts), key)!
  const pair = ownPair(owner.map, key.split('.').pop()!)!
  const list = pair.value
  // Список в одну строку держит ключ и элементы одной физической строкой —
  // построчная арифметика ниже его порвёт (решение А, как в connectMihomo)
  if (isSeq(list) && list.flow === true) return []
  const printed = values.map((v) => scalar(v))
  // Хоть один элемент не печатается одной строкой — отказ целиком, а не
  // частичная запись: половина списка хуже, чем несделанная правка
  if (printed.some((p) => p === null)) return []

  const listRange = rangeOf(list)
  const first = isSeq(list) ? list.items[0] : undefined
  const firstRange = rangeOf(first)
  // Отступ элементов: у существующего первого элемента — его собственный,
  // у пустого списка — отступ ключа плюс шаг вложенности документа
  const keyRange = rangeOf(pair.key as unknown)
  if (keyRange === null) return []
  const indent =
    firstRange === null
      ? md.text.slice(md.text.lastIndexOf('\n', keyRange.from - 1) + 1, keyRange.from) +
        ' '.repeat(detectIndentStep(md.text))
      : md.text
          .slice(md.text.lastIndexOf('\n', firstRange.from - 1) + 1, firstRange.from)
          .replace(/-\s*$/, '')
  const block = printed.map((p) => `${indent}- ${p}\n`).join('')

  // Пустой список записан на строке ключа (`proxies: []` или `proxies:` с
  // комментарием-маркером) — заменять его диапазон нельзя, там же может стоять
  // маркер подстановки; дописываем блок ПОСЛЕ строки ключа
  if (listRange === null || firstRange === null) {
    const lineEnd = md.text.indexOf('\n', keyRange.from)
    const at = lineEnd === -1 ? md.text.length : lineEnd + 1
    const lead = at > 0 && md.text[at - 1] !== '\n' ? '\n' : ''
    // `[]` на строке ключа осталось бы пустым flow-списком рядом с блочным —
    // такой документ ядро не примет, поэтому пустой flow-список это случай отказа
    if (isSeq(list) && list.flow === true) return []
    return [{ from: at, to: at, insert: lead + block }]
  }

  // Есть блочные элементы — заменяем их строки целиком, от начала строки
  // первого элемента до конца строки последнего
  const lineStart = md.text.lastIndexOf('\n', firstRange.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', listRange.to)
  const to = lineEnd === -1 ? md.text.length : lineEnd + 1
  return [{ from: lineStart, to, insert: block }]
}

/** Пересборка строки правила целиком — тот же путь печати, что у addRule */
export function replaceRuleText(md: MihomoDoc, index: number, raw: string): TextEdit[] {
  if (isFlowNode(sectionNode(md, 'rules'))) return []
  const entry = rulesOf(md).find((r) => r.index === index)
  if (entry === undefined) return []
  const rule = parseRule(raw)
  // Форма не имеет права записать в документ то, чего сама не разбирает
  if (rule === null) return []
  const printed = ruleText(rule)
  if (printed === null) return []
  return [{ from: entry.range.from, to: entry.range.to, insert: printed }]
}
```

`mergedNode`, `dealias`, `mergedHas` сейчас живут приватными в `groups.ts` и `edits.ts` в
двух почти одинаковых копиях. Здесь появляется третий вызывающий — вынести их в один
приватный модуль `frontend/src/entities/mihomo/merge.ts` и импортировать в обоих: три копии
обхода `<<` разъедутся гарантированно, а расхождение в нём даёт ту самую тихую порчу.

`applyEdits` уже сортирует правки и накладывает их с конца — две непересекающиеся замены
безопасны в любом порядке (это зафиксировано тестом «порядок правок не важен» из плана 1).

- [ ] **Step 5: Прогнать тесты Mihomo**

Run: `cd frontend && npx vitest run test/mihomo-edits.test.ts test/mihomo-edits-fields.test.ts test/mihomo-mutations.test.ts`
Expected: PASS. Тесты плана 1 обязаны пройти без правок: `setGroupField` и `fieldOrigin`
сохранили сигнатуры и поведение.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/entities/mihomo/edits.ts frontend/test/mihomo-edits-fields.test.ts
git commit -m "feat(frontend): generic section field edits for mihomo"
```

### Task 8: Адаптер и черновик Mihomo

**Files:**
- Create: `frontend/src/features/editor/mihomoAdapter.ts`
- Create: `frontend/src/features/editor/useMihomoDraft.ts`
- Test: `frontend/test/mihomo-draft.test.tsx` (создать)

**Interfaces:**
- Consumes: `useDocumentDraft` (задача 1), `parseMihomo`/`validateMihomo`,
  `buildMihomoGraph`/`layoutMihomo` (задача 4), `mihomoNodeIdForPath`/`mihomoIssueCounts`/
  `searchMihomo` (задача 6), правки из задач 4 и 7.
- Produces:
  - `mihomoAdapter: DocumentAdapter<MihomoDoc>`
  - `useMihomoDraft(options: MihomoDraftOptions): MihomoDraft`, где
    `MihomoDraftOptions = { docKey: string; panelText: string; baseVersion: string }`
  - `interface MihomoDraft extends DocumentDraft<MihomoDoc>` с полями:
    `md: MihomoDoc | undefined` (алиас `model` для читаемости форм);
    `setField(parts: PathParts, key: string, value: string | boolean | number): void`;
    `removeField(parts: PathParts, key: string): void`;
    `originOf(parts: PathParts, key: string): FieldOrigin`;
    `setListAt(parts: PathParts, key: string, values: string[]): void`;
    `renameGroupTo(index: number, name: string): void`;
    `addGroupNamed(name: string): void`; `removeSelected(): void`;
    `addRuleText(raw: string, at?: number): void`;
    `replaceRule(index: number, raw: string): void`; `moveSelected(dir: -1 | 1): void`;
    `connect(source: string, target: string): void`; `disconnect(edgeId: string): void`;
    `refusal: MihomoRefusal | null`; `dismissRefusal(): void`;
    `checkOpen: boolean`; `setCheckOpen(open: boolean): void`;
    `importOpen: boolean`; `setImportOpen(open: boolean): void`;
    `sectionsOpen: boolean`; `setSectionsOpen(open: boolean): void`;
    `trace: MihomoTraceResult | undefined` — поле объявляется здесь заглушкой `undefined`
    и наполняется задачей 15; объявить его сразу дешевле, чем менять тип хука дважды.

**Решение: неразобранный YAML не гасит граф.** `parse` возвращает `model: undefined` только
когда у документа нет корневого содержимого (`doc.contents === null`) — пустой файл или
мусор. Одна синтаксическая ошибка ниже по тексту оставляет частично разобранный документ, и
граф по нему строится: спека требует, чтобы опечатка не лишала пользователя картинки.

**Решение: `renameGroup` ведёт выбор за группой.** Узел группы адресуется именем, поэтому
после переименования выбранный `group:<старое>` указывал бы в никуда и инспектор закрывался
бы прямо во время ввода — та же болезнь, что лечит `renamedNodeId` у Xray.

- [ ] **Step 1: Написать падающий тест черновика**

Создать `frontend/test/mihomo-draft.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMihomoDraft } from '../src/features/editor/useMihomoDraft'
import { mihomoAdapter } from '../src/features/editor/mihomoAdapter'
import { parseMihomo } from '../src/entities/mihomo'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'

const DOC = [
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN,a.com,A',
  '  - MATCH,A',
  '',
].join('\n')

function draft(text = DOC) {
  return renderHook(() =>
    useMihomoDraft({ docKey: 'tpl-1', panelText: text, baseVersion: 'h1' }),
  )
}

describe('адаптер Mihomo', () => {
  it('битый YAML даёт ошибку, но документ остаётся разобранным', () => {
    const res = mihomoAdapter.parse('proxy-groups:\n  - name: A\n   type: [\n')
    expect(res.issues.some((i) => i.level === 'error')).toBe(true)
    expect(res.model).toBeDefined()
  })

  it('пустой документ модели не даёт', () => {
    expect(mihomoAdapter.parse('').model).toBeUndefined()
  })

  it('подпись текстовой вкладки — YAML', () => {
    expect(mihomoAdapter.textTabLabel).toBe('YAML')
  })
})

describe('черновик Mihomo', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
  })

  it('правка поля идёт сплайсом: байты вне правки те же', () => {
    const { result } = draft()
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
    expect(result.current.text).toContain('type: fallback')
    expect(result.current.text).toContain('  - MATCH,A')
    expect(result.current.text.split('\n').length).toBe(DOC.split('\n').length)
  })

  it('переименование группы ведёт выбор за ней', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.renameGroupTo(0, 'Б'))
    expect(result.current.selectedNode).toBe('group:Б')
    expect(result.current.text).toContain('MATCH,Б')
  })

  it('отказ коммутации виден и снимается', () => {
    const { result } = draft('proxy-groups:\n  - name: A\n    proxies: [DIRECT]\n')
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    expect(result.current.refusal).toBe('flow-list')
    act(() => result.current.dismissRefusal())
    expect(result.current.refusal).toBeNull()
  })

  it('успешная коммутация правит документ и причины не оставляет', () => {
    const { result } = draft()
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    expect(result.current.text).toContain('- REJECT')
    expect(result.current.refusal).toBeNull()
  })

  it('удаление правила снимает выбор: id правил позиционные', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.removeSelected())
    expect(result.current.selectedNode).toBeNull()
    expect(result.current.text).not.toContain('DOMAIN,a.com,A')
  })

  it('перестановка правила ведёт выбор за ним', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.moveSelected(1))
    expect(result.current.selectedNode).toBe('rule:1')
  })

  it('правки складываются в историю по одной', () => {
    const { result } = draft()
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'relay'))
    act(() => result.current.doUndo())
    expect(result.current.text).toContain('type: fallback')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/mihomo-draft.test.tsx`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Написать адаптер**

Создать `frontend/src/features/editor/mihomoAdapter.ts`:

```ts
// Адаптер документа для шаблонов Mihomo. Модель — разобранный документ
// библиотеки `yaml` целиком: из него берутся и значения, и диапазоны узлов,
// на которых стоят все правки.

import { parseMihomo, validateMihomo, type MihomoDoc } from '../../entities/mihomo'
import { searchMihomo } from '../../entities/mihomo/search'
import { mihomoIssueCounts, mihomoNodeIdForPath } from '../../entities/graph/mihomo/locate'
import type { DocumentAdapter } from './documentAdapter'

export const mihomoAdapter: DocumentAdapter<MihomoDoc> = {
  textTabLabel: 'YAML',
  parse: (text) => {
    const md = parseMihomo(text)
    return {
      // Модель гасим ТОЛЬКО когда разбирать нечего вовсе. Синтаксическая ошибка
      // ниже по тексту оставляет документ частично разобранным, и граф по нему
      // строится: спека прямо требует, чтобы одна опечатка не лишала картинки.
      model: md.doc.contents === null ? undefined : md,
      issues: validateMihomo(md),
    }
  },
  issueCounts: (issues, md) => mihomoIssueCounts(issues, md),
  nodeIdForPath: (parts, md) => mihomoNodeIdForPath(parts, md),
  // Контекст графа у шаблона пуст — сквадов здесь нет
  search: (md, _ctx, query) => searchMihomo(md, query),
}
```

- [ ] **Step 4: Написать черновик**

Создать `frontend/src/features/editor/useMihomoDraft.ts`:

```ts
// Черновик шаблона Mihomo: ядро плюс операции правки ТЕКСТА. Единица правки —
// TextEdit[], а не новая модель: документ никогда не печатается заново.

import { useState } from 'react'
import {
  addGroup,
  addRule,
  applyEdits,
  moveMihomoRule,
  originAt,
  removeFieldAt,
  removeGroup,
  removeRule,
  renameGroup,
  setFieldAt,
  type FieldOrigin,
  type MihomoDoc,
  type TextEdit,
} from '../../entities/mihomo'
import { groupsOf } from '../../entities/mihomo/groups'
import {
  connectMihomo,
  disconnectMihomo,
  type MihomoRefusal,
} from '../../entities/graph/mihomo/mutations'
import type { PathParts } from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import { useDocumentDraft, type DocumentDraft } from './useDocumentDraft'
import { mihomoAdapter } from './mihomoAdapter'

// Контекст графа у шаблона пуст: сквадов здесь нет. Константа, а не литерал в
// вызове — иначе новый объект на каждый рендер сбрасывал бы мемоизацию.
const NO_CONTEXT: GraphContext = {}

export interface MihomoDraftOptions {
  docKey: string
  panelText: string
  baseVersion: string
}

export interface MihomoDraft extends DocumentDraft<MihomoDoc> {
  /** Тот же `model`, названный по-человечески: формы читают именно документ */
  md: MihomoDoc | undefined
  setField: (parts: PathParts, key: string, value: string | boolean | number) => void
  removeField: (parts: PathParts, key: string) => void
  originOf: (parts: PathParts, key: string) => FieldOrigin
  renameGroupTo: (index: number, name: string) => void
  addGroupNamed: (name: string) => void
  addRuleText: (raw: string, at?: number) => void
  moveSelected: (dir: -1 | 1) => void
  removeSelected: () => void
  connect: (source: string, target: string) => void
  disconnect: (edgeId: string) => void
  refusal: MihomoRefusal | null
  dismissRefusal: () => void
  checkOpen: boolean
  setCheckOpen: (open: boolean) => void
  importOpen: boolean
  setImportOpen: (open: boolean) => void
}

export function useMihomoDraft({
  docKey,
  panelText,
  baseVersion,
}: MihomoDraftOptions): MihomoDraft {
  const core = useDocumentDraft({
    docKind: 'template',
    docKey,
    panelText,
    baseVersion,
    ctx: NO_CONTEXT,
    adapter: mihomoAdapter,
  })
  const [refusal, setRefusal] = useState<MihomoRefusal | null>(null)
  const [checkOpen, setCheckOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const md = core.model

  /**
   * Наложить правки. Пустой список — не ошибка: операция отказала, и причину,
   * если она есть, показывает вызывающий. `select` передаётся явно там, где
   * выбор обязан переехать; `undefined` оставляет выбор как есть, `null` снимает.
   */
  function apply(edits: TextEdit[], select?: string | null) {
    if (edits.length === 0) return
    core.writeDraft(applyEdits(core.text, edits), { history: true })
    if (select !== undefined) core.setSelectedNode(select)
  }

  function selectedRuleIndex(): number | null {
    return core.selectedNode?.startsWith('rule:') ? Number(core.selectedNode.slice(5)) : null
  }

  function selectedGroupIndex(): number | null {
    if (md === undefined || !core.selectedNode?.startsWith('group:')) return null
    const name = core.selectedNode.slice(6)
    return groupsOf(md).find((g) => g.name === name)?.index ?? null
  }

  return {
    ...core,
    md,
    setField: (parts, key, value) => {
      if (md === undefined) return
      apply(setFieldAt(md, parts, key, value))
    },
    removeField: (parts, key) => {
      if (md === undefined) return
      apply(removeFieldAt(md, parts, key))
    },
    originOf: (parts, key) => (md === undefined ? 'absent' : originAt(md, parts, key)),
    renameGroupTo: (index, name) => {
      if (md === undefined) return
      const group = groupsOf(md).find((g) => g.index === index)
      if (group === undefined || group.name === name) return
      // Узел адресуется именем: без переноса выбора инспектор закрылся бы
      // прямо во время ввода — та же болезнь, что лечит renamedNodeId у Xray
      const select = core.selectedNode === `group:${group.name}` ? `group:${name}` : undefined
      apply(renameGroup(md, group.name, name), select)
    },
    addGroupNamed: (name) => {
      if (md === undefined) return
      apply(addGroup(md, name), `group:${name}`)
    },
    addRuleText: (raw, at) => {
      if (md === undefined) return
      apply(addRule(md, raw, at), null)
    },
    moveSelected: (dir) => {
      const index = selectedRuleIndex()
      if (md === undefined || index === null) return
      const edits = moveMihomoRule(md, index, dir)
      if (edits.length === 0) return
      // Число правил не изменилось, но правило переехало — ведём выбор за ним
      apply(edits, `rule:${index + dir}`)
    },
    removeSelected: () => {
      if (md === undefined) return
      const ruleIndex = selectedRuleIndex()
      if (ruleIndex !== null) return apply(removeRule(md, ruleIndex), null)
      const groupIndex = selectedGroupIndex()
      if (groupIndex !== null) return apply(removeGroup(md, groupIndex), null)
    },
    connect: (source, target) => {
      if (md === undefined) return
      const res = connectMihomo(md, source, target)
      setRefusal(res.refusal ?? null)
      apply(res.edits)
    },
    disconnect: (edgeId) => {
      if (md === undefined) return
      const res = disconnectMihomo(md, edgeId)
      setRefusal(res.refusal ?? null)
      apply(res.edits)
    },
    refusal,
    dismissRefusal: () => setRefusal(null),
    checkOpen,
    setCheckOpen,
    importOpen,
    setImportOpen,
  }
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `cd frontend && npx vitest run test/mihomo-draft.test.tsx && cd .. && npm run typecheck -w frontend`
Expected: PASS, 11 тестов.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/editor frontend/test/mihomo-draft.test.tsx
git commit -m "feat(frontend): mihomo document adapter and draft hook"
```

---

### Task 9: Узлы графа и `MihomoTopology`

**Files:**
- Create: `frontend/src/features/topology/mihomoNodes.tsx`
- Create: `frontend/src/features/topology/MihomoTopology.tsx`
- Modify: `frontend/src/entities/graph/mihomo/buildGraph.ts` (узлы подсписков правил)
- Modify: `frontend/src/entities/graph/mihomo/types.ts` (`MihomoSubRuleNodeData`)
- Test: `frontend/test/mihomo-topology.test.tsx` (создать), дополнение `frontend/test/mihomo-graph.test.ts`

**Подсписки правил (`sub-rules`) впервые попадают в граф здесь.** План 1 их не рисовал:
`buildMihomoGraph` обходит только секцию `rules`. Спека требует показывать подсписок группой
правил в колонке правил, и без этого правило `SUB-RULE,(…),block` ведёт в пустоту — на
карточке видно имя подсписка, а куда он девает трафик, не видно нигде.

Форма реализации — узел `subrule:<name>` в колонке правил:

```ts
export interface MihomoSubRuleNodeData extends Record<string, unknown> {
  kind: 'mihomo-subrule'
  name: string
  /** Сколько правил в подсписке — раскрывать их узлами незачем, их читает инспектор */
  count: number
  /** Цели правил подсписка: по ребру на каждую разрешимую */
  targets: string[]
  issueCount?: IssueCount
}
```

Рёбра: от узла правила `SUB-RULE` — в `subrule:<name>` (по третьему полю правила); от
`subrule:<name>` — в цели его собственных правил, тем же `resolveTarget`, что и у остальных.
Раскрытие подсписка отдельными узлами графа **не делаем**: подсписок — это упорядоченный
список строк, порядок в нём значим, и колонка из десяти безымянных узлов читается хуже, чем
одна карточка с числом правил. Сами правила подсписка показывает инспектор при выборе узла.

**Interfaces:**
- Consumes: `GraphCanvas` (задача 3), `buildMihomoGraph`/`layoutMihomo` (задачи 1 плана 1 и 4),
  `isValidMihomoConnection` и `refusalText` (задача 4), `MihomoDraft` (задача 8).
- Produces:
  - `mihomoNodeTypes: Record<string, ComponentType<NodeProps>>` — ключи `mihomoRule`,
    `mihomoGroup`, `mihomoProvider`, `mihomoHosts`, `mihomoBuiltin` (их уже ставит
    `buildMihomoGraph`).
  - `MihomoTopology(props: { draft: MihomoDraft; md: MihomoDoc })`
  - `mihomoColumns(nodes: FlowNode[]): { kind: string; title: string; x: number }[]`

**Здесь закрывается третий долг плана 1:** тип правила прокидывается в
`isValidMihomoConnection`. Без него кабель от узла `SUB-RULE` тянулся бы вхолостую — гнездо
подсвечивалось бы как валидное, а операция отказывала бы уже после отпускания мыши.

**Колонки считаются, а не задаются константой.** У Xray колонок ровно пять и они известны
заранее; у Mihomo число колонок групп зависит от глубины ссылок в конкретном документе.
Подпись колонки выводится из вида первого узла в ней: `mihomo-rule` → «правила»,
`mihomo-group` → «группы», всё остальное → «выходы».

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/mihomo-topology.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { MihomoTopology, mihomoColumns } from '../src/features/topology/MihomoTopology'
import { buildMihomoGraph, layoutMihomo } from '../src/entities/graph/mihomo/buildGraph'
import { parseMihomo } from '../src/entities/mihomo'

const DOC = [
  'proxy-groups:',
  '  - name: Основная',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN,a.com,Основная',
  '  - SUB-RULE,(NETWORK,udp),block',
  '',
].join('\n')

function draftStub(over: Record<string, unknown> = {}) {
  return {
    storageKey: 'template:t-1',
    selectedNode: null,
    setSelectedNode: vi.fn(),
    nodeIssues: {},
    focus: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    addRuleText: vi.fn(),
    addGroupNamed: vi.fn(),
    refusal: null,
    dismissRefusal: vi.fn(),
    ...over,
  } as never
}

function renderTopology(over: Record<string, unknown> = {}) {
  const md = parseMihomo(DOC)
  return render(
    <ReactFlowProvider>
      <MihomoTopology draft={draftStub(over)} md={md} />
    </ReactFlowProvider>,
  )
}

describe('граф Mihomo', () => {
  it('рисует карточки групп и правил', () => {
    renderTopology()
    expect(screen.getByText('Основная')).toBeInTheDocument()
    expect(screen.getByText('DOMAIN')).toBeInTheDocument()
  })

  it('подписи колонок выводятся из содержимого', () => {
    const md = parseMihomo(DOC)
    const nodes = layoutMihomo(buildMihomoGraph(md).nodes)
    const titles = mihomoColumns(nodes).map((c) => c.title)
    expect(titles[0]).toBe('правила')
    expect(titles[titles.length - 1]).toBe('выходы')
  })

  it('док заводит правило и группу', async () => {
    const addRuleText = vi.fn()
    const addGroupNamed = vi.fn()
    renderTopology({ addRuleText, addGroupNamed })
    await userEvent.click(screen.getByRole('button', { name: '+ Правило' }))
    expect(addRuleText).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: '+ Группа' }))
    expect(addGroupNamed).toHaveBeenCalledOnce()
  })

  it('подсписок правил рисуется узлом, и правило SUB-RULE ведёт в него', () => {
    const md = parseMihomo(
      [
        'proxy-groups:',
        '  - name: Основная',
        'sub-rules:',
        '  block:',
        '    - MATCH,Основная',
        'rules:',
        '  - SUB-RULE,(NETWORK,udp),block',
        '',
      ].join('\n'),
    )
    const graph = buildMihomoGraph(md)
    expect(graph.nodes.map((n) => n.id)).toContain('subrule:block')
    expect(graph.edges.map((e) => e.id)).toContain('e:rule:0->subrule:block')
    // Подсписок ведёт дальше сам: иначе видно имя, но не видно, куда уходит трафик
    expect(graph.edges.map((e) => e.id)).toContain('e:subrule:block->group:Основная')
  })

  it('причина отказа коммутации показывается диалогом и закрывается', async () => {
    const dismissRefusal = vi.fn()
    renderTopology({ refusal: 'flow-list', dismissRefusal })
    expect(screen.getByText(/одну строку/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(dismissRefusal).toHaveBeenCalledOnce()
  })
})

describe('допустимость соединения знает тип правила', () => {
  it('от SUB-RULE кабель к группе не тянется', async () => {
    const md = parseMihomo(DOC)
    const nodes = layoutMihomo(buildMihomoGraph(md).nodes)
    // rule:1 — SUB-RULE; проверяем через ту же функцию, что уходит в GraphCanvas
    const { canConnect } = await import('../src/features/topology/MihomoTopology')
    expect(canConnect(nodes, { source: 'rule:1', target: 'group:Основная' })).toBe(false)
    expect(canConnect(nodes, { source: 'rule:0', target: 'group:Основная' })).toBe(true)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/mihomo-topology.test.tsx`
Expected: FAIL — модуля `MihomoTopology` нет.

- [ ] **Step 3: Написать карточки узлов**

Создать `frontend/src/features/topology/mihomoNodes.tsx`. Разметка и классы — те же, что у
карточек Xray (`nodes.tsx`): `fnode`, `fnode-head`, `fnode-kind`, `fnode-title`, `metrics`,
`metric`, `node-issue`. Новых стилей не добавляем.

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type {
  MihomoBuiltinNodeData, MihomoGroupNodeData, MihomoHostsNodeData,
  MihomoProviderNodeData, MihomoRuleNodeData,
} from '../../entities/graph/mihomo/types'
import type { IssueCount } from '../../entities/graph/types'

function frame(kind: string, selected: boolean | undefined): string {
  return [
    'fnode',
    kind === 'group' ? 'fnode-bal' : '',
    kind === 'provider' ? 'fnode-out' : '',
    kind === 'hosts' ? 'fnode-inj' : '',
    kind === 'builtin' ? 'fnode-out' : '',
    selected ? 'fnode-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// Узлы появляются волной слева направо — как у графа Xray, в порядке движения
// сигнала: правило → группа → выход
const ENTER_DELAY: Record<string, number> = { rule: 0, group: 90, provider: 180, hosts: 180, builtin: 180 }
function enter(kind: string): React.CSSProperties {
  return { '--enter-delay': `${ENTER_DELAY[kind] ?? 0}ms` } as React.CSSProperties
}

function IssueBadge({ count }: { count?: IssueCount }) {
  if (!count) return null
  const total = count.errors + count.warnings
  if (total === 0) return null
  const error = count.errors > 0
  return (
    <span
      className={`node-issue node-issue-${error ? 'error' : 'warn'}`}
      aria-label={
        error ? `проблем: ${total}, из них ошибок: ${count.errors}` : `предупреждений: ${total}`
      }
    >
      {error ? '!' : '?'}
      {total > 1 ? ` ${total}` : ''}
    </span>
  )
}

function Metric({ children, accent }: { children: string; accent?: boolean }) {
  return <span className={accent ? 'metric metric-accent' : 'metric'}>{children}</span>
}

function MihomoRuleNode({ data, selected }: { data: MihomoRuleNodeData; selected?: boolean }) {
  return (
    <div className={frame('rule', selected)} style={enter('rule')}>
      <div className="fnode-head">
        <span className="fnode-kind">{data.type}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      {data.payload && <div className="fnode-title">{data.payload}</div>}
      <div className="metrics">
        {data.target && <Metric accent>{`→ ${data.target}`}</Metric>}
        {data.modifiers.map((m) => (
          <Metric key={m}>{m}</Metric>
        ))}
      </div>
      {/* Гнезда-цели у правила нет: в правило кабель не входит */}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function MihomoGroupNode({ data, selected }: { data: MihomoGroupNodeData; selected?: boolean }) {
  return (
    <div className={frame('group', selected)} style={enter('group')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.type ?? 'select'}</span>
        <span className="spacer" />
        {data.hidden && <span className="fnode-flag">скрыта</span>}
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.name}</div>
      <div className="metrics">
        {data.manual > 0 && <Metric>{`вручную: ${data.manual}`}</Metric>}
        {/* Условная формулировка обязательна: сколько хостов подойдёт под
            фильтр, знает только панель */}
        <Metric accent={data.getsHosts}>
          {data.getsHosts ? 'панель добавит хосты' : 'хостов от панели не будет'}
        </Metric>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// MihomoProviderNode, MihomoHostsNode, MihomoBuiltinNode строятся так же:
//  - провайдер: kind — data.type ?? 'provider', title — имя, метрика цепочки
//    `через ${data.dialerProxy}`, гнездо target слева, source нет;
//  - подстановка: kind — «подстановка», title — «хосты панели», метрики —
//    фильтр/исключение и способ выборки (all → «все», random → «один случайный»,
//    shuffled → «все вперемешку»); ОБА гнезда закрыты (isConnectable={false}),
//    потому что содержимое узла создаёт панель;
//  - встроенная цель: kind — «встроенная», title — имя, только гнездо target.

// MihomoSubRuleNode — карточка подсписка: kind «подсписок», title — имя,
// метрика «правил: N»; гнездо target слева (в него ведёт правило SUB-RULE) и
// source справа (подсписок ведёт в цели своих правил).

export const mihomoNodeTypes = {
  mihomoRule: MihomoRuleNode,
  mihomoSubRule: MihomoSubRuleNode,
  mihomoGroup: MihomoGroupNode,
  mihomoProvider: MihomoProviderNode,
  mihomoHosts: MihomoHostsNode,
  mihomoBuiltin: MihomoBuiltinNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>
```

- [ ] **Step 4: Написать `MihomoTopology`**

Создать `frontend/src/features/topology/MihomoTopology.tsx`:

```tsx
// Граф Mihomo поверх общего канваса: сборка узлов, коммутация и объяснение
// отказов. Всё, что не зависит от вида документа (позиции, фокус, патчбей,
// док, подписи колонок), живёт в GraphCanvas.

import { useCallback, useMemo } from 'react'
import type { Connection, Edge } from '@xyflow/react'
import { buildMihomoGraph, layoutMihomo } from '../../entities/graph/mihomo/buildGraph'
import { isValidMihomoConnection, refusalText } from '../../entities/graph/mihomo/mutations'
import type { FlowNode } from '../../entities/graph/types'
import type { MihomoDoc } from '../../entities/mihomo'
import type { MihomoDraft } from '../editor/useMihomoDraft'
import { Button, Dialog } from '../../shared/ui'
import { edgeTypes } from './edges'
import { GraphCanvas } from './GraphCanvas'
import { mihomoNodeTypes } from './mihomoNodes'

const COLUMN_TITLE: Record<string, string> = {
  'mihomo-rule': 'правила',
  'mihomo-group': 'группы',
}

/**
 * Подписи колонок. У Xray колонок ровно пять и они заданы константой; здесь
 * число колонок групп зависит от глубины ссылок в конкретном документе, поэтому
 * колонки считаются по факту. Вид колонки — вид её ПЕРВОГО узла: в одной
 * колонке лежат узлы одного вида, кроме колонки выходов, где смешаны
 * провайдеры, подстановки и встроенные цели — она и называется «выходы».
 */
export function mihomoColumns(nodes: FlowNode[]): { kind: string; title: string; x: number }[] {
  const seen = new Map<number, string>()
  for (const node of nodes) {
    if (!seen.has(node.position.x)) seen.set(node.position.x, String(node.data.kind))
  }
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, kind]) => ({ kind, x, title: COLUMN_TITLE[kind] ?? 'выходы' }))
}

/** Тип правила по id его узла — нужен проверке допустимости соединения */
function ruleTypeOf(nodes: FlowNode[], id: string | null | undefined): string | undefined {
  const node = nodes.find((n) => n.id === id)
  return node?.data.kind === 'mihomo-rule' ? (node.data.type as string) : undefined
}

/**
 * Допустимость соединения с учётом ТИПА правила-источника. Долг плана 1: без
 * типа кабель от узла SUB-RULE тянулся бы вхолостую — гнездо подсвечивалось бы
 * как валидное, а операция отказывала бы уже после отпускания мыши.
 * Экспортируется ради теста: внутри компонента её не проверить.
 */
export function canConnect(
  nodes: FlowNode[],
  conn: { source?: string | null; target?: string | null },
): boolean {
  return isValidMihomoConnection(
    conn.source ?? '',
    conn.target ?? '',
    ruleTypeOf(nodes, conn.source),
  )
}

const TARGET_KINDS = ['group', 'provider', 'builtin'] as const

export function MihomoTopology({ draft, md }: { draft: MihomoDraft; md: MihomoDoc }) {
  const graph = useMemo(() => {
    const g = buildMihomoGraph(md)
    return { nodes: layoutMihomo(g.nodes), edges: g.edges }
  }, [md])

  const computed = useMemo(() => {
    const nodes = graph.nodes.map((n) => {
      const issueCount = draft.nodeIssues[n.id]
      return {
        ...n,
        deletable: false,
        selected: n.id === draft.selectedNode,
        // Ссылку на data сохраняем, когда доклеивать нечего: React Flow
        // сравнивает объекты по ссылке
        data: issueCount === undefined ? n.data : { ...n.data, issueCount },
      }
    })
    const edges = graph.edges.map((e) => ({
      ...e,
      type: 'signal',
      data: {
        active:
          draft.selectedNode !== null &&
          (e.source === draft.selectedNode || e.target === draft.selectedNode),
      },
    }))
    return { nodes, edges }
  }, [graph, draft.selectedNode, draft.nodeIssues])

  const isValid = useCallback(
    (conn: { source?: string | null; target?: string | null }) => canConnect(graph.nodes, conn),
    [graph.nodes],
  )

  const onConnect = useCallback(
    (conn: Connection) => draft.connect(conn.source ?? '', conn.target ?? ''),
    [draft],
  )

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      // Одно ребро за раз: у Mihomo нет позиционных id, которые смещались бы
      // друг относительно друга, но каждая правка считает отступы по ТЕКУЩЕМУ
      // тексту — накладывать вторую поверх первой без пересчёта нельзя
      const first = deleted[0]
      if (first) draft.disconnect(first.id)
    },
    [draft],
  )

  return (
    <GraphCanvas
      docKey={draft.storageKey}
      nodes={computed.nodes}
      edges={computed.edges}
      nodeTypes={mihomoNodeTypes}
      edgeTypes={edgeTypes}
      selectedId={draft.selectedNode}
      onSelect={draft.setSelectedNode}
      isValidConnection={isValid}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      targetKinds={TARGET_KINDS}
      columns={mihomoColumns(graph.nodes)}
      focus={draft.focus}
      hint={
        graph.nodes.length === 0 ? (
          <>Документ пуст. Заведите группу и правило кнопками ниже либо импортируйте готовый шаблон.</>
        ) : undefined
      }
      dockActions={
        <>
          <Button onClick={() => draft.addRuleText('MATCH,DIRECT')}>+ Правило</Button>
          <Button onClick={() => draft.addGroupNamed(nextGroupName(md))}>+ Группа</Button>
        </>
      }
    >
      <Dialog
        open={draft.refusal !== null}
        title="Так соединить нельзя"
        onClose={draft.dismissRefusal}
      >
        <p>{draft.refusal ? refusalText(draft.refusal) : ''}</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={draft.dismissRefusal}>
            Понятно
          </Button>
        </div>
      </Dialog>
    </GraphCanvas>
  )
}
```

`nextGroupName(md)` — маленький локальный помощник: `Группа`, `Группа 2`, `Группа 3`… первое
имя, которого нет среди `groupsOf(md)`. Совпадение имён — диагностируемая ошибка документа,
и заводить её кнопкой нельзя.

- [ ] **Step 5: Прогнать тесты**

Run: `cd frontend && npx vitest run test/mihomo-topology.test.tsx && cd .. && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/topology frontend/test/mihomo-topology.test.tsx
git commit -m "feat(frontend): mihomo graph nodes and topology view"
```

### Task 10: Инспектор Mihomo

Формы всех секций — одна компонента, управляемая словарём из задачи 5. Отдельная форма
только у правила: там поля не «ключ → скаляр», а разбор одной строки.

**Files:**
- Create: `frontend/src/features/inspector/MihomoFieldsForm.tsx`
- Create: `frontend/src/features/inspector/MihomoRuleForm.tsx`
- Create: `frontend/src/features/topology/MihomoInspector.tsx`
- Create: `frontend/src/features/editor/MihomoSectionsDialog.tsx`
- Test: `frontend/test/mihomo-inspector.test.tsx`, `frontend/test/mihomo-rule-form.test.tsx`

**Interfaces:**
- Consumes: `MihomoField`/`fieldsOf` (задача 5), `readFieldAt`/`setFieldAt`/`setListAt`/
  `removeFieldAt` (задача 7), `MihomoDraft` (задача 8), существующие
  `Field`/`TextField`/`NumberField`/`SelectField`/`CheckboxField`/`StringListField` из
  `features/inspector/fields.tsx`, `CollapsibleSection` и `Chip` из `shared/ui`.
- Produces:
  - `MihomoFieldsForm({ md, parts, fields, draft }: { md: MihomoDoc; parts: PathParts; fields: MihomoField[]; draft: MihomoDraft })`
  - `MihomoRuleForm({ md, index, draft }: { md: MihomoDoc; index: number; draft: MihomoDraft })`
  - `MihomoInspector({ draft, md, nodeId }: { draft: MihomoDraft; md: MihomoDoc; nodeId: string })`
  - `MihomoSectionsDialog({ open, md, draft, onClose })`

**Три решения, определяющие форму:**

1. **Заполненные поля сверху, остальные — под раскрывашкой.** У группы 25 полей словаря;
   показать все сразу — стена, в которой не видно, что в документе реально задано. Поля с
   собственным значением идут списком, поля без значения — внутри `CollapsibleSection`
   «Ещё поля» с подписью, сколько их.
2. **Поле из якоря показывается только для чтения** — с текстом «значение приходит через
   `<<:` и правится в тексте, у объявления якоря». Это прямое требование спеки: молча
   разворачивать якорь нельзя, а тихо скрывать поле — значит врать, что его нет.
   Случая ДВА, и формулировки у них разные: `origin === 'merged'` — значение пришло слиянием
   `<<:`, `origin === 'alias'` — сам ключ ссылается на якорь (`remnawave: *rw`). Оба
   рисуются одинаково (только для чтения), но текст обязан называть, где именно править,
   иначе пользователь пойдёт искать не то объявление. Член `'alias'` появился в `FieldOrigin`
   по итогам ревью задачи 7: без него правка поля через алиас молча меняла значение у ВСЕХ
   потребителей якоря, а `setListAt` на таком ключе давала синтаксически битый YAML.
3. **Пустое значение снимает ключ.** Очистить текстовое поле = `removeFieldAt`. Иначе в
   документе копились бы `filter: ''`, меняющие поведение ядра (пустой фильтр не то же, что
   отсутствующий).

- [ ] **Step 1: Написать падающие тесты форм**

Создать `frontend/test/mihomo-inspector.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoFieldsForm } from '../src/features/inspector/MihomoFieldsForm'
import { fieldsOf, parseMihomo } from '../src/entities/mihomo'
import { selectOption } from './helpers'

const DOC = [
  'x-anchors:',
  '  base: &base',
  '    interval: 300',
  '  rw: &rw',
  '    include-proxies: false',
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    <<: *base',
  '    remnawave: *rw',
  '',
].join('\n')

function draftStub(over: Record<string, unknown> = {}) {
  return {
    setField: vi.fn(),
    removeField: vi.fn(),
    renameGroupTo: vi.fn(),
    ...over,
  } as never
}

function renderForm(over: Record<string, unknown> = {}) {
  const md = parseMihomo(DOC)
  const draft = draftStub(over)
  render(
    <MihomoFieldsForm md={md} parts={['proxy-groups', 0]} fields={fieldsOf('proxy-group')} draft={draft} />,
  )
  return draft
}

describe('форма секции Mihomo', () => {
  it('заполненные поля показаны сразу', () => {
    renderForm()
    expect(screen.getByLabelText('type')).toBeInTheDocument()
  })

  it('незаполненные поля спрятаны под раскрывашку', async () => {
    renderForm()
    expect(screen.queryByLabelText('filter')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    expect(screen.getByLabelText('filter')).toBeInTheDocument()
  })

  // Два случая различаются формулировкой намеренно: пользователю надо знать, где
  // именно править — у объявления слитого отображения или у объявления якоря,
  // на который ссылается ключ. Общая проверка /приходит через/ прошла бы и при
  // одинаковом тексте в обеих ветках, то есть не поймала бы их склейку.
  it('значение из слияния доступно только для чтения и называет слияние', () => {
    renderForm()
    const field = screen.getByLabelText('interval')
    expect(field).toHaveAttribute('readonly')
    expect(screen.getByText(/приходит через слияние/)).toBeInTheDocument()
  })

  // Раскрывашку здесь НЕ жмём: origin у такого поля 'alias', а не 'absent',
  // значит по правилу «заполненные сверху» оно показано сразу.
  it('значение из ссылки на якорь доступно только для чтения и называет якорь', () => {
    renderForm()
    const field = screen.getByLabelText('remnawave.include-proxies')
    expect(field).toHaveAttribute('readonly')
    expect(screen.getByText(/приходит через ссылку на якорь/)).toBeInTheDocument()
  })

  it('выбор в enum-поле пишется правкой', async () => {
    const draft = renderForm()
    await selectOption('type', 'fallback')
    expect(draft.setField).toHaveBeenCalledWith(['proxy-groups', 0], 'type', 'fallback')
  })

  it('очистка текстового поля снимает ключ, а не пишет пустую строку', async () => {
    const draft = renderForm()
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    const input = screen.getByLabelText('icon')
    await userEvent.type(input, 'x')
    await userEvent.clear(input)
    expect(draft.removeField).toHaveBeenCalledWith(['proxy-groups', 0], 'icon')
  })

  it('переключатель булева поля пишет true', async () => {
    const draft = renderForm()
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    await userEvent.click(screen.getByLabelText('lazy'))
    expect(draft.setField).toHaveBeenCalledWith(['proxy-groups', 0], 'lazy', true)
  })

  it('подсказка поля берётся из словаря', async () => {
    renderForm()
    expect(screen.getByText(/Как группа выбирает участника/)).toBeInTheDocument()
  })
})
```

Создать `frontend/test/mihomo-rule-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoRuleForm } from '../src/features/inspector/MihomoRuleForm'
import { parseMihomo } from '../src/entities/mihomo'
import { selectOption, optionLabels } from './helpers'

const DOC = [
  'proxy-groups:',
  '  - name: A',
  'sub-rules:',
  '  block:',
  '    - MATCH,REJECT',
  'rules:',
  '  - DOMAIN-SUFFIX,a.com,A,no-resolve',
  '  - SUB-RULE,(NETWORK,udp),block',
  '',
].join('\n')

function renderRule(index: number) {
  const md = parseMihomo(DOC)
  const draft = { setField: vi.fn(), addRuleText: vi.fn(), replaceRule: vi.fn() } as never
  render(<MihomoRuleForm md={md} index={index} draft={draft} />)
  return draft
}

describe('форма правила Mihomo', () => {
  it('раскладывает строку на поля', () => {
    renderRule(0)
    expect(screen.getByLabelText('Значение')).toHaveValue('a.com')
    expect(screen.getByLabelText('Цель')).toHaveValue('A')
    expect(screen.getByLabelText('no-resolve')).toBeChecked()
  })

  it('MATCH не показывает поле значения', () => {
    const md = parseMihomo('rules:\n  - MATCH,A\n')
    render(<MihomoRuleForm md={md} index={0} draft={{ replaceRule: vi.fn() } as never} />)
    expect(screen.queryByLabelText('Значение')).not.toBeInTheDocument()
  })

  it('у SUB-RULE цель выбирается из подсписков, а не из групп', async () => {
    renderRule(1)
    expect(await optionLabels('Цель')).toEqual(['block'])
  })

  it('смена типа переписывает строку целиком', async () => {
    const draft = renderRule(0)
    await selectOption('Тип', 'DOMAIN-KEYWORD')
    expect(draft.replaceRule).toHaveBeenCalledWith(0, 'DOMAIN-KEYWORD,a.com,A,no-resolve')
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd frontend && npx vitest run test/mihomo-inspector.test.tsx test/mihomo-rule-form.test.tsx`
Expected: FAIL — компонент не найден.

- [ ] **Step 3: Написать `MihomoFieldsForm`**

```tsx
// Форма секции шаблона Mihomo. Поля приходят из словаря (entities/mihomo/docSchema),
// значения и происхождение — из документа. Одна компонента обслуживает группу,
// провайдера, набор правил, dns, tun, sniffer, profile и корень: у всех этих
// секций поле — плоская пара «ключ → скаляр», и вторая такая же форма
// разъехалась бы с первой на первом же добавленном ключе.

import { useId } from 'react'
import { readFieldAt } from '../../entities/mihomo/edits'
import type { MihomoDoc, MihomoField } from '../../entities/mihomo'
import type { PathParts } from '../../entities/xray'
import { CollapsibleSection } from '../../shared/ui'
import type { MihomoDraft } from '../editor/useMihomoDraft'
import { CheckboxField, NumberField, SelectField, StringListField, TextField } from './fields'

function FieldRow({
  md,
  parts,
  field,
  draft,
}: {
  md: MihomoDoc
  parts: PathParts
  field: MihomoField
  draft: MihomoDraft
}) {
  const id = useId()
  const { value, origin } = readFieldAt(md, parts, field.key)

  // Требование спеки: значение из якоря правится только в тексте, у объявления.
  // Молча развернуть якорь — та самая порча чужого файла, ради предотвращения
  // которой выбрана вся архитектура; молча скрыть поле — соврать, что его нет.
  if (origin === 'merged' || origin === 'alias') {
    const via =
      origin === 'merged'
        ? 'Значение приходит через слияние «<<:»'
        : 'Значение приходит через ссылку на якорь «*»'
    return (
      <TextField
        controlId={id}
        label={field.key}
        hint={`${field.doc} ${via} — правится в тексте, у объявления якоря.`}
        value={String(value ?? '')}
        readOnly
        onChange={() => {}}
      />
    )
  }

  const set = (next: string | number | boolean) => draft.setField(parts, field.key, next)
  // Пустое значение снимает ключ: `filter: ''` и отсутствующий filter — разные
  // конфиги для ядра, и копить первые из-за очищенного поля нельзя
  const clear = () => draft.removeField(parts, field.key)

  if (field.type === 'boolean') {
    return (
      <CheckboxField
        controlId={id}
        label={field.key}
        hint={field.doc}
        checked={value === true}
        onChange={(next) => (next ? set(true) : origin === 'own' ? clear() : set(false))}
      />
    )
  }
  if (field.type === 'number') {
    return (
      <NumberField
        controlId={id}
        label={field.key}
        hint={field.doc}
        value={typeof value === 'number' ? value : undefined}
        onChange={(next) => (next === undefined ? clear() : set(next))}
      />
    )
  }
  if (field.type === 'strings') {
    return (
      <StringListField
        controlId={id}
        label={field.key}
        hint={field.doc}
        value={Array.isArray(value) ? value : []}
        onChange={(next) => draft.setListAt(parts, field.key, next)}
      />
    )
  }
  if (field.enum) {
    return (
      <SelectField
        controlId={id}
        label={field.key}
        hint={field.doc}
        value={typeof value === 'string' ? value : ''}
        // Значения словаря — подсказка, а не ограничение: значение из чужого
        // шаблона, которого нет в enum, обязано остаться в списке видимым
        options={optionsWith(field, value)}
        onChange={set}
      />
    )
  }
  return (
    <TextField
      controlId={id}
      label={field.key}
      hint={field.doc}
      value={typeof value === 'string' ? value : ''}
      onChange={(next) => (next.trim() === '' ? clear() : set(next))}
    />
  )
}

export function MihomoFieldsForm({
  md,
  parts,
  fields,
  draft,
}: {
  md: MihomoDoc
  parts: PathParts
  fields: MihomoField[]
  draft: MihomoDraft
}) {
  const filled = fields.filter((f) => readFieldAt(md, parts, f.key).origin !== 'absent')
  const rest = fields.filter((f) => readFieldAt(md, parts, f.key).origin === 'absent')
  return (
    <>
      {filled.map((field) => (
        <FieldRow key={field.key} md={md} parts={parts} field={field} draft={draft} />
      ))}
      {rest.length > 0 && (
        <CollapsibleSection title={`Ещё поля (${rest.length})`}>
          {rest.map((field) => (
            <FieldRow key={field.key} md={md} parts={parts} field={field} draft={draft} />
          ))}
        </CollapsibleSection>
      )}
    </>
  )
}
```

`optionsWith(field, value)` — локальный помощник: варианты словаря плюс, если текущее
значение среди них не встретилось и не пусто, оно само отдельным пунктом. Без этого выбор
в форме молча заменил бы незнакомое значение чужого шаблона на первое из списка.

`draft.setListAt(parts, key, values)` дописывается в `useMihomoDraft` рядом с `setField` —
обёртка над `setListAt` из задачи 7.

- [ ] **Step 4: Написать `MihomoRuleForm`**

Форма разбирает строку правила и собирает её заново целиком: тип, значение (кроме `MATCH`),
цель, модификаторы. Собранная строка уходит одной правкой через `draft.replaceRule(index, raw)`
— обёртку над `setRuleTarget`-подобной заменой всего диапазона; её тоже дописать в
`useMihomoDraft`:

```ts
    replaceRule: (index, raw) => {
      if (md === undefined) return
      const entry = rulesOf(md).find((r) => r.index === index)
      if (entry === undefined) return
      // Печатаем через addRule-совместимый путь: строка правила проходит через
      // сериализатор, а не склеивается запятыми — цель с двоеточием или
      // решёткой иначе превратила бы список правил в отображение
      apply(replaceRuleText(md, index, raw))
    },
```
где `replaceRuleText(md, index, raw)` — ещё одна операция в `edits.ts` (та же арифметика,
что у `setRuleTarget`, но пересобирается вся строка). Правило `null` при разборе `raw`
даёт отказ: форма не должна уметь записать в документ то, что сама не разбирает.

Цель выбирается из разного набора в зависимости от типа: у `SUB-RULE` — имена из
`subRuleNames(md)`, у остальных — группы, провайдеры и встроенные цели
(`BUILTIN_TARGETS`). Плюс свободный ввод: имя хоста от панели редактор не знает и
предугадать не может, поэтому поле — комбинация `Select` со списком известных и
`TextInput` для произвольного значения; переключение между ними — чекбокс «своё имя».

- [ ] **Step 5: Написать `MihomoInspector` и `MihomoSectionsDialog`**

`MihomoInspector` — разводка по префиксу id узла, зеркало `NodeInspector`:

| Узел | Что показываем |
|---|---|
| `group:<name>` | `MihomoFieldsForm` секции `proxy-group`, кнопка «Удалить группу» |
| `rule:<i>` | `MihomoRuleForm`, кнопки «Выше»/«Ниже»/«Удалить» |
| `provider:<name>` | `MihomoFieldsForm` секции `proxy-provider` |
| `hosts:<owner>` | Карточка только для чтения: что именно подставит панель, условной формулировкой («если панель подставит хосты, сюда попадут те, что подойдут под фильтр»), и почему отсюда не тянется кабель |
| `subrule:<name>` | Правила подсписка списком, **только для чтения**, с кнопкой «Открыть в YAML», ведущей на текстовую вкладку к месту подсписка |
| `builtin:<name>` | Карточка только для чтения: что делает встроенная цель |

**Почему подсписок только для чтения.** Формы инспектора спека перечисляет поимённо
(раздел 6): группа, правило, провайдер, набор правил, `dns`, `tun`, `sniffer`, глобальные
настройки — подсписков в этом списке нет. Сделать их правимыми значило бы завести вторую
семью правок, принимающих путь до списка правил вместо жёсткого `rules`, — заметная работа
ради секции, которая встречается в одном из трёх эталонных шаблонов. Свобода правки при этом
не теряется: текст владеет файлом, и подсписок правится на вкладке YAML с подсказками, куда
и ведёт кнопка. Если практика покажет, что этого мало, путь до списка добавляется в
`replaceRuleText`/`removeRule`/`addRule` одной задачей — это расширение, а не переделка.

Обёртка — та же разметка `.wb-inspector`, что у `NodeInspector`, с заголовком, кнопкой
закрытия и `onClose`.

`MihomoSectionsDialog` — диалог «Секции документа», по `CollapsibleSection` на каждую из
`root`, `dns`, `tun`, `sniffer`, `profile`, плюс список наборов правил (`rule-providers`) с
формой секции `rule-provider` на каждый. Эти секции не имеют узлов в графе — узлами они и не
должны быть (это словари и глобальные настройки, а не маршруты), но править их надо, и
диалог здесь тот же приём, что `ConfigSettingsDialog` у Xray.

- [ ] **Step 6: Прогнать тесты**

Run: `cd frontend && npx vitest run test/mihomo-inspector.test.tsx test/mihomo-rule-form.test.tsx && cd .. && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features frontend/src/entities/mihomo/edits.ts frontend/test
git commit -m "feat(frontend): mihomo inspector forms driven by the field dictionary"
```

---

### Task 11: YAML-вкладка с подсказками и наведением

**Files:**
- Create: `frontend/src/features/editor/YamlView.tsx`
- Create: `frontend/src/features/editor/yamlLocate.ts`
- Create: `frontend/src/features/editor/mihomoIntellisense/context.ts`
- Create: `frontend/src/features/editor/mihomoIntellisense/complete.ts`
- Create: `frontend/src/features/editor/mihomoIntellisense/hover.ts`
- Create: `frontend/src/features/editor/mihomoIntellisense/index.ts`
- Modify: `frontend/package.json` (зависимость `@codemirror/lang-yaml`)
- Test: `frontend/test/mihomo-intellisense.test.ts` (создать)

**Interfaces:**
- Produces:
  - `YamlView({ text, onChange, reveal })` — те же пропсы, что у `JsonView`
  - `mihomoDiagnostics(text: string, issues: ValidationIssue[]): Diagnostic[]`
  - `contextAt(text: string, pos: number): MihomoCursor | null`, где
    `interface MihomoCursor { section: MihomoSectionName; parts: PathParts; existingKeys: string[]; mode: 'key' | 'value'; key?: string }`
  - `mihomoIntellisense(): Extension`
- Consumes: словарь (задача 5), `parseMihomo`/`pathAt`/`locateMihomo` (задачи 1 плана 1 и 6).

**Решение: дерево берётся у библиотеки `yaml`, а не у CodeMirror.** Прямое требование спеки.
У Xray резолвер вынужден ходить по дереву CodeMirror и потому обязан звать `ensureSyntaxTree`
с бюджетом — снимок `syntaxTree` отстаёт от текста на большом документе (см. `CLAUDE.md`).
Здесь этой развилки нет вовсе: `parseMihomo(view.state.doc.toString())` разбирает актуальный
текст целиком и синхронно. Побочный выигрыш — исчезает целый класс флейка, о который уже
споткнулся тест подсказок Xray.

**Установка зависимости:** `npm install -w frontend @codemirror/lang-yaml@^6.1.3`.

- [ ] **Step 1: Написать падающий тест подсказок**

Создать `frontend/test/mihomo-intellisense.test.ts`:

```ts
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { yaml } from '@codemirror/lang-yaml'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { contextAt } from '../src/features/editor/mihomoIntellisense/context'
import { mihomoCompletionSource } from '../src/features/editor/mihomoIntellisense/complete'

// Позиция курсора помечается ‸ — символ, в YAML-содержимом не встречающийся
const CARET = '‸'

function at(src: string): { text: string; pos: number } {
  const pos = src.indexOf(CARET)
  if (pos < 0) throw new Error('нет маркера курсора ‸')
  return { text: src.slice(0, pos) + src.slice(pos + CARET.length), pos }
}

function complete(src: string): CompletionResult | null {
  const { text, pos } = at(src)
  const state = EditorState.create({ doc: text, extensions: [yaml()] })
  return mihomoCompletionSource(new CompletionContext(state, pos, true))
}

function labels(src: string): string[] {
  return (complete(src)?.options ?? []).map((o) => String(o.label))
}

describe('контекст курсора', () => {
  it('внутри элемента proxy-groups — секция группы', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    ‸\n')
    const ctx = contextAt(text, pos)
    expect(ctx?.section).toBe('proxy-group')
    expect(ctx?.mode).toBe('key')
    expect(ctx?.existingKeys).toContain('name')
  })

  it('внутри dns — секция dns', () => {
    const { text, pos } = at('dns:\n  enable: true\n  ‸\n')
    expect(contextAt(text, pos)?.section).toBe('dns')
  })

  it('после двоеточия — режим значения с именем ключа', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    type: ‸\n')
    const ctx = contextAt(text, pos)
    expect(ctx?.mode).toBe('value')
    expect(ctx?.key).toBe('type')
  })
})

describe('подсказки Mihomo', () => {
  it('ключи группы предлагаются и не повторяют уже введённые', () => {
    const got = labels('proxy-groups:\n  - name: A\n    type: select\n    ‸\n')
    expect(got).toEqual(expect.arrayContaining(['filter', 'interval', 'use']))
    expect(got).not.toContain('name')
    expect(got).not.toContain('type')
  })

  it('значения типа группы предлагаются из словаря', () => {
    expect(labels('proxy-groups:\n  - name: A\n    type: ‸\n')).toEqual(
      expect.arrayContaining(['select', 'url-test', 'fallback', 'load-balance', 'relay']),
    )
  })

  it('ключи dns не смешиваются с ключами группы', () => {
    const got = labels('dns:\n  enable: true\n  ‸\n')
    expect(got).toEqual(expect.arrayContaining(['enhanced-mode', 'nameserver']))
    expect(got).not.toContain('filter')
  })

  it('в корне предлагаются секции верхнего уровня', () => {
    expect(labels('‸\n')).toEqual(expect.arrayContaining(['mode', 'log-level', 'dns', 'tun']))
  })

  it('битый YAML ниже курсора не мешает подсказкам выше', () => {
    const got = labels('proxy-groups:\n  - name: A\n    ‸\nrules:\n  - [\n')
    expect(got).toContain('type')
  })

  it('подсказка несёт описание из словаря', () => {
    const option = (complete('dns:\n  ‸\n')?.options ?? []).find((o) => o.label === 'enhanced-mode')
    expect(String(option?.info ?? '')).toMatch(/fake-ip|redir-host|режим/i)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/mihomo-intellisense.test.ts`
Expected: FAIL — модулей нет; после установки зависимости — импорт `@codemirror/lang-yaml`
уже резолвится.

- [ ] **Step 3: Написать резолвер контекста**

`frontend/src/features/editor/mihomoIntellisense/context.ts`:

```ts
// Где стоит курсор: в какой секции документа, вводится ключ или значение, какие
// ключи в этом отображении уже есть. Дерево берём у библиотеки `yaml` — она
// разбирает актуальный текст целиком и синхронно, поэтому здесь нет ни бюджета
// разбора, ни отстающего снимка дерева, как у резолвера Xray (см. CLAUDE.md).

import type { PathParts } from '../../../entities/xray'
import { parseMihomo, pathAt, sectionForKey, type MihomoSectionName } from '../../../entities/mihomo'

export interface MihomoCursor {
  section: MihomoSectionName
  parts: PathParts
  /** Ключи, уже введённые в этом отображении — из них подсказки вычитаются */
  existingKeys: string[]
  mode: 'key' | 'value'
  /** Имя ключа, значение которого вводится (mode === 'value') */
  key?: string
}

// «  type: » — вводим ЗНАЧЕНИЕ; «  ty» — вводим КЛЮЧ
const VALUE_RE = /^\s*(?:-\s*)?([A-Za-z0-9_-]+)\s*:\s*\S*$/

/** Секция по пути от корня. Пустой путь — корень документа. */
function sectionOf(parts: PathParts): MihomoSectionName {
  const [head] = parts
  if (head === 'proxy-groups') return 'proxy-group'
  if (head === 'proxy-providers') return 'proxy-provider'
  if (head === 'rule-providers') return 'rule-provider'
  if (typeof head === 'string') return sectionForKey(head) ?? 'root'
  return 'root'
}

export function contextAt(text: string, pos: number): MihomoCursor | null { … }
```

Реализация `contextAt`:
1. `const md = parseMihomo(text)` — синтаксическая ошибка ниже курсора не мешает: документ
   разбирается частично, а `pathAt` работает по диапазонам уже разобранного.
2. `const parts = pathAt(md, pos)` — путь до охватывающего узла.
3. Строка курсора: `text.slice(lineStart, pos)`. Совпала `VALUE_RE` — `mode: 'value'`,
   `key` из первой группы; иначе `mode: 'key'`.
4. `existingKeys` — собственные ключи отображения по пути (у `mode: 'value'` путь
   укорачивается на последний сегмент, чтобы не считать ключами содержимое значения).
5. Секция — `sectionOf(parts)`, но с одной оговоркой: у элемента `proxy-groups` путь
   начинается с `['proxy-groups', N]`, и секция определяется по ПЕРВОМУ сегменту, поэтому
   вложенное отображение `remnawave` внутри группы даёт ту же секцию — это верно, ключи
   `remnawave.*` лежат в словаре группы с составным именем и подсказываются с учётом
   префикса (шаг 4 ниже).

- [ ] **Step 4: Написать источник подсказок**

`complete.ts` — по образцу `features/editor/intellisense/complete.ts`, но проще: словарь
плоский, вложенность выражена точкой в ключе.

- Режим `key`: берём `fieldsOf(section)`, отбрасываем уже введённые. Ключи с точкой
  (`remnawave.include-proxies`) предлагаются в двух видах: сам префикс (`remnawave`) как
  вложенная секция, если её ещё нет, и короткое имя листа (`include-proxies`), если курсор
  уже внутри отображения `remnawave` — определяется по последнему сегменту пути.
- Режим `value`: `fieldOf(section, key)?.enum` → варианты; у булевых полей — `true`/`false`.
- `info` каждой подсказки — `field.doc`; у enum-значения — его собственный `doc`.
- `apply` не оборачивает в кавычки: в YAML они не нужны, а лишние кавычки в чужом файле —
  это чужой стиль. Значение с двоеточием или решёткой в enum-словаре не встречается.

`hover.ts` — по позиции наведения тот же `contextAt`, затем `fieldOf(section, key)?.doc` в
tooltip. `index.ts` собирает `mihomoIntellisense(): Extension` из
`autocompletion({ override: [mihomoCompletionSource] })` и `hoverTooltip(...)` — ровно как
`xrayIntellisense`.

- [ ] **Step 5: Написать `yamlLocate.ts` и `YamlView.tsx`**

`yamlLocate.ts` — зеркало `jsonLocate.ts`, но без дерева CodeMirror:

```ts
// Диагностики CodeMirror по проблемам шаблона: у каждой — своё место в тексте.
// Место ищет locateMihomo по разобранному документу, поэтому ни EditorState, ни
// дерево CodeMirror здесь не нужны — только текст.

import type { Diagnostic } from '@codemirror/lint'
import { locateMihomo, parseMihomo } from '../../entities/mihomo'
import type { ValidationIssue } from '../../entities/xray'

export function mihomoDiagnostics(text: string, issues: ValidationIssue[]): Diagnostic[] {
  const md = parseMihomo(text)
  return issues.map((issue): Diagnostic => {
    const severity = issue.level === 'error' ? 'error' : 'warning'
    const label = issue.path ? `${issue.path}: ${issue.message}` : issue.message
    const range = locateMihomo(md, issue.parts)
    if (!range) {
      // Диапазон обязателен: ставим в начало и честно говорим, что позиция
      // неизвестна — иначе маркер читается как указание на первую строку
      return { from: 0, to: 0, severity, message: `${label} (место в документе не определено)` }
    }
    return { from: range.from, to: range.to, severity, message: label }
  })
}
```

`YamlView.tsx` — копия структуры `JsonView.tsx` с четырьмя заменами: `json()` → `yaml()`,
линтер зовёт `validateMihomo(parseMihomo(text))` и `mihomoDiagnostics`, подсказки —
`mihomoIntellisense()`, переход по `reveal` — через `locateMihomo`, а не `locateRange`.
Тема редактора (`editorTheme`) переиспользуется — вынести её из `JsonView.tsx` в
`frontend/src/features/editor/editorTheme.ts` и импортировать в обоих: две копии темы
разъедутся при первой же правке токенов.

- [ ] **Step 6: Прогнать тесты**

Run: `cd frontend && npx vitest run test/mihomo-intellisense.test.ts && cd .. && npm test -w frontend && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json package-lock.json frontend/src/features/editor frontend/test/mihomo-intellisense.test.ts
git commit -m "feat(frontend): yaml tab with mihomo completions and hover"
```

### Task 12: Страница редактора, маршрут, список и сохранение

**Files:**
- Create: `frontend/src/shared/lib/base64.ts`
- Create: `frontend/src/features/templates/MihomoEditorPage.tsx`
- Modify: `frontend/src/shared/api/hooks.ts` (`useSaveTemplate`, `useCreateTemplate`)
- Modify: `frontend/src/features/templates/TemplateEditorPage.tsx` (разводка по типу)
- Modify: `frontend/src/features/templates/TemplatesPage.tsx` (`MIHOMO` открывается в редакторе)
- Modify: `frontend/src/features/templates/CreateTemplateDialog.tsx` (выбор типа)
- Test: `frontend/test/base64.test.ts`, `frontend/test/mihomo-editor-page.test.tsx`,
  и дополнение `frontend/test/api-templates.test.ts`

**Interfaces:**
- Produces:
  - `encodeYaml(text: string): string` / `decodeYaml(base64: string): string` в
    `shared/lib/base64.ts`
  - `MihomoEditorPage` — компонент страницы (монтируется из `TemplateEditorPage`)
  - `useSaveTemplate(uuid)` принимает
    `{ templateJson?: unknown; encodedTemplateYaml?: string; name?: string; expectedHash: string }`
  - `useCreateTemplate()` принимает `{ name: string; templateType: 'XRAY_JSON' | 'MIHOMO' }`
- Consumes: `useMihomoDraft` (8), `EditorShell` (2), `MihomoTopology` (9),
  `MihomoInspector`/`MihomoSectionsDialog` (10), `YamlView` (11).

**Решение: base64 кодируется через `TextEncoder`, а не `btoa(text)` напрямую.** Шаблоны из
официального репозитория содержат кириллицу и эмодзи в именах групп (`🌍 VPN`), а `btoa`
на символе вне Latin-1 бросает `InvalidCharacterError`. Ошибка при этом всплыла бы не при
открытии, а при СОХРАНЕНИИ — то есть ровно тогда, когда пользователь уже сделал работу.

**Решение: `MIHOMO` открывается по тому же маршруту `/templates/:uuid`.** Тип шаблона
известен только после загрузки, и отдельный адрес пришлось бы угадывать в списке. Разводит
их `TemplateEditorPage` после запроса — там, где уже стоит проверка типа.

- [ ] **Step 1: Написать падающие тесты**

`frontend/test/base64.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodeYaml, encodeYaml } from '../src/shared/lib/base64'

describe('base64 для YAML-шаблонов', () => {
  it('круг сохраняет текст', () => {
    const text = 'proxy-groups:\n  - name: 🌍 VPN\n    type: select\n'
    expect(decodeYaml(encodeYaml(text))).toBe(text)
  })

  it('кириллица и эмодзи не роняют кодирование', () => {
    // btoa на этом бросает InvalidCharacterError — и бросил бы при сохранении,
    // когда работа уже сделана
    expect(() => encodeYaml('name: Основная 🌍')).not.toThrow()
  })

  it('декодирование понимает то, что кодирует панель', () => {
    // base64 от "a: б" в utf-8
    expect(decodeYaml('YTog0LE=')).toBe('a: б')
  })
})
```

`frontend/test/mihomo-editor-page.test.tsx` — страница целиком, с подменённым `fetch`
(тот же приём, что в `frontend/test/api-templates.test.ts`):

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from '../src/features/templates/TemplateEditorPage'
import { encodeYaml } from '../src/shared/lib/base64'
import { useDraftStore } from '../src/features/editor/draftStore'

const YAML = [
  'proxy-groups:',
  '  - name: Основная',
  '    type: select',
  '    proxies: # LEAVE THIS LINE!',
  'rules:',
  '  - MATCH,Основная',
  '',
].join('\n')

const HASH = 'h'.repeat(64)

function template(over: Record<string, unknown> = {}) {
  return {
    uuid: 'u-1',
    name: 'Мой Mihomo',
    templateType: 'MIHOMO',
    templateJson: null,
    encodedTemplateYaml: encodeYaml(YAML),
    ...over,
  }
}

/** Записанные запросы: тело PATCH — главное, что проверяют тесты ниже */
let calls: { url: string; init?: RequestInit }[] = []

function mockApi(responses: Record<string, { status: number; body: unknown }>) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`
      const res = responses[key] ?? { status: 200, body: {} }
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/templates/u-1']}>
        <Routes>
          <Route path="/templates/:uuid" element={<TemplateEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function patchBody(): Record<string, unknown> {
  const call = calls.find((c) => c.init?.method === 'PATCH')
  return JSON.parse(String(call?.init?.body ?? '{}'))
}

describe('страница редактора Mihomo', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    mockApi({ 'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } } })
  })
  afterEach(() => vi.restoreAllMocks())

  it('шаблон MIHOMO открывается в редакторе, а не отправляет в панель', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Мой Mihomo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument()
    expect(screen.queryByText(/Откройте его в панели/)).not.toBeInTheDocument()
  })

  it('правка через инспектор делает документ черновиком', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    await userEvent.click(screen.getByText('Основная'))
    await userEvent.click(await screen.findByRole('button', { name: /Ещё поля/ }))
    await userEvent.type(screen.getByLabelText('filter'), 'RU')
    expect(await screen.findByText('черновик')).toBeInTheDocument()
  })

  it('сохранение шлёт encodedTemplateYaml и expectedHash, а не templateJson', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'PATCH /api/templates/u-1': { status: 200, body: { template: template(), hash: 'n'.repeat(64) } },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    await userEvent.click(screen.getByRole('button', { name: 'YAML' }))
    // Правка идёт текстом: так тест не зависит от разметки форм
    const draftKey = 'template:u-1'
    useDraftStore.getState().setDraft(draftKey, `${YAML}mode: rule\n`, HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(patchBody().expectedHash).toBe(HASH))
    expect(patchBody().templateJson).toBeUndefined()
    expect(String(patchBody().encodedTemplateYaml)).toBe(encodeYaml(`${YAML}mode: rule\n`))
  })

  it('конфликт по хэшу предлагает загрузить версию панели или перезаписать', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'PATCH /api/templates/u-1': {
        status: 409,
        body: { message: 'конфликт', current: template(), hash: 'x'.repeat(64) },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore.getState().setDraft('template:u-1', `${YAML}mode: rule\n`, HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Конфликт версий')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Загрузить версию панели' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Перезаписать' })).toBeInTheDocument()
  })

  it('битый YAML блокирует сохранение, а предупреждения — нет', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    // MATCH ведёт в имя, которого нет среди групп — это предупреждение
    useDraftStore.getState().setDraft('template:u-1', 'rules:\n  - MATCH,Неизвестная\n', HASH)
    expect(await screen.findByRole('button', { name: 'Сохранить в панель' })).toBeEnabled()
    useDraftStore.getState().setDraft('template:u-1', 'proxy-groups:\n  - [\n', HASH)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить в панель' })).toBeDisabled(),
    )
  })

  it('шаблон другого YAML-типа по-прежнему ведёт в панель', async () => {
    mockApi({
      'GET /api/templates/u-1': {
        status: 200,
        body: { template: template({ templateType: 'CLASH' }), hash: HASH },
      },
    })
    renderPage()
    expect(await screen.findByText(/Откройте его в панели/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd frontend && npx vitest run test/base64.test.ts test/mihomo-editor-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Написать кодирование**

```ts
// base64 для содержимого YAML-шаблонов. Через TextEncoder, а не btoa(text):
// в живых шаблонах имена групп содержат кириллицу и эмодзи («🌍 VPN»), на
// которых btoa бросает InvalidCharacterError — причём при СОХРАНЕНИИ, когда
// работа уже сделана.

export function encodeYaml(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeYaml(base64: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
```

- [ ] **Step 4: Расширить хуки API**

`useSaveTemplate` — тип входа становится размеченным по содержимому, как на бэкенде:

```ts
export function useSaveTemplate(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    // Ровно одно из полей содержимого: бэкенд отвечает 400 на несовпадение с
    // типом шаблона, и отправлять оба — значит скрыть эту защиту от себя же
    mutationFn: (input: {
      templateJson?: unknown
      encodedTemplateYaml?: string
      name?: string
      expectedHash: string
    }) =>
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

`useCreateTemplate` получает `templateType` во входе и передаёт его дальше — роут уже
принимает это поле (`createSchema` в `backend/src/routes/templates.ts`).

- [ ] **Step 5: Написать страницу**

`MihomoEditorPage.tsx` — сестра `TemplateEditorPage`, отличия от неё ровно четыре:
содержимое берётся из `encodedTemplateYaml` через `decodeYaml`; сохранение шлёт
`encodedTemplateYaml: encodeYaml(draft.text)`; в топбаре есть кнопки «Проверить ядром»
(задача 13) и «Импорт» (задача 14); подписи вкладок — `{ graph: 'Топология', text: 'YAML' }`.

```tsx
function MihomoEditor({ template, hash }: { template: SubscriptionTemplate; hash: string }) {
  const qc = useQueryClient()
  // Шаблон, заведённый в панели и ни разу не заполненный, приходит с
  // encodedTemplateYaml: null — открываем его как пустой документ и говорим
  // об этом в статус-баре, как это делает редактор Xray-шаблона
  const panelText = template.encodedTemplateYaml === null
    ? ''
    : decodeYaml(template.encodedTemplateYaml)
  const draft = useMihomoDraft({ docKey: template.uuid, panelText, baseVersion: hash })
  const save = useSaveTemplate(template.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<{ template: SubscriptionTemplate; hash: string } | null>(null)

  // Тело doSave, обработка ConflictError, saveError и emptyNotice — дословно как
  // в TemplateEditorPage (features/templates/TemplateEditorPage.tsx), с одной
  // заменой: вместо `{ templateJson: draft.validation.config }` уходит
  // `{ encodedTemplateYaml: encodeYaml(draft.text) }`
  function doSave(expectedHash: string) {
    save.mutate(
      { encodedTemplateYaml: encodeYaml(draft.text), expectedHash },
      { /* onSuccess/onError — как у TemplateEditorPage */ },
    )
  }

  const blockedBySyntax = draft.issues.some(
    (i) => i.level === 'error' && i.message.startsWith(YAML_SYNTAX_PREFIX),
  )

  return (
    <EditorShell
      draft={draft}
      kind="templates"
      back={{ to: '/templates', label: '← Шаблоны' }}
      title={template.name}
      subtitle={`шаблон ${template.templateType}`}
      tabs={{ graph: 'Топология', text: 'YAML' }}
      actions={
        <>
          <Button variant="ghost" onClick={() => draft.setSectionsOpen(true)}>
            Секции документа
          </Button>
          <Button variant="ghost" onClick={() => draft.setCheckOpen(true)}>
            Проверить ядром
          </Button>
          <Button variant="ghost" onClick={() => draft.setImportOpen(true)}>
            Импорт
          </Button>
          <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>
            Geo-базы
          </Button>
        </>
      }
      canvas={…}
      textView={<div className="wb-canvas"><YamlView … /></div>}
      save={…}
    >
      {/* SaveDialog, диалог конфликта, MihomoSectionsDialog, MihomoCheckDialog,
          ImportTemplateDialog, GeoDataDialog */}
    </EditorShell>
  )
}
```

`canvas` собирается так же, как у `Workbench`: пустое состояние при `md === undefined`,
иначе `MihomoTopology` плюс `MihomoInspector` при выбранном узле.

**Важно про ошибки:** у Mihomo, в отличие от Xray, кнопка сохранения НЕ блокируется по
`draft.hasErrors`. Причина в природе диагностик: почти все они — предупреждения об именах,
которых редактор знать не может, а ошибкой считается только синтаксис YAML и кольцо групп.
Блокировать сохранение стоит ровно на синтаксисе: документ, который не разбирается, панель
примет, а подписка сломается. Условие — `draft.issues.some((i) => i.message.startsWith('Синтаксис YAML'))`;
завести для этого в `validate.ts` отдельный признак не нужно — но и строку сравнивать нельзя:
добавить в `parse.ts` экспорт `export const YAML_SYNTAX_PREFIX = 'Синтаксис YAML'` и
использовать его в обоих местах, иначе связь между ними держится на совпадении текста.

- [ ] **Step 6: Развести типы в `TemplateEditorPage` и открыть `MIHOMO` в списке**

В `TemplateEditorPage` проверка типа заменяется разводкой:

```tsx
  if (template.templateType === 'MIHOMO') {
    return <MihomoEditor key={template.uuid} template={template} hash={hash} />
  }
  if (template.templateType !== 'XRAY_JSON') {
    return ( /* прежняя карточка «откройте в панели», текст обновить:
               редактор умеет XRAY_JSON и MIHOMO */ )
  }
```

В `TemplatesPage` константа `EDITABLE` заменяется набором:

```tsx
// Редактор умеет два типа; остальные четыре держат содержимое в полях, которых
// он не разбирает, и правятся в панели
const EDITABLE: ReadonlySet<TemplateType> = new Set(['XRAY_JSON', 'MIHOMO'])
```
и `const editable = EDITABLE.has(template.templateType)`.

`CreateTemplateDialog` получает `SelectField` «Тип шаблона» с двумя вариантами
(`XRAY_JSON` — «Xray (JSON)», `MIHOMO` — «Mihomo (YAML)») и передаёт выбор в
`useCreateTemplate`. Значение по умолчанию — `XRAY_JSON`.

- [ ] **Step 7: Прогнать тесты**

Run: `npm test -w frontend && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src frontend/test
git commit -m "feat(frontend): mihomo template editor page and routing"
```

---

### Task 13: Проверка ядром

**Files:**
- Create: `frontend/src/features/diagnostics/MihomoCheckDialog.tsx`
- Modify: `frontend/src/shared/api/hooks.ts` (`useMihomoTest`)
- Modify: `frontend/src/shared/api/types.ts` (`MihomoTestResult`)
- Test: `frontend/test/mihomo-check-dialog.test.tsx`

**Interfaces:**
- Produces:
  - `interface MihomoTestResult { available: boolean; ok: boolean; errors: string[] }` —
    зеркало типа бэкенда (`backend/src/mihomo/service.ts`)
  - `useMihomoTest()` — мутация на `POST /api/tools/mihomo-test` с телом
    `{ encodedTemplateYaml }`
  - `MihomoCheckDialog({ open, text, onClose })`
- Consumes: `encodeYaml` (задача 12).

**Три состояния отчёта, и все три обязаны читаться по-разному:**

| Ответ | Что показываем |
|---|---|
| `available: false` | «Бинарь mihomo не установлен» — это не ошибка шаблона; объяснить, что проверка недоступна, и что переменная называется `MIHOMO_BIN` |
| `ok: true` | «Ядро приняло шаблон» + обязательная оговорка: проверена СТРУКТУРА с фиктивными серверами, а не работоспособность конкретных хостов (прямое требование спеки) |
| `ok: false` | Список строк из `errors` моноширинным блоком |
| HTTP 400 | Русский текст бэкенда «Не удалось разобрать шаблон как YAML» — приходит обычной ошибкой мутации |

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-check-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MihomoCheckDialog } from '../src/features/diagnostics/MihomoCheckDialog'
import { encodeYaml } from '../src/shared/lib/base64'

const YAML = 'rules:\n  - MATCH,DIRECT\n'
let bodies: string[] = []

function mockCheck(status: number, body: unknown) {
  bodies = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderDialog(text = YAML) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MihomoCheckDialog open text={text} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('отчёт проверки ядром Mihomo', () => {
  afterEach(() => vi.restoreAllMocks())

  it('нет бинаря — инструмент недоступен, а не шаблон плохой', async () => {
    mockCheck(200, { available: false, ok: false, errors: [] })
    renderDialog()
    expect(await screen.findByText(/Проверка ядром недоступна/)).toBeInTheDocument()
    expect(screen.getByText(/MIHOMO_BIN/)).toBeInTheDocument()
    expect(screen.queryByText(/ядро отклонило/i)).not.toBeInTheDocument()
  })

  it('успех сопровождается оговоркой про фиктивные серверы', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog()
    expect(await screen.findByText(/Ядро приняло шаблон/)).toBeInTheDocument()
    // Требование спеки: в отчёте прямо сказано, ЧТО именно проверено
    expect(screen.getByText(/фиктивн/i)).toBeInTheDocument()
  })

  it('ошибки ядра показаны построчно', async () => {
    mockCheck(200, {
      available: true,
      ok: false,
      errors: ['proxy 0: unsupported type', 'rules[2]: invalid rule'],
    })
    renderDialog()
    expect(await screen.findByText('proxy 0: unsupported type')).toBeInTheDocument()
    expect(screen.getByText('rules[2]: invalid rule')).toBeInTheDocument()
  })

  it('невалидный YAML показывает русский текст бэкенда, а не «неизвестная ошибка»', async () => {
    mockCheck(400, { message: 'Не удалось разобрать шаблон как YAML' })
    renderDialog('proxy-groups: [')
    expect(await screen.findByText('Не удалось разобрать шаблон как YAML')).toBeInTheDocument()
  })

  it('шаблон уходит на проверку в base64', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog()
    await screen.findByText(/Ядро приняло шаблон/)
    expect(JSON.parse(bodies[0]!).encodedTemplateYaml).toBe(encodeYaml(YAML))
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**; **Step 3: Написать хук и диалог**;
  **Step 4: Прогнать тесты**

Run: `cd frontend && npx vitest run test/mihomo-check-dialog.test.tsx && cd .. && npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/test/mihomo-check-dialog.test.tsx
git commit -m "feat(frontend): mihomo core check report dialog"
```

---

### Task 14: Импорт из каталога

Диалог достаётся обоим редакторам шаблонов: каталог отдаёт все типы, и редактору Xray он
нужен ровно так же. Это решение спеки, и оно бесплатно — фильтр по типу открытого документа
уже есть в требованиях.

**Files:**
- Create: `frontend/src/features/templates/ImportTemplateDialog.tsx`
- Modify: `frontend/src/shared/api/hooks.ts` (`useCatalog`, `useCatalogTemplate`)
- Modify: `frontend/src/shared/api/types.ts` (`CatalogEntry`)
- Modify: `frontend/src/features/templates/TemplateEditorPage.tsx` (кнопка «Импорт» у Xray)
- Test: `frontend/test/import-template-dialog.test.tsx`

**Interfaces:**
- Produces:
  - `interface CatalogEntry { name: string; type: string; author: string; url: string }` —
    поле `type` именно `string`, а не `TemplateType`: каталог опережает контракт панели
    (`SINGBOX_LEGACY`), и сужение типа уронило бы список на незнакомом значении
  - `useCatalog()` — `GET /api/catalog/templates`
  - `useCatalogTemplate(url: string | null)` — `GET /api/catalog/template?url=…`, включается
    только когда выбрана запись
  - `ImportTemplateDialog({ open, docType, dirty, onImport, onClose })`, где
    `docType: TemplateType` — тип открытого документа, `dirty: boolean` — есть ли что
    затирать, `onImport: (content: string) => void`
- Consumes: роуты каталога бэкенда (готовы планом 1).

**Четыре решения:**

1. **По умолчанию показываются шаблоны типа открытого документа**, но фильтр переключается на
   «все»: смотреть чужой шаблон полезно, а импортировать — нет. Запись несовпадающего типа
   показана, но кнопка импорта у неё выключена с объяснением.
2. **Незнакомый тип не ломает список.** Прямое требование спеки: `SINGBOX_LEGACY` есть в
   каталоге и отсутствует в контракте. Такая запись показывается с пометкой
   «тип не поддерживается редактором».
3. **Импорт — это правка черновика, а не сохранение.** Загруженный текст уходит в
   `writeDraft(text, { history: true })`: пользователь видит его в редакторе, может отменить
   через Ctrl+Z и решает сам, сохранять ли в панель. Прямая запись в панель была бы
   необратимой операцией по одному клику в диалоге.
4. **Импорт поверх изменённого черновика спрашивает подтверждение** — он затирает документ
   целиком, а `dirty` означает, что затирать есть что.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/import-template-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportTemplateDialog } from '../src/features/templates/ImportTemplateDialog'
import { selectOption } from './helpers'

const CATALOG = {
  templates: [
    { name: 'mihomo-default', type: 'MIHOMO', author: 'remnawave', url: 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml' },
    { name: 'xray-default', type: 'XRAY_JSON', author: 'remnawave', url: 'https://raw.githubusercontent.com/remnawave/templates/main/b.json' },
    // Каталог опережает контракт панели: этого типа в SUBSCRIPTION_TEMPLATE_TYPE нет
    { name: 'singbox-legacy', type: 'SINGBOX_LEGACY', author: 'someone', url: 'https://raw.githubusercontent.com/remnawave/templates/main/c.json' },
  ],
}

function mockCatalog(over: { list?: { status: number; body: unknown } } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const hit = url.includes('/api/catalog/template?')
        ? { status: 200, body: { content: 'mode: rule\nrules:\n  - MATCH,DIRECT\n' } }
        : (over.list ?? { status: 200, body: CATALOG })
      return new Response(JSON.stringify(hit.body), {
        status: hit.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderDialog(props: Partial<Parameters<typeof ImportTemplateDialog>[0]> = {}) {
  const onImport = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ImportTemplateDialog open docType="MIHOMO" dirty={false} onImport={onImport} onClose={() => {}} {...props} />
    </QueryClientProvider>,
  )
  return onImport
}

describe('импорт шаблона из каталога', () => {
  afterEach(() => vi.restoreAllMocks())

  it('по умолчанию показывает шаблоны типа открытого документа', async () => {
    mockCatalog()
    renderDialog()
    expect(await screen.findByText('mihomo-default')).toBeInTheDocument()
    expect(screen.queryByText('xray-default')).not.toBeInTheDocument()
  })

  it('переключение фильтра показывает все, включая незнакомый тип', async () => {
    mockCatalog()
    renderDialog()
    await screen.findByText('mihomo-default')
    await selectOption('Тип', 'all')
    expect(screen.getByText('xray-default')).toBeInTheDocument()
    // Незнакомый тип обязан попасть в список, а не уронить его
    expect(screen.getByText('singbox-legacy')).toBeInTheDocument()
  })

  it('незнакомый тип помечен и импортировать его нельзя', async () => {
    mockCatalog()
    const onImport = renderDialog()
    await screen.findByText('mihomo-default')
    await selectOption('Тип', 'all')
    await userEvent.click(screen.getByText('singbox-legacy'))
    expect(screen.getByText(/не поддерживается редактором/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Импортировать в редактор' })).toBeDisabled()
    expect(onImport).not.toHaveBeenCalled()
  })

  it('выбор записи подгружает содержимое в предпросмотр', async () => {
    mockCatalog()
    renderDialog()
    await userEvent.click(await screen.findByText('mihomo-default'))
    expect(await screen.findByText(/MATCH,DIRECT/)).toBeInTheDocument()
  })

  it('импорт отдаёт содержимое наружу, а не сохраняет в панель', async () => {
    mockCatalog()
    const onImport = renderDialog()
    await userEvent.click(await screen.findByText('mihomo-default'))
    await userEvent.click(await screen.findByRole('button', { name: 'Импортировать в редактор' }))
    expect(onImport).toHaveBeenCalledWith('mode: rule\nrules:\n  - MATCH,DIRECT\n')
    // Ни одного PATCH: решение сохранять остаётся за пользователем
    expect(
      (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.some(
        ([, init]) => init?.method === 'PATCH',
      ),
    ).toBe(false)
  })

  it('поверх черновика спрашивает подтверждение', async () => {
    mockCatalog()
    const onImport = renderDialog({ dirty: true })
    await userEvent.click(await screen.findByText('mihomo-default'))
    await userEvent.click(await screen.findByRole('button', { name: 'Импортировать в редактор' }))
    expect(onImport).not.toHaveBeenCalled()
    expect(screen.getByText(/затрёт ваши правки/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Затереть и импортировать' }))
    expect(onImport).toHaveBeenCalledOnce()
  })

  it('недоступность GitHub показывает русский текст, а не пустой список', async () => {
    mockCatalog({ list: { status: 502, body: { message: 'Каталог шаблонов недоступен: GitHub ответил 503' } } })
    renderDialog()
    expect(await screen.findByText(/Каталог шаблонов недоступен/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**; **Step 3: Написать хуки и диалог**

Разметка: список записей слева (имя, автор, чип типа), предпросмотр справа
(`<pre>` с первыми строками содержимого, моноширинный, с прокруткой), внизу — фильтр по типу
и кнопка «Импортировать в редактор». Компоненты — существующие `Dialog`, `Select`, `Chip`,
`Button`, `EmptyState`.

- [ ] **Step 4: Подключить в обоих редакторах**

В `MihomoEditorPage` — кнопка «Импорт» уже стоит (задача 12), обработчик:
`(content) => draft.writeDraft(content, { history: true })`. В `TemplateEditorPage` (Xray)
добавляется такая же кнопка в `actions` `Workbench` с тем же обработчиком.

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test -w frontend && npm run typecheck -w frontend`

```bash
git add frontend/src frontend/test/import-template-dialog.test.tsx
git commit -m "feat(frontend): import templates from the remnawave catalog"
```

### Task 15: Трассировка Mihomo

Куда уйдёт домен или адрес: проход по правилам сверху вниз до первого совпавшего.

**Files:**
- Create: `frontend/src/entities/mihomo/trace.ts`
- Create: `frontend/src/features/diagnostics/MihomoTracePanel.tsx`
- Modify: `frontend/src/features/editor/useMihomoDraft.ts` (поле `trace`)
- Modify: `frontend/src/features/templates/MihomoEditorPage.tsx` (панель и строка ввода)
- Modify: `frontend/src/features/topology/mihomoNodes.tsx` (вердикт на карточке правила)
- Modify: `frontend/src/features/topology/MihomoTopology.tsx` (пропы `dockExtra`/`dockRow`)
- Test: `frontend/test/mihomo-trace.test.ts`, `frontend/test/mihomo-trace-panel.test.tsx`

**Пропуск, найденный при исполнении задачи 9 и закрытый здесь:** `MihomoTopology` задачи 9
не принимает `dockExtra`/`dockRow` — в её брифе этих пропов нет, и правильно, что нет: до
трассировки их нечем наполнять. Но панель трассировки и строка ввода живут именно в доке, поэтому
пропы добавляются здесь, по образцу того, как их принимает `TopologyView` у Xray.

**Interfaces:**
- Consumes: `matchDomainPattern` не подходит (у Xray другой синтаксис шаблонов), а вот
  `ipInCidr`, `matchPortField`, `isIpAddress`, типы `MatchState`, `GeoAnswers`, `TraceTarget`
  из `entities/xray/traceMatch.ts` переиспользуются как есть — geo-данные общие с Xray,
  и второй разбор CIDR был бы второй копией той же арифметики.
- Produces:
  ```ts
  export interface MihomoRuleVerdict {
    index: number
    state: MatchState
    target?: string
    /** Почему правило не проверено (state === 'unknown') */
    reason?: string
  }
  export interface MihomoTraceResult {
    verdicts: MihomoRuleVerdict[]
    /** ruleIndex === null — ни одно правило не совпало и MATCH в списке нет */
    winner?: { ruleIndex: number | null; target: string }
    /** Правило, на котором проход остановлен: проверить его редактор не может */
    stopped?: { index: number; reason: string }
    caveats: string[]
  }
  export function traceMihomo(md: MihomoDoc, target: TraceTarget, geo: GeoAnswers): MihomoTraceResult
  export function geoKeysOfMihomo(md: MihomoDoc): string[]
  ```

**Что вычисляется и что нет — граница честная и показана в интерфейсе:**

| Типы правил | Поведение |
|---|---|
| `DOMAIN`, `DOMAIN-SUFFIX`, `DOMAIN-KEYWORD`, `DOMAIN-WILDCARD`, `DOMAIN-REGEX` | вычисляется по адресу |
| `IP-CIDR`, `IP-CIDR6` | вычисляется, когда задан ip; иначе `unknown` |
| `DST-PORT`, `NETWORK`, `MATCH` | вычисляется |
| `GEOSITE`, `GEOIP` | вычисляется ответом geo-бэкенда; ответа нет — `unknown` |
| `AND`, `OR`, `NOT` | вычисляется рекурсивно из перечисленного выше |
| `RULE-SET` | **останавливает** проход: набор лежит удалённо, и скачивать его редактор не станет |
| `IP-SUFFIX`, `IP-ASN`, `SRC-*`, `IN-*`, `PROCESS-*`, `UID`, `DSCP`, `SUB-RULE` | **останавливают** проход: данных для проверки нет в цели трассировки |

**Решение: непроверяемое правило останавливает проход, а не пропускается.** Прямое
требование спеки, и причина в нём же: молчаливый пропуск дал бы уверенный неверный ответ.
Правило выше по списку могло бы совпасть, и всё, что ниже, тогда не выполняется вовсе —
показывать победителя из этого «ниже» значит врать.

- [ ] **Step 1: Написать падающий тест**

`frontend/test/mihomo-trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { geoKeysOfMihomo, traceMihomo } from '../src/entities/mihomo/trace'
import type { GeoAnswers, TraceTarget } from '../src/entities/xray'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const T = (over: Partial<TraceTarget> = {}): TraceTarget => ({
  address: 'a.com',
  port: 443,
  network: 'tcp',
  ...over,
})

function doc(...rules: string[]): ReturnType<typeof parseMihomo> {
  return parseMihomo(['rules:', ...rules.map((r) => `  - ${r}`), ''].join('\n'))
}

describe('трассировка Mihomo', () => {
  it('первое совпавшее правило побеждает', () => {
    const res = traceMihomo(doc('DOMAIN-SUFFIX,b.com,B', 'DOMAIN-SUFFIX,a.com,A', 'MATCH,D'), T(), NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'A' })
    expect(res.verdicts[0]!.state).toBe('no')
  })

  it('MATCH ловит всё, если выше не совпало', () => {
    const res = traceMihomo(doc('DOMAIN,zzz.com,Z', 'MATCH,D'), T(), NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('без MATCH и без совпадений победителя нет', () => {
    const res = traceMihomo(doc('DOMAIN,zzz.com,Z'), T(), NO_GEO)
    expect(res.winner?.ruleIndex ?? null).toBeNull()
    expect(res.caveats.join(' ')).toMatch(/MATCH/)
  })

  it('порт и сеть учитываются', () => {
    expect(traceMihomo(doc('DST-PORT,443,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    expect(traceMihomo(doc('NETWORK,udp,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
  })

  it('IP-CIDR без адреса не вычисляется и останавливает проход', () => {
    const res = traceMihomo(doc('IP-CIDR,10.0.0.0/8,A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.winner).toBeUndefined()
    expect(res.stopped?.reason).toMatch(/адрес/i)
  })

  it('IP-CIDR с адресом вычисляется', () => {
    const res = traceMihomo(doc('IP-CIDR,10.0.0.0/8,A', 'MATCH,D'), T({ ip: '10.1.2.3' }), NO_GEO)
    expect(res.winner?.target).toBe('A')
  })

  it('GEOSITE отвечает по данным базы', () => {
    const geo: GeoAnswers = { loaded: true, answers: { 'geosite:youtube': true }, missing: [] }
    const res = traceMihomo(doc('GEOSITE,youtube,A', 'MATCH,D'), T(), geo)
    expect(res.winner?.target).toBe('A')
    expect(geoKeysOfMihomo(doc('GEOSITE,youtube,A', 'GEOIP,ru,B'))).toEqual([
      'geosite:youtube',
      'geoip:ru',
    ])
  })

  it('RULE-SET останавливает проход с объяснением', () => {
    const res = traceMihomo(doc('RULE-SET,ads,REJECT', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/набор правил/i)
  })

  it('логическое правило вычисляется из вложенных условий', () => {
    const and = 'AND,((DOMAIN-SUFFIX,a.com),(NETWORK,tcp)),A'
    expect(traceMihomo(doc(and, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    const or = 'OR,((DOMAIN,zzz.com),(DST-PORT,443)),A'
    expect(traceMihomo(doc(or, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    const not = 'NOT,((DOMAIN,zzz.com)),A'
    expect(traceMihomo(doc(not, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
  })

  it('непроверяемое вложенное условие останавливает логическое правило целиком', () => {
    const res = traceMihomo(doc('AND,((DOMAIN,a.com),(UID,1000)),A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
  })

  it('на эталонных шаблонах проход не падает и доходит до вердикта', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      const res = traceMihomo(md, T(), NO_GEO)
      expect(res.verdicts.length, name).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd frontend && npx vitest run test/mihomo-trace.test.ts`
Expected: FAIL — модуля `trace` нет.

- [ ] **Step 3: Написать трассировку**

Ключевые части реализации:

```ts
/**
 * Логическое правило прячет условия в скобках: `AND,((DOMAIN,a),(NETWORK,udp)),T`.
 * Разбираем ровно один уровень: внешние скобки снимаются, содержимое режется по
 * запятым ВЕРХНЕГО уровня (splitTopLevel уже умеет считать глубину), каждый
 * кусок — это `(ТИП,значение)`. Вложенные логические условия внутри логических
 * встречаются, и рекурсия здесь бесплатна: тот же разбор на элементе.
 */
function parseConditions(payload: string): { type: string; payload?: string }[] | null {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null
  const inner = trimmed.slice(1, -1)
  const parts = splitTopLevel(inner).map((p) => p.trim())
  const out: { type: string; payload?: string }[] = []
  for (const part of parts) {
    if (!part.startsWith('(') || !part.endsWith(')')) return null
    const [type, ...rest] = splitTopLevel(part.slice(1, -1))
    if (type === undefined) return null
    out.push({ type: type.trim(), payload: rest.join(',') || undefined })
  }
  return out
}

/** Домен по шаблону конкретного типа правила Mihomo */
function matchDomain(type: string, pattern: string, address: string): MatchState {
  const a = address.toLowerCase()
  const p = pattern.toLowerCase()
  if (type === 'DOMAIN') return a === p ? 'yes' : 'no'
  if (type === 'DOMAIN-SUFFIX') return a === p || a.endsWith(`.${p}`) ? 'yes' : 'no'
  if (type === 'DOMAIN-KEYWORD') return a.includes(p) ? 'yes' : 'no'
  if (type === 'DOMAIN-WILDCARD') {
    // Подстановка ядра: * — любой сегмент, + — один и более символов
    const re = new RegExp(`^${p.replace(/[.]/g, '\\.').replace(/\*/g, '[^.]*').replace(/\+/g, '.+')}$`)
    return re.test(a) ? 'yes' : 'no'
  }
  if (type === 'DOMAIN-REGEX') {
    // Регулярка автора шаблона может быть невалидной для JS — это не повод
    // падать: честно говорим «проверить не могу»
    try {
      return new RegExp(pattern).test(address) ? 'yes' : 'no'
    } catch {
      return 'unknown'
    }
  }
  return 'unknown'
}
```

Проход по правилам: для каждого `RuleEntry` получить вердикт через `verdictOf(rule)`.
`'no'` — идём дальше; `'yes'` — победитель, останавливаемся; `'unknown'` — заполняем
`stopped` с причиной и прекращаем проход. Правила ниже остановки в `verdicts` не попадают:
их состояние неизвестно не потому, что они не совпали, а потому, что до них не дошли.

`caveats` наполняются условными формулировками: отсутствие `MATCH` («трафик, не подошедший
ни под одно правило, пойдёт напрямую»), незагруженная geo-база, цель-имя, которого нет среди
групп и провайдеров («возможно, это имя хоста от панели — тогда правило разрешится, но
редактор не может это подтвердить»).

- [ ] **Step 4: Подключить к черновику и интерфейсу**

В `useMihomoDraft` — та же схема, что у `useConfigDraft`: `useDebounced(core.traceTarget, 600)`,
`useGeoMatch({ domain, ip, keys: geoKeysOfMihomo(md) })`, `trace = traceMihomo(...)`.
В `MihomoEditorPage` — кнопка «Куда пойдёт трафик» в `dockExtra` графа и существующий
`TraceBar` (он работает с `TraceTarget` и от вида документа не зависит).
`MihomoTracePanel` — по образцу `TracePanel`: список вердиктов, победитель, оговорки, и
отдельным блоком — объяснение остановки, если она была. Клик по правилу выбирает узел.
В `mihomoNodes.tsx` карточка правила получает бейдж вердикта (`traceState` в data), как у
Xray: победитель отделён от обычного совпадения.

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test -w frontend && npm run typecheck -w frontend`

```bash
git add frontend/src frontend/test
git commit -m "feat(frontend): mihomo route tracing"
```

---

### Task 16: Сквозные сценарии и документация

**Files:**
- Create: `frontend/e2e/mihomo.spec.ts`
- Modify: `frontend/e2e/mocks.ts` (шаблон `MIHOMO`, каталог, проверка ядром)
- Modify: `CLAUDE.md`
- Modify: `README.md` (строка про `MIHOMO_BIN` уже есть — дописать про импорт и редактор)

**Interfaces:** только сценарии; нового кода продукта здесь нет.

- [ ] **Step 1: Дописать моки e2e**

В `frontend/e2e/mocks.ts` добавить: шаблон типа `MIHOMO` с `encodedTemplateYaml` (base64 от
компактного, но настоящего документа — группа с маркером, провайдер, три правила), ответы
`GET /api/catalog/templates` (три записи, включая одну типа `SINGBOX_LEGACY`),
`GET /api/catalog/template`, `POST /api/tools/mihomo-test`.

- [ ] **Step 2: Написать сценарии**

`frontend/e2e/mihomo.spec.ts` — пять сценариев, по одному на требование спеки:

```ts
import { expect, test } from '@playwright/test'
import { MIHOMO_UUID, MIHOMO_YAML, mockApi } from './mocks'
import { pickOption } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/templates/${MIHOMO_UUID}`)
  await expect(page.locator('.react-flow__node[data-id="group:Основная"]')).toBeVisible()
})

test('шаблон Mihomo открывается в редакторе, а не ведёт в панель', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'YAML' })).toBeVisible()
  await expect(page.getByText('Откройте его в панели')).toHaveCount(0)
})

test('правка группы правит документ точечно и не трогает маркер', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="group:Основная"]').click()
  await page.getByRole('button', { name: /Ещё поля/ }).click()
  await page.getByLabel('filter').fill('RU')
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'YAML' }).click()
  const text = await page.locator('.cm-content').innerText()
  // Главное свойство архитектуры, проверенное через настоящий интерфейс: правка
  // формы — сплайс, а не перепечатка. Строк стало ровно на одну больше (новый
  // ключ), и маркер подстановки на месте — иначе панель перестанет подставлять
  // серверы, а редактор при этом останется зелёным
  expect(text.split('\n').length).toBe(MIHOMO_YAML.split('\n').length + 1)
  expect(text).toContain('# LEAVE THIS LINE!')
  expect(text).toContain('filter: RU')
})

test('сохранение шлёт encodedTemplateYaml, конфликт по хэшу предлагает выбор', async ({ page }) => {
  const patches: string[] = []
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    patches.push(route.request().postData() ?? '')
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'конфликт', current: {}, hash: 'x'.repeat(64) }),
    })
  })

  await page.locator('.react-flow__node[data-id="group:Основная"]').click()
  await page.getByRole('button', { name: /Ещё поля/ }).click()
  await page.getByLabel('filter').fill('RU')
  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  expect(JSON.parse(patches[0]!)).toMatchObject({ encodedTemplateYaml: expect.any(String) })
  expect(JSON.parse(patches[0]!).templateJson).toBeUndefined()
  await expect(page.getByText('Конфликт версий')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Загрузить версию панели' })).toBeVisible()
})

test('проверка ядром показывает отчёт с оговоркой про фиктивные серверы', async ({ page }) => {
  await page.getByRole('button', { name: 'Проверить ядром' }).click()
  await expect(page.getByText('Ядро приняло шаблон')).toBeVisible()
  await expect(page.getByText(/фиктивн/i)).toBeVisible()
})

test('импорт из каталога подставляет содержимое в редактор, а не в панель', async ({ page }) => {
  const patches: string[] = []
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() === 'PATCH') patches.push('patch')
    await route.fallback()
  })

  await page.getByRole('button', { name: 'Импорт' }).click()
  await page.getByText('mihomo-default').click()
  await page.getByRole('button', { name: 'Импортировать в редактор' }).click()

  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
  // Импорт правит черновик: в панель ничего не ушло, и Ctrl+Z возвращает как было
  expect(patches).toHaveLength(0)
  await page.keyboard.press('Control+z')
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)
})
```

Сценарий правки — тот самый инвариант, что тесты локальности в vitest, но проверенный через
настоящий интерфейс: именно на связке «форма → правка → документ» ломается всё, если кто-то
в ней вернётся к перепечатке, а обычные проверки при этом останутся зелёными.

- [ ] **Step 3: Прогнать e2e**

Run: `npm run e2e -w frontend`
Expected: PASS. Известная особенность окружения: первый тест в каждом spec-файле может
упереться в холодную компиляцию Vite и упасть на ожидании первого узла. Это дефект среды, а
не продукта (воспроизводится и на коммитах без этих изменений). Если он мешает — прогнать
файл отдельно; чинить общий таймаут в этой задаче не нужно, это отдельная работа на общей
ветке.

- [ ] **Step 4: Обновить `CLAUDE.md`**

Дописать в раздел про фронтенд:

- **Оболочка редактора разобрана на три слоя** и параметризована `DocumentAdapter`:
  `useDocumentDraft` (черновик, история, вкладки, выбор, поиск, хоткеи — без знания о виде
  документа), `EditorShell` (топбар, сцена со слотами, статус-бар, общие диалоги),
  `GraphCanvas` (React Flow, позиции, фокус, патчбей, док). Xray и Mihomo — две сборки поверх
  них: `useConfigDraft` + `Workbench` + `TopologyView` и `useMihomoDraft` + `MihomoEditorPage`
  + `MihomoTopology`. Правка общего слоя обязана оставлять тесты Xray нетронутыми — они
  контрольная группа этого разреза.
- **Словарь `entities/mihomo/docSchema.ts` питает и формы, и подсказки** — в отличие от Xray,
  где словарь и формы разведены намеренно. Причина: поле формы Mihomo — плоская пара
  «ключ → скаляр» в отображении, и два описания одного и того же разъезжались бы.
- **Подсказки YAML идут по дереву библиотеки `yaml`, а не по дереву CodeMirror.** У Xray
  резолвер обязан звать `ensureSyntaxTree` с бюджетом, потому что снимок `syntaxTree`
  отстаёт от текста; здесь этой развилки нет — `parseMihomo` разбирает актуальный текст
  синхронно и целиком.
- **Сохранение шаблона Mihomo** шлёт `encodedTemplateYaml` (base64 через `TextEncoder`, не
  `btoa`: в именах групп живых шаблонов есть кириллица и эмодзи) и тот же `expectedHash`.
  Кнопка сохранения блокируется только на синтаксической ошибке YAML: остальные диагностики —
  предупреждения об именах, которых редактор знать не может.
- **Трассировка Mihomo останавливается** на правиле, которое не может проверить
  (`RULE-SET`, `PROCESS-*`, `SRC-*`, `UID`, `IN-*`, `SUB-RULE`), и говорит об этом. Молчаливый
  пропуск дал бы уверенный неверный ответ.
- **Импорт из каталога** правит черновик, а не панель: загруженный текст уходит в
  `writeDraft` с записью в историю, и решение сохранять остаётся за пользователем.

- [ ] **Step 5: Прогнать всё и закоммитить**

Run: `npm test && npm run typecheck -w backend && npm run typecheck -w frontend && npm run e2e -w frontend`

```bash
git add frontend/e2e CLAUDE.md README.md
git commit -m "test(frontend): mihomo end-to-end scenarios and docs"
```

---

## Проверка плана

Самопроверка по разделам спеки — что каким пунктом закрыто.

| Требование спеки | Где |
|---|---|
| Модель `entities/mihomo` (разбор, схемы, правила, группы, подстановка, разрешение имён) | план 1 |
| Правки сплайсами, идемпотентность, локальность, отказ на якорях | план 1 (задачи 5–7), расширено задачами 4 и 7 |
| Адаптер документа, обобщение `useConfigDraft`/`Workbench` | задачи 1–3 |
| Тесты Xray не меняются | глобальное ограничение, проверяется в задачах 1, 2, 3 |
| Граф: колонки правила → группы → выходы, циклы, `rule-providers` не узлы | план 1 + задачи 4 (раскладка) и 9 (карточки, колонки) |
| `sub-rules` группой правил в колонке правил | задача 9 — план 1 их не рисовал вовсе, это найденный самопроверкой пробел |
| Коммутация кабелем и объяснение отказа | задачи 4 и 9 |
| Страница `MihomoEditorPage` | задача 12 |
| Формы инспектора: группа, правило, провайдер, набор правил, `dns`/`tun`/`sniffer`/глобальные | задача 10 |
| Текстовая вкладка с подсказками и наведением | задача 11 |
| `ImportTemplateDialog`, доступный и редактору Xray | задача 14 |
| Отчёт проверки ядром | задача 13 |
| Диагностики с путём массивом, клик по проблеме | задача 6 (адресация) + план 1 (`validate.ts`) |
| Трассировка с честными границами | задача 15 |
| `TemplatesPage` перестаёт вести `MIHOMO` в панель | задача 12 |
| Сохранение `encodedTemplateYaml` с `expectedHash` | задача 12 |
| Бэкенд: хэш по типу, разметка тела `PATCH`, каталог, проверка ядром, `Dockerfile` | план 1 |
| Тесты: фикстуры, побайтовость, локальность, отказ на якорях, бэкенд, e2e | план 1 + задачи 7, 16 |
| Дизайн-система не расширяется | глобальное ограничение |

**Долги плана 1:** причина отказа коммутации — задача 4; раскладка по вертикали — задача 4;
тип правила в проверке допустимости соединения — задача 9; `walkScalars` на объект-опции —
задача 4. Мелочи из того же раздела (расхождение адресации группы по имени при дубликатах,
подстрочная проверка в тесте фиктивных серверов, хэш `XRAY_BASE64`, узел группы с именем
встроенной цели, тест приоритета в списке якорей) сознательно оставлены: ни одна не мешает
задачам этого плана, а разгребание их здесь размыло бы его границы. Они остаются в разделе
долгов плана 1 как открытые.

**Вне охвата этого плана** (подтверждается спекой): редакторы `CLASH`, `STASH`, `SINGBOX`,
`XRAY_BASE64`; рецепты для Mihomo; скачивание `RULE-SET` ради трассировки; редактирование
значений, приходящих через якоря, из форм.

**Известный дефект среды, не входящий в план:** первый тест в каждом e2e-файле падает под
нагрузкой на ожидании первого узла графа — Vite не успевает скомпилировать модули за
отведённые проверке 5 секунд. Воспроизводится и без изменений этого плана (проверено на
коммите `ebfefb8`). Лечится запасом на ожидания либо прогревом dev-сервера в
`frontend/playwright.config.ts` — отдельной работой, чтобы не смешивать её с этой веткой.

---

## Что осталось после финального ревью

План выполнен целиком и влит в `dev`. Ниже — находки, осознанно НЕ закрытые в этой ветке: каждая
разобрана, у каждой названа цена. Это не забытые дефекты, а отложенные решения; любое можно
оспорить.

> **Восемь из них закрыты позже, отдельными коммитами в `dev`** (2026-09-08, перед началом трека
> sing-box): три объявления, которых никто не читает (`textTabLabel`, `storageKey` в
> `EditorShellDraft`, умолчание `emptyLabel`); два инварианта, переехавшие из комментария в тип
> (`useSaveTemplate`, `docType`); навигация к синтаксической ошибке YAML (`ValidationIssue.at`);
> заглушка содержимого у записи MIHOMO в списке моков e2e; комментарий про повтор в
> `intellisense.test.ts`.
>
> **Следом закрыты ещё две:** содержимое подсписков `sub-rules` теперь проверяется теми же
> правилами, что и основной список (ветка `sub-rules` в резолвере графа обрела производителя),
> и дополнен словарь — `sniffer.skip-src-address`, а заодно `sniffer.force-domain`, которого в
> записи не было, плюс четыре значения `global-client-fingerprint`.
>
> **И причина, из-за которой всё это было трудно проверять:** полный прогон фронтенда краснел
> от загрузки машины, а не от кода. Два потолка стояли ниже честной цены тестов — `testTimeout`
> (5 с при цене 3.0–4.6 с) и ожидание `findBy*` (1 с при цене 1066 мс), — а
> `intellisense.test.ts` вдобавок гонялся со стенными часами `ensureSyntaxTree`. Проверено на
> воспроизведении: два одновременных полных прогона, раньше 6–12 падений, теперь ноль.
>
> **И наконец остаток, разобранный перед sing-box (2026-09-09).** Связь `winner`/`stopped`
> переехала из соглашения в тип (`MihomoTraceOutcome`), и мёртвая защитная ветка панели ушла
> вместе с надобностью в ней. Диагностика, адресованная именем, печатается один раз на имя:
> дубль ключа в `proxy-providers`/`sub-rules` давал два одинаковых предупреждения, а о самом
> дубле и без нас говорит разбор YAML своей ошибкой. Форматтер размера остался один
> (`formatBytes`). Наведение описывает ключи-разделы — те самые `dns`, `rules`, `proxies`, на
> которых редактор молчал, хотя при наборе их же и описывал.
>
> **Док Xray на узких окнах — измерено, потом починено.** Первая строка дока не сжимается:
> 1107px у профиля и 1145px у шаблона Xray против 565px у Mihomo — потому проверку и прошёл
> только Mihomo. На окне 1100px край дока профиля стоял на 1104, на 900px — на 1004: кнопки за
> обоими краями экрана. Теперь строка переносится, а ширина названа явно — без `max-content`
> перенос обнуляет min-content дока, и панель React Flow сжимается до половины холста.
>
> Открытым осознанно оставлен `key={index}` в `MihomoRuleForm`: портятся только эфемерные
> надписи формы, дефект описан в коде, а ключ по содержимому пересоздавал бы поле под кареткой.
>
> Остальное в этом разделе — по-прежнему открыто.

### Мёртвый код, который сам себе противоречит
- **`DocumentAdapter.textTabLabel` не читается ни одной строкой `src/`.** Подпись текстовой вкладки
  выводится из пропа `docFormat` у `EditorShell`. Поле объявлено, заполнено обоими адаптерами
  (`'JSON'`/`'YAML'`) и закреплено двумя тестами. Комментарий-шапка ТОГО ЖЕ файла гласит «поле,
  которого никто не читает, устаревает молча» — файл противоречит себе. Второй вариант («заставить
  `EditorShell` читать его») неисполним: хром принимает `EditorShellDraft`, адаптера у него нет и
  быть не должно. Остаётся снос трёх строк в `src/` и двух в тестах.
- **`storageKey` объявлен в `EditorShellDraft`** (`useDocumentDraft.ts:68`), чей doc-комментарий
  называет интерфейс «подмножеством черновика, которое читает хром». `EditorShell` его не читает;
  читают `Workbench` и `MihomoEditorPage`. Правильное место — `DocumentDraft`; перенос безопасен,
  обе сборки его расширяют.
- **Умолчание `emptyLabel = 'Конфиг валиден'` в `IssueList` недостижимо:** оба вызывающих либо всегда
  передают подпись, либо рендерят список только при непустых диагностиках. Комментарий называет
  вызывающих, которых нет.

### Инварианты, объявленные словами, а не типом
- **`useSaveTemplate` принимает `{templateJson?, encodedTemplateYaml?}`** — допускает НОЛЬ полей
  содержимого и ОБА сразу, тогда как комментарий над ним требует «ровно одно» и сам объясняет, чем
  нарушение опасно (защита бэкенда обходится молча). Лечится объединением
  `({templateJson} | {encodedTemplateYaml}) & {name?, expectedHash}`.
- **`MihomoTraceResult.winner` типом не связан со `stopped`.** Из-за этого в панели остаётся ветка
  сужения типа без текста, а полное устранение требует размеченного объединения в
  `entities/mihomo/trace.ts`.
- **`docType="XRAY_JSON"` зашит строкой** в `TemplateEditorPage.tsx`, хотя `template.templateType` в
  области видимости и уже сужен охраной выше.

### Пробелы, найденные, но не закрытые
- **`validateMihomo` не проверяет содержимое подсписков `sub-rules`.** Из-за этого ветка `sub-rules`
  в `entities/graph/mihomo/locate.ts` не имеет сегодняшнего производителя. Ветку решено оставить:
  `subRuleEntries` уже единственный источник имён для валидации, графа и резолвера, и любая проверка
  внутри подсписка немедленно её оживит.
- **Клик по синтаксической ошибке YAML в списке проблем никуда не ведёт.** У неё пустой путь, а
  список навигирует по пути. Место при этом ИЗВЕСТНО: библиотека отдаёт `e.pos`, но `parse.ts`
  собирает из ошибки только `message`. Данные для навигации теряются на одну строку раньше, чем
  кажется.
- **Наведение молчит на ключах-контейнерах и секциях** (`proxies`, `rules`, `dns`, `tun`…): описания
  для них есть и показываются в выпадашке, но `fieldFor` ищет их среди полей секции. Самые заметные
  ключи документа объяснены только при наборе.
- **`MihomoRuleForm` использует `key={index}`,** поэтому при сдвиге индексов у выбранного узла может
  остаться чужое локальное состояние поля. Ключ по содержимому неработоспособен: форма пишет на
  каждое нажатие, и поле пересоздавалось бы под кареткой.
- **`MihomoEnum.doc` не показывается в списках выбора** — `SelectOption` описания не носит, а
  расширять дизайн-систему запрещено. Наведение на вкладке YAML это покрывает.
- **Неполный enum `global-client-fingerprint`** (нет `android`, `edge`, `360`, `qq`) и отсутствующий
  `sniffer.skip-src-address`. Ущерб — «поля не видно в форме», не «поле испортилось»: enum
  документирован как подсказка, а не ограничение, и незнакомое значение проходит насквозь.

### Долги, пришедшие из плана 1
- Третий проход валидации в `JsonView.tsx`. Замечание против интуиции: перевод линтера на общий мемо
  не выиграл бы, а проиграл — линтер считает по буферу CodeMirror, который на кадр расходится с
  текстом черновика, и каждое нажатие вытесняло бы единственную запись.
- Мемо на уровне модуля в `xrayAdapter.ts`: утечки между документами нет (ключ — полная строка
  текста), цена — удержание последнего разобранного конфига в памяти после ухода со страницы.

### Окружение
- **Комментарий в `frontend/test/intellisense.test.ts` опровергнут измерением.** Он утверждает, что
  настоящий регресс валит все три попытки, а вытеснение проходит на повторе. Под нагрузкой этой
  ветки заведомо исправный тест упал ВСЕ ТРИ раза. Односторонний вывод («регресс ⇒ падают все три»)
  верен, обратный — нет, и комментарий приглашает именно к обратному.
- **В `e2e/mocks.ts` у записи `MIHOMO` в СПИСКЕ осталось `encodedTemplateYaml: 'eA=='`,** а детальный
  ответ отдаёт настоящий YAML. Сегодня ненаблюдаемо: страница списка содержимое не декодирует.

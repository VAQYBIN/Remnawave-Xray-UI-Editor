# UX-долг: привязка диагностик, значки проблем, поиск — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать, **где** находится найденная проблема: подчеркнуть её место в JSON, привести к узлу по клику, пометить проблемные узлы на графе и дать поиск по конфигу.

**Architecture:** Всё опирается на один вход — путь диагностики. `ValidationIssue` получает `parts: (string|number)[]`, а строковый `path` становится производным. Дальше три независимых резолвера: `locateRange(state, parts)` во `features/editor` (спуск по синтаксическому дереву CodeMirror), `nodeIdForPath(parts, config)` и `issueCountsByNode` в `entities/graph` (он владеет схемой id узлов), `searchNodes(config, ctx, query)` там же. Компоненты только вызывают резолверы и рисуют результат.

**Tech Stack:** React 19, CodeMirror 6 (`@codemirror/language`, `@lezer/common`), React Flow (`@xyflow/react`), zustand, vitest + @testing-library, Playwright.

## Global Constraints

- Язык UI и комментариев — русский; коммиты — английский conventional style (`feat(frontend): ...`).
- Слои: `entities` не импортирует из `features`; сторонних UI-библиотек не добавляем.
- Строковый формат `path` не меняется (`inbounds.0.streamSettings`) — на него опираются существующие тесты и статус-бар. Он собирается из `parts` хелпером `formatPath`.
- Путь не разрешился → линтер ставит диапазон в начало документа и пишет в тексте «место в документе не определено»; клик по такой проблеме недоступен. Курсор «куда-нибудь» не ставим.
- **Счётчики проблем и результат поиска не участвуют в `useMemo`, который вызывает `buildGraph`** (урок этапа 2 диагностики: узлы пересоздавались и пропадали под анимацией появления). Только вторым проходом.
- Подсветка конкретного поля внутри формы инспектора — вне рамок.

## Структура файлов

Создаются:

| Файл | Ответственность |
|---|---|
| `frontend/src/features/editor/jsonLocate.ts` | путь → диапазон символов в документе; сборка диагностик CodeMirror |
| `frontend/src/entities/graph/locate.ts` | путь → id узла; счётчики проблем по узлам |
| `frontend/src/entities/graph/search.ts` | поиск узлов по конфигу |
| `frontend/src/features/topology/SearchBox.tsx` | строка поиска со списком результатов |

Модифицируются: `entities/xray/config.ts` (`parts`), `entities/graph/{types,index}.ts`, `features/editor/{JsonView,IssueList,EditorPage}.tsx`, `features/editor/intellisense/context.ts` (экспорт двух хелперов), `features/topology/{TopologyView,nodes}.tsx`, `shared/ui/tokens.css`, `e2e/`, `CLAUDE.md`.

---

### Task 1: Путь диагностики массивом

**Files:**
- Modify: `frontend/src/entities/xray/config.ts`
- Test: `frontend/test/xray-config.test.ts` (дописать)

**Interfaces:**
- Consumes: ничего.
- Produces: `PathParts = (string | number)[]`; `formatPath(parts: PathParts): string`; `ValidationIssue { parts: PathParts; path: string; message: string; level: 'error' | 'warning' }`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/xray-config.test.ts` (внутрь файла, отдельным `describe`):

```ts
describe('путь диагностики', () => {
  it('parts несёт индексы числами, path остаётся строкой', () => {
    const res = validateXrayConfig(
      JSON.stringify({
        inbounds: [
          {
            tag: 'a',
            protocol: 'vless',
            streamSettings: { network: 'ws', security: 'reality' },
          },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      }),
    )
    const issue = res.issues.find((i) => i.path === 'inbounds.0.streamSettings')!
    expect(issue).toBeDefined()
    expect(issue.parts).toEqual(['inbounds', 0, 'streamSettings'])
  })

  it('parts у схемной ошибки приходит из zod без склейки', () => {
    const res = validateXrayConfig(JSON.stringify({ dns: { servers: 'не массив' } }))
    const issue = res.issues.find((i) => i.path === 'dns.servers')!
    expect(issue.parts).toEqual(['dns', 'servers'])
  })

  it('ключ с точкой не разваливается на сегменты', () => {
    // hosts — словарь: ключ сам содержит точки, и склейка через точку неоднозначна
    const res = validateXrayConfig(JSON.stringify({ dns: { hosts: { 'example.com': 42 } } }))
    const issue = res.issues.find((i) => i.parts.includes('example.com'))
    expect(issue?.parts).toEqual(['dns', 'hosts', 'example.com'])
  })

  it('formatPath собирает ту же строку, что была раньше', () => {
    expect(formatPath(['routing', 'rules', 2, 'domain'])).toBe('routing.rules.2.domain')
    expect(formatPath([])).toBe('')
  })
})
```

Импорт в шапке файла расширить: `formatPath` рядом с `validateXrayConfig`.

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/xray-config.test.ts`
Ожидаемо: FAIL — `formatPath` не экспортируется, у issue нет `parts`.

Если тест «ключ с точкой» не находит issue — проверить в `entities/xray/dns.ts`, что `hosts` описан как `z.record(...)` с непустым типом значения; если значение `z.unknown()`, ошибка не возникнет — тогда заменить фикстуру на `{ dns: { hosts: { 'example.com': { unknown: 1 } } } }` или другой ключ словаря, дающий ошибку схемы. Смысл теста — сегмент с точкой внутри, а не конкретное поле.

- [ ] **Step 3: Реализовать**

В `frontend/src/entities/xray/config.ts` заменить объявление типа и добавить хелперы:

```ts
/** Путь до места проблемы: строки — ключи, числа — индексы массивов */
export type PathParts = (string | number)[]

export function formatPath(parts: PathParts): string {
  return parts.join('.')
}

export interface ValidationIssue {
  parts: PathParts
  /** Производное от parts представление: показ в статус-баре и сортировка */
  path: string
  message: string
  level: 'error' | 'warning'
}

// Единственное место сборки: path обязан оставаться согласованным с parts
function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: formatPath(parts), message, level }
}
```

Все двадцать `issues.push({ path: ..., message: ..., level: ... })` в `analyzeIntegrity` перевести на `issues.push(issue([...], message, level))`. Соответствие шаблонов и массивов (шаблон слева уже есть в коде):

| Было (`path`) | Стало (`parts`) |
|---|---|
| `` `inbounds.${i}.tag` `` | `['inbounds', i, 'tag']` |
| `` `outbounds.${i}.tag` `` | `['outbounds', i, 'tag']` |
| `` `inbounds.${i}.port` `` | `['inbounds', i, 'port']` |
| `` `routing.rules.${i}.outboundTag` `` | `['routing', 'rules', i, 'outboundTag']` |
| `` `routing.rules.${i}.inboundTag` `` | `['routing', 'rules', i, 'inboundTag']` |
| `` `routing.rules.${i}.balancerTag` `` | `['routing', 'rules', i, 'balancerTag']` |
| `` `routing.rules.${i}.domain` `` | `['routing', 'rules', i, 'domain']` |
| `` `routing.rules.${i}.port` `` | `['routing', 'rules', i, 'port']` |
| `` `routing.rules.${i}.sourcePort` `` | `['routing', 'rules', i, 'sourcePort']` |
| `` `routing.rules.${i}.protocol` `` | `['routing', 'rules', i, 'protocol']` |
| `` `inbounds.${i}.streamSettings` `` | `['inbounds', i, 'streamSettings']` |
| `` `inbounds.${i}.settings.flow` `` | `['inbounds', i, 'settings', 'flow']` |
| `` `outbounds.${i}.streamSettings` `` | `['outbounds', i, 'streamSettings']` |
| `` `outbounds.${i}.streamSettings.sockopt.dialerProxy` `` | `['outbounds', i, 'streamSettings', 'sockopt', 'dialerProxy']` |
| `` `outbounds.${i}.settings.vnext.${si}.users.${ui}.flow` `` | `['outbounds', i, 'settings', 'vnext', si, 'users', ui, 'flow']` |

В `validateXrayConfig` — две оставшиеся ветки:

```ts
  } catch (err) {
    return {
      ok: false,
      issues: [
        issue([], `Некорректный JSON: ${err instanceof Error ? err.message : String(err)}`, 'error'),
      ],
    }
  }
```

```ts
      issues: parsed.error.issues.map((i) => issue(i.path as PathParts, i.message, 'error')),
```

- [ ] **Step 4: Тесты должны пройти**

Из каталога `frontend`: `npx vitest run test/xray-config.test.ts` — новые кейсы зелёные, **и все прежние тоже** (они сверяются со строковым `path` — это и есть проверка, что перевод не сместил смысл). Затем `npx tsc --noEmit`.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/xray/config.ts frontend/test/xray-config.test.ts
git commit -m "refactor(frontend): carry diagnostic paths as parts, not just strings"
```

---

### Task 2: Путь → место в документе

**Files:**
- Create: `frontend/src/features/editor/jsonLocate.ts`
- Modify: `frontend/src/features/editor/intellisense/context.ts` (экспорт `stripQuotes` и `propertyKey`)
- Test: `frontend/test/json-locate.test.ts`

**Interfaces:**
- Consumes: `PathParts` (Task 1).
- Produces: `DocRange { from: number; to: number }`; `locateRange(state: EditorState, parts: PathParts): DocRange | null`.

- [ ] **Step 1: Написать падающий тест**

```ts
// frontend/test/json-locate.test.ts
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { locateRange } from '../src/features/editor/jsonLocate'

const DOC = `{
  "inbounds": [
    {
      "tag": "vless-in",
      "streamSettings": { "network": "ws", "security": "reality" }
    }
  ],
  "dns": { "hosts": { "example.com": ["1.2.3.4"] } }
}`

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [json()] })
}

function slice(doc: string, range: { from: number; to: number } | null): string | null {
  return range ? doc.slice(range.from, range.to) : null
}

describe('locateRange', () => {
  it('находит значение вложенного ключа, а не всю пару', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0, 'streamSettings', 'security'])
    expect(slice(DOC, range)).toBe('"reality"')
  })

  it('находит элемент массива по индексу', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0])
    expect(slice(DOC, range)?.startsWith('{')).toBe(true)
    expect(slice(DOC, range)).toContain('"vless-in"')
  })

  it('находит объект целиком, когда путь кончается на нём', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0, 'streamSettings'])
    expect(slice(DOC, range)).toBe('{ "network": "ws", "security": "reality" }')
  })

  it('ключ с точкой внутри не разбирается на сегменты', () => {
    const range = locateRange(stateOf(DOC), ['dns', 'hosts', 'example.com'])
    expect(slice(DOC, range)).toBe('["1.2.3.4"]')
  })

  it('нет последнего сегмента — отдаёт глубочайшего найденного предка', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0, 'streamSettings', 'flow'])
    expect(slice(DOC, range)).toBe('{ "network": "ws", "security": "reality" }')
  })

  it('не найден ни один сегмент — null, а не весь документ', () => {
    expect(locateRange(stateOf(DOC), ['log', 'loglevel'])).toBeNull()
  })

  it('пустой путь — null: у ошибки разбора JSON места нет', () => {
    expect(locateRange(stateOf(DOC), [])).toBeNull()
  })

  it('индекс за границей массива — предок', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 7])
    expect(slice(DOC, range)?.startsWith('[')).toBe(true)
  })

  it('нечитаемый документ — null', () => {
    expect(locateRange(stateOf('не json вовсе'), ['inbounds', 0])).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/json-locate.test.ts`
Ожидаемо: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

В `frontend/src/features/editor/intellisense/context.ts` сделать экспортируемыми две уже существующие функции (тела не менять):

```ts
export function stripQuotes(text: string): string {
```

```ts
/** Имя ключа Property (без кавычек) */
export function propertyKey(state: EditorState, prop: SyntaxNode): string | null {
```

Новый файл:

```ts
// frontend/src/features/editor/jsonLocate.ts
// Обратная задача к intellisense/context.ts: там из позиции курсора выводится путь,
// здесь из пути диагностики — место в документе. Общий обход невозможен (спуск и
// подъём по дереву — разные операции), поэтому общими остаются только мелкие хелперы.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { PathParts } from '../../entities/xray'
import { propertyKey } from './intellisense/context'

export interface DocRange {
  from: number
  to: number
}

// Значения JSON; всё остальное в дереве — пунктуация и имена ключей
const VALUES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null'])

function firstValue(node: SyntaxNode): SyntaxNode | null {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (VALUES.has(ch.name)) return ch
  }
  return null
}

function propertyValue(state: EditorState, obj: SyntaxNode, key: string): SyntaxNode | null {
  for (let ch = obj.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name !== 'Property') continue
    if (propertyKey(state, ch) !== key) continue
    const value = ch.lastChild
    return value && VALUES.has(value.name) ? value : null
  }
  return null
}

function arrayItem(array: SyntaxNode, index: number): SyntaxNode | null {
  let i = 0
  for (let ch = array.firstChild; ch; ch = ch.nextSibling) {
    if (!VALUES.has(ch.name)) continue
    if (i === index) return ch
    i += 1
  }
  return null
}

/**
 * Место пути в тексте. Если путь оборвался на середине — отдаём диапазон
 * глубочайшего найденного предка: у ошибки уровня streamSettings своего ключа
 * может и не быть. Если не нашёлся даже первый сегмент — null: подсветить весь
 * документ хуже, чем не подсвечивать ничего.
 */
export function locateRange(state: EditorState, parts: PathParts): DocRange | null {
  if (parts.length === 0) return null

  // syntaxTree в живом редакторе разобран только до видимой области, поэтому
  // диагностика в хвосте большого конфига иначе не нашла бы своего места
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state)
  let node = firstValue(tree.topNode)
  if (!node) return null

  let depth = 0
  for (const part of parts) {
    const next =
      typeof part === 'number'
        ? node.name === 'Array'
          ? arrayItem(node, part)
          : null
        : node.name === 'Object'
          ? propertyValue(state, node, part)
          : null
    if (!next) break
    node = next
    depth += 1
  }

  if (depth === 0) return null
  return { from: node.from, to: node.to }
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `frontend`: `npx vitest run test/json-locate.test.ts`
Ожидаемо: 9 passed. Если падает кейс «нечитаемый документ» — проверить, что `firstValue` ищет среди детей `topNode` (для мусорного текста дерево содержит `⚠`, а не значение).

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/jsonLocate.ts frontend/src/features/editor/intellisense/context.ts frontend/test/json-locate.test.ts
git commit -m "feat(frontend): resolve a diagnostic path to its place in the document"
```

---

### Task 3: Линтер с настоящими диапазонами

**Files:**
- Modify: `frontend/src/features/editor/jsonLocate.ts` (добавить `diagnosticsFor`), `frontend/src/features/editor/JsonView.tsx`
- Test: `frontend/test/json-locate.test.ts` (дописать)

**Interfaces:**
- Consumes: `locateRange` (Task 2), `ValidationIssue` (Task 1).
- Produces: `diagnosticsFor(state: EditorState, issues: ValidationIssue[]): Diagnostic[]`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `frontend/test/json-locate.test.ts` (импорт `diagnosticsFor` добавить к существующему):

```ts
describe('diagnosticsFor', () => {
  it('диагностика встаёт на своё место в тексте', () => {
    const [diag] = diagnosticsFor(stateOf(DOC), [
      {
        parts: ['inbounds', 0, 'streamSettings', 'security'],
        path: 'inbounds.0.streamSettings.security',
        message: 'Reality несовместим с ws',
        level: 'error',
      },
    ])
    expect(DOC.slice(diag!.from, diag!.to)).toBe('"reality"')
    expect(diag!.severity).toBe('error')
    expect(diag!.message).toContain('Reality несовместим с ws')
  })

  it('warning остаётся warning', () => {
    const [diag] = diagnosticsFor(stateOf(DOC), [
      { parts: ['inbounds', 0, 'tag'], path: 'inbounds.0.tag', message: 'дубликат', level: 'warning' },
    ])
    expect(diag!.severity).toBe('warning')
  })

  it('неразрешимый путь помечается в тексте, а не врёт позицией', () => {
    const [diag] = diagnosticsFor(stateOf(DOC), [
      { parts: [], path: '', message: 'Некорректный JSON', level: 'error' },
    ])
    expect(diag!.from).toBe(0)
    expect(diag!.to).toBe(0)
    expect(diag!.message).toMatch(/место в документе не определено/i)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/json-locate.test.ts`
Ожидаемо: FAIL — `diagnosticsFor` не экспортируется.

- [ ] **Step 3: Реализовать**

В конец `frontend/src/features/editor/jsonLocate.ts`:

```ts
import type { Diagnostic } from '@codemirror/lint'
import type { ValidationIssue } from '../../entities/xray'

/** Диагностики CodeMirror по проблемам конфига: у каждой — своё место в тексте */
export function diagnosticsFor(state: EditorState, issues: ValidationIssue[]): Diagnostic[] {
  return issues.map((issue): Diagnostic => {
    const severity = issue.level === 'error' ? 'error' : 'warning'
    const label = issue.path ? `${issue.path}: ${issue.message}` : issue.message
    const range = locateRange(state, issue.parts)
    if (!range) {
      // Диапазон обязателен, поэтому ставим в начало документа и честно говорим,
      // что позиция неизвестна: иначе маркер выглядит как указание на первую строку
      return { from: 0, to: 0, severity, message: `${label} (место в документе не определено)` }
    }
    return { from: range.from, to: range.to, severity, message: label }
  })
}
```

Импорты `Diagnostic`/`ValidationIssue` поднять к остальным в начало файла.

В `frontend/src/features/editor/JsonView.tsx` заменить тело линтера:

```ts
function xrayLinter() {
  return linter((view) => diagnosticsFor(view.state, validateXrayConfig(view.state.doc.toString()).issues))
}
```

и добавить импорт `import { diagnosticsFor } from './jsonLocate'`.

- [ ] **Step 4: Тесты должны пройти**

Из каталога `frontend`: `npx vitest run test/json-locate.test.ts` — 12 passed; `npx tsc --noEmit` — чисто.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/jsonLocate.ts frontend/src/features/editor/JsonView.tsx frontend/test/json-locate.test.ts
git commit -m "fix(frontend): anchor JSON diagnostics to their actual place"
```

---

### Task 4: Путь → узел графа и счётчики проблем

**Files:**
- Create: `frontend/src/entities/graph/locate.ts`
- Modify: `frontend/src/entities/graph/types.ts` (тип `IssueCount`)
- Test: `frontend/test/graph-locate.test.ts`

**Interfaces:**
- Consumes: `PathParts`, `ValidationIssue`, `XrayConfig`.
- Produces: `IssueCount { errors: number; warnings: number }`; `nodeIdForPath(parts: PathParts, config: XrayConfig): string | null`; `issueCountsByNode(issues: ValidationIssue[], config: XrayConfig): Record<string, IssueCount>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// frontend/test/graph-locate.test.ts
import { describe, expect, it } from 'vitest'
import { issueCountsByNode, nodeIdForPath } from '../src/entities/graph/locate'
import type { ValidationIssue, XrayConfig } from '../src/entities/xray'

const CONFIG = {
  inbounds: [
    { tag: 'vless-in', protocol: 'vless' },
    { tag: 'trojan-in', protocol: 'trojan' },
  ],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{ type: 'field', outboundTag: 'direct' }] },
  dns: { servers: ['1.1.1.1'] },
} as unknown as XrayConfig

function issue(parts: (string | number)[], level: 'error' | 'warning' = 'error'): ValidationIssue {
  return { parts, path: parts.join('.'), message: 'x', level }
}

describe('nodeIdForPath', () => {
  it('inbound по индексу — узел по тегу', () => {
    expect(nodeIdForPath(['inbounds', 1, 'port'], CONFIG)).toBe('in:trojan-in')
  })

  it('outbound по индексу', () => {
    expect(nodeIdForPath(['outbounds', 0, 'streamSettings'], CONFIG)).toBe('out:direct')
  })

  it('правило адресуется позиционно', () => {
    expect(nodeIdForPath(['routing', 'rules', 0, 'domain'], CONFIG)).toBe('rule:0')
  })

  it('dns — единственный узел', () => {
    expect(nodeIdForPath(['dns', 'servers'], CONFIG)).toBe('dns')
  })

  it('log узла не имеет', () => {
    expect(nodeIdForPath(['log', 'loglevel'], CONFIG)).toBeNull()
  })

  it('несуществующий индекс — null, а не битый id', () => {
    expect(nodeIdForPath(['inbounds', 9, 'tag'], CONFIG)).toBeNull()
  })

  it('routing без rules — null', () => {
    expect(nodeIdForPath(['routing', 'domainStrategy'], CONFIG)).toBeNull()
  })

  it('пустой путь — null', () => {
    expect(nodeIdForPath([], CONFIG)).toBeNull()
  })
})

describe('issueCountsByNode', () => {
  it('считает ошибки и предупреждения раздельно', () => {
    const counts = issueCountsByNode(
      [
        issue(['inbounds', 0, 'streamSettings']),
        issue(['inbounds', 0, 'tag'], 'warning'),
        issue(['routing', 'rules', 0, 'domain'], 'warning'),
        issue(['log', 'loglevel']),
      ],
      CONFIG,
    )
    expect(counts['in:vless-in']).toEqual({ errors: 1, warnings: 1 })
    expect(counts['rule:0']).toEqual({ errors: 0, warnings: 1 })
    expect(Object.keys(counts)).toHaveLength(2)
  })

  it('дубликат тега попадает в тот же узел — граф рисует его один раз', () => {
    const dup = {
      inbounds: [{ tag: 'a', protocol: 'vless' }, { tag: 'a', protocol: 'trojan' }],
    } as unknown as XrayConfig
    const counts = issueCountsByNode([issue(['inbounds', 0, 'tag']), issue(['inbounds', 1, 'tag'])], dup)
    expect(counts['in:a']).toEqual({ errors: 2, warnings: 0 })
  })

  it('пустой список — пустой объект', () => {
    expect(issueCountsByNode([], CONFIG)).toEqual({})
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/graph-locate.test.ts`
Ожидаемо: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

В `frontend/src/entities/graph/types.ts` дописать:

```ts
/** Сколько проблем висит на узле; ошибки и предупреждения не смешиваем */
export interface IssueCount {
  errors: number
  warnings: number
}
```

и добавить необязательное поле в четыре интерфейса данных узлов (`InboundNodeData`, `OutboundNodeData`, `RuleNodeData`, `DnsNodeData`):

```ts
  issueCount?: IssueCount
```

Новый файл:

```ts
// frontend/src/entities/graph/locate.ts
// Соответствие «путь диагностики → узел графа». Живёт в entities/graph, потому что
// схему id (`in:<tag>`, `out:<tag>`, `rule:<index>`, `dns`) задаёт buildGraph.

import type { PathParts, ValidationIssue, XrayConfig } from '../xray'
import type { IssueCount } from './types'

export function nodeIdForPath(parts: PathParts, config: XrayConfig): string | null {
  const [head, second, third] = parts

  if (head === 'dns') return config.dns ? 'dns' : null

  if (head === 'inbounds' && typeof second === 'number') {
    const tag = config.inbounds?.[second]?.tag
    return tag ? `in:${tag}` : null
  }

  if (head === 'outbounds' && typeof second === 'number') {
    const tag = config.outbounds?.[second]?.tag
    return tag ? `out:${tag}` : null
  }

  if (head === 'routing' && second === 'rules' && typeof third === 'number') {
    return config.routing?.rules?.[third] ? `rule:${third}` : null
  }

  return null
}

export function issueCountsByNode(
  issues: ValidationIssue[],
  config: XrayConfig,
): Record<string, IssueCount> {
  const counts: Record<string, IssueCount> = {}
  for (const issue of issues) {
    const id = nodeIdForPath(issue.parts, config)
    if (!id) continue
    // Дубликаты тегов buildGraph пропускает: обе проблемы садятся на тот
    // единственный узел, который реально нарисован
    const cur = (counts[id] ??= { errors: 0, warnings: 0 })
    if (issue.level === 'error') cur.errors += 1
    else cur.warnings += 1
  }
  return counts
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `frontend`: `npx vitest run test/graph-locate.test.ts`
Ожидаемо: 11 passed.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/locate.ts frontend/src/entities/graph/types.ts frontend/test/graph-locate.test.ts
git commit -m "feat(frontend): map diagnostic paths to graph nodes"
```

---

### Task 5: Значки проблем на узлах

**Files:**
- Modify: `frontend/src/features/topology/nodes.tsx`, `frontend/src/features/topology/TopologyView.tsx`, `frontend/src/features/editor/EditorPage.tsx`, `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/topology-issues.test.ts`

**Interfaces:**
- Consumes: `IssueCount`, `issueCountsByNode` (Task 4).
- Produces: проп `issues?: Record<string, IssueCount>` у `TopologyView`; экспортируемая `issueBadgeOf(issues, nodeId): { level: 'error' | 'warn'; total: number } | undefined`.

- [ ] **Step 1: Написать падающий тест**

```ts
// frontend/test/topology-issues.test.ts
import { describe, expect, it } from 'vitest'
import { issueBadgeOf } from '../src/features/topology/TopologyView'

describe('issueBadgeOf', () => {
  it('ошибка перевешивает предупреждение', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 1, warnings: 3 } }, 'in:a')).toEqual({
      level: 'error',
      total: 4,
    })
  })

  it('только предупреждения — уровень warn', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 0, warnings: 2 } }, 'in:a')).toEqual({
      level: 'warn',
      total: 2,
    })
  })

  it('узла нет в счётчиках — значка нет', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 1, warnings: 0 } }, 'in:b')).toBeUndefined()
  })

  it('счётчиков нет вовсе — значка нет', () => {
    expect(issueBadgeOf(undefined, 'in:a')).toBeUndefined()
  })

  it('нулевые счётчики значка не дают', () => {
    expect(issueBadgeOf({ 'in:a': { errors: 0, warnings: 0 } }, 'in:a')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/topology-issues.test.ts`
Ожидаемо: FAIL — `issueBadgeOf` не экспортируется.

- [ ] **Step 3: Реализовать**

В `frontend/src/features/topology/TopologyView.tsx`:

```ts
import type { IssueCount } from '../../entities/graph/types'

/** Значок проблем на узле: ошибка перевешивает предупреждения, счёт — общий */
export function issueBadgeOf(
  issues: Record<string, IssueCount> | undefined,
  nodeId: string,
): { level: 'error' | 'warn'; total: number } | undefined {
  const count = issues?.[nodeId]
  if (!count) return undefined
  const total = count.errors + count.warnings
  if (total === 0) return undefined
  return { level: count.errors > 0 ? 'error' : 'warn', total }
}
```

В `Props` добавить:

```ts
  /** Счётчики проблем по id узла — рисуются значком */
  issues?: Record<string, IssueCount>
```

и принять `issues` в деструктуризации параметров. Во втором `useMemo` (`computed`) заменить сборку узла:

```ts
    const laid = graph.nodes.map((n) => {
      const traceState = n.data.kind === 'rule' ? traceStateOf(trace, n.data.index as number) : undefined
      const issueCount = issues?.[n.id]
      // Ссылку на data сохраняем, когда доклеивать нечего: React Flow сравнивает
      // объекты по ссылке, и новый объект на каждый ввод — лишняя перерисовка
      const data =
        traceState === undefined && issueCount === undefined
          ? n.data
          : {
              ...n.data,
              ...(traceState === undefined ? {} : { traceState }),
              ...(issueCount === undefined ? {} : { issueCount }),
            }
      return {
        ...n,
        deletable: false,
        position: saved?.[n.id] ?? n.position,
        selected: n.id === selectedId,
        data,
      }
    })
```

и добавить `issues` в массив зависимостей этого `useMemo` (`[graph, config, saved, selectedId, trace, issues]`). **В зависимости первого `useMemo` (с `buildGraph`) `issues` не добавлять.**

В `frontend/src/features/topology/nodes.tsx` добавить компонент и вставить его последним в `.fnode-head` всех четырёх узлов (inbound, outbound, rule, dns):

```tsx
import type { IssueCount } from '../../entities/graph/types'

/** Значок проблем: ведёт на статус-бар, где лежит текст, поэтому подпись — счёт */
function IssueBadge({ count }: { count?: IssueCount }) {
  if (!count) return null
  const total = count.errors + count.warnings
  if (total === 0) return null
  const error = count.errors > 0
  return (
    <span
      className={`node-issue node-issue-${error ? 'error' : 'warn'}`}
      aria-label={
        error
          ? `проблем: ${total}, из них ошибок: ${count.errors}`
          : `предупреждений: ${total}`
      }
    >
      {error ? '!' : '?'}
      {total > 1 ? ` ${total}` : ''}
    </span>
  )
}
```

Вставка (пример для inbound; в outbound значок идёт после `{data.isDefault && …}`, в rule и dns — сразу после `fnode-kind`):

```tsx
      <div className="fnode-head">
        <span className="fnode-kind">{data.protocol}</span>
        <IssueBadge count={data.issueCount} />
      </div>
```

В `frontend/src/features/editor/EditorPage.tsx` — рядом с `realityTargets`:

```ts
  const nodeIssues = useMemo(
    () => (parsedConfig ? issueCountsByNode(validation.issues, parsedConfig) : {}),
    [validation.issues, parsedConfig],
  )
```

импорт `import { issueCountsByNode } from '../../entities/graph/locate'` и проп `issues={nodeIssues}` у `<TopologyView …>`.

В конец `frontend/src/shared/ui/tokens.css`:

```css
/* Значок проблем на узле графа */
.node-issue {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--t-xs);
  line-height: 1;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--rail-hi);
}
.node-issue-error { color: var(--alert); border-color: var(--alert); background: var(--alert-soft); }
.node-issue-warn { color: var(--ember); border-color: var(--ember-line); background: var(--ember-soft); }
```

- [ ] **Step 4: Тесты должны пройти**

Из каталога `frontend`: `npx vitest run test/topology-issues.test.ts` — 5 passed; затем весь фронт `npx vitest run` и `npx tsc --noEmit`.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/topology/nodes.tsx frontend/src/features/topology/TopologyView.tsx frontend/src/features/editor/EditorPage.tsx frontend/src/shared/ui/tokens.css frontend/test/topology-issues.test.ts
git commit -m "feat(frontend): flag nodes that carry config problems"
```

---

### Task 6: Клик по проблеме

**Files:**
- Modify: `frontend/src/features/editor/IssueList.tsx`, `frontend/src/features/editor/JsonView.tsx`, `frontend/src/features/editor/EditorPage.tsx`, `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/issue-list.test.tsx`

**Interfaces:**
- Consumes: `locateRange` (Task 2), `nodeIdForPath` (Task 4).
- Produces: `IssueList` с пропами `onSelect?: (issue: ValidationIssue) => void` и `canSelect?: (issue: ValidationIssue) => boolean`; `JsonView` с пропом `reveal?: { parts: PathParts; nonce: number } | null`.

- [ ] **Step 1: Написать падающий тест**

```tsx
// frontend/test/issue-list.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IssueList } from '../src/features/editor/IssueList'
import type { ValidationIssue } from '../src/entities/xray'

const ISSUES: ValidationIssue[] = [
  {
    parts: ['inbounds', 0, 'streamSettings'],
    path: 'inbounds.0.streamSettings',
    message: 'Reality несовместим с ws',
    level: 'error',
  },
  { parts: ['log', 'loglevel'], path: 'log.loglevel', message: 'странный уровень', level: 'warning' },
]

describe('IssueList', () => {
  it('без onSelect строки остаются текстом', () => {
    render(<IssueList issues={ISSUES} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Reality несовместим с ws')).toBeInTheDocument()
  })

  it('клик по проблеме отдаёт её наверх', async () => {
    const onSelect = vi.fn()
    render(<IssueList issues={ISSUES} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /Reality несовместим/ }))
    expect(onSelect).toHaveBeenCalledWith(ISSUES[0])
  })

  it('непереходимая проблема кнопкой не становится', () => {
    render(
      <IssueList
        issues={ISSUES}
        onSelect={() => {}}
        canSelect={(issue) => issue.parts[0] !== 'log'}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('странный уровень')).toBeInTheDocument()
  })

  it('пустой список — прежнее сообщение', () => {
    render(<IssueList issues={[]} />)
    expect(screen.getByText('Конфиг валиден')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/issue-list.test.tsx`
Ожидаемо: FAIL — пропов нет, кнопок не появляется.

- [ ] **Step 3: Реализовать**

`frontend/src/features/editor/IssueList.tsx` целиком:

```tsx
import type { ValidationIssue } from '../../entities/xray'

export function IssueList({
  issues,
  onSelect,
  canSelect,
}: {
  issues: ValidationIssue[]
  onSelect?: (issue: ValidationIssue) => void
  /** Куда переходить, решает вызывающий: на топологии узел есть не у всякой проблемы */
  canSelect?: (issue: ValidationIssue) => boolean
}) {
  if (issues.length === 0) {
    return <p className="muted">Конфиг валиден</p>
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {issues.map((issue, i) => {
        const body = (
          <>
            <span
              className={
                issue.level === 'error' ? 'issue-badge issue-error' : 'issue-badge issue-warning'
              }
            >
              {issue.level === 'error' ? 'ошибка' : 'внимание'}
            </span>
            {issue.path && <span className="mono muted">{issue.path}</span>}
            <span>{issue.message}</span>
          </>
        )
        const selectable = onSelect !== undefined && (canSelect === undefined || canSelect(issue))
        return (
          <li key={i}>
            {selectable ? (
              <button type="button" className="issue-row issue-row-link" onClick={() => onSelect(issue)}>
                {body}
              </button>
            ) : (
              <div className="issue-row">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
```

В `tokens.css` рядом с `.issue-row`:

```css
.issue-row-link {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--rail);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.issue-row-link:hover { background: var(--panel-2); }
.issue-row-link:focus-visible { outline: 2px solid var(--flux); outline-offset: -2px; }
```

`frontend/src/features/editor/JsonView.tsx` — добавить проп и эффект:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import type { PathParts } from '../../entities/xray'
import { diagnosticsFor, locateRange } from './jsonLocate'

export function JsonView({
  text,
  onChange,
  reveal,
}: {
  text: string
  onChange: (v: string) => void
  /** Куда прокрутить: nonce нужен, чтобы повторный клик по той же проблеме сработал снова */
  reveal?: { parts: PathParts; nonce: number } | null
}) {
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal) return
    const range = locateRange(view.state, reveal.parts)
    if (!range) return
    view.dispatch({
      selection: { anchor: range.from, head: range.to },
      effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
    })
    view.focus()
  }, [reveal])

  const extensions = useMemo(
    () => [json(), lintGutter(), xrayLinter(), xrayIntellisense('config'), editorTheme],
    [],
  )
  return (
    <CodeMirror
      value={text}
      height="100%"
      theme="dark"
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
    />
  )
}
```

`frontend/src/features/editor/EditorPage.tsx`:

```ts
  const [reveal, setReveal] = useState<{ parts: PathParts; nonce: number } | null>(null)
  const revealNonce = useRef(0)

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
```

`useRef` добавить в импорт из `react`; `ValidationIssue` и `PathParts` — в импорт из `../../entities/xray`; `nodeIdForPath` — из `../../entities/graph/locate`. Прокинуть в разметке: `<JsonView … reveal={reveal} />` и `<IssueList issues={validation.issues} onSelect={selectIssue} canSelect={canSelectIssue} />`.

- [ ] **Step 4: Тесты должны пройти**

Из каталога `frontend`: `npx vitest run test/issue-list.test.tsx` — 4 passed; весь фронт `npx vitest run`; `npx tsc --noEmit`.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/IssueList.tsx frontend/src/features/editor/JsonView.tsx frontend/src/features/editor/EditorPage.tsx frontend/src/shared/ui/tokens.css frontend/test/issue-list.test.tsx
git commit -m "feat(frontend): jump from a problem to its node or its line"
```

---

### Task 7: Поиск узлов по конфигу

**Files:**
- Create: `frontend/src/entities/graph/search.ts`
- Test: `frontend/test/graph-search.test.ts`

**Interfaces:**
- Consumes: `XrayConfig`, `GraphContext`.
- Produces: `SearchHit { nodeId: string; kind: 'inbound' | 'outbound' | 'rule' | 'squad' | 'dns'; title: string; matchedOn: string }`; `searchNodes(config: XrayConfig, ctx: GraphContext, query: string): SearchHit[]`.

- [ ] **Step 1: Написать падающий тест**

```ts
// frontend/test/graph-search.test.ts
import { describe, expect, it } from 'vitest'
import { searchNodes } from '../src/entities/graph/search'
import type { GraphContext } from '../src/entities/graph/types'
import type { XrayConfig } from '../src/entities/xray'

const CONFIG = {
  inbounds: [
    { tag: 'VLESS-Reality', protocol: 'vless', port: 443 },
    { tag: 'trojan-in', protocol: 'trojan', port: 8443 },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'warp', protocol: 'wireguard' },
  ],
  routing: {
    rules: [
      { type: 'field', domain: ['geosite:google'], outboundTag: 'warp' },
      { type: 'field', ip: ['8.8.8.8'], outboundTag: 'direct' },
    ],
  },
} as unknown as XrayConfig

const CTX: GraphContext = { squads: [{ uuid: 'u1', name: 'Основной сквад' }], inboundSquads: {} }

describe('searchNodes', () => {
  it('находит inbound по тегу без учёта регистра', () => {
    const hits = searchNodes(CONFIG, CTX, 'reality')
    expect(hits[0]).toMatchObject({ nodeId: 'in:VLESS-Reality', kind: 'inbound' })
  })

  it('находит по протоколу', () => {
    expect(searchNodes(CONFIG, CTX, 'wireguard').map((h) => h.nodeId)).toEqual(['out:warp'])
  })

  it('находит inbound по порту', () => {
    expect(searchNodes(CONFIG, CTX, '8443').map((h) => h.nodeId)).toEqual(['in:trojan-in'])
  })

  it('находит правило по домену и объясняет совпадение', () => {
    const hits = searchNodes(CONFIG, CTX, 'geosite:google')
    expect(hits[0]!.nodeId).toBe('rule:0')
    expect(hits[0]!.matchedOn).toMatch(/домен/i)
    expect(hits[0]!.title).toContain('1')
  })

  it('находит правило по IP', () => {
    expect(searchNodes(CONFIG, CTX, '8.8.8.8').map((h) => h.nodeId)).toEqual(['rule:1'])
  })

  it('находит сквад по имени', () => {
    expect(searchNodes(CONFIG, CTX, 'основной').map((h) => h.nodeId)).toEqual(['squad:u1'])
  })

  it('пустой запрос — пустой результат, а не весь конфиг', () => {
    expect(searchNodes(CONFIG, CTX, '   ')).toEqual([])
  })

  it('ничего не найдено — пустой список', () => {
    expect(searchNodes(CONFIG, CTX, 'нетакого')).toEqual([])
  })

  it('результатов не больше двадцати', () => {
    const many = {
      inbounds: Array.from({ length: 40 }, (_, i) => ({ tag: `in-${i}`, protocol: 'vless' })),
    } as unknown as XrayConfig
    expect(searchNodes(many, {}, 'in-')).toHaveLength(20)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/graph-search.test.ts`
Ожидаемо: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

```ts
// frontend/src/entities/graph/search.ts
// Поиск узла на холсте: на профиле с десятком inbound'ов и двумя десятками правил
// прокрутка — единственный способ найти нужный, и это плохой способ.

import type { XrayConfig } from '../xray'
import type { GraphContext } from './types'

export interface SearchHit {
  nodeId: string
  kind: 'inbound' | 'outbound' | 'rule' | 'squad' | 'dns'
  title: string
  /** Чем совпало — иначе в списке правил непонятно, почему они там */
  matchedOn: string
}

const LIMIT = 20

/** Первое совпавшее поле: показываем одну причину, а не все сразу */
function firstMatch(
  needle: string,
  fields: { label: string; value: unknown }[],
): string | undefined {
  for (const { label, value } of fields) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item === undefined || item === null) continue
      const text = String(item)
      if (text.toLowerCase().includes(needle)) return `${label}: ${text}`
    }
  }
  return undefined
}

export function searchNodes(config: XrayConfig, ctx: GraphContext, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const hits: SearchHit[] = []
  const push = (hit: SearchHit) => {
    if (hits.length < LIMIT) hits.push(hit)
  }

  for (const squad of ctx.squads ?? []) {
    const matched = firstMatch(needle, [{ label: 'сквад', value: squad.name }])
    if (matched) push({ nodeId: `squad:${squad.uuid}`, kind: 'squad', title: squad.name, matchedOn: matched })
  }

  for (const inb of config.inbounds ?? []) {
    const matched = firstMatch(needle, [
      { label: 'тег', value: inb.tag },
      { label: 'протокол', value: inb.protocol },
      { label: 'порт', value: inb.port },
      { label: 'транспорт', value: inb.streamSettings?.network },
      { label: 'security', value: inb.streamSettings?.security },
    ])
    if (matched) push({ nodeId: `in:${inb.tag}`, kind: 'inbound', title: inb.tag, matchedOn: matched })
  }

  for (const out of config.outbounds ?? []) {
    const matched = firstMatch(needle, [
      { label: 'тег', value: out.tag },
      { label: 'протокол', value: out.protocol },
    ])
    if (matched) push({ nodeId: `out:${out.tag}`, kind: 'outbound', title: out.tag, matchedOn: matched })
  }

  ;(config.routing?.rules ?? []).forEach((rule, index) => {
    const matched = firstMatch(needle, [
      { label: 'домен', value: rule.domain },
      { label: 'IP', value: rule.ip },
      { label: 'порт', value: rule.port },
      { label: 'протокол', value: rule.protocol },
      { label: 'outbound', value: rule.outboundTag },
      { label: 'inbound', value: rule.inboundTag },
    ])
    if (matched) {
      push({ nodeId: `rule:${index}`, kind: 'rule', title: `правило ${index + 1}`, matchedOn: matched })
    }
  })

  return hits
}
```

- [ ] **Step 4: Тест должен пройти**

Из каталога `frontend`: `npx vitest run test/graph-search.test.ts`
Ожидаемо: 9 passed.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/entities/graph/search.ts frontend/test/graph-search.test.ts
git commit -m "feat(frontend): search config nodes by tag, protocol, port and rule fields"
```

---

### Task 8: Строка поиска и центрирование на узле

**Files:**
- Create: `frontend/src/features/topology/SearchBox.tsx`
- Modify: `frontend/src/features/topology/TopologyView.tsx`, `frontend/src/features/editor/EditorPage.tsx`, `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/search-box.test.tsx`

**Interfaces:**
- Consumes: `SearchHit` (Task 7).
- Produces: `SearchBox({ query, hits, onQuery, onPick })`; проп `focus?: { nodeId: string; nonce: number } | null` у `TopologyView`.

- [ ] **Step 1: Написать падающий тест**

```tsx
// frontend/test/search-box.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBox } from '../src/features/topology/SearchBox'
import type { SearchHit } from '../src/entities/graph/search'

const HITS: SearchHit[] = [
  { nodeId: 'in:vless-in', kind: 'inbound', title: 'vless-in', matchedOn: 'тег: vless-in' },
  { nodeId: 'rule:0', kind: 'rule', title: 'правило 1', matchedOn: 'домен: geosite:google' },
]

describe('SearchBox', () => {
  it('ввод уходит наверх', async () => {
    const onQuery = vi.fn()
    render(<SearchBox query="" hits={[]} onQuery={onQuery} onPick={() => {}} />)
    await userEvent.type(screen.getByLabelText('Поиск по конфигу'), 'vl')
    expect(onQuery).toHaveBeenCalled()
  })

  it('показывает совпадения и объясняет их', () => {
    render(<SearchBox query="v" hits={HITS} onQuery={() => {}} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /vless-in/ })).toBeInTheDocument()
    expect(screen.getByText('домен: geosite:google')).toBeInTheDocument()
  })

  it('выбор отдаёт id узла', async () => {
    const onPick = vi.fn()
    render(<SearchBox query="v" hits={HITS} onQuery={() => {}} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: /правило 1/ }))
    expect(onPick).toHaveBeenCalledWith('rule:0')
  })

  it('пустой запрос списка не показывает', () => {
    render(<SearchBox query="" hits={HITS} onQuery={() => {}} onPick={() => {}} />)
    expect(screen.queryByRole('button', { name: /vless-in/ })).not.toBeInTheDocument()
  })

  it('запрос без совпадений говорит об этом прямо', () => {
    render(<SearchBox query="нетакого" hits={[]} onQuery={() => {}} onPick={() => {}} />)
    expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx vitest run test/search-box.test.tsx`
Ожидаемо: FAIL — компонента нет.

- [ ] **Step 3: Реализовать**

```tsx
// frontend/src/features/topology/SearchBox.tsx
import type { SearchHit } from '../../entities/graph/search'
import { TextInput } from '../../shared/ui'

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  inbound: 'inbound',
  outbound: 'outbound',
  rule: 'правило',
  squad: 'сквад',
  dns: 'dns',
}

export function SearchBox({
  query,
  hits,
  onQuery,
  onPick,
}: {
  query: string
  hits: SearchHit[]
  onQuery: (value: string) => void
  onPick: (nodeId: string) => void
}) {
  return (
    <div className="search-box">
      <label className="sr-only" htmlFor="graph-search">
        Поиск по конфигу
      </label>
      <TextInput
        id="graph-search"
        value={query}
        placeholder="Поиск: тег, порт, домен…"
        onChange={(e) => onQuery(e.target.value)}
      />
      {query.trim() !== '' && (
        <div className="search-results">
          {hits.length === 0 ? (
            <p className="muted search-empty">Ничего не найдено</p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={hit.nodeId}>
                  <button type="button" className="search-hit" onClick={() => onPick(hit.nodeId)}>
                    <span className="search-hit-kind">{KIND_LABEL[hit.kind]}</span>
                    <span className="search-hit-title">{hit.title}</span>
                    <span className="search-hit-why">{hit.matchedOn}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

Класса `.sr-only` в проекте ещё нет (проверено при написании плана) — он добавляется вместе с остальными стилями в конец `tokens.css`:

```css
/* Поиск по конфигу в доке графа */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.search-box { position: relative; }
.search-box input { width: 15rem; }
.search-results {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  width: 22rem;
  max-height: 40vh;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--rail);
  border-radius: var(--radius-sm);
  background: var(--panel);
  box-shadow: var(--shadow-1);
  z-index: 10;
}
.search-results ul { list-style: none; margin: 0; padding: 0; }
.search-empty { margin: 6px; font-size: var(--t-sm); }
.search-hit {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  padding: 6px 8px; border: none; border-radius: var(--radius-xs);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.search-hit:hover { background: var(--panel-2); }
.search-hit-kind { font-size: var(--t-xs); color: var(--ink-dim); min-width: 4.5rem; }
.search-hit-title { font-family: var(--font-mono); }
.search-hit-why { margin-left: auto; font-size: var(--t-xs); color: var(--ink-dim); }
```

В `TopologyView.tsx` добавить проп и компонент центрирования:

```tsx
/** Центрирование на узле по запросу поиска; nonce позволяет вернуться к тому же узлу повторно */
function FocusNode({ request }: { request?: { nodeId: string; nonce: number } | null }) {
  const { getNode, setCenter } = useReactFlow()

  useEffect(() => {
    if (!request) return
    const node = getNode(request.nodeId)
    if (!node) return
    const width = node.measured?.width ?? 220
    const height = node.measured?.height ?? 90
    setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1,
      duration: 320,
    })
  }, [request, getNode, setCenter])

  return null
}
```

В `Props`: `focus?: { nodeId: string; nonce: number } | null`; принять в параметрах и отрисовать `<FocusNode request={focus} />` рядом с `<ViewportShift …>`.

В `EditorPage.tsx`:

```ts
  const [searchQuery, setSearchQuery] = useState('')
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number } | null>(null)
  const focusNonce = useRef(0)

  const searchHits = useMemo(
    () => (parsedConfig ? searchNodes(parsedConfig, ctx, searchQuery) : []),
    [parsedConfig, ctx, searchQuery],
  )
```

и в `dockExtra` — перед кнопкой «Трасса»:

```tsx
                    <SearchBox
                      query={searchQuery}
                      hits={searchHits}
                      onQuery={setSearchQuery}
                      onPick={(nodeId) => {
                        setSelectedNode(nodeId)
                        focusNonce.current += 1
                        setFocus({ nodeId, nonce: focusNonce.current })
                        setSearchQuery('')
                      }}
                    />
```

плюс проп `focus={focus}` у `<TopologyView …>` и импорты `SearchBox` / `searchNodes`.

- [ ] **Step 4: Тесты должны пройти**

Из каталога `frontend`: `npx vitest run test/search-box.test.tsx` — 5 passed; весь фронт `npx vitest run`; `npx tsc --noEmit`.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/topology/SearchBox.tsx frontend/src/features/topology/TopologyView.tsx frontend/src/features/editor/EditorPage.tsx frontend/src/shared/ui/tokens.css frontend/test/search-box.test.tsx
git commit -m "feat(frontend): find a node from the dock and center the graph on it"
```

---

### Task 9: Сценарии e2e

**Files:**
- Create: `frontend/e2e/ux-navigation.spec.ts`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: ничего.

- [ ] **Step 1: Написать падающий тест**

```ts
// frontend/e2e/ux-navigation.spec.ts
import { expect, test } from '@playwright/test'
import { CONFIG, PROFILE, UUID, mockApi } from './mocks'

// Конфиг с заведомой проблемой: Reality поверх ws — ошибка матрицы совместимости
const BROKEN = {
  ...CONFIG,
  inbounds: [
    {
      ...CONFIG.inbounds[0],
      streamSettings: { network: 'ws', security: 'reality' },
    },
  ],
}

async function openBroken(page: import('@playwright/test').Page) {
  await mockApi(page)
  await page.route(`**/api/profiles/${UUID}`, (r) =>
    r.fulfill({ json: { profile: { ...PROFILE, config: BROKEN } } }),
  )
  await page.goto(`/profiles/${UUID}`)
}

test('узел с ошибкой помечен значком', async ({ page }) => {
  await openBroken(page)
  const node = page.locator('.react-flow__node[data-id="in:vless-in"]')
  await expect(node.locator('.node-issue-error')).toBeVisible()
})

test('клик по проблеме открывает инспектор нужного узла', async ({ page }) => {
  await openBroken(page)
  await page.getByRole('button', { name: /ошибок:/ }).click()
  await page.getByRole('button', { name: /Reality/ }).first().click()
  await expect(page.locator('aside')).toContainText('vless-in')
})

test('на вкладке JSON клик по проблеме выделяет её место', async ({ page }) => {
  await openBroken(page)
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByRole('button', { name: /ошибок:/ }).click()
  await page.getByRole('button', { name: /Reality/ }).first().click()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected).toContain('reality')
})

test('поиск находит узел и открывает его', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await page.getByLabel('Поиск по конфигу').fill('vless')
  await page.getByRole('button', { name: /vless-in/ }).first().click()
  await expect(page.locator('aside')).toContainText('vless-in')
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Из каталога `frontend`: `npx playwright test e2e/ux-navigation.spec.ts`
Ожидаемо: FAIL до выполнения задач 5–8 (при исполнении по порядку — проходит; запускать после задачи 8).

- [ ] **Step 3: Довести до зелёного**

Кода здесь не пишем — прогоняем и правим селекторы под фактическую разметку. Типовые расхождения и что с ними делать:
- кнопка разворота статус-бара называется по счётчикам (`ошибок: 1`) — если счётчик другой, поправить регулярку в тесте;
- если `window.getSelection()` в CodeMirror отдаёт пустую строку, заменить проверку на видимость активной строки: `await expect(page.locator('.cm-selectionBackground')).toBeVisible()`;
- если значок узла не находится, проверить, что `EditorPage` передаёт `issues` в `TopologyView`.

- [ ] **Step 4: Прогнать всё**

Из каталога `frontend`: `npx playwright test` — вся папка `e2e` зелёная.

- [ ] **Step 5: Коммит**

```bash
git add frontend/e2e/ux-navigation.spec.ts
git commit -m "test(frontend): e2e for problem navigation and config search"
```

---

### Task 10: Документация

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Дописать CLAUDE.md**

В раздел «Frontend», к пункту про `features/editor`:

```markdown
- Диагностики несут путь массивом (`ValidationIssue.parts`), а строковый `path` — производный
  (`formatPath`). На `parts` завязаны три резолвера: `features/editor/jsonLocate.ts` (путь →
  диапазон в документе, спуск по дереву CodeMirror — обратная задача к `intellisense/context.ts`),
  `entities/graph/locate.ts` (путь → id узла и счётчики проблем), `entities/graph/search.ts`
  (поиск узлов). Клик по проблеме зависит от вкладки: на топологии ведёт к узлу, в JSON —
  прокручивает к месту; вкладку не переключаем, потому что у `log`/`policy` узла нет.
```

- [ ] **Step 2: Дописать README**

В раздел «Возможности», рядом с пунктом про умную валидацию:

```markdown
- **Навигация по проблемам.** Ошибка подчёркивает своё место в JSON, а клик по ней в статус-баре
  ведёт к узлу графа (на вкладке «Топология») или к нужной строке (на вкладке JSON). Узлы с
  проблемами помечены значком. Рядом — поиск по тегам, портам, доменам и правилам с центрированием
  на найденном узле.
```

- [ ] **Step 3: Финальная проверка**

Из корня: `npm test`, `npm run build`; из `frontend`: `npx playwright test`.

- [ ] **Step 4: Коммит**

```bash
git add CLAUDE.md README.md
git commit -m "docs: describe problem navigation and config search"
```

---

## Финальная проверка

- [ ] `npm test` из корня — оба workspace зелёные
- [ ] `npm run build` из корня — tsup + tsc + vite проходят
- [ ] `npx playwright test` из `frontend` — вся папка e2e зелёная
- [ ] Далее — **REQUIRED SUB-SKILL:** superpowers:finishing-a-development-branch

## Self-review (выполнен при написании плана)

**Покрытие спеки.** Раздел 1 (`parts` и `formatPath`) — задача 1. Раздел 2 (`locateRange`,
линтер, `reveal`) — задачи 2, 3, 6. Раздел 3 (`nodeIdForPath`, `issueCountsByNode`, ограничение
по перерисовке) — задачи 4, 5. Раздел 4 (клик по проблеме) — задача 6. Раздел 5 (поиск и
центрирование) — задачи 7, 8. Раздел 6 (тестирование) — тесты в каждой задаче плюс четыре
e2e-сценария.

**Расхождения со спекой, принятые сознательно.**
1. Спека описывала откат на родителя только для последнего сегмента; в реализации это обобщено
   до «глубочайшего найденного предка» — тот же принцип, но без частного случая. Отдельно
   зафиксировано, что при нулевой глубине возвращается `null`, иначе подсветился бы весь документ.
2. `locateRange` использует `ensureSyntaxTree`, а не `syntaxTree`: в живом редакторе дерево
   разобрано только до видимой области, и диагностика в хвосте большого конфига не нашла бы
   своего места. В спеке этой детали не было.
3. Поиск возвращает **одну** причину совпадения на узел (первое совпавшее поле). Показывать все
   причины сразу — шум, а нужен ответ на вопрос «почему этот узел здесь».

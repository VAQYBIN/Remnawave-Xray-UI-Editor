# Безопасность правок: undo/redo, хоткеи, файл, сравнение версий — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать черновику историю правок с отменой и возвратом, клавиатурные пути к частым действиям, выгрузку и загрузку конфига файлом и сравнение бэкапа с текущим черновиком.

**Architecture:** История — отдельный zustand-стор в памяти со стеками `past`/`future` строк-снимков, ключ — uuid профиля; все записи черновика в `EditorPage` проходят через одну функцию `writeDraft`, которая решает, писать ли снимок. Хоткеи — маленький хук над `window.keydown` с чистыми `matchCombo`/`isEditableTarget`. Работа с файлом — чистые функции разбора и именования плюс изолированный `downloadJson`. Сравнение — общий компонент `DiffView` поверх `MergeView`, который забирают себе и диалог сохранения, и новый диалог версий.

**Tech Stack:** React 19, zustand 5 (без `persist` для истории), `@codemirror/merge`, vitest + @testing-library/react, Playwright.

**Спека:** `docs/superpowers/specs/2026-07-25-edit-safety-design.md`.

## Global Constraints

- Весь UI, тексты ошибок и комментарии в коде — на русском; коммиты — английский conventional style (`feat(frontend): ...`).
- Слои: `shared` → `entities` → `features`. `entities` не импортирует из `features`. Хук хоткеев живёт в `shared/lib`, история и работа с файлом — в `features/editor`.
- Сторонних UI-библиотек не добавляем, новых зависимостей в `package.json` не появляется: `@codemirror/merge` уже есть.
- Глубина истории — 50 снимков (`HISTORY_LIMIT`), хранится только в памяти, `persist` не подключается.
- Набор хоткеев ровно такой: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, `Ctrl/Cmd+F`, `Escape`, `?`. `Ctrl+S` не вводим.
- Импорт мягкий: принимаем любой JSON-объект, отказ только на неразбираемом JSON и на массиве/скаляре.
- После полной замены конфига (undo, redo, импорт, восстановление бэкапа) обязателен `setSelectedNode(null)` — позиционные `rule:N` дрейфуют.
- Команды запускаются из каталога `frontend`: `npm test`, `npm run typecheck`, `npm run e2e`.

---

### Task 1: Стор истории правок

**Files:**
- Create: `frontend/src/features/editor/historyStore.ts`
- Test: `frontend/test/history-store.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `useHistoryStore` (zustand-стор с полем `stacks: Record<string, HistoryStack>` и методами `record(uuid: string, prevText: string): void`, `undo(uuid: string, currentText: string): string | null`, `redo(uuid: string, currentText: string): string | null`, `clear(uuid: string): void`), тип `HistoryStack = { past: string[]; future: string[] }`, константа `HISTORY_LIMIT = 50`, чистые селекторы `canUndo(stacks, uuid): boolean` и `canRedo(stacks, uuid): boolean`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/history-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  useHistoryStore,
} from '../src/features/editor/historyStore'

beforeEach(() => useHistoryStore.setState({ stacks: {} }))

const h = () => useHistoryStore.getState()

describe('historyStore', () => {
  it('record кладёт прошлый текст, undo его возвращает', () => {
    h().record('u1', 'A')
    expect(h().undo('u1', 'B')).toBe('A')
  })

  it('redo возвращает то, что отменили', () => {
    h().record('u1', 'A')
    h().undo('u1', 'B')
    expect(h().redo('u1', 'A')).toBe('B')
  })

  it('пустой стек — null, состояние не меняется', () => {
    expect(h().undo('u1', 'B')).toBeNull()
    expect(h().redo('u1', 'B')).toBeNull()
    expect(h().stacks['u1']).toBeUndefined()
  })

  it('новая правка после отмены обрывает future', () => {
    h().record('u1', 'A')
    h().undo('u1', 'B')
    h().record('u1', 'C')
    expect(canRedo(h().stacks, 'u1')).toBe(false)
  })

  it('глубина ограничена HISTORY_LIMIT, вытесняется самый старый', () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) h().record('u1', `s${i}`)
    const past = h().stacks['u1']!.past
    expect(past).toHaveLength(HISTORY_LIMIT)
    expect(past[0]).toBe('s5')
  })

  it('clear убирает стек профиля, не трогая соседний', () => {
    h().record('u1', 'A')
    h().record('u2', 'B')
    h().clear('u1')
    expect(canUndo(h().stacks, 'u1')).toBe(false)
    expect(canUndo(h().stacks, 'u2')).toBe(true)
  })

  it('стеки профилей независимы', () => {
    h().record('u1', 'A')
    expect(h().undo('u2', 'X')).toBeNull()
    expect(h().undo('u1', 'B')).toBe('A')
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run test/history-store.test.ts`
Ожидается: FAIL — `Failed to resolve import "../src/features/editor/historyStore"`.

- [ ] **Step 3: Реализовать стор**

Создать `frontend/src/features/editor/historyStore.ts`:

```ts
import { create } from 'zustand'

/**
 * Глубина истории. 50 снимков конфига по 10–50 КБ — это единицы мегабайт, поэтому
 * история живёт только в памяти: persist вытеснил бы из localStorage сами черновики
 * (квота около 5 МБ на origin). История — сессионный инструмент, как цель трассировки.
 */
export const HISTORY_LIMIT = 50

export interface HistoryStack {
  past: string[]
  future: string[]
}

interface HistoryState {
  stacks: Record<string, HistoryStack>
  record: (uuid: string, prevText: string) => void
  undo: (uuid: string, currentText: string) => string | null
  redo: (uuid: string, currentText: string) => string | null
  clear: (uuid: string) => void
}

const EMPTY: HistoryStack = { past: [], future: [] }

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  stacks: {},
  record: (uuid, prevText) =>
    set((s) => {
      const cur = s.stacks[uuid] ?? EMPTY
      // Новая правка обрывает ветку возврата — иначе redo вернул бы чужое состояние
      return {
        stacks: {
          ...s.stacks,
          [uuid]: { past: [...cur.past, prevText].slice(-HISTORY_LIMIT), future: [] },
        },
      }
    }),
  undo: (uuid, currentText) => {
    const cur = get().stacks[uuid] ?? EMPTY
    const prev = cur.past[cur.past.length - 1]
    if (prev === undefined) return null
    set((s) => ({
      stacks: {
        ...s.stacks,
        [uuid]: { past: cur.past.slice(0, -1), future: [...cur.future, currentText] },
      },
    }))
    return prev
  },
  redo: (uuid, currentText) => {
    const cur = get().stacks[uuid] ?? EMPTY
    const next = cur.future[cur.future.length - 1]
    if (next === undefined) return null
    set((s) => ({
      stacks: {
        ...s.stacks,
        [uuid]: { past: [...cur.past, currentText], future: cur.future.slice(0, -1) },
      },
    }))
    return next
  },
  clear: (uuid) =>
    set((s) => {
      const { [uuid]: _removed, ...rest } = s.stacks
      return { stacks: rest }
    }),
}))

export function canUndo(stacks: Record<string, HistoryStack>, uuid: string): boolean {
  return (stacks[uuid]?.past.length ?? 0) > 0
}

export function canRedo(stacks: Record<string, HistoryStack>, uuid: string): boolean {
  return (stacks[uuid]?.future.length ?? 0) > 0
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Запустить: `npx vitest run test/history-store.test.ts`
Ожидается: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/historyStore.ts frontend/test/history-store.test.ts
git commit -m "feat(frontend): in-memory draft history store"
```

---

### Task 2: Хоткеи — чистые функции и хук

**Files:**
- Create: `frontend/src/shared/lib/useHotkeys.ts`
- Test: `frontend/test/use-hotkeys.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `matchCombo(event: KeyboardEvent, combo: string): boolean`, `isEditableTarget(target: EventTarget | null): boolean`, `hasOpenDialog(): boolean`, тип `Hotkey = { combo: string; handler: (event: KeyboardEvent) => void; whenEditable?: boolean; preventDefault?: boolean }`, хук `useHotkeys(hotkeys: Hotkey[]): void`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/use-hotkeys.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { isEditableTarget, matchCombo, useHotkeys } from '../src/shared/lib/useHotkeys'

function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('matchCombo', () => {
  it('mod+z ловит и Ctrl, и Cmd', () => {
    expect(matchCombo(key({ key: 'z', ctrlKey: true }), 'mod+z')).toBe(true)
    expect(matchCombo(key({ key: 'z', metaKey: true }), 'mod+z')).toBe(true)
  })

  it('mod+z не срабатывает без модификатора и с shift', () => {
    expect(matchCombo(key({ key: 'z' }), 'mod+z')).toBe(false)
    expect(matchCombo(key({ key: 'z', ctrlKey: true, shiftKey: true }), 'mod+z')).toBe(false)
  })

  it('mod+shift+z требует shift', () => {
    expect(matchCombo(key({ key: 'Z', ctrlKey: true, shiftKey: true }), 'mod+shift+z')).toBe(true)
    expect(matchCombo(key({ key: 'z', ctrlKey: true }), 'mod+shift+z')).toBe(false)
  })

  it('mod+y и mod+f', () => {
    expect(matchCombo(key({ key: 'y', ctrlKey: true }), 'mod+y')).toBe(true)
    expect(matchCombo(key({ key: 'f', metaKey: true }), 'mod+f')).toBe(true)
  })

  it('«?» матчится, хотя набирается с shift', () => {
    expect(matchCombo(key({ key: '?', shiftKey: true }), '?')).toBe(true)
  })

  it('Escape не матчится с модификатором', () => {
    expect(matchCombo(key({ key: 'Escape' }), 'Escape')).toBe(true)
    expect(matchCombo(key({ key: 'Escape', ctrlKey: true }), 'Escape')).toBe(false)
  })
})

describe('isEditableTarget', () => {
  it('input, textarea и contenteditable — редактируемые', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const cm = document.createElement('div')
    cm.setAttribute('contenteditable', 'true')
    document.body.append(cm)
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(textarea)).toBe(true)
    expect(isEditableTarget(cm)).toBe(true)
    cm.remove()
  })

  it('обычный div и null — нет', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('useHotkeys', () => {
  it('вызывает обработчик по совпадению', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys([{ combo: 'mod+z', handler }]))
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('молчит, когда фокус в поле ввода', () => {
    const handler = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    renderHook(() => useHotkeys([{ combo: 'mod+z', handler }]))
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
    input.remove()
  })

  it('whenEditable пропускает хоткей и в поле ввода', () => {
    const handler = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    renderHook(() => useHotkeys([{ combo: 'Escape', handler, whenEditable: true }]))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(handler).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('снимает слушатель при размонтировании', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useHotkeys([{ combo: 'mod+z', handler }]))
    unmount()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run test/use-hotkeys.test.ts`
Ожидается: FAIL — модуль `../src/shared/lib/useHotkeys` не найден.

- [ ] **Step 3: Реализовать хук**

Создать `frontend/src/shared/lib/useHotkeys.ts`:

```ts
import { useEffect, useRef } from 'react'

export interface Hotkey {
  /** 'mod+z' | 'mod+shift+z' | 'mod+y' | 'mod+f' | 'Escape' | '?' */
  combo: string
  handler: (event: KeyboardEvent) => void
  /** По умолчанию хоткей молчит, когда фокус в поле ввода */
  whenEditable?: boolean
  /** По умолчанию совпавший хоткей отменяет действие браузера */
  preventDefault?: boolean
}

/**
 * Поле ввода, textarea, select или contenteditable. Последнее покрывает и
 * `.cm-content` CodeMirror — иначе Ctrl+Z в JSON-редакторе перехватывался бы
 * историей приложения вместо посимвольной отмены редактора.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Открыт ли нативный модальный диалог — тогда Escape его, а не наш */
export function hasOpenDialog(): boolean {
  return document.querySelector('dialog[open]') !== null
}

export function matchCombo(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1] ?? ''
  if (event.key.toLowerCase() !== key) return false
  const mod = event.ctrlKey || event.metaKey
  if (parts.includes('mod')) {
    if (!mod) return false
    // Ctrl+Shift+Z и Ctrl+Z — разные хоткеи, различаем строго
    return event.shiftKey === parts.includes('shift')
  }
  // Без модификатора shift не проверяем: «?» на большинстве раскладок набирается с ним
  return !mod
}

export function useHotkeys(hotkeys: Hotkey[]): void {
  // Массив пересобирается на каждый рендер, а слушатель вешаем один раз —
  // свежие обработчики берём из ref, иначе они замкнутся на первый рендер
  const ref = useRef(hotkeys)
  ref.current = hotkeys

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const editable = isEditableTarget(event.target)
      for (const hk of ref.current) {
        if (!matchCombo(event, hk.combo)) continue
        if (editable && !hk.whenEditable) continue
        if (hk.preventDefault !== false) event.preventDefault()
        hk.handler(event)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Запустить: `npx vitest run test/use-hotkeys.test.ts`
Ожидается: PASS, 12 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/shared/lib/useHotkeys.ts frontend/test/use-hotkeys.test.ts
git commit -m "feat(frontend): hotkey hook with editable-target guard"
```

---

### Task 3: Работа с файлом конфига

**Files:**
- Create: `frontend/src/features/editor/configFile.ts`
- Test: `frontend/test/config-file.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `exportFileName(profileName: string, date: Date): string`, `parseImported(raw: string): { text: string } | { error: string }`, `downloadJson(text: string, fileName: string): void`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/config-file.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadJson, exportFileName, parseImported } from '../src/features/editor/configFile'

const DATE = new Date('2026-07-25T12:00:00.000Z')

describe('exportFileName', () => {
  it('приводит имя к слагу и добавляет дату', () => {
    expect(exportFileName('Germany DE', DATE)).toBe('germany-de-2026-07-25.json')
  })

  it('кириллица сохраняется, служебные символы схлопываются', () => {
    expect(exportFileName('Германия / основной', DATE)).toBe('германия-основной-2026-07-25.json')
  })

  it('имя без пригодных символов вырождается в config', () => {
    expect(exportFileName('!!!', DATE)).toBe('config-2026-07-25.json')
  })
})

describe('parseImported', () => {
  it('объект конфига переформатируется в два пробела', () => {
    const result = parseImported('{"inbounds":[]}')
    expect(result).toEqual({ text: '{\n  "inbounds": []\n}' })
  })

  it('файл бэкапа с profile.config разворачивается', () => {
    const raw = JSON.stringify({ savedAt: 'x', profile: { name: 'p', config: { inbounds: [] } } })
    expect(parseImported(raw)).toEqual({ text: '{\n  "inbounds": []\n}' })
  })

  it('обёртка {config} тоже разворачивается', () => {
    expect(parseImported('{"config":{"inbounds":[]}}')).toEqual({ text: '{\n  "inbounds": []\n}' })
  })

  it('не JSON — понятная ошибка', () => {
    const result = parseImported('не json')
    expect('error' in result && result.error).toMatch(/не разбирается как JSON/)
  })

  it('массив вместо объекта — отказ', () => {
    const result = parseImported('[1,2]')
    expect('error' in result && result.error).toMatch(/массив/)
  })

  it('строка вместо объекта — отказ', () => {
    const result = parseImported('"hello"')
    expect('error' in result && result.error).toMatch(/строка/)
  })
})

describe('downloadJson', () => {
  const createObjectURL = vi.fn(() => 'blob:x')
  const revokeObjectURL = vi.fn()

  // jsdom этих методов не реализует: присваиваем их напрямую, а не подменяем весь
  // класс URL через stubGlobal — иначе сломается конструктор `new URL()`
  beforeEach(() => {
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
  })
  afterEach(() => vi.clearAllMocks())

  it('создаёт ссылку с именем файла и освобождает URL', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadJson('{"a":1}', 'cfg.json')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run test/config-file.test.ts`
Ожидается: FAIL — модуль `../src/features/editor/configFile` не найден.

- [ ] **Step 3: Реализовать модуль**

Создать `frontend/src/features/editor/configFile.ts`:

```ts
/**
 * Имя файла выгрузки: «Germany DE» + 25.07.2026 → germany-de-2026-07-25.json.
 * Кириллицу оставляем — имена профилей у нас русские, а файловые системы её держат.
 */
export function exportFileName(profileName: string, date: Date): string {
  const slug = profileName
    .toLowerCase()
    .replace(/[^a-zа-яё0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'config'}-${date.toISOString().slice(0, 10)}.json`
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return 'массив'
  if (value === null) return 'null'
  if (typeof value === 'string') return 'строка'
  if (typeof value === 'number') return 'число'
  if (typeof value === 'boolean') return 'логическое значение'
  return typeof value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Разворачивает обёртки: файл из DATA_DIR/backups лежит как {savedAt, profile:{config}},
 * а ответ API — как {config}. У самого конфига Xray ключа `config` нет, так что
 * неоднозначности не возникает.
 */
function unwrapConfig(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null
  const profile = value['profile']
  if (isObject(profile) && isObject(profile['config'])) return profile['config']
  if (isObject(value['config'])) return value['config'] as Record<string, unknown>
  return value
}

export function parseImported(raw: string): { text: string } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (err) {
    return { error: `Файл не разбирается как JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  const config = unwrapConfig(value)
  if (config === null) return { error: `Ожидается объект конфига, а в файле ${kindOf(value)}.` }
  return { text: JSON.stringify(config, null, 2) }
}

export function downloadJson(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Запустить: `npx vitest run test/config-file.test.ts`
Ожидается: PASS, 11 тестов.

- [ ] **Step 5: Коммит**

```bash
git add frontend/src/features/editor/configFile.ts frontend/test/config-file.test.ts
git commit -m "feat(frontend): config file export name and import parsing"
```

---

### Task 4: Общий компонент сравнения `DiffView`

**Files:**
- Create: `frontend/src/features/editor/DiffView.tsx`
- Modify: `frontend/src/features/editor/SaveDialog.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/diff-view.test.tsx`

**Interfaces:**
- Consumes: ничего.
- Produces: `<DiffView original={string} modified={string} maxHeight?: string />`.

- [ ] **Step 1: Проверить риск — поднимается ли MergeView в jsdom**

Создать `frontend/test/diff-view.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DiffView } from '../src/features/editor/DiffView'

describe('DiffView', () => {
  it('монтируется и рисует обе стороны сравнения', () => {
    const { container } = render(<DiffView original='{"a":1}' modified='{"a":2}' />)
    expect(container.querySelectorAll('.cm-editor').length).toBe(2)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run test/diff-view.test.tsx`
Ожидается: FAIL — модуль `../src/features/editor/DiffView` не найден.

- [ ] **Step 3: Реализовать `DiffView`**

Создать `frontend/src/features/editor/DiffView.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@uiw/react-codemirror'

const diffTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
})

interface Props {
  original: string
  modified: string
  maxHeight?: string
}

/**
 * Сравнение двух версий конфига. Вьюха пересоздаётся при смене документов:
 * MergeView не умеет менять их на лету, а переключений здесь единицы.
 */
export function DiffView({ original, modified, maxHeight = '65vh' }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const view = new MergeView({
      a: { doc: original, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      b: { doc: modified, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      parent: ref.current,
    })
    return () => view.destroy()
  }, [original, modified])

  return <div ref={ref} className="diff-frame" style={{ maxHeight }} />
}
```

- [ ] **Step 4: Запустить тест и решить судьбу проверки diff в jsdom**

Запустить: `npx vitest run test/diff-view.test.tsx`

- Если PASS — оставить тест как есть и идти дальше.
- Если FAIL из-за отсутствующего в jsdom API (`Range`, `getClientRects`, `IntersectionObserver`): заменить утверждение на проверку, что компонент смонтировался без исключения и контейнер не пуст (`expect(container.querySelector('.diff-frame')).toBeInTheDocument()`), а строку про две стороны сравнения перенести в e2e-сценарий Task 8 (сравнение бэкапа). Записать выбранный вариант в комментарий над тестом одной строкой — почему проверка урезана.

- [ ] **Step 5: Перевести `SaveDialog` на общий компонент**

В `frontend/src/features/editor/SaveDialog.tsx` удалить `useEffect`/`useRef`/`MergeView`/`diffTheme` и импорты `@codemirror/merge`, `@codemirror/lang-json`, `EditorView`, `useEffect`, `useRef`; вместо `<div ref={ref} style={…} />` поставить:

```tsx
{open && <DiffView original={original} modified={modified} />}
```

с импортом `import { DiffView } from './DiffView'`. Комментарий про модальность сохранить, переформулировав:

```tsx
// Пока open=true, нативный <dialog> модален и блокирует ввод в редактор, поэтому
// modified не может измениться при открытом диалоге: DiffView монтируется на открытие
// и уничтожается на закрытие.
```

- [ ] **Step 6: Добавить стиль рамки**

В `frontend/src/shared/ui/tokens.css` дописать в конец файла:

```css
/* Сравнение версий конфига: общая рамка для MergeView */
.diff-frame { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-xs); }
```

- [ ] **Step 7: Проверить сборку и тесты**

Запустить: `npm run typecheck && npm test`
Ожидается: typecheck чист, все тесты проходят (в `SaveDialog` больше нет неиспользуемых импортов).

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/features/editor/DiffView.tsx frontend/src/features/editor/SaveDialog.tsx frontend/src/shared/ui/tokens.css frontend/test/diff-view.test.tsx
git commit -m "refactor(frontend): extract DiffView from SaveDialog"
```

---

### Task 5: Диалог «Версии конфига»

**Files:**
- Create: `frontend/src/features/editor/VersionsDialog.tsx`
- Delete: `frontend/src/features/editor/BackupsDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Modify: `frontend/e2e/editor.spec.ts:53`
- Test: `frontend/test/versions-dialog.test.tsx` (замена `frontend/test/backups-dialog.test.tsx`)

**Interfaces:**
- Consumes: `DiffView` (Task 4), `downloadJson`/`exportFileName`/`parseImported` (Task 3).
- Produces: `<VersionsDialog open profileUuid profileName currentText onRestore onClose />`, где `onRestore: (configText: string) => void`.

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/test/versions-dialog.test.tsx` (старый `test/backups-dialog.test.tsx` удалить в Step 5):

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VersionsDialog } from '../src/features/editor/VersionsDialog'

const profileUuid = 'u1'

const backups = [
  { file: 'a.json', savedAt: '2026-07-20T10:00:00.000Z', profileName: 'Germany' },
  { file: 'b.json', savedAt: '2026-07-19T10:00:00.000Z', profileName: 'Germany' },
]

const fileData = {
  savedAt: '2026-07-20T10:00:00.000Z',
  profile: {
    uuid: profileUuid,
    viewPosition: 0,
    name: 'Germany',
    config: { inbounds: [] },
    inbounds: [],
    nodes: [],
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
  },
}

function stubFetch(list: unknown[] = backups) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/backups')) {
        return new Response(JSON.stringify({ backups: list }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/backups/')) {
        return new Response(JSON.stringify(fileData), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

function renderDialog(props: Partial<{ onRestore: (t: string) => void; onClose: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onRestore = props.onRestore ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  const utils = render(
    <QueryClientProvider client={qc}>
      <VersionsDialog
        open
        profileUuid={profileUuid}
        profileName="Germany"
        currentText={'{\n  "inbounds": []\n}'}
        onRestore={onRestore}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onRestore, onClose }
}

afterEach(() => vi.unstubAllGlobals())

describe('VersionsDialog', () => {
  it('вкладка бэкапов открыта первой и показывает записи', async () => {
    stubFetch()
    renderDialog()
    expect(await screen.findAllByText('Germany')).toHaveLength(2)
    expect(await screen.findAllByRole('button', { name: 'В черновик' })).toHaveLength(2)
  })

  it('пустой список — текст «Бэкапов пока нет.»', async () => {
    stubFetch([])
    renderDialog()
    expect(await screen.findByText('Бэкапов пока нет.')).toBeInTheDocument()
  })

  it('«В черновик» отдаёт конфиг бэкапа и закрывает диалог', async () => {
    stubFetch()
    const user = userEvent.setup()
    const { onRestore, onClose } = renderDialog()
    const buttons = await screen.findAllByRole('button', { name: 'В черновик' })
    await user.click(buttons[0]!)
    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith(JSON.stringify(fileData.profile.config, null, 2)),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('«Сравнить» переводит диалог в режим сравнения с кнопкой возврата', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderDialog()
    const buttons = await screen.findAllByRole('button', { name: 'Сравнить' })
    await user.click(buttons[0]!)
    expect(await screen.findByRole('button', { name: '← К списку' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сравнить' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '← К списку' }))
    expect(await screen.findAllByRole('button', { name: 'Сравнить' })).toHaveLength(2)
  })

  it('вкладка «Файл»: скачивание отдаёт текущий текст', async () => {
    stubFetch()
    const createObjectURL = vi.fn(() => 'blob:x')
    // Присваиваем методы напрямую: stubGlobal('URL', …) снёс бы конструктор new URL()
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    await user.click(screen.getByRole('button', { name: /Скачать JSON/ }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('вкладка «Файл»: корректный файл уходит в черновик', async () => {
    stubFetch()
    const user = userEvent.setup()
    const { onRestore } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    const file = new File(['{"outbounds":[]}'], 'cfg.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Файл конфига'), file)
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith('{\n  "outbounds": []\n}'))
  })

  it('вкладка «Файл»: битый файл показывает ошибку и не трогает черновик', async () => {
    stubFetch()
    const user = userEvent.setup()
    const { onRestore } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    const file = new File(['не json'], 'cfg.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Файл конфига'), file)
    expect(await screen.findByText(/не разбирается как JSON/)).toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run test/versions-dialog.test.tsx`
Ожидается: FAIL — модуль `../src/features/editor/VersionsDialog` не найден.

- [ ] **Step 3: Реализовать диалог**

Спека допускала вынос списка бэкапов в отдельный `BackupsList.tsx`, если файл переваливает за
~180 строк. Приведённая ниже реализация укладывается в один файл: список — это плоская разметка без
своего состояния, а весь стейт (вкладка, режим сравнения, ошибка, занятость) общий для диалога.
Разделение добавило бы проброс шести пропсов ради тридцати строк JSX.

Создать `frontend/src/features/editor/VersionsDialog.tsx`:

```tsx
import { useRef, useState, type ChangeEvent } from 'react'
import { apiFetch, useBackups, type BackupFileData } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'
import { DiffView } from './DiffView'
import { downloadJson, exportFileName, parseImported } from './configFile'

interface Props {
  open: boolean
  profileUuid: string
  profileName: string
  /** Текущий текст черновика: он же уходит в файл и стоит справа в сравнении */
  currentText: string
  onRestore: (configText: string) => void
  onClose: () => void
}

export function VersionsDialog({
  open,
  profileUuid,
  profileName,
  currentText,
  onRestore,
  onClose,
}: Props) {
  const backups = useBackups(profileUuid, open)
  const [tab, setTab] = useState<'backups' | 'file'>('backups')
  const [compare, setCompare] = useState<{ label: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadBackup(file: string): Promise<string | null> {
    setBusy(true)
    setError(null)
    try {
      const data = await apiFetch<BackupFileData>(`/api/profiles/${profileUuid}/backups/${file}`)
      return JSON.stringify(data.profile.config, null, 2)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  function apply(text: string) {
    onRestore(text)
    setCompare(null)
    onClose()
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Сбрасываем значение сразу: иначе повторный выбор того же файла не даст change
    event.target.value = ''
    if (!file) return
    const result = parseImported(await file.text())
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    apply(result.text)
  }

  return (
    <Dialog open={open} title="Версии конфига" onClose={onClose} wide={compare !== null}>
      {compare === null ? (
        <>
          <div className="segmented versions-tabs">
            <Button aria-pressed={tab === 'backups'} onClick={() => setTab('backups')}>
              Бэкапы панели
            </Button>
            <Button aria-pressed={tab === 'file'} onClick={() => setTab('file')}>
              Файл
            </Button>
          </div>

          {tab === 'backups' && (
            <>
              <p className="muted">
                Бэкап создаётся автоматически перед каждым сохранением в панель. Восстановление
                кладёт конфиг в черновик — панель изменится только после «Сохранить в панель».
              </p>
              {backups.isPending && <p className="muted">Загрузка…</p>}
              {backups.isError && <p className="field-error">{(backups.error as Error).message}</p>}
              {backups.data && backups.data.length === 0 && <p className="muted">Бэкапов пока нет.</p>}
              {backups.data && backups.data.length > 0 && (
                <div className="backup-list">
                  {backups.data.map((b) => (
                    <div
                      key={b.file}
                      className="row"
                      style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}
                    >
                      <div>
                        <div>{b.profileName}</div>
                        <div className="muted mono" style={{ fontSize: 12 }}>
                          {new Date(b.savedAt).toLocaleString('ru-RU')} · {relativeTime(b.savedAt)}
                        </div>
                      </div>
                      <span className="spacer" />
                      <Button
                        disabled={busy}
                        onClick={async () => {
                          const text = await loadBackup(b.file)
                          if (text !== null) {
                            setCompare({
                              label: `бэкап от ${new Date(b.savedAt).toLocaleString('ru-RU')}`,
                              text,
                            })
                          }
                        }}
                      >
                        Сравнить
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={async () => {
                          const text = await loadBackup(b.file)
                          if (text !== null) apply(text)
                        }}
                      >
                        В черновик
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'file' && (
            <div className="file-tab">
              <p className="muted">
                Скачивание отдаёт текущий текст черновика. Загрузка заменяет черновик целиком —
                отменить можно кнопкой ↶.
              </p>
              <div className="row">
                <Button onClick={() => downloadJson(currentText, exportFileName(profileName, new Date()))}>
                  ↓ Скачать JSON
                </Button>
                <Button onClick={() => fileRef.current?.click()}>↑ Загрузить из файла</Button>
              </div>
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept="application/json,.json"
                aria-label="Файл конфига"
                onChange={onPickFile}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Слева — {compare.label}, справа — текущий черновик.
          </p>
          <DiffView original={compare.text} modified={currentText} maxHeight="55vh" />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setCompare(null)}>
              ← К списку
            </Button>
            <span className="spacer" />
            <Button variant="primary" onClick={() => apply(compare.text)}>
              В черновик
            </Button>
          </div>
        </>
      )}

      {error && <span className="field-error">{error}</span>}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}
```

- [ ] **Step 4: Подключить диалог в `EditorPage` и убрать старый**

В `frontend/src/features/editor/EditorPage.tsx`:

1. Заменить импорт `import { BackupsDialog } from './BackupsDialog'` на `import { VersionsDialog } from './VersionsDialog'`.
2. Кнопку в топбаре переименовать: `Бэкапы` → `Версии`.
3. Заменить блок `<BackupsDialog … />` на:

```tsx
      <VersionsDialog
        open={backupsOpen}
        profileUuid={profile.uuid}
        profileName={profile.name}
        currentText={text}
        onRestore={(configText) => {
          setDraft(profile.uuid, configText, draft?.baseUpdatedAt ?? profile.updatedAt)
          setSelectedNode(null)
        }}
        onClose={() => setBackupsOpen(false)}
      />
```

(запись в историю появится в Task 6, здесь поведение не меняется).

4. Переименовать состояние `backupsOpen`/`setBackupsOpen` в `versionsOpen`/`setVersionsOpen` во всех трёх местах.

Удалить файл `frontend/src/features/editor/BackupsDialog.tsx`.

- [ ] **Step 5: Удалить устаревший тест и поправить e2e**

```bash
git rm frontend/test/backups-dialog.test.tsx
```

В `frontend/e2e/editor.spec.ts` строка 53: `page.getByRole('button', { name: 'Бэкапы' })` → `page.getByRole('button', { name: 'Версии' })`.

- [ ] **Step 6: Добавить стили**

В `frontend/src/shared/ui/tokens.css` дописать в конец:

```css
/* Диалог версий конфига */
.versions-tabs { margin-bottom: 12px; }
.file-tab .row { margin-top: 12px; }
```

- [ ] **Step 7: Прогнать тесты и типы**

Запустить: `npm run typecheck && npm test`
Ожидается: typecheck чист; `versions-dialog` — 7 тестов PASS; упавших нет.

- [ ] **Step 8: Коммит**

```bash
git add -A frontend/src frontend/test frontend/e2e
git commit -m "feat(frontend): versions dialog with backup diff and config file tab"
```

---

### Task 6: Undo/redo в редакторе

**Files:**
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/editor-logic.test.ts` (дополнение)

**Interfaces:**
- Consumes: `useHistoryStore`, `canUndo`, `canRedo` (Task 1); `VersionsDialog` (Task 5).
- Produces: экспорт `escapeTarget(state: { selectedNode: string | null; traceTarget: TraceTarget | null; searchQuery: string }): 'inspector' | 'trace' | 'search' | null` из `EditorPage.tsx` — используется в Task 7.

- [ ] **Step 1: Написать падающий тест на каскад Escape**

Дописать в конец `frontend/test/editor-logic.test.ts`:

```ts
// TraceTarget требует address, port и network — минимальная цель для проверок
const TARGET = { address: 'example.com', port: 443, network: 'tcp' } as const

describe('escapeTarget', () => {
  it('открытый инспектор закрывается первым', () => {
    expect(escapeTarget({ selectedNode: 'in:a', traceTarget: TARGET, searchQuery: 'q' })).toBe(
      'inspector',
    )
  })

  it('без инспектора — панель трассы', () => {
    expect(escapeTarget({ selectedNode: null, traceTarget: TARGET, searchQuery: 'q' })).toBe('trace')
  })

  it('без инспектора и трассы — результаты поиска', () => {
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: 'q' })).toBe('search')
  })

  it('пробелы в поиске за запрос не считаются', () => {
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: '  ' })).toBeNull()
  })
})
```

В шапке файла добавить `escapeTarget` в существующий импорт из `../src/features/editor/EditorPage`.

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run test/editor-logic.test.ts`
Ожидается: FAIL — `escapeTarget is not a function` / ошибка импорта.

- [ ] **Step 3: Реализовать `escapeTarget`**

В `frontend/src/features/editor/EditorPage.tsx` рядом с другими экспортируемыми чистыми функциями (после `moveSelectedRule`):

```ts
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
```

- [ ] **Step 4: Проверить тест**

Запустить: `npx vitest run test/editor-logic.test.ts`
Ожидается: PASS.

- [ ] **Step 5: Подключить историю к записи черновика**

В `EditorInner` (`frontend/src/features/editor/EditorPage.tsx`):

1. Импорты: `import { canRedo, canUndo, useHistoryStore } from './historyStore'`.
2. После `const { drafts, setDraft, clearDraft } = useDraftStore()` добавить:

```ts
  const { stacks, record, undo, redo, clear: clearHistory } = useHistoryStore()
```

3. Ниже `const dirty = …` добавить единственную точку записи черновика:

```ts
  // Единственная точка записи черновика: здесь же решается, попадает ли правка в историю
  function writeDraft(nextText: string, opts: { history: boolean }) {
    if (opts.history) record(profile.uuid, text)
    setDraft(profile.uuid, nextText, draft?.baseUpdatedAt ?? profile.updatedAt)
  }
```

4. `changeConfig` переписать на `writeDraft`:

```ts
  function changeConfig(next: XrayConfig) {
    writeDraft(formatConfig(next), { history: true })
    setSelectedNode((cur) => nextSelection(cur, parsedConfig!, next))
  }
```

5. `JsonView onChange` → `writeDraft(value, { history: false })` (набор текста — история CodeMirror).
6. `VersionsDialog onRestore` → `writeDraft(configText, { history: true })` + `setSelectedNode(null)`.

- [ ] **Step 6: Добавить снимок при уходе с вкладки JSON и обработчики отмены**

1. Рядом с `const [tab, setTab] = useState…` добавить:

```ts
  // Текст на момент входа в JSON-редактор: вся текстовая сессия сворачивается
  // в один снимок истории при уходе с вкладки
  const jsonEntryText = useRef<string | null>(null)
```

2. Заменить содержимое обработчиков кнопок переключения вкладок на вызовы:

```ts
  function openJsonTab() {
    jsonEntryText.current = text
    setTab('json')
    setSelectedNode(null)
    // Панель разбора живёт над канвасом — над JSON-редактором ей не место
    setTraceTarget(null)
    setTraceOpen(false)
  }

  function openTopologyTab() {
    const entry = jsonEntryText.current
    if (entry !== null && entry !== text) record(profile.uuid, entry)
    jsonEntryText.current = null
    setTab('topology')
  }
```

Кнопка «Топология» получает `onClick={openTopologyTab}`, кнопка «JSON» — `onClick={openJsonTab}`.

3. Добавить обработчики отмены и возврата:

```ts
  const historyDisabled = tab === 'json'
  const undoAvailable = !historyDisabled && canUndo(stacks, profile.uuid)
  const redoAvailable = !historyDisabled && canRedo(stacks, profile.uuid)

  function doUndo() {
    const prev = undo(profile.uuid, text)
    if (prev === null) return
    setDraft(profile.uuid, prev, draft?.baseUpdatedAt ?? profile.updatedAt)
    // Конфиг подменяется целиком — позиционные rule:N дрейфуют
    setSelectedNode(null)
  }

  function doRedo() {
    const next = redo(profile.uuid, text)
    if (next === null) return
    setDraft(profile.uuid, next, draft?.baseUpdatedAt ?? profile.updatedAt)
    setSelectedNode(null)
  }
```

- [ ] **Step 7: Записать и очистить историю в остальных точках**

1. `doSave` → в `onSuccess` после `clearDraft(profile.uuid)` добавить `clearHistory(profile.uuid)` (база сместилась, прежние снимки относятся к другому документу).
2. Диалог «Сбросить черновик», кнопка «Сбросить»: перед `clearDraft(profile.uuid)` добавить `record(profile.uuid, text)` — сброс тоже отменяется.
3. Диалог конфликта, кнопка «Загрузить версию панели»: после `clearDraft(profile.uuid)` добавить `clearHistory(profile.uuid)`.

- [ ] **Step 8: Добавить кнопки в топбар**

В `frontend/src/features/editor/EditorPage.tsx` перед блоком `<div className="segmented">` вставить:

```tsx
        <div className="wb-iconbar">
          <Button
            aria-label="Отменить"
            title="Отменить (Ctrl+Z)"
            disabled={!undoAvailable}
            onClick={doUndo}
          >
            ↶
          </Button>
          <Button
            aria-label="Вернуть"
            title="Вернуть (Ctrl+Shift+Z)"
            disabled={!redoAvailable}
            onClick={doRedo}
          >
            ↷
          </Button>
        </div>
```

В `frontend/src/shared/ui/tokens.css` дописать:

```css
/* История правок и справка в топбаре */
.wb-iconbar { display: flex; gap: 4px; }
.wb-iconbar .btn { min-width: 2rem; padding: 6px 8px; font-size: var(--t-md); line-height: 1; }
```

- [ ] **Step 9: Проверить тесты и типы**

Запустить: `npm run typecheck && npm test`
Ожидается: чисто, все тесты проходят.

- [ ] **Step 10: Коммит**

```bash
git add frontend/src/features/editor/EditorPage.tsx frontend/src/shared/ui/tokens.css frontend/test/editor-logic.test.ts
git commit -m "feat(frontend): undo and redo for draft edits"
```

---

### Task 7: Хоткеи и шпаргалка

**Files:**
- Create: `frontend/src/features/editor/ShortcutsDialog.tsx`
- Modify: `frontend/src/features/editor/EditorPage.tsx`
- Modify: `frontend/src/features/topology/SearchBox.tsx`
- Modify: `frontend/src/shared/ui/tokens.css`
- Test: `frontend/test/shortcuts-dialog.test.tsx`, `frontend/test/search-box.test.tsx` (дополнение)

**Interfaces:**
- Consumes: `useHotkeys`, `hasOpenDialog` (Task 2); `escapeTarget`, `doUndo`, `doRedo` (Task 6).
- Produces: `<ShortcutsDialog open onClose />`; проп `focusSignal?: number` у `SearchBox`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/shortcuts-dialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsDialog } from '../src/features/editor/ShortcutsDialog'

describe('ShortcutsDialog', () => {
  it('перечисляет сочетания', () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />)
    expect(screen.getByText('Ctrl+Z')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Shift+Z')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+F')).toBeInTheDocument()
    expect(screen.getByText('Esc')).toBeInTheDocument()
  })

  it('кнопка «Закрыть» зовёт onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ShortcutsDialog open onClose={onClose} />)
    // Кнопок с именем «Закрыть» две: крестик в шапке Dialog и кнопка внизу — берём нижнюю
    const buttons = screen.getAllByRole('button', { name: 'Закрыть' })
    await user.click(buttons[buttons.length - 1]!)
    expect(onClose).toHaveBeenCalled()
  })
})
```

Дописать в `frontend/test/search-box.test.tsx`:

```tsx
  it('focusSignal переводит фокус в поле поиска', () => {
    const { rerender } = render(
      <SearchBox query="" hits={[]} onQuery={vi.fn()} onPick={vi.fn()} focusSignal={0} />,
    )
    rerender(<SearchBox query="" hits={[]} onQuery={vi.fn()} onPick={vi.fn()} focusSignal={1} />)
    expect(screen.getByLabelText('Поиск по конфигу')).toHaveFocus()
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Запустить: `npx vitest run test/shortcuts-dialog.test.tsx test/search-box.test.tsx`
Ожидается: FAIL — нет модуля `ShortcutsDialog`, у `SearchBox` нет пропа `focusSignal`.

- [ ] **Step 3: Реализовать шпаргалку**

Создать `frontend/src/features/editor/ShortcutsDialog.tsx`:

```tsx
import { Button, Dialog } from '../../shared/ui'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+Z', 'Отменить правку (на вкладке JSON — отмена самого редактора)'],
  ['Ctrl+Shift+Z', 'Вернуть отменённое'],
  ['Ctrl+Y', 'Вернуть отменённое'],
  ['Ctrl+F', 'Поиск по конфигу на топологии'],
  ['Esc', 'Закрыть инспектор, панель трассы или результаты поиска'],
  ['?', 'Эта справка'],
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title="Горячие клавиши" onClose={onClose}>
      <dl className="shortcuts-list">
        {SHORTCUTS.map(([combo, what]) => (
          <div key={combo} className="shortcuts-row">
            <dt>{combo}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Сочетания не срабатывают, пока курсор стоит в поле ввода или в JSON-редакторе.
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}
```

В `frontend/src/shared/ui/tokens.css` дописать:

```css
/* Шпаргалка по хоткеям */
.shortcuts-list { margin: 0 0 12px; display: grid; gap: 6px; }
.shortcuts-row { display: grid; grid-template-columns: 8rem 1fr; gap: 12px; align-items: baseline; }
.shortcuts-row dt { font-family: var(--font-mono); font-size: var(--t-sm); color: var(--text); }
.shortcuts-row dd { margin: 0; color: var(--muted); font-size: var(--t-sm); }
```

- [ ] **Step 4: Добавить `focusSignal` в `SearchBox`**

В `frontend/src/features/topology/SearchBox.tsx`:

```tsx
import { useEffect, useRef } from 'react'
```

в пропсы добавить `focusSignal?: number`, а в тело:

```tsx
  const inputRef = useRef<HTMLInputElement>(null)
  // Сигнал от Ctrl+F: значение растёт, эффект перезапускается и ставит фокус
  useEffect(() => {
    if (focusSignal) inputRef.current?.focus()
  }, [focusSignal])
```

и `<TextInput ref={inputRef} … />` (TextInput уже обёрнут в `forwardRef`).

- [ ] **Step 5: Подключить хоткеи в `EditorPage`**

1. Импорты: `import { hasOpenDialog, useHotkeys } from '../../shared/lib/useHotkeys'` и `import { ShortcutsDialog } from './ShortcutsDialog'`.
2. Состояния: `const [shortcutsOpen, setShortcutsOpen] = useState(false)` и `const [searchFocus, setSearchFocus] = useState(0)`.
3. После объявления `doUndo`/`doRedo`/`escapeTarget`-зависимых значений:

```ts
  useHotkeys([
    { combo: 'mod+z', handler: () => { if (undoAvailable) doUndo() } },
    { combo: 'mod+shift+z', handler: () => { if (redoAvailable) doRedo() } },
    { combo: 'mod+y', handler: () => { if (redoAvailable) doRedo() } },
    {
      combo: 'mod+f',
      handler: () => {
        // На вкладке JSON Ctrl+F отдан поиску CodeMirror
        if (tab === 'topology') setSearchFocus((v) => v + 1)
      },
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
```

4. Кнопка справки в `.wb-iconbar` после ↷:

```tsx
          <Button aria-label="Горячие клавиши" title="Горячие клавиши (?)" onClick={() => setShortcutsOpen(true)}>
            ?
          </Button>
```

5. `SearchBox` получает `focusSignal={searchFocus}`.
6. Рядом с остальными диалогами в конце разметки:

```tsx
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
```

- [ ] **Step 6: Проверить тесты и типы**

Запустить: `npm run typecheck && npm test`
Ожидается: чисто; `shortcuts-dialog` — 2 теста, `search-box` — на один больше прежнего.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/editor/ShortcutsDialog.tsx frontend/src/features/editor/EditorPage.tsx frontend/src/features/topology/SearchBox.tsx frontend/src/shared/ui/tokens.css frontend/test/shortcuts-dialog.test.tsx frontend/test/search-box.test.tsx
git commit -m "feat(frontend): keyboard shortcuts and cheatsheet dialog"
```

---

### Task 8: Сценарии e2e

**Files:**
- Create: `frontend/e2e/edit-safety.spec.ts`

**Interfaces:**
- Consumes: всё, собранное в задачах 5–7; моки из `frontend/e2e/mocks.ts` (`CONFIG`, `PROFILE`, `UUID`, `mockApi`) — правки не требуются: бэкап `b1.json` там уже замокан.
- Produces: ничего.

- [ ] **Step 1: Написать сценарии**

Создать `frontend/e2e/edit-safety.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('удаление правила отменяется кнопкой и повторяется возвратом', async ({ page }) => {
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)
  await page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)
})

test('Ctrl+Z отменяет правку с клавиатуры', async ({ page }) => {
  await page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)
})

test('на вкладке JSON кнопки истории заблокированы', async ({ page }) => {
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Вернуть' })).toBeDisabled()
})

test('«?» открывает шпаргалку по горячим клавишам', async ({ page }) => {
  await page.keyboard.press('Shift+/')
  await expect(page.getByText('Поиск по конфигу на топологии')).toBeVisible()
})

test('сравнение бэкапа показывает обе стороны и возвращает к списку', async ({ page }) => {
  await page.getByRole('button', { name: 'Версии' }).click()
  await page.getByRole('button', { name: 'Сравнить' }).click()
  await expect(page.locator('.diff-frame .cm-editor')).toHaveCount(2)
  await page.getByRole('button', { name: '← К списку' }).click()
  await expect(page.getByRole('button', { name: 'Сравнить' })).toBeVisible()
})

test('вкладка «Файл» скачивает конфиг', async ({ page }) => {
  await page.getByRole('button', { name: 'Версии' }).click()
  await page.getByRole('button', { name: 'Файл' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Скачать JSON/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^e2e-profile-\d{4}-\d{2}-\d{2}\.json$/)
})
```

- [ ] **Step 2: Запустить e2e**

Запустить: `npm run e2e -w frontend` (или `npx playwright test e2e/edit-safety.spec.ts` из каталога `frontend`).
Ожидается: 6 новых сценариев PASS, прежние 37 — тоже.

Если сценарий «Ctrl+Z отменяет правку» падает из-за того, что фокус после `Backspace` остался на удалённом ребре: перед нажатием кликнуть по пустому месту канваса (`page.locator('.react-flow__pane').click()`) и повторить. Если падает сценарий с «?»: проверить, что нажатие идёт при фокусе вне поля ввода — при необходимости добавить тот же клик по канвасу.

- [ ] **Step 3: Коммит**

```bash
git add frontend/e2e/edit-safety.spec.ts
git commit -m "test(frontend): e2e for undo, shortcuts, backup diff and export"
```

---

### Task 9: Документация

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: всё реализованное.
- Produces: ничего.

- [ ] **Step 1: Дополнить README**

В `README.md` в разделе о работе с редактором (рядом с пунктом «Навигация по проблемам», добавленным в направлении 2) вставить новый подраздел:

```markdown
### ↩️ Отмена, клавиши и файлы

- **↶ / ↷ в топбаре** отменяют и возвращают структурные правки: узлы графа, формы инспектора,
  «Настройки конфига», перестановку и удаление правил, восстановление бэкапа, импорт файла.
  Глубина — 50 шагов, история живёт до перезагрузки страницы.
- На вкладке **JSON** кнопки истории выключены: там работает собственная посимвольная отмена
  редактора. Вся текстовая правка сворачивается в один шаг истории при возврате на топологию.
- **Горячие клавиши** (не срабатывают, пока курсор в поле ввода): `Ctrl+Z` — отменить,
  `Ctrl+Shift+Z` и `Ctrl+Y` — вернуть, `Ctrl+F` — поиск по конфигу, `Esc` — закрыть инспектор,
  панель трассы или результаты поиска, `?` — справка по сочетаниям.
- **«Версии»** — бэкапы панели и работа с файлом. У каждого бэкапа есть «Сравнить»: показывает
  различия с текущим черновиком. Вкладка «Файл» скачивает черновик в JSON и загружает конфиг
  из файла; принимается и файл бэкапа целиком — конфиг из него достаётся сам.
```

- [ ] **Step 2: Дополнить CLAUDE.md**

В `CLAUDE.md` в разделе про `features/editor` дописать после описания `draftStore.ts`:

```markdown
- Все записи черновика в `EditorPage` идут через одну функцию `writeDraft(text, {history})`;
  `historyStore.ts` — стеки `past`/`future` в памяти (без persist: 50 снимков конфига вытеснили бы
  черновики из localStorage). Набор текста в JSON в историю не пишется — это забота CodeMirror,
  вместо этого при уходе с вкладки записывается один снимок «как было до входа». После undo/redo,
  импорта и восстановления бэкапа обязателен `setSelectedNode(null)`.
- `shared/lib/useHotkeys.ts` — хоткеи с guard'ом `isEditableTarget` (contenteditable покрывает
  `.cm-content`); `Escape` не отменяет действие браузера и молчит при открытом `<dialog>`.
- `DiffView.tsx` — общий `MergeView` для `SaveDialog` и `VersionsDialog` (бывший `BackupsDialog`:
  вкладки «Бэкапы панели» / «Файл», сравнение бэкапа с черновиком в том же диалоге, без вложенного
  `<dialog>`). Разбор и именование файлов — `configFile.ts`.
```

- [ ] **Step 3: Финальная проверка всего**

Запустить из корня репозитория: `npm test && npm run build`
Ожидается: тесты обоих workspace зелёные, сборка проходит.

- [ ] **Step 4: Коммит**

```bash
git add README.md CLAUDE.md
git commit -m "docs: describe draft history, shortcuts and config versions"
```

---

## Проверка плана

**Покрытие спеки:**

| Требование спеки | Задача |
|---|---|
| Стор истории, `HISTORY_LIMIT`, только в памяти | 1 |
| Таблица «что пишется в историю», `writeDraft`, снимок при уходе с JSON, `clear` на сохранении и конфликте, `record` на сбросе | 6 |
| `setSelectedNode(null)` после undo/redo и полной замены | 5, 6 |
| `matchCombo`/`isEditableTarget`/`hasOpenDialog`/`useHotkeys` | 2 |
| Раскладка хоткеев, каскад Escape, `?`-шпаргалка, `focusSignal` у поиска | 6 (escapeTarget), 7 |
| `exportFileName`/`parseImported`/`downloadJson`, разворачивание `{profile:{config}}` | 3 |
| `DiffView`, перевод `SaveDialog` | 4 |
| Диалог «Версии конфига»: вкладки, «Сравнить», режим сравнения без вложенного `<dialog>` | 5 |
| Топбар: `.wb-iconbar`, «Бэкапы» → «Версии», новых кнопок справа нет | 5, 6, 7 |
| Классы `tokens.css` | 4, 5, 6, 7 |
| Риск «MergeView в jsdom» проверяется первым делом | 4, Step 4 |
| Тесты unit и e2e из спеки | 1–8 |

**Отличие от спеки, сделанное осознанно:** спека называла интеграционный тест `editor-history.test.tsx` на `EditorPage`. В проекте нет ни одного теста, рендерящего `EditorPage` целиком (React Flow, router, query-клиент), а сложившийся приём — выносить решение в чистую функцию и проверять её (`nextSelection`, `moveSelectedRule`, `traceOf` в `editor-logic.test.ts`). Поэтому логика каскада Escape вынесена в `escapeTarget` и покрыта юнит-тестом, а проводка undo/redo проверяется в e2e (Task 8) — там же, где проверялись проводки прошлых направлений.

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
  /** Ключ — не голый uuid, а `<вид>:<uuid>`, как у черновиков (см. shared/lib/docKey) */
  stacks: Record<string, HistoryStack>
  record: (key: string, prevText: string) => void
  undo: (key: string, currentText: string) => string | null
  redo: (key: string, currentText: string) => string | null
  clear: (key: string) => void
}

const EMPTY: HistoryStack = { past: [], future: [] }

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  stacks: {},
  record: (key, prevText) =>
    set((s) => {
      const cur = s.stacks[key] ?? EMPTY
      // Новая правка обрывает ветку возврата — иначе redo вернул бы чужое состояние
      return {
        stacks: {
          ...s.stacks,
          [key]: { past: [...cur.past, prevText].slice(-HISTORY_LIMIT), future: [] },
        },
      }
    }),
  undo: (key, currentText) => {
    const cur = get().stacks[key] ?? EMPTY
    const prev = cur.past[cur.past.length - 1]
    if (prev === undefined) return null
    set((s) => ({
      stacks: {
        ...s.stacks,
        [key]: { past: cur.past.slice(0, -1), future: [...cur.future, currentText] },
      },
    }))
    return prev
  },
  redo: (key, currentText) => {
    const cur = get().stacks[key] ?? EMPTY
    const next = cur.future[cur.future.length - 1]
    if (next === undefined) return null
    set((s) => ({
      stacks: {
        ...s.stacks,
        [key]: { past: [...cur.past, currentText], future: cur.future.slice(0, -1) },
      },
    }))
    return next
  },
  clear: (key) =>
    set((s) => {
      const { [key]: _removed, ...rest } = s.stacks
      return { stacks: rest }
    }),
}))

export function canUndo(stacks: Record<string, HistoryStack>, key: string): boolean {
  return (stacks[key]?.past.length ?? 0) > 0
}

export function canRedo(stacks: Record<string, HistoryStack>, key: string): boolean {
  return (stacks[key]?.future.length ?? 0) > 0
}

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

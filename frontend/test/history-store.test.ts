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

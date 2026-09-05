import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migratePositionsState, usePositionsStore } from '../src/features/topology/positionsStore'

beforeEach(() => {
  localStorage.clear()
  usePositionsStore.setState({ positions: {} })
})

afterEach(() => {
  localStorage.clear()
  // Стор мог быть пересоздан в тесте проводки — отдаём соседям чистый кэш модулей
  vi.resetModules()
})

describe('positionsStore', () => {
  it('сохраняет и сбрасывает позиции по ключу документа', () => {
    usePositionsStore.getState().setPosition('profile:p1', 'in:vless-in', { x: 10, y: 20 })
    expect(usePositionsStore.getState().positions['profile:p1']!['in:vless-in']).toEqual({
      x: 10,
      y: 20,
    })
    usePositionsStore.getState().resetPositions('profile:p1')
    expect(usePositionsStore.getState().positions['profile:p1']).toBeUndefined()
  })

  it('персистит под ключом xui-positions', () => {
    usePositionsStore.getState().setPosition('profile:p1', 'dns', { x: 1, y: 2 })
    expect(localStorage.getItem('xui-positions')).toContain('dns')
  })
})

// v0 → v1: позиции лежали по голому uuid, а uuid профиля и шаблона могут совпасть —
// узлы двух разных графов оказались бы в одной записи
describe('миграция позиций', () => {
  it('ключи получают вид документа', () => {
    const migrated = migratePositionsState({ positions: { 'u-1': { 'in:socks': { x: 1, y: 2 } } } }, 0)
    expect(migrated.positions['profile:u-1']).toEqual({ 'in:socks': { x: 1, y: 2 } })
    expect(migrated.positions['u-1']).toBeUndefined()
  })

  it('состояние версии 1 возвращается как есть', () => {
    const state = { positions: { 'profile:u-1': { 'in:socks': { x: 1, y: 2 } } } }
    expect(migratePositionsState(state, 1)).toBe(state)
  })

  it('битая запись пропускается, а не роняет расположение всех документов', () => {
    expect(migratePositionsState(null, 0).positions).toEqual({})
    expect(migratePositionsState({ positions: null }, 0).positions).toEqual({})
    expect(
      Object.keys(
        migratePositionsState({ positions: { 'u-1': 'мусор', 'u-2': { dns: { x: 0, y: 0 } } } }, 0)
          .positions,
      ),
    ).toEqual(['profile:u-2'])
  })

  // Значение отсюда уходит прямо в position узла React Flow: нечисловая пара
  // развалила бы весь граф, а не одну карточку
  it('нечисловые координаты отсеиваются поштучно', () => {
    const migrated = migratePositionsState(
      {
        positions: {
          'u-1': {
            dns: 'мусор',
            'in:socks': { x: 1, y: 2 },
            'out:direct': { x: '3', y: 4 },
            'rule:0': { x: 5 },
            'bal:b': null,
            'inj:0': { x: Number.NaN, y: 0 },
          },
        },
      },
      0,
    )
    expect(migrated.positions['profile:u-1']).toEqual({ 'in:socks': { x: 1, y: 2 } })
  })

  // Проводка: у хранилища не было `version` вовсе, и без него (или без migrate)
  // расположение узлов всех существующих графов молча осталось бы под старым ключом
  it('persist подключён: запись v0 из localStorage приезжает уже под префиксом', async () => {
    localStorage.setItem(
      'xui-positions',
      JSON.stringify({ state: { positions: { 'u-1': { dns: { x: 5, y: 6 } } } }, version: 0 }),
    )
    vi.resetModules()
    const store = await import('../src/features/topology/positionsStore')
    expect(store.usePositionsStore.getState().positions['profile:u-1']?.dns).toEqual({ x: 5, y: 6 })
    expect(store.usePositionsStore.getState().positions['u-1']).toBeUndefined()
  })
})

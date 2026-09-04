import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateDraftState } from '../src/features/editor/draftStore'

// Миграцию проверяем напрямую, а не через persist: подложить localStorage до
// первого импорта стора можно только играя с кэшем модулей, и такой тест хрупок.
describe('миграция черновиков', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    // Стор мог быть пересоздан — возвращаем соседним файлам чистый кэш модулей
    vi.resetModules()
  })

  it('старый черновик с baseUpdatedAt читается как baseVersion', () => {
    const migrated = migrateDraftState(
      { drafts: { 'u-1': { text: '{}', baseUpdatedAt: '2026-07-20T10:00:00Z', savedAt: 's' } } },
      0,
    )
    expect(migrated.drafts['u-1']).toEqual({
      text: '{}',
      baseVersion: '2026-07-20T10:00:00Z',
      savedAt: 's',
    })
  })

  it('черновик без базы получает пустую строку, а не undefined', () => {
    const migrated = migrateDraftState({ drafts: { 'u-1': { text: '{}', savedAt: 's' } } }, 0)
    expect(migrated.drafts['u-1']?.baseVersion).toBe('')
  })

  it('состояние версии 1 возвращается как есть', () => {
    const state = { drafts: { 'u-1': { text: '{}', baseVersion: 'v1', savedAt: 's' } } }
    expect(migrateDraftState(state, 1)).toBe(state)
  })

  it('отсутствующие и битые drafts не роняют миграцию', () => {
    expect(migrateDraftState({}, 0).drafts).toEqual({})
    expect(migrateDraftState(null, 0).drafts).toEqual({})
    expect(migrateDraftState({ drafts: null }, 0).drafts).toEqual({})
    expect(migrateDraftState({ drafts: { 'u-1': null, 'u-2': { savedAt: 's' } } }, 0).drafts).toEqual(
      {},
    )
  })

  // Проводка: без `version: 1` или без `migrate` в опциях persist проверки выше
  // остались бы зелёными, а у пользователей молча пропала бы база всех черновиков
  it('persist подключён: черновик v0 из localStorage приезжает уже мигрированным', async () => {
    localStorage.setItem(
      'xui-drafts',
      JSON.stringify({
        state: {
          drafts: { 'u-1': { text: '{}', baseUpdatedAt: '2026-07-20T10:00:00Z', savedAt: 's' } },
        },
        version: 0,
      }),
    )
    vi.resetModules()
    const { useDraftStore } = await import('../src/features/editor/draftStore')
    expect(useDraftStore.getState().drafts['u-1']?.baseVersion).toBe('2026-07-20T10:00:00Z')
  })
})

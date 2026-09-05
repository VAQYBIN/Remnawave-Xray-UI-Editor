import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateDraftState } from '../src/features/editor/draftStore'

// Миграцию проверяем и напрямую, и через persist: чистые проверки не заметят,
// если `version`/`migrate` исчезнут из опций хранилища, а через persist неудобно
// разбирать каждый случай — подложить localStorage до первого импорта стора можно
// только играя с кэшем модулей.
describe('миграция черновиков', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    // Стор мог быть пересоздан — возвращаем соседним файлам чистый кэш модулей
    vi.resetModules()
  })

  it('v0: baseUpdatedAt читается как baseVersion, а ключ получает вид документа', () => {
    const migrated = migrateDraftState(
      { drafts: { 'u-1': { text: '{}', baseUpdatedAt: '2026-07-20T10:00:00Z', savedAt: 's' } } },
      0,
    )
    // Все черновики до этой правки создавал редактор профилей — шаблоны появились
    // уже с префиксом
    expect(migrated.drafts['profile:u-1']).toEqual({
      text: '{}',
      baseVersion: '2026-07-20T10:00:00Z',
      savedAt: 's',
    })
    expect(migrated.drafts['u-1']).toBeUndefined()
  })

  it('v0: черновик без базы получает пустую строку, а не undefined', () => {
    const migrated = migrateDraftState({ drafts: { 'u-1': { text: '{}', savedAt: 's' } } }, 0)
    expect(migrated.drafts['profile:u-1']?.baseVersion).toBe('')
  })

  it('v1: поле уже верное, меняется только ключ', () => {
    const migrated = migrateDraftState(
      { drafts: { 'u-1': { text: '{}', baseVersion: 'v1', savedAt: 's' } } },
      1,
    )
    expect(migrated.drafts['profile:u-1']).toEqual({ text: '{}', baseVersion: 'v1', savedAt: 's' })
    expect(migrated.drafts['u-1']).toBeUndefined()
  })

  it('состояние версии 2 возвращается как есть', () => {
    const state = { drafts: { 'profile:u-1': { text: '{}', baseVersion: 'v1', savedAt: 's' } } }
    expect(migrateDraftState(state, 2)).toBe(state)
  })

  it('отсутствующие и битые drafts не роняют миграцию', () => {
    expect(migrateDraftState({}, 0).drafts).toEqual({})
    expect(migrateDraftState(null, 0).drafts).toEqual({})
    expect(migrateDraftState({ drafts: null }, 0).drafts).toEqual({})
    expect(migrateDraftState({ drafts: { 'u-1': null, 'u-2': { savedAt: 's' } } }, 0).drafts).toEqual(
      {},
    )
    // Битая запись пропускается, соседняя целая переезжает
    expect(
      Object.keys(
        migrateDraftState(
          { drafts: { 'u-1': { text: 42 }, 'u-2': { text: '{}', baseVersion: 'v', savedAt: 's' } } },
          1,
        ).drafts,
      ),
    ).toEqual(['profile:u-2'])
  })

  // Проводка: без `version: 2` или без `migrate` в опциях persist проверки выше
  // остались бы зелёными, а у пользователей молча пропали бы все черновики —
  // редактор искал бы их уже по префиксованному ключу
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
    expect(useDraftStore.getState().drafts['profile:u-1']?.baseVersion).toBe('2026-07-20T10:00:00Z')
  })

  it('persist подключён: черновик v1 приезжает под префиксованным ключом', async () => {
    localStorage.setItem(
      'xui-drafts',
      JSON.stringify({
        state: { drafts: { 'u-1': { text: '{"a":1}', baseVersion: 'v1', savedAt: 's' } } },
        version: 1,
      }),
    )
    vi.resetModules()
    const { useDraftStore } = await import('../src/features/editor/draftStore')
    expect(useDraftStore.getState().drafts['profile:u-1']?.text).toBe('{"a":1}')
    expect(useDraftStore.getState().drafts['u-1']).toBeUndefined()
  })
})

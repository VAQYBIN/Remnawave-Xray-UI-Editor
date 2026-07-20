import { beforeEach, describe, expect, it } from 'vitest'
import { useDraftStore } from '../src/features/editor/draftStore'

beforeEach(() => {
  localStorage.clear()
  useDraftStore.setState({ drafts: {} })
})

describe('draftStore', () => {
  it('сохраняет и читает черновик', () => {
    useDraftStore.getState().setDraft('u1', '{"a":1}', '2026-07-20T10:00:00Z')
    const d = useDraftStore.getState().drafts['u1']
    expect(d?.text).toBe('{"a":1}')
    expect(d?.baseUpdatedAt).toBe('2026-07-20T10:00:00Z')
    expect(d?.savedAt).toMatch(/^\d{4}-/)
  })

  it('clearDraft удаляет черновик', () => {
    useDraftStore.getState().setDraft('u1', 'x', 't')
    useDraftStore.getState().clearDraft('u1')
    expect(useDraftStore.getState().drafts['u1']).toBeUndefined()
  })

  it('персистит в localStorage под ключом xui-drafts', () => {
    useDraftStore.getState().setDraft('u1', 'x', 't')
    const raw = localStorage.getItem('xui-drafts')
    expect(raw).toContain('"u1"')
  })
})

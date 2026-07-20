import { describe, expect, it } from 'vitest'
import { formatConfig, resolveEditorText } from '../src/features/editor/EditorPage'

describe('editor logic', () => {
  it('formatConfig — JSON с отступом 2', () => {
    expect(formatConfig({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('resolveEditorText: черновик приоритетнее конфига панели', () => {
    expect(resolveEditorText({ text: 'draft', baseUpdatedAt: 't', savedAt: 's' }, { a: 1 })).toBe('draft')
    expect(resolveEditorText(undefined, { a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

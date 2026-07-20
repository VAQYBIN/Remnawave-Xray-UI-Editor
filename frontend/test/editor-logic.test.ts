import { describe, expect, it } from 'vitest'
import { formatConfig, resolveEditorText, toGraphContext } from '../src/features/editor/EditorPage'

describe('editor logic', () => {
  it('formatConfig — JSON с отступом 2', () => {
    expect(formatConfig({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('resolveEditorText: черновик приоритетнее конфига панели', () => {
    expect(resolveEditorText({ text: 'draft', baseUpdatedAt: 't', savedAt: 's' }, { a: 1 })).toBe('draft')
    expect(resolveEditorText(undefined, { a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('toGraphContext', () => {
  it('собирает inboundSquads по тегам', () => {
    const ctx = toGraphContext(
      [{ uuid: 's1', name: 'Default' }],
      [{ uuid: 'i1', tag: 'vless-in', type: 'vless', network: null, security: null, port: 443, activeSquads: ['s1'] }],
    )
    expect(ctx.squads).toEqual([{ uuid: 's1', name: 'Default' }])
    expect(ctx.inboundSquads).toEqual({ 'vless-in': ['s1'] })
  })

  it('без данных возвращает пустой контекст', () => {
    expect(toGraphContext(undefined, undefined)).toEqual({ squads: [], inboundSquads: {} })
  })
})

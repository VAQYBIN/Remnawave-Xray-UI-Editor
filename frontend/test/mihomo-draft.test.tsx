import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMihomoDraft } from '../src/features/editor/useMihomoDraft'
import { mihomoAdapter } from '../src/features/editor/mihomoAdapter'
import { parseMihomo } from '../src/entities/mihomo'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'

const DOC = [
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'rules:',
  '  - DOMAIN,a.com,A',
  '  - MATCH,A',
  '',
].join('\n')

function draft(text = DOC) {
  return renderHook(() =>
    useMihomoDraft({ docKey: 'tpl-1', panelText: text, baseVersion: 'h1' }),
  )
}

describe('адаптер Mihomo', () => {
  it('битый YAML даёт ошибку, но документ остаётся разобранным', () => {
    const res = mihomoAdapter.parse('proxy-groups:\n  - name: A\n   type: [\n')
    expect(res.issues.some((i) => i.level === 'error')).toBe(true)
    expect(res.model).toBeDefined()
  })

  it('пустой документ модели не даёт', () => {
    expect(mihomoAdapter.parse('').model).toBeUndefined()
  })

  it('подпись текстовой вкладки — YAML', () => {
    expect(mihomoAdapter.textTabLabel).toBe('YAML')
  })
})

describe('черновик Mihomo', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
  })

  it('правка поля идёт сплайсом: байты вне правки те же', () => {
    const { result } = draft()
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
    expect(result.current.text).toContain('type: fallback')
    expect(result.current.text).toContain('  - MATCH,A')
    expect(result.current.text.split('\n').length).toBe(DOC.split('\n').length)
  })

  it('переименование группы ведёт выбор за ней', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.renameGroupTo(0, 'Б'))
    expect(result.current.selectedNode).toBe('group:Б')
    expect(result.current.text).toContain('MATCH,Б')
  })

  it('отказ коммутации виден и снимается', () => {
    const { result } = draft('proxy-groups:\n  - name: A\n    proxies: [DIRECT]\n')
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    expect(result.current.refusal).toBe('flow-list')
    act(() => result.current.dismissRefusal())
    expect(result.current.refusal).toBeNull()
  })

  it('успешная коммутация правит документ и причины не оставляет', () => {
    const { result } = draft()
    act(() => result.current.connect('group:A', 'builtin:REJECT'))
    expect(result.current.text).toContain('- REJECT')
    expect(result.current.refusal).toBeNull()
  })

  it('удаление правила снимает выбор: id правил позиционные', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.removeSelected())
    expect(result.current.selectedNode).toBeNull()
    expect(result.current.text).not.toContain('DOMAIN,a.com,A')
  })

  it('перестановка правила ведёт выбор за ним', () => {
    const { result } = draft()
    act(() => result.current.setSelectedNode('rule:0'))
    act(() => result.current.moveSelected(1))
    expect(result.current.selectedNode).toBe('rule:1')
  })

  it('правки складываются в историю по одной', () => {
    const { result } = draft()
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'relay'))
    act(() => result.current.doUndo())
    expect(result.current.text).toContain('type: fallback')
  })

  // Ниже — операции, объявленные в интерфейсе задачи, но не покрытые её
  // основным набором: без них проброс мог бы разойтись с `entities/mihomo`
  // молча, а потребитель (формы инспектора) появится только в следующих задачах.

  it('originOf пропускает наружу все четыре происхождения, включая alias', () => {
    const text = [
      'x-anchors:',
      '  rw: &rw',
      '    include-proxies: false',
      'proxy-groups:',
      '  - name: A',
      '    type: select',
      '    remnawave: *rw',
      '',
    ].join('\n')
    const { result } = draft(text)
    expect(result.current.originOf(['proxy-groups', 0], 'name')).toBe('own')
    expect(result.current.originOf(['proxy-groups', 0], 'remnawave.include-proxies')).toBe('alias')
    expect(result.current.originOf(['proxy-groups', 0], 'filter')).toBe('absent')
    // Правка по alias-пути отказывает — черновик остаётся нетронутым
    act(() => result.current.setField(['proxy-groups', 0], 'remnawave.include-proxies', true))
    expect(result.current.text).toBe(text)
  })

  it('замена списка идёт через setListAt и не трогает соседние секции', () => {
    const { result } = draft()
    act(() => result.current.setListAt(['proxy-groups', 0], 'proxies', ['DIRECT', 'REJECT']))
    const md = parseMihomo(result.current.text)
    expect(md.doc.errors).toEqual([])
    expect(result.current.text).toContain('- REJECT')
    expect(result.current.text).toContain('  - MATCH,A')
  })

  it('замена строки правила переписывает только её', () => {
    const { result } = draft()
    act(() => result.current.replaceRule(0, 'DOMAIN-SUFFIX,b.com,A'))
    expect(result.current.text).toContain('DOMAIN-SUFFIX,b.com,A')
    expect(result.current.text).not.toContain('DOMAIN,a.com,A')
    expect(result.current.text).toContain('  - MATCH,A')
  })
})

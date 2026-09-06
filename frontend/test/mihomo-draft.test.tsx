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

  it('originOf пропускает наружу все четыре происхождения: own, merged, alias, absent', () => {
    // Одна фикстура на весь союз: `name` — своё поле, `type` приходит слиянием
    // `<<: *base`, `remnawave` — ссылка на якорь, `filter` отсутствует.
    // Сужение союза в пробросе (например, `merged` → `own`) обязано покраснеть
    // здесь, иначе форма сочла бы значение из якоря своим и предложила правку,
    // которую писатель всё равно отклоняет.
    const text = [
      'x-anchors:',
      '  base: &base',
      '    type: select',
      '  rw: &rw',
      '    include-proxies: false',
      'proxy-groups:',
      '  - name: A',
      '    <<: *base',
      '    remnawave: *rw',
      '',
    ].join('\n')
    const { result } = draft(text)
    expect(result.current.originOf(['proxy-groups', 0], 'name')).toBe('own')
    expect(result.current.originOf(['proxy-groups', 0], 'type')).toBe('merged')
    expect(result.current.originOf(['proxy-groups', 0], 'remnawave.include-proxies')).toBe('alias')
    expect(result.current.originOf(['proxy-groups', 0], 'filter')).toBe('absent')
    // Правки по merged- и alias-путям отказывают — черновик остаётся нетронутым
    act(() => result.current.setField(['proxy-groups', 0], 'type', 'fallback'))
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

  it('разрыв связи убирает участника и причины не оставляет', () => {
    const { result } = draft()
    act(() => result.current.disconnect('e:group:A->builtin:DIRECT'))
    expect(result.current.text).not.toContain('- DIRECT')
    expect(result.current.text).toContain('  - MATCH,A')
    expect(result.current.refusal).toBeNull()
  })

  it('отказ разрыва поднимает причину и документ не трогает', () => {
    // У правила цель обязательна — разрывать нечего; фикстура та же, что и у
    // успешного разрыва выше, так что различает ветви именно ребро, а не документ
    const { result } = draft()
    act(() => result.current.disconnect('e:rule:0->group:A'))
    // Причина называет настоящее основание: связь у правила можно только
    // сменить, а не убрать. Прежний `invalid-pair` объяснял отказ узлом
    // подстановки, которого в этом ребре нет.
    expect(result.current.refusal).toBe('rule-target-required')
    expect(result.current.text).toBe(DOC)
  })

  it('удаление выбранной группы убирает её и снимает выбор', () => {
    const text = [
      'proxy-groups:',
      '  - name: A',
      '    type: select',
      '    proxies:',
      '      - DIRECT',
      '  - name: B',
      '    type: select',
      '    proxies:',
      '      - DIRECT',
      'rules:',
      '  - MATCH,B',
      '',
    ].join('\n')
    const { result } = draft(text)
    act(() => result.current.setSelectedNode('group:A'))
    act(() => result.current.removeSelected())
    expect(result.current.selectedNode).toBeNull()
    expect(result.current.text).not.toContain('name: A')
    expect(result.current.text).toContain('name: B')
    expect(parseMihomo(result.current.text).doc.errors).toEqual([])
  })
})

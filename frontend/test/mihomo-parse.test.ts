import { describe, expect, it } from 'vitest'
import { parseMihomo, rangeOf, sectionNode } from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('разбор шаблона Mihomo', () => {
  it('читает секции всех трёх эталонных шаблонов', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      expect(md.issues, `${name}: неожиданные ошибки разбора`).toEqual([])
      expect(sectionNode(md, 'proxy-groups')).toBeDefined()
      expect(sectionNode(md, 'rules')).toBeDefined()
    }
  })

  it('диапазон узла указывает на текст значения, без хвостового комментария', () => {
    // Хвостовой комментарий — третий элемент тройки node.range (конец узла), а не второй
    // (конец значения). Правки в следующих задачах режут документ сплайсами по диапазону
    // значения: захват комментария означал бы порчу пользовательского файла.
    const md = parseMihomo('rules:\n  - MATCH,DIRECT # хвост\n')
    const item = md.doc.getIn(['rules', 0], true)
    const range = rangeOf(item)
    expect(range).not.toBeNull()
    const slice = md.text.slice(range!.from, range!.to)
    expect(slice).toBe('MATCH,DIRECT')
    expect(slice).not.toContain('хвост')
  })

  it('синтаксическая ошибка становится диагностикой, а не исключением', () => {
    const md = parseMihomo('proxy-groups:\n  - name: a\n   type: select\n')
    expect(md.issues.length).toBeGreaterThan(0)
    expect(md.issues[0]!.level).toBe('error')
  })

  it('незакрытая структура не гасит уже разобранное', () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\nproxy-groups:\n  - name: "a\n')
    expect(sectionNode(md, 'rules')).toBeDefined()
  })
})

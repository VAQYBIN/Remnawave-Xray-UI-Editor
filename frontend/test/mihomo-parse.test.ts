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

  it('диапазон узла указывает на его текст', () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\n')
    const range = rangeOf(sectionNode(md, 'rules'))
    expect(range).not.toBeNull()
    expect(md.text.slice(range!.from, range!.to)).toContain('MATCH,DIRECT')
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

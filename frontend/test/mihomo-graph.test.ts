import { describe, expect, it } from 'vitest'
import { buildMihomoGraph, groupDepths } from '../src/entities/graph/mihomo/buildGraph'
import { groupsOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('граф Mihomo', () => {
  it('строит узлы правил, групп и подстановки', () => {
    const { nodes } = buildMihomoGraph(parseMihomo(mihomoFixture('default')))
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('rule:0')
    expect(ids).toContain('group:→ Remnawave')
    expect(ids).toContain('hosts:→ Remnawave')
    expect(ids).toContain('builtin:DIRECT')
  })

  it('ребро правила ведёт в группу по имени', () => {
    const { edges } = buildMihomoGraph(parseMihomo(mihomoFixture('default')))
    expect(edges.map((e) => e.id)).toContain('e:rule:2->group:→ Remnawave')
  })

  it('группа, ссылающаяся на группу, стоит колонкой правее', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: VPN\n    proxies:\n      - Fast\n  - name: Fast\n    include-all: true\n',
    )
    const depths = groupDepths(groupsOf(md))
    expect(depths.get('VPN')).toBe(1)
    expect(depths.get('Fast')).toBe(0)
  })

  it('кольцо не вешает расчёт глубины', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: a\n    proxies:\n      - b\n  - name: b\n    proxies:\n      - a\n',
    )
    const depths = groupDepths(groupsOf(md))
    expect(depths.size).toBe(2)
    expect(Number.isFinite(depths.get('a'))).toBe(true)
  })

  it('на большом шаблоне узлы не дублируются', () => {
    const { nodes } = buildMihomoGraph(parseMihomo(mihomoFixture('bundle')))
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
  })

  it('на большом шаблоне рёбра не дублируются', () => {
    const { edges } = buildMihomoGraph(parseMihomo(mihomoFixture('bundle')))
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length)
  })
})

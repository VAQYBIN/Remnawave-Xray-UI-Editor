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

  it('дубликат имени группы не даёт два узла с одним id', () => {
    // validateMihomo помечает повтор ошибкой, но граф всё равно обязан
    // нарисоваться — иначе пользователь с опечаткой в имени не поймёт, что
    // сломалось: React Flow на дубликат id молча теряет узел, а не падает.
    const md = parseMihomo(
      'proxy-groups:\n  - name: dup\n    include-all: true\n  - name: dup\n    include-all: true\n',
    )
    const { nodes } = buildMihomoGraph(md)
    expect(nodes.filter((n) => n.id === 'group:dup').length).toBe(1)
    expect(nodes.filter((n) => n.id === 'hosts:dup').length).toBe(1)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
  })

  it('группа «root», получающая хосты, не сталкивается id с корневой подстановкой', () => {
    const md = parseMihomo(
      'proxies:\n  # LEAVE THIS LINE!\n  - existing\n' +
        'proxy-groups:\n  - name: root\n    include-all: true\n    filter: onlyme\n',
    )
    const { nodes } = buildMihomoGraph(md)
    const hostsNodes = nodes.filter((n) => n.id === 'hosts:root')
    expect(hostsNodes.length).toBe(1)
    // Побеждает узел группы: она объявлена явно автором документа, а не
    // безымянным маркером — иначе фильтр группы пропал бы из графа без следа.
    expect((hostsNodes[0]?.data as { filter?: string }).filter).toBe('onlyme')
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
  })

  it('узел правила несёт цель, даже когда она не разрешается ни в группу, ни в провайдера', () => {
    // Цель — имя хоста от панели (по спеке НОРМА): ребро не рисуется, но
    // пользователь обязан видеть, куда правило ведёт, глядя на сам узел
    const md = parseMihomo('rules:\n  - DOMAIN,a.com,🇫🇮 Finland1\n')
    const { nodes } = buildMihomoGraph(md)
    const rule = nodes.find((n) => n.id === 'rule:0')
    expect((rule?.data as { target?: string }).target).toBe('🇫🇮 Finland1')
  })

  it('узел SUB-RULE несёт цель — имя подсписка, а не группы', () => {
    const md = parseMihomo('sub-rules:\n  ru:\n    - MATCH,DIRECT\nrules:\n  - SUB-RULE,(NETWORK,tcp),ru\n')
    const { nodes } = buildMihomoGraph(md)
    const rule = nodes.find((n) => n.id === 'rule:0')
    expect((rule?.data as { target?: string }).target).toBe('ru')
  })
})

import { describe, expect, it } from 'vitest'
import { buildMihomoGraph, groupDepths, layoutMihomo } from '../src/entities/graph/mihomo/buildGraph'
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

describe('подсписки правил', () => {
  it('подсписок даёт узел с числом правил и ведёт в цели своих правил', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: Основная\n' +
        'sub-rules:\n  block:\n    - DOMAIN,a.com,Основная\n    - MATCH,REJECT\n',
    )
    const { nodes, edges } = buildMihomoGraph(md)
    const sub = nodes.find((n) => n.id === 'subrule:block')
    // `type` — ключ компонента-рендерера, `kind` — вид узла: в графе Mihomo это
    // намеренно разные имена, и проверяем оба
    expect(sub?.type).toBe('mihomoSubRule')
    expect(sub?.data).toMatchObject({ kind: 'mihomo-subrule', name: 'block', count: 2 })
    expect((sub?.data as { targets: string[] }).targets).toEqual(['Основная', 'REJECT'])
    expect(edges.map((e) => e.id)).toContain('e:subrule:block->group:Основная')
    expect(edges.map((e) => e.id)).toContain('e:subrule:block->builtin:REJECT')
  })

  it('узел подсписка стоит в колонке правил', () => {
    const md = parseMihomo(
      'sub-rules:\n  ru:\n    - MATCH,DIRECT\nrules:\n  - SUB-RULE,(NETWORK,udp),ru\n',
    )
    const { nodes } = buildMihomoGraph(md)
    expect(nodes.find((n) => n.id === 'subrule:ru')?.position.x).toBe(
      nodes.find((n) => n.id === 'rule:0')?.position.x,
    )
  })

  it('SUB-RULE ведёт в подсписок, а не в одноимённую группу', () => {
    // Имя подсписка и имя группы совпали: resolveTarget соврал бы, и ребро ушло
    // бы в группу — правило SUB-RULE туда не ведёт никогда
    const md = parseMihomo(
      'proxy-groups:\n  - name: block\n    proxies:\n      - DIRECT\n' +
        'sub-rules:\n  block:\n    - MATCH,DIRECT\n' +
        'rules:\n  - SUB-RULE,(NETWORK,udp),block\n',
    )
    const ids = buildMihomoGraph(md).edges.map((e) => e.id)
    expect(ids).toContain('e:rule:0->subrule:block')
    expect(ids).not.toContain('e:rule:0->group:block')
  })

  it('ссылка на несуществующий подсписок ребра не даёт', () => {
    // Висячую ссылку ловит диагностикой validateMihomo — граф просто молчит
    const md = parseMihomo('rules:\n  - SUB-RULE,(NETWORK,udp),block\n')
    const { nodes, edges } = buildMihomoGraph(md)
    expect(nodes.map((n) => n.id)).not.toContain('subrule:block')
    expect(edges.filter((e) => e.source === 'rule:0')).toEqual([])
  })

  it('цель подсписка, которую подставит панель, ребра не даёт, но остаётся в узле', () => {
    const md = parseMihomo('sub-rules:\n  ru:\n    - MATCH,🇫🇮 Finland1\n')
    const { nodes, edges } = buildMihomoGraph(md)
    const targets = (nodes.find((n) => n.id === 'subrule:ru')?.data as { targets: string[] }).targets
    expect(targets).toEqual(['🇫🇮 Finland1'])
    expect(edges).toEqual([])
  })

  it('строка подсписка в кавычках разбирается по значению, а не по срезу текста', () => {
    const md = parseMihomo('sub-rules:\n  ru:\n    - "MATCH,DIRECT"\n')
    const { nodes, edges } = buildMihomoGraph(md)
    expect((nodes.find((n) => n.id === 'subrule:ru')?.data as { targets: string[] }).targets)
      .toEqual(['DIRECT'])
    expect(edges.map((e) => e.id)).toContain('e:subrule:ru->builtin:DIRECT')
  })
})

describe('раскладка по вертикали', () => {
  it('узлы одной колонки не лежат друг на друге', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const graph = buildMihomoGraph(md)
    const laid = layoutMihomo(graph.nodes)
    const byColumn = new Map<number, number[]>()
    for (const node of laid) {
      const column = byColumn.get(node.position.x) ?? []
      column.push(node.position.y)
      byColumn.set(node.position.x, column)
    }
    for (const [, ys] of byColumn) {
      expect(new Set(ys).size).toBe(ys.length)
    }
  })

  it('порядок узлов внутри колонки сохраняется', () => {
    const nodes = [
      { id: 'a', type: 'x', position: { x: 0, y: 0 }, data: { kind: 'k' } },
      { id: 'b', type: 'x', position: { x: 0, y: 0 }, data: { kind: 'k' } },
      { id: 'c', type: 'x', position: { x: 430, y: 0 }, data: { kind: 'k' } },
    ]
    const laid = layoutMihomo(nodes as never)
    expect(laid.map((n) => [n.position.x, n.position.y])).toEqual([
      [0, 0],
      [0, 130],
      [430, 0],
    ])
  })
})

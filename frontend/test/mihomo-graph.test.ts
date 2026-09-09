import { describe, expect, it } from 'vitest'
import { buildMihomoGraph, groupDepths, layoutMihomo } from '../src/entities/graph/mihomo/buildGraph'
import { groupsOf, subRuleNames } from '../src/entities/mihomo/groups'
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

  it('две строки подсписка на одну цель дают одно ребро и одну цель в узле', () => {
    // Без дедупликации в targets узел соврал бы про число выходов, а pushEdge
    // молча отбросил бы второе ребро — расхождение видно только в данных узла
    const md = parseMihomo(
      'proxy-groups:\n  - name: VPN\n' +
        'sub-rules:\n  ru:\n    - DOMAIN,a.com,VPN\n    - DOMAIN,b.com,VPN\n    - MATCH,VPN\n',
    )
    const { nodes, edges } = buildMihomoGraph(md)
    const data = nodes.find((n) => n.id === 'subrule:ru')?.data as {
      targets: string[]
      count: number
    }
    expect(data.targets).toEqual(['VPN'])
    // Правил всё-таки три: count считает строки, targets — разные цели
    expect(data.count).toBe(3)
    expect(edges.filter((e) => e.source === 'subrule:ru')).toHaveLength(1)
  })

  it('подсписок с нечитаемым содержимым остаётся узлом, но без правил и целей', () => {
    // Имена подсписков даёт модель (`subRuleEntries`), и «подсписок объявлен» —
    // не то же, что «его содержимое разбирается». Спрятать узел значило бы
    // соврать, что подсписка нет, и разойтись с резолвером диагностик.
    const md = parseMihomo('sub-rules:\n  ru: not-a-list\n')
    const { nodes } = buildMihomoGraph(md)
    expect(nodes.find((n) => n.id === 'subrule:ru')?.data).toMatchObject({
      kind: 'mihomo-subrule',
      count: 0,
      targets: [],
    })
  })

  it('имена подсписков у графа и у модели — один список', () => {
    const md = parseMihomo('sub-rules:\n  ru: not-a-list\n  block:\n    - MATCH,DIRECT\n')
    const inGraph = buildMihomoGraph(md)
      .nodes.filter((n) => n.id.startsWith('subrule:'))
      .map((n) => n.id.slice('subrule:'.length))
    expect(inGraph).toEqual(subRuleNames(md))
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

// Маркер `# LEAVE THIS LINE!` декоративен: панель дописывает хосты по ключам
// документа (`remnawave.include-proxies`, `include-all`), не по комментарию.
// Узел подстановки группы рисуется по `groupTakesHosts` — тому же предикату,
// что и карточка (`getsHosts` в data узла): обе части модели обязаны
// рассказывать про документ одну историю.
describe('узел подстановки: решают ключи, а не маркер', () => {
  const doc = (lines: string[]) =>
    parseMihomo(['proxy-providers:', '  p1:', '    type: inline', 'proxy-groups:', ...lines, ''].join('\n'))

  const cardGetsHosts = (md: ReturnType<typeof parseMihomo>) =>
    (buildMihomoGraph(md).nodes.find((n) => n.id === 'group:G')!.data as { getsHosts: boolean })
      .getsHosts

  it('у группы без единого ключа узел подстановки есть — панель дописывает хосты по умолчанию', () => {
    const md = doc(['  - name: G', '    type: select'])
    const { nodes, edges } = buildMihomoGraph(md)
    expect(nodes.map((n) => n.id)).toContain('hosts:G')
    expect(edges.map((e) => e.id)).toContain('e:group:G->hosts:G')
    expect(cardGetsHosts(md)).toBe(true)
  })

  it('include-proxies: false снимает узел подстановки', () => {
    const md = doc(['  - name: G', '    remnawave:', '      include-proxies: false'])
    expect(buildMihomoGraph(md).nodes.map((n) => n.id)).not.toContain('hosts:G')
    expect(cardGetsHosts(md)).toBe(false)
  })

  it('include-proxies: false вместе с include-all возвращает узел: хосты собирает ядро из корневого списка', () => {
    const md = doc([
      '  - name: G',
      '    remnawave:',
      '      include-proxies: false',
      '    include-all: true',
    ])
    expect(buildMihomoGraph(md).nodes.map((n) => n.id)).toContain('hosts:G')
    expect(cardGetsHosts(md)).toBe(true)
  })

  it('use без include-proxies: false не отменяет подстановку — узел и ребро к провайдеру есть одновременно', () => {
    const md = doc(['  - name: G', '    use:', '      - p1'])
    const { nodes, edges } = buildMihomoGraph(md)
    expect(nodes.map((n) => n.id)).toContain('hosts:G')
    expect(edges.map((e) => e.id)).toContain('e:group:G->hosts:G')
    expect(edges.map((e) => e.id)).toContain('e:group:G->provider:p1')
  })

  it('use при include-proxies: false узла подстановки не даёт: хосты идут только в провайдера', () => {
    const md = doc(['  - name: G', '    remnawave:', '      include-proxies: false', '    use:', '      - p1'])
    const { nodes, edges } = buildMihomoGraph(md)
    expect(nodes.map((n) => n.id)).not.toContain('hosts:G')
    expect(edges.map((e) => e.id)).toContain('e:group:G->provider:p1')
    expect(cardGetsHosts(md)).toBe(false)
  })

  it('hosts:root рисуется всегда у документа-отображения — маркер не требуется', () => {
    const { nodes } = buildMihomoGraph(parseMihomo('mode: rule\n'))
    expect(nodes.map((n) => n.id)).toContain('hosts:root')
  })
})

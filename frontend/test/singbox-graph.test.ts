import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import type { SingboxDoc } from '../src/entities/singbox/types'
import { buildSingboxGraph, groupDepths, layoutSingbox } from '../src/entities/graph/singbox/buildGraph'
import { singboxFixture } from './helpers'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

function fixtureDoc(name: 'default' | 'bundle' | 'legacy'): SingboxDoc {
  return parseSingbox(singboxFixture(name)).doc!
}

function ids(d: SingboxDoc): string[] {
  return buildSingboxGraph(d).nodes.map((n) => n.id)
}

describe('граф sing-box', () => {
  it('настоящие шаблоны каталога строятся и дают узлы всех колонок', () => {
    const graph = buildSingboxGraph(fixtureDoc('bundle'))
    const kinds = new Set(graph.nodes.map((n) => (n.data as { kind: string }).kind))
    expect(kinds.has('singbox-inbound')).toBe(true)
    expect(kinds.has('singbox-rule')).toBe(true)
    expect(kinds.has('singbox-group')).toBe(true)
    expect(kinds.has('singbox-out')).toBe(true)
  })

  it('узел подстановки появляется, только когда панели есть куда класть серверы', () => {
    expect(ids(fixtureDoc('default'))).toContain('hosts:panel')
    const pinned = doc(`{"outbounds":[
      {"type":"selector","tag":"g","outbounds":["direct"],"remnawave":{"includeProxies":false}},
      {"type":"direct","tag":"direct"}
    ]}`)
    // Все группы закреплены — панель не подставит ничего, и узла подстановки нет:
    // пустой узел «сюда придут серверы» соврал бы про этот документ
    expect(ids(pinned)).not.toContain('hosts:panel')
  })

  it('из заполняемой панелью группы ребро идёт в подстановку, из закреплённой — по её списку', () => {
    const d = doc(`{"outbounds":[
      {"type":"selector","tag":"free","outbounds":null},
      {"type":"selector","tag":"written","outbounds":["direct"]},
      {"type":"selector","tag":"pinned","outbounds":["direct"],"remnawave":{"includeProxies":false}},
      {"type":"direct","tag":"direct"}
    ]}`)
    const edges = buildSingboxGraph(d).edges.map((e) => e.id)
    expect(edges).toContain('e:sbgroup:free->hosts:panel')
    expect(edges).toContain('e:sbgroup:pinned->out:direct')
    expect(edges).not.toContain('e:sbgroup:pinned->hosts:panel')
    // Список заполняемой группы панель затрёт целиком: он в документе написан,
    // но в отданном клиенту конфиге его не будет — рисовать его рёбрами значит
    // изображать связь, которой не станет
    expect(edges).toContain('e:sbgroup:written->hosts:panel')
    expect(edges).not.toContain('e:sbgroup:written->out:direct')
  })

  it('ребро «вход → правило» рисуется только по ссылке правила на вход', () => {
    const d = doc(`{"inbounds":[{"type":"tun","tag":"tun-in"},{"type":"mixed","tag":"mix"}],
      "outbounds":[{"type":"direct","tag":"direct"}],
      "route":{"rules":[{"inbound":["tun-in"],"outbound":"direct"},{"domain":"a.com","outbound":"direct"}]}}`)
    const edges = buildSingboxGraph(d).edges.map((e) => e.id)
    expect(edges).toContain('e:sbin:tun-in->rule:0')
    // Второе правило входа не называет: связь «просто так» изобразила бы поток,
    // которого у sing-box нет — вход не привязан к маршруту
    expect(edges.some((e) => e.endsWith('->rule:1'))).toBe(false)
    expect(edges.some((e) => e.startsWith('e:sbin:mix'))).toBe(false)
  })

  it('нетерминальное действие рёбер не даёт, а reject ведёт во встроенный узел', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"direct"}],
      "route":{"rules":[{"action":"sniff"},{"domain":"a.com","action":"reject"}]}}`)
    const graph = buildSingboxGraph(d)
    expect(graph.edges.some((e) => e.id.startsWith('e:sbrule:0'))).toBe(false)
    expect(graph.nodes.map((n) => n.id)).toContain('builtin:reject')
    expect(graph.edges.map((e) => e.id)).toContain('e:sbrule:1->builtin:reject')
  })

  it('bypass с outbound ведёт ребром к выходу, без outbound — во встроенный узел', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"direct"}],
      "route":{"rules":[
        {"domain":"a.com","action":"bypass","outbound":"direct"},
        {"domain":"b.com","action":"bypass"}
      ]}}`)
    const graph = buildSingboxGraph(d)
    // С outbound — как route: ребро к выходу, без builtin-узла для этого правила
    expect(graph.edges.map((e) => e.id)).toContain('e:sbrule:0->out:direct')
    expect(graph.edges.some((e) => e.id.startsWith('e:sbrule:0->builtin:'))).toBe(false)
    // Без outbound — обход ядром, как раньше: встроенный узел
    expect(graph.nodes.map((n) => n.id)).toContain('builtin:bypass')
    expect(graph.edges.map((e) => e.id)).toContain('e:sbrule:1->builtin:bypass')
  })

  it('встроенный узел заводится только под то действие, которое в документе есть', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"direct"}],
      "route":{"rules":[{"protocol":"dns","action":"hijack-dns"}]}}`)
    const nodes = ids(d)
    expect(nodes).toContain('builtin:hijack-dns')
    expect(nodes).not.toContain('builtin:reject')
    expect(nodes).not.toContain('builtin:bypass')
  })

  it('дефолтный выход помечен на карточке, а не отдельным ребром', () => {
    const byFinal = buildSingboxGraph(
      doc(`{"outbounds":[{"type":"direct","tag":"a"},{"type":"direct","tag":"b"}],"route":{"final":"b"}}`),
    )
    const marked = byFinal.nodes.filter((n) => (n.data as { isDefault?: boolean }).isDefault)
    expect(marked.map((n) => n.id)).toEqual(['out:b'])
    expect(byFinal.edges.some((e) => e.id.includes('final'))).toBe(false)

    // final не задан — дефолт задаёт ПОЗИЦИЯ первого элемента, и это надо
    // показать: глазами такое в документе не видно
    const byPosition = buildSingboxGraph(
      doc('{"outbounds":[{"type":"direct","tag":"a"},{"type":"direct","tag":"b"}]}'),
    )
    expect(byPosition.nodes.filter((n) => (n.data as { isDefault?: boolean }).isDefault).map((n) => n.id))
      .toEqual(['out:a'])
  })

  it('группа тоже может быть дефолтным маршрутом — она такая же адресуемая цель, как выход', () => {
    // Ровно так устроен дефолтный шаблон панели: первый элемент outbounds — selector
    const d = doc(`{"outbounds":[
      {"type":"selector","tag":"g","outbounds":["direct"]},
      {"type":"direct","tag":"direct"}
    ]}`)
    const nodes = buildSingboxGraph(d).nodes
    const isDefaultOf = (id: string) => (nodes.find((n) => n.id === id)!.data as { isDefault?: boolean }).isDefault
    expect(isDefaultOf('group:g')).toBe(true)
    expect(isDefaultOf('out:direct')).toBe(false)
  })

  it('незаполненное условие в сводку правила не попадает', () => {
    // Так выглядит правило, только что заведённое кнопкой «+ Правило»: поле есть,
    // значения нет. Назвать его в сводке — сказать, что правило чем-то ограничено
    const d = doc('{"outbounds":[{"type":"direct","tag":"direct"}],"route":{"rules":[{"domain":[],"outbound":"direct"},{"domain":["a.com"],"outbound":"direct"}]}}')
    const nodes = buildSingboxGraph(d).nodes
    const summaryAt = (i: number) =>
      (nodes.find((n) => n.id === `rule:${i}`)!.data as { summary: string[] }).summary
    expect(summaryAt(0)).toEqual([])
    expect(summaryAt(1)).toEqual(['domain: a.com'])
  })

  it('дублирующийся тег не теряет узел, а схлопывается в один', () => {
    // React Flow на дубликате id не падает, а тихо теряет узел с холста
    const d = doc('{"outbounds":[{"type":"direct","tag":"d"},{"type":"direct","tag":"d"}]}')
    const nodes = ids(d)
    expect(nodes.filter((id) => id === 'out:d')).toHaveLength(1)
  })

  it('кольцо ссылок между группами не вешает расчёт глубины', () => {
    const d = doc(`{"outbounds":[
      {"type":"selector","tag":"a","outbounds":["b"],"remnawave":{"includeProxies":false}},
      {"type":"selector","tag":"b","outbounds":["a"],"remnawave":{"includeProxies":false}}
    ]}`)
    expect(() => groupDepths(d)).not.toThrow()
    expect(() => buildSingboxGraph(d)).not.toThrow()
  })

  it('раскладка разносит колонки по X', () => {
    const placed = layoutSingbox(buildSingboxGraph(fixtureDoc('bundle')).nodes)
    expect(new Set(placed.map((n) => n.position.x)).size).toBeGreaterThan(2)
  })

  it('порядок внутри колонки — порядок объявления, а не алфавит', () => {
    // Пользователь ищет выход там, где он стоит в его файле
    const d = doc('{"outbounds":[{"type":"direct","tag":"я"},{"type":"direct","tag":"а"}]}')
    const placed = layoutSingbox(buildSingboxGraph(d).nodes)
    const column = placed.filter((n) => n.id.startsWith('out:'))
    expect(column.map((n) => n.id)).toEqual(['out:я', 'out:а'])
    // И разнесены по вертикали, а не сложены друг на друга
    expect(column[0]!.position.y).not.toBe(column[1]!.position.y)
  })
})

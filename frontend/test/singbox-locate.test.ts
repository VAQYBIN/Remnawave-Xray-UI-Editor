import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { validateSingbox } from '../src/entities/singbox/validate'
import type { SingboxDoc } from '../src/entities/singbox/types'
import { singboxIssueCounts, singboxNodeIdForPath } from '../src/entities/graph/singbox/locate'
import { searchSingbox } from '../src/entities/singbox/search'
import { singboxFixture } from './helpers'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

const SAMPLE = doc(`{
  "inbounds": [{"type":"tun","tag":"tun-in"}],
  "outbounds": [
    {"type":"selector","tag":"выбор","outbounds":null},
    {"type":"direct","tag":"direct"},
    {"type":"shadowsocks","tag":"ss-ru","server":"1.2.3.4","server_port":443}
  ],
  "route": {"rules":[{"domain":"a.com","outbound":"direct"}],"rule_set":[{"tag":"ru"}]}
}`)

describe('путь диагностики sing-box ведёт к узлу', () => {
  it('выход и группа адресуются тегом, а не индексом', () => {
    // Индекс — позиция в массиве, а id узла построен по ТЕГУ: сходить за тегом
    // в документ обязан резолвер, иначе диагностика уводила бы в пустоту
    expect(singboxNodeIdForPath(['outbounds', 1, 'type'], SAMPLE)).toBe('out:direct')
    expect(singboxNodeIdForPath(['outbounds', 0, 'outbounds'], SAMPLE)).toBe('group:выбор')
  })

  it('правило маршрута адресуется индексом', () => {
    expect(singboxNodeIdForPath(['route', 'rules', 0, 'outbound'], SAMPLE)).toBe('rule:0')
  })

  it('вход адресуется тегом', () => {
    expect(singboxNodeIdForPath(['inbounds', 0], SAMPLE)).toBe('inbound:tun-in')
  })

  it('несуществующая позиция узла не имеет', () => {
    expect(singboxNodeIdForPath(['outbounds', 99], SAMPLE)).toBeNull()
    expect(singboxNodeIdForPath(['route', 'rules', 7], SAMPLE)).toBeNull()
  })

  it('диагностика уровня секции узла не имеет', () => {
    // Показать её на первом попавшемся выходе значило бы соврать про место
    expect(singboxNodeIdForPath(['outbounds'], SAMPLE)).toBeNull()
    expect(singboxNodeIdForPath(['route', 'rules'], SAMPLE)).toBeNull()
  })

  it('набор правил и dns узлами графа не рисуются, но ведут в панель «Документ»', () => {
    // rule_set — свойство правила, а не колонка графа; dns — независимый от
    // маршрута механизм и на холст не идёт вовсе (см. спеку). Узла на холсте у
    // них нет, но диагностика не молчит — она открывает панель «Документ»
    expect(singboxNodeIdForPath(['route', 'rule_set', 0], SAMPLE)).toBe('doc:settings')
    expect(singboxNodeIdForPath(['dns', 'servers', 0], SAMPLE)).toBe('doc:settings')
  })

  it('пути панели «Документ» ведут в doc:settings, правила маршрута — на холст', () => {
    const d = doc('{"route":{"rules":[{"outbound":"d"}]},"outbounds":[{"type":"direct","tag":"d"}]}')
    expect(singboxNodeIdForPath(['dns', 'servers', 0, 'tag'], d)).toBe('doc:settings')
    expect(singboxNodeIdForPath(['dns', 'final'], d)).toBe('doc:settings')
    expect(singboxNodeIdForPath(['route', 'rule_set', 0], d)).toBe('doc:settings')
    expect(singboxNodeIdForPath(['route', 'final'], d)).toBe('doc:settings')
    expect(singboxNodeIdForPath(['experimental', 'cache_file'], d)).toBe('doc:settings')
    expect(singboxNodeIdForPath(['log'], d)).toBe('doc:settings')
    expect(singboxNodeIdForPath(['route', 'rules', 0], d)).toBe('rule:0')
    expect(singboxNodeIdForPath(['outbounds'], d)).toBeNull()
  })

  it('счётчики раскладываются по узлам и не смешивают уровни', () => {
    const d = doc(`{"outbounds":[
      {"type":"selector","tag":"g","outbounds":[],"remnawave":{"includeProxies":false}}
    ]}`)
    const counts = singboxIssueCounts(validateSingbox(d), d)
    expect(counts['group:g']!.errors).toBeGreaterThan(0)
    expect(counts['group:g']!.warnings).toBe(0)
  })
})

describe('поиск узлов sing-box', () => {
  it('находит выход по тегу и называет, чем совпало', () => {
    const hits = searchSingbox(SAMPLE, 'ss-ru')
    expect(hits.map((h) => h.nodeId)).toContain('out:ss-ru')
    expect(hits.find((h) => h.nodeId === 'out:ss-ru')!.matchedOn).toMatch(/тег/i)
  })

  it('находит правило по условию, а не только по цели', () => {
    const hits = searchSingbox(SAMPLE, 'a.com')
    expect(hits.map((h) => h.nodeId)).toContain('rule:0')
  })

  it('находит группу по тегу и по типу', () => {
    expect(searchSingbox(SAMPLE, 'выбор').map((h) => h.nodeId)).toContain('group:выбор')
    expect(searchSingbox(SAMPLE, 'selector').map((h) => h.nodeId)).toContain('group:выбор')
  })

  it('пустой запрос не находит ничего', () => {
    expect(searchSingbox(SAMPLE, '   ')).toEqual([])
  })

  it('на настоящем шаблоне каталога поиск не падает и что-то находит', () => {
    const bundle = parseSingbox(singboxFixture('bundle')).doc!
    expect(searchSingbox(bundle, 'direct').length).toBeGreaterThan(0)
  })
})

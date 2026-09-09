import { describe, expect, it } from 'vitest'
import { referencesTo, referenceSites, renameAt } from '../src/entities/mihomo/refs'
import { parseMihomo } from '../src/entities/mihomo/parse'

const DOC = [
  'dns:', '  nameserver-policy:', '    "rule-set:ads,ru": 8.8.8.8', '  fake-ip-filter:', '    - rule-set:ads',
  'tun:', '  route-exclude-address-set: [ru]',
  'proxies:', '  - name: s1', '    type: direct', '    dialer-proxy: G',
  'proxy-groups:', '  - name: G', '    type: select', '    proxies: [s1, DIRECT]', '    use: [P]', '    default-selected: s1',
  'proxy-providers:', '  P: {type: http, url: u, proxy: G, override: {dialer-proxy: s1}}',
  'rule-providers:', '  ads: {type: http, behavior: domain, url: u, proxy: G}', '  ru: {type: http, behavior: domain, url: u}',
  'listeners:', '  - {name: l, type: mixed, port: 1, proxy: G, rule: sub}',
  'ntp: {enable: true, dialer-proxy: s1}',
  'rules:', '  - RULE-SET,ads,REJECT', '  - AND,((RULE-SET,ru),(NETWORK,udp)),G', '  - SUB-RULE,(NETWORK,tcp),sub', '  - MATCH,G',
  'sub-rules:', '  sub:', '    - DOMAIN,a.com,s1', '',
].join('\n')

describe('referencesTo', () => {
  it('группа: proxies, dialer-proxy, proxy провайдеров и наборов, вход, цель правил', () => {
    const paths = referencesTo(parseMihomo(DOC), 'group', 'G').map((s) => s.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['proxies.0.dialer-proxy', 'proxy-providers.P.proxy', 'rule-providers.ads.proxy', 'listeners.0.proxy', 'rules.1', 'rules.3']))
  })
  it('сервер: участник группы, default-selected, override.dialer-proxy, ntp, правило подсписка', () => {
    const paths = referencesTo(parseMihomo(DOC), 'proxy', 's1').map((s) => s.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['proxy-groups.0.proxies.0', 'proxy-groups.0.default-selected', 'proxy-providers.P.override.dialer-proxy', 'ntp.dialer-proxy', 'sub-rules.sub.0']))
  })
  it('набор правил: RULE-SET в правиле и внутри AND, ключ nameserver-policy, fake-ip-filter, route-*-set', () => {
    const md = parseMihomo(DOC)
    expect(referencesTo(md, 'rule-provider', 'ads').map((s) => [s.path.join('.'), s.form])).toEqual(expect.arrayContaining([
      ['rules.0', 'rule'], ['dns.nameserver-policy.rule-set:ads,ru', 'policy-key'], ['dns.fake-ip-filter.0', 'filter-entry'],
    ]))
    expect(referencesTo(md, 'rule-provider', 'ru').map((s) => s.path.join('.'))).toEqual(expect.arrayContaining(['rules.1', 'tun.route-exclude-address-set.0']))
  })
  it('провайдер и подсписок', () => {
    const md = parseMihomo(DOC)
    expect(referencesTo(md, 'provider', 'P').map((s) => s.path.join('.'))).toEqual(['proxy-groups.0.use.0'])
    expect(referencesTo(md, 'sub-rule', 'sub').map((s) => s.path.join('.'))).toEqual(expect.arrayContaining(['rules.2', 'listeners.0.rule']))
  })
})

describe('renameAt', () => {
  it('переименовывает запись и все ссылки; ссылок на старое имя не остаётся', () => {
    const md = parseMihomo(DOC)
    const { md: next, refusal } = renameAt(md, 'rule-provider', 'ads', 'reklama')
    expect(refusal).toBeUndefined()
    expect(referencesTo(next, 'rule-provider', 'ads')).toEqual([])
    expect(referencesTo(next, 'rule-provider', 'reklama')).toHaveLength(3)
    // Ключ переписан через set+remove (см. refs.ts): новый узел ключа заводится
    // заново, и yaml печатает его БЕЗ кавычек — двоеточие не перед пробелом,
    // кавычки синтаксически не нужны, а `yaml@2.9.0` их и не добавляет. Кавычки
    // исходного ключа были собственным стилем ЭТОГО скаляра, не требованием
    // синтаксиса, и переживают переименование ключа только вместе с самим узлом.
    expect(next.text).toContain('rule-set:reklama,ru: 8.8.8.8')
    expect(next.text).toContain('RULE-SET,reklama,REJECT')
    const g = renameAt(next, 'group', 'G', 'VPN')
    expect(referencesTo(g.md, 'group', 'VPN').map((s) => s.path.join('.'))).toContain('rules.3')
    expect(g.md.text).toContain('AND,((RULE-SET,ru),(NETWORK,udp)),VPN')
  })
  it('отказы: пустое, занятое, непечатаемое, не найдено', () => {
    const md = parseMihomo(DOC)
    expect(renameAt(md, 'group', 'G', '').refusal).toBe('empty')
    expect(renameAt(md, 'group', 'G', 's1').refusal).toBe('taken')
    expect(renameAt(md, 'group', 'G', 'DIRECT').refusal).toBe('taken')
    expect(renameAt(md, 'group', 'G', 'a\nb').refusal).toBe('unprintable')
    expect(renameAt(md, 'group', 'X', 'Y').refusal).toBe('not-found')
  })
})

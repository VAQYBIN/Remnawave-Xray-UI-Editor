import { describe, expect, it } from 'vitest'
import { groupsOf, providersOf, proxiesOf, ruleProvidersOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('группы', () => {
  it('читает имя, тип и членство', () => {
    const md = parseMihomo(mihomoFixture('default'))
    const groups = groupsOf(md)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('→ Remnawave')
    expect(groups[0]!.type).toBe('select')
  })

  it('видит ключи remnawave', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const direct = groupsOf(md).find((g) => g.name === '♻️ БезVPN')
    expect(direct?.remnawave.includeProxies).toBe(false)
    expect(direct?.hidden).toBe(true)
  })

  it('видит фильтры и include-all', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: a\n    include-all: true\n    filter: "🇫🇮"\n    exclude-filter: "🇷🇺"\n',
    )
    const group = groupsOf(md)[0]!
    expect(group.includeAll).toBe(true)
    expect(group.filter).toBe('🇫🇮')
    expect(group.excludeFilter).toBe('🇷🇺')
  })
})

describe('слияние YAML (`<<`)', () => {
  it('собственный ключ побеждает пришедший из якоря', () => {
    const md = parseMihomo(
      'x-anchors:\n  base: &base\n    type: select\n' +
        'proxy-groups:\n' +
        '  - name: a\n    <<: *base\n    type: url-test\n',
    )
    expect(groupsOf(md)[0]!.type).toBe('url-test')
  })
})

// Маркер `# LEAVE THIS LINE!` декоративен: панель кладёт хосты по ключам
// документа, а не по комментарию (см. `entities/mihomo/inject.ts`). Прежние
// проверки `groupGetsHosts`/`hasRootMarker` на маркере переехали в
// `mihomo-inject.test.ts` — там же полный контракт `panelInjectsHosts`/
// `groupTakesHosts`/`groupGetsHosts` по ключам `remnawave.include-proxies`,
// `include-all`, `include-all-providers` и `use`.
describe('proxiesOf', () => {
  it('статические серверы с именем; запись без имени пропускается', () => {
    const md = parseMihomo('proxies:\n  - name: s1\n    type: direct\n  - type: ss\n  - {name: s2, type: socks5, server: h}\n')
    expect(proxiesOf(md).map((p) => [p.index, p.name, p.type, p.server])).toEqual([
      [0, 's1', 'direct', undefined],
      [2, 's2', 'socks5', 'h'],
    ])
  })
})

describe('провайдеры', () => {
  it('читает override цепочки', () => {
    const md = parseMihomo(
      'proxy-providers:\n  ru:\n    type: inline\n    remnawave:\n      include-proxies: true\n' +
        '    override:\n      dialer-proxy: 🇷🇺 Russia\n      additional-prefix: "🇷🇺➡️"\n',
    )
    const provider = providersOf(md)[0]!
    expect(provider.name).toBe('ru')
    expect(provider.includeProxies).toBe(true)
    expect(provider.dialerProxy).toBe('🇷🇺 Russia')
    expect(provider.additionalPrefix).toBe('🇷🇺➡️')
  })

  it('наборы правил читаются со своим поведением', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const providers = ruleProvidersOf(md)
    const byName = Object.fromEntries(providers.map((p) => [p.name, p]))
    // В `simple` у всех наборов правил нет собственного ключа `behavior` — он
    // приходит из якорей `&rp_domain`/`&rp_ipcidr` через `<<`. `map.get()` слияние
    // не разворачивает, поэтому без обхода `<<` это поле было бы всегда undefined.
    expect(byName.youtube?.behavior).toBe('domain')
    expect(byName['geoip-ru']?.behavior).toBe('ipcidr')
  })
})

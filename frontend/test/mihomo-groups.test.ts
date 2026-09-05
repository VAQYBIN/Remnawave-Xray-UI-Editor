import { describe, expect, it } from 'vitest'
import { groupGetsHosts, hasRootMarker } from '../src/entities/mihomo/inject'
import { groupsOf, providersOf, ruleProvidersOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('группы', () => {
  it('читает имя, тип и членство', () => {
    const md = parseMihomo(mihomoFixture('default'))
    const groups = groupsOf(md)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('→ Remnawave')
    expect(groups[0]!.type).toBe('select')
    expect(groups[0]!.hasMarker).toBe(true)
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

describe('подстановка хостов', () => {
  it('корневой маркер есть не везде, и это не ошибка', () => {
    expect(hasRootMarker(parseMihomo(mihomoFixture('default')))).toBe(true)
    expect(hasRootMarker(parseMihomo(mihomoFixture('simple')))).toBe(false)
  })

  it('группа получает хосты по маркеру, include-all или use', () => {
    const md = parseMihomo(
      'proxy-groups:\n' +
        '  - name: marker\n    proxies:\n      # LEAVE THIS LINE!\n' +
        '  - name: all\n    include-all: true\n' +
        '  - name: used\n    use:\n      - p1\n' +
        '  - name: empty\n    type: select\n',
    )
    const byName = Object.fromEntries(groupsOf(md).map((g) => [g.name, g]))
    expect(groupGetsHosts(byName.marker!)).toBe(true)
    expect(groupGetsHosts(byName.all!)).toBe(true)
    expect(groupGetsHosts(byName.used!)).toBe(true)
    expect(groupGetsHosts(byName.empty!)).toBe(false)
  })

  it('include-proxies: false отменяет маркер', () => {
    const md = parseMihomo(
      'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: false\n    proxies:\n      # LEAVE THIS LINE!\n',
    )
    expect(groupGetsHosts(groupsOf(md)[0]!)).toBe(false)
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
    const names = ruleProvidersOf(md).map((p) => p.name)
    expect(names).toContain('youtube')
    expect(names).toContain('geoip-ru')
  })
})

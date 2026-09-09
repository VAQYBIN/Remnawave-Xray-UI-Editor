import { describe, expect, it } from 'vitest'
import { groupGetsHosts, groupTakesHosts, panelInjectsHosts } from '../src/entities/mihomo/inject'
import { groupsOf } from '../src/entities/mihomo/groups'
import { parseMihomo } from '../src/entities/mihomo/parse'

const group = (yaml: string) => groupsOf(parseMihomo(`proxy-groups:\n  - name: G\n    type: select\n${yaml}`))[0]!

describe('подстановка по правилу панели', () => {
  it('без ключей панель дописывает хосты — маркер не нужен', () => {
    const g = group('')
    expect(panelInjectsHosts(g)).toBe(true)
    expect(groupTakesHosts(g)).toBe(true)
    expect(groupGetsHosts(g)).toBe(true)
  })
  it('include-proxies: false отменяет подстановку; include-all собирает хосты ядром', () => {
    const off = group('    remnawave:\n      include-proxies: false\n')
    expect(panelInjectsHosts(off)).toBe(false)
    expect(groupTakesHosts(off)).toBe(false)
    expect(groupGetsHosts(off)).toBe(false)
    const all = group('    remnawave:\n      include-proxies: false\n    include-all: true\n')
    expect(panelInjectsHosts(all)).toBe(false)
    expect(groupTakesHosts(all)).toBe(true)
    const providers = group('    remnawave:\n      include-proxies: false\n    include-all-providers: true\n')
    expect(groupTakesHosts(providers)).toBe(false)
    expect(groupGetsHosts(providers)).toBe(true)
    const use = group('    remnawave:\n      include-proxies: false\n    use: [p]\n')
    expect(groupGetsHosts(use)).toBe(true)
  })
})

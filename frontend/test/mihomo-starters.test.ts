import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { nextRulePlacement, providerName, startGroup, startListener, startProxy } from '../src/entities/mihomo/starters'

describe('стартеры Mihomo', () => {
  it('имена уникальны в пространстве целей: группы, серверы и встроенные', () => {
    const md = parseMihomo('proxies:\n  - name: Группа\n    type: direct\nproxy-groups:\n  - name: Сервер\n    type: select\n')
    expect(startGroup(md)).toEqual({ name: 'Группа-2', type: 'select' })
    expect(startProxy(md)).toEqual({ name: 'Сервер-2', type: 'direct', udp: true })
    expect(providerName(md)).toBe('provider')
    expect(startListener(md)).toEqual({ name: 'вход', type: 'mixed', listen: '127.0.0.1', port: 7890 })
  })
  it('+ Правило: перед выбранным, иначе перед финальным MATCH, иначе MATCH в конец', () => {
    const md = parseMihomo('rules:\n  - DOMAIN,a.com,DIRECT\n  - MATCH,DIRECT\n')
    expect(nextRulePlacement(md, 1)).toEqual({ raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: 1 })
    expect(nextRulePlacement(md, null)).toEqual({ raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: 1 })
    expect(nextRulePlacement(parseMihomo('rules:\n  - DOMAIN,a.com,DIRECT\n'), null)).toEqual({ raw: 'MATCH,DIRECT', at: 1 })
    expect(nextRulePlacement(parseMihomo(''), null)).toEqual({ raw: 'MATCH,DIRECT', at: 0 })
  })
})

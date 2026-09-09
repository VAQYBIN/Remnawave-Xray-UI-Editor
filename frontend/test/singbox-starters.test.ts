import { describe, expect, it } from 'vitest'
import {
  nodeIdOf,
  startDnsRule,
  startDnsServer,
  startEndpoint,
  startGroup,
  startInbound,
  startOutbound,
  startRuleSet,
  startServer,
  uniqueTag,
} from '../src/entities/singbox/starters'

const DOC = {
  inbounds: [{ type: 'mixed', tag: 'mixed-in' }],
  outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'selector', tag: 'select' }],
  endpoints: [{ type: 'wireguard', tag: 'wg' }],
  dns: { servers: [{ type: 'local', tag: 'dns-local' }] },
}

describe('стартеры', () => {
  it('uniqueTag нумерует занятые с двойки', () => {
    expect(uniqueTag([], 'direct')).toBe('direct')
    expect(uniqueTag(['direct'], 'direct')).toBe('direct-2')
    expect(uniqueTag(['direct', 'direct-2'], 'direct')).toBe('direct-3')
  })

  it('теги выходов уникальны в объединении outbounds и endpoints', () => {
    expect(startOutbound(DOC).tag).toBe('direct-2')
    expect(startGroup(DOC).tag).toBe('select-2')
    expect(startEndpoint(DOC).tag).toBe('wg-2')
    expect(startServer(DOC)).toEqual({ type: 'vless', tag: 'server', server: '', server_port: 443, uuid: '' })
    expect(startInbound(DOC)).toEqual({ type: 'mixed', tag: 'mixed-in-2', listen: '127.0.0.1', listen_port: 2080 })
  })

  it('DNS-правило берёт первый сервер, набор правил — удалённый binary', () => {
    expect(startDnsRule(DOC)).toEqual({ domain_suffix: [], server: 'dns-local' })
    expect(startDnsRule({})).toEqual({ domain_suffix: [], server: '' })
    expect(startDnsServer(DOC)).toEqual({ type: 'udp', tag: 'dns', server: '1.1.1.1' })
    expect(startRuleSet(DOC)).toEqual({ type: 'remote', tag: 'ruleset', format: 'binary', url: '' })
  })

  it('nodeIdOf строит id по списку и типу', () => {
    expect(nodeIdOf({ type: 'mixed', tag: 'a' }, 'inbounds')).toBe('inbound:a')
    expect(nodeIdOf({ type: 'selector', tag: 'g' }, 'outbounds')).toBe('group:g')
    expect(nodeIdOf({ type: 'direct', tag: 'd' }, 'outbounds')).toBe('out:d')
    expect(nodeIdOf({ type: 'wireguard', tag: 'w' }, 'endpoints')).toBe('out:w')
    expect(nodeIdOf({ type: 'direct' }, 'outbounds')).toBeNull()
  })
})

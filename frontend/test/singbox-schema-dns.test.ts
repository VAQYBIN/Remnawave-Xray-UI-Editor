import { describe, expect, it } from 'vitest'
import { DNS_FIELDS, DNS_RULE_FIELDS, DNS_SERVER_FIELDS, DNS_SERVER_TYPE_VALUES } from '../src/entities/singbox/schema/dns'
import { visibleFields } from '../src/shared/schema'

const serverKeys = (type: string) => visibleFields(DNS_SERVER_FIELDS, { type }).map((f) => f.key)
const ruleKeys = (action: string) => visibleFields(DNS_RULE_FIELDS, action === '' ? {} : { action }).map((f) => f.key)

describe('схема dns', () => {
  it('корень: servers и rules списками, final ссылкой на сервер, independent_cache и fakeip устарели', () => {
    const keys = DNS_FIELDS.map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['servers', 'rules', 'final', 'strategy', 'disable_cache', 'disable_expire', 'independent_cache', 'cache_capacity', 'optimistic', 'timeout', 'reverse_mapping', 'client_subnet', 'fakeip']))
    expect(DNS_FIELDS.find((f) => f.key === 'final')?.ref).toBe('dns-server')
    expect(DNS_FIELDS.find((f) => f.key === 'servers')?.item?.fields).toBe(DNS_SERVER_FIELDS)
    expect(DNS_FIELDS.find((f) => f.key === 'rules')?.item?.fields).toBe(DNS_RULE_FIELDS)
    expect(DNS_FIELDS.find((f) => f.key === 'fakeip')?.deprecated?.replacement).toMatch(/fakeip/)
    expect(DNS_FIELDS.find((f) => f.key === 'independent_cache')?.deprecated?.since).toBe('1.14.0')
  })

  it('серверы: типы 1.12+, у tls есть tls-объект, у fakeip — диапазоны, у local — prefer_go; legacy address устарел', () => {
    expect(DNS_SERVER_TYPE_VALUES.map((e) => e.value)).toEqual(expect.arrayContaining(['local', 'hosts', 'tcp', 'udp', 'tls', 'quic', 'https', 'h3', 'dhcp', 'mdns', 'fakeip', 'tailscale', 'openconnect', 'openvpn', 'resolved']))
    expect(serverKeys('tls')).toEqual(expect.arrayContaining(['server', 'server_port', 'tls', 'detour', 'domain_resolver']))
    expect(serverKeys('https')).toEqual(expect.arrayContaining(['path', 'headers', 'tls']))
    expect(serverKeys('fakeip')).toEqual(expect.arrayContaining(['inet4_range', 'inet6_range']))
    expect(serverKeys('fakeip')).not.toContain('detour')
    expect(serverKeys('local')).toEqual(expect.arrayContaining(['prefer_go', 'neighbor_domain']))
    expect(serverKeys('hosts')).toEqual(expect.arrayContaining(['path', 'predefined']))
    expect(serverKeys('tailscale')).toEqual(expect.arrayContaining(['endpoint', 'accept_default_resolvers', 'accept_search_domain']))
    const legacy = DNS_SERVER_FIELDS.find((f) => f.key === 'address')!
    expect(legacy.deprecated?.since).toBe('1.12.0')
    // legacy-поля видны при пустом type — именно так выглядит старый документ
    expect(serverKeys('')).toEqual(expect.arrayContaining(['address', 'address_resolver', 'address_strategy', 'strategy']))
  })

  it('у каждого типа сервера ключи не повторяются', () => {
    for (const { value } of DNS_SERVER_TYPE_VALUES) {
      const keys = serverKeys(value)
      expect(new Set(keys).size, value).toBe(keys.length)
    }
  })

  it('правила: матчеры, server как поле действия route (и без action), reject и predefined со своими полями', () => {
    const base = ruleKeys('')
    expect(base).toEqual(expect.arrayContaining(['inbound', 'query_type', 'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'source_ip_cidr', 'port', 'process_name', 'clash_mode', 'rule_set', 'invert', 'action', 'server', 'disable_cache', 'rewrite_ttl', 'client_subnet']))
    expect(ruleKeys('route')).toContain('server')
    expect(ruleKeys('reject')).toEqual(expect.arrayContaining(['method', 'no_drop']))
    expect(ruleKeys('reject')).not.toContain('server')
    expect(ruleKeys('predefined')).toEqual(expect.arrayContaining(['rcode', 'answer', 'ns', 'extra']))
    expect(ruleKeys('route-options')).toContain('rewrite_ttl')
    expect(ruleKeys('route-options')).not.toContain('server')
    expect(DNS_RULE_FIELDS.find((f) => f.key === 'server')?.ref).toBe('dns-server')
    expect(DNS_RULE_FIELDS.find((f) => f.key === 'rule_set')?.item?.ref).toBe('rule-set')
    expect(DNS_RULE_FIELDS.find((f) => f.key === 'outbound')?.deprecated?.since).toBe('1.12.0')
  })

  it('логическое правило вкладывает те же правила', () => {
    const rules = DNS_RULE_FIELDS.find((f) => f.key === 'rules')!
    expect(rules.item?.fields).toBe(DNS_RULE_FIELDS)
    expect(ruleKeys('')).toEqual(expect.arrayContaining(['type', 'mode', 'rules']))
  })
})

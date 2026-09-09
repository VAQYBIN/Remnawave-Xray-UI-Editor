import { describe, expect, it } from 'vitest'
import { HEADLESS_RULE_FIELDS, ROUTE_FIELDS, ROUTE_RULE_ACTION_VALUES, ROUTE_RULE_FIELDS, RULE_SET_FIELDS } from '../src/entities/singbox/schema/route'
import { visibleFields } from '../src/shared/schema'

const ruleKeys = (action: string) => visibleFields(ROUTE_RULE_FIELDS, action === '' ? {} : { action }).map((f) => f.key)
const setKeys = (type: string) => visibleFields(RULE_SET_FIELDS, { type }).map((f) => f.key)

describe('схема маршрута', () => {
  it('корень: final ссылкой на выход, default_domain_resolver объектом, geoip/geosite устарели', () => {
    const keys = ROUTE_FIELDS.map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['rules', 'rule_set', 'final', 'auto_detect_interface', 'override_android_vpn', 'default_interface', 'default_mark', 'default_domain_resolver', 'default_network_strategy', 'default_network_type', 'default_fallback_network_type', 'default_fallback_delay', 'default_http_client', 'find_process', 'geoip', 'geosite', 'default_domain_strategy']))
    expect(ROUTE_FIELDS.find((f) => f.key === 'final')?.ref).toBe('outbound')
    expect(ROUTE_FIELDS.find((f) => f.key === 'default_domain_resolver')?.kind).toBe('object')
    expect(ROUTE_FIELDS.find((f) => f.key === 'geoip')?.deprecated?.replacement).toMatch(/rule_set/)
  })

  it('действия правила: все семь, outbound только у route и bypass, sniff и resolve со своими полями', () => {
    expect(ROUTE_RULE_ACTION_VALUES.map((e) => e.value)).toEqual(['route', 'route-options', 'reject', 'hijack-dns', 'sniff', 'resolve', 'bypass'])
    expect(ruleKeys('')).toContain('outbound')
    expect(ruleKeys('route')).toContain('outbound')
    expect(ruleKeys('bypass')).toContain('outbound')
    expect(ruleKeys('reject')).not.toContain('outbound')
    expect(ruleKeys('reject')).toEqual(expect.arrayContaining(['method', 'no_drop']))
    expect(ruleKeys('sniff')).toEqual(expect.arrayContaining(['sniffer', 'timeout']))
    expect(ruleKeys('resolve')).toEqual(expect.arrayContaining(['server', 'strategy', 'disable_cache', 'rewrite_ttl', 'client_subnet']))
    expect(ruleKeys('route-options')).toEqual(expect.arrayContaining(['override_address', 'override_port', 'udp_disable_domain_unmapping', 'udp_connect', 'udp_timeout', 'tls_fragment']))
    expect(ruleKeys('route')).toContain('override_port')
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'outbound')?.ref).toBe('outbound')
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'server')?.ref).toBe('dns-server')
  })

  it('матчеры правила: полный набор, geosite/geoip устарели', () => {
    expect(ruleKeys('')).toEqual(expect.arrayContaining(['inbound', 'ip_version', 'network', 'auth_user', 'protocol', 'client', 'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'source_ip_cidr', 'source_ip_is_private', 'ip_cidr', 'ip_is_private', 'source_port', 'source_port_range', 'port', 'port_range', 'process_name', 'process_path', 'process_path_regex', 'package_name', 'user', 'user_id', 'clash_mode', 'network_type', 'network_is_expensive', 'network_is_constrained', 'wifi_ssid', 'wifi_bssid', 'rule_set', 'rule_set_ip_cidr_match_source', 'invert', 'type', 'mode', 'rules', 'geosite', 'geoip', 'source_geoip']))
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'geosite')?.deprecated?.since).toBe('1.8.0')
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'rules')?.item?.fields).toBe(ROUTE_RULE_FIELDS)
    expect(ROUTE_RULE_FIELDS.find((f) => f.key === 'sniffer')?.item?.enum?.map((e) => e.value)).toContain('bittorrent')
  })

  it('наборы правил: remote с url и download_detour (устарел с 1.14), local с path, inline с headless-правилами', () => {
    expect(setKeys('remote')).toEqual(expect.arrayContaining(['tag', 'format', 'url', 'update_interval', 'download_detour', 'initial_path', 'http_client']))
    expect(setKeys('local')).toEqual(expect.arrayContaining(['tag', 'format', 'path']))
    expect(setKeys('local')).not.toContain('url')
    expect(setKeys('inline')).toContain('rules')
    expect(setKeys('inline')).not.toContain('format')
    expect(RULE_SET_FIELDS.find((f) => f.key === 'download_detour')?.deprecated?.since).toBe('1.14.0')
    expect(RULE_SET_FIELDS.find((f) => f.key === 'rules')?.item?.fields).toBe(HEADLESS_RULE_FIELDS)
    const headless = HEADLESS_RULE_FIELDS.map((f) => f.key)
    expect(headless).toEqual(expect.arrayContaining(['domain', 'domain_suffix', 'ip_cidr', 'port', 'process_name', 'query_type', 'invert', 'type', 'mode', 'rules']))
    for (const k of ['inbound', 'clash_mode', 'rule_set', 'action', 'outbound']) expect(headless, k).not.toContain(k)
  })
})

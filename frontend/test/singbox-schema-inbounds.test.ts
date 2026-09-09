import { describe, expect, it } from 'vitest'
import { INBOUND_FIELDS, INBOUND_TYPE_VALUES } from '../src/entities/singbox/schema/inbounds'
import { visibleFields } from '../src/shared/schema'

const keysFor = (type: string) => visibleFields(INBOUND_FIELDS, { type }).map((f) => f.key)

describe('схема входов', () => {
  it('типы клиента', () => {
    expect(INBOUND_TYPE_VALUES.map((e) => e.value)).toEqual(['tun', 'mixed', 'socks', 'http', 'direct', 'shadowsocks', 'redirect', 'tproxy'])
  })

  it('tun: полный набор полей и вложенный platform.http_proxy; listen-полей нет', () => {
    const tun = keysFor('tun')
    expect(tun).toEqual(expect.arrayContaining([
      'interface_name', 'address', 'mtu', 'auto_route', 'iproute2_table_index', 'iproute2_rule_index',
      'auto_redirect', 'auto_redirect_input_mark', 'auto_redirect_output_mark', 'strict_route',
      'route_address', 'route_exclude_address', 'route_address_set', 'route_exclude_address_set',
      'endpoint_independent_nat', 'stack', 'include_interface', 'exclude_interface', 'include_uid',
      'include_uid_range', 'exclude_uid', 'exclude_uid_range', 'include_android_user', 'include_package',
      'exclude_package', 'platform', 'inet4_address', 'inet6_address', 'gso',
    ]))
    expect(tun).not.toContain('listen')
    const platform = visibleFields(INBOUND_FIELDS, { type: 'tun' }).find((f) => f.key === 'platform')!
    const proxy = platform.fields!.find((f) => f.key === 'http_proxy')!
    expect(proxy.fields!.map((f) => f.key)).toEqual(['enabled', 'server', 'server_port', 'bypass_domain', 'match_domain'])
    for (const k of ['inet4_address', 'inet6_address', 'gso']) {
      expect(visibleFields(INBOUND_FIELDS, { type: 'tun' }).find((f) => f.key === k)?.deprecated, k).toBeDefined()
    }
  })

  it('mixed: listen-поля, users и set_system_proxy; sniff устарел', () => {
    const mixed = visibleFields(INBOUND_FIELDS, { type: 'mixed' })
    expect(mixed.map((f) => f.key)).toEqual(expect.arrayContaining(['listen', 'listen_port', 'users', 'set_system_proxy', 'sniff']))
    expect(mixed.find((f) => f.key === 'users')?.item?.fields?.map((f) => f.key)).toEqual(['username', 'password'])
    expect(mixed.find((f) => f.key === 'sniff')?.deprecated?.since).toBe('1.11.0')
  })

  it('shadowsocks: method, password, users с name; direct: network и override', () => {
    const ss = visibleFields(INBOUND_FIELDS, { type: 'shadowsocks' })
    expect(ss.map((f) => f.key)).toEqual(expect.arrayContaining(['method', 'password', 'users', 'managed', 'multiplex', 'network']))
    expect(ss.find((f) => f.key === 'users')?.item?.fields?.map((f) => f.key)).toEqual(['name', 'password'])
    expect(keysFor('direct')).toEqual(expect.arrayContaining(['network', 'override_address', 'override_port']))
  })

  it('у каждого типа ключи в видимом наборе не повторяются', () => {
    for (const { value } of INBOUND_TYPE_VALUES) {
      const keys = keysFor(value)
      expect(new Set(keys).size, value).toBe(keys.length)
    }
  })
})

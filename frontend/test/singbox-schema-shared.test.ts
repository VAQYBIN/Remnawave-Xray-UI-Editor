import { describe, expect, it } from 'vitest'
import {
  DIAL_FIELDS,
  LISTEN_FIELDS,
  MULTIPLEX_FIELDS,
  TLS_FIELDS,
  TRANSPORT_FIELDS,
  en,
  obj,
  str,
  tagLabel,
  when,
  whenNot,
  withWhen,
} from '../src/entities/singbox/schema/shared'
import { visibleFields } from '../src/shared/schema'

const keys = (f: { key: string }[]) => f.map((x) => x.key)

describe('строители', () => {
  it('собирают поле нужного вида и не теряют дополнительных свойств', () => {
    expect(str('tag', 'Имя.', { ref: 'outbound' })).toEqual({ key: 'tag', doc: 'Имя.', kind: 'string', ref: 'outbound' })
    expect(en('type', 'Тип.', ['a', { value: 'b', doc: 'Б' }]).enum).toEqual([{ value: 'a' }, { value: 'b', doc: 'Б' }])
    expect(obj('tls', 'TLS.', [str('x', 'X.')]).fields).toHaveLength(1)
    expect(when('type', 'vless', 'vmess')).toEqual({ key: 'type', in: ['vless', 'vmess'] })
    expect(whenNot('type', 'selector')).toEqual({ key: 'type', notIn: ['selector'] })
  })

  it('withWhen вешает условие на каждое поле фрагмента, не трогая исходник', () => {
    const cond = when('type', 'tun')
    const out = withWhen(LISTEN_FIELDS, cond)
    expect(out.every((f) => f.when === cond)).toBe(true)
    expect(LISTEN_FIELDS.every((f) => f.when === undefined)).toBe(true)
  })

  it('tagLabel подписывает элемент тегом либо номером', () => {
    expect(tagLabel({ tag: 'wg' }, 0)).toBe('wg')
    expect(tagLabel({}, 2)).toBe('#3')
  })
})

describe('фрагменты ядра', () => {
  it('dial-поля: ключевые есть, domain_strategy устарел с 1.12.0 в пользу domain_resolver', () => {
    expect(keys(DIAL_FIELDS)).toEqual(expect.arrayContaining([
      'detour', 'bind_interface', 'inet4_bind_address', 'inet6_bind_address', 'bind_address_no_port',
      'routing_mark', 'reuse_addr', 'netns', 'connect_timeout', 'tcp_fast_open', 'tcp_multi_path',
      'disable_tcp_keep_alive', 'tcp_keep_alive', 'tcp_keep_alive_interval', 'udp_fragment',
      'domain_resolver', 'network_strategy', 'network_type', 'fallback_network_type', 'fallback_delay',
      'domain_strategy',
    ]))
    const legacy = DIAL_FIELDS.find((f) => f.key === 'domain_strategy')!
    expect(legacy.deprecated?.since).toBe('1.12.0')
    expect(legacy.deprecated?.replacement).toMatch(/domain_resolver/)
    expect(DIAL_FIELDS.find((f) => f.key === 'detour')?.ref).toBe('outbound')
  })

  it('listen-поля: sniff-группа устарела с 1.11.0', () => {
    expect(keys(LISTEN_FIELDS)).toEqual(expect.arrayContaining([
      'listen', 'listen_port', 'tcp_fast_open', 'tcp_multi_path', 'udp_fragment', 'udp_timeout', 'detour',
      'sniff', 'sniff_override_destination', 'sniff_timeout', 'domain_strategy', 'udp_disable_domain_unmapping',
    ]))
    for (const k of ['sniff', 'sniff_override_destination', 'sniff_timeout', 'domain_strategy', 'udp_disable_domain_unmapping']) {
      expect(LISTEN_FIELDS.find((f) => f.key === k)?.deprecated?.since, k).toBe('1.11.0')
    }
  })

  it('tls: клиентские поля, utls и reality вложены, серверных ключей нет', () => {
    expect(keys(TLS_FIELDS)).toEqual(expect.arrayContaining([
      'enabled', 'disable_sni', 'server_name', 'insecure', 'alpn', 'min_version', 'max_version',
      'cipher_suites', 'certificate', 'certificate_path', 'fragment', 'fragment_fallback_delay',
      'record_fragment', 'ech', 'utls', 'reality',
    ]))
    expect(keys(TLS_FIELDS)).not.toContain('key')
    const utls = TLS_FIELDS.find((f) => f.key === 'utls')!
    expect(keys(utls.fields!)).toEqual(['enabled', 'fingerprint'])
    expect(utls.fields!.find((f) => f.key === 'fingerprint')?.enum?.map((e) => e.value)).toContain('chrome')
    const reality = TLS_FIELDS.find((f) => f.key === 'reality')!
    expect(keys(reality.fields!)).toEqual(['enabled', 'public_key', 'short_id'])
  })

  it('transport: поля по типу; у ws есть max_early_data, у grpc — service_name', () => {
    const t = TRANSPORT_FIELDS
    expect(visibleFields(t, { type: 'ws' }).map((f) => f.key)).toEqual(expect.arrayContaining(['path', 'headers', 'max_early_data', 'early_data_header_name']))
    expect(visibleFields(t, { type: 'grpc' }).map((f) => f.key)).toEqual(expect.arrayContaining(['service_name', 'idle_timeout', 'ping_timeout', 'permit_without_stream']))
    expect(visibleFields(t, { type: 'quic' }).map((f) => f.key)).toEqual(['type'])
  })

  it('multiplex: протоколы и brutal', () => {
    expect(keys(MULTIPLEX_FIELDS)).toEqual(['enabled', 'protocol', 'max_connections', 'min_streams', 'max_streams', 'padding', 'brutal'])
  })
})

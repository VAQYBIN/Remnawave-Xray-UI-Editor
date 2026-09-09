import { describe, expect, it } from 'vitest'
import { DNS_FIELDS } from '../src/entities/mihomo/schema/dns'
import { ROOT_FIELDS } from '../src/entities/mihomo/schema/root'
import { SNIFFER_FIELDS } from '../src/entities/mihomo/schema/sniffer'
import { TUN_FIELDS } from '../src/entities/mihomo/schema/tun'
import { NTP_FIELDS } from '../src/entities/mihomo/schema/misc'
import { deprecatedAt, visibleFields, type FieldSchema } from '../src/shared/schema'

const keys = (fields: FieldSchema[]) => fields.map((f) => f.key)
const field = (fields: FieldSchema[], key: string) => fields.find((f) => f.key === key)!

describe('схема Mihomo: корень, dns, tun, sniffer', () => {
  it('корень описывает порты, режим, geo и API целиком', () => {
    for (const k of ['mixed-port', 'port', 'socks-port', 'redir-port', 'tproxy-port', 'allow-lan', 'bind-address',
      'lan-allowed-ips', 'lan-disallowed-ips', 'authentication', 'skip-auth-prefixes', 'mode', 'log-level', 'ipv6',
      'unified-delay', 'tcp-concurrent', 'interface-name', 'routing-mark', 'find-process-mode', 'global-client-fingerprint',
      'keep-alive-idle', 'keep-alive-interval', 'disable-keep-alive', 'geodata-mode', 'geodata-loader', 'geo-auto-update',
      'geo-update-interval', 'geox-url', 'geosite-matcher', 'global-ua', 'etag-support', 'external-controller',
      'external-controller-tls', 'external-controller-unix', 'external-controller-pipe', 'external-controller-cors',
      'external-controller-routing-mark', 'secret', 'external-ui', 'external-ui-name', 'external-ui-url',
      'external-doh-server', 'tls', 'remnawave', 'enable-process']) {
      expect(keys(ROOT_FIELDS), k).toContain(k)
    }
    expect(field(ROOT_FIELDS, 'enable-process').deprecated?.replacement).toMatch(/find-process-mode/)
    expect(field(ROOT_FIELDS, 'remnawave').panelKey).toBe(true)
    expect(keys(field(ROOT_FIELDS, 'tls').fields!)).toEqual(['certificate', 'private-key', 'client-auth-type', 'client-auth-cert', 'ech-key', 'custom-certifactes'])
  })

  it('dns: nameserver-policy и hosts-подобные отображения принимают списки; fallback-filter.geosite устарел', () => {
    expect(field(DNS_FIELDS, 'nameserver-policy')).toMatchObject({ kind: 'map', values: 'strings' })
    expect(field(DNS_FIELDS, 'proxy-server-nameserver-policy')).toMatchObject({ kind: 'map', values: 'strings' })
    expect(field(DNS_FIELDS, 'fake-ip-filter-mode').enum!.map((e) => e.value)).toEqual(['blacklist', 'whitelist', 'rule'])
    const ff = field(DNS_FIELDS, 'fallback-filter').fields!
    expect(deprecatedAt(ff, { geosite: ['gfw'] })).toHaveLength(1)
  })

  it('tun: inet4/inet6-route-* устарели с заменой на route-address', () => {
    for (const k of ['inet4-route-address', 'inet6-route-address', 'inet4-route-exclude-address', 'inet6-route-exclude-address']) {
      expect(field(TUN_FIELDS, k).deprecated?.replacement).toMatch(/route-/)
    }
    expect(field(TUN_FIELDS, 'stack').enum!.map((e) => e.value)).toEqual(['system', 'gvisor', 'mixed'])
  })

  it('sniffer.sniff — вложенный объект с портами по протоколу; sniffing и port-whitelist устарели', () => {
    const sniff = field(SNIFFER_FIELDS, 'sniff').fields!
    expect(keys(sniff)).toEqual(['HTTP', 'TLS', 'QUIC'])
    expect(field(field(sniff, 'HTTP').fields!, 'ports').item).toEqual({ kind: 'port' })
    expect(field(SNIFFER_FIELDS, 'sniffing').deprecated).toBeDefined()
    expect(field(SNIFFER_FIELDS, 'port-whitelist').deprecated).toBeDefined()
    expect(visibleFields(SNIFFER_FIELDS, {})).toHaveLength(SNIFFER_FIELDS.length)
  })

  it('ntp.dialer-proxy — ссылка на цель маршрута', () => {
    expect(field(NTP_FIELDS, 'dialer-proxy').ref).toBe('proxy-target')
  })
})

import { describe, expect, it } from 'vitest'
import { DNS_FIELDS } from '../src/entities/mihomo/schema/dns'
import { ROOT_FIELDS } from '../src/entities/mihomo/schema/root'
import { SNIFFER_FIELDS } from '../src/entities/mihomo/schema/sniffer'
import { TUN_FIELDS } from '../src/entities/mihomo/schema/tun'
import { NTP_FIELDS } from '../src/entities/mihomo/schema/misc'
import { deprecatedAt, visibleFields, type FieldSchema } from '../src/shared/schema'
import { MIHOMO_DOC_SECTIONS, MIHOMO_SCHEMA, mihomoFieldAt, mihomoFieldsAt, mihomoRefs } from '../src/entities/mihomo/schema'
import { GROUP_FIELDS } from '../src/entities/mihomo/schema/groups'
import { LISTENER_FIELDS, LISTENER_TYPE_VALUES } from '../src/entities/mihomo/schema/listeners'
import { PROVIDER_FIELDS, RULE_PROVIDER_FIELDS } from '../src/entities/mihomo/schema/providers'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { walkSchema } from '../src/shared/schema'

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

describe('схема Mihomo: корень и помощники', () => {
  it('корень содержит все разделы документа', () => {
    for (const k of ['proxies', 'proxy-groups', 'proxy-providers', 'rule-providers', 'rules', 'sub-rules', 'dns', 'hosts', 'tun', 'sniffer',
      'profile', 'ntp', 'experimental', 'listeners', 'tunnels', 'mode', 'remnawave']) {
      expect(keys(MIHOMO_SCHEMA), k).toContain(k)
    }
  })

  it('спуск по пути: элемент proxy-groups, запись proxy-providers, sub-rules', () => {
    const json = { 'proxy-groups': [{ name: 'a', type: 'url-test' }], 'proxy-providers': { p: { type: 'http' } } }
    expect(keys(mihomoFieldsAt(['proxy-groups', 0], json)!)).toContain('tolerance')
    expect(keys(mihomoFieldsAt(['proxy-providers', 'p'], json)!)).toContain('health-check')
    expect(mihomoFieldAt(['rule-providers', 'x', 'behavior'], {})?.enum!.map((e) => e.value)).toEqual(['domain', 'ipcidr', 'classical'])
    expect(mihomoFieldAt(['sub-rules'], {})?.kind).toBe('map')
  })

  it('fieldAt: промах на неизвестном ключе остаётся вне схемы, а не описанием родителя', () => {
    const json = {
      dns: { enable: true },
      proxies: [{ name: 'a', type: 'direct' }],
      'proxy-providers': { p1: { type: 'http' } },
      'rule-providers': { r1: { type: 'http', behavior: 'domain' } },
    }
    expect(mihomoFieldAt(['dns', 'xxx'], json)).toBeUndefined()
    expect(mihomoFieldAt(['proxies', 0, 'xxx'], json)).toBeUndefined()
    expect(mihomoFieldAt(['proxies', 0], json)?.key).toBe('proxies')
    expect(mihomoFieldAt(['proxy-providers', 'p1'], json)?.kind).toBe('map')
    expect(mihomoFieldAt(['proxy-providers', 'p1', 'url'], json)?.key).toBe('url')
    // Неизвестный ключ ВНУТРИ записи map — тоже вне схемы, а не запись целиком:
    // родительский путь здесь кончается на имя записи ('p1'/'r1'), а не на
    // ключе самого map ('proxy-providers'/'rule-providers')
    expect(mihomoFieldAt(['proxy-providers', 'p1', 'unknown'], json)).toBeUndefined()
    expect(mihomoFieldAt(['rule-providers', 'r1', 'unknown'], json)).toBeUndefined()
  })

  it('у каждого deprecated есть замена, у каждого ref — известный вид', () => {
    const refs = new Set(['outbound', 'inbound', 'dns-server', 'rule-set', 'proxy-target', 'provider', 'sub-rule'])
    const walk = (fields: FieldSchema[]) => {
      for (const f of fields) {
        if (f.deprecated) expect(f.deprecated.replacement, f.key).not.toBe('')
        if (f.ref) expect(refs.has(f.ref), f.key).toBe(true)
        if (f.item?.ref) expect(refs.has(f.item.ref), f.key).toBe(true)
        if (f.fields) walk(f.fields)
        if (f.item?.fields) walk(f.item.fields)
      }
    }
    walk(MIHOMO_SCHEMA)
  })

  it('mihomoRefs: цели маршрута — группы, статические серверы и встроенные; провайдеры, наборы, подсписки', () => {
    const md = parseMihomo(['proxies:', '  - name: s1', '    type: direct', 'proxy-groups:', '  - name: G', '    type: select',
      'proxy-providers:', '  P: {type: http, url: u}', 'rule-providers:', '  R: {type: http, behavior: domain, url: u}',
      'sub-rules:', '  S: []', ''].join('\n'))
    const refs = mihomoRefs(md)
    expect(refs['proxy-target']).toEqual(['G', 's1', 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'])
    expect(refs.provider).toEqual(['P'])
    expect(refs['rule-set']).toEqual(['R'])
    expect(refs['sub-rule']).toEqual(['S'])
  })

  it('разделы панели «Документ»: порядок и виды', () => {
    expect(MIHOMO_DOC_SECTIONS.map((s) => [s.title, s.kind])).toEqual([
      ['Общие', 'object'], ['DNS', 'object'], ['TUN', 'object'], ['Снифер', 'object'], ['Профиль', 'object'], ['NTP', 'object'],
      ['Экспериментальное', 'object'], ['Входы', 'list'], ['Туннели', 'list'], ['Наборы правил', 'map'], ['Провайдеры', 'map'], ['Подсписки', 'map'],
    ])
    expect(MIHOMO_DOC_SECTIONS[0]!.skip).toEqual(expect.arrayContaining(['proxies', 'proxy-groups', 'rules', 'dns', 'tun', 'sniffer', 'profile', 'ntp', 'experimental', 'listeners', 'tunnels', 'rule-providers', 'proxy-providers', 'sub-rules']))
  })

  it('walkSchema обходит группы, серверы, провайдеров и входы', () => {
    const json = { 'proxy-groups': [{ name: 'a', type: 'relay' }], listeners: [{ name: 'l', type: 'mixed' }], 'proxy-providers': { p: { type: 'http' } } }
    const seen: string[] = []
    walkSchema(MIHOMO_SCHEMA, json, (path) => seen.push(path.join('.')))
    expect(seen).toEqual(expect.arrayContaining(['', 'proxy-groups.0', 'listeners.0']))
  })

  it('группа: relay устарел, remnawave — ключи панели', () => {
    expect(field(GROUP_FIELDS, 'type').enum!.find((e) => e.value === 'relay')?.deprecated).toBeDefined()
    expect(field(GROUP_FIELDS, 'remnawave').panelKey).toBe(true)
    expect(field(PROVIDER_FIELDS, 'payload').item?.kind).toBe('object')
    expect(field(RULE_PROVIDER_FIELDS, 'format').enum!.map((e) => e.value)).toEqual(['yaml', 'text', 'mrs'])
    expect(LISTENER_TYPE_VALUES.map((e) => e.value)).toEqual(expect.arrayContaining(['socks', 'http', 'mixed', 'redir', 'tproxy', 'tun', 'shadowsocks', 'vmess', 'vless', 'trojan', 'anytls', 'mieru', 'sudoku', 'tuic', 'shadowquic', 'hysteria2', 'hysteria2-realm', 'trusttunnel', 'tunnel', 'snell']))
    expect(field(LISTENER_FIELDS, 'port').item?.kind).toBeUndefined()
    expect(field(LISTENER_FIELDS, 'port').kind).toBe('string')
  })
})

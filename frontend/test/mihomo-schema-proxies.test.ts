import { describe, expect, it } from 'vitest'
import { PROXY_FIELDS, PROXY_TYPE_VALUES } from '../src/entities/mihomo/schema/proxies'
import { visibleFields } from '../src/shared/schema'

const visible = (value: Record<string, unknown>) => visibleFields(PROXY_FIELDS, value).map((f) => f.key)

describe('схема серверов Mihomo', () => {
  it('все типы канонического config.yaml описаны', () => {
    const types = PROXY_TYPE_VALUES.map((e) => e.value)
    for (const t of ['direct', 'dns', 'http', 'socks5', 'ss', 'ssr', 'snell', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2',
      'tuic', 'wireguard', 'tailscale', 'zerotier', 'openvpn', 'masque', 'shadowquic', 'ssh', 'mieru', 'sudoku', 'anytls',
      'trusttunnel', 'gost-relay', 'rematch']) {
      expect(types, t).toContain(t)
    }
  })

  it('поля появляются по типу: vless видит uuid и flow, ss — cipher и plugin, wireguard — ключи и peers', () => {
    expect(visible({ type: 'vless' })).toEqual(expect.arrayContaining(['uuid', 'flow', 'packet-encoding', 'encryption', 'network', 'tls', 'servername', 'reality-opts']))
    expect(visible({ type: 'vless' })).not.toContain('cipher')
    expect(visible({ type: 'ss' })).toEqual(expect.arrayContaining(['cipher', 'password', 'plugin', 'plugin-opts', 'udp-over-tcp', 'smux']))
    expect(visible({ type: 'wireguard' })).toEqual(expect.arrayContaining(['private-key', 'public-key', 'pre-shared-key', 'ip', 'ipv6', 'reserved', 'peers', 'amnezia-wg-option', 'mtu']))
    expect(visible({ type: 'direct' })).not.toContain('server')
    expect(visible({ type: 'dns' })).not.toContain('server')
  })

  it('транспортные объекты появляются по network', () => {
    expect(visible({ type: 'vmess', network: 'ws' })).toContain('ws-opts')
    expect(visible({ type: 'vmess', network: 'ws' })).not.toContain('grpc-opts')
    expect(visible({ type: 'vmess', network: 'grpc' })).toContain('grpc-opts')
    expect(visible({ type: 'vless', network: 'xhttp' })).toContain('xhttp-opts')
    expect(visible({ type: 'vmess', network: 'mkcp' })).toContain('mkcp-opts')
    expect(visible({ type: 'vmess', network: 'mekya' })).toContain('mekya-opts')
    expect(visible({ type: 'vmess', network: 'h2' })).toContain('h2-opts')
    expect(visible({ type: 'vmess', network: 'http' })).toContain('http-opts')
  })

  it('общие поля есть у всех сетевых типов: name, type, server, port, udp, ip-version, dialer-proxy', () => {
    for (const t of ['ss', 'vmess', 'trojan', 'hysteria2', 'tuic', 'socks5']) {
      expect(visible({ type: t })).toEqual(expect.arrayContaining(['name', 'type', 'server', 'port', 'udp', 'ip-version', 'dialer-proxy', 'interface-name', 'routing-mark']))
    }
  })
})

import { describe, expect, it } from 'vitest'
import { NETWORK_VALUES, PROXY_FIELDS, PROXY_TYPE_VALUES } from '../src/entities/mihomo/schema/proxies'
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

// Таблица ниже строится из `when` самих полей PROXY_FIELDS, а не из руками
// переписанного списка транспортов: список полей и их сетей не может отстать
// от схемы, потому что читается из неё же. Точечные ассёршены `not.toContain`
// выше проверяют только конкретные пары (ws/grpc) — они не ловят, скажем,
// пропавшее условие у `ws-opts`, если сосед `grpc-opts` рядом устроен верно.
describe('транспортные опции видны только под своим network', () => {
  const guardedByNetwork = PROXY_FIELDS.flatMap((field) => {
    if (field.when === undefined || field.when.key !== 'network' || field.when.in === undefined) return []
    return [{ field, values: field.when.in }]
  })

  it('нашлись все опции транспорта', () => {
    expect(guardedByNetwork.map((g) => g.field.key).sort()).toEqual(
      ['grpc-opts', 'h2-opts', 'http-opts', 'mekya-opts', 'mkcp-opts', 'ws-opts', 'xhttp-opts'],
    )
  })

  for (const { field, values } of guardedByNetwork) {
    for (const net of NETWORK_VALUES.map((e) => e.value)) {
      const shouldShow = values.includes(net)
      it(`${field.key}: network=${net} → ${shouldShow ? 'виден' : 'скрыт'}`, () => {
        const shown = visibleFields(PROXY_FIELDS, { type: 'vmess', network: net })
        expect(shown.includes(field)).toBe(shouldShow)
      })
    }
  }
})

// Тот же приём для протокольных полей: по одному представителю типа СНАРУЖИ
// списка `when.in` на каждое поле верхнего уровня, привязанное к `type`.
// Полный перебор «поле × все 26 типов» избыточен — важно лишь то, что поле
// гаснет хоть у одного типа, которому оно не назначено; сравнивать `field` по
// ссылке (не по `key`), потому что несколько разных полей делят один ключ
// (`cipher` у ss/ssr и у vmess, `network` у транспорта/masque/zerotier) — по
// строке совпало бы соседнее поле и мутация осталась бы незамеченной.
describe('протокольные поля скрыты у типа снаружи их when', () => {
  const guardedByType = PROXY_FIELDS.flatMap((field) => {
    if (field.when === undefined || field.when.key !== 'type' || field.when.in === undefined) return []
    return [{ field, values: field.when.in }]
  })
  const allTypes = PROXY_TYPE_VALUES.map((e) => e.value)

  it('нашлось хотя бы одно протокольное поле', () => {
    expect(guardedByType.length).toBeGreaterThan(0)
  })

  for (const { field, values } of guardedByType) {
    const outside = allTypes.find((t) => !values.includes(t))
    if (outside === undefined) continue
    it(`${field.key} (when type∈[${values.join(',')}]): виден у своего типа, скрыт при type=${outside}`, () => {
      expect(visibleFields(PROXY_FIELDS, { type: values[0] }).includes(field)).toBe(true)
      expect(visibleFields(PROXY_FIELDS, { type: outside }).includes(field)).toBe(false)
    })
  }
})

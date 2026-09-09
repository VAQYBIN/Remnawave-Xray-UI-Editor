import { describe, expect, it } from 'vitest'
import { ENDPOINT_FIELDS, ENDPOINT_TYPE_VALUES } from '../src/entities/singbox/schema/endpoints'
import { OUTBOUND_FIELDS, OUTBOUND_TYPE_VALUES } from '../src/entities/singbox/schema/outbounds'
import { visibleFields } from '../src/shared/schema'

const keysFor = (type: string) => visibleFields(OUTBOUND_FIELDS, { type }).map((f) => f.key)

describe('схема выходов', () => {
  it('типы: живые без пометки, block/dns/wireguard устарели с заменой', () => {
    const values = OUTBOUND_TYPE_VALUES.map((e) => e.value)
    expect(values).toEqual(expect.arrayContaining([
      'direct', 'selector', 'urltest', 'vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'hysteria',
      'tuic', 'anytls', 'shadowtls', 'ssh', 'tor', 'socks', 'http', 'naive', 'snell', 'bridge', 'block', 'dns', 'wireguard',
    ]))
    for (const t of ['block', 'dns', 'wireguard']) {
      const e = OUTBOUND_TYPE_VALUES.find((v) => v.value === t)!
      expect(e.deprecated?.since, t).toBeDefined()
      expect(e.deprecated?.replacement, t).not.toBe('')
    }
    expect(OUTBOUND_TYPE_VALUES.find((v) => v.value === 'block')?.deprecated?.replacement).toMatch(/reject/)
    expect(OUTBOUND_TYPE_VALUES.find((v) => v.value === 'dns')?.deprecated?.replacement).toMatch(/hijack-dns/)
    expect(OUTBOUND_TYPE_VALUES.find((v) => v.value === 'wireguard')?.deprecated?.replacement).toMatch(/endpoints/)
  })

  it('vless: uuid, flow, tls, transport, multiplex и dial-поля; серверных ключей у группы нет', () => {
    const vless = keysFor('vless')
    expect(vless).toEqual(expect.arrayContaining(['server', 'server_port', 'uuid', 'flow', 'packet_encoding', 'network', 'tls', 'transport', 'multiplex', 'detour', 'domain_resolver']))
    expect(vless).not.toContain('outbounds')
    const sel = keysFor('selector')
    expect(sel).toEqual(expect.arrayContaining(['outbounds', 'default', 'interrupt_exist_connections', 'remnawave']))
    expect(sel).not.toContain('server')
    expect(sel).not.toContain('detour')
  })

  it('urltest: url, interval, tolerance, idle_timeout', () => {
    expect(keysFor('urltest')).toEqual(expect.arrayContaining(['outbounds', 'url', 'interval', 'tolerance', 'idle_timeout', 'interrupt_exist_connections']))
  })

  it('shadowsocks: method из полного списка, plugin, udp_over_tcp; hysteria2: obfs объектом, hysteria: obfs строкой', () => {
    const ss = visibleFields(OUTBOUND_FIELDS, { type: 'shadowsocks' })
    expect(ss.find((f) => f.key === 'method')?.enum?.map((e) => e.value)).toContain('2022-blake3-aes-128-gcm')
    expect(ss.map((f) => f.key)).toEqual(expect.arrayContaining(['password', 'plugin', 'plugin_opts', 'udp_over_tcp', 'multiplex']))
    expect(visibleFields(OUTBOUND_FIELDS, { type: 'hysteria2' }).find((f) => f.key === 'obfs')?.kind).toBe('object')
    expect(visibleFields(OUTBOUND_FIELDS, { type: 'hysteria' }).find((f) => f.key === 'obfs')?.kind).toBe('string')
    expect(keysFor('hysteria2')).toEqual(expect.arrayContaining(['up_mbps', 'down_mbps', 'password', 'server_ports', 'hop_interval', 'tls']))
  })

  it('у каждого типа ключи в видимом наборе не повторяются', () => {
    for (const { value } of OUTBOUND_TYPE_VALUES) {
      const keys = keysFor(value)
      expect(new Set(keys).size, value).toBe(keys.length)
    }
  })

  it('remnawave — ключ панели с includeProxies внутри', () => {
    const panel = OUTBOUND_FIELDS.find((f) => f.key === 'remnawave')!
    expect(panel.panelKey).toBe(true)
    expect(panel.fields?.map((f) => f.key)).toEqual(['includeProxies'])
  })

  it('у всех полей непустое русское описание', () => {
    const walk = (fields: typeof OUTBOUND_FIELDS): void => {
      for (const f of fields) {
        expect(f.doc.trim(), f.key).not.toBe('')
        if (f.fields) walk(f.fields)
        if (f.item?.fields) walk(f.item.fields)
      }
    }
    walk(OUTBOUND_FIELDS)
    walk(ENDPOINT_FIELDS)
  })
})

describe('схема конечных точек', () => {
  it('wireguard: адреса, ключ, пиры списком объектов', () => {
    expect(ENDPOINT_TYPE_VALUES.map((e) => e.value)).toEqual(expect.arrayContaining(['wireguard', 'tailscale']))
    const wg = visibleFields(ENDPOINT_FIELDS, { type: 'wireguard' })
    expect(wg.map((f) => f.key)).toEqual(expect.arrayContaining(['system', 'name', 'mtu', 'address', 'private_key', 'listen_port', 'peers', 'workers', 'detour']))
    const peers = wg.find((f) => f.key === 'peers')!
    expect(peers.item?.kind).toBe('object')
    expect(peers.item?.fields?.map((f) => f.key)).toEqual(['address', 'port', 'public_key', 'pre_shared_key', 'allowed_ips', 'persistent_keepalive_interval', 'reserved'])
  })

  it('tailscale: auth_key, exit_node и прочее; полей wireguard нет', () => {
    const ts = visibleFields(ENDPOINT_FIELDS, { type: 'tailscale' }).map((f) => f.key)
    expect(ts).toEqual(expect.arrayContaining(['state_directory', 'auth_key', 'control_url', 'ephemeral', 'hostname', 'accept_routes', 'exit_node', 'exit_node_allow_lan_access', 'advertise_routes', 'advertise_exit_node', 'udp_timeout']))
    expect(ts).not.toContain('peers')
  })
})

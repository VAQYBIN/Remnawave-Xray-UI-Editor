import { describe, expect, it } from 'vitest'
import { MuxSchema, OutboundSchema } from '../src/entities/xray'

describe('OutboundSchema — типизированные settings', () => {
  it('vless: vnext с users парсится', () => {
    const parsed = OutboundSchema.parse({
      tag: 'chain',
      protocol: 'vless',
      settings: {
        vnext: [
          { address: 'node2.example.com', port: 443, users: [{ id: 'uuid', flow: 'xtls-rprx-vision', encryption: 'none' }] },
        ],
      },
    })
    const settings = parsed.settings as { vnext: Array<{ address: string }> }
    expect(settings.vnext[0].address).toBe('node2.example.com')
  })

  it('vless: vnext не-массивом — ошибка с путём settings.vnext', () => {
    const res = OutboundSchema.safeParse({ tag: 'chain', protocol: 'vless', settings: { vnext: 'nope' } })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('settings.vnext')
    }
  })

  it('wireguard: peers, reserved, keepAlive', () => {
    const parsed = OutboundSchema.parse({
      tag: 'warp',
      protocol: 'wireguard',
      settings: {
        secretKey: 'KEY',
        address: ['172.16.0.2/32'],
        mtu: 1280,
        reserved: [1, 2, 3],
        peers: [
          {
            publicKey: 'PUB',
            endpoint: 'engage.cloudflareclient.com:2408',
            allowedIPs: ['0.0.0.0/0', '::/0'],
            preSharedKey: 'PSK',
            keepAlive: 25,
          },
        ],
      },
    })
    const settings = parsed.settings as { reserved: number[]; peers: Array<{ keepAlive: number }> }
    expect(settings.reserved).toEqual([1, 2, 3])
    expect(settings.peers[0].keepAlive).toBe(25)
  })

  it('freedom: redirect и fragment', () => {
    const parsed = OutboundSchema.parse({
      tag: 'direct',
      protocol: 'freedom',
      settings: {
        domainStrategy: 'UseIP',
        redirect: '127.0.0.1:3366',
        fragment: { packets: 'tlshello', length: '100-200', interval: '10-20' },
      },
    })
    const settings = parsed.settings as { fragment: { packets: string } }
    expect(settings.fragment.packets).toBe('tlshello')
  })

  it('blackhole: response.type', () => {
    const parsed = OutboundSchema.parse({
      tag: 'block',
      protocol: 'blackhole',
      settings: { response: { type: 'http' } },
    })
    const settings = parsed.settings as { response: { type: string } }
    expect(settings.response.type).toBe('http')
  })

  it('socks: servers с users', () => {
    const parsed = OutboundSchema.parse({
      tag: 'socks-out',
      protocol: 'socks',
      settings: { servers: [{ address: '127.0.0.1', port: 1080, users: [{ user: 'u', pass: 'p' }] }] },
    })
    const settings = parsed.settings as { servers: Array<{ port: number }> }
    expect(settings.servers[0].port).toBe(1080)
  })

  it('неизвестный протокол — settings не проверяются (passthrough)', () => {
    const res = OutboundSchema.safeParse({ tag: 'x', protocol: 'vmess', settings: { anything: [1, 2] } })
    expect(res.success).toBe(true)
  })
})

describe('MuxSchema', () => {
  it('парсит enabled/concurrency/xudp-поля', () => {
    const parsed = MuxSchema.parse({ enabled: true, concurrency: 8, xudpConcurrency: 16, xudpProxyUDP443: 'reject' })
    expect(parsed.concurrency).toBe(8)
  })

  it('mux внутри OutboundSchema типизирован', () => {
    const res = OutboundSchema.safeParse({ tag: 'x', protocol: 'vless', mux: { enabled: 'yes' } })
    expect(res.success).toBe(false)
  })

  it('vless: плоская форма settings парсится наравне с vnext', () => {
    const parsed = OutboundSchema.parse({
      tag: 'chain',
      protocol: 'vless',
      settings: { address: 'node2.example.com', port: 443, id: 'uuid', encryption: 'none', seed: 's' },
    })
    const settings = parsed.settings as { address: string; seed: string }
    expect(settings.address).toBe('node2.example.com')
    expect(settings.seed).toBe('s')
  })

  it('trojan: обе формы парсятся, servers не-массивом — ошибка с путём', () => {
    expect(() =>
      OutboundSchema.parse({ tag: 't', protocol: 'trojan', settings: { address: 'a.test', port: 443, password: 'p' } }),
    ).not.toThrow()
    expect(() =>
      OutboundSchema.parse({ tag: 't', protocol: 'trojan', settings: { servers: [{ address: 'a.test', port: 443, password: 'p' }] } }),
    ).not.toThrow()
    const res = OutboundSchema.safeParse({ tag: 't', protocol: 'trojan', settings: { servers: 'nope' } })
    expect(res.success).toBe(false)
    expect(res.error!.issues[0]!.path).toEqual(['settings', 'servers'])
  })
})

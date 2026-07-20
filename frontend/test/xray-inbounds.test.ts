import { describe, expect, it } from 'vitest'
import { InboundSchema } from '../src/entities/xray/inbounds'

const vlessRealityInbound = {
  tag: 'vless-in',
  port: 443,
  listen: '0.0.0.0',
  protocol: 'vless',
  settings: {
    clients: [],
    decryption: 'none',
  },
  streamSettings: {
    network: 'tcp',
    security: 'reality',
    realitySettings: {
      show: false,
      dest: 'example.com:443',
      serverNames: ['example.com'],
      privateKey: 'KEY',
      shortIds: ['0123abcd'],
      customField: 'сохранить как есть',
    },
  },
  sniffing: { enabled: true, destOverride: ['http', 'tls'] },
  unknownTopLevel: { keep: true },
}

describe('InboundSchema', () => {
  it('парсит VLESS+Reality inbound и сохраняет неизвестные поля (passthrough round-trip)', () => {
    const parsed = InboundSchema.parse(vlessRealityInbound)
    expect(parsed).toEqual(vlessRealityInbound)
  })

  it('отклоняет inbound без tag', () => {
    const { tag: _omit, ...rest } = vlessRealityInbound
    expect(InboundSchema.safeParse(rest).success).toBe(false)
  })

  it('отклоняет нечисловой и нестроковый port', () => {
    expect(InboundSchema.safeParse({ ...vlessRealityInbound, port: { a: 1 } }).success).toBe(false)
  })

  it('парсит trojan и shadowsocks inbound', () => {
    const trojan = { tag: 't-in', port: 8443, protocol: 'trojan', settings: { clients: [] } }
    const ss = {
      tag: 'ss-in',
      port: 8388,
      protocol: 'shadowsocks',
      settings: { method: 'chacha20-ietf-poly1305', password: 'p' },
    }
    expect(InboundSchema.parse(trojan)).toEqual(trojan)
    expect(InboundSchema.parse(ss)).toEqual(ss)
  })

  it('незнакомый протокол проходит как passthrough', () => {
    const dokodemo = { tag: 'dok-in', port: 1234, protocol: 'dokodemo-door', settings: { address: '1.1.1.1' } }
    expect(InboundSchema.parse(dokodemo)).toEqual(dokodemo)
  })

  it('отклоняет некорректные settings для известных протоколов (superRefine)', () => {
    const badVless = InboundSchema.safeParse({
      tag: 'v-in', port: 1, protocol: 'vless',
      settings: { decryption: 123 },
    })
    expect(badVless.success).toBe(false)
    if (!badVless.success) {
      expect(badVless.error.issues.some((i) => i.path.join('.') === 'settings.decryption')).toBe(true)
    }

    const badTrojan = InboundSchema.safeParse({
      tag: 't-in', port: 2, protocol: 'trojan',
      settings: { clients: 'nope' },
    })
    expect(badTrojan.success).toBe(false)
    if (!badTrojan.success) {
      expect(badTrojan.error.issues.some((i) => i.path[0] === 'settings' && i.path[1] === 'clients')).toBe(true)
    }

    const badSs = InboundSchema.safeParse({
      tag: 's-in', port: 3, protocol: 'shadowsocks',
      settings: { method: 123 },
    })
    expect(badSs.success).toBe(false)
  })
})

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
    if (!badSs.success) {
      expect(badSs.error.issues.some((i) => i.path.join('.') === 'settings.method')).toBe(true)
    }
  })
})

describe('fallbacks', () => {
  it('vless-inbound с типизированными fallbacks парсится', () => {
    const parsed = InboundSchema.parse({
      tag: 'vless-in',
      protocol: 'vless',
      settings: {
        clients: [],
        decryption: 'none',
        fallbacks: [
          { dest: 9443, xver: 1 },
          { alpn: 'h2', dest: '/dev/shm/h2.sock', path: '/ws' },
        ],
      },
    })
    const settings = parsed.settings as { fallbacks: Array<{ dest?: string | number; xver?: number }> }
    expect(settings.fallbacks[0].dest).toBe(9443)
    expect(settings.fallbacks[1].dest).toBe('/dev/shm/h2.sock')
  })

  it('битый fallback (xver строкой) — ошибка с путём settings.fallbacks', () => {
    const res = InboundSchema.safeParse({
      tag: 'vless-in',
      protocol: 'vless',
      settings: { fallbacks: [{ dest: 80, xver: 'one' }] },
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('settings.fallbacks.0.xver')
    }
  })
})

describe('hysteria inbound', () => {
  it('парсит settings hysteria (version 2, clients)', () => {
    const parsed = InboundSchema.parse({
      tag: 'hy2-in',
      protocol: 'hysteria',
      port: 443,
      settings: { version: 2, clients: [{ auth: 'pass', email: 'user' }] },
    })
    const settings = parsed.settings as { version: number }
    expect(settings.version).toBe(2)
  })

  it('clients не-массивом — ошибка с путём settings.clients', () => {
    const res = InboundSchema.safeParse({
      tag: 'hy2-in',
      protocol: 'hysteria',
      settings: { version: 2, clients: 'nope' },
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].path.join('.')).toBe('settings.clients')
    }
  })
})

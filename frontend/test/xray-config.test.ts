import { describe, expect, it } from 'vitest'
import { validateXrayConfig, XrayConfigSchema } from '../src/entities/xray'

const fullConfig = {
  log: { loglevel: 'warning' },
  inbounds: [
    {
      tag: 'vless-in',
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: { network: 'tcp', security: 'reality', realitySettings: { dest: 'x.com:443' } },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom', settings: {} },
    { tag: 'block', protocol: 'blackhole', settings: {} },
    {
      tag: 'warp-out',
      protocol: 'wireguard',
      settings: { secretKey: 'KEY', address: ['172.16.0.2/32'], peers: [{ publicKey: 'PK', endpoint: 'e:2408' }] },
    },
  ],
  routing: {
    rules: [
      { type: 'field', inboundTag: ['vless-in'], domain: ['geosite:openai'], outboundTag: 'warp-out' },
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
    ],
  },
  dns: { servers: ['1.1.1.1', { address: '8.8.8.8', unknownOpt: true }] },
  policy: { levels: { '0': { handshake: 4 } } },
  unknownSection: { anything: [1, 2, 3] },
}

describe('XrayConfigSchema', () => {
  it('passthrough round-trip: parse возвращает deep-equal объект', () => {
    expect(XrayConfigSchema.parse(fullConfig)).toEqual(fullConfig)
  })
})

describe('validateXrayConfig', () => {
  it('валидный конфиг — ok без ошибок', () => {
    const res = validateXrayConfig(JSON.stringify(fullConfig))
    expect(res.ok).toBe(true)
    expect(res.issues.filter((i) => i.level === 'error')).toHaveLength(0)
    expect(res.config).toEqual(fullConfig)
  })

  it('битый JSON — ошибка на русском', () => {
    const res = validateXrayConfig('{ "inbounds": [ }')
    expect(res.ok).toBe(false)
    expect(res.issues[0]!.level).toBe('error')
    expect(res.issues[0]!.message).toMatch(/Некорректный JSON/)
  })

  it('inbound без tag — ошибка схемы с путём', () => {
    const bad = { ...fullConfig, inbounds: [{ port: 1, protocol: 'vless' }] }
    const res = validateXrayConfig(JSON.stringify(bad))
    expect(res.ok).toBe(false)
    expect(res.issues.some((i) => i.path.startsWith('inbounds.0') && i.level === 'error')).toBe(true)
  })

  it('дубликат тега и висячая ссылка правила — предупреждения', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 1, protocol: 'vless' },
        { tag: 'a', port: 2, protocol: 'trojan' },
      ],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', outboundTag: 'missing-out' }] },
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.ok).toBe(true) // warnings не блокируют
    const w = res.issues.filter((i) => i.level === 'warning')
    expect(w.some((i) => i.message.includes('Дубликат тега'))).toBe(true)
    expect(w.some((i) => i.message.includes('missing-out'))).toBe(true)
  })

  it('дубликат outbound-тега и висячий inboundTag — предупреждения', () => {
    const cfg = {
      inbounds: [{ tag: 'a', port: 1, protocol: 'vless' }],
      outbounds: [
        { tag: 'direct', protocol: 'freedom' },
        { tag: 'direct', protocol: 'blackhole' },
      ],
      routing: { rules: [{ type: 'field', inboundTag: ['missing-in'], outboundTag: 'direct' }] },
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    const w = res.issues.filter((i) => i.level === 'warning')
    expect(w.some((i) => i.message.includes('Дубликат тега outbound «direct»'))).toBe(true)
    expect(w.some((i) => i.message.includes('missing-in'))).toBe(true)
  })

  it('повторяющийся порт inbound — предупреждение', () => {
    const cfg = {
      inbounds: [
        { tag: 'a', port: 443, protocol: 'vless' },
        { tag: 'b', port: 443, protocol: 'trojan' },
      ],
      outbounds: [],
    }
    const res = validateXrayConfig(JSON.stringify(cfg))
    expect(res.issues.some((i) => i.level === 'warning' && i.message.includes('443'))).toBe(true)
  })
})

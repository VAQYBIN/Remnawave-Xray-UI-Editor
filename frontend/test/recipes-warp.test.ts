import { describe, expect, it } from 'vitest'
import { WARP_DEFAULTS, WARP_SERVICES, planWarp, validateWarp } from '../src/entities/xray/recipes/warp'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

const PARAMS = {
  ...WARP_DEFAULTS,
  secretKey: 'aBcD',
  services: ['geosite:openai', 'geosite:google'],
}

describe('planWarp', () => {
  it('добавляет wireguard-outbound и одно правило со всеми категориями', () => {
    const plan = planWarp(BASE, PARAMS)
    const warp = plan.config.outbounds!.find((o) => o.tag === 'warp')!
    expect(warp.protocol).toBe('wireguard')
    expect((warp.settings as { secretKey: string }).secretKey).toBe('aBcD')
    expect(plan.config.routing!.rules).toHaveLength(1)
    expect(plan.config.routing!.rules![0]).toEqual({
      domain: ['geosite:openai', 'geosite:google'],
      outboundTag: 'warp',
    })
    expect(plan.notes.some((n) => n.needsGeo === true)).toBe(true)
  })

  it('свои домены добавляются к категориям', () => {
    const plan = planWarp(BASE, { ...PARAMS, domains: ['example.com'] })
    expect(plan.config.routing!.rules![0]!.domain).toEqual([
      'geosite:openai',
      'geosite:google',
      'example.com',
    ])
  })

  it('повторное применение ничего не добавляет', () => {
    const once = planWarp(BASE, PARAMS)
    const twice = planWarp(once.config, PARAMS)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
  })

  it('адреса, reserved и mtu попадают в настройки', () => {
    const plan = planWarp(BASE, {
      ...PARAMS,
      addresses: ['172.16.0.2/32', '2606:4700:110::1/128'],
      reserved: [1, 2, 3],
      mtu: 1280,
    })
    const settings = plan.config.outbounds!.find((o) => o.tag === 'warp')!.settings as {
      address: string[]
      reserved: number[]
      mtu: number
      peers: { publicKey: string; endpoint: string }[]
    }
    expect(settings.address).toEqual(['172.16.0.2/32', '2606:4700:110::1/128'])
    expect(settings.reserved).toEqual([1, 2, 3])
    expect(settings.mtu).toBe(1280)
    expect(settings.peers[0]!.endpoint).toBe('engage.cloudflareclient.com:2408')
  })
})

describe('validateWarp', () => {
  it('без ключа и без целей — ошибки, с ними — null', () => {
    expect(validateWarp({ ...PARAMS, secretKey: '' })).toMatch(/ключ/i)
    expect(validateWarp({ ...PARAMS, services: [], domains: [] })).toMatch(/сервис|домен/i)
    expect(validateWarp({ ...PARAMS, tag: ' ' })).toMatch(/тег/i)
    expect(validateWarp(PARAMS)).toBeNull()
  })
})

describe('WARP_SERVICES', () => {
  it('коды категорий идут с префиксом geosite:', () => {
    expect(WARP_SERVICES.length).toBeGreaterThanOrEqual(10)
    expect(WARP_SERVICES.every((s) => s.value.startsWith('geosite:'))).toBe(true)
  })
})

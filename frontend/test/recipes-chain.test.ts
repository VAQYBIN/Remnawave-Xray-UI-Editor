import { describe, expect, it } from 'vitest'
import { CHAIN_DEFAULTS, planChain, validateChain } from '../src/entities/xray/recipes/chain'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

const VLESS = {
  ...CHAIN_DEFAULTS,
  address: '203.0.113.10',
  port: 443,
  uuid: '7d4e0c1c-1c2b-4f5a-9a1e-1f2b3c4d5e6f',
}

describe('planChain', () => {
  it('vless: vnext с пользователем, TLS с serverName по адресу', () => {
    const plan = planChain(BASE, { ...VLESS, tls: true })
    const out = plan.config.outbounds!.find((o) => o.tag === 'chain')!
    expect(out.protocol).toBe('vless')
    expect(out.settings).toEqual({
      vnext: [
        {
          address: '203.0.113.10',
          port: 443,
          users: [{ id: VLESS.uuid, encryption: 'none' }],
        },
      ],
    })
    expect(out.streamSettings).toEqual({
      network: 'tcp',
      security: 'tls',
      tlsSettings: { serverName: '203.0.113.10' },
    })
  })

  it('trojan: servers с паролем, без TLS security остаётся none', () => {
    const plan = planChain(BASE, {
      ...CHAIN_DEFAULTS,
      protocol: 'trojan',
      address: 'node2.example.com',
      port: 8443,
      password: 'secret',
      tls: false,
    })
    const out = plan.config.outbounds!.find((o) => o.tag === 'chain')!
    expect(out.settings).toEqual({
      servers: [{ address: 'node2.example.com', port: 8443, password: 'secret' }],
    })
    expect(out.streamSettings).toEqual({ network: 'tcp', security: 'none' })
  })

  it('пустой список доменов даёт правило без условий — весь трафик', () => {
    const plan = planChain(BASE, VLESS)
    expect(plan.config.routing!.rules![0]).toEqual({ outboundTag: 'chain' })
    expect(plan.changes.some((c) => c.text.includes('весь трафик'))).toBe(true)
  })

  it('dialerProxy уходит в sockopt', () => {
    const plan = planChain(BASE, { ...VLESS, dialerProxy: 'direct' })
    const out = plan.config.outbounds!.find((o) => o.tag === 'chain')!
    expect((out.streamSettings as { sockopt: { dialerProxy: string } }).sockopt).toEqual({
      dialerProxy: 'direct',
    })
  })

  it('повторное применение ничего не добавляет', () => {
    const once = planChain(BASE, VLESS)
    const twice = planChain(once.config, VLESS)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
  })
})

describe('validateChain', () => {
  it('ловит пустой адрес, плохой порт, кривой UUID, пустой пароль и петлю dialerProxy', () => {
    expect(validateChain({ ...VLESS, address: '' })).toMatch(/адрес/i)
    expect(validateChain({ ...VLESS, port: 0 })).toMatch(/порт/i)
    expect(validateChain({ ...VLESS, uuid: 'нет' })).toMatch(/uuid/i)
    expect(validateChain({ ...CHAIN_DEFAULTS, protocol: 'trojan', address: 'a.b', port: 443 })).toMatch(
      /пароль/i,
    )
    expect(validateChain({ ...VLESS, dialerProxy: 'chain' })).toMatch(/себя|сам/i)
    expect(validateChain(VLESS)).toBeNull()
  })
})

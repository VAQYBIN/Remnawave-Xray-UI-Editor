import { describe, expect, it } from 'vitest'
import { applyConnection, isValidConnection } from '../src/features/topology/TopologyView'
import type { XrayConfig } from '../src/entities/xray'

const cfg = () =>
  ({
    outbounds: [
      { tag: 'proxy-de', protocol: 'vless' },
      { tag: 'direct', protocol: 'freedom' },
    ],
    routing: {
      rules: [{ outboundTag: 'direct' }],
      balancers: [{ tag: 'bal-eu', selector: [] }],
    },
  }) as XrayConfig

describe('коммутация балансеров', () => {
  it('правило можно подключить к балансеру, балансер — к выходу', () => {
    expect(isValidConnection({ source: 'rule:0', target: 'bal:bal-eu' })).toBe(true)
    expect(isValidConnection({ source: 'bal:bal-eu', target: 'out:proxy-de' })).toBe(true)
  })

  it('запрещённые пары остаются запрещёнными', () => {
    expect(isValidConnection({ source: 'in:in', target: 'bal:bal-eu' })).toBe(false)
    expect(isValidConnection({ source: 'bal:bal-eu', target: 'rule:0' })).toBe(false)
    expect(isValidConnection({ source: 'obs', target: 'bal:bal-eu' })).toBe(false)
  })

  it('кабель правило → балансер снимает outboundTag', () => {
    const next = applyConnection(cfg(), { source: 'rule:0', target: 'bal:bal-eu' })
    expect(next.routing!.rules![0]).toEqual({ balancerTag: 'bal-eu' })
  })

  it('кабель балансер → выход дописывает точный тег в selector', () => {
    const next = applyConnection(cfg(), { source: 'bal:bal-eu', target: 'out:proxy-de' })
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy-de'])
  })
})

import { describe, expect, it } from 'vitest'
import { searchNodes } from '../src/entities/graph/search'
import type { GraphContext } from '../src/entities/graph/types'
import type { XrayConfig } from '../src/entities/xray'

const CONFIG = {
  inbounds: [
    { tag: 'VLESS-Reality', protocol: 'vless', port: 443 },
    { tag: 'trojan-in', protocol: 'trojan', port: 8443 },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'warp', protocol: 'wireguard' },
  ],
  routing: {
    rules: [
      { type: 'field', domain: ['geosite:google'], outboundTag: 'warp' },
      { type: 'field', ip: ['8.8.8.8'], outboundTag: 'direct' },
    ],
  },
} as unknown as XrayConfig

const CTX: GraphContext = { squads: [{ uuid: 'u1', name: 'Основной сквад' }], inboundSquads: {} }

describe('searchNodes', () => {
  it('находит inbound по тегу без учёта регистра', () => {
    const hits = searchNodes(CONFIG, CTX, 'reality')
    expect(hits[0]).toMatchObject({ nodeId: 'in:VLESS-Reality', kind: 'inbound' })
  })

  it('находит по протоколу', () => {
    expect(searchNodes(CONFIG, CTX, 'wireguard').map((h) => h.nodeId)).toEqual(['out:warp'])
  })

  it('находит inbound по порту', () => {
    expect(searchNodes(CONFIG, CTX, '8443').map((h) => h.nodeId)).toEqual(['in:trojan-in'])
  })

  it('находит правило по домену и объясняет совпадение', () => {
    const hits = searchNodes(CONFIG, CTX, 'geosite:google')
    expect(hits[0]!.nodeId).toBe('rule:0')
    expect(hits[0]!.matchedOn).toMatch(/домен/i)
    expect(hits[0]!.title).toContain('1')
  })

  it('находит правило по IP', () => {
    expect(searchNodes(CONFIG, CTX, '8.8.8.8').map((h) => h.nodeId)).toEqual(['rule:1'])
  })

  it('находит сквад по имени', () => {
    expect(searchNodes(CONFIG, CTX, 'основной').map((h) => h.nodeId)).toEqual(['squad:u1'])
  })

  it('пустой запрос — пустой результат, а не весь конфиг', () => {
    expect(searchNodes(CONFIG, CTX, '   ')).toEqual([])
  })

  it('ничего не найдено — пустой список', () => {
    expect(searchNodes(CONFIG, CTX, 'нетакого')).toEqual([])
  })

  it('результатов не больше двадцати', () => {
    const many = {
      inbounds: Array.from({ length: 40 }, (_, i) => ({ tag: `in-${i}`, protocol: 'vless' })),
    } as unknown as XrayConfig
    expect(searchNodes(many, {}, 'in-')).toHaveLength(20)
  })
})

describe('поиск балансеров', () => {
  const CFG = {
    outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
    routing: {
      rules: [],
      balancers: [{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }],
    },
  } as XrayConfig

  it('находит балансер по тегу и по стратегии', () => {
    expect(searchNodes(CFG, {}, 'bal-eu')[0]).toMatchObject({ nodeId: 'bal:bal-eu', kind: 'balancer' })
    expect(searchNodes(CFG, {}, 'leastping')[0]).toMatchObject({ nodeId: 'bal:bal-eu' })
  })
})

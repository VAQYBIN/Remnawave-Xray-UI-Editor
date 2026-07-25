import { describe, expect, it } from 'vitest'
import {
  ensureOutbound,
  ensureRule,
  ensureSniffing,
  ruleOrdinal,
  sameRule,
} from '../src/entities/xray/recipes/apply'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [
    { tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } },
    { tag: 'ss-in', port: 8388, protocol: 'shadowsocks', settings: {} },
  ],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

describe('ensureOutbound', () => {
  it('добавляет новый outbound и не трогает исходный конфиг', () => {
    const res = ensureOutbound(BASE, { tag: 'block', protocol: 'blackhole', settings: {} })
    expect(res.status).toBe('add')
    expect(res.config.outbounds).toHaveLength(2)
    expect(BASE.outbounds).toHaveLength(1)
  })

  it('занятый тег переиспользуется без правки настроек', () => {
    const config = {
      ...BASE,
      outbounds: [{ tag: 'block', protocol: 'blackhole', settings: { response: { type: 'http' } } }],
    } as XrayConfig
    const res = ensureOutbound(config, { tag: 'block', protocol: 'blackhole', settings: {} })
    expect(res.status).toBe('exists')
    expect(res.config).toBe(config)
    expect(res.config.outbounds![0]!.settings).toEqual({ response: { type: 'http' } })
  })
})

describe('sameRule', () => {
  it('порядок значений внутри domain не влияет на равенство', () => {
    expect(
      sameRule({ domain: ['a', 'b'], outboundTag: 'warp' }, { domain: ['b', 'a'], outboundTag: 'warp' }),
    ).toBe(true)
  })

  it('разный outboundTag или лишнее поле — разные правила', () => {
    expect(sameRule({ domain: ['a'], outboundTag: 'warp' }, { domain: ['a'], outboundTag: 'direct' })).toBe(false)
    expect(sameRule({ domain: ['a'] }, { domain: ['a'], network: 'tcp' })).toBe(false)
  })
})

describe('ensureRule', () => {
  it('блокирующее правило встаёт первым, маршрутное — за серией блокировок', () => {
    const withBlock = {
      ...BASE,
      outbounds: [
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'block', protocol: 'blackhole', settings: {} },
      ],
      routing: { rules: [{ protocol: ['bittorrent'], outboundTag: 'block' }, { domain: ['x'], outboundTag: 'direct' }] },
    } as XrayConfig

    const blocked = ensureRule(withBlock, { ip: ['geoip:private'], outboundTag: 'block' }, 'block')
    expect(blocked.index).toBe(0)

    const routed = ensureRule(withBlock, { domain: ['geosite:openai'], outboundTag: 'warp' }, 'route')
    expect(routed.index).toBe(1)
    expect(routed.config.routing!.rules![1]!.outboundTag).toBe('warp')
  })

  it('эквивалентное правило не дублируется', () => {
    const config = {
      ...BASE,
      routing: { rules: [{ domain: ['b', 'a'], outboundTag: 'warp' }] },
    } as XrayConfig
    const res = ensureRule(config, { domain: ['a', 'b'], outboundTag: 'warp' }, 'route')
    expect(res.status).toBe('exists')
    expect(res.index).toBe(0)
    expect(res.config.routing!.rules).toHaveLength(1)
  })
})

describe('ensureSniffing', () => {
  it('включает sniffing и заполняет пустой destOverride, уже включённый не трогает', () => {
    const config = {
      ...BASE,
      inbounds: [
        { tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } },
        {
          tag: 'ss-in',
          port: 8388,
          protocol: 'shadowsocks',
          settings: {},
          sniffing: { enabled: true, destOverride: ['tls'] },
        },
      ],
    } as XrayConfig
    const res = ensureSniffing(config, ['vless-in', 'ss-in'])
    expect(res.changed).toEqual(['vless-in'])
    expect(res.config.inbounds![0]!.sniffing).toEqual({
      enabled: true,
      destOverride: ['http', 'tls', 'quic'],
    })
    expect(res.config.inbounds![1]!.sniffing).toEqual({ enabled: true, destOverride: ['tls'] })
  })

  it('пустой список тегов означает «все inbound’ы»', () => {
    const res = ensureSniffing(BASE, [])
    expect(res.changed).toEqual(['vless-in', 'ss-in'])
  })
})

describe('ruleOrdinal', () => {
  it('первые позиции словами, дальше — числом', () => {
    expect(ruleOrdinal(0)).toBe('первым')
    expect(ruleOrdinal(2)).toBe('третьим')
    expect(ruleOrdinal(7)).toBe('на позиции 8')
  })
})

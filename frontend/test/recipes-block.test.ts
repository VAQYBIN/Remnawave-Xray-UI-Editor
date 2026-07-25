import { describe, expect, it } from 'vitest'
import {
  BLOCK_DEFAULTS,
  TORRENT_DEFAULTS,
  planAds,
  planPrivate,
  planTorrent,
  validateBlock,
} from '../src/entities/xray/recipes/block'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

describe('planTorrent', () => {
  it('добавляет blackhole, правило bittorrent и включает sniffing', () => {
    const plan = planTorrent(BASE, TORRENT_DEFAULTS)
    expect(plan.config.outbounds).toContainEqual({ tag: 'block', protocol: 'blackhole', settings: {} })
    expect(plan.config.routing!.rules![0]).toEqual({ protocol: ['bittorrent'], outboundTag: 'block' })
    expect(plan.config.inbounds![0]!.sniffing!.enabled).toBe(true)
    expect(plan.changes.filter((c) => c.status === 'add')).toHaveLength(3)
    expect(plan.changes.some((c) => c.text.includes('sniffing'))).toBe(true)
  })

  it('повторное применение ничего не добавляет', () => {
    const once = planTorrent(BASE, TORRENT_DEFAULTS)
    const twice = planTorrent(once.config, TORRENT_DEFAULTS)
    expect(twice.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(twice.config.routing!.rules).toHaveLength(1)
  })

  it('inboundTags сужает список: чужой inbound не трогается', () => {
    const two = {
      ...BASE,
      inbounds: [
        { tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } },
        { tag: 'ss-in', port: 8388, protocol: 'shadowsocks', settings: {} },
      ],
    } as XrayConfig
    const plan = planTorrent(two, { ...TORRENT_DEFAULTS, inboundTags: ['ss-in'] })
    expect(plan.config.inbounds![0]!.sniffing).toBeUndefined()
    expect(plan.config.inbounds![1]!.sniffing!.enabled).toBe(true)
  })
})

describe('planAds и planPrivate', () => {
  it('реклама даёт одно правило по geosite и замечание про geo-базы', () => {
    const plan = planAds(BASE, BLOCK_DEFAULTS)
    expect(plan.config.routing!.rules![0]).toEqual({
      domain: ['geosite:category-ads-all'],
      outboundTag: 'block',
    })
    expect(plan.notes.some((n) => n.needsGeo === true)).toBe(true)
  })

  it('локальные сети дают два правила — по ip и по domain', () => {
    const plan = planPrivate(BASE, BLOCK_DEFAULTS)
    const rules = plan.config.routing!.rules!
    expect(rules).toHaveLength(2)
    expect(rules.some((r) => r.ip?.[0] === 'geoip:private')).toBe(true)
    expect(rules.some((r) => r.domain?.[0] === 'geosite:private')).toBe(true)
  })

  it('чужой тег блокировки уважается и переиспользуется', () => {
    const custom = {
      ...BASE,
      outbounds: [
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'drop', protocol: 'blackhole', settings: { response: { type: 'http' } } },
      ],
    } as XrayConfig
    const plan = planAds(custom, { blockTag: 'drop' })
    expect(plan.config.outbounds).toHaveLength(2)
    expect(plan.config.outbounds![1]!.settings).toEqual({ response: { type: 'http' } })
    expect(plan.config.routing!.rules![0]!.outboundTag).toBe('drop')
  })
})

describe('validateBlock', () => {
  it('пустой тег — ошибка, обычный — нет', () => {
    expect(validateBlock({ blockTag: '  ' })).toMatch(/тег/i)
    expect(validateBlock({ blockTag: 'block' })).toBeNull()
  })
})

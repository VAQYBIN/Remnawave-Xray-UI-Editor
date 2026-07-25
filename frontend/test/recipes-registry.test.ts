import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, RECIPES, planFor, validateFor } from '../src/entities/xray/recipes'
import type { XrayConfig } from '../src/entities/xray'

const BASE: XrayConfig = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

describe('реестр рецептов', () => {
  it('содержит пять рецептов с непустыми заголовками и описаниями', () => {
    expect(RECIPES.map((r) => r.id)).toEqual(['warp', 'torrent', 'ads', 'private', 'chain'])
    expect(RECIPES.every((r) => r.title.length > 0 && r.summary.length > 0)).toBe(true)
  })

  it('planFor разводит рецепты по id', () => {
    expect(planFor(BASE, 'ads', DEFAULT_PARAMS).config.routing!.rules![0]!.domain).toEqual([
      'geosite:category-ads-all',
    ])
    expect(planFor(BASE, 'torrent', DEFAULT_PARAMS).config.routing!.rules![0]!.protocol).toEqual([
      'bittorrent',
    ])
  })

  it('validateFor возвращает ошибку рецепта или null', () => {
    expect(validateFor('ads', DEFAULT_PARAMS)).toBeNull()
    // У WARP по умолчанию нет ключа
    expect(validateFor('warp', DEFAULT_PARAMS)).toMatch(/ключ/i)
    expect(
      validateFor('warp', {
        ...DEFAULT_PARAMS,
        warp: { ...DEFAULT_PARAMS.warp, secretKey: 'k' },
      }),
    ).toBeNull()
  })

  it('рецепты складываются: блокировка остаётся выше маршрута', () => {
    const withWarp = planFor(BASE, 'warp', {
      ...DEFAULT_PARAMS,
      warp: { ...DEFAULT_PARAMS.warp, secretKey: 'k' },
    }).config
    const withBoth = planFor(withWarp, 'ads', DEFAULT_PARAMS).config
    const rules = withBoth.routing!.rules!
    expect(rules[0]!.domain).toEqual(['geosite:category-ads-all'])
    expect(rules[1]!.outboundTag).toBe('warp')
  })
})

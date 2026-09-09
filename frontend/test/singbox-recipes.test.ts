import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { RULE_SET_CATALOG } from '../src/entities/singbox/recipes/catalog'
import { SINGBOX_RECIPES } from '../src/entities/singbox/recipes'
import { planAds, planDns, planLocal, planPrivate, planSplit, planWarp } from '../src/entities/singbox/recipes'
import { validateSingbox } from '../src/entities/singbox/validate'

const BASE = parseSingbox('{"outbounds":[{"type":"selector","tag":"sel","outbounds":null},{"type":"direct","tag":"direct"}],"route":{"rules":[{"action":"sniff"}],"final":"sel"}}').doc!

describe('каталог источников', () => {
  it('ссылки только meta-rules-dat ветки sing, теги уникальны', () => {
    for (const s of RULE_SET_CATALOG) expect(s.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/MetaCubeX\/meta-rules-dat\/sing\/geo\/(geosite|geoip)\/[a-z0-9-]+\.srs$/)
    expect(new Set(RULE_SET_CATALOG.map((s) => s.tag)).size).toBe(RULE_SET_CATALOG.length)
  })
})

describe('рецепты sing-box', () => {
  it('split заводит наборы, правило в конец и cache_file; повторно — ничего', () => {
    const p = { sets: ['geosite-youtube', 'geoip-telegram'], outbound: 'sel' }
    const first = planSplit(BASE, p)
    expect(first.model.route!.rule_set!.map((s) => s.tag)).toEqual(['geosite-youtube', 'geoip-telegram'])
    expect(first.model.route!.rules!.at(-1)).toEqual({ rule_set: ['geosite-youtube', 'geoip-telegram'], outbound: 'sel' })
    expect(first.model.experimental).toEqual({ cache_file: { enabled: true } })
    expect(first.changes.filter((c) => c.status === 'add').length).toBeGreaterThan(0)
    const second = planSplit(first.model, p)
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model).toEqual(first.model)
    expect(validateSingbox(first.model).filter((i) => i.level === 'error')).toEqual([])
  })

  it('ads ставит reject в начало и DNS-правило по запросу', () => {
    const plan = planAds(BASE, { alsoDns: true })
    expect(plan.model.route!.rules![0]).toEqual({ rule_set: ['geosite-category-ads-all'], action: 'reject' })
    expect(plan.model.dns!.rules![0]).toEqual({ rule_set: ['geosite-category-ads-all'], action: 'predefined', rcode: 'NXDOMAIN' })
  })

  it('dns заводит три сервера, правила, final, sniff/hijack первыми и резолвер', () => {
    const plan = planDns(BASE, { remote: '1.1.1.1', detour: 'sel' })
    const m = plan.model
    expect(m.dns!.servers!.map((s) => s.tag)).toEqual(['dns-remote', 'dns-local', 'dns-fakeip'])
    expect(m.dns!.final).toBe('dns-remote')
    expect(m.route!.rules!.slice(0, 2)).toEqual([{ action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }])
    expect(m.route!.default_domain_resolver).toEqual({ server: 'dns-local' })
    expect(m.experimental!.cache_file).toEqual({ enabled: true, store_fakeip: true })
    expect(planDns(m, { remote: '1.1.1.1', detour: 'sel' }).model).toEqual(m)
  })

  it('local, private и warp идемпотентны', () => {
    const a = planLocal(BASE, { kind: 'mixed', port: 2080, setSystemProxy: true })
    expect(a.model.inbounds).toEqual([{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080, set_system_proxy: true }])
    expect(planLocal(a.model, { kind: 'mixed', port: 2080, setSystemProxy: true }).changes[0]?.status).toBe('exists')
    const b = planPrivate(BASE, { outbound: 'direct' })
    expect(b.model.route!.rules![1]).toEqual({ ip_is_private: true, outbound: 'direct' })
    const c = planWarp(BASE, { tag: 'warp', privateKey: 'k', addresses: ['172.16.0.2/32'], reserved: [], mtu: 1280 })
    expect(c.model.endpoints![0]).toMatchObject({ type: 'wireguard', tag: 'warp', private_key: 'k', mtu: 1280 })
    expect(c.model.endpoints![0]!.peers).toHaveLength(1)
  })

  it('реестр содержит шесть рецептов с уникальными id', () => {
    expect(SINGBOX_RECIPES.map((r) => r.id)).toEqual(['split', 'ads', 'dns', 'local', 'private', 'warp'])
  })
})

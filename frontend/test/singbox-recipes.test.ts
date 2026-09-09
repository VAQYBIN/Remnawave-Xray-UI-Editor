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

  // sniff — правило, а не свойство inbound'а (как у Xray): reject первым
  // сработал бы ДО того, как sniff определит домен, и никогда бы не совпал
  it('ads ставит reject сразу за ведущей серией sniff/hijack-dns и DNS-правило по запросу', () => {
    const withLeading = parseSingbox(
      JSON.stringify({
        outbounds: [{ type: 'selector', tag: 'sel', outbounds: null }, { type: 'direct', tag: 'direct' }],
        route: {
          rules: [{ action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }, { domain: 'example.com', outbound: 'direct' }],
          final: 'sel',
        },
      }),
    ).doc!
    const plan = planAds(withLeading, { alsoDns: true })
    expect(plan.model.route!.rules![2]).toEqual({ rule_set: ['geosite-category-ads-all'], action: 'reject' })
    // Ведущей серии нет — sniff/hijack-dns не сработали как условие для reject
    expect(plan.model.route!.rules![0]).toEqual({ action: 'sniff' })
    expect(plan.model.dns!.rules![0]).toEqual({ rule_set: ['geosite-category-ads-all'], action: 'predefined', rcode: 'NXDOMAIN' })
  })

  it('ads без ведущей серии ставит reject первым и без alsoDns не трогает dns.rules', () => {
    const empty = parseSingbox('{"outbounds":[{"type":"direct","tag":"direct"}],"route":{"rules":[]}}').doc!
    const plan = planAds(empty, { alsoDns: false })
    expect(plan.model.route!.rules![0]).toEqual({ rule_set: ['geosite-category-ads-all'], action: 'reject' })
    expect(plan.model.dns?.rules).toBeUndefined()
  })

  it('ads идемпотентен при повторном применении', () => {
    const first = planAds(BASE, { alsoDns: true })
    const second = planAds(first.model, { alsoDns: true })
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model).toEqual(first.model)
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

  it('dns заводит sniff и hijack-dns с нуля, в этом порядке', () => {
    const empty = parseSingbox('{"outbounds":[{"type":"direct","tag":"direct"}]}').doc!
    const plan = planDns(empty, { remote: '1.1.1.1', detour: 'sel' })
    expect(plan.model.route!.rules!.slice(0, 2)).toEqual([{ action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }])
  })

  it('dns дописывает недостающий hijack-dns сразу за уже существующим sniff', () => {
    const onlySniff = parseSingbox('{"outbounds":[{"type":"direct","tag":"direct"}],"route":{"rules":[{"action":"sniff"}]}}').doc!
    const plan = planDns(onlySniff, { remote: '1.1.1.1', detour: 'sel' })
    expect(plan.model.route!.rules!.slice(0, 2)).toEqual([{ action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }])
  })

  // Оба правила уже стоят в документе, но не первыми двумя: рецепт не
  // переставляет чужой порядок правил, а честно предупреждает о нём
  it('dns не двигает sniff/hijack-dns, если они уже стоят не первыми, а предупреждает', () => {
    const outOfOrder = parseSingbox(
      JSON.stringify({
        outbounds: [{ type: 'direct', tag: 'direct' }],
        route: {
          rules: [{ domain: 'example.com', outbound: 'direct' }, { action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }],
        },
      }),
    ).doc!
    const plan = planDns(outOfOrder, { remote: '1.1.1.1', detour: 'sel' })
    expect(plan.model.route!.rules!.slice(0, 3)).toEqual(outOfOrder.route!.rules)
    expect(plan.notes.some((n) => n.text.includes('не стоят первыми'))).toBe(true)
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
    // Хост и порт пира — разбор WARP_PEER.endpoint (M6), не вторая копия строки
    expect((c.model.endpoints![0]!.peers as unknown[])[0]).toMatchObject({ address: 'engage.cloudflareclient.com', port: 2408 })
  })

  it('реестр содержит шесть рецептов с уникальными id', () => {
    expect(SINGBOX_RECIPES.map((r) => r.id)).toEqual(['split', 'ads', 'dns', 'local', 'private', 'warp'])
  })
})

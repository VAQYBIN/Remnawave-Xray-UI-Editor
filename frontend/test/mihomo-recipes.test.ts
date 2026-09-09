import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { rulesOf } from '../src/entities/mihomo/rules'
import {
  ensureListEntry,
  MIHOMO_RECIPES,
  planAds,
  planDns,
  planLocal,
  planPrivate,
  planSplit,
  planWarp,
  RULE_SET_CATALOG,
  validateLocal,
  validateSplit,
  validateWarp,
} from '../src/entities/mihomo/recipes'
import { mihomoFixture } from './helpers'

const EMPTY = () => parseMihomo('')
const DEFAULT = () => parseMihomo(mihomoFixture('default'))

describe('каталог источников наборов правил', () => {
  it('14 ссылок ветки meta в формате .mrs, id уникальны', () => {
    expect(RULE_SET_CATALOG).toHaveLength(14)
    for (const s of RULE_SET_CATALOG) {
      expect(s.url.startsWith('https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/')).toBe(true)
      expect(s.url.endsWith('.mrs')).toBe(true)
    }
    expect(new Set(RULE_SET_CATALOG.map((s) => s.id)).size).toBe(RULE_SET_CATALOG.length)
  })
})

describe('рецепт split', () => {
  const params = { sets: ['geosite-youtube', 'geoip-private'], target: 'proxy' }

  it('на пустом документе заводит набор и правило (domain и ipcidr с no-resolve)', () => {
    const plan = planSplit(EMPTY(), params)
    expect(plan.changes.some((c) => c.status === 'add')).toBe(true)
    const raws = rulesOf(plan.model).map((r) => r.raw)
    expect(raws).toContain('RULE-SET,geosite-youtube,proxy')
    expect(raws).toContain('RULE-SET,geoip-private,proxy,no-resolve')
  })

  it('правило встаёт перед финальным MATCH на стартере панели', () => {
    const plan = planSplit(DEFAULT(), { sets: ['geosite-youtube'], target: 'proxy' })
    const rules = rulesOf(plan.model)
    const matchIndex = rules.findIndex((r) => r.rule?.type === 'MATCH')
    const ruleIndex = rules.findIndex((r) => r.raw === 'RULE-SET,geosite-youtube,proxy')
    expect(matchIndex).toBe(rules.length - 1)
    expect(ruleIndex).toBeGreaterThanOrEqual(0)
    expect(ruleIndex).toBeLessThan(matchIndex)
  })

  it('повторное применение — все изменения exists, документ не меняется', () => {
    const first = planSplit(EMPTY(), params)
    const second = planSplit(first.model, params)
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model.text).toBe(first.model.text)
  })

  it('валидация требует непустой набор и непустую цель', () => {
    expect(validateSplit({ sets: [], target: 'proxy' })).not.toBeNull()
    expect(validateSplit({ sets: ['geosite-youtube'], target: '' })).not.toBeNull()
    expect(validateSplit({ sets: ['geosite-youtube'], target: 'proxy' })).toBeNull()
  })
})

describe('рецепт ads', () => {
  it('на пустом документе заводит набор и ставит правило первым', () => {
    const plan = planAds(EMPTY(), {})
    expect(plan.changes.some((c) => c.status === 'add')).toBe(true)
    expect(rulesOf(plan.model)[0]?.raw).toBe('RULE-SET,geosite-category-ads-all,REJECT')
    expect(plan.notes.some((n) => n.text.includes('Реклама режется на маршруте'))).toBe(true)
  })

  it('правило стоит первым и на стартере панели, у которого уже есть свои правила', () => {
    const plan = planAds(DEFAULT(), {})
    expect(rulesOf(plan.model)[0]?.raw).toBe('RULE-SET,geosite-category-ads-all,REJECT')
  })

  it('повторное применение — exists, документ не меняется', () => {
    const first = planAds(EMPTY(), {})
    const second = planAds(first.model, {})
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model.text).toBe(first.model.text)
  })
})

describe('рецепт dns', () => {
  const params = { remote: 'https://1.1.1.1/dns-query', local: '1.1.1.1', fakeIp: true }

  it('на пустом документе заводит все ключи с нуля', () => {
    const plan = planDns(EMPTY(), params)
    expect(plan.changes.some((c) => c.status === 'add')).toBe(true)
    const json = plan.model.json as Record<string, unknown>
    expect(json.dns).toMatchObject({ enable: true, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16' })
    expect(json.profile).toMatchObject({ 'store-fake-ip': true })
  })

  it('на стартере панели dns.enable уже есть — exists, и дописывает rule-set:geosite-private в фильтр', () => {
    const plan = planDns(DEFAULT(), params)
    const enableChange = plan.changes.find((c) => c.text.startsWith('dns.enable'))
    expect(enableChange?.status).toBe('exists')
    const dns = (plan.model.json as Record<string, unknown>).dns as Record<string, unknown>
    expect(dns['fake-ip-filter']).toContain('rule-set:geosite-private')
  })

  it('повторное применение — exists, документ не меняется', () => {
    const first = planDns(EMPTY(), params)
    const second = planDns(first.model, params)
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model.text).toBe(first.model.text)
  })
})

describe('рецепт local', () => {
  it('на пустом документе заводит mixed-port; allow-lan только если запрошен', () => {
    const plan = planLocal(EMPTY(), { port: 12345, allowLan: true })
    const json = plan.model.json as Record<string, unknown>
    expect(json['mixed-port']).toBe(12345)
    expect(json['allow-lan']).toBe(true)
  })

  it('без allowLan не трогает allow-lan вовсе', () => {
    const plan = planLocal(EMPTY(), { port: 12345, allowLan: false })
    const json = plan.model.json as Record<string, unknown>
    expect('allow-lan' in json).toBe(false)
  })

  it('порт совпадает со стартером панели — exists', () => {
    const plan = planLocal(DEFAULT(), { port: 7890, allowLan: false })
    expect(plan.changes[0]?.status).toBe('exists')
  })

  it('повторное применение — exists, документ не меняется', () => {
    const params = { port: 12345, allowLan: true }
    const first = planLocal(EMPTY(), params)
    const second = planLocal(first.model, params)
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model.text).toBe(first.model.text)
  })

  it('валидация отвергает порт вне диапазона', () => {
    expect(validateLocal({ port: 0, allowLan: false })).not.toBeNull()
    expect(validateLocal({ port: 70000, allowLan: false })).not.toBeNull()
    expect(validateLocal({ port: 7890, allowLan: false })).toBeNull()
  })
})

describe('рецепт private', () => {
  it('на пустом документе заводит набор и ставит правило первым', () => {
    const plan = planPrivate(EMPTY(), {})
    expect(plan.changes.some((c) => c.status === 'add')).toBe(true)
    expect(rulesOf(plan.model)[0]?.raw).toBe('RULE-SET,geoip-private,DIRECT,no-resolve')
  })

  // Payload дословно и в том же порядке, что у панельного шаблона по умолчанию
  // (test/fixtures/mihomo/default.yaml, rule-providers.geoip-private.payload) —
  // включая IPv6-диапазоны, без которых локальные адреса IPv6 ушли бы в прокси
  it('payload набора — все 18 подсетей панельного шаблона, включая IPv6-диапазоны', () => {
    const plan = planPrivate(EMPTY(), {})
    const providers = (plan.model.json as Record<string, unknown>)['rule-providers'] as Record<string, unknown>
    const geoipPrivate = providers['geoip-private'] as Record<string, unknown>
    expect(geoipPrivate.payload).toEqual([
      '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
      '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
      '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3',
      '::/127', 'fc00::/7', 'fe80::/10', 'ff00::/8',
    ])
    expect((geoipPrivate.payload as string[]).includes('fe80::/10')).toBe(true)
  })

  it('на стартере панели всё уже заведено — exists, документ не меняется', () => {
    const before = DEFAULT()
    const plan = planPrivate(before, {})
    expect(plan.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(plan.model.text).toBe(before.text)
  })

  it('повторное применение — exists, документ не меняется', () => {
    const first = planPrivate(EMPTY(), {})
    const second = planPrivate(first.model, {})
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model.text).toBe(first.model.text)
  })
})

describe('рецепт warp', () => {
  const params = { name: 'WARP', privateKey: 'k', addresses: ['172.16.0.2/32'], reserved: [], mtu: 1280, group: false }

  it('заводит сервер первым в proxies с адресом и ключами пира', () => {
    const plan = planWarp(EMPTY(), params)
    const proxies = (plan.model.json as Record<string, unknown>).proxies as Record<string, unknown>[]
    expect(proxies[0]).toMatchObject({
      name: 'WARP',
      type: 'wireguard',
      server: 'engage.cloudflareclient.com',
      port: 2408,
      ip: '172.16.0.2',
      'private-key': 'k',
      udp: true,
      mtu: 1280,
    })
    expect(proxies[0]!['public-key']).not.toBe('')
  })

  it('group: true заводит группу select с этим сервером', () => {
    const plan = planWarp(EMPTY(), { ...params, group: true })
    const json = plan.model.json as Record<string, unknown>
    expect(json['proxy-groups']).toEqual([{ name: 'WARP', type: 'select', proxies: ['WARP'] }])
  })

  it('вторая точка адреса пишется в ipv6 без маски', () => {
    const plan = planWarp(EMPTY(), { ...params, addresses: ['172.16.0.2/32', '2606:4700:110:8a36::1/128'] })
    const proxies = (plan.model.json as Record<string, unknown>).proxies as Record<string, unknown>[]
    expect(proxies[0]!.ipv6).toBe('2606:4700:110:8a36::1')
  })

  it('повторное применение — exists, документ не меняется', () => {
    const p = { ...params, group: true }
    const first = planWarp(EMPTY(), p)
    const second = planWarp(first.model, p)
    expect(second.changes.every((c) => c.status === 'exists')).toBe(true)
    expect(second.model.text).toBe(first.model.text)
  })

  it('валидация требует имя и ключ', () => {
    expect(validateWarp({ ...params, name: '' })).not.toBeNull()
    expect(validateWarp({ ...params, privateKey: '' })).not.toBeNull()
    expect(validateWarp(params)).toBeNull()
  })
})

describe('отказ писателя становится заметкой плана, не молчанием', () => {
  it('алиас на rules: правило не встаёт, changes без add, note называет причину', () => {
    const md = parseMihomo(
      'rule-providers:\n  geoip-private:\n    type: inline\n    behavior: ipcidr\n    payload: []\nr: &r\n  - MATCH,DIRECT\nrules: *r\n',
    )
    const plan = planPrivate(md, {})
    expect(plan.changes.some((c) => c.status === 'add')).toBe(false)
    // Отказ — не «уже есть»: запись не применена вовсе (I2-минорная находка)
    const refused = plan.changes.find((c) => c.status === 'refused')
    expect(refused).toBeDefined()
    expect(refused?.text).toContain('не применено')
    expect(refused?.text).not.toContain('уже есть')
    expect(plan.model.text).toBe(md.text)
    expect(plan.notes.some((n) => n.text.includes('rules') && n.text.includes('ссылку на якорь'))).toBe(true)
  })

  it('ensureListEntry сам по себе: отказ не меняет документ и не молчит', () => {
    const md = parseMihomo('r: &r\n  - MATCH,DIRECT\nrules: *r\n')
    const res = ensureListEntry(md, ['rules'], 'RULE-SET,geoip-private,DIRECT,no-resolve', 'start')
    expect(res.status).toBe('refused')
    expect(res.md.text).toBe(md.text)
    expect(res.notes).toHaveLength(1)
    expect(res.notes[0]?.text).toContain('rules')
  })
})

describe('реестр рецептов Mihomo', () => {
  it('шесть рецептов в порядке диалога, id уникальны', () => {
    expect(MIHOMO_RECIPES.map((r) => r.id)).toEqual(['split', 'ads', 'dns', 'local', 'private', 'warp'])
    expect(new Set(MIHOMO_RECIPES.map((r) => r.id)).size).toBe(6)
  })
})

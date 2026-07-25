import { describe, expect, it } from 'vitest'
import { traceRoute } from '../src/entities/xray/trace'
import type { GeoAnswers, TraceTarget } from '../src/entities/xray/traceMatch'
import type { XrayConfig } from '../src/entities/xray'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const TARGET: TraceTarget = { address: 'api.openai.com', port: 443, network: 'tcp' }

function config(rules: unknown[], outbounds = ['direct', 'warp']): XrayConfig {
  return {
    outbounds: outbounds.map((tag) => ({ tag, protocol: 'freedom' })),
    routing: { rules },
  } as XrayConfig
}

describe('traceRoute: выбор победителя', () => {
  it('побеждает первое совпавшее правило, остальные не влияют', () => {
    const res = traceRoute(
      config([
        { domain: ['domain:google.com'], outboundTag: 'warp' },
        { domain: ['domain:openai.com'], outboundTag: 'warp' },
        { outboundTag: 'direct' },
      ]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts.map((v) => v.state)).toEqual(['no', 'yes', 'yes'])
    expect(res.winner).toEqual({ ruleIndex: 1, outboundTag: 'warp', balancerTag: undefined })
  })

  it('правило без условий совпадает со всем', () => {
    const res = traceRoute(config([{ outboundTag: 'direct' }]), TARGET, NO_GEO)
    expect(res.verdicts[0].state).toBe('yes')
  })

  it('поля соединяются через И — один промах убивает правило', () => {
    const res = traceRoute(
      config([{ domain: ['domain:openai.com'], port: '80', outboundTag: 'warp' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('no')
    expect(res.verdicts[0].fields.map((f) => [f.field, f.state])).toEqual([
      ['domain', 'yes'],
      ['port', 'no'],
    ])
  })

  it('точный промах перевешивает неизвестное (поля через И)', () => {
    const res = traceRoute(
      config([{ domain: ['geosite:openai'], port: '80', outboundTag: 'warp' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('no')
  })

  it('все заданные поля совпали, но одно неизвестно — правило unknown и победителем не становится', () => {
    const res = traceRoute(
      config([
        { domain: ['geosite:openai'], outboundTag: 'warp' },
        { outboundTag: 'direct' },
      ]),
      TARGET,
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('unknown')
    expect(res.winner?.ruleIndex).toBe(1)
  })

  it('ни одно правило не совпало — трафик уходит в первый outbound', () => {
    const res = traceRoute(config([{ domain: ['domain:google.com'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: null, outboundTag: 'direct', balancerTag: undefined })
  })

  it('правил нет вовсе — тоже первый outbound', () => {
    const res = traceRoute(config([]), TARGET, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: null, outboundTag: 'direct', balancerTag: undefined })
  })

  it('outbound-ов нет — победителя нет', () => {
    const res = traceRoute(config([], []), TARGET, NO_GEO)
    expect(res.winner).toBeUndefined()
  })

  it('победившее правило через balancerTag отдаёт балансер, а не outbound', () => {
    const res = traceRoute(config([{ balancerTag: 'bal', domain: ['domain:openai.com'] }]), TARGET, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 0, outboundTag: undefined, balancerTag: 'bal' })
  })

  it('inboundTag цели учитывается, если задан', () => {
    const res = traceRoute(
      config([{ inboundTag: ['vless-in'], outboundTag: 'warp' }]),
      { ...TARGET, inboundTag: 'other-in' },
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('no')
  })

  it('protocol без sniffing-данных даёт unknown с внятной причиной', () => {
    const res = traceRoute(config([{ protocol: ['tls'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.verdicts[0].state).toBe('unknown')
    expect(res.verdicts[0].fields[0].reason).toContain('sniffing')
  })

  it('ip-условие по доменной цели при стратегии по умолчанию не применяется', () => {
    const res = traceRoute(config([{ ip: ['10.0.0.0/8'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.verdicts[0].state).toBe('no')
    expect(res.verdicts[0].fields[0].reason).toContain('AsIs')
  })

  it('цель-IP сравнивается с ip-условиями без всякого резолва', () => {
    const res = traceRoute(
      config([{ ip: ['10.0.0.0/8'], outboundTag: 'warp' }]),
      { address: '10.1.2.3', port: 443, network: 'tcp' },
      NO_GEO,
    )
    expect(res.verdicts[0].state).toBe('yes')
  })
})

describe('traceRoute: стратегия домена', () => {
  const ipRule = [{ ip: ['10.0.0.0/8'], outboundTag: 'warp' }]

  it('IPIfNonMatch: второй проход по указанному IP находит победителя', () => {
    const cfg = { ...config(ipRule), routing: { domainStrategy: 'IPIfNonMatch', rules: ipRule } } as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, ip: '10.1.2.3' }, NO_GEO)
    expect(res.verdicts[0].state).toBe('no')
    expect(res.ipVerdicts?.[0].state).toBe('yes')
    expect(res.winner).toEqual({ ruleIndex: 0, outboundTag: 'warp', balancerTag: undefined })
  })

  it('IPIfNonMatch без указанного IP: второго прохода нет, но есть caveat', () => {
    const cfg = { ...config(ipRule), routing: { domainStrategy: 'IPIfNonMatch', rules: ipRule } } as XrayConfig
    const res = traceRoute(cfg, TARGET, NO_GEO)
    expect(res.ipVerdicts).toBeUndefined()
    expect(res.caveats.join(' ')).toContain('IP назначения')
  })

  it('IPOnDemand: ip-условия считаются сразу, одним проходом', () => {
    const cfg = { ...config(ipRule), routing: { domainStrategy: 'IPOnDemand', rules: ipRule } } as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, ip: '10.1.2.3' }, NO_GEO)
    expect(res.verdicts[0].state).toBe('yes')
    expect(res.ipVerdicts).toBeUndefined()
  })

  it('второго прохода нет, если победитель нашёлся на первом', () => {
    const rules = [{ domain: ['domain:openai.com'], outboundTag: 'warp' }, ...ipRule]
    const cfg = { ...config(rules), routing: { domainStrategy: 'IPIfNonMatch', rules } } as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, ip: '10.1.2.3' }, NO_GEO)
    expect(res.ipVerdicts).toBeUndefined()
  })
})

describe('traceRoute: caveats', () => {
  it('неизвестное правило выше победителя — предупреждение с его номером', () => {
    const res = traceRoute(
      config([{ domain: ['geosite:openai'], outboundTag: 'warp' }, { outboundTag: 'direct' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.caveats.join(' ')).toContain('#1')
    expect(res.caveats.join(' ')).toContain('может отличаться')
  })

  it('неизвестное правило НИЖЕ победителя не мешает — предупреждения нет', () => {
    const res = traceRoute(
      config([{ outboundTag: 'direct' }, { domain: ['geosite:openai'], outboundTag: 'warp' }]),
      TARGET,
      NO_GEO,
    )
    expect(res.caveats.join(' ')).not.toContain('может отличаться')
  })

  it('geo-базы не загружены, а geo-условия есть — отдельное предупреждение', () => {
    const res = traceRoute(config([{ domain: ['geosite:openai'], outboundTag: 'warp' }]), TARGET, NO_GEO)
    expect(res.caveats.join(' ')).toContain('Geo-базы не загружены')
  })

  it('категории нет в загруженной базе — предупреждение, что ядро отвергнет конфиг', () => {
    const geo: GeoAnswers = { loaded: true, answers: {}, missing: ['geosite:nosuch'] }
    const res = traceRoute(config([{ domain: ['geosite:nosuch'], outboundTag: 'warp' }]), TARGET, geo)
    expect(res.caveats.join(' ')).toContain('geosite:nosuch')
    expect(res.caveats.join(' ')).toContain('отвергнет')
  })

  it('правило матчит домен, а на inbound цели sniffing выключен — предупреждение', () => {
    const cfg = {
      inbounds: [{ tag: 'vless-in', protocol: 'vless', sniffing: { enabled: false } }],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ domain: ['domain:openai.com'], outboundTag: 'direct' }] },
    } as unknown as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, inboundTag: 'vless-in' }, NO_GEO)
    expect(res.caveats.join(' ')).toContain('sniffing')
  })

  it('sniffing включён с destOverride — предупреждения нет', () => {
    const cfg = {
      inbounds: [{ tag: 'vless-in', protocol: 'vless', sniffing: { enabled: true, destOverride: ['tls'] } }],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{ domain: ['domain:openai.com'], outboundTag: 'direct' }] },
    } as unknown as XrayConfig
    const res = traceRoute(cfg, { ...TARGET, inboundTag: 'vless-in' }, NO_GEO)
    expect(res.caveats.join(' ')).not.toContain('sniffing')
  })
})

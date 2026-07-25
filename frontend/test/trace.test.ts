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

import { describe, expect, it } from 'vitest'
import { isValidConnection, tracedEdgeIds } from '../src/features/topology/TopologyView'
import { traceRoute, type GeoAnswers, type XrayConfig } from '../src/entities/xray'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }

const config = (): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: {
      rules: [{ type: 'field', domain: ['example.com'], inboundTag: ['socks'], outboundTag: 'proxy' }],
    },
  }) as unknown as XrayConfig

describe('подсветка трассы через группу подстановки', () => {
  it('ребро победителя ведёт к узлу группы, а не к несуществующему выходу', () => {
    // port и inboundTag цели обязательны, чтобы правило с inboundTag: ['socks'] дало
    // 'yes', а не 'unknown' (traceMatch честно не угадывает недостающие данные) —
    // без них победителя не будет, и tracedEdgeIds вернёт пустой набор
    const trace = traceRoute(
      config(),
      { address: 'example.com', network: 'tcp', port: 443, inboundTag: 'socks' },
      NO_GEO,
    )
    const ids = tracedEdgeIds(trace, config())
    expect([...ids]).toContain('e:rule:0->inj:0')
    expect([...ids]).toContain('e:in:socks->rule:0')
    expect([...ids]).not.toContain('e:rule:0->out:proxy')
  })

  it('кандидат балансера из группы подсвечивается один раз', () => {
    const withBal = {
      ...config(),
      routing: {
        rules: [{ type: 'field', domain: ['example.com'], balancerTag: 'bal' }],
        balancers: [{ tag: 'bal', selector: ['proxy'] }],
      },
    } as unknown as XrayConfig
    const trace = traceRoute(withBal, { address: 'example.com', network: 'tcp', port: 443 }, NO_GEO)
    const ids = [...tracedEdgeIds(trace, withBal)]
    expect(ids.filter((id) => id === 'e:bal:bal->inj:0')).toHaveLength(1)
  })
})

describe('коммутация в группу', () => {
  it('правило и балансер могут вести в группу, а группа никуда не ведёт', () => {
    expect(isValidConnection({ source: 'rule:0', target: 'inj:0' })).toBe(true)
    expect(isValidConnection({ source: 'bal:b', target: 'inj:0' })).toBe(true)
    expect(isValidConnection({ source: 'inj:0', target: 'out:direct' })).toBe(false)
  })
})

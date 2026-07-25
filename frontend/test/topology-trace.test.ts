import { describe, expect, it } from 'vitest'
import { traceStateOf, tracedEdgeIds } from '../src/features/topology/TopologyView'
import type { TraceResult, XrayConfig } from '../src/entities/xray'

const result: TraceResult = {
  verdicts: [
    { index: 0, state: 'no', outboundTag: 'warp', fields: [] },
    { index: 1, state: 'unknown', outboundTag: 'warp', fields: [] },
    { index: 2, state: 'yes', outboundTag: 'direct', fields: [] },
  ],
  winner: { ruleIndex: 2, outboundTag: 'direct' },
  caveats: [],
}

describe('traceStateOf', () => {
  it('победитель помечен отдельно от обычного совпадения', () => {
    expect(traceStateOf(result, 2)).toBe('winner')
    expect(traceStateOf(result, 1)).toBe('unknown')
    expect(traceStateOf(result, 0)).toBe('no')
  })

  it('без трассировки состояний нет', () => {
    expect(traceStateOf(undefined, 0)).toBeUndefined()
  })

  it('индекс за пределами разбора — undefined', () => {
    expect(traceStateOf(result, 7)).toBeUndefined()
  })
})

describe('tracedEdgeIds', () => {
  const config = {
    inbounds: [{ tag: 'vless-in', protocol: 'vless' }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [{}, {}, { inboundTag: ['vless-in'], outboundTag: 'direct' }] },
  } as unknown as XrayConfig

  it('путь победителя: inbound → правило → outbound', () => {
    const ids = tracedEdgeIds(result, config)
    expect(ids.has('e:in:vless-in->rule:2')).toBe(true)
    expect(ids.has('e:rule:2->out:direct')).toBe(true)
  })

  it('правила без своего inboundTag подсвечивают все входы', () => {
    const cfg = {
      inbounds: [
        { tag: 'a-in', protocol: 'vless' },
        { tag: 'b-in', protocol: 'vless' },
      ],
      outbounds: [{ tag: 'direct', protocol: 'freedom' }],
      routing: { rules: [{}, {}, { outboundTag: 'direct' }] },
    } as unknown as XrayConfig
    const ids = tracedEdgeIds(result, cfg)
    expect(ids.has('e:in:a-in->rule:2')).toBe(true)
    expect(ids.has('e:in:b-in->rule:2')).toBe(true)
  })

  it('дефолтный маршрут не подсвечивает ни одного правила', () => {
    const fallback: TraceResult = {
      verdicts: [],
      winner: { ruleIndex: null, outboundTag: 'direct' },
      caveats: [],
    }
    expect(tracedEdgeIds(fallback, config).size).toBe(0)
  })

  it('без трассировки подсветки нет', () => {
    expect(tracedEdgeIds(undefined, config).size).toBe(0)
  })
})

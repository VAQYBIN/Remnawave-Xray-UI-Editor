import { describe, expect, it } from 'vitest'
import { buildGraph } from '../src/entities/graph/buildGraph'
import { edgeId, fallbackEdgeId, outboundTargets } from '../src/entities/graph/edgeIds'
import type { XrayConfig } from '../src/entities/xray'

const config = (): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [{ type: 'field', outboundTag: 'proxy-2' }] },
  }) as unknown as XrayConfig

describe('id рёбер', () => {
  it('собирается по одной схеме', () => {
    expect(edgeId('rule:0', 'out:direct')).toBe('e:rule:0->out:direct')
    expect(fallbackEdgeId('bal', 'direct')).toBe('e:bal:bal->fb:direct')
  })

  it('тег группы разрешается в её узел, статический — в узел выхода', () => {
    const target = outboundTargets(config())
    expect(target('proxy-2')).toBe('inj:0')
    expect(target('direct')).toBe('out:direct')
    expect(target('нет-такого')).toBeUndefined()
  })

  // Ровно та рассинхронизация, ради которой хелпер и заводится
  it('граф строит ребро правила с тем же id, что даёт хелпер', () => {
    const { edges } = buildGraph(config())
    const target = outboundTargets(config())
    expect(edges.map((e) => e.id)).toContain(edgeId('rule:0', target('proxy-2')!))
  })
})

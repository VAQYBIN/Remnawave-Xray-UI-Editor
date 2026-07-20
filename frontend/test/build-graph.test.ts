import { describe, expect, it } from 'vitest'
import { buildGraph, layoutColumns, COLUMN_X, ROW_H } from '../src/entities/graph/buildGraph'

const config = {
  inbounds: [
    { tag: 'vless-in', port: 443, protocol: 'vless', streamSettings: { network: 'tcp', security: 'reality' } },
    { tag: 'ss-in', port: 8388, protocol: 'shadowsocks' },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'warp-out', protocol: 'wireguard' },
  ],
  routing: {
    rules: [
      { type: 'field', inboundTag: ['vless-in'], domain: ['geosite:openai'], outboundTag: 'warp-out' },
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'missing' },
    ],
  },
  dns: { servers: ['1.1.1.1'] },
}

describe('buildGraph', () => {
  it('создаёт узлы с контрактными id', () => {
    const { nodes } = buildGraph(config)
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('in:vless-in')
    expect(ids).toContain('in:ss-in')
    expect(ids).toContain('out:direct')
    expect(ids).toContain('out:warp-out')
    expect(ids).toContain('rule:0')
    expect(ids).toContain('rule:1')
    expect(ids).toContain('dns')
  })

  it('строит рёбра только по существующим тегам', () => {
    const { edges } = buildGraph(config)
    const ids = edges.map((e) => e.id)
    expect(ids).toContain('e:in:vless-in->rule:0')
    expect(ids).toContain('e:rule:0->out:warp-out')
    // rule:1 ссылается на несуществующий outbound «missing» — ребра нет
    expect(ids.some((id) => id.includes('missing'))).toBe(false)
  })

  it('первый outbound помечен default, правило без inboundTag — allInbounds', () => {
    const { nodes } = buildGraph(config)
    const direct = nodes.find((n) => n.id === 'out:direct')!
    const warp = nodes.find((n) => n.id === 'out:warp-out')!
    expect(direct.data.isDefault).toBe(true)
    expect(warp.data.isDefault).toBe(false)
    const rule1 = nodes.find((n) => n.id === 'rule:1')!
    expect(rule1.data.allInbounds).toBe(true)
  })

  it('summary правила по-русски и только для заданных полей', () => {
    const { nodes } = buildGraph(config)
    const rule0 = nodes.find((n) => n.id === 'rule:0')!
    expect(rule0.data.summary).toContain('домены: 1')
    expect((rule0.data.summary as string[]).some((s) => s.startsWith('IP'))).toBe(false)
  })

  it('сквады из контекста дают узлы и рёбра к inbound', () => {
    const { nodes, edges } = buildGraph(config, {
      squads: [{ uuid: 's1', name: 'Default' }],
      inboundSquads: { 'vless-in': ['s1'] },
    })
    expect(nodes.some((n) => n.id === 'squad:s1')).toBe(true)
    expect(edges.some((e) => e.id === 'e:squad:s1->in:vless-in')).toBe(true)
    const inbound = nodes.find((n) => n.id === 'in:vless-in')!
    expect(inbound.data.squadsCount).toBe(1)
  })

  it('uuid сквада, отсутствующий в ctx.squads, не создаёт ни узла, ни ребра', () => {
    const { nodes, edges } = buildGraph(config, {
      squads: [{ uuid: 's1', name: 'Default' }],
      inboundSquads: { 'vless-in': ['s1', 'ghost'] },
    })
    expect(nodes.some((n) => n.id === 'squad:ghost')).toBe(false)
    expect(edges.some((e) => e.id.includes('ghost'))).toBe(false)
  })

  it('сквад без inbound не создаёт узел', () => {
    const { nodes } = buildGraph(config, {
      squads: [{ uuid: 's-unused', name: 'Unused' }],
      inboundSquads: {},
    })
    expect(nodes.some((n) => n.id === 'squad:s-unused')).toBe(false)
  })

  it('сквад, привязанный только к отсутствующему в конфиге тегу, не создаёт узел', () => {
    const { nodes } = buildGraph(config, {
      squads: [{ uuid: 's1', name: 'Default' }],
      inboundSquads: { 'renamed-tag': ['s1'] },
    })
    expect(nodes.some((n) => n.id === 'squad:s1')).toBe(false)
  })

  it('layoutColumns раскладывает по колонкам детерминированно', () => {
    const { nodes } = buildGraph(config)
    const laid = layoutColumns(nodes)
    const vless = laid.find((n) => n.id === 'in:vless-in')!
    const ss = laid.find((n) => n.id === 'in:ss-in')!
    const rule0 = laid.find((n) => n.id === 'rule:0')!
    expect(vless.position).toEqual({ x: COLUMN_X.inbound, y: 0 })
    expect(ss.position).toEqual({ x: COLUMN_X.inbound, y: ROW_H })
    expect(rule0.position.x).toBe(COLUMN_X.rule)
    const dns = laid.find((n) => n.id === 'dns')!
    expect(dns.position.y).toBe(3 * ROW_H) // 2 inbound + 1
  })
})

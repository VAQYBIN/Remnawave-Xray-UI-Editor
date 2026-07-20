import type { XrayConfig } from '../xray'
import type { FlowEdge, FlowNode, GraphContext } from './types'

export const COLUMN_X = { squad: -380, inbound: 0, rule: 430, outbound: 860 } as const
export const ROW_H = 130

function ruleSummary(rule: Record<string, unknown>): string[] {
  const out: string[] = []
  const domain = rule.domain as unknown[] | undefined
  const ip = rule.ip as unknown[] | undefined
  const protocols = rule.protocol as string[] | undefined
  if (domain?.length) out.push(`домены: ${domain.length}`)
  if (ip?.length) out.push(`IP: ${ip.length}`)
  if (rule.port !== undefined) out.push(`порт: ${String(rule.port)}`)
  if (protocols?.length) out.push(`протоколы: ${protocols.join(',')}`)
  if (rule.network !== undefined) out.push(`сеть: ${String(rule.network)}`)
  return out
}

export function buildGraph(
  config: XrayConfig,
  ctx: GraphContext = {},
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const inbounds = config.inbounds ?? []
  const outbounds = config.outbounds ?? []
  const rules = config.routing?.rules ?? []
  const inboundTags = new Set(inbounds.map((i) => i.tag))
  const outboundTags = new Set(outbounds.map((o) => o.tag))

  const inboundSquads = ctx.inboundSquads ?? {}
  // Учитываем сквады только тех тегов, что реально есть среди inbound'ов текущего
  // конфига — иначе сквад, привязанный к переименованному/удалённому в черновике
  // тегу, всё ещё попадёт в граф как изолированный узел без рёбер.
  const usedSquads = new Set(
    Object.entries(inboundSquads)
      .filter(([tag]) => inboundTags.has(tag))
      .flatMap(([, uuids]) => uuids),
  )
  const knownSquads = new Set((ctx.squads ?? []).map((s) => s.uuid))
  for (const squad of ctx.squads ?? []) {
    if (!usedSquads.has(squad.uuid)) continue
    nodes.push({
      id: `squad:${squad.uuid}`,
      type: 'squad',
      position: { x: 0, y: 0 },
      data: { kind: 'squad', name: squad.name },
    })
  }

  // Дубликаты тегов уже подсвечены analyzeIntegrity как warning; здесь пропускаем
  // повторы, иначе одинаковые id узлов ломают React Flow
  const seenInboundTags = new Set<string>()
  inbounds.forEach((inb, index) => {
    if (seenInboundTags.has(inb.tag)) return
    seenInboundTags.add(inb.tag)
    const squadUuids = inboundSquads[inb.tag] ?? []
    nodes.push({
      id: `in:${inb.tag}`,
      type: 'inbound',
      position: { x: 0, y: 0 },
      data: {
        kind: 'inbound',
        index,
        tag: inb.tag,
        protocol: inb.protocol,
        port: inb.port,
        network: inb.streamSettings?.network,
        security: inb.streamSettings?.security,
        squadsCount: squadUuids.length,
      },
    })
    for (const uuid of squadUuids) {
      if (usedSquads.has(uuid) && knownSquads.has(uuid)) {
        edges.push({
          id: `e:squad:${uuid}->in:${inb.tag}`,
          source: `squad:${uuid}`,
          target: `in:${inb.tag}`,
        })
      }
    }
  })

  const seenOutboundTags = new Set<string>()
  outbounds.forEach((out, index) => {
    if (seenOutboundTags.has(out.tag)) return
    seenOutboundTags.add(out.tag)
    nodes.push({
      id: `out:${out.tag}`,
      type: 'outbound',
      position: { x: 0, y: 0 },
      data: { kind: 'outbound', index, tag: out.tag, protocol: out.protocol, isDefault: index === 0 },
    })
  })

  rules.forEach((rule, index) => {
    const ruleTags = (rule.inboundTag ?? []).filter((t) => inboundTags.has(t))
    nodes.push({
      id: `rule:${index}`,
      type: 'rule',
      position: { x: 0, y: 0 },
      data: {
        kind: 'rule',
        index,
        summary: ruleSummary(rule as Record<string, unknown>),
        allInbounds: !rule.inboundTag || rule.inboundTag.length === 0,
      },
    })
    for (const tag of ruleTags) {
      edges.push({ id: `e:in:${tag}->rule:${index}`, source: `in:${tag}`, target: `rule:${index}` })
    }
    if (rule.outboundTag && outboundTags.has(rule.outboundTag)) {
      edges.push({
        id: `e:rule:${index}->out:${rule.outboundTag}`,
        source: `rule:${index}`,
        target: `out:${rule.outboundTag}`,
      })
    }
  })

  if (config.dns) {
    const servers = (config.dns as { servers?: unknown[] }).servers
    nodes.push({
      id: 'dns',
      type: 'dns',
      position: { x: 0, y: 0 },
      data: { kind: 'dns', serversCount: servers?.length ?? 0 },
    })
  }

  return { nodes, edges }
}

export function layoutColumns(nodes: FlowNode[]): FlowNode[] {
  const counters = { squad: 0, inbound: 0, rule: 0, outbound: 0 }
  let inboundTotal = 0
  for (const n of nodes) if (n.data.kind === 'inbound') inboundTotal += 1

  return nodes.map((n) => {
    const kind = n.data.kind as keyof typeof counters | 'dns'
    if (kind === 'dns') {
      return { ...n, position: { x: COLUMN_X.inbound, y: (inboundTotal + 1) * ROW_H } }
    }
    const y = counters[kind] * ROW_H
    counters[kind] += 1
    return { ...n, position: { x: COLUMN_X[kind], y } }
  })
}

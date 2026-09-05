import type { XrayConfig } from '../xray'
import { balancerCandidates } from '../xray/balancers'
import { streamNetwork } from '../xray/compat'
import { describeSelector, injectGroupsOf, predictedTags, tagScheme } from '../xray/inject'
import { edgeId, fallbackEdgeId, outboundTargets } from './edgeIds'
import type { FlowEdge, FlowNode, GraphContext } from './types'

export const COLUMN_X = { squad: -380, inbound: 0, rule: 430, balancer: 860, outbound: 1290 } as const
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

  // Тег может принадлежать группе подстановки: тогда ребро ведёт к её узлу,
  // а не к несуществующему out:<tag>
  const targetForTag = outboundTargets(config)

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
        network: streamNetwork(inb.streamSettings),
        security: inb.streamSettings?.security,
        squadsCount: squadUuids.length,
      },
    })
    for (const uuid of squadUuids) {
      if (usedSquads.has(uuid) && knownSquads.has(uuid)) {
        edges.push({
          id: edgeId(`squad:${uuid}`, `in:${inb.tag}`),
          source: `squad:${uuid}`,
          target: `in:${inb.tag}`,
        })
      }
    }
  })

  // Группы подстановки идут перед статическими выходами: панель вставляет
  // инжектируемые outbound'ы в начало массива, и на холсте порядок тот же
  injectGroupsOf(config).forEach((group, index) => {
    nodes.push({
      id: `inj:${index}`,
      type: 'inject',
      position: { x: 0, y: 0 },
      data: {
        kind: 'inject',
        index,
        selector: describeSelector(group),
        selectFrom: group.selectFrom,
        scheme: tagScheme(group),
        tags: predictedTags(group),
      },
    })
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
      edges.push({
        id: edgeId(`in:${tag}`, `rule:${index}`),
        source: `in:${tag}`,
        target: `rule:${index}`,
      })
    }
    if (rule.outboundTag) {
      const target = targetForTag(rule.outboundTag)
      if (target !== undefined) {
        edges.push({
          id: edgeId(`rule:${index}`, target),
          source: `rule:${index}`,
          target,
        })
      }
    }
  })

  // Балансеры: дубликаты тегов пропускаем — одинаковые id узлов ломают React Flow
  const balancers = config.routing?.balancers ?? []
  const seenBalancerTags = new Set<string>()
  balancers.forEach((bal, index) => {
    if (seenBalancerTags.has(bal.tag)) return
    seenBalancerTags.add(bal.tag)
    const candidates = balancerCandidates(config, bal)
    nodes.push({
      id: `bal:${bal.tag}`,
      type: 'balancer',
      position: { x: 0, y: 0 },
      data: {
        kind: 'balancer',
        index,
        tag: bal.tag,
        strategy: bal.strategy?.type,
        candidates: candidates.length,
      },
    })
    const seenTargets = new Set<string>()
    for (const tag of candidates) {
      const target = targetForTag(tag)
      // Несколько предсказанных тегов одной группы дают один узел: без дедупликации
      // получились бы дубликаты id рёбер, а они ломают React Flow
      if (target === undefined || seenTargets.has(target)) continue
      seenTargets.add(target)
      edges.push({
        id: edgeId(`bal:${bal.tag}`, target),
        source: `bal:${bal.tag}`,
        target,
      })
    }
    // Запасной выход — не кандидат балансировки: отдельный id ребра и свой стиль.
    // Цель разрешаем тем же резолвером, что и кандидатов: fallbackTag может указывать
    // на тег, который производит группа подстановки (узел inj:<index>, а не out:<tag>).
    if (bal.fallbackTag !== undefined) {
      const fallbackTarget = targetForTag(bal.fallbackTag)
      if (fallbackTarget !== undefined) {
        edges.push({
          id: fallbackEdgeId(bal.tag, bal.fallbackTag),
          source: `bal:${bal.tag}`,
          target: fallbackTarget,
        })
      }
    }
  })

  rules.forEach((rule, index) => {
    if (rule.balancerTag && seenBalancerTags.has(rule.balancerTag)) {
      edges.push({
        id: edgeId(`rule:${index}`, `bal:${rule.balancerTag}`),
        source: `rule:${index}`,
        target: `bal:${rule.balancerTag}`,
      })
    }
  })

  // Обсерватория — глобальная секция, поэтому один узел на конфиг, как dns
  const observatory = config.observatory
  const burst = config.burstObservatory
  if (observatory || burst) {
    nodes.push({
      id: 'obs',
      type: 'observatory',
      position: { x: 0, y: 0 },
      data: {
        kind: 'observatory',
        hasObservatory: observatory !== undefined,
        hasBurst: burst !== undefined,
        subjectsCount: new Set([
          ...(observatory?.subjectSelector ?? []),
          ...(burst?.subjectSelector ?? []),
        ]).size,
      },
    })
    for (const bal of balancers) {
      const type = bal.strategy?.type
      const needed = type === 'leastPing' ? observatory : type === 'leastLoad' ? burst : undefined
      if (!needed || !seenBalancerTags.has(bal.tag)) continue
      // Зависимость, а не поток трафика: ребро нельзя разорвать кабелем
      edges.push({
        id: edgeId('obs', `bal:${bal.tag}`),
        source: 'obs',
        target: `bal:${bal.tag}`,
        deletable: false,
      })
    }
  }

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
  const counters = { squad: 0, inbound: 0, rule: 0, balancer: 0, outbound: 0 }
  let inboundTotal = 0
  let balancerTotal = 0
  for (const n of nodes) {
    if (n.data.kind === 'inbound') inboundTotal += 1
    if (n.data.kind === 'balancer') balancerTotal += 1
  }

  return nodes.map((n) => {
    // Узлы подстановки делят колонку и счётчик строк с outbound'ами: они и есть
    // будущие outbound'ы, просто их создаст панель
    const raw = n.data.kind === 'inject' ? 'outbound' : n.data.kind
    const kind = raw as keyof typeof counters | 'dns' | 'observatory'
    if (kind === 'dns') {
      return { ...n, position: { x: COLUMN_X.inbound, y: (inboundTotal + 1) * ROW_H } }
    }
    if (kind === 'observatory') {
      return { ...n, position: { x: COLUMN_X.balancer, y: (balancerTotal + 1) * ROW_H } }
    }
    const y = counters[kind] * ROW_H
    counters[kind] += 1
    return { ...n, position: { x: COLUMN_X[kind], y } }
  })
}

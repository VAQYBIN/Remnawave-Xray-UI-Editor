import type { XrayConfig } from '../xray'

function clone(config: XrayConfig): XrayConfig {
  return structuredClone(config)
}

function inboundIndex(config: XrayConfig, tag: string): number {
  return (config.inbounds ?? []).findIndex((i) => i.tag === tag)
}
function outboundIndex(config: XrayConfig, tag: string): number {
  return (config.outbounds ?? []).findIndex((o) => o.tag === tag)
}

export function getNodeJson(config: XrayConfig, nodeId: string): unknown | undefined {
  if (nodeId === 'dns') return config.dns
  if (nodeId.startsWith('in:')) {
    const i = inboundIndex(config, nodeId.slice(3))
    return i === -1 ? undefined : config.inbounds![i]
  }
  if (nodeId.startsWith('out:')) {
    const i = outboundIndex(config, nodeId.slice(4))
    return i === -1 ? undefined : config.outbounds![i]
  }
  if (nodeId.startsWith('rule:')) {
    return config.routing?.rules?.[Number(nodeId.slice(5))]
  }
  return undefined
}

export function applyNodeJson(config: XrayConfig, nodeId: string, value: unknown): XrayConfig {
  const next = clone(config)
  if (nodeId === 'dns') {
    next.dns = value as XrayConfig['dns']
    return next
  }
  if (nodeId.startsWith('in:')) {
    const i = inboundIndex(next, nodeId.slice(3))
    if (i !== -1) next.inbounds![i] = value as NonNullable<XrayConfig['inbounds']>[number]
    return next
  }
  if (nodeId.startsWith('out:')) {
    const i = outboundIndex(next, nodeId.slice(4))
    if (i !== -1) next.outbounds![i] = value as NonNullable<XrayConfig['outbounds']>[number]
    return next
  }
  if (nodeId.startsWith('rule:')) {
    const i = Number(nodeId.slice(5))
    if (next.routing?.rules?.[i] !== undefined) {
      next.routing.rules[i] = value as NonNullable<NonNullable<XrayConfig['routing']>['rules']>[number]
    }
    return next
  }
  return next
}

export function removeNode(config: XrayConfig, nodeId: string): XrayConfig {
  const next = clone(config)
  if (nodeId === 'dns') {
    delete next.dns
    return next
  }
  if (nodeId.startsWith('in:')) {
    const i = inboundIndex(next, nodeId.slice(3))
    if (i !== -1) next.inbounds!.splice(i, 1)
    return next
  }
  if (nodeId.startsWith('out:')) {
    const i = outboundIndex(next, nodeId.slice(4))
    if (i !== -1) next.outbounds!.splice(i, 1)
    return next
  }
  if (nodeId.startsWith('rule:')) {
    const i = Number(nodeId.slice(5))
    next.routing?.rules?.splice(i, 1)
    return next
  }
  return next
}

function uniqueTag(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function addInbound(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.inbounds = next.inbounds ?? []
  const tag = uniqueTag(new Set(next.inbounds.map((i) => i.tag)), 'vless-in')
  next.inbounds.push({
    tag,
    port: 443,
    protocol: 'vless',
    settings: { clients: [], decryption: 'none' },
    streamSettings: { network: 'tcp', security: 'none' },
    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
  })
  return next
}

export function addOutbound(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.outbounds = next.outbounds ?? []
  const tag = uniqueTag(new Set(next.outbounds.map((o) => o.tag)), 'direct')
  // первый direct обычно уже есть — начинаем с direct-2
  next.outbounds.push({ tag, protocol: 'freedom', settings: {} })
  return next
}

export function addRule(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.rules = next.routing.rules ?? []
  next.routing.rules.push({ type: 'field' })
  return next
}

export function connectRule(config: XrayConfig, inboundTag: string, outboundTag: string): XrayConfig {
  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.rules = next.routing.rules ?? []
  next.routing.rules.push({ type: 'field', inboundTag: [inboundTag], outboundTag })
  return next
}

const EDGE_IN_RULE = /^e:in:(.+)->rule:(\d+)$/
const EDGE_RULE_OUT = /^e:rule:(\d+)->out:(.+)$/

export function disconnectEdge(config: XrayConfig, edgeId: string): XrayConfig {
  const inRule = EDGE_IN_RULE.exec(edgeId)
  if (inRule) {
    const next = clone(config)
    const rule = next.routing?.rules?.[Number(inRule[2])]
    if (rule?.inboundTag) {
      rule.inboundTag = rule.inboundTag.filter((t) => t !== inRule[1])
    }
    return next
  }
  const ruleOut = EDGE_RULE_OUT.exec(edgeId)
  if (ruleOut) {
    const next = clone(config)
    next.routing?.rules?.splice(Number(ruleOut[1]), 1)
    return next
  }
  return config
}

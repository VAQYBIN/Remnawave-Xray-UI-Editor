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

// Возвращает живую ссылку внутрь config — НЕ мутируйте результат, используйте applyNodeJson
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

// Тег — это ссылка: на него смотрят правила, dialerProxy, proxySettings и балансеры.
// Переименование узла обязано протащить новый тег по всем ссылкам, иначе правило молча
// остаётся привязанным к тегу, которого больше нет. Мутирует переданный конфиг —
// вызывается только на свежем клоне внутри applyNodeJson.
function retagInPlace(
  config: XrayConfig,
  kind: 'inbound' | 'outbound',
  oldTag: string,
  newTag: string,
): void {
  for (const rule of config.routing?.rules ?? []) {
    if (kind === 'inbound') {
      if (rule.inboundTag) rule.inboundTag = rule.inboundTag.map((t) => (t === oldTag ? newTag : t))
    } else if (rule.outboundTag === oldTag) {
      rule.outboundTag = newTag
    }
  }
  if (kind === 'inbound') return

  for (const out of config.outbounds ?? []) {
    const sockopt = out.streamSettings?.sockopt
    if (sockopt?.dialerProxy === oldTag) sockopt.dialerProxy = newTag
    // proxySettings хранится нетипизированным объектом (passthrough)
    const proxy = (out as { proxySettings?: { tag?: string } }).proxySettings
    if (proxy?.tag === oldTag) proxy.tag = newTag
  }

  for (const raw of config.routing?.balancers ?? []) {
    const balancer = raw as { selector?: string[]; fallbackTag?: string }
    // selector хранит ПРЕФИКСЫ тегов — переписываем только точное совпадение,
    // иначе «direct» затёр бы чужой префикс «dir»
    if (balancer.selector) {
      balancer.selector = balancer.selector.map((s) => (s === oldTag ? newTag : s))
    }
    if (balancer.fallbackTag === oldTag) balancer.fallbackTag = newTag
  }
}

function tagOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const tag = (value as { tag?: unknown }).tag
  return typeof tag === 'string' ? tag : undefined
}

export function applyNodeJson(config: XrayConfig, nodeId: string, value: unknown): XrayConfig {
  const next = clone(config)
  if (nodeId === 'dns') {
    next.dns = value as XrayConfig['dns']
    return next
  }
  if (nodeId.startsWith('in:')) {
    const oldTag = nodeId.slice(3)
    const i = inboundIndex(next, oldTag)
    if (i !== -1) next.inbounds![i] = value as NonNullable<XrayConfig['inbounds']>[number]
    const newTag = tagOf(value)
    if (i !== -1 && newTag !== undefined && newTag !== oldTag) {
      retagInPlace(next, 'inbound', oldTag, newTag)
    }
    return next
  }
  if (nodeId.startsWith('out:')) {
    const oldTag = nodeId.slice(4)
    const i = outboundIndex(next, oldTag)
    if (i !== -1) next.outbounds![i] = value as NonNullable<XrayConfig['outbounds']>[number]
    const newTag = tagOf(value)
    if (i !== -1 && newTag !== undefined && newTag !== oldTag) {
      retagInPlace(next, 'outbound', oldTag, newTag)
    }
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
  // uniqueTag сам подберёт свободный суффикс
  next.outbounds.push({ tag, protocol: 'freedom', settings: {} })
  return next
}

export function addRule(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.rules = next.routing.rules ?? []
  next.routing.rules.push({})
  return next
}

// Переставляет правило index на index+dir (-1 — выше/раньше, +1 — ниже/позже).
// Правила срабатывают сверху вниз, поэтому порядок значим.
// На границах списка и при отсутствии правила возвращает ТОТ ЖЕ объект config —
// вызывающий код проверяет `=== config`, чтобы не делать пустых правок черновика.
export function moveRule(config: XrayConfig, index: number, dir: -1 | 1): XrayConfig {
  const rules = config.routing?.rules
  const target = index + dir
  if (!rules || index < 0 || index >= rules.length || target < 0 || target >= rules.length) {
    return config
  }
  const next = clone(config)
  const list = next.routing!.rules!
  const [moved] = list.splice(index, 1)
  list.splice(target, 0, moved!)
  return next
}

export function connectRule(config: XrayConfig, inboundTag: string, outboundTag: string): XrayConfig {
  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.rules = next.routing.rules ?? []
  next.routing.rules.push({ inboundTag: [inboundTag], outboundTag })
  return next
}

// Ребро inbound → правило: добавляет тег в inboundTag правила.
// Правило без inboundTag означает «любой inbound»; протянув кабель, пользователь
// сужает его до конкретного — это и есть смысл нарисованного соединения.
// Повтор и несуществующий индекс возвращают ТОТ ЖЕ config (вызывающий проверяет `=== config`).
export function attachInboundToRule(config: XrayConfig, inboundTag: string, ruleIndex: number): XrayConfig {
  const rule = config.routing?.rules?.[ruleIndex]
  if (!rule || (rule.inboundTag ?? []).includes(inboundTag)) return config
  const next = clone(config)
  const target = next.routing!.rules![ruleIndex]!
  target.inboundTag = [...(target.inboundTag ?? []), inboundTag]
  return next
}

// Ребро правило → outbound: назначает правилу точку выхода.
// Правило имеет ровно один outboundTag, поэтому прежний перезаписывается.
export function setRuleOutbound(config: XrayConfig, ruleIndex: number, outboundTag: string): XrayConfig {
  const rule = config.routing?.rules?.[ruleIndex]
  if (!rule || rule.outboundTag === outboundTag) return config
  const next = clone(config)
  next.routing!.rules![ruleIndex]!.outboundTag = outboundTag
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

import type { XrayConfig } from '../xray'
import { balancerCandidates, matchPrefixes } from '../xray/balancers'
import { predictedTags, tagScheme } from '../xray/inject'

function clone(config: XrayConfig): XrayConfig {
  return structuredClone(config)
}

function inboundIndex(config: XrayConfig, tag: string): number {
  return (config.inbounds ?? []).findIndex((i) => i.tag === tag)
}
function outboundIndex(config: XrayConfig, tag: string): number {
  return (config.outbounds ?? []).findIndex((o) => o.tag === tag)
}
function balancerIndex(config: XrayConfig, tag: string): number {
  return (config.routing?.balancers ?? []).findIndex((b) => b.tag === tag)
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
  if (nodeId.startsWith('bal:')) {
    const i = balancerIndex(config, nodeId.slice(4))
    return i === -1 ? undefined : config.routing!.balancers![i]
  }
  if (nodeId.startsWith('inj:')) {
    return config.remnawave?.injectHosts?.[Number(nodeId.slice(4))]
  }
  // Узел obs представляет ДВЕ глобальные секции сразу — в JSON-вкладке видно и
  // правится ровно то, что уйдёт в конфиг
  if (nodeId === 'obs') {
    const value: Record<string, unknown> = {}
    if (config.observatory) value.observatory = config.observatory
    if (config.burstObservatory) value.burstObservatory = config.burstObservatory
    return value
  }
  return undefined
}

// Тег — это ссылка: на него смотрят правила, dialerProxy, proxySettings и балансеры.
// Переименование узла обязано протащить новый тег по всем ссылкам, иначе правило молча
// остаётся привязанным к тегу, которого больше нет. Мутирует переданный конфиг —
// вызывается только на свежем клоне внутри applyNodeJson.
function retagInPlace(
  config: XrayConfig,
  kind: 'inbound' | 'outbound' | 'balancer',
  oldTag: string,
  newTag: string,
): void {
  if (kind === 'balancer') {
    for (const rule of config.routing?.rules ?? []) {
      if (rule.balancerTag === oldTag) rule.balancerTag = newTag
    }
    return
  }
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
    // proxySettings хранится нетипизированным объектом (схема его пропускает)
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
  if (nodeId.startsWith('bal:')) {
    const oldTag = nodeId.slice(4)
    const i = balancerIndex(next, oldTag)
    if (i !== -1) {
      next.routing!.balancers![i] = value as NonNullable<
        NonNullable<XrayConfig['routing']>['balancers']
      >[number]
    }
    const newTag = tagOf(value)
    if (i !== -1 && newTag !== undefined && newTag !== oldTag) {
      retagInPlace(next, 'balancer', oldTag, newTag)
    }
    return next
  }
  if (nodeId.startsWith('inj:')) {
    const i = Number(nodeId.slice(4))
    const groups = next.remnawave?.injectHosts
    if (groups?.[i] !== undefined) groups[i] = value as NonNullable<typeof groups>[number]
    return next
  }
  if (nodeId === 'obs') {
    const obj = (value ?? {}) as { observatory?: unknown; burstObservatory?: unknown }
    if (obj.observatory === undefined) delete next.observatory
    else next.observatory = obj.observatory as XrayConfig['observatory']
    if (obj.burstObservatory === undefined) delete next.burstObservatory
    else next.burstObservatory = obj.burstObservatory as XrayConfig['burstObservatory']
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
  if (nodeId.startsWith('bal:')) {
    const i = balancerIndex(next, nodeId.slice(4))
    if (i !== -1) next.routing!.balancers!.splice(i, 1)
    return next
  }
  if (nodeId.startsWith('inj:')) {
    // Ссылки на предсказанные теги в правилах и селекторах остаются висеть —
    // ровно как при удалении обычного outbound'а. Их ловит валидация, а не
    // молчаливая чистка: удалить чужое правило пользователь не просил.
    next.remnawave?.injectHosts?.splice(Number(nodeId.slice(4)), 1)
    return next
  }
  if (nodeId === 'obs') {
    delete next.observatory
    delete next.burstObservatory
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

export function addBalancer(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.balancers = next.routing.balancers ?? []
  const tag = uniqueTag(new Set(next.routing.balancers.map((b) => b.tag)), 'balancer')
  next.routing.balancers.push({ tag, selector: [], strategy: { type: 'roundRobin' } })
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
// balancerTag снимаем: при обоих заданных тегах ядро берёт outboundTag, и
// оставшийся балансер выглядел бы работающим, не будучи им.
export function setRuleOutbound(config: XrayConfig, ruleIndex: number, outboundTag: string): XrayConfig {
  const rule = config.routing?.rules?.[ruleIndex]
  if (!rule) return config
  if (rule.outboundTag === outboundTag && rule.balancerTag === undefined) return config
  const next = clone(config)
  const target = next.routing!.rules![ruleIndex]!
  target.outboundTag = outboundTag
  delete target.balancerTag
  return next
}

// Ребро правило → балансер. outboundTag снимаем по той же причине, что и выше.
export function setRuleBalancer(config: XrayConfig, ruleIndex: number, balancerTag: string): XrayConfig {
  const rule = config.routing?.rules?.[ruleIndex]
  if (!rule) return config
  if (rule.balancerTag === balancerTag && rule.outboundTag === undefined) return config
  const next = clone(config)
  const target = next.routing!.rules![ruleIndex]!
  target.balancerTag = balancerTag
  delete target.outboundTag
  return next
}

// Ребро балансер → outbound: в selector уходит ТОЧНЫЙ тег. Уже покрытый префиксом
// кандидат не дублируется — возвращается тот же конфиг.
export function attachOutboundToBalancer(
  config: XrayConfig,
  balancerTag: string,
  outboundTag: string,
): XrayConfig {
  const i = balancerIndex(config, balancerTag)
  if (i === -1) return config
  const balancer = config.routing!.balancers![i]!
  if (balancerCandidates(config, balancer).includes(outboundTag)) return config
  const next = clone(config)
  const target = next.routing!.balancers![i]!
  target.selector = [...(target.selector ?? []), outboundTag]
  return next
}

/**
 * Кладёт geo-категорию в правило: geosite — в domain, geoip — в ip.
 * ruleIndex === null (или индекс несуществующего правила) — создаётся новое правило
 * в конце списка, там же, где его создаёт кнопка «+ Правило».
 * Возвращает индекс правила, чтобы вызывающий мог его выделить.
 */
export function appendGeoKey(
  config: XrayConfig,
  ruleIndex: number | null,
  key: string,
): { config: XrayConfig; ruleIndex: number } {
  const field = key.startsWith('geoip:') ? 'ip' : 'domain'
  const rules = config.routing?.rules ?? []
  const exists = ruleIndex !== null ? rules[ruleIndex] : undefined

  // Повтор не добавляем: возвращаем тот же объект, как и прочие мутации
  if (exists && (exists[field] ?? []).includes(key)) return { config, ruleIndex: ruleIndex! }

  const next = clone(config)
  next.routing = next.routing ?? {}
  next.routing.rules = next.routing.rules ?? []
  let index = ruleIndex
  if (index === null || next.routing.rules[index] === undefined) {
    next.routing.rules.push({})
    index = next.routing.rules.length - 1
  }
  const rule = next.routing.rules[index]!
  rule[field] = [...(rule[field] ?? []), key]
  return { config: next, ruleIndex: index }
}

const EDGE_IN_RULE = /^e:in:(.+)->rule:(\d+)$/
const EDGE_RULE_OUT = /^e:rule:(\d+)->out:(.+)$/
const EDGE_RULE_BAL = /^e:rule:(\d+)->bal:(.+)$/
// Запасной выход помечен своим префиксом: тег может быть одновременно кандидатом
// и fallback'ом, а два ребра с одинаковым id ломают React Flow
const EDGE_BAL_FB = /^e:bal:(.+)->fb:(.+)$/
const EDGE_BAL_OUT = /^e:bal:(.+)->out:(.+)$/
// Цели-группы: тег такого выхода в конфиге отсутствует, поэтому ребро ведёт к
// узлу группы, а не к out:<tag>
const EDGE_RULE_INJ = /^e:rule:(\d+)->inj:(\d+)$/
const EDGE_BAL_INJ = /^e:bal:(.+)->inj:(\d+)$/

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
  // Правило без назначения бессмысленно — удаляем целиком, как и для ребра rule→out
  const ruleBal = EDGE_RULE_BAL.exec(edgeId)
  if (ruleBal) {
    const next = clone(config)
    next.routing?.rules?.splice(Number(ruleBal[1]), 1)
    return next
  }
  const balFb = EDGE_BAL_FB.exec(edgeId)
  if (balFb) {
    const i = balancerIndex(config, balFb[1]!)
    if (i === -1) return config
    const next = clone(config)
    delete next.routing!.balancers![i]!.fallbackTag
    return next
  }
  const balOut = EDGE_BAL_OUT.exec(edgeId)
  if (balOut) {
    const i = balancerIndex(config, balOut[1]!)
    if (i === -1) return config
    const selector = config.routing!.balancers![i]!.selector ?? []
    // Кандидат пришёл из префикса: убрать одного, не переписав selector, нельзя —
    // возвращаем тот же конфиг, TopologyView спросит про разворот префикса
    if (!selector.includes(balOut[2]!)) return config
    const next = clone(config)
    next.routing!.balancers![i]!.selector = selector.filter((s) => s !== balOut[2])
    return next
  }
  const ruleInj = EDGE_RULE_INJ.exec(edgeId)
  if (ruleInj) {
    // Правило без назначения бессмысленно — удаляем целиком, как и для rule→out
    const next = clone(config)
    next.routing?.rules?.splice(Number(ruleInj[1]), 1)
    return next
  }
  const balInj = EDGE_BAL_INJ.exec(edgeId)
  if (balInj) {
    const groupIndex = Number(balInj[2])
    const group = config.remnawave?.injectHosts?.[groupIndex]
    const i = balancerIndex(config, balInj[1]!)
    // Теги группы, которые знает только панель, префиксом не ловятся вовсе —
    // такого ребра и не бывает
    const tags = group ? predictedTags(group) : []
    if (i === -1 || tags.length === 0) return config
    if (blockingGroupPrefix(config, balInj[1]!, groupIndex) !== undefined) return config
    const selector = config.routing!.balancers![i]!.selector ?? []
    // Устаревший id ребра (селектор уже не ловит группу) не должен вернуть новый
    // объект — инвариант «ничего не поменялось → тот же объект» держим и здесь,
    // как в соседней ветке EDGE_BAL_OUT
    if (matchPrefixes(tags, selector).length === 0) return config
    const next = clone(config)
    next.routing!.balancers![i]!.selector = selector.filter(
      (p) => matchPrefixes(tags, [p]).length === 0,
    )
    return next
  }
  return config
}

/**
 * Префикс селектора, который ловит и группу, и чужой тег — статический выход
 * либо тег СОСЕДНЕЙ группы. Убрать группу из балансера, не потеряв чужого
 * кандидата, таким префиксом нельзя — это тот же тупик, что у
 * blockingInjectPrefix, только с другой стороны.
 */
export function blockingGroupPrefix(
  config: XrayConfig,
  balancerTag: string,
  groupIndex: number,
): string | undefined {
  const groups = config.remnawave?.injectHosts ?? []
  const group = groups[groupIndex]
  const balancer = (config.routing?.balancers ?? []).find((b) => b.tag === balancerTag)
  if (!group || !balancer) return undefined
  const tags = predictedTags(group)
  if (tags.length === 0) return undefined
  const statics = (config.outbounds ?? []).map((o) => o.tag)
  // Чужие теги, которые тот же префикс уводит вместе с нашими: и статические
  // выходы, и теги соседних групп. Убрать префикс — оторвать их заодно, а
  // сохранить — не убрать ничего. Развернуть его в точные теги нельзя: сколько
  // серверов подставит панель, знает только она.
  const foreign = [
    ...statics,
    ...groups.flatMap((g, i) => (i === groupIndex ? [] : predictedTags(g))),
  ]
  return (balancer.selector ?? [])
    .filter((p) => matchPrefixes(tags, [p]).length > 0)
    .find((p) => matchPrefixes(foreign, [p]).length > 0)
}

/**
 * Группы подстановки. Способ именования тегов ровно один из трёх, поэтому
 * правка всегда снимает парные ключи — тот же приём, что у пары
 * outboundTag/balancerTag: невыразимое состояние лучше проверяемого.
 */
export function addInjectGroup(config: XrayConfig): XrayConfig {
  const next = clone(config)
  next.remnawave = next.remnawave ?? {}
  next.remnawave.injectHosts = next.remnawave.injectHosts ?? []
  const taken = new Set(
    next.remnawave.injectHosts
      .map((g) => g.tagPrefix)
      .filter((t): t is string => typeof t === 'string'),
  )
  next.remnawave.injectHosts.push({
    selector: { type: 'sameTagAsRecipient' },
    tagPrefix: uniqueTag(taken, 'proxy'),
    selectFrom: 'HIDDEN',
  })
  return next
}

/** Ребро «правило → группа»: тег берётся первый предсказанный. Непредсказуемый — тот же конфиг. */
export function setRuleInjectGroup(
  config: XrayConfig,
  ruleIndex: number,
  groupIndex: number,
): XrayConfig {
  const group = config.remnawave?.injectHosts?.[groupIndex]
  const rule = config.routing?.rules?.[ruleIndex]
  const tag = group ? predictedTags(group)[0] : undefined
  if (!rule || tag === undefined) return config
  return setRuleOutbound(config, ruleIndex, tag)
}

/**
 * Ребро «балансер → группа»: в selector уходит ПРЕФИКС, а не точный тег —
 * иначе балансер поймает только первый из подставленных хостов.
 */
export function attachInjectGroupToBalancer(
  config: XrayConfig,
  balancerTag: string,
  groupIndex: number,
): XrayConfig {
  const group = config.remnawave?.injectHosts?.[groupIndex]
  const prefix = group?.tagPrefix
  const index = (config.routing?.balancers ?? []).findIndex((b) => b.tag === balancerTag)
  if (index === -1 || group === undefined || tagScheme(group) !== 'prefix' || typeof prefix !== 'string') {
    return config
  }
  const balancer = config.routing!.balancers![index]!
  if ((balancer.selector ?? []).includes(prefix)) return config
  const next = clone(config)
  const target = next.routing!.balancers![index]!
  target.selector = [...(target.selector ?? []), prefix]
  return next
}

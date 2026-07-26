// Примитивы слияния рецепта с существующим конфигом. Все возвращают НОВЫЙ конфиг
// и статус: 'add' — что-то добавили, 'exists' — такое уже есть, конфиг вернули как был
// (по ссылке, вызывающий может сравнивать через ===).

import type { Balancer } from '../balancers'
import type { XrayConfig } from '../config'
import type { Outbound } from '../outbounds'
import type { Rule } from './types'

export interface MergeResult {
  config: XrayConfig
  status: 'add' | 'exists'
}

export interface RuleMergeResult extends MergeResult {
  /** Индекс правила в routing.rules — для текста «встанет первым» */
  index: number
}

export function ensureOutbound(config: XrayConfig, outbound: Outbound): MergeResult {
  const list = config.outbounds ?? []
  if (list.some((o) => o.tag === outbound.tag)) return { config, status: 'exists' }
  return { config: { ...config, outbounds: [...list, outbound] }, status: 'add' }
}

export function ensureBalancer(config: XrayConfig, balancer: Balancer): MergeResult {
  const list = config.routing?.balancers ?? []
  if (list.some((b) => b.tag === balancer.tag)) return { config, status: 'exists' }
  return {
    config: { ...config, routing: { ...(config.routing ?? {}), balancers: [...list, balancer] } },
    status: 'add',
  }
}

/**
 * Переводит правила, ведущие в перечисленные outbound'ы, на балансер. outboundTag
 * снимается: при обоих заданных тегах ядро берёт его, и балансер не сработал бы.
 */
export function repointRules(
  config: XrayConfig,
  outboundTags: string[],
  balancerTag: string,
): { config: XrayConfig; count: number } {
  const rules = config.routing?.rules ?? []
  let count = 0
  const next = rules.map((rule) => {
    if (rule.outboundTag === undefined || !outboundTags.includes(rule.outboundTag)) return rule
    count += 1
    const { outboundTag: _drop, ...rest } = rule
    return { ...rest, balancerTag }
  })
  if (count === 0) return { config, count }
  return { config: { ...config, routing: { ...(config.routing ?? {}), rules: next } }, count }
}

// Поля-множества: порядок значений в них для Xray не значим
const SET_FIELDS = ['domain', 'ip', 'inboundTag', 'protocol', 'user', 'source'] as const
// Поля со скалярным значением: сравниваются точно
const EXACT_FIELDS = ['type', 'outboundTag', 'balancerTag', 'port', 'sourcePort', 'network'] as const

function sameSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  if (x.length !== y.length) return false
  const set = new Set(x)
  return y.every((v) => set.has(v))
}

/** Правила считаются одним и тем же, если совпали все сравниваемые поля */
export function sameRule(a: Rule, b: Rule): boolean {
  return SET_FIELDS.every((f) => sameSet(a[f], b[f])) && EXACT_FIELDS.every((f) => a[f] === b[f])
}

export type Placement = 'block' | 'route'

// Ведущая серия правил, ведущих в blackhole-выход: маршрут рецепта встаёт сразу за ней,
// чтобы не перекрыть блокировку и при этом оказаться выше пользовательских правил
function blockPrefixLength(config: XrayConfig, rules: Rule[]): number {
  const blackholes = new Set(
    (config.outbounds ?? [])
      .filter((o) => o.protocol === 'blackhole')
      .map((o) => o.tag)
      .filter((t): t is string => typeof t === 'string'),
  )
  let i = 0
  while (i < rules.length) {
    const tag = rules[i]!.outboundTag
    if (tag === undefined || !blackholes.has(tag)) break
    i += 1
  }
  return i
}

export function ensureRule(config: XrayConfig, rule: Rule, placement: Placement): RuleMergeResult {
  const rules = config.routing?.rules ?? []
  const found = rules.findIndex((r) => sameRule(r, rule))
  if (found !== -1) return { config, status: 'exists', index: found }

  // В Xray выигрывает первое совпавшее правило, поэтому вставляем в начало:
  // в хвосте под общим «всё → proxy» правило не сработало бы никогда
  const index = placement === 'block' ? 0 : blockPrefixLength(config, rules)
  const next = [...rules.slice(0, index), rule, ...rules.slice(index)]
  return {
    config: { ...config, routing: { ...(config.routing ?? {}), rules: next } },
    status: 'add',
    index,
  }
}

export interface SniffingResult {
  config: XrayConfig
  /** Теги inbound’ов, которым sniffing реально включили */
  changed: string[]
}

/**
 * Правило по protocol (bittorrent) без sniffing не срабатывает вовсе, поэтому
 * рецепты блокировки включают его сами. Пустой список тегов — «все inbound’ы».
 */
export function ensureSniffing(config: XrayConfig, tags: string[]): SniffingResult {
  const changed: string[] = []
  const inbounds = (config.inbounds ?? []).map((inb) => {
    const tag = inb.tag
    if (typeof tag !== 'string') return inb
    if (tags.length > 0 && !tags.includes(tag)) return inb
    const current = inb.sniffing
    const destOverride = current?.destOverride ?? []
    if (current?.enabled === true && destOverride.length > 0) return inb
    changed.push(tag)
    return {
      ...inb,
      sniffing: {
        ...(current ?? {}),
        enabled: true,
        destOverride: destOverride.length > 0 ? destOverride : ['http', 'tls', 'quic'],
      },
    }
  })
  if (changed.length === 0) return { config, changed }
  return { config: { ...config, inbounds }, changed }
}

const ORDINALS = ['первым', 'вторым', 'третьим', 'четвёртым', 'пятым']

export function ruleOrdinal(index: number): string {
  return ORDINALS[index] ?? `на позиции ${index + 1}`
}

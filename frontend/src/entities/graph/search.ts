// Поиск узла на холсте: на профиле с десятком inbound'ов и двумя десятками правил
// прокрутка — единственный способ найти нужный, и это плохой способ.

import type { XrayConfig } from '../xray'
import { streamNetwork } from '../xray/compat'
import { describeSelector, injectGroupsOf, predictedTags } from '../xray/inject'
import type { GraphContext } from './types'

export interface SearchHit {
  nodeId: string
  kind: 'inbound' | 'outbound' | 'rule' | 'squad' | 'dns' | 'balancer' | 'inject'
  title: string
  /** Чем совпало — иначе в списке правил непонятно, почему они там */
  matchedOn: string
}

const LIMIT = 20

/** Первое совпавшее поле: показываем одну причину, а не все сразу */
function firstMatch(needle: string, fields: { label: string; value: unknown }[]): string | undefined {
  for (const { label, value } of fields) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item === undefined || item === null) continue
      const text = String(item)
      if (text.toLowerCase().includes(needle)) return `${label}: ${text}`
    }
  }
  return undefined
}

export function searchNodes(config: XrayConfig, ctx: GraphContext, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const hits: SearchHit[] = []
  const push = (hit: SearchHit) => {
    if (hits.length < LIMIT) hits.push(hit)
  }

  for (const squad of ctx.squads ?? []) {
    const matched = firstMatch(needle, [{ label: 'сквад', value: squad.name }])
    if (matched) {
      push({ nodeId: `squad:${squad.uuid}`, kind: 'squad', title: squad.name, matchedOn: matched })
    }
  }

  for (const inb of config.inbounds ?? []) {
    const matched = firstMatch(needle, [
      { label: 'тег', value: inb.tag },
      { label: 'протокол', value: inb.protocol },
      { label: 'порт', value: inb.port },
      { label: 'транспорт', value: streamNetwork(inb.streamSettings) },
      { label: 'security', value: inb.streamSettings?.security },
    ])
    if (matched) push({ nodeId: `in:${inb.tag}`, kind: 'inbound', title: inb.tag, matchedOn: matched })
  }

  for (const out of config.outbounds ?? []) {
    const matched = firstMatch(needle, [
      { label: 'тег', value: out.tag },
      { label: 'протокол', value: out.protocol },
    ])
    if (matched) {
      push({ nodeId: `out:${out.tag}`, kind: 'outbound', title: out.tag, matchedOn: matched })
    }
  }

  injectGroupsOf(config).forEach((group, index) => {
    const matched = firstMatch(needle, [
      { label: 'селектор', value: describeSelector(group) },
      { label: 'префикс тегов', value: group.tagPrefix },
      // Предсказанные теги ищутся наравне с настоящими: пользователь помнит
      // proxy-2 из правила и не обязан знать, что физически его в конфиге нет
      { label: 'тег', value: predictedTags(group) },
      { label: 'пул', value: group.selectFrom },
    ])
    if (matched) {
      push({
        nodeId: `inj:${index}`,
        kind: 'inject',
        title: `подстановка ${index + 1}`,
        matchedOn: matched,
      })
    }
  })

  for (const bal of config.routing?.balancers ?? []) {
    const matched = firstMatch(needle, [
      { label: 'тег', value: bal.tag },
      { label: 'стратегия', value: bal.strategy?.type },
      { label: 'селектор', value: bal.selector },
    ])
    if (matched) {
      push({ nodeId: `bal:${bal.tag}`, kind: 'balancer', title: bal.tag, matchedOn: matched })
    }
  }

  ;(config.routing?.rules ?? []).forEach((rule, index) => {
    const matched = firstMatch(needle, [
      { label: 'домен', value: rule.domain },
      { label: 'IP', value: rule.ip },
      { label: 'порт', value: rule.port },
      { label: 'протокол', value: rule.protocol },
      { label: 'outbound', value: rule.outboundTag },
      { label: 'inbound', value: rule.inboundTag },
    ])
    if (matched) {
      push({ nodeId: `rule:${index}`, kind: 'rule', title: `правило ${index + 1}`, matchedOn: matched })
    }
  })

  return hits
}

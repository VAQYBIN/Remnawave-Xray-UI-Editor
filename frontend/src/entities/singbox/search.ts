// Поиск узлов графа sing-box по строке. Ищем по тому, что человек видит на
// карточке: тег и тип выхода, тег и тип группы, условия и цель правила.
//
// `firstMatch` берётся из общего модуля, а не пишется своя: результаты всех
// поисков рисует один SearchBox, и «почему нашлось» обязано звучать одинаково.
// У Mihomo здесь была копия, и финальное ревью поймало её разъехавшейся с
// оригиналом дважды — по формату и по поведению.

import { firstMatch, type SearchHit } from '../graph/search'
import { GROUP_OUTBOUND_TYPES, outboundsOf } from './outbounds'
import { conditionKeysOf, ruleAction, ruleTarget, rulesOf } from './rules'
import type { SingboxDoc } from './types'

const LIMIT = 20

export function searchSingbox(doc: SingboxDoc, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const hits: SearchHit[] = []
  const push = (hit: SearchHit) => {
    if (hits.length < LIMIT) hits.push(hit)
  }

  const inbounds = Array.isArray(doc.inbounds) ? doc.inbounds : []
  for (const inbound of inbounds) {
    const tag = inbound.tag
    if (typeof tag !== 'string' || tag === '') continue
    const matched = firstMatch(needle, [
      { label: 'тег', value: tag },
      { label: 'тип', value: inbound.type },
    ])
    if (matched !== undefined) {
      push({ nodeId: `inbound:${tag}`, kind: 'singbox-inbound', title: tag, matchedOn: matched })
    }
  }

  for (const outbound of outboundsOf(doc)) {
    const tag = outbound.tag
    if (typeof tag !== 'string' || tag === '') continue
    const group = GROUP_OUTBOUND_TYPES.has(outbound.type)
    const matched = firstMatch(needle, [
      { label: 'тег', value: tag },
      { label: 'тип', value: outbound.type },
      { label: 'сервер', value: outbound.server },
      { label: 'участник', value: outbound.outbounds },
    ])
    if (matched === undefined) continue
    push({
      nodeId: group ? `group:${tag}` : `out:${tag}`,
      kind: group ? 'singbox-group' : 'singbox-out',
      title: tag,
      matchedOn: matched,
    })
  }

  rulesOf(doc).forEach((rule, index) => {
    const conditions = conditionKeysOf(rule).map((key) => {
      const raw = rule[key]
      return Array.isArray(raw) ? raw.join(', ') : String(raw)
    })
    const matched = firstMatch(needle, [
      { label: 'условие', value: conditions },
      { label: 'цель', value: ruleTarget(rule) },
      { label: 'действие', value: ruleAction(rule) },
      { label: 'набор', value: rule.rule_set },
    ])
    if (matched === undefined) return
    push({
      nodeId: `rule:${index}`,
      kind: 'singbox-rule',
      title: `Правило #${index + 1}`,
      matchedOn: matched,
    })
  })

  return hits
}

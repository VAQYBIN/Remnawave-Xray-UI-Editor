// Поиск узлов графа Mihomo по строке. Ищем по тому, что человек видит на
// карточке: имя группы, тип, участники; имя и тип провайдера; текст правила.

import { groupsOf, providersOf, proxiesOf } from './groups'
import type { MihomoDoc } from './parse'
import { rulesOf } from './rules'
// `firstMatch` берётся отсюда, а не пишется своя: результаты обоих поисков
// рисует один `SearchBox`, и «почему нашлось» обязано звучать одинаково.
// Здесь была копия, и она разъехалась с оригиналом дважды — см. комментарий
// у самой функции.
import { firstMatch, type SearchHit } from '../graph/search'

const LIMIT = 20

export function searchMihomo(md: MihomoDoc, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const hits: SearchHit[] = []
  const push = (hit: SearchHit) => {
    if (hits.length < LIMIT) hits.push(hit)
  }

  for (const group of groupsOf(md)) {
    const matchedOn = firstMatch(needle, [
      { label: 'имя', value: group.name },
      { label: 'тип', value: group.type },
      { label: 'участник', value: group.proxies },
      { label: 'провайдер', value: group.use },
      { label: 'фильтр', value: group.filter },
    ])
    if (matchedOn) {
      push({ nodeId: `group:${group.name}`, kind: 'mihomo-group', title: group.name, matchedOn })
    }
  }

  for (const provider of providersOf(md)) {
    const matchedOn = firstMatch(needle, [
      { label: 'имя', value: provider.name },
      { label: 'тип', value: provider.type },
      { label: 'цепочка', value: provider.dialerProxy },
    ])
    if (matchedOn) {
      push({
        nodeId: `provider:${provider.name}`,
        kind: 'mihomo-provider',
        title: provider.name,
        matchedOn,
      })
    }
  }

  for (const proxy of proxiesOf(md)) {
    const matchedOn = firstMatch(needle, [
      { label: 'имя', value: proxy.name },
      { label: 'тип', value: proxy.type },
      { label: 'сервер', value: proxy.server },
    ])
    if (matchedOn) {
      push({ nodeId: `proxy:${proxy.name}`, kind: 'mihomo-proxy', title: proxy.name, matchedOn })
    }
  }

  for (const entry of rulesOf(md)) {
    const rule = entry.rule
    const matchedOn = firstMatch(needle, [
      { label: 'тип', value: rule?.type },
      { label: 'значение', value: rule?.payload },
      { label: 'цель', value: rule?.target },
      { label: 'текст', value: entry.raw },
    ])
    if (matchedOn) {
      push({
        nodeId: `rule:${entry.index}`,
        kind: 'mihomo-rule',
        title: rule === null ? entry.raw : `${rule.type},${rule.payload ?? ''}`.replace(/,$/, ''),
        matchedOn,
      })
    }
  }

  return hits
}

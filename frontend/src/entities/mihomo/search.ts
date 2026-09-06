// Поиск узлов графа Mihomo по строке. Ищем по тому, что человек видит на
// карточке: имя группы, тип, участники; имя и тип провайдера; текст правила.

import { groupsOf, providersOf } from './groups'
import type { MihomoDoc } from './parse'
import { rulesOf } from './rules'
import type { SearchHit } from '../graph/search'

const LIMIT = 20

/**
 * Первое совпавшее поле — построчная копия `firstMatch` из
 * `entities/graph/search.ts` (поиск по графу Xray), и копия обязана оставаться
 * ПОВЕДЕНЧЕСКОЙ копией. Финальное ревью поймало её разъехавшейся сразу дважды:
 *  - список сравнивался склеенным через пробел (`value.join(' ')`), из-за чего у
 *    группы с `proxies: [ru, us]` запрос «ru us» давал ЛОЖНОЕ совпадение по
 *    подстроке шва, которой в документе нет. Сравнение поэлементное;
 *  - `matchedOn` возвращался голой меткой («имя»), а оригинал — «метка: значение».
 *    В списке результатов рядом с хитами Xray это выглядело как разные виды
 *    подсказки, хотя рисует их один `SearchBox`.
 * Тот же корень, поэтому и починка одна: копия приведена к оригиналу целиком.
 */
function firstMatch(
  needle: string,
  fields: { label: string; value: string | string[] | undefined }[],
): string | undefined {
  for (const { label, value } of fields) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item === undefined) continue
      if (item.toLowerCase().includes(needle)) return `${label}: ${item}`
    }
  }
  return undefined
}

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

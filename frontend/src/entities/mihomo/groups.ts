// Чтение сущностей шаблона. Никаких z.enum: `type` группы и `behavior` набора
// правил остаются строками, потому что незнакомое значение чужого шаблона должно
// стать диагностикой, а не обрушить разбор всего документа.

import { isMap, isScalar, isSeq } from 'yaml'
import { markerAfterKey } from './marker'
import { dealias, mergedNode } from './merge'
import { rangeOf, sectionNode, type MihomoDoc, type Range } from './parse'

export interface RemnawaveKeys {
  includeProxies?: boolean
  selectRandomProxy?: boolean
  shuffleProxiesOrder?: boolean
}

export interface MihomoGroup {
  index: number
  name: string
  type?: string
  proxies: string[]
  use: string[]
  includeAll: boolean
  filter?: string
  excludeFilter?: string
  hidden: boolean
  remnawave: RemnawaveKeys
  /** В списке proxies стоит комментарий-маркер подстановки */
  hasMarker: boolean
  range: Range
}

function str(md: MihomoDoc, map: unknown, key: string): string | undefined {
  const node = dealias(md, mergedNode(md, map, key))
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined
}

function bool(md: MihomoDoc, map: unknown, key: string): boolean | undefined {
  const node = dealias(md, mergedNode(md, map, key))
  return isScalar(node) && typeof node.value === 'boolean' ? node.value : undefined
}

function strings(md: MihomoDoc, map: unknown, key: string): string[] {
  // `get()` разворачивает в JS-значение только скаляр (см. YAMLMap.get в yaml@2):
  // список остаётся узлом YAMLSeq, поэтому Array.isArray на нём всегда даст false —
  // резолвим его явно через toJSON, а не полагаемся на автоприведение.
  const node = dealias(md, mergedNode(md, map, key))
  if (!isSeq(node)) return []
  const json = node.toJSON()
  return Array.isArray(json) ? json.filter((v): v is string => typeof v === 'string') : []
}

function remnawaveKeys(md: MihomoDoc, map: unknown): RemnawaveKeys {
  const section = dealias(md, mergedNode(md, map, 'remnawave'))
  return {
    includeProxies: bool(md, section, 'include-proxies'),
    selectRandomProxy: bool(md, section, 'select-random-proxy'),
    shuffleProxiesOrder: bool(md, section, 'shuffle-proxies-order'),
  }
}

export function groupsOf(md: MihomoDoc): MihomoGroup[] {
  const node = sectionNode(md, 'proxy-groups')
  if (!isSeq(node)) return []
  const out: MihomoGroup[] = []
  node.items.forEach((item, index) => {
    const range = rangeOf(item)
    const name = str(md, item, 'name')
    if (range === null || name === undefined) return
    out.push({
      index,
      name,
      type: str(md, item, 'type'),
      proxies: strings(md, item, 'proxies'),
      use: strings(md, item, 'use'),
      includeAll:
        bool(md, item, 'include-all') === true || bool(md, item, 'include-all-proxies') === true,
      filter: str(md, item, 'filter'),
      excludeFilter: str(md, item, 'exclude-filter'),
      hidden: bool(md, item, 'hidden') === true,
      remnawave: remnawaveKeys(md, item),
      // Маркер живёт на СОБСТВЕННОМ ключе `proxies` — искать его через слияние не
      // имеет смысла: маркером в шаблоне размечают конкретное место в тексте.
      hasMarker: markerAfterKey(md, item, 'proxies'),
      range,
    })
  })
  return out
}

export interface MihomoProvider {
  name: string
  type?: string
  includeProxies?: boolean
  dialerProxy?: string
  additionalPrefix?: string
  range: Range
}

export function providersOf(md: MihomoDoc): MihomoProvider[] {
  const node = sectionNode(md, 'proxy-providers')
  if (!isMap(node)) return []
  const out: MihomoProvider[] = []
  for (const pair of node.items) {
    const name = (pair.key as { value?: unknown } | null)?.value
    const range = rangeOf(pair.value)
    if (typeof name !== 'string' || range === null) continue
    const override = dealias(md, mergedNode(md, pair.value, 'override'))
    out.push({
      name,
      type: str(md, pair.value, 'type'),
      includeProxies: remnawaveKeys(md, pair.value).includeProxies,
      dialerProxy: str(md, override, 'dialer-proxy'),
      additionalPrefix: str(md, override, 'additional-prefix'),
      range,
    })
  }
  return out
}

export interface RuleProviderRef {
  name: string
  behavior?: string
  range: Range
}

export function ruleProvidersOf(md: MihomoDoc): RuleProviderRef[] {
  const node = sectionNode(md, 'rule-providers')
  if (!isMap(node)) return []
  const out: RuleProviderRef[] = []
  for (const pair of node.items) {
    const name = (pair.key as { value?: unknown } | null)?.value
    const range = rangeOf(pair.value)
    if (typeof name !== 'string' || range === null) continue
    out.push({ name, behavior: str(md, pair.value, 'behavior'), range })
  }
  return out
}

export interface SubRuleEntry {
  name: string
  /** Узел значения подсписка — список строк-правил; не seq, если документ кривой */
  node: unknown
}

/**
 * Записи `sub-rules`. ЕДИНСТВЕННОЕ место, решающее, какие подсписки в документе
 * есть: имена отсюда берут и валидация (через `subRuleNames`), и граф (узлы
 * `subrule:<имя>` в `buildMihomoGraph`), и резолвер диагностик
 * (`mihomoNodeIdForPath`). Собственный обход секции у любого из них разошёлся бы
 * с остальными на первом же нестандартном документе — и узлы графа перестали бы
 * совпадать с тем, на что ссылаются диагностики.
 *
 * Значение отдаём как есть, не проверяя, что это список: «подсписок существует»
 * и «его содержимое разбирается» — разные вопросы, и второй решает потребитель.
 */
export function subRuleEntries(md: MihomoDoc): SubRuleEntry[] {
  const node = sectionNode(md, 'sub-rules')
  if (!isMap(node)) return []
  const out: SubRuleEntry[] = []
  for (const pair of node.items) {
    const name = (pair.key as { value?: unknown } | null)?.value
    if (typeof name !== 'string') continue
    out.push({ name, node: pair.value })
  }
  return out
}

export function subRuleNames(md: MihomoDoc): string[] {
  return subRuleEntries(md).map((e) => e.name)
}

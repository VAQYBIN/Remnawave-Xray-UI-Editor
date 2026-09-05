// Чтение сущностей шаблона. Никаких z.enum: `type` группы и `behavior` набора
// правил остаются строками, потому что незнакомое значение чужого шаблона должно
// стать диагностикой, а не обрушить разбор всего документа.

import { isMap, isSeq } from 'yaml'
import { markerAfterKey } from './marker'
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

function str(map: unknown, key: string): string | undefined {
  if (!isMap(map)) return undefined
  const value = map.get(key)
  return typeof value === 'string' ? value : undefined
}

function bool(map: unknown, key: string): boolean | undefined {
  if (!isMap(map)) return undefined
  const value = map.get(key)
  return typeof value === 'boolean' ? value : undefined
}

function strings(map: unknown, key: string): string[] {
  // `get()` разворачивает в JS-значение только скаляр (см. YAMLMap.get в yaml@2):
  // список остаётся узлом YAMLSeq, поэтому Array.isArray на нём всегда даст false —
  // резолвим его явно через toJSON, а не полагаемся на автоприведение.
  if (!isMap(map)) return []
  const value = map.get(key)
  if (!isSeq(value)) return []
  const json = value.toJSON()
  return Array.isArray(json) ? json.filter((v): v is string => typeof v === 'string') : []
}

function remnawaveKeys(map: unknown): RemnawaveKeys {
  if (!isMap(map)) return {}
  const section = map.get('remnawave')
  return {
    includeProxies: bool(section, 'include-proxies'),
    selectRandomProxy: bool(section, 'select-random-proxy'),
    shuffleProxiesOrder: bool(section, 'shuffle-proxies-order'),
  }
}

export function groupsOf(md: MihomoDoc): MihomoGroup[] {
  const node = sectionNode(md, 'proxy-groups')
  if (!isSeq(node)) return []
  const out: MihomoGroup[] = []
  node.items.forEach((item, index) => {
    const range = rangeOf(item)
    const name = str(item, 'name')
    if (range === null || name === undefined) return
    out.push({
      index,
      name,
      type: str(item, 'type'),
      proxies: strings(item, 'proxies'),
      use: strings(item, 'use'),
      includeAll: bool(item, 'include-all') === true || bool(item, 'include-all-proxies') === true,
      filter: str(item, 'filter'),
      excludeFilter: str(item, 'exclude-filter'),
      hidden: bool(item, 'hidden') === true,
      remnawave: remnawaveKeys(item),
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
    const override = isMap(pair.value) ? pair.value.get('override') : undefined
    out.push({
      name,
      type: str(pair.value, 'type'),
      includeProxies: remnawaveKeys(pair.value).includeProxies,
      dialerProxy: str(override, 'dialer-proxy'),
      additionalPrefix: str(override, 'additional-prefix'),
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
    out.push({ name, behavior: str(pair.value, 'behavior'), range })
  }
  return out
}

export function subRuleNames(md: MihomoDoc): string[] {
  const node = sectionNode(md, 'sub-rules')
  if (!isMap(node)) return []
  return node.items
    .map((pair) => (pair.key as { value?: unknown } | null)?.value)
    .filter((name): name is string => typeof name === 'string')
}

// Чтение сущностей шаблона. Никаких z.enum: `type` группы и `behavior` набора
// правил остаются строками, потому что незнакомое значение чужого шаблона должно
// стать диагностикой, а не обрушить разбор всего документа.

import { isAlias, isMap, isScalar, isSeq } from 'yaml'
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

/** Пара по СОБСТВЕННОМУ ключу отображения — без учёта `<<`. */
function ownPair(map: unknown, key: string) {
  if (!isMap(map)) return undefined
  return map.items.find((p) => (p.key as { value?: unknown } | null)?.value === key)
}

/**
 * Узел значения ключа `key` в отображении `map` с учётом YAML-слияния `<<`:
 * `map.get()` слияние не разворачивает (см. YAMLMap.get в yaml@2 — читает только
 * items текущего отображения), а на живых шаблонах Mihomo `behavior` набора правил
 * и `type` провайдера сплошь и рядом заданы не собственным ключом, а якорем
 * (`<<: *rp_domain`). Без обхода `<<` такое поле всегда было бы `undefined`, хотя
 * ядро видит значение через слияние.
 *
 * Семантика YAML сохранена: собственный ключ побеждает всегда; если `<<` —
 * список алиасов, более ранний побеждает более поздний (первое совпадение по
 * порядку в цикле); поиск рекурсивный — алиас может сам ссылаться на отображение
 * со своим `<<`. `seen` защищает от зацикленных ссылок.
 */
function mergedNode(md: MihomoDoc, map: unknown, key: string, seen: Set<unknown> = new Set()): unknown {
  if (!isMap(map) || seen.has(map)) return undefined
  seen.add(map)
  const own = ownPair(map, key)
  if (own) return own.value
  const mergePair = ownPair(map, '<<')
  if (!mergePair) return undefined
  const targets = isSeq(mergePair.value) ? mergePair.value.items : [mergePair.value]
  for (const target of targets) {
    const resolved = isAlias(target) ? target.resolve(md.doc) : target
    const value = mergedNode(md, resolved, key, seen)
    if (value !== undefined) return value
  }
  return undefined
}

/** Разворачивает алиас в узел, на который он ссылается (для значений вида `key: *alias`) */
function dealias(md: MihomoDoc, node: unknown): unknown {
  return isAlias(node) ? node.resolve(md.doc) : node
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

export function subRuleNames(md: MihomoDoc): string[] {
  const node = sectionNode(md, 'sub-rules')
  if (!isMap(node)) return []
  return node.items
    .map((pair) => (pair.key as { value?: unknown } | null)?.value)
    .filter((name): name is string => typeof name === 'string')
}

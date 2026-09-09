// Заготовки записей для меню «+ Добавить» и разделов панели «Документ».
// Каждая — минимум, который ядро примет и который сразу виден на холсте; тег
// уникален в своём пространстве имён. У выходов пространство общее с
// конечными точками: узел out:<tag> граф рисует по обоим спискам.

import { outboundsOf } from './outbounds'
import type { SingboxDoc, SingboxInbound, SingboxOutbound, SingboxRule, SingboxRuleSet } from './types'

export function uniqueTag(taken: Iterable<string>, base: string): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!set.has(candidate)) return candidate
  }
}

const tagsOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map((item) => (item as { tag?: unknown } | null)?.tag)
    .filter((t): t is string => typeof t === 'string')

const outboundTags = (doc: SingboxDoc): string[] => [...tagsOf(outboundsOf(doc)), ...tagsOf(doc.endpoints)]

export function startInbound(doc: SingboxDoc): SingboxInbound {
  return { type: 'mixed', tag: uniqueTag(tagsOf(doc.inbounds), 'mixed-in'), listen: '127.0.0.1', listen_port: 2080 }
}

export function startOutbound(doc: SingboxDoc): SingboxOutbound {
  return { type: 'direct', tag: uniqueTag(outboundTags(doc), 'direct') }
}

export function startServer(doc: SingboxDoc): SingboxOutbound {
  return { type: 'vless', tag: uniqueTag(outboundTags(doc), 'server'), server: '', server_port: 443, uuid: '' }
}

/** Список пуст намеренно: его заполнит панель, а «закрепить» можно кнопкой в форме */
export function startGroup(doc: SingboxDoc): SingboxOutbound {
  return { type: 'selector', tag: uniqueTag(outboundTags(doc), 'select'), outbounds: [] }
}

export function startEndpoint(doc: SingboxDoc): Record<string, unknown> {
  return { type: 'wireguard', tag: uniqueTag(outboundTags(doc), 'wg'), address: [], private_key: '', peers: [] }
}

export function startDnsServer(doc: SingboxDoc): Record<string, unknown> {
  return { type: 'udp', tag: uniqueTag(tagsOf(doc.dns?.servers), 'dns'), server: '1.1.1.1' }
}

/** Цель — первый сервер: правило без server ядро не примет, а первый сервер есть у любого рабочего документа */
export function startDnsRule(doc: SingboxDoc): SingboxRule {
  return { domain_suffix: [], server: tagsOf(doc.dns?.servers)[0] ?? '' }
}

export function startRuleSet(doc: SingboxDoc): SingboxRuleSet {
  return { type: 'remote', tag: uniqueTag(tagsOf(doc.route?.rule_set), 'ruleset'), format: 'binary', url: '' }
}

/** Id узла графа для только что вставленной записи — чтобы сразу открыть её в инспекторе */
export function nodeIdOf(value: { type?: unknown; tag?: unknown }, list: 'inbounds' | 'outbounds' | 'endpoints'): string | null {
  const tag = typeof value.tag === 'string' && value.tag !== '' ? value.tag : null
  if (tag === null) return null
  if (list === 'inbounds') return `inbound:${tag}`
  const type = typeof value.type === 'string' ? value.type : ''
  return list === 'outbounds' && (type === 'selector' || type === 'urltest') ? `group:${tag}` : `out:${tag}`
}

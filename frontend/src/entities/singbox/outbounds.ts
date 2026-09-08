// Выходы документа и то, что с ними сделает панель.
//
// Всё знание о генераторе панели собрано ЗДЕСЬ, а не размазано по графу и
// формам: генератор — чужой код, он изменится, и тогда правка должна быть в
// одном файле. Источник: remnawave/backend,
// src/modules/subscription-template/generators/singbox.generator.service.ts.

import type { SingboxDoc, SingboxOutbound } from './types'

/** Типы, которые панель считает прокси при заполнении групп */
export const PROXY_OUTBOUND_TYPES: ReadonlySet<string> = new Set([
  'vless',
  'trojan',
  'shadowsocks',
  'hysteria2',
])

export const GROUP_OUTBOUND_TYPES: ReadonlySet<string> = new Set(['selector', 'urltest'])

export function outboundsOf(doc: SingboxDoc): SingboxOutbound[] {
  return Array.isArray(doc.outbounds) ? doc.outbounds : []
}

export function groupsOf(doc: SingboxDoc): SingboxOutbound[] {
  return outboundsOf(doc).filter((o) => GROUP_OUTBOUND_TYPES.has(o.type))
}

/**
 * Заполнит ли панель список этой группы. Единственный способ отказаться —
 * `remnawave.includeProxies: false`; никакого маркера в тексте у sing-box нет,
 * решает ТИП выхода.
 */
export function panelFillsGroup(group: SingboxOutbound): boolean {
  if (!GROUP_OUTBOUND_TYPES.has(group.type)) return false
  return group.remnawave?.includeProxies !== false
}

/**
 * Теги ИЗ ДОКУМЕНТА, которые панель положит в группу. Серверов подписки здесь
 * нет и быть не может: их имена — примечания хостов, редактору неизвестные.
 */
export function panelFilledTags(doc: SingboxDoc, group: SingboxOutbound): string[] {
  if (!panelFillsGroup(group)) return []
  const all = outboundsOf(doc)
  const proxies = all
    .filter((o) => PROXY_OUTBOUND_TYPES.has(o.type))
    .map((o) => o.tag)
    .filter((tag): tag is string => typeof tag === 'string')
  if (group.type === 'urltest') return proxies
  const urltests = all
    .filter((o) => o.type === 'urltest')
    .map((o) => o.tag)
    .filter((tag): tag is string => typeof tag === 'string')
  return [...proxies, ...urltests]
}

/** Получит ли документ серверы от панели хоть куда-нибудь */
export function documentGetsPanelServers(doc: SingboxDoc): boolean {
  return groupsOf(doc).some(panelFillsGroup)
}

/**
 * Куда уйдёт трафик, не совпавший ни с одним правилом. `route.final` — тег
 * выхода; при пустом `final` ядро берёт ПЕРВЫЙ элемент `outbounds`
 * (документация sing-box, раздел route). Панель дописывает серверы в конец,
 * поэтому дефолт всегда задаёт шаблон — но задаёт его позицией элемента, а не
 * явным полем, и увидеть это глазами нельзя.
 */
export function defaultRoute(doc: SingboxDoc): { tag?: string; fromFinal: boolean } {
  const final = doc.route?.final
  if (typeof final === 'string' && final !== '') return { tag: final, fromFinal: true }
  const first = outboundsOf(doc)[0]
  return { tag: typeof first?.tag === 'string' ? first.tag : undefined, fromFinal: false }
}

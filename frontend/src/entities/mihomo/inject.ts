// Панель подставляет хосты туда, где стоит комментарий-маркер. Ключи remnawave
// уточняют, что именно попадёт в группу. Имена подставленных хостов НЕ
// предсказуемы: их даёт панель из примечаний хоста, а какие хосты подойдут под
// filter — знает только она. Отсюда мягкость всех проверок, опирающихся на имена.

import type { MihomoGroup } from './groups'
import { markerAfterKey } from './marker'
import type { MihomoDoc } from './parse'

export { INJECT_MARKER } from './marker'

/**
 * Есть ли маркер на корневом `proxies`. Его отсутствие ошибкой НЕ является:
 * в фикстуре `simple` из официального репозитория его нет, и шаблон рабочий.
 */
export function hasRootMarker(md: MihomoDoc): boolean {
  return markerAfterKey(md, md.doc.contents, 'proxies')
}

/** Положит ли панель в группу хоть что-нибудь */
export function groupGetsHosts(group: MihomoGroup): boolean {
  if (group.remnawave.includeProxies === false) return false
  if (group.remnawave.selectRandomProxy === true) return true
  if (group.remnawave.shuffleProxiesOrder === true) return true
  return group.hasMarker || group.includeAll || group.use.length > 0
}

/** Ключи, взаимно исключающие друг друга: обе выборки сразу невыразимы */
export function conflictingKeys(group: MihomoGroup): boolean {
  return group.remnawave.selectRandomProxy === true && group.remnawave.shuffleProxiesOrder === true
}

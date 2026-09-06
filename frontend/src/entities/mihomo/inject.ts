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

/**
 * Подставит ли панель хосты В САМУ ГРУППУ. Основания — только те, что говорят
 * о подстановке: маркер `# LEAVE THIS LINE!` в списке `proxies`, `include-all`
 * и ключи выборки `select-random-proxy`/`shuffle-proxies-order`;
 * `include-proxies: false` отменяет всё разом.
 *
 * `use` здесь НЕ основание, и это главное отличие от `groupGetsHosts` ниже:
 * провайдер — отдельная сущность со своим узлом на холсте, хосты панель кладёт
 * в НЕГО, а не в группу. Находка ревью (финальный раунд): раньше на оба вопроса
 * отвечал один предикат, и группа с `use: [p1]` И маркером теряла на холсте узел
 * подстановки (условие `groupGetsHosts(group) && use.length === 0` гасило его
 * из-за `use`), хотя маркер стоял и панель хосты подставит. Карточка при этом
 * показывала «если панель подставит хосты — сюда»: две части модели рассказывали
 * про один документ разные истории. Вопросы разные — предикатов тоже два.
 */
export function panelInjectsHosts(group: MihomoGroup): boolean {
  if (group.remnawave.includeProxies === false) return false
  if (group.remnawave.selectRandomProxy === true) return true
  if (group.remnawave.shuffleProxiesOrder === true) return true
  return group.hasMarker || group.includeAll
}

/**
 * Положит ли панель в группу хоть что-нибудь — вопрос «группа не останется
 * пустой», и только он. Отвечает на него `validate.ts`, где пустая группа —
 * предупреждение: заполнить её может и провайдер из `use`, поэтому здесь `use`
 * основание, а в `panelInjectsHosts` — нет. За узел подстановки на холсте этот
 * предикат больше не отвечает.
 */
export function groupGetsHosts(group: MihomoGroup): boolean {
  if (panelInjectsHosts(group)) return true
  if (group.remnawave.includeProxies === false) return false
  return group.use.length > 0
}

/** Ключи, взаимно исключающие друг друга: обе выборки сразу невыразимы */
export function conflictingKeys(group: MihomoGroup): boolean {
  return group.remnawave.selectRandomProxy === true && group.remnawave.shuffleProxiesOrder === true
}

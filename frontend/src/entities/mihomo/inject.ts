// Куда панель кладёт хосты — по КЛЮЧАМ документа, а не по комментарию:
// генератор панели (mihomo.generator.service.ts) разбирает YAML в объект,
// комментарии при этом теряются, и `# LEAVE THIS LINE!` — подсказка человеку,
// не адрес. Серверы дописываются В КОНЕЦ корневого proxies всегда, их имена —
// В КОНЕЦ proxies каждой группы без include-proxies: false. Имена хостов при
// этом непредсказуемы: их даёт панель из примечаний хоста.

import type { MihomoGroup } from './groups'

/** Допишет ли панель имена хостов в список этой группы */
export function panelInjectsHosts(group: MihomoGroup): boolean {
  return group.remnawave.includeProxies !== false
}

/**
 * Попадут ли хосты в группу вообще — узел подстановки на холсте. Второе
 * основание — include-all/include-all-proxies: панель ничего не дописывает,
 * но ядро на клиенте соберёт группу из корневого proxies, куда панель хосты
 * уже положила (так устроены группы roscomvpn с include-proxies: false).
 */
export function groupTakesHosts(group: MihomoGroup): boolean {
  return panelInjectsHosts(group) || group.includeAll
}

/** Не останется ли группа пустой — предупреждение валидации; провайдеры сюда входят */
export function groupGetsHosts(group: MihomoGroup): boolean {
  return groupTakesHosts(group) || group.includeAllProviders || group.use.length > 0
}

/** Ключи, взаимно исключающие друг друга: обе выборки сразу невыразимы */
export function conflictingKeys(group: MihomoGroup): boolean {
  return group.remnawave.selectRandomProxy === true && group.remnawave.shuffleProxiesOrder === true
}

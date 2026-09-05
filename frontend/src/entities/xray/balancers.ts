// Балансеры маршрутизации. Ключевая деталь домена: selector матчит теги outbound'ов
// ПО ПРЕФИКСУ — ["proxy-"] захватывает proxy-de и proxy-nl. Единственная реализация
// этого правила живёт здесь; граф, формы, валидации, трассировка и рецепт зовут её.

import { z } from 'zod'
import type { XrayConfig } from './config'
import { hasPanelNamedTags, injectGroupsOf, injectedTagsOf, predictedTags } from './inject'

export const BALANCER_STRATEGIES = ['random', 'roundRobin', 'leastPing', 'leastLoad'] as const

// strategy.type — строка, а не z.enum: незнакомая стратегия из чужого конфига должна
// давать предупреждение (analyzeIntegrity), а не рушить разбор всего конфига
export const BalancerSchema = z.looseObject({
  tag: z.string(),
  selector: z.array(z.string()).optional(),
  fallbackTag: z.string().optional(),
  strategy: z
    .looseObject({
      type: z.string().optional(),
      settings: z.looseObject({}).optional(),
    })
    .optional(),
})

export type Balancer = z.infer<typeof BalancerSchema>

export function matchPrefixes(tags: string[], prefixes: string[] | undefined): string[] {
  const list = prefixes ?? []
  if (list.length === 0) return []
  return tags.filter((tag) => list.some((p) => tag.startsWith(p)))
}

// Для балансера тег инжектируемого хоста НИЧЕМ не отличается от обычного:
// к моменту работы ядра панель уже подставила его в outbounds. Поэтому
// предсказанные теги входят сюда наравне со статическими.
export function outboundTagsOf(config: XrayConfig): string[] {
  const static_ = (config.outbounds ?? [])
    .map((o) => o.tag)
    .filter((t): t is string => typeof t === 'string')
  return [...static_, ...injectedTagsOf(config)]
}

export function balancerCandidates(config: XrayConfig, balancer: Balancer): string[] {
  return matchPrefixes(outboundTagsOf(config), balancer.selector)
}

export function findBalancer(config: XrayConfig, tag: string): Balancer | undefined {
  return (config.routing?.balancers ?? []).find((b) => b.tag === tag)
}

/**
 * Префиксы, которые в новом селекторе останутся префиксами: развернуть группу
 * подстановки в точные теги нельзя — сколько серверов подставит панель, знает
 * только она.
 *
 * Обычный префикс сохраняется как есть, чтобы состав кандидатов не поехал:
 * `['proxy-']` ловит proxy-2 и proxy-3, но не proxy, и подмена его на tagPrefix
 * группы добавила бы балансеру выход, которого пользователь не просил. А вот
 * пустой префикс сохранять нечем — он ловит вообще всё, включая убираемый
 * выход, — поэтому он и только он подменяется на tagPrefix'ы пойманных групп.
 */
function keptInjectPrefixes(config: XrayConfig, selector: string[]): string[] {
  const kept: string[] = []
  const add = (prefix: string) => {
    if (prefix !== '' && !kept.includes(prefix)) kept.push(prefix)
  }
  for (const prefix of selector) {
    for (const group of injectGroupsOf(config)) {
      const tags = predictedTags(group)
      if (matchPrefixes(tags, [prefix]).length === 0) continue
      add(prefix === '' ? (group.tagPrefix ?? '') : prefix)
    }
  }
  return kept
}

/**
 * Разворот селектора неразрешим ЦЕЛИКОМ: в документе есть группа, теги которой
 * знает только панель. Какие теги она подставит, редактор не знает по
 * определению — значит любой префикс селектора может ловить их, и замена его
 * точными статическими тегами молча выбросила бы выходы, которых в документе
 * нет. Запрет поэтому глобальный, а не по конкретному префиксу: разрешимость
 * зависит от документа, а не от разрываемого ребра.
 *
 * Разворачивать пустой селектор нечего, поэтому на нём запрета нет.
 */
export function expandBlockedByPanelTags(config: XrayConfig, balancerTag: string): boolean {
  const balancer = findBalancer(config, balancerTag)
  if (!balancer || (balancer.selector ?? []).length === 0) return false
  return hasPanelNamedTags(config)
}

/**
 * Сохраняемый префикс, который вдобавок ловит сам dropTag. Пока он в
 * селекторе, убрать dropTag нечем: сохраним префикс — выход вернётся,
 * развернём — сломается группа. Возвращает такой префикс, если он есть;
 * иначе undefined.
 */
export function blockingInjectPrefix(
  config: XrayConfig,
  balancerTag: string,
  dropTag: string,
): string | undefined {
  const balancer = findBalancer(config, balancerTag)
  if (!balancer) return undefined
  const selector = balancer.selector ?? []
  // Ранний отказ при тегах от панели: блокирует тот самый префикс, которым выход
  // и попал в балансер, — предсказанных тегов, по которым его вычислял бы
  // keptInjectPrefixes, у такой группы нет вовсе
  if (expandBlockedByPanelTags(config, balancerTag)) {
    return selector.find((p) => dropTag.startsWith(p))
  }
  return keptInjectPrefixes(config, selector).find((p) => dropTag.startsWith(p))
}

/**
 * Разворачивает selector в точные теги текущих СТАТИЧЕСКИХ кандидатов, выбрасывая
 * dropTag. Префиксы групп подстановки переносятся как есть — см. keptInjectPrefixes:
 * обычный префикс тем же значением, что стояло в selector, пустой — tagPrefix'ами
 * пойманных групп. Неизвестный балансер, неразрешимый конфликт префикса и группа с
 * тегами от панели — ТОТ ЖЕ конфиг.
 */
export function expandSelector(
  config: XrayConfig,
  balancerTag: string,
  dropTag: string,
): XrayConfig {
  const index = (config.routing?.balancers ?? []).findIndex((b) => b.tag === balancerTag)
  if (index === -1) return config
  // Отдельно от blockingInjectPrefix: тот отвечает за конкретный префикс и вернёт
  // undefined, если dropTag не начинается ни с одного из них, — а запрет по тегам
  // от панели не зависит от разрываемого ребра
  if (expandBlockedByPanelTags(config, balancerTag)) return config
  if (blockingInjectPrefix(config, balancerTag, dropTag) !== undefined) return config
  const selector = config.routing!.balancers![index]!.selector ?? []
  const kept = keptInjectPrefixes(config, selector)
  const statics = (config.outbounds ?? []).map((o) => o.tag)
  const expanded = matchPrefixes(
    statics,
    selector.filter((p) => !kept.includes(p)),
  ).filter((t) => t !== dropTag)
  const next = structuredClone(config)
  // Префиксы групп встают в начало независимо от их позиции в исходном selector:
  // порядок в selector семантики не несёт, это не потеря информации
  next.routing!.balancers![index]!.selector = [...kept, ...expanded]
  return next
}

// Балансеры маршрутизации. Ключевая деталь домена: selector матчит теги outbound'ов
// ПО ПРЕФИКСУ — ["proxy-"] захватывает proxy-de и proxy-nl. Единственная реализация
// этого правила живёт здесь; граф, формы, валидации, трассировка и рецепт зовут её.

import { z } from 'zod'
import type { XrayConfig } from './config'
import { injectedTagsOf } from './inject'

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
 * Разворачивает selector в точные теги текущих кандидатов, выбрасывая dropTag.
 * Нужно разрыву ребра, кандидат которого пришёл из префикса: убрать одного,
 * не переписав префикс, нельзя. Неизвестный балансер — ТОТ ЖЕ конфиг.
 */
export function expandSelector(
  config: XrayConfig,
  balancerTag: string,
  dropTag: string,
): XrayConfig {
  const index = (config.routing?.balancers ?? []).findIndex((b) => b.tag === balancerTag)
  if (index === -1) return config
  const next = structuredClone(config)
  const balancer = next.routing!.balancers![index]!
  balancer.selector = balancerCandidates(config, balancer).filter((t) => t !== dropTag)
  return next
}

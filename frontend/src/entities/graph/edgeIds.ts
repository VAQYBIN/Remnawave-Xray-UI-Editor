// Схема id ребра — `e:<источник>-><цель>`. Живёт в одном месте, потому что её
// независимо строят buildGraph (рисует рёбра) и tracedEdgeIds (подсвечивает
// победивший путь), а разбирает disconnectEdge. Для инжектируемых тегов они
// однажды уже разошлись — граф вёл ребро в inj:<index>, подсветка в out:<tag>, —
// и подсветка обрывалась. Теперь обе стороны зовут outboundTargets отсюда.

import type { XrayConfig } from '../xray'
import { injectedTagOwners } from '../xray/inject'

export function edgeId(source: string, target: string): string {
  return `e:${source}->${target}`
}

/**
 * Запасной выход балансера. Свой префикс цели нужен потому, что один и тот же
 * тег бывает и кандидатом, и fallback'ом, а два ребра с одним id ломают React Flow.
 */
export function fallbackEdgeId(balancerTag: string, outboundTag: string): string {
  return edgeId(`bal:${balancerTag}`, `fb:${outboundTag}`)
}

/**
 * Разрешение тега outbound'а в узел-цель. Возвращает функцию, а не значение:
 * карта владельцев тегов строится один раз на конфиг, а зовут её на каждое ребро.
 * Тег группы подстановки ведёт к её узлу — статического out:<tag> для него нет.
 */
export function outboundTargets(config: XrayConfig): (tag: string) => string | undefined {
  const owners = injectedTagOwners(config)
  const statics = new Set((config.outbounds ?? []).map((o) => o.tag))
  return (tag) => {
    const owner = owners.get(tag)
    if (owner !== undefined) return `inj:${owner}`
    return statics.has(tag) ? `out:${tag}` : undefined
  }
}

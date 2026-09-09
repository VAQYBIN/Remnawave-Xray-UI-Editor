// Рецепт «Блокировка рекламы»: один готовый набор каталога и правило reject
// В НАЧАЛО списка — реклама режется раньше, чем до неё доберётся любое другое
// правило маршрута. DNS-правило опционально: часть рекламных доменов клиент
// резолвит до того, как соединение попадёт в route.rules.

import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { ensureAt, ensureCacheFile } from './apply'
import { sourceById } from './catalog'

const SOURCE_ID = 'geosite-category-ads-all'

export interface AdsParams {
  /** Заодно резолвить рекламные домены в NXDOMAIN на уровне DNS, а не только маршрута */
  alsoDns: boolean
}

export const ADS_DEFAULTS: AdsParams = { alsoDns: false }

// Параметров, которые можно набрать неверно, здесь нет — либо ставить
// DNS-правило, либо нет
export function validateAds(_p: AdsParams): string | null {
  return null
}

export function planAds(doc: SingboxDoc, p: AdsParams): RecipePlan<SingboxDoc> {
  const changes: RecipeChange[] = []
  let next = doc
  const source = sourceById(SOURCE_ID)
  if (source === undefined) return { model: doc, changes: [], notes: [] }

  const set = ensureAt(next, ['route', 'rule_set'], { type: 'remote', tag: source.tag, format: 'binary', url: source.url }, 'tag', 'end')
  next = set.doc
  changes.push({ status: set.status, text: set.status === 'add' ? `набор ${source.tag}` : `набор ${source.tag} — уже есть` })

  const rule = ensureAt(next, ['route', 'rules'], { rule_set: [source.tag], action: 'reject' }, 'deep', 'start')
  next = rule.doc
  changes.push({ status: rule.status, text: rule.status === 'add' ? 'правило: реклама → reject' : 'правило блокировки рекламы уже есть' })

  if (p.alsoDns) {
    const dnsRule = ensureAt(next, ['dns', 'rules'], { rule_set: [source.tag], action: 'predefined', rcode: 'NXDOMAIN' }, 'deep', 'start')
    next = dnsRule.doc
    changes.push({
      status: dnsRule.status,
      text: dnsRule.status === 'add' ? 'DNS-правило: реклама → NXDOMAIN' : 'DNS-правило блокировки рекламы уже есть',
    })
  }

  const cache = ensureCacheFile(next)
  next = cache.doc
  changes.push({ status: cache.status, text: cache.status === 'add' ? 'experimental.cache_file включён' : 'cache_file уже включён' })

  return {
    model: next,
    changes,
    notes: [{ text: 'Набор скачивает клиент при первом запуске.' }],
  }
}

// Рецепт «Блокировка рекламы»: один готовый набор каталога и правило reject.
// Правило встаёт СРАЗУ ЗА ведущей серией sniff/resolve/route-options/hijack-dns
// (`afterLeadingService`), а не первым: `sniff` в sing-box — такое же правило
// маршрута, а не свойство inbound'а, как у Xray, и до него у большинства
// соединений домен ещё не известен. Поставь рецепт reject первым, он резал бы
// по geosite до того, как sniff вообще определит домен, и правило никогда бы
// не сработало на голом IP. DNS-правило (`alsoDns`) — про другой список,
// `dns.rules`, ведущей последовательности там нет, и оно остаётся первым в
// своём списке.

import { applyOps } from '../../../shared/schema'
import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { afterLeadingService, ensureAt, ensureCacheFile, sameEntry } from './apply'
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

  // Нет 'start'/'end' у ensureAt — нужна произвольная позиция, поэтому та же
  // ручная схема идемпотентности, что и у private.ts
  const ruleEntry = { rule_set: [source.tag], action: 'reject' }
  const existingRule = (next.route?.rules ?? []).findIndex((r) => sameEntry(r, ruleEntry))
  if (existingRule === -1) {
    const index = afterLeadingService(next)
    next = applyOps(next, [{ op: 'insert', path: ['route', 'rules'], index, value: ruleEntry }])
    changes.push({ status: 'add', text: 'правило: реклама → reject' })
  } else {
    changes.push({ status: 'exists', text: 'правило блокировки рекламы уже есть' })
  }

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

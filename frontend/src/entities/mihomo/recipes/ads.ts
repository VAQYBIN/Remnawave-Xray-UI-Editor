// Рецепт «Блокировка рекламы»: готовый набор каталога и правило REJECT.
// Правило встаёт ПЕРВЫМ (`start`), а не перед финальным MATCH: у Mihomo, в
// отличие от sing-box, sniff — не отдельное правило маршрута, а свойство
// inbound'а/поведение ядра, и домен для DOMAIN-* условий известен уже на
// этапе разбора самого правила — вести перед ним нечего.

import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { ensureListEntry, ensureMapEntry, statusText } from './apply'
import { sourceById } from './catalog'

const SOURCE_ID = 'geosite-category-ads-all'

export type AdsParams = Record<string, never>

export const ADS_DEFAULTS: AdsParams = {}

// Параметров, которые можно набрать неверно, здесь нет
export function validateAds(_p: AdsParams): string | null {
  return null
}

export function planAds(md: MihomoDoc, _p: AdsParams): RecipePlan<MihomoDoc> {
  const source = sourceById(SOURCE_ID)
  if (source === undefined) return { model: md, changes: [], notes: [] }

  const provider = ensureMapEntry(md, ['rule-providers'], source.name, {
    type: 'http',
    behavior: source.behavior,
    format: 'mrs',
    url: source.url,
    interval: 86400,
  })
  const changes: RecipeChange[] = [
    { status: provider.status, text: statusText(provider.status, { add: `набор ${source.name}`, exists: `набор ${source.name} — уже есть` }) },
  ]

  const rule = ensureListEntry(provider.md, ['rules'], `RULE-SET,${source.name},REJECT`, 'start')
  changes.push({
    status: rule.status,
    text: statusText(rule.status, { add: 'правило: реклама → REJECT', exists: 'правило блокировки рекламы уже есть' }),
  })

  return {
    model: rule.md,
    changes,
    notes: [
      ...provider.notes,
      ...rule.notes,
      { text: 'Реклама режется на маршруте; DNS-блокировка — nameserver-policy с rcode://success, если нужно' },
    ],
  }
}

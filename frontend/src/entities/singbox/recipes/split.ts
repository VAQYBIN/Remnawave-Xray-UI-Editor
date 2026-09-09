// Рецепт «Разделить трафик по наборам правил»: выбранные категории каталога —
// в один общий выход одним правилом, вместо ручного набора route.rule_set и
// правила под каждую категорию.

import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { ensureAt, ensureCacheFile } from './apply'
import { sourceById } from './catalog'

export interface SplitParams {
  /** id источников из каталога */
  sets: string[]
  /** Тег выхода, куда уйдёт совпавшее */
  outbound: string
}

export const SPLIT_DEFAULTS: SplitParams = { sets: ['geosite-youtube'], outbound: '' }

export function validateSplit(p: SplitParams): string | null {
  if (p.sets.length === 0) return 'Выберите хотя бы один набор правил'
  if (p.outbound.trim() === '') return 'Укажите выход'
  return null
}

export function planSplit(doc: SingboxDoc, p: SplitParams): RecipePlan<SingboxDoc> {
  const changes: RecipeChange[] = []
  let next = doc
  const tags: string[] = []
  for (const id of p.sets) {
    const source = sourceById(id)
    if (source === undefined) continue
    tags.push(source.tag)
    const res = ensureAt(next, ['route', 'rule_set'], { type: 'remote', tag: source.tag, format: 'binary', url: source.url }, 'tag', 'end')
    next = res.doc
    changes.push({ status: res.status, text: res.status === 'add' ? `набор ${source.tag}` : `набор ${source.tag} — уже есть` })
  }
  const rule = ensureAt(next, ['route', 'rules'], { rule_set: tags, outbound: p.outbound }, 'deep', 'end')
  next = rule.doc
  changes.push({ status: rule.status, text: rule.status === 'add' ? `правило: ${tags.join(', ')} → ${p.outbound}` : 'правило уже есть' })
  const cache = ensureCacheFile(next)
  next = cache.doc
  changes.push({ status: cache.status, text: cache.status === 'add' ? 'experimental.cache_file включён' : 'cache_file уже включён' })
  return {
    model: next,
    changes,
    notes: [{ text: 'Наборы скачивает клиент при первом запуске; без включённого cache_file они будут качаться при каждом старте.' }],
  }
}

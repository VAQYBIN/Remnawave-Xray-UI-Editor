// Рецепт «Разделить трафик по наборам правил»: выбранные категории каталога —
// в один общий выход одним правилом RULE-SET на каждый набор, вместо ручного
// заведения rule-providers и правила под каждую категорию. Правило встаёт
// ПЕРЕД финальным MATCH (`before-match`): в этом положении оно решает раньше
// правила «всё остальное», но не расталкивает то, что автор уже расставил
// выше сам.

import type { RecipeChange, RecipeNote, RecipePlan } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { ensureListEntry, ensureMapEntry } from './apply'
import { sourceById } from './catalog'

export interface SplitParams {
  /** id источников из каталога */
  sets: string[]
  /** Цель правила — прокси, группа либо встроенные DIRECT/REJECT */
  target: string
}

export const SPLIT_DEFAULTS: SplitParams = { sets: ['geosite-youtube'], target: '' }

export function validateSplit(p: SplitParams): string | null {
  if (p.sets.length === 0) return 'Выберите хотя бы один набор правил'
  if (p.target.trim() === '') return 'Укажите цель'
  return null
}

export function planSplit(md: MihomoDoc, p: SplitParams): RecipePlan<MihomoDoc> {
  const changes: RecipeChange[] = []
  const notes: RecipeNote[] = []
  let next = md

  for (const id of p.sets) {
    const source = sourceById(id)
    if (source === undefined) continue

    const provider = ensureMapEntry(next, ['rule-providers'], source.name, {
      type: 'http',
      behavior: source.behavior,
      format: 'mrs',
      url: source.url,
      interval: 86400,
    })
    next = provider.md
    notes.push(...provider.notes)
    changes.push({
      status: provider.status,
      text: provider.status === 'add' ? `набор ${source.name}` : `набор ${source.name} — уже есть`,
    })

    // no-resolve нужен только у behavior: ipcidr — правило смотрит IP назначения,
    // и без модификатора ядро сначала резолвило бы домен, которого у RULE-SET,
    // ipcidr-набора без no-resolve может не быть в цели вовсе
    const suffix = source.behavior === 'ipcidr' ? ',no-resolve' : ''
    const rule = ensureListEntry(next, ['rules'], `RULE-SET,${source.name},${p.target}${suffix}`, 'before-match')
    next = rule.md
    notes.push(...rule.notes)
    changes.push({
      status: rule.status,
      text: rule.status === 'add' ? `правило: ${source.name} → ${p.target}` : `правило ${source.name} → ${p.target} — уже есть`,
    })
  }

  return { model: next, changes, notes }
}

// Рецепт «Локальные сети напрямую»: `ip_is_private` не проверяет домен, только
// уже определённый IP назначения — поэтому правило встаёт СРАЗУ ЗА ведущей
// серией sniff/resolve/route-options/hijack-dns (`afterLeadingService`), а не
// первым: без sniff перед ним у большинства соединений ещё нет distIP, по
// которому это условие вообще может сработать.

import { applyOps } from '../../../shared/schema'
import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { afterLeadingService, sameEntry } from './apply'

export interface PrivateParams {
  outbound: string
}

export const PRIVATE_DEFAULTS: PrivateParams = { outbound: '' }

export function validatePrivate(p: PrivateParams): string | null {
  if (p.outbound.trim() === '') return 'Укажите выход'
  return null
}

export function planPrivate(doc: SingboxDoc, p: PrivateParams): RecipePlan<SingboxDoc> {
  const entry = { ip_is_private: true, outbound: p.outbound }
  const rules = doc.route?.rules ?? []
  const existing = rules.findIndex((r) => sameEntry(r, entry))

  if (existing !== -1) {
    return {
      model: doc,
      changes: [{ status: 'exists', text: `правило локальных сетей → ${p.outbound} — уже есть` }],
      notes: [],
    }
  }

  const index = afterLeadingService(doc)
  const next = applyOps(doc, [{ op: 'insert', path: ['route', 'rules'], index, value: entry }])
  const changes: RecipeChange[] = [{ status: 'add', text: `правило: локальные сети → ${p.outbound}` }]
  return { model: next, changes, notes: [] }
}

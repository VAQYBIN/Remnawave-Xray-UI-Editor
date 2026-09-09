// Рецепт «Локальный вход»: mixed-port и allow-lan — те же ключи корня
// документа, что открывает стартер панели (см. test/fixtures/mihomo/default.yaml),
// поэтому на живом шаблоне рецепт почти всегда отвечает «уже есть».

import type { RecipeChange, RecipeNote, RecipePlan } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { ensureScalar } from './apply'

export interface LocalParams {
  port: number
  allowLan: boolean
}

export const LOCAL_DEFAULTS: LocalParams = { port: 7890, allowLan: false }

export function validateLocal(p: LocalParams): string | null {
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) return 'Порт должен быть от 1 до 65535'
  return null
}

export function planLocal(md: MihomoDoc, p: LocalParams): RecipePlan<MihomoDoc> {
  const port = ensureScalar(md, ['mixed-port'], p.port)
  const changes: RecipeChange[] = [
    { status: port.status, text: port.status === 'add' ? `mixed-port = ${p.port}` : 'mixed-port уже задан' },
  ]
  const notes: RecipeNote[] = [...port.notes]
  let next = port.md

  // false — умолчание ядра для allow-lan: как и у CheckboxField, не пишем его в документ
  if (p.allowLan) {
    const lan = ensureScalar(next, ['allow-lan'], true)
    next = lan.md
    notes.push(...lan.notes)
    changes.push({ status: lan.status, text: lan.status === 'add' ? 'allow-lan = true' : 'allow-lan уже задан' })
  }

  return { model: next, changes, notes }
}

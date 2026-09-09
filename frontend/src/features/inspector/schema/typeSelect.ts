// Общий выбор типа для схемных форм sing-box (выход/группа/конечная точка,
// затем правило — задача 16): один и тот же расчёт вариантов и подсказки, а
// не копия в каждой форме.

import type { EnumValue } from '../../../shared/schema'
import type { SelectOption } from '../../../shared/ui'
import { deprecatedNote } from './labels'

/** Варианты схемы плюс текущее значение, если схема его не знает */
export function typeOptions(values: EnumValue[], current: string, notSet = false): SelectOption[] {
  const options = values.map((e) => ({ value: e.value, label: e.value }))
  const head = notSet ? [{ value: '', label: '(не задано)' }] : []
  const extra = current !== '' && !options.some((o) => o.value === current) ? [{ value: current, label: current }] : []
  return [...head, ...extra, ...options]
}

/** Подсказка под селектом: описание значения и, для устаревшего, замена */
export function typeHint(values: EnumValue[], current: string): string | undefined {
  const hit = values.find((e) => e.value === current)
  if (hit === undefined) return undefined
  return hit.deprecated === undefined ? hit.doc : `${hit.doc ?? ''} ${deprecatedNote(hit.deprecated)}`.trim()
}

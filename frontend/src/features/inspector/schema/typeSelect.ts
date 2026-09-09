// Общий выбор типа для схемных форм sing-box (выход/группа/конечная точка,
// затем правило — задача 16): один и тот же расчёт вариантов и подсказки, а
// не копия в каждой форме.

import type { EnumValue } from '../../../shared/schema'
import type { SelectOption } from '../../../shared/ui'
import { deprecatedNote } from './labels'

/**
 * Варианты схемы плюс текущее значение, если схема его не знает или знает его
 * устаревшим. Устаревшие значения не предлагаются заново — панель их и так не
 * пишет, — но текущее пробрасывается собственным пунктом тем же путём, что и
 * вовсе незнакомое значение: спека просит именно «удалённые проходят сквозь с
 * подсказкой замены», а не молчаливую подмену первым живым вариантом.
 */
export function typeOptions(values: EnumValue[], current: string, notSet = false): SelectOption[] {
  const options = values.filter((e) => e.deprecated === undefined).map((e) => ({ value: e.value, label: e.value }))
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

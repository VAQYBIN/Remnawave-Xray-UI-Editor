// Место подстановки хостов панель ищет по комментарию. Комментарий — не данные,
// поэтому и ищем мы его в тексте: любое обращение к разобранной модели зависело
// бы от того, к какому узлу библиотека прицепила комментарий в этот раз.

import { isMap } from 'yaml'
import { rangeOf, type MihomoDoc } from './parse'

// Вторая копия этой строки — backend/src/mihomo/dummyProxies.ts (MARKER). Общих
// файлов между workspace быть не должно, поэтому дублирование неизбежно, но
// связи между копиями нет: правка одной не заметит другую. Меняешь текст
// маркера — проверь и вторую копию.
export const INJECT_MARKER = 'LEAVE THIS LINE!'

/**
 * Есть ли маркер в области ключа `key` отображения `map` — от начала ключа до
 * начала следующего ключа того же отображения (или до конца отображения).
 * Именно в этой области живёт комментарий, к какому бы узлу он ни прицепился.
 */
export function markerAfterKey(md: MihomoDoc, map: unknown, key: string): boolean {
  if (!isMap(map)) return false
  const index = map.items.findIndex((p) => (p.key as { value?: unknown } | null)?.value === key)
  if (index === -1) return false

  const from = rangeOf(map.items[index]!.key as unknown)?.from
  if (from === undefined) return false

  const nextKey = map.items[index + 1]?.key as unknown
  const to = rangeOf(nextKey)?.from ?? rangeOf(map)?.to ?? md.text.length
  return md.text.slice(from, to).includes(INJECT_MARKER)
}

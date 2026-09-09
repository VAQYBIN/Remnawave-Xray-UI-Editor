// Тексты рендерера схемных форм собраны в одном месте: их проверяют тесты и
// документация, а разбросанные по JSX строки разъезжались бы при первой правке.

import type { Deprecation } from '../../../shared/schema'

export const NOT_SET = '(не задано)'

export const UNKNOWN_KEY_NOTE = 'Ключ неизвестен словарю: правится на вкладке JSON.'

export const SHAPE_NOTE =
  'Значение записано в развёрнутой форме, не той, что ждёт словарь; правится на вкладке JSON.'

export function deprecatedNote(d: Deprecation): string {
  return `Устарело с ${d.since}: ${d.replacement}.`
}

export function moreFieldsTitle(count: number): string {
  return `Ещё поля (${count})`
}

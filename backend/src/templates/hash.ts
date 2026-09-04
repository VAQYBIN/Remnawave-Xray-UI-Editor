import { createHash } from 'node:crypto'

/**
 * У шаблонов подписки нет updatedAt, поэтому чужие правки ловятся сравнением
 * содержимого. Хэш считает ТОЛЬКО бэкенд: если бы его вычисляли обе стороны,
 * они разошлись бы на первой же мелочи вроде порядка ключей.
 *
 * Канонизация — рекурсивная сортировка ключей объектов. Порядок элементов
 * массивов значим и сохраняется: в Xray-конфиге порядок правил маршрутизации
 * решает всё.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    // Object.create(null): литерал {} унаследовал бы Object.prototype, и ключ
    // __proto__ из внешнего JSON подменил бы прототип аккумулятора вместо того,
    // чтобы стать собственным свойством, — и молча выпал бы из хэша
    const out: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key])
    return out
  }
  return value
}

/** Хэшируется только templateJson: переименование шаблона в панели — не конфликт содержимого */
export function hashTemplateJson(templateJson: unknown): string {
  const canonical = JSON.stringify(canonicalize(templateJson) ?? null)
  return createHash('sha256').update(canonical).digest('hex')
}

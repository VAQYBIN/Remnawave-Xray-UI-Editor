import { createHash } from 'node:crypto'
import type { SubscriptionTemplate, TemplateType } from '../remnawave/types.js'

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

/** Типы, чьё содержимое лежит в encodedTemplateYaml, а templateJson у них null */
export const YAML_TEMPLATE_TYPES: readonly TemplateType[] = ['MIHOMO', 'CLASH', 'STASH']

/**
 * У YAML-шаблона хэшируется сам текст: канонизировать нечего — текст и есть
 * содержимое. Любая нормализация сделала бы хэш слепым к правке, которую панель
 * сохранит: перестановка ключей в YAML меняет файл, а не только его смысл.
 */
export function hashTemplateYaml(encoded: string | null): string {
  const text = encoded === null ? '' : Buffer.from(encoded, 'base64').toString('utf8')
  return createHash('sha256').update(text).digest('hex')
}

export function hashTemplate(template: SubscriptionTemplate): string {
  return YAML_TEMPLATE_TYPES.includes(template.templateType)
    ? hashTemplateYaml(template.encodedTemplateYaml)
    : hashTemplateJson(template.templateJson)
}

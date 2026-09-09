// Чистые функции по схеме: где в дереве описано место документа и что там
// известно. Ни рендерера, ни ядра здесь нет — только схема и значение.

import type { Condition, Deprecation, FieldSchema, SchemaPath } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Значение соседа как строка; отсутствие и null — пустая строка */
function siblingText(value: unknown, key: string): string {
  const raw = isRecord(value) ? value[key] : undefined
  return raw === undefined || raw === null ? '' : String(raw)
}

export function conditionHolds(cond: Condition | undefined, value: unknown): boolean {
  if (cond === undefined) return true
  const current = siblingText(value, cond.key)
  if (cond.in !== undefined && !cond.in.includes(current)) return false
  if (cond.notIn !== undefined && cond.notIn.includes(current)) return false
  return true
}

/** Поля, чьё условие выполнено или отсутствует */
export function visibleFields(fields: FieldSchema[], value: unknown): FieldSchema[] {
  return fields.filter((field) => conditionHolds(field.when, value))
}

/** Значение по пути; мимо документа — undefined, пустой путь — сам документ */
export function valueAt(doc: unknown, path: SchemaPath): unknown {
  let cur: unknown = doc
  for (const step of path) {
    if (typeof step === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[step]
    } else {
      if (!isRecord(cur)) return undefined
      cur = cur[step]
    }
  }
  return cur
}

/**
 * Поля объекта по пути в документе. Индекс списка идёт следом за ключом
 * списка и не меняет описание: элемент списка — тот же вид объекта, что назвал
 * ключ. Значение по пути НУЖНО только условиям `when`: описание есть и у
 * элемента, которого в документе ещё нет, — подсказке и кнопке добавления
 * оно нужно ДО записи.
 */
export function fieldsAt(root: FieldSchema[], path: SchemaPath, doc: unknown): FieldSchema[] | undefined {
  let fields = root
  let holder: unknown = doc
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    if (typeof step !== 'string') return undefined
    const field = visibleFields(fields, holder).find((f) => f.key === step)
    if (field === undefined) return undefined
    const next = isRecord(holder) ? holder[step] : undefined
    if (field.kind === 'object') {
      fields = field.fields ?? []
      holder = next
      continue
    }
    if (field.kind === 'list') {
      const index = path[i + 1]
      // Путь кончился на самом списке: у списка полей нет, они у элемента
      if (typeof index !== 'number' || field.item?.kind !== 'object') return undefined
      fields = field.item.fields ?? []
      holder = Array.isArray(next) ? next[index] : undefined
      i += 1
      continue
    }
    if (field.kind === 'map' && field.fields !== undefined) {
      const name = path[i + 1]
      if (typeof name !== 'string') return undefined
      fields = field.fields
      holder = isRecord(next) ? next[name] : undefined
      i += 1
      continue
    }
    return undefined
  }
  // Пустой путь — сам корень, ссылкой как есть (ничьё условие ни от чего не
  // зависит). Иначе список нужно отфильтровать по значению, до которого
  // дошёл спуск: индекс списка меняет holder, а условия `when` в fields
  // ещё не применялись к НЕМУ — цикл фильтрует только поле следующего шага.
  return path.length === 0 ? fields : visibleFields(fields, holder)
}

/**
 * Поле, описывающее значение по пути. Для индекса списка либо имени записи
 * отображения — поле самого контейнера: у элемента отдельного описания нет,
 * оно в `item` (список) либо в `fields` самого поля `map` (отображение).
 */
export function fieldAt(root: FieldSchema[], path: SchemaPath, doc: unknown): FieldSchema | undefined {
  if (path.length === 0) return undefined
  const last = path[path.length - 1]
  const parentPath = path.slice(0, -1)
  if (typeof last === 'string') {
    const hit = fieldsAt(root, parentPath, doc)?.find((f) => f.key === last)
    if (hit !== undefined) return hit
  }
  // Индекс списка либо имя записи отображения: описание у самого поля-контейнера
  return parentPath.length === 0 ? undefined : fieldAt(root, parentPath, doc)
}

/** Ключи документа, которых нет среди полей (видимых или скрытых условием) */
export function unknownKeys(fields: FieldSchema[], value: unknown): string[] {
  if (!isRecord(value)) return []
  const known = new Set(fields.map((f) => f.key))
  return Object.keys(value).filter((key) => !known.has(key))
}

export interface DeprecatedEntry {
  key: string
  /** Устаревшее ЗНАЧЕНИЕ перечисления; отсутствует, когда устарел сам ключ */
  value?: string
  deprecation: Deprecation
}

/** Устаревшие ключи и значения перечислений, которые в объекте действительно стоят */
export function deprecatedAt(fields: FieldSchema[], value: unknown): DeprecatedEntry[] {
  if (!isRecord(value)) return []
  const found: DeprecatedEntry[] = []
  for (const field of fields) {
    const current = value[field.key]
    if (current === undefined) continue
    if (field.deprecated !== undefined) {
      found.push({ key: field.key, deprecation: field.deprecated })
      continue
    }
    if (field.kind === 'enum' && field.enum !== undefined && typeof current === 'string') {
      const hit = field.enum.find((e) => e.value === current && e.deprecated !== undefined)
      if (hit?.deprecated !== undefined) {
        found.push({ key: field.key, value: current, deprecation: hit.deprecated })
      }
    }
  }
  return found
}

/**
 * Обход документа по схеме: каждый объект, у которого есть описание, — вызов
 * `visit` с его путём, полями (с учётом условий) и значением. Неизвестные
 * ключи не спускаются: схема их не описывает, и сказать о них нечего.
 */
export function walkSchema(
  root: FieldSchema[],
  doc: unknown,
  visit: (path: SchemaPath, fields: FieldSchema[], value: Record<string, unknown>) => void,
): void {
  const step = (fields: FieldSchema[], value: unknown, path: SchemaPath): void => {
    if (!isRecord(value)) return
    const visible = visibleFields(fields, value)
    visit(path, visible, value)
    for (const field of visible) {
      const child = value[field.key]
      if (child === undefined) continue
      if (field.kind === 'object') step(field.fields ?? [], child, [...path, field.key])
      if (field.kind === 'list' && field.item?.kind === 'object' && Array.isArray(child)) {
        child.forEach((item, i) => step(field.item!.fields ?? [], item, [...path, field.key, i]))
      }
      if (field.kind === 'map' && field.fields !== undefined && isRecord(child)) {
        for (const [name, entry] of Object.entries(child)) step(field.fields, entry, [...path, field.key, name])
      }
    }
  }
  step(root, doc, [])
}

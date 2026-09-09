// Примитивы идемпотентности: «завести, если нет». Сравнение по тегу — для
// записей с адресом; глубокое — для правил, у которых адреса нет.

import { applyOps, valueAt, type SchemaPath } from '../../../shared/schema'
import type { SingboxDoc } from '../types'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameEntry(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

export interface EnsureResult {
  doc: SingboxDoc
  status: 'add' | 'exists'
  index: number
}

export function ensureAt(
  doc: SingboxDoc,
  listPath: SchemaPath,
  entry: Record<string, unknown>,
  matchBy: 'tag' | 'deep',
  placement: 'start' | 'end',
): EnsureResult {
  const raw = valueAt(doc, listPath)
  const list = Array.isArray(raw) ? raw : []
  const found = list.findIndex((item) =>
    matchBy === 'tag' ? (item as { tag?: unknown } | null)?.tag === entry.tag : sameEntry(item, entry),
  )
  if (found >= 0) return { doc, status: 'exists', index: found }
  const index = placement === 'start' ? 0 : list.length
  return { doc: applyOps(doc, [{ op: 'insert', path: listPath, index, value: entry }]), status: 'add', index }
}

/** Позиция сразу за ведущей серией нетерминальных правил (sniff, resolve, route-options, hijack-dns) */
export function afterLeadingService(doc: SingboxDoc): number {
  const rules = doc.route?.rules ?? []
  const service = new Set(['sniff', 'resolve', 'route-options', 'hijack-dns'])
  let i = 0
  while (i < rules.length && typeof rules[i]!.action === 'string' && service.has(rules[i]!.action as string)) i += 1
  return i
}

export function ensureCacheFile(doc: SingboxDoc, extra: Record<string, unknown> = {}): { doc: SingboxDoc; status: 'add' | 'exists' } {
  const current = (doc.experimental?.cache_file ?? {}) as Record<string, unknown>
  const next = { ...current, enabled: true, ...extra }
  if (sameEntry(current, next)) return { doc, status: 'exists' }
  return { doc: applyOps(doc, [{ op: 'set', path: ['experimental', 'cache_file'], value: next }]), status: 'add' }
}

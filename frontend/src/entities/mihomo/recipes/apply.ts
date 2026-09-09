// Примитивы идемпотентности рецептов Mihomo поверх писателя applyMihomoOps:
// «завести значение/запись/элемент списка, если их ещё нет». Отказ писателя
// (путь через алиас `*имя` или ключ из слияния `<<:`) не должен тонуть молча —
// applyOrNote переводит каждый refused в RecipeNote плана, а ensure*-примитивы
// в этом случае отвечают status: 'refused' (документ не изменился, а
// «уже есть» про запись, которую ни разу не записали, — неправда: находка
// ревью финального прохода, 'exists' до этого смешивал два разных исхода).

import type { DocOp, SchemaPath } from '../../../shared/schema'
import { valueAt } from '../../../shared/schema'
import type { RecipeNote } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { rulesOf } from '../rules'
import { applyMihomoOps } from '../write'

export interface EnsureResult {
  md: MihomoDoc
  status: 'add' | 'exists' | 'refused'
  notes: RecipeNote[]
}

/** Применить операции; отказ писателя — заметка плана, а не молчание */
export function applyOrNote(md: MihomoDoc, ops: DocOp[]): { md: MihomoDoc; notes: RecipeNote[] } {
  const res = applyMihomoOps(md, ops)
  return {
    md: res.md,
    notes: res.refused.map((r) => ({ text: `Правка ${r.op.path.join('.')} не применена: ${r.reason}` })),
  }
}

/**
 * Сравнение записей каноническим JSON — та же функция, что у sing-box
 * (`entities/singbox/recipes/apply.ts`): общего модуля между ядрами для неё
 * нет, три строки, копировать дешевле, чем заводить зависимость между
 * сущностями двух разных ядер.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Запись с `name` (прокси, группа) сравнивается по имени; строка — дословно; прочее — глубоко */
function sameEntry(a: unknown, b: unknown): boolean {
  const an = (a as { name?: unknown } | null)?.name
  const bn = (b as { name?: unknown } | null)?.name
  if (typeof an === 'string' && typeof bn === 'string') return an === bn
  return canonical(a) === canonical(b)
}

/**
 * Позиция перед финальным `MATCH`: если последнее правило — `MATCH`, новая
 * запись встаёт на его место (сдвигая его в конец), иначе — в конец списка.
 * Список правил читаем через `rulesOf` (`entities/mihomo/rules.ts`) — это то
 * же самое разобранное представление, что видит трассировка и форма правила,
 * а не вторая копия разбора строки.
 */
export function beforeFinalMatch(md: MihomoDoc): number {
  const rules = rulesOf(md)
  const last = rules[rules.length - 1]
  return last?.rule?.type === 'MATCH' ? last.index : rules.length
}

export function ensureListEntry(
  md: MihomoDoc,
  listPath: SchemaPath,
  entry: unknown,
  placement: 'start' | 'end' | 'before-match',
): EnsureResult {
  const raw = valueAt(md.json, listPath)
  const list = Array.isArray(raw) ? raw : []
  if (list.some((item) => sameEntry(item, entry))) return { md, status: 'exists', notes: [] }
  const index = placement === 'start' ? 0 : placement === 'end' ? list.length : beforeFinalMatch(md)
  const res = applyOrNote(md, [{ op: 'insert', path: listPath, index, value: entry }])
  return { md: res.md, status: res.notes.length > 0 ? 'refused' : 'add', notes: res.notes }
}

export function ensureMapEntry(
  md: MihomoDoc,
  mapPath: SchemaPath,
  name: string,
  value: Record<string, unknown>,
): EnsureResult {
  const raw = valueAt(md.json, mapPath)
  if (typeof raw === 'object' && raw !== null && name in (raw as object)) return { md, status: 'exists', notes: [] }
  const res = applyOrNote(md, [{ op: 'set', path: [...mapPath, name], value }])
  return { md: res.md, status: res.notes.length > 0 ? 'refused' : 'add', notes: res.notes }
}

export function ensureScalar(md: MihomoDoc, path: SchemaPath, value: string | number | boolean): EnsureResult {
  if (valueAt(md.json, path) !== undefined) return { md, status: 'exists', notes: [] }
  const res = applyOrNote(md, [{ op: 'set', path, value }])
  return { md: res.md, status: res.notes.length > 0 ? 'refused' : 'add', notes: res.notes }
}

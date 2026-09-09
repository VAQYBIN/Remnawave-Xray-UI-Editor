// Строители полей схемы — общие для ядер: описание поля собирается одной
// строкой, а не объектным литералом на пять строк. Переехали сюда из
// entities/singbox/schema/shared.ts, когда второе ядро (Mihomo) стало писать
// свою схему: копия строителей разошлась бы с первой на первом же новом виде поля.

import type { Condition, Deprecation, EnumValue, FieldSchema, ListItemSchema } from './types'

type Extra = Partial<Omit<FieldSchema, 'key' | 'doc' | 'kind'>>

export const str = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'string', ...extra })
export const num = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'number', ...extra })
export const bool = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'boolean', ...extra })
/** Отображение строка → строка; `values: 'strings'` — строка либо список строк (пишется списком) */
export const map = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'map', ...extra })

export const en = (key: string, doc: string, values: (string | EnumValue)[], extra: Extra = {}): FieldSchema => ({
  key, doc, kind: 'enum', enum: values.map((v) => (typeof v === 'string' ? { value: v } : v)), ...extra,
})

/**
 * Список строк; `values` в `extra` — известные значения ЭЛЕМЕНТОВ (network:
 * tcp/udp), а не поле `FieldSchema.values` (вид значений `map`) — свой смысл
 * у списка, свой у отображения, отсюда `Omit`: без него интерсекция дала бы
 * `('string'|'strings') & (string|EnumValue)[]`, тип, которому нельзя
 * присвоить ни одно значение.
 */
export const strs = (key: string, doc: string, extra: Omit<Extra, 'values'> & { values?: (string | EnumValue)[]; ref?: FieldSchema['ref'] } = {}): FieldSchema => {
  const { values, ref, ...rest } = extra
  const item: ListItemSchema = { kind: 'string' }
  if (values !== undefined) item.enum = values.map((v) => (typeof v === 'string' ? { value: v } : v))
  if (ref !== undefined) item.ref = ref
  return { key, doc, kind: 'list', item, ...rest }
}

export const nums = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'number' }, ...extra })

/** Список портов: число либо строка-диапазон (`[80, 8080-8880]`); строка из одних цифр пишется числом */
export const ports = (key: string, doc: string, extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'port' }, ...extra })

export const obj = (key: string, doc: string, fields: FieldSchema[], extra: Extra = {}): FieldSchema => ({ key, doc, kind: 'object', fields, ...extra })

/** Список объектов; `item` — подпись и стартер элемента */
export const objs = (
  key: string, doc: string, fields: FieldSchema[],
  item: Pick<ListItemSchema, 'label' | 'starter'> = {}, extra: Extra = {},
): FieldSchema => ({ key, doc, kind: 'list', item: { kind: 'object', fields, ...item }, ...extra })

export const when = (key: string, ...values: string[]): Condition => ({ key, in: values })
export const whenNot = (key: string, ...values: string[]): Condition => ({ key, notIn: values })

/** Копия фрагмента с условием на каждом поле; исходный фрагмент не трогается */
export const withWhen = (fields: FieldSchema[], cond: Condition): FieldSchema[] => fields.map((f) => ({ ...f, when: cond }))

export const removed = (since: string, replacement: string): Deprecation => ({ since, replacement })

/** Подпись элемента списка: тег, иначе номер */
export const tagLabel = (value: unknown, index: number): string => {
  const tag = (value as { tag?: unknown } | null)?.tag
  return typeof tag === 'string' && tag !== '' ? tag : `#${index + 1}`
}

/** Подпись элемента списка у ядер, адресующих запись ключом `name` (Mihomo) */
export const nameLabel = (value: unknown, index: number): string => {
  const name = (value as { name?: unknown } | null)?.name
  return typeof name === 'string' && name !== '' ? name : `#${index + 1}`
}

/**
 * Уникальное имя в пространстве `taken`: `base`, `base-2`, `base-3`… Тот же
 * приём, что `uniqueTag` у sing-box; живёт здесь, потому что нужен и записям
 * отображений панели «Документ» (`provider`, `provider-2`), у которых тега нет.
 */
export function uniqueName(taken: Iterable<string>, base: string): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!set.has(candidate)) return candidate
  }
}


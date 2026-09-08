// CompletionSource для JSON-вкладки sing-box: контекстные подсказки ключей и
// значений по словарю `docSchema`. Ключи фильтруются от уже введённых, значения
// берутся из enum поля — в том числе внутри массивов-энумов вроде `network`.
//
// Там, где словарь ничего не описывает, источник возвращает null и молчит.
// Выдуманная подсказка хуже отсутствующей: она читается как знание, а ядро
// развивается быстрее словаря, и незнакомый ключ здесь — норма, а не ошибка.

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { SingboxField } from '../../../entities/singbox/docSchema'
import {
  containerAt,
  singboxArrayAt,
  singboxFields,
  singboxPathAt,
} from './context'

// "type": "sel  |  "type":   — вводим ЗНАЧЕНИЕ ключа (внутри объекта)
const VALUE_RE = /"([^"]+)"\s*:\s*("?)([^"{}[\],]*)$/
// { "ta  |  , "  — вводим КЛЮЧ
const KEY_RE = /[{,]\s*("?)([A-Za-z0-9_$-]*)$/
// внутри массива: [ "tc  |  , "  — вводим элемент
const ARRAY_ITEM_RE = /[[,]\s*("?)([^"{}[\],]*)$/

function completionType(field: SingboxField): string {
  if (field.enum) return 'enum'
  if (field.type === 'object') return 'namespace'
  if (field.type === 'array' || field.type === 'strings') return 'type'
  return 'property'
}

function keyOptions(fields: SingboxField[], existing: string[], quoted: boolean): Completion[] {
  const taken = new Set(existing)
  const options: Completion[] = []
  for (const field of fields) {
    if (taken.has(field.key)) continue
    options.push({
      label: field.key,
      type: completionType(field),
      detail: field.type,
      info: field.doc,
      apply: quoted ? field.key : `"${field.key}"`,
    })
  }
  return options
}

function enumOptions(field: SingboxField | undefined, quoted: boolean): Completion[] {
  if (!field?.enum) return []
  return field.enum.map((e) => ({
    label: e.value,
    type: 'enum',
    info: e.doc ?? field.doc,
    apply: quoted ? e.value : `"${e.value}"`,
  }))
}

function scalarValueOptions(field: SingboxField | undefined, quoted: boolean): Completion[] {
  if (!field) return []
  const fromEnum = enumOptions(field, quoted)
  if (fromEnum.length > 0) return fromEnum
  // булевы литералы пишутся без кавычек — предлагаем только вне строки
  if (field.type === 'boolean' && !quoted) {
    return ['true', 'false'].map((v) => ({ label: v, type: 'keyword', apply: v }))
  }
  return []
}

export function singboxCompletionSource(ctx: CompletionContext): CompletionResult | null {
  try {
    const container = containerAt(ctx.state, ctx.pos)
    if (!container) return null

    // ── курсор прямо в массиве: enum-значения элементов (network, protocol…) ──
    if (container.name === 'Array') {
      const arr = singboxArrayAt(ctx.state, container)
      if (!arr) return null
      const before = ctx.state.doc.sliceString(arr.from, ctx.pos)
      const m = ARRAY_ITEM_RE.exec(before)
      if (!m) return null
      const quoted = m[1] === '"'
      const typed = m[2]
      const options = enumOptions(arr.field, quoted)
      if (options.length === 0) return null
      return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^[^"]*$/ }
    }

    // ── курсор в объекте: ключи или скалярные значения ──
    const cursor = singboxPathAt(ctx.state, ctx.pos)
    if (!cursor || cursor.section === undefined) return null
    const fields = singboxFields(cursor)
    const before = ctx.state.doc.sliceString(container.from, ctx.pos)

    const vm = VALUE_RE.exec(before)
    if (vm) {
      const key = vm[1]
      const quoted = vm[2] === '"'
      const typed = vm[3]
      const options = scalarValueOptions(
        fields.find((f) => f.key === key),
        quoted,
      )
      if (options.length === 0) return null
      return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^[^"]*$/ }
    }

    const km = KEY_RE.exec(before)
    const quoted = km ? km[1] === '"' : false
    const typed = km ? km[2] : ''
    // без совпадения и без явного вызова не мешаем (например, курсор на значении-объекте)
    if (!km && !ctx.explicit) return null
    const options = keyOptions(fields, cursor.existingKeys, quoted)
    if (options.length === 0) return null
    return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^[A-Za-z0-9_$-]*$/ }
  } catch {
    return null
  }
}

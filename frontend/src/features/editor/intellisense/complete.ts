// CompletionSource для JSON-редактора: контекстные подсказки ключей и значений
// по docSchema. Ключи фильтруются от уже введённых; значения — из enum поля
// (в т.ч. внутри массивов-энумов вроде alpn/destOverride). Tooltip кладётся в
// поле info каждой подсказки.

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { nodeFields, type DocField } from '../../../entities/xray/docSchema'
import {
  firstContainer,
  resolveArrayContext,
  resolveObjectPath,
  type XrayRootKind,
} from './context'

// "flow": "xtl  |  "flow":   — мы вводим ЗНАЧЕНИЕ ключа (внутри объекта)
const VALUE_RE = /"([^"]+)"\s*:\s*("?)([^"{}[\],]*)$/
// { "fl  |  , "  — мы вводим КЛЮЧ
const KEY_RE = /[{,]\s*("?)([A-Za-z0-9_$-]*)$/
// внутри массива: [ "h  |  , "  — вводим элемент
const ARRAY_ITEM_RE = /[[,]\s*("?)([^"{}[\],]*)$/

function completionType(field: DocField): string {
  if (field.enum) return 'enum'
  if (field.type === 'object') return 'namespace'
  if (field.type === 'array') return 'type'
  return 'property'
}

function keyOptions(
  fields: Record<string, DocField>,
  existing: string[],
  quoted: boolean,
): Completion[] {
  const taken = new Set(existing)
  const options: Completion[] = []
  for (const [key, field] of Object.entries(fields)) {
    if (taken.has(key)) continue
    options.push({
      label: key,
      type: completionType(field),
      detail: field.type,
      info: field.doc,
      apply: quoted ? key : `"${key}"`,
    })
  }
  return options
}

function enumOptions(field: DocField | undefined, quoted: boolean): Completion[] {
  if (!field?.enum) return []
  return field.enum.map((e) => ({
    label: e.value,
    type: 'enum',
    info: e.doc ?? field.doc,
    apply: quoted ? e.value : `"${e.value}"`,
  }))
}

function scalarValueOptions(field: DocField | undefined, quoted: boolean): Completion[] {
  if (!field) return []
  const fromEnum = enumOptions(field, quoted)
  if (fromEnum.length > 0) return fromEnum
  // булевы литералы пишутся без кавычек — предлагаем только вне строки
  if (field.type === 'boolean' && !quoted) {
    return ['true', 'false'].map((v) => ({ label: v, type: 'keyword', apply: v }))
  }
  return []
}

export function makeCompletionSource(rootKind: XrayRootKind) {
  return (ctx: CompletionContext): CompletionResult | null => {
    try {
      const container = firstContainer(ctx.state, ctx.pos)
      if (!container) return null

      // ── курсор прямо в массиве: enum-значения элементов (alpn, destOverride…) ──
      if (container.name === 'Array') {
        const arr = resolveArrayContext(ctx.state, container, rootKind)
        if (!arr?.ownerPath.nodeName) return null
        const field = nodeFields(arr.ownerPath.nodeName, arr.ownerPath.props)[arr.key]
        const before = ctx.state.doc.sliceString(container.from, ctx.pos)
        const m = ARRAY_ITEM_RE.exec(before)
        if (!m) return null
        const quoted = m[1] === '"'
        const typed = m[2]
        const options = enumOptions(field, quoted)
        if (options.length === 0) return null
        return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^[^"]*$/ }
      }

      // ── курсор в объекте: ключи или скалярные значения ──
      const path = resolveObjectPath(ctx.state, container, rootKind)
      if (!path.nodeName) return null
      const fields = nodeFields(path.nodeName, path.props)
      const before = ctx.state.doc.sliceString(container.from, ctx.pos)

      const vm = VALUE_RE.exec(before)
      if (vm) {
        const key = vm[1]
        const quoted = vm[2] === '"'
        const typed = vm[3]
        const options = scalarValueOptions(fields[key], quoted)
        if (options.length === 0) return null
        return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^[^"]*$/ }
      }

      const km = KEY_RE.exec(before)
      const quoted = km ? km[1] === '"' : false
      const typed = km ? km[2] : ''
      // без совпадения и без явного вызова не мешаем (например, курсор на значении-объекте)
      if (!km && !ctx.explicit) return null
      const options = keyOptions(fields, path.existingKeys, quoted)
      if (options.length === 0) return null
      return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^[A-Za-z0-9_$-]*$/ }
    } catch {
      return null
    }
  }
}

// CompletionSource текстовой вкладки Mihomo: ключи и значения по дереву схемы
// entities/mihomo/schema. Дерево описывает вложенность само — не нужно ни
// склейки по точке в имени ключа, ни отдельного списка ключей-контейнеров
// корня: `dns`, `proxies`, `rules`… такие же поля схемы, как любые другие.

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { parseMihomo } from '../../../entities/mihomo'
import { mihomoRefs } from '../../../entities/mihomo/schema'
import type { EnumValue, FieldSchema, RefKind } from '../../../shared/schema'
// Текст устаревания — общий с формами по схеме (features/inspector/schema):
// разойдясь, подсказка и форма описывали бы одну и ту же причину по-разному
import { deprecatedNote } from '../../inspector/schema/labels'
import { contextAt, fieldFor, type MihomoCursor } from './context'

// Уже набранная часть ключа или значения — её подсказка заменяет
const TYPED_RE = /[^\s:]*$/

function completionType(field: FieldSchema): string {
  if (field.kind === 'enum') return 'enum'
  if (field.kind === 'object' || field.kind === 'map') return 'namespace'
  if (field.kind === 'list') return 'type'
  return 'property'
}

/** Отступ на два пробела глубже колонки, в которой начат ввод ключа */
function childIndent(text: string, from: number): string {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  return ' '.repeat(from - lineStart + 2)
}

/**
 * Двоеточие дописываем только в пустой хвост строки: посреди уже написанной
 * пары подсказка иначе вставила бы второе двоеточие. У вложенного
 * отображения/списка (`object`/`list`/`map`) добавляем ещё перевод строки с
 * отступом — ключи YAML открываются не скобкой, как в JSON, а следующей
 * строкой, и без переноса пользователь набирал бы его сам на каждый ключ.
 */
function keySuffix(field: FieldSchema, text: string, from: number, empty: boolean): string {
  if (!empty) return ''
  if (field.kind === 'object' || field.kind === 'list' || field.kind === 'map') {
    return `:\n${childIndent(text, from)}`
  }
  return ': '
}

function keyInfo(field: FieldSchema): string {
  return field.deprecated ? `${field.doc} ${deprecatedNote(field.deprecated)}` : field.doc
}

function keyCompletions(cursor: MihomoCursor, text: string, from: number, empty: boolean): Completion[] {
  const taken = new Set(cursor.existingKeys)
  const fields = cursor.fields ?? []
  return fields
    .filter((field) => !taken.has(field.key))
    .map((field) => ({
      label: field.key,
      type: completionType(field),
      detail: field.kind,
      info: keyInfo(field),
      apply: field.key + keySuffix(field, text, from, empty),
    }))
}

/** Известные значения: у скаляра — свои, у списка (rules-элемент, `network` у tunnels) — у элемента */
function enumOf(field: FieldSchema): EnumValue[] | undefined {
  if (field.kind === 'enum') return field.enum
  if (field.kind === 'list') return field.item?.enum
  return undefined
}

/** Ссылка на цель документа: у скаляра — своя, у списка (`proxies`, `use` группы) — у элемента */
function refKindOf(field: FieldSchema): RefKind | undefined {
  return field.kind === 'list' ? field.item?.ref : field.ref
}

/** Известные значения ключа: enum словаря, булевы литералы либо имена целей документа */
function valueCompletions(field: FieldSchema | undefined, text: string): Completion[] {
  if (field === undefined) return []
  const values = enumOf(field)
  if (values && values.length > 0) {
    return values.map((e) => ({
      label: e.value,
      type: 'enum',
      info: e.deprecated ? deprecatedNote(e.deprecated) : (e.doc ?? field.doc),
    }))
  }
  if (field.kind === 'boolean') {
    return ['true', 'false'].map((v) => ({ label: v, type: 'keyword' }))
  }
  const refKind = refKindOf(field)
  if (refKind !== undefined) {
    // Md разбирается ещё раз: значения-ссылки нужны редко, и второй разбор той
    // же — синхронной и дешёвой — библиотеки дешевле, чем тащить его через
    // contextAt на каждый вызов подсказки
    const names = mihomoRefs(parseMihomo(text))[refKind] ?? []
    return names.map((name) => ({ label: name, type: 'reference' }))
  }
  return []
}

export function mihomoCompletionSource(ctx: CompletionContext): CompletionResult | null {
  try {
    const text = ctx.state.doc.toString()
    const cursor = contextAt(text, ctx.pos)
    if (cursor === null) return null

    const lineStart = text.lastIndexOf('\n', ctx.pos - 1) + 1
    const typed = TYPED_RE.exec(text.slice(lineStart, ctx.pos))?.[0] ?? ''
    const from = ctx.pos - typed.length

    if (cursor.mode === 'value') {
      const options = valueCompletions(
        cursor.key === undefined ? undefined : fieldFor(cursor, cursor.key),
        text,
      )
      if (options.length === 0) return null
      return { from, to: ctx.pos, options, validFor: /^\S*$/ }
    }

    const lineEnd = text.indexOf('\n', ctx.pos)
    const rest = text.slice(ctx.pos, lineEnd < 0 ? text.length : lineEnd)
    const empty = rest.trim() === ''
    const options = keyCompletions(cursor, text, from, empty)
    if (options.length === 0) return null
    return { from, to: ctx.pos, options, validFor: /^[A-Za-z0-9_.-]*$/ }
  } catch {
    return null
  }
}

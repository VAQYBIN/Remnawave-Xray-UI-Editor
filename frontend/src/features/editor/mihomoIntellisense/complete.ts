// CompletionSource текстовой вкладки Mihomo: ключи секции и известные значения
// из словаря docSchema. Проще, чем у Xray: словарь плоский, а вложенность
// выражена точкой в имени ключа (`remnawave.include-proxies`), поэтому вместо
// обхода дерева хватает одного взгляда на путь курсора.

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import {
  fieldsOf,
  MIHOMO_SECTIONS,
  sectionForKey,
  type MihomoField,
  type MihomoSectionName,
} from '../../../entities/mihomo'
import { contextAt, fieldFor, nestedIn, type MihomoCursor } from './context'

/**
 * Секции, которые в корне документа лежат под собственным именем (`dns`, `tun`,
 * `sniffer`, `profile`). Вывод идёт из самого словаря, а не из списка в коде:
 * добавится секция — подсказка появится сама.
 */
const SECTION_KEYS = Object.keys(MIHOMO_SECTIONS).filter(
  (name) => sectionForKey(name) === name,
) as MihomoSectionName[]

/**
 * Ключи-контейнеры корня. В словаре их нет намеренно: `docSchema` питает и
 * формы инспектора, и `rules` там стал бы текстовым полем поверх списка правил.
 * Поэтому описания живут здесь — они нужны ровно подсказкам.
 */
const CONTAINER_KEYS: { key: string; doc: string }[] = [
  {
    key: 'proxies',
    doc: 'Список серверов. В шаблоне подписки обычно пуст: если панель подставит хосты, они попадут сюда, по маркеру `# LEAVE THIS LINE!`.',
  },
  {
    key: 'proxy-groups',
    doc: 'Группы выбора и балансировки: селекторы, url-test, fallback и прочие.',
  },
  { key: 'rules', doc: 'Правила маршрутизации. Побеждает первое совпавшее.' },
  {
    key: 'proxy-providers',
    doc: 'Внешние источники серверов: файл или URL, с интервалом обновления.',
  },
  {
    key: 'rule-providers',
    doc: 'Внешние наборы правил: файл или URL, с интервалом обновления.',
  },
]

// Уже набранная часть ключа или значения — её подсказка заменяет
const TYPED_RE = /[^\s:]*$/

function completionType(field: MihomoField): string {
  if (field.enum) return 'enum'
  if (field.type === 'map') return 'namespace'
  if (field.type === 'strings') return 'type'
  return 'property'
}

function keyCompletion(label: string, field: MihomoField, suffix: string): Completion {
  return {
    label,
    type: completionType(field),
    detail: field.type,
    info: field.doc,
    apply: label + suffix,
  }
}

/**
 * Ключи отображения. Составные имена словаря раскладываются на два вида
 * подсказок: снаружи предлагается сам префикс как вложенное отображение,
 * внутри него — короткие имена листьев.
 */
function keyCompletions(
  section: MihomoSectionName,
  cursor: MihomoCursor,
  scalarSuffix: string,
  mapSuffix: string,
): Completion[] {
  const taken = new Set(cursor.existingKeys)
  const fields = fieldsOf(section)
  const prefix = nestedIn(cursor)

  if (prefix !== undefined) {
    const options: Completion[] = []
    for (const field of fields) {
      if (!field.key.startsWith(`${prefix}.`)) continue
      const leaf = field.key.slice(prefix.length + 1)
      if (taken.has(leaf)) continue
      options.push(keyCompletion(leaf, field, scalarSuffix))
    }
    return options
  }

  const options: Completion[] = []
  const seen = new Set<string>()
  for (const field of fields) {
    const dot = field.key.indexOf('.')
    if (dot < 0) {
      if (taken.has(field.key)) continue
      options.push(keyCompletion(field.key, field, field.type === 'map' ? mapSuffix : scalarSuffix))
      continue
    }
    const head = field.key.slice(0, dot)
    if (seen.has(head) || taken.has(head)) continue
    seen.add(head)
    options.push({
      label: head,
      type: 'namespace',
      detail: 'map',
      info: `Вложенное отображение: ${fields
        .filter((f) => f.key.startsWith(`${head}.`))
        .map((f) => f.key.slice(head.length + 1))
        .join(', ')}`,
      apply: head + mapSuffix,
    })
  }

  if (section === 'root') {
    for (const name of SECTION_KEYS) {
      if (taken.has(name)) continue
      options.push({
        label: name,
        type: 'namespace',
        detail: 'map',
        info: MIHOMO_SECTIONS[name].title,
        apply: name + mapSuffix,
      })
    }
    for (const container of CONTAINER_KEYS) {
      if (taken.has(container.key)) continue
      options.push({
        label: container.key,
        type: 'namespace',
        info: container.doc,
        apply: container.key + mapSuffix,
      })
    }
  }
  return options
}

/** Известные значения ключа: enum словаря либо булевы литералы */
function valueCompletions(field: MihomoField | undefined): Completion[] {
  if (field === undefined) return []
  if (field.enum) {
    return field.enum.map((e) => ({
      label: e.value,
      type: 'enum',
      info: e.doc ?? field.doc,
    }))
  }
  if (field.type === 'boolean') {
    return ['true', 'false'].map((value) => ({ label: value, type: 'keyword' }))
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

    if (cursor.mode === 'value') {
      const options = valueCompletions(
        cursor.key === undefined ? undefined : fieldFor(cursor, cursor.key),
      )
      if (options.length === 0) return null
      return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^\S*$/ }
    }

    // Двоеточие дописываем только в пустой хвост строки: посреди уже написанной
    // пары подсказка иначе вставила бы второе двоеточие
    const lineEnd = text.indexOf('\n', ctx.pos)
    const rest = text.slice(ctx.pos, lineEnd < 0 ? text.length : lineEnd)
    const empty = rest.trim() === ''
    const options = keyCompletions(cursor.section, cursor, empty ? ': ' : '', empty ? ':' : '')
    if (options.length === 0) return null
    return { from: ctx.pos - typed.length, to: ctx.pos, options, validFor: /^[A-Za-z0-9_.-]*$/ }
  } catch {
    return null
  }
}

// Где стоит курсор: в какой секции документа, вводится ключ или значение, какие
// ключи в этом отображении уже есть. Дерево берём у библиотеки `yaml` — она
// разбирает актуальный текст целиком и синхронно, поэтому здесь нет ни бюджета
// разбора, ни отстающего снимка дерева, как у резолвера Xray (см. CLAUDE.md).

import { isMap, isSeq } from 'yaml'
import type { PathParts } from '../../../entities/xray'
import {
  fieldOf,
  fieldsOf,
  parseMihomo,
  pathAt,
  rangeOf,
  sectionForKey,
  type MihomoDoc,
  type MihomoField,
  type MihomoSectionName,
} from '../../../entities/mihomo'

export interface MihomoCursor {
  section: MihomoSectionName
  parts: PathParts
  /** Ключи, уже введённые в этом отображении — из них подсказки вычитаются */
  existingKeys: string[]
  mode: 'key' | 'value'
  /** Имя ключа, значение которого вводится (mode === 'value') */
  key?: string
}

// «  type: » — вводим ЗНАЧЕНИЕ; «  ty» — вводим КЛЮЧ
const VALUE_RE = /^\s*(?:-\s*)?([A-Za-z0-9_-]+)\s*:\s*\S*$/
// Отступ, с которого на строке начинается ключ: пробелы плюс дефис элемента списка
const KEY_INDENT_RE = /^\s*(?:-\s+)?/

/** Секция по пути от корня. Пустой путь — корень документа. */
function sectionOf(parts: PathParts): MihomoSectionName {
  const [head] = parts
  if (head === 'proxy-groups') return 'proxy-group'
  if (head === 'proxy-providers') return 'proxy-provider'
  if (head === 'rule-providers') return 'rule-provider'
  if (typeof head === 'string') return sectionForKey(head) ?? 'root'
  return 'root'
}

function keyOf(node: unknown): string | undefined {
  const value = (node as { value?: unknown } | null)?.value
  return typeof value === 'string' ? value : undefined
}

/** Значение собственного ключа отображения либо элемент списка (без разворота слияний) */
function child(node: unknown, part: string | number): unknown {
  if (typeof part === 'number') return isSeq(node) ? node.items[part] : undefined
  if (!isMap(node)) return undefined
  return node.items.find((pair) => keyOf(pair.key) === part)?.value
}

function nodeAt(md: MihomoDoc, parts: PathParts): unknown {
  let node: unknown = md.doc.contents
  for (const part of parts) {
    node = child(node, part)
    if (node === undefined || node === null) return undefined
  }
  return node
}

function columnAt(text: string, offset: number): number {
  return offset - (text.lastIndexOf('\n', offset - 1) + 1)
}

/**
 * Колонка, в которой начинается сегмент пути: ключ отображения либо дефис
 * элемента списка. У блочного списка дефисы всех элементов стоят в одной
 * колонке — её и берём у самого списка, потому что ключи ВНУТРИ элемента
 * сдвинуты правее и по ним уровень вложенности не отличить.
 */
function segmentColumn(md: MihomoDoc, parts: PathParts, depth: number): number | null {
  const parent = nodeAt(md, parts.slice(0, depth - 1))
  const segment = parts[depth - 1]
  if (typeof segment === 'number') {
    const range = isSeq(parent) ? rangeOf(parent) : null
    return range ? columnAt(md.text, range.from) : null
  }
  if (!isMap(parent)) return null
  const pair = parent.items.find((p) => keyOf(p.key) === segment)
  const range = pair ? rangeOf(pair.key) : null
  return range ? columnAt(md.text, range.from) : null
}

/**
 * Путь до отображения, которому принадлежит курсор. Путь-заготовка ведёт к
 * тому, что стоит В тексте, а курсор — к тому, что в него только вводится:
 * лишние сегменты снимаются по отступу. Сегмент, начинающийся левее курсора
 * или на его колонке, — это уже сосед или предок, а не хозяин строки.
 */
function containerOf(md: MihomoDoc, parts: PathParts, column: number): PathParts {
  let depth = parts.length
  while (depth > 0) {
    const at = segmentColumn(md, parts, depth)
    if (at === null || at < column) break
    depth -= 1
  }
  return parts.slice(0, depth)
}

/** Последний непробельный символ до позиции; -1 — выше курсора пусто */
function lastNonSpaceBefore(text: string, pos: number): number {
  let i = pos - 1
  while (i >= 0 && /\s/.test(text[i])) i -= 1
  return i
}

/**
 * Списки скаляров (`rules`, `proxies`, `nameserver`…) словарь не описывает:
 * их элементы — не пары «ключ: значение», и подсказывать там ключи секции
 * значит подсказывать заведомо неверное. Единственный описанный список
 * отображений — `proxy-groups`, и то лишь на уровне самого списка: там
 * дефисом заводят новую группу.
 */
function describedContainer(node: unknown, parts: PathParts): boolean {
  if (!isSeq(node)) return true
  return parts.length === 1 && parts[0] === 'proxy-groups'
}

export function contextAt(text: string, pos: number): MihomoCursor | null {
  if (pos < 0 || pos > text.length) return null
  const md = parseMihomo(text)

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const before = text.slice(lineStart, pos)
  const value = VALUE_RE.exec(before)
  const mode = value ? 'value' : 'key'
  const key = value?.[1]
  const column = (KEY_INDENT_RE.exec(before)?.[0] ?? '').length

  // Путь берём от курсора. На «пустом» месте — отступе новой строки — его не
  // накрывает ни один узел: разбор о ненаписанное ещё не спотыкается, но и
  // диапазона там нет. Тогда отталкиваемся от последнего непробельного символа
  // выше, а лишние сегменты снимет containerOf.
  let parts = pathAt(md, pos)
  if (parts.length === 0) {
    const probe = lastNonSpaceBefore(text, pos)
    if (probe >= 0) parts = pathAt(md, probe)
  }
  parts = containerOf(md, parts, column)
  // Страховка на случай, когда отступ ничего не решил: значение вводится ВНУТРИ
  // пары, а ключами отображения его содержимое считать нельзя
  if (mode === 'value' && parts.length > 0 && parts[parts.length - 1] === key) {
    parts = parts.slice(0, -1)
  }

  const node = nodeAt(md, parts)
  if (!describedContainer(node, parts)) return null

  const existingKeys = isMap(node)
    ? node.items.map((pair) => keyOf(pair.key)).filter((k): k is string => k !== undefined)
    : []

  return { section: sectionOf(parts), parts, existingKeys, mode, key }
}

/**
 * Имя вложенного отображения словаря, в котором стоит курсор (`remnawave`,
 * `override`, `health-check`). Составные ключи словаря — это путь через такое
 * отображение, а не имя ключа с точкой, поэтому в тексте строка несёт только
 * короткое имя листа.
 */
export function nestedIn(cursor: MihomoCursor): string | undefined {
  const last = cursor.parts[cursor.parts.length - 1]
  if (typeof last !== 'string') return undefined
  return fieldsOf(cursor.section).some((f) => f.key.startsWith(`${last}.`)) ? last : undefined
}

/** Поле словаря по имени ключа строки — с учётом вложенного отображения */
export function fieldFor(cursor: MihomoCursor, key: string): MihomoField | undefined {
  const prefix = nestedIn(cursor)
  return (
    (prefix === undefined ? undefined : fieldOf(cursor.section, `${prefix}.${key}`)) ??
    fieldOf(cursor.section, key)
  )
}

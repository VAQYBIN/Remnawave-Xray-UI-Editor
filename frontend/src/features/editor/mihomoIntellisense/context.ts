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

// «  type: » и «  nameserver: 1.1.1.1 8.8» — вводим ЗНАЧЕНИЕ; «  ty» — КЛЮЧ.
// Пробел внутри значения его значением быть не перестаёт: список серверов и
// строка вроде «expected-status: 200/204» пишутся с пробелами
const VALUE_RE = /^\s*(?:-\s*)?([A-Za-z0-9_-]+)\s*:(?:\s.*)?$/
// Отступ строки и, если строка заводит элемент списка, его дефис
const KEY_INDENT_RE = /^(\s*)(-\s*)?/

/**
 * Хвост пути внутри секции. Пусто — это сама секция; единственный сегмент,
 * который служит префиксом составного ключа (`remnawave`, `override`,
 * `health-check`), — вложенное отображение той же секции. Всё остальное
 * словарь не описывает.
 */
function withinSection(rest: PathParts, section: MihomoSectionName): MihomoSectionName | null {
  if (rest.length === 0) return section
  const [only] = rest
  if (rest.length === 1 && typeof only === 'string') {
    return fieldsOf(section).some((f) => f.key.startsWith(`${only}.`)) ? section : null
  }
  return null
}

/**
 * Секция словаря, описывающая отображение по этому пути; null — про это место
 * словарь не знает ничего, и тогда молчание единственный честный ответ.
 * Откат к корню был бы враньём: `port` внутри записи `proxies` — порт сервера,
 * а не «порт HTTP-входа» из корневых настроек.
 *
 * `item` — курсор заводит НОВЫЙ элемент списка (строка начинается с дефиса), и
 * путь ведёт к самому списку. Единственный описанный список отображений —
 * `proxy-groups`; `proxies` и `rules` словарь не описывает, у `rules` элементы
 * и вовсе скаляры.
 */
function sectionOf(parts: PathParts, item: boolean): MihomoSectionName | null {
  if (item) return parts.length === 1 && parts[0] === 'proxy-groups' ? 'proxy-group' : null

  const [head, second] = parts
  if (head === undefined) return 'root'
  if (head === 'proxy-groups') {
    return typeof second === 'number' ? withinSection(parts.slice(2), 'proxy-group') : null
  }
  if (head === 'proxy-providers') {
    return typeof second === 'string' ? withinSection(parts.slice(2), 'proxy-provider') : null
  }
  if (head === 'rule-providers') {
    return typeof second === 'string' ? withinSection(parts.slice(2), 'rule-provider') : null
  }
  if (typeof head !== 'string') return null
  const section = sectionForKey(head)
  if (section !== undefined) return withinSection(parts.slice(1), section)
  // Не секция — значит либо вложенное отображение составного ключа корня
  // (`remnawave`), либо место, которого словарь не знает
  return withinSection(parts, 'root')
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

/**
 * Путь до СПИСКА, элемент которого заводит строка с дефисом. Ищется по колонке
 * самого дефиса: у блочного списка все его дефисы стоят в одной колонке, и она
 * же — колонка курсора.
 *
 * Сравнивать, как в containerOf, с колонкой ключа-родителя нельзя: стиль
 *
 *     proxy-groups:
 *     - name: A
 *
 * валиден, и там ключ и дефис стоят в ОДНОЙ колонке — по строгому сравнению
 * срезался бы весь путь до корня, и подсказки исчезали бы на всех списках с
 * нулевым отступом. Список — надёжный якорь ещё и потому, что элемента в
 * тексте может не быть вовсе.
 *
 * null — списка с такой колонкой над курсором нет; тогда про место ничего не
 * известно, и вызывающий молчит.
 */
function seqAtColumn(md: MihomoDoc, parts: PathParts, column: number): PathParts | null {
  for (let depth = parts.length; depth >= 0; depth -= 1) {
    const node = nodeAt(md, parts.slice(0, depth))
    const range = isSeq(node) ? rangeOf(node) : null
    if (range !== null && columnAt(md.text, range.from) === column) return parts.slice(0, depth)
  }
  return null
}

/** Последний непробельный символ до позиции; -1 — выше курсора пусто */
function lastNonSpaceBefore(text: string, pos: number): number {
  let i = pos - 1
  while (i >= 0 && /\s/.test(text[i])) i -= 1
  return i
}

/**
 * Курсор внутри комментария. В YAML решётка начинает комментарий в начале
 * строки или после пробела — внутри значения (`https://dns#🌍 VPN`) она
 * обычная. Подсказывать там нечего, а над строкой `# LEAVE THIS LINE!`, по
 * которой панель ищет место подстановки хостов, — тем более.
 */
function inComment(before: string): boolean {
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === '#' && (i === 0 || /\s/.test(before[i - 1]))) return true
  }
  return false
}

export function contextAt(text: string, pos: number): MihomoCursor | null {
  if (pos < 0 || pos > text.length) return null
  const md = parseMihomo(text)

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const before = text.slice(lineStart, pos)
  if (inComment(before)) return null
  const value = VALUE_RE.exec(before)
  const mode = value ? 'value' : 'key'
  const key = value?.[1]
  const indent = KEY_INDENT_RE.exec(before)
  // Строка с дефисом — это ЭЛЕМЕНТ списка, и хозяин у неё сам список: секцию
  // элемента задаёт он, а самого элемента в тексте может ещё не быть. Дефис
  // считается дефисом и без пробела за ним: набравший его заводит элемент, и
  // ключи секции ему нужны уже сейчас
  const item = indent?.[2] !== undefined
  const column = indent?.[1].length ?? 0

  // Путь берём от курсора. На «пустом» месте — отступе новой строки — его не
  // накрывает ни один узел: разбор о ненаписанное ещё не спотыкается, но и
  // диапазона там нет. Тогда отталкиваемся от последнего непробельного символа
  // выше, а лишние сегменты снимет containerOf.
  let parts = pathAt(md, pos)
  if (parts.length === 0) {
    const probe = lastNonSpaceBefore(text, pos)
    if (probe >= 0) parts = pathAt(md, probe)
  }

  if (item) {
    const seq = seqAtColumn(md, parts, column)
    if (seq === null) return null
    parts = seq
  } else {
    parts = containerOf(md, parts, column)
    // Страховка на случай, когда отступ ничего не решил: значение вводится
    // ВНУТРИ пары, а ключами отображения его содержимое считать нельзя
    if (mode === 'value' && parts.length > 0 && parts[parts.length - 1] === key) {
      parts = parts.slice(0, -1)
    }
  }

  const section = sectionOf(parts, item)
  if (section === null) return null

  const node = nodeAt(md, parts)
  const existingKeys = isMap(node)
    ? node.items.map((pair) => keyOf(pair.key)).filter((k): k is string => k !== undefined)
    : []

  return { section, parts, existingKeys, mode, key }
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

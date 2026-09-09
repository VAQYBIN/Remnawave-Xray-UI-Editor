// Где стоит курсор: путь от корня документа и поля схемы для этого места.
// Дерево берём у библиотеки `yaml` — она разбирает актуальный текст целиком и
// синхронно, поэтому здесь нет ни бюджета разбора, ни отстающего снимка дерева,
// как у резолвера Xray (см. CLAUDE.md).
//
// Раньше место описывал плоский словарь docSchema (секция по имени), теперь —
// дерево entities/mihomo/schema через mihomoFieldsAt/mihomoFieldAt: вложенность
// (remnawave, override, health-check, sniffer.sniff.HTTP) читается спуском по
// дереву, а не склейкой по точке в имени ключа. Контейнеры корня (dns, proxies,
// rules…) — обычные поля корневой схемы, отдельного списка для них не нужно.

import { isMap, isSeq } from 'yaml'
import type { PathParts } from '../../../entities/xray'
import { parseMihomo, pathAt, rangeOf, type MihomoDoc } from '../../../entities/mihomo'
import { mihomoFieldAt, mihomoFieldsAt } from '../../../entities/mihomo/schema'
import { valueAt, type FieldSchema, type SchemaPath } from '../../../shared/schema'

export interface MihomoCursor {
  /** Путь до отображения, которому принадлежит курсор */
  path: SchemaPath
  /** Поля схемы этого места; undefined — схема места не знает (элемент списка строк, flow) */
  fields: FieldSchema[] | undefined
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
 * Инвариант, на котором стоит поиск: вдоль ОДНОЙ цепочки префиксов колонки
 * дефисов строго возрастают с глубиной — вложенный блочный список обязан быть
 * отбит вправо относительно дефиса родителя, а список, начинающийся в той же
 * колонке, это уже не вложение, а следующий брат того же списка. Значит
 * совпадение колонки отбирает не более одного кандидата, а списки из соседних
 * ветвей документа отсекает сам префикс пути. Это следствие правил отступов
 * YAML, а не измерение, — потому и закреплено тестом на вложенный список.
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

/**
 * Курсор внутри flow-коллекции (`proxies: [DIRECT]`, `dns: {enable: true}`).
 * Словарь описывает пары «ключ: значение» блочного стиля; внутри квадратных
 * скобок уместны имена серверов и групп, которых он не знает, а внутри фигурных
 * подсказка вставила бы значение туда, где ядро ждёт список. Молчим.
 *
 * Проверяется именно ДИАПАЗОН узла, а не сам факт flow-значения по пути: путь
 * курсора, стоящего на КЛЮЧЕ такой строки, уже ведёт в коллекцию, и проверка по
 * пути погасила бы описание самого ключа — а `nameserver: [1.1.1.1]` объяснять
 * надо ровно так же, как блочный вариант.
 *
 * Путь берётся ТОЛЬКО от курсора, а не от подставного якоря выше: после
 * закрытой скобки (`proxies: [DIRECT]` и курсор на следующей строке) курсор уже
 * не в коллекции, и подсказки корня там законны.
 */
function inFlow(md: MihomoDoc, atCursor: PathParts, pos: number): boolean {
  const covers = (node: unknown): boolean => {
    if (!(isSeq(node) || isMap(node)) || (node as { flow?: boolean }).flow !== true) return false
    const range = rangeOf(node)
    return range !== null && pos >= range.from && pos <= range.to
  }
  let node: unknown = md.doc.contents
  if (covers(node)) return true
  for (const part of atCursor) {
    node = child(node, part)
    if (covers(node)) return true
  }
  return false
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

/** Свежий индекс списка по реальному документу — валиден для любой глубины пути */
function freshIndex(md: MihomoDoc, listPath: PathParts): number {
  const value = valueAt(md.json, listPath)
  return Array.isArray(value) ? value.length : 0
}

export function contextAt(text: string, pos: number): MihomoCursor | null {
  if (pos < 0 || pos > text.length) return null
  const md = parseMihomo(text)

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const before = text.slice(lineStart, pos)
  if (inComment(before)) return null
  const value = VALUE_RE.exec(before)
  let mode: 'key' | 'value' = value ? 'value' : 'key'
  let key = value?.[1]
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
  const atCursor = pathAt(md, pos)
  if (inFlow(md, atCursor, pos)) return null

  let parts = atCursor
  if (parts.length === 0) {
    const probe = lastNonSpaceBefore(text, pos)
    if (probe >= 0) parts = pathAt(md, probe)
  }

  let fields: FieldSchema[] | undefined
  if (item) {
    const seq = seqAtColumn(md, parts, column)
    if (seq === null) return null
    const listField = mihomoFieldAt(seq, md.json)
    if (listField !== undefined && listField.kind === 'list' && listField.item?.kind !== 'object') {
      // Скалярный список (rules, nameserver, network у tunnels…): дефис заводит
      // ЗНАЧЕНИЕ элемента, а не ключ отображения — те же подсказки, что и у
      // значения самого поля-списка (enum элемента, ссылка на цель документа)
      parts = seq.slice(0, -1)
      const last = seq[seq.length - 1]
      mode = 'value'
      key = typeof last === 'string' ? last : undefined
      fields = mihomoFieldsAt(parts, md.json)
    } else if (parts.length > seq.length + 1) {
      // Список объектов (proxy-groups, proxies, listeners…), а курсор стоит
      // ГЛУБЖЕ границы элемента — на его собственном ключе или значении (тот
      // же дефис, но дальше на строке, например «- name: серв‸ер»). Путь
      // резолвится колонкой КОНТЕНТА, а не колонкой самого дефиса: содержимое
      // элемента сдвинуто вправо ровно на длину «- », и без поправки колонка
      // курсора совпала бы с колонкой дефиса, а не ключа
      const contentColumn = column + (indent?.[2]?.length ?? 0)
      parts = containerOf(md, parts, contentColumn)
      if (mode === 'value' && parts.length > 0 && parts[parts.length - 1] === key) {
        parts = parts.slice(0, -1)
      }
      fields = mihomoFieldsAt(parts, md.json)
    } else {
      // Граница элемента: своего ключа/значения на этой строке ещё нет
      // (дефис пуст либо на нём стоит только ключ без значения). Элемента в
      // тексте может не быть вовсе — тогда индекс берётся СВЕЖИЙ, тот, где
      // valueAt документа даёт undefined; если элемент уже существует
      // (пусть даже как заготовка со значением null), используется его
      // настоящий индекс — для условий `when` разницы с undefined нет.
      // `mode`/`key`, посчитанные выше по тексту строки, не трогаем: «- ‸» —
      // это КЛЮЧ нового элемента, а «- name: ‸» — ЗНАЧЕНИЕ уже введённого
      const index = parts.length > seq.length && typeof parts[seq.length] === 'number'
        ? (parts[seq.length] as number)
        : freshIndex(md, seq)
      fields = mihomoFieldsAt([...seq, index], md.json)
      parts = seq
    }
  } else {
    parts = containerOf(md, parts, column)
    // Страховка на случай, когда отступ ничего не решил: значение вводится
    // ВНУТРИ пары, а ключами отображения его содержимое считать нельзя
    if (mode === 'value' && parts.length > 0 && parts[parts.length - 1] === key) {
      parts = parts.slice(0, -1)
    }
    fields = mihomoFieldsAt(parts, md.json)
  }

  const node = nodeAt(md, parts)
  const existingKeys = isMap(node)
    ? node.items.map((pair) => keyOf(pair.key)).filter((k): k is string => k !== undefined)
    : []

  return { path: parts, fields, existingKeys, mode, key }
}

/** Поле словаря по имени ключа строки */
export function fieldFor(cursor: MihomoCursor, key: string): FieldSchema | undefined {
  return cursor.fields?.find((f) => f.key === key)
}

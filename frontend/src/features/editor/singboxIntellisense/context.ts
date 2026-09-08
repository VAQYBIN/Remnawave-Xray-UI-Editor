// Где стоит курсор: путь от корня документа и секция словаря для этого места.
//
// Документ sing-box — JSON, поэтому приём тот же, что у Xray, а не у Mihomo:
// подъём по дереву CodeMirror от курсора к корню. Разница только в том, куда
// приводит собранный путь: у Xray спуск по словарю зашит в сам словарь, здесь
// маршрутизацию знает отдельный слой `entities/singbox/docPath.ts`.
//
// Дерево тянем сами, а не берём готовое из состояния: `syntaxTree(state)`
// отдаёт снимок, сделанный при создании LanguageState, а `ensureSyntaxTree`
// двигает parse-контекст, снимок не обновляя. На большом документе начальный
// тайм-слайс до хвоста не доходит — и подсказки в конце файла молча выдавали бы
// контекст по недоразобранному дереву. Ту же граблю обходит jsonLocate.ts, но
// бюджет там на порядок больше: там разовый переход по клику, а здесь работа на
// каждое нажатие клавиши.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { nestedFields, sectionAtPath } from '../../../entities/singbox/docPath'
import {
  SINGBOX_SECTIONS,
  type SingboxField,
  type SingboxSectionName,
} from '../../../entities/singbox/docSchema'
// Разбор имени свойства и снятие кавычек — работа с деревом JSON, а не знание
// про Xray: третья копия этих двух строк была бы второй лишней. Тем же
// импортом и по той же причине живёт jsonLocate.ts
import { propertyKey, stripQuotes } from '../intellisense/context'

const PARSE_BUDGET_MS = 100

/** Шаг пути: ключ отображения либо индекс элемента массива */
export type SingboxPathStep = string | number

export interface SingboxCursor {
  /** Путь от корня документа до объекта, которому принадлежит курсор */
  path: SingboxPathStep[]
  /** Секция словаря для этого места; undefined — словарь про него не знает */
  section: SingboxSectionName | undefined
  /** Ключи, уже введённые в этом объекте — из них подсказки вычитаются */
  existingKeys: string[]
  /**
   * Имя вложенного отображения (`remnawave`), если курсор внутри него. Своей
   * секции у такого отображения нет: его листья лежат в секции хозяина под
   * точкой, и достать их можно только зная голову пути.
   */
  nested?: string
}

/** Дерево, дотянутое до позиции курсора; при исчерпании бюджета — что есть */
export function treeAt(state: EditorState, pos: number): Tree {
  return ensureSyntaxTree(state, pos, PARSE_BUDGET_MS) ?? syntaxTree(state)
}

// Значения JSON; всё остальное в дереве — пунктуация и имена ключей
const VALUES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null'])

/** Ближайший контейнер (Object или Array) над позицией — или null */
export function containerAt(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = treeAt(state, pos).resolveInner(pos, -1)
  while (node) {
    if (node.name === 'Object' || node.name === 'Array') return node
    node = node.parent
  }
  return null
}

/** Ближайший Object над узлом (включая его самого) */
function enclosingObject(node: SyntaxNode | null): SyntaxNode | null {
  let n = node
  while (n && n.name !== 'Object') n = n.parent
  return n
}

/**
 * Порядковый номер значения в массиве. Сравнение по диапазону, а не по
 * ссылке: обход дерева создаёт новые объекты SyntaxNode на каждый шаг, и
 * проверка на равенство ссылок не сработала бы никогда.
 */
function arrayIndex(array: SyntaxNode, child: SyntaxNode): number {
  let i = 0
  for (let ch = array.firstChild; ch; ch = ch.nextSibling) {
    if (!VALUES.has(ch.name)) continue
    if (ch.from === child.from && ch.to === child.to) return i
    i += 1
  }
  return -1
}

// Разделитель ключа карты. Байт NUL намеренно: в имени ключа JSON его нет,
// а пробел там возможен — и путь ['a', 'b'] склеился бы с путём ['a b']
// в один
const KEY_SEP = '\u0000'

interface Located {
  path: SingboxPathStep[]
  /** Узел по каждому префиксу пути: по ним отвечает typeAt, не обходя документ заново */
  byPath: Map<string, SyntaxNode>
}

/** Путь до узла: подъём к корню, попутно запоминая узел каждого префикса */
function locate(state: EditorState, node: SyntaxNode): Located {
  const path: SingboxPathStep[] = []
  const nodes: SyntaxNode[] = []
  let cur: SyntaxNode | null = node
  // Ограничение глубины — страховка: подъём обязан завершаться на любом дереве,
  // включая испорченное недоразобранным хвостом
  for (let depth = 0; cur && depth < 500; depth += 1) {
    const parent: SyntaxNode | null = cur.parent
    if (!parent) break
    if (parent.name === 'Array') {
      const index = arrayIndex(parent, cur)
      if (index < 0) break
      path.unshift(index)
      nodes.unshift(cur)
      cur = parent
      continue
    }
    if (parent.name === 'Property') {
      const key = propertyKey(state, parent)
      const owner: SyntaxNode | null = parent.parent
      if (key === null || !owner || owner.name !== 'Object') break
      path.unshift(key)
      nodes.unshift(cur)
      cur = owner
      continue
    }
    cur = parent
  }
  const byPath = new Map<string, SyntaxNode>()
  for (let i = 0; i < nodes.length; i += 1) {
    byPath.set(path.slice(0, i + 1).join(KEY_SEP), nodes[i])
  }
  return { path, byPath }
}

/** Скалярное значение свойства объекта (для `type`), либо undefined */
function scalarProp(state: EditorState, obj: SyntaxNode, key: string): string | undefined {
  for (let ch = obj.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name !== 'Property') continue
    if (propertyKey(state, ch) !== key) continue
    const value = ch.lastChild
    if (!value || value.name === 'PropertyName') return undefined
    if (value.name === 'String') return stripQuotes(state.doc.sliceString(value.from, value.to))
    if (value.name === 'Number' || value.name === 'True' || value.name === 'False') {
      return state.doc.sliceString(value.from, value.to)
    }
    return undefined
  }
  return undefined
}

/** Имена свойств объекта в порядке документа */
function keysOf(state: EditorState, obj: SyntaxNode): string[] {
  const keys: string[] = []
  for (let ch = obj.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name !== 'Property') continue
    const key = propertyKey(state, ch)
    if (key !== null) keys.push(key)
  }
  return keys
}

/** Секция словаря для собранного пути — и вложенное отображение, если оно есть */
function sectionOf(
  state: EditorState,
  located: Located,
): { section: SingboxSectionName | undefined; nested?: string } {
  const typeAt = (p: readonly SingboxPathStep[]): string | undefined => {
    const node = located.byPath.get(p.join(KEY_SEP))
    return node && node.name === 'Object' ? scalarProp(state, node, 'type') : undefined
  }
  const section = sectionAtPath(located.path, typeAt)
  if (section !== undefined) return { section }

  // Вложенное отображение составного ключа (`remnawave`): своей секции у него
  // нет и быть не должно — словарь питает ещё и формы, а там это одно поле
  const head = located.path[located.path.length - 1]
  if (typeof head !== 'string') return { section: undefined }
  const owner = sectionAtPath(located.path.slice(0, -1), typeAt)
  if (owner === undefined || nestedFields(owner, head).length === 0) return { section: undefined }
  return { section: owner, nested: head }
}

/** Контекст курсора: путь, секция словаря и уже введённые ключи объекта */
export function singboxPathAt(state: EditorState, pos: number): SingboxCursor | null {
  const obj = enclosingObject(treeAt(state, pos).resolveInner(pos, -1))
  if (!obj) return null
  const located = locate(state, obj)
  const { section, nested } = sectionOf(state, located)
  return { path: located.path, section, existingKeys: keysOf(state, obj), nested }
}

/** Поля словаря, описывающие место под курсором; пусто — сказать нечего */
export function singboxFields(cursor: SingboxCursor): SingboxField[] {
  if (cursor.section === undefined) return []
  return cursor.nested === undefined
    ? SINGBOX_SECTIONS[cursor.section]
    : nestedFields(cursor.section, cursor.nested)
}

/**
 * Курсор стоит ПРЯМО в массиве (а не в объекте-элементе): подсказывать здесь
 * можно только значения из enum поля-владельца — `network`, `protocol`. Для
 * массива объектов поле enum'а не имеет, и вызывающий молчит.
 */
export function singboxArrayAt(
  state: EditorState,
  array: SyntaxNode,
): { field: SingboxField | undefined; from: number } | null {
  const prop = array.parent
  if (!prop || prop.name !== 'Property') return null
  const key = propertyKey(state, prop)
  const owner = prop.parent
  if (key === null || !owner || owner.name !== 'Object') return null
  const located = locate(state, owner)
  const { section, nested } = sectionOf(state, located)
  if (section === undefined) return null
  const fields =
    nested === undefined ? SINGBOX_SECTIONS[section] : nestedFields(section, nested)
  return { field: fields.find((f) => f.key === key), from: array.from }
}


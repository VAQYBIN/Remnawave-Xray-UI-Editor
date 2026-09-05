// Резолвер контекста курсора для IntelliSense: по синтаксическому дереву JSON и
// позиции определяет, в каком узле дерева Xray-конфига мы находимся (имя узла в
// docSchema), какие ключи уже введены и какие скаляры (protocol/network/…) видны
// рядом — этого достаточно, чтобы completion/hover выбрали правильные подсказки.
//
// Структуру берём из дерева (внешние объекты валидны, даже когда ключ под курсором
// ещё дописывается), а «ключ или значение» решает уже completion по тексту — так
// надёжнее на незакрытых строках.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { descend, type Props } from '../../../entities/xray/docSchema'

export type XrayRootKind = 'config' | 'inbound' | 'outbound' | 'rule' | 'dns' | 'balancer'

/**
 * Бюджет разбора для подсказок. Дерево тянем сами, а не берём готовое из
 * состояния: `syntaxTree(state)` отдаёт снимок, сделанный при создании
 * LanguageState (`this.tree = context.tree` в @codemirror/language), а
 * `ensureSyntaxTree` двигает parse-контекст, снимок не обновляя. На большом
 * конфиге начальный тайм-слайс до хвоста не доходит — и подсказки в конце
 * документа молча выдавали бы контекст по недоразобранному дереву. Ровно эту
 * же граблю обходит jsonLocate.ts, но бюджет там на порядок больше: там
 * разовый переход по клику, а здесь работа на каждое нажатие клавиши.
 */
const PARSE_BUDGET_MS = 100

/** Дерево, дотянутое до позиции курсора; при исчерпании бюджета — что есть */
function treeAt(state: EditorState, pos: number): Tree {
  return ensureSyntaxTree(state, pos, PARSE_BUDGET_MS) ?? syntaxTree(state)
}

export function stripQuotes(text: string): string {
  return text.replace(/^"|"$/g, '')
}

/** Имя ключа Property (без кавычек) */
export function propertyKey(state: EditorState, prop: SyntaxNode): string | null {
  const name = prop.getChild('PropertyName')
  if (!name) return null
  return stripQuotes(state.doc.sliceString(name.from, name.to))
}

/** Ближайший контейнер (Object или Array) над позицией — или null */
export function firstContainer(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = treeAt(state, pos).resolveInner(pos, -1)
  while (node) {
    if (node.name === 'Object' || node.name === 'Array') return node
    node = node.parent
  }
  return null
}

/** Ближайший Object над позицией/узлом */
function enclosingObject(node: SyntaxNode | null): SyntaxNode | null {
  let n = node
  while (n && n.name !== 'Object') n = n.parent
  return n
}

/** Ключи и скалярные значения свойств объекта */
export function objectProps(state: EditorState, obj: SyntaxNode): { props: Props; keys: string[] } {
  const props: Props = {}
  const keys: string[] = []
  for (let ch = obj.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name !== 'Property') continue
    const key = propertyKey(state, ch)
    if (key == null) continue
    keys.push(key)
    const value = ch.lastChild
    if (!value || value.name === 'PropertyName') continue
    if (value.name === 'String') props[key] = stripQuotes(state.doc.sliceString(value.from, value.to))
    else if (value.name === 'Number' || value.name === 'True' || value.name === 'False') {
      props[key] = state.doc.sliceString(value.from, value.to)
    }
  }
  return { props, keys }
}

/** Ключ, ведущий в объект из родителя, и сам родительский объект (индекс массива прозрачен) */
function keyInto(state: EditorState, obj: SyntaxNode): { key: string | null; parent: SyntaxNode | null } {
  let owner = obj.parent
  if (owner && owner.name === 'Array') owner = owner.parent // элемент массива → его Property
  if (owner && owner.name === 'Property') {
    const key = propertyKey(state, owner)
    const grand = owner.parent
    return { key, parent: grand && grand.name === 'Object' ? grand : null }
  }
  return { key: null, parent: null }
}

export interface ObjectPath {
  /** Имя узла docSchema для объекта под курсором (undefined — путь неизвестен) */
  nodeName: string | undefined
  existingKeys: string[]
  props: Props
  object: SyntaxNode
}

/** Разрешить путь до объекта, содержащего позицию (или сам объект узла) */
export function resolveObjectPath(state: EditorState, obj: SyntaxNode, rootKind: XrayRootKind): ObjectPath {
  // цепочка объектов от корня до текущего
  const chain: { key: string | null; obj: SyntaxNode }[] = []
  let cur: SyntaxNode | null = obj
  const guard = new Set<number>()
  while (cur && !guard.has(cur.from)) {
    guard.add(cur.from)
    const { key, parent } = keyInto(state, cur)
    chain.unshift({ key, obj: cur })
    cur = parent
  }

  let nodeName: string | undefined = rootKind
  for (let i = 1; i < chain.length; i++) {
    const parentProps = objectProps(state, chain[i - 1].obj).props
    const key = chain[i].key
    if (key == null) {
      nodeName = undefined
      break
    }
    nodeName = descend(nodeName, key, parentProps)
    if (!nodeName) break
  }

  const { props, keys } = objectProps(state, obj)
  return { nodeName, existingKeys: keys, props, object: obj }
}

/** Путь до объекта, в котором находится позиция */
export function resolvePath(state: EditorState, pos: number, rootKind: XrayRootKind): ObjectPath | null {
  const obj = enclosingObject(treeAt(state, pos).resolveInner(pos, -1))
  if (!obj) return null
  return resolveObjectPath(state, obj, rootKind)
}

/**
 * Если позиция находится ПРЯМО в массиве (не в объекте-элементе) — вернуть имя
 * ключа этого массива и путь объекта-владельца, чтобы предложить enum-значения
 * (alpn, destOverride, protocol …). Для массива объектов и массива строк — null.
 */
export interface ArrayContext {
  ownerPath: ObjectPath
  key: string
  array: SyntaxNode
}

export function resolveArrayContext(
  state: EditorState,
  array: SyntaxNode,
  rootKind: XrayRootKind,
): ArrayContext | null {
  const prop = array.parent
  if (!prop || prop.name !== 'Property') return null
  const key = propertyKey(state, prop)
  const owner = prop.parent
  if (key == null || !owner || owner.name !== 'Object') return null
  return { ownerPath: resolveObjectPath(state, owner, rootKind), key, array }
}

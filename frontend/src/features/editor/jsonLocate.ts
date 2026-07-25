// Обратная задача к intellisense/context.ts: там из позиции курсора выводится путь,
// здесь из пути диагностики — место в документе. Общий обход невозможен (спуск и
// подъём по дереву — разные операции), поэтому общими остаются только мелкие хелперы.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { PathParts } from '../../entities/xray'
import { propertyKey } from './intellisense/context'

export interface DocRange {
  from: number
  to: number
}

// Значения JSON; всё остальное в дереве — пунктуация и имена ключей
const VALUES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null'])

function firstValue(node: SyntaxNode): SyntaxNode | null {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (VALUES.has(ch.name)) return ch
  }
  return null
}

function propertyValue(state: EditorState, obj: SyntaxNode, key: string): SyntaxNode | null {
  for (let ch = obj.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name !== 'Property') continue
    if (propertyKey(state, ch) !== key) continue
    const value = ch.lastChild
    return value && VALUES.has(value.name) ? value : null
  }
  return null
}

function arrayItem(array: SyntaxNode, index: number): SyntaxNode | null {
  let i = 0
  for (let ch = array.firstChild; ch; ch = ch.nextSibling) {
    if (!VALUES.has(ch.name)) continue
    if (i === index) return ch
    i += 1
  }
  return null
}

/**
 * Место пути в тексте. Если путь оборвался на середине — отдаём диапазон
 * глубочайшего найденного предка: у ошибки уровня streamSettings своего ключа
 * может и не быть. Если не нашёлся даже первый сегмент — null: подсветить весь
 * документ хуже, чем не подсвечивать ничего.
 */
export function locateRange(state: EditorState, parts: PathParts): DocRange | null {
  if (parts.length === 0) return null

  // syntaxTree в живом редакторе разобран только до видимой области, поэтому
  // диагностика в хвосте большого конфига иначе не нашла бы своего места
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state)
  let node = firstValue(tree.topNode)
  if (!node) return null

  let depth = 0
  for (const part of parts) {
    const next =
      typeof part === 'number'
        ? node.name === 'Array'
          ? arrayItem(node, part)
          : null
        : node.name === 'Object'
          ? propertyValue(state, node, part)
          : null
    if (!next) break
    node = next
    depth += 1
  }

  if (depth === 0) return null
  return { from: node.from, to: node.to }
}

// Путь диагностики ↔ место в тексте. У Xray обе задачи решаются обходом дерева
// CodeMirror (features/editor/jsonLocate.ts и intellisense/context.ts) и стоят
// двух разных обходов. Здесь дешевле: разобранный документ библиотеки `yaml`
// уже несёт диапазоны у каждого узла, и дерево CodeMirror не нужно вовсе —
// заодно снимается вся история с отстающим снимком syntaxTree.

import { isMap, isSeq } from 'yaml'
import type { PathParts } from '../xray/config'
import { rangeOf, type MihomoDoc, type Range } from './parse'

/** Значение ключа отображения по СОБСТВЕННОМУ ключу (слияния не разворачиваем:
 *  место в тексте у слитого значения чужое — оно у объявления якоря) */
function child(node: unknown, part: string | number): unknown {
  if (typeof part === 'number') return isSeq(node) ? node.items[part] : undefined
  if (!isMap(node)) return undefined
  return node.items.find((p) => (p.key as { value?: unknown } | null)?.value === part)?.value
}

/**
 * Место пути в тексте. Путь оборвался на середине — отдаём диапазон
 * глубочайшего найденного предка: у диагностики уровня группы своего ключа
 * может и не быть. Не нашёлся даже первый сегмент — null: подсветить весь
 * документ хуже, чем не подсвечивать ничего (то же решение, что в jsonLocate).
 */
export function locateMihomo(md: MihomoDoc, parts: PathParts): Range | null {
  if (parts.length === 0) return null
  let node: unknown = md.doc.contents
  let deepest: Range | null = null
  for (const part of parts) {
    const next = child(node, part)
    if (next === undefined || next === null) break
    node = next
    // Диапазон запоминаем на каждом шаге: у последнего узла его может не быть
    // (алиас без разрешения), и тогда лучше показать предка, чем ничего
    deepest = rangeOf(node) ?? deepest
  }
  return deepest
}

/** Диапазон пары «ключ: значение» — от начала ключа до конца значения */
function pairRange(pair: { key?: unknown; value?: unknown }): Range | null {
  const key = rangeOf(pair.key)
  const value = rangeOf(pair.value)
  if (key === null) return null
  return { from: key.from, to: value?.to ?? key.to }
}

function covers(range: Range | null, offset: number): boolean {
  return range !== null && offset >= range.from && offset <= range.to
}

/**
 * Путь до узла, в котором стоит смещение. Спуск идёт по диапазонам: узел, чей
 * диапазон накрывает смещение, и есть следующий сегмент. Смещение в «пустом»
 * месте (пробел, начало недописанной строки) не накрывается ничем — тогда
 * возвращается путь до ближайшего охватывающего отображения, и это ровно то,
 * что нужно подсказкам: «какие ключи допустимы ЗДЕСЬ».
 */
export function pathAt(md: MihomoDoc, offset: number): PathParts {
  const parts: PathParts = []
  let node: unknown = md.doc.contents
  for (;;) {
    if (isMap(node)) {
      const pair = node.items.find((p) => covers(pairRange(p), offset))
      const key = (pair?.key as { value?: unknown } | null)?.value
      if (pair === undefined || typeof key !== 'string') return parts
      parts.push(key)
      node = pair.value
      continue
    }
    if (isSeq(node)) {
      const index = node.items.findIndex((item) => covers(rangeOf(item), offset))
      if (index === -1) return parts
      parts.push(index)
      node = node.items[index]
      continue
    }
    return parts
  }
}

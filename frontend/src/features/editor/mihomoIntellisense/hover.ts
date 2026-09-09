// Hover-тултип текстовой вкладки: при наведении на ключ (или на его значение)
// показывает описание из схемы и известные значения. Ключ берётся у строки
// под курсором, а контейнер — у contextAt: дерево CodeMirror здесь не нужно,
// как и в подсказках.
//
// Поле ищем НЕ через cursor.fields/fieldFor, а свежим mihomoFieldAt по пути
// контейнера плюс имени ключа строки: contextAt считает mode/key под ТОЧНОЙ
// позицией курсора (которая при наведении на что угодно кроме первого символа
// ключа обычно 'value'), а hoveredKey — свой, независимый разбор строки. Разные
// источники key не обязаны совпадать, и опора на fieldFor молча предположила
// бы, что совпадают.

import { hoverTooltip, type Tooltip } from '@codemirror/view'
import { parseMihomo } from '../../../entities/mihomo'
import { mihomoFieldAt } from '../../../entities/mihomo/schema'
import type { FieldSchema } from '../../../shared/schema'
import { renderHoverTooltip } from '../hoverTooltipDom'
import { contextAt } from './context'

// «  - name: A» — отступ и дефис, имя ключа, пробелы до двоеточия
const LINE_KEY_RE = /^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+)(\s*):/

interface Hovered {
  key: string
  /** Что подсвечивать тултипом: сам ключ либо его значение */
  from: number
  to: number
}

/** Ключ строки под курсором и подсвечиваемый диапазон, либо null */
function hoveredKey(text: string, pos: number): Hovered | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const lineEnd = text.indexOf('\n', pos)
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
  const match = LINE_KEY_RE.exec(line)
  if (match === null) return null

  const keyFrom = lineStart + match[1].length
  const keyTo = keyFrom + match[2].length
  const colon = keyTo + match[3].length
  if (pos >= keyFrom && pos <= keyTo) {
    return { key: match[2], from: keyFrom, to: keyTo }
  }
  if (pos <= colon) return null

  // Наведение на значение: подсвечиваем его целиком, описание всё равно у ключа
  const tail = line.slice(colon + 1 - lineStart)
  const lead = tail.length - tail.trimStart().length
  const value = tail.trim()
  if (value === '' || value.startsWith('#')) return null
  const from = colon + 1 + lead
  const to = from + value.length
  if (pos < from || pos > to) return null
  return { key: match[2], from, to }
}

export interface MihomoHover {
  key: string
  field: FieldSchema
  /** Диапазон подсветки в тексте */
  from: number
  to: number
}

/**
 * Что показать при наведении на позицию — без EditorView и без DOM: всё, что
 * нужно тултипу, выводится из текста и схемы, а значит и проверяется тестом
 * без поднятия редактора.
 */
export function hoverAt(text: string, pos: number): MihomoHover | null {
  const hovered = hoveredKey(text, pos)
  if (hovered === null) return null
  // Контекст спрашивается о САМОЙ позиции наведения, а не о ключе строки: иначе
  // молчание внутри flow-коллекции (`proxies: [DIRECT]`) пришлось бы повторять
  // здесь второй проверкой — contextAt уже отказывает на flow и комментарии
  const cursor = contextAt(text, pos)
  if (cursor === null) return null
  const field = mihomoFieldAt([...cursor.path, hovered.key], parseMihomo(text).json)
  if (field === undefined) return null
  return { key: hovered.key, field, from: hovered.from, to: hovered.to }
}

export function mihomoHover() {
  return hoverTooltip((view, pos): Tooltip | null => {
    try {
      const found = hoverAt(view.state.doc.toString(), pos)
      if (found === null) return null
      return {
        pos: found.from,
        end: found.to,
        above: true,
        // renderHoverTooltip рисует бейдж по `type` — у схемы это поле называется
        // `kind`, отдельного преобразователя ради одной строки заводить незачем
        create: () => ({ dom: renderHoverTooltip(found.key, { ...found.field, type: found.field.kind }) }),
      }
    } catch {
      return null
    }
  })
}

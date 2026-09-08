// Hover-тултип текстовой вкладки: при наведении на ключ (или на его значение)
// показывает описание из словаря и известные значения. Ключ берётся у строки
// под курсором, а секция — у contextAt: дерево CodeMirror здесь не нужно, как и
// в подсказках.

import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { MihomoField } from '../../../entities/mihomo'
import { renderHoverTooltip } from '../hoverTooltipDom'
import {
  containerKey,
  contextAt,
  fieldFor,
  nestedNamespace,
  type MihomoContainerKey,
  type MihomoCursor,
} from './context'

// «  - name: A» — отступ и дефис, имя ключа, пробелы до двоеточия
const LINE_KEY_RE = /^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+)(\s*):/

interface Hovered {
  key: string
  /** Что подсвечивать тултипом: сам ключ либо его значение */
  from: number
  to: number
  /** Ключ стоит в нулевой колонке, то есть принадлежит корню документа */
  atRoot: boolean
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
  // Нулевая колонка И без дефиса: ключ корня, а не элемента списка
  const atRoot = match[1] === ''
  if (pos >= keyFrom && pos <= keyTo) {
    return { key: match[2], from: keyFrom, to: keyTo, atRoot }
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
  return { key: match[2], from, to, atRoot }
}

export interface MihomoHover {
  key: string
  /**
   * Поле словаря либо описание раздела: у ключа-контейнера (`dns`, `rules`)
   * поля в словаре нет и быть не может — за ним стоит не значение, а раздел.
   */
  field: MihomoField | MihomoContainerKey
  /** Диапазон подсветки в тексте */
  from: number
  to: number
}

/**
 * Что показать при наведении на позицию — без EditorView и без DOM: всё, что
 * нужно тултипу, выводится из текста и словаря, а значит и проверяется тестом
 * без поднятия редактора.
 */
export function hoverAt(text: string, pos: number): MihomoHover | null {
  const hovered = hoveredKey(text, pos)
  if (hovered === null) return null
  // Контекст спрашивается о САМОЙ позиции наведения, а не о ключе строки: иначе
  // молчание внутри flow-коллекции (`proxies: [DIRECT]`) пришлось бы повторять
  // здесь второй проверкой, а описание ключа той же строки — из контекста ключа
  const cursor = contextAt(text, pos)
  if (cursor === null) return null
  const field = fieldFor(cursor, hovered.key) ?? sectionOrNamespace(cursor, hovered)
  if (field === undefined) return null
  return { key: hovered.key, field, from: hovered.from, to: hovered.to }
}

/**
 * Ключ, за которым стоит раздел, а не значение. Таких два вида, и словарь
 * секции не описывает ни один: контейнер корня (`dns`, `rules` — имя СЕКЦИИ или
 * список, поля с таким именем внутри секции нет) и вложенное отображение
 * составного ключа (`remnawave` при `remnawave.includeHiddenHosts`).
 *
 * Требование «в нулевой колонке» для первого вида существенно: `dns` внутри
 * записи группы — не секция DNS документа, и описывать его её словами значило
 * бы соврать. Такой ключ по-прежнему молчит.
 */
function sectionOrNamespace(cursor: MihomoCursor, hovered: Hovered): MihomoContainerKey | undefined {
  // Вложенное отображение бывает и в корне (`remnawave`), поэтому второй путь
  // пробуется всегда — контейнер лишь идёт первым
  const container = hovered.atRoot ? containerKey(hovered.key) : undefined
  return container ?? nestedNamespace(cursor.section, hovered.key)
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
        create: () => ({ dom: renderHoverTooltip(found.key, found.field) }),
      }
    } catch {
      return null
    }
  })
}

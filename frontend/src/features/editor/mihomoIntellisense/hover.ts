// Hover-тултип текстовой вкладки: при наведении на ключ (или на его значение)
// показывает описание из словаря и известные значения. Ключ берётся у строки
// под курсором, а секция — у contextAt: дерево CodeMirror здесь не нужно, как и
// в подсказках.

import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { MihomoField } from '../../../entities/mihomo'
import { contextAt, fieldFor } from './context'

// «  - name: A» — отступ и дефис, имя ключа, пробелы до двоеточия
const LINE_KEY_RE = /^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+)(\s*):/

interface Hovered {
  key: string
  /** Что подсвечивать тултипом: сам ключ либо его значение */
  from: number
  to: number
  /** Позиция ключа — по ней contextAt определяет секцию */
  keyEnd: number
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
    return { key: match[2], from: keyFrom, to: keyTo, keyEnd: keyTo }
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
  return { key: match[2], from, to, keyEnd: keyTo }
}

/** Разметка тултипа общая с JSON-вкладкой — стили лежат в tokens.css */
function renderTooltip(key: string, field: MihomoField): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-xray-hover'

  const head = document.createElement('div')
  head.className = 'cm-xray-hover-key'
  head.textContent = key
  const type = document.createElement('span')
  type.className = 'cm-xray-hover-type'
  type.textContent = field.type
  head.appendChild(type)
  dom.appendChild(head)

  const doc = document.createElement('div')
  doc.className = 'cm-xray-hover-doc'
  doc.textContent = field.doc
  dom.appendChild(doc)

  if (field.enum && field.enum.length > 0) {
    const list = document.createElement('div')
    list.className = 'cm-xray-hover-enum'
    for (const item of field.enum) {
      const row = document.createElement('div')
      row.className = 'cm-xray-hover-enum-row'
      const value = document.createElement('code')
      value.textContent = item.value
      row.appendChild(value)
      if (item.doc) {
        const text = document.createElement('span')
        text.textContent = item.doc
        row.appendChild(text)
      }
      list.appendChild(row)
    }
    dom.appendChild(list)
  }

  return dom
}

export function mihomoHover() {
  return hoverTooltip((view, pos): Tooltip | null => {
    try {
      const text = view.state.doc.toString()
      const hovered = hoveredKey(text, pos)
      if (hovered === null) return null
      const cursor = contextAt(text, hovered.keyEnd)
      if (cursor === null) return null
      const field = fieldFor(cursor, hovered.key)
      if (field === undefined) return null
      return {
        pos: hovered.from,
        end: hovered.to,
        above: true,
        create: () => ({ dom: renderTooltip(hovered.key, field) }),
      }
    } catch {
      return null
    }
  })
}

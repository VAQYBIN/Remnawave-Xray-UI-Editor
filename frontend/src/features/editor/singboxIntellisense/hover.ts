// Наведение на JSON-вкладке sing-box: под курсором ключ (или его скалярное
// значение) — показываем описание из схемы и допустимые значения.
//
// Чистая `hoverSingboxAt` отделена от расширения намеренно: она не знает ни про
// EditorView, ни про DOM, и её проверяют тесты. Обёртка только рисует, и рисует
// ОБЩИМ `renderHoverTooltip` — тем же, что у вкладок Xray и Mihomo.
//
// Ключ-раздел, за которым стоит не значение, а вложенное отображение
// (`remnawave`), теперь описан как обычное поле `kind: 'object'` — у него свой
// `doc` в схеме, отдельного случая для него, в отличие от прежнего словаря,
// не нужно.

import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { FieldSchema } from '../../../shared/schema'
import { renderHoverTooltip } from '../hoverTooltipDom'
import { singboxFields, singboxPathAt, treeAt } from './context'

function stripQuotes(text: string): string {
  return text.replace(/^"|"$/g, '')
}

/** Ключ (и диапазон подсветки) для узла под курсором, либо null */
function keyAtNode(
  state: EditorState,
  node: SyntaxNode,
): { key: string; from: number; to: number } | null {
  if (node.name === 'PropertyName') {
    return {
      key: stripQuotes(state.doc.sliceString(node.from, node.to)),
      from: node.from,
      to: node.to,
    }
  }
  if (node.name === 'String' || node.name === 'Number' || node.name === 'True' || node.name === 'False') {
    const parent = node.parent
    if (parent?.name === 'Property') {
      const name = parent.getChild('PropertyName')
      // значение свойства (а не сам PropertyName)
      if (name && name.from !== node.from) {
        return {
          key: stripQuotes(state.doc.sliceString(name.from, name.to)),
          from: node.from,
          to: node.to,
        }
      }
    }
    // элемент массива: ключ берём у Property, владеющего массивом
    if (parent?.name === 'Array') {
      const prop = parent.parent
      if (prop?.name === 'Property') {
        const name = prop.getChild('PropertyName')
        if (name) {
          return {
            key: stripQuotes(state.doc.sliceString(name.from, name.to)),
            from: node.from,
            to: node.to,
          }
        }
      }
    }
  }
  return null
}

export interface SingboxHover {
  key: string
  field: FieldSchema
  from: number
  to: number
}

export function hoverSingboxAt(
  state: EditorState,
  pos: number,
  side: -1 | 0 | 1 = -1,
): SingboxHover | null {
  try {
    const node = treeAt(state, pos).resolveInner(pos, side)
    const at = keyAtNode(state, node)
    if (!at) return null
    const cursor = singboxPathAt(state, pos)
    if (!cursor) return null

    const field = singboxFields(cursor).find((f) => f.key === at.key)
    if (!field) return null
    return { ...at, field }
  } catch {
    return null
  }
}

export function singboxHover() {
  return hoverTooltip((view, pos, side): Tooltip | null => {
    const found = hoverSingboxAt(view.state, pos, side)
    if (!found || (!found.field.doc && !found.field.enum)) return null
    return {
      pos: found.from,
      end: found.to,
      above: true,
      // renderHoverTooltip рисует бейдж по `type` — у схемы это поле называется
      // `kind`, отдельного преобразователя ради одной строки заводить незачем
      create: () => ({ dom: renderHoverTooltip(found.key, { ...found.field, type: found.field.kind }) }),
    }
  })
}

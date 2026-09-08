// Наведение на JSON-вкладке sing-box: под курсором ключ (или его скалярное
// значение) — показываем описание из словаря и допустимые значения.
//
// Чистая `hoverSingboxAt` отделена от расширения намеренно: она не знает ни про
// EditorView, ни про DOM, и её проверяют тесты. Обёртка только рисует, и рисует
// ОБЩИМ `renderHoverTooltip` — тем же, что у вкладок Xray и Mihomo.

import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { nestedNamespaceDoc } from '../../../entities/singbox/docPath'
import type { SingboxField } from '../../../entities/singbox/docSchema'
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
  field: SingboxField
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
    if (!cursor || cursor.section === undefined) return null

    const field = singboxFields(cursor).find((f) => f.key === at.key)
    if (field) return { ...at, field }

    // Ключ, за которым стоит не значение, а вложенное отображение (`remnawave`):
    // своего поля в словаре у него нет, зато есть перечень листьев. Текст берём
    // у `docPath`, одним на обоих потребителей — наведение и подсказку при
    // наборе: разойдясь, они описывали бы один ключ по-разному
    const doc = nestedNamespaceDoc(cursor.section, at.key)
    if (doc === undefined) return null
    return { ...at, field: { key: at.key, doc, type: 'object' } }
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
      create: () => ({ dom: renderHoverTooltip(found.key, found.field) }),
    }
  })
}

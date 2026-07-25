// Hover-тултип для JSON-редактора: при наведении на существующий ключ (или его
// скалярное значение) показывает описание из docSchema и допустимые значения.

import { syntaxTree } from '@codemirror/language'
import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { nodeFields, type DocField } from '../../../entities/xray/docSchema'
import { resolvePath, type XrayRootKind } from './context'

function stripQuotes(text: string): string {
  return text.replace(/^"|"$/g, '')
}

/** Ключ (и диапазон подсветки) для узла под курсором, либо null */
function keyAtNode(state: EditorState, node: SyntaxNode): { key: string; from: number; to: number } | null {
  if (node.name === 'PropertyName') {
    return { key: stripQuotes(state.doc.sliceString(node.from, node.to)), from: node.from, to: node.to }
  }
  if (node.name === 'String' || node.name === 'Number' || node.name === 'True' || node.name === 'False') {
    const parent = node.parent
    if (parent?.name === 'Property') {
      const name = parent.getChild('PropertyName')
      // значение свойства (а не сам PropertyName)
      if (name && name.from !== node.from) {
        return { key: stripQuotes(state.doc.sliceString(name.from, name.to)), from: node.from, to: node.to }
      }
    }
    // элемент массива-энума: ключ берём у Property, владеющего массивом
    if (parent?.name === 'Array') {
      const prop = parent.parent
      if (prop?.name === 'Property') {
        const name = prop.getChild('PropertyName')
        if (name) return { key: stripQuotes(state.doc.sliceString(name.from, name.to)), from: node.from, to: node.to }
      }
    }
  }
  return null
}

function renderTooltip(key: string, field: DocField): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-xray-hover'

  const head = document.createElement('div')
  head.className = 'cm-xray-hover-key'
  head.textContent = key
  if (field.type) {
    const t = document.createElement('span')
    t.className = 'cm-xray-hover-type'
    t.textContent = field.type
    head.appendChild(t)
  }
  dom.appendChild(head)

  if (field.doc) {
    const p = document.createElement('div')
    p.className = 'cm-xray-hover-doc'
    p.textContent = field.doc
    dom.appendChild(p)
  }

  if (field.enum && field.enum.length > 0) {
    const list = document.createElement('div')
    list.className = 'cm-xray-hover-enum'
    for (const e of field.enum) {
      const row = document.createElement('div')
      row.className = 'cm-xray-hover-enum-row'
      const v = document.createElement('code')
      v.textContent = e.value
      row.appendChild(v)
      if (e.doc) {
        const d = document.createElement('span')
        d.textContent = e.doc
        row.appendChild(d)
      }
      list.appendChild(row)
    }
    dom.appendChild(list)
  }

  return dom
}

export function makeHover(rootKind: XrayRootKind) {
  return hoverTooltip((view, pos, side): Tooltip | null => {
    try {
      const node = syntaxTree(view.state).resolveInner(pos, side)
      const at = keyAtNode(view.state, node)
      if (!at) return null
      const path = resolvePath(view.state, pos, rootKind)
      if (!path?.nodeName) return null
      const field = nodeFields(path.nodeName, path.props)[at.key]
      if (!field || (!field.doc && !field.enum)) return null
      return {
        pos: at.from,
        end: at.to,
        above: true,
        create: () => ({ dom: renderTooltip(at.key, field) }),
      }
    } catch {
      return null
    }
  })
}

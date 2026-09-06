// Разметка hover-тултипа, общая для обеих текстовых вкладок: JSON у Xray и
// YAML у Mihomo. Словари у них разные (`DocField` и `MihomoField`), но описание
// поля устроено одинаково — тип, текст, необязательный список значений, — и
// функция берёт его структурным типом, без дженериков и без зависимости от
// какого-либо из словарей.
//
// Имена классов остались прежними (`cm-xray-hover*`): на них завязан tokens.css,
// а переименование задело бы вкладку Xray без всякой пользы.

export interface HoverEnumItem {
  value: string
  doc?: string
}

export interface HoverField {
  type?: string
  doc?: string
  enum?: readonly HoverEnumItem[]
}

export function renderHoverTooltip(key: string, field: HoverField): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-xray-hover'

  const head = document.createElement('div')
  head.className = 'cm-xray-hover-key'
  head.textContent = key
  if (field.type) {
    const type = document.createElement('span')
    type.className = 'cm-xray-hover-type'
    type.textContent = field.type
    head.appendChild(type)
  }
  dom.appendChild(head)

  if (field.doc) {
    const doc = document.createElement('div')
    doc.className = 'cm-xray-hover-doc'
    doc.textContent = field.doc
    dom.appendChild(doc)
  }

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
        const doc = document.createElement('span')
        doc.textContent = item.doc
        row.appendChild(doc)
      }
      list.appendChild(row)
    }
    dom.appendChild(list)
  }

  return dom
}

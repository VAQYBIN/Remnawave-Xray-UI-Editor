import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { locateRange } from '../src/features/editor/jsonLocate'

const DOC = `{
  "inbounds": [
    {
      "tag": "vless-in",
      "streamSettings": { "network": "ws", "security": "reality" }
    }
  ],
  "dns": { "hosts": { "example.com": ["1.2.3.4"] } }
}`

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [json()] })
}

function slice(doc: string, range: { from: number; to: number } | null): string | null {
  return range ? doc.slice(range.from, range.to) : null
}

describe('locateRange', () => {
  it('находит значение вложенного ключа, а не всю пару', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0, 'streamSettings', 'security'])
    expect(slice(DOC, range)).toBe('"reality"')
  })

  it('находит элемент массива по индексу', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0])
    expect(slice(DOC, range)?.startsWith('{')).toBe(true)
    expect(slice(DOC, range)).toContain('"vless-in"')
  })

  it('находит объект целиком, когда путь кончается на нём', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0, 'streamSettings'])
    expect(slice(DOC, range)).toBe('{ "network": "ws", "security": "reality" }')
  })

  it('ключ с точкой внутри не разбирается на сегменты', () => {
    const range = locateRange(stateOf(DOC), ['dns', 'hosts', 'example.com'])
    expect(slice(DOC, range)).toBe('["1.2.3.4"]')
  })

  it('нет последнего сегмента — отдаёт глубочайшего найденного предка', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 0, 'streamSettings', 'flow'])
    expect(slice(DOC, range)).toBe('{ "network": "ws", "security": "reality" }')
  })

  it('не найден ни один сегмент — null, а не весь документ', () => {
    expect(locateRange(stateOf(DOC), ['log', 'loglevel'])).toBeNull()
  })

  it('пустой путь — null: у ошибки разбора JSON места нет', () => {
    expect(locateRange(stateOf(DOC), [])).toBeNull()
  })

  it('индекс за границей массива — предок', () => {
    const range = locateRange(stateOf(DOC), ['inbounds', 7])
    expect(slice(DOC, range)?.startsWith('[')).toBe(true)
  })

  it('нечитаемый документ — null', () => {
    expect(locateRange(stateOf('не json вовсе'), ['inbounds', 0])).toBeNull()
  })
})

import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { yaml } from '@codemirror/lang-yaml'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { contextAt } from '../src/features/editor/mihomoIntellisense/context'
import { mihomoCompletionSource } from '../src/features/editor/mihomoIntellisense/complete'

// Позиция курсора помечается ‸ — символ, в YAML-содержимом не встречающийся
const CARET = '‸'

function at(src: string): { text: string; pos: number } {
  const pos = src.indexOf(CARET)
  if (pos < 0) throw new Error('нет маркера курсора ‸')
  return { text: src.slice(0, pos) + src.slice(pos + CARET.length), pos }
}

function complete(src: string): CompletionResult | null {
  const { text, pos } = at(src)
  const state = EditorState.create({ doc: text, extensions: [yaml()] })
  return mihomoCompletionSource(new CompletionContext(state, pos, true))
}

function labels(src: string): string[] {
  return (complete(src)?.options ?? []).map((o) => String(o.label))
}

describe('контекст курсора', () => {
  it('внутри элемента proxy-groups — секция группы', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    ‸\n')
    const ctx = contextAt(text, pos)
    expect(ctx?.section).toBe('proxy-group')
    expect(ctx?.mode).toBe('key')
    expect(ctx?.existingKeys).toContain('name')
  })

  it('внутри dns — секция dns', () => {
    const { text, pos } = at('dns:\n  enable: true\n  ‸\n')
    expect(contextAt(text, pos)?.section).toBe('dns')
  })

  it('после двоеточия — режим значения с именем ключа', () => {
    const { text, pos } = at('proxy-groups:\n  - name: A\n    type: ‸\n')
    const ctx = contextAt(text, pos)
    expect(ctx?.mode).toBe('value')
    expect(ctx?.key).toBe('type')
  })
})

describe('подсказки Mihomo', () => {
  it('ключи группы предлагаются и не повторяют уже введённые', () => {
    const got = labels('proxy-groups:\n  - name: A\n    type: select\n    ‸\n')
    expect(got).toEqual(expect.arrayContaining(['filter', 'interval', 'use']))
    expect(got).not.toContain('name')
    expect(got).not.toContain('type')
  })

  it('значения типа группы предлагаются из словаря', () => {
    expect(labels('proxy-groups:\n  - name: A\n    type: ‸\n')).toEqual(
      expect.arrayContaining(['select', 'url-test', 'fallback', 'load-balance', 'relay']),
    )
  })

  it('ключи dns не смешиваются с ключами группы', () => {
    const got = labels('dns:\n  enable: true\n  ‸\n')
    expect(got).toEqual(expect.arrayContaining(['enhanced-mode', 'nameserver']))
    expect(got).not.toContain('filter')
  })

  it('в корне предлагаются секции верхнего уровня', () => {
    expect(labels('‸\n')).toEqual(expect.arrayContaining(['mode', 'log-level', 'dns', 'tun']))
  })

  it('битый YAML ниже курсора не мешает подсказкам выше', () => {
    const got = labels('proxy-groups:\n  - name: A\n    ‸\nrules:\n  - [\n')
    expect(got).toContain('type')
  })

  it('подсказка несёт описание из словаря', () => {
    const option = (complete('dns:\n  ‸\n')?.options ?? []).find((o) => o.label === 'enhanced-mode')
    expect(String(option?.info ?? '')).toMatch(/fake-ip|redir-host|режим/i)
  })
})

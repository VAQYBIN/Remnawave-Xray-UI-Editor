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

// containerOf — приватная середина contextAt, и проверяется через его `parts`:
// отдельный экспорт потребовал бы синтетического пути и колонки, а значение
// имеет ровно то, во что они складываются на настоящем тексте
describe('отображение, которому принадлежит курсор', () => {
  function parts(src: string) {
    const { text, pos } = at(src)
    return contextAt(text, pos)?.parts
  }

  it('отступ пустой строки внутри элемента списка — сам элемент', () => {
    expect(parts('proxy-groups:\n  - name: A\n    ‸\n')).toEqual(['proxy-groups', 0])
  })

  it('отступ внутри вложенной секции — сама секция', () => {
    expect(parts('proxy-groups:\n  - name: A\n    remnawave:\n      ‸\n')).toEqual([
      'proxy-groups',
      0,
      'remnawave',
    ])
  })

  it('нулевая колонка — корень документа, а не секция выше', () => {
    expect(parts('dns:\n  enable: true\n‸\n')).toEqual([])
  })

  it('после «type: » без значения — отображение группы, а не сама пара', () => {
    expect(parts('proxy-groups:\n  - name: A\n    type: ‸\n')).toEqual(['proxy-groups', 0])
  })

  it('пустой документ — корень', () => {
    expect(parts('‸')).toEqual([])
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

  it('в корне предлагаются и ключи-контейнеры', () => {
    expect(labels('‸\n')).toEqual(
      expect.arrayContaining(['proxies', 'proxy-groups', 'rules', 'rule-providers']),
    )
  })

  it('уже написанный ключ-контейнер второй раз не предлагается', () => {
    expect(labels('rules:\n  - MATCH,DIRECT\n‸\n')).not.toContain('rules')
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

import { CompletionContext } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { singboxCompletionSource } from '../src/features/editor/singboxIntellisense/complete'
import { singboxPathAt } from '../src/features/editor/singboxIntellisense/context'
import { hoverSingboxAt } from '../src/features/editor/singboxIntellisense/hover'

/**
 * Разбор без стенных часов.
 *
 * `ensureSyntaxTree` отмеряет бюджет по `Date.now()`, а тратит его на работу
 * процессора. Под нагрузкой воркер вытесняется ОС, бюджет истекает на пустом
 * месте, дерево возвращается неполным — и тест краснел бы не на дефекте, а на
 * занятости машины. С замороженными часами бюджет не истекает никогда, и цикл
 * выходит только по завершении разбора. Приём взят у теста подсказок Xray,
 * где эта грабля уже наступала.
 */
function withFrozenClock<T>(fn: () => T): T {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}

function stateAt(text: string): EditorState {
  return EditorState.create({ doc: text, extensions: [json()] })
}

/** Позиция курсора обозначается символом | и вырезается перед разбором */
function at(marked: string): { state: EditorState; pos: number } {
  const pos = marked.indexOf('|')
  return { state: stateAt(marked.replace('|', '')), pos }
}

/** Ключи полей, которые схема видит в этом месте курсора */
function fieldKeys(marked: string): string[] | undefined {
  const { state, pos } = at(marked)
  const cursor = withFrozenClock(() => singboxPathAt(state, pos))
  return cursor?.fields?.map((f) => f.key)
}

describe('контекст подсказок sing-box', () => {
  it('корень документа', () => {
    const keys = fieldKeys('{\n  "lo|"\n}')
    expect(keys).toEqual(expect.arrayContaining(['log', 'dns', 'outbounds']))
  })

  it('элемент outbounds различает группу и сервер по типу', () => {
    const group = fieldKeys('{"outbounds":[{"type":"selector","ou|"}]}')
    expect(group).toContain('outbounds')
    expect(group).not.toContain('server')
    const server = fieldKeys('{"outbounds":[{"type":"vless","se|"}]}')
    expect(server).toContain('uuid')
  })

  it('правило маршрута и вложенное правило логического — оба знают domain_suffix', () => {
    const rule = fieldKeys('{"route":{"rules":[{"do|"}]}}')
    expect(rule).toContain('domain_suffix')
    const nested = fieldKeys('{"route":{"rules":[{"type":"logical","rules":[{"do|"}]}]}}')
    expect(nested).toContain('domain_suffix')
  })

  it('уже написанные ключи объекта известны — их подсказка не предлагает второй раз', () => {
    const { state, pos } = at('{"route":{"final":"d","ru|"}}')
    expect(withFrozenClock(() => singboxPathAt(state, pos))!.existingKeys).toContain('final')
  })

  it('место, которого схема не описывает, полей не имеет', () => {
    // Молчание там, где сказать нечего: выдуманное описание читается как знание
    const keys = fieldKeys('{"unknown_section":{"a|"}}')
    expect(keys).toBeUndefined()
  })

  // Дерево в состоянии CodeMirror — снимок, сделанный при создании
  // LanguageState: начальный тайм-слайс на большом документе до хвоста не
  // доходит, а `ensureSyntaxTree` снимок не обновляет. Резолвер обязан
  // дотягивать дерево сам — иначе подсказки в конце длинного шаблона молчат
  it('контекст известен и в хвосте, куда начальный разбор не дошёл', () => {
    const filler = Array.from(
      { length: 3000 },
      (_, i) => `{"domain_suffix":["d${i}.example"],"outbound":"direct"}`,
    ).join(',\n')
    const text = `{"route":{"rules":[${filler}]},"dns":{"servers":[{"`
    // Состояние создаётся при ЖИВЫХ часах: снимок остаётся коротким, и тест
    // умеет отличить «резолвер дотянул дерево» от «дерево и так было готово»
    const state = stateAt(text)
    const found = withFrozenClock(() => singboxPathAt(state, text.length))
    expect(found!.fields?.map((f) => f.key)).toContain('tag')
  })
})

function labels(marked: string): string[] {
  const { state, pos } = at(marked)
  const ctx = new CompletionContext(state, pos, true)
  const result = withFrozenClock(() => singboxCompletionSource(ctx))
  return (result?.options ?? []).map((o) => String(o.label))
}

describe('подсказки sing-box', () => {
  it('ключи предлагаются по секции и без уже написанных', () => {
    const got = labels('{"route":{"final":"direct","|"}}')
    expect(got).toContain('rules')
    expect(got).not.toContain('final')
  })

  it('значение ключа берётся из enum поля', () => {
    expect(labels('{"outbounds":[{"type":"|"}]}')).toEqual(
      expect.arrayContaining(['selector', 'urltest', 'vless']),
    )
  })

  it('элемент массива-энума подсказывается по полю-владельцу', () => {
    // network правила маршрута — свой список значений (tcp/udp/icmp с 1.13),
    // отличный от network выхода (только tcp/udp)
    expect(labels('{"route":{"rules":[{"network":["|"]}]}}')).toEqual(['tcp', 'udp', 'icmp'])
  })

  it('там, где схема молчит, подсказок нет', () => {
    expect(labels('{"unknown_section":{"|"}}')).toEqual([])
  })

  it('внутри правила DNS предлагаются server и query_type, но не hijack-dns', () => {
    // Секция правила DNS — свой список полей действия (route/reject/predefined…),
    // а не список действий правила маршрута: hijack-dns там не существует
    const got = labels('{"dns":{"rules":[{"|"}]}}')
    expect(got).toContain('server')
    expect(got).toContain('query_type')
    const actionValues = labels('{"dns":{"rules":[{"action":"|"}]}}')
    expect(actionValues).not.toContain('hijack-dns')
  })

  it('устаревшее значение перечисления предлагается с пометкой', () => {
    const { state, pos } = at('{"outbounds":[{"type":"|"}]}')
    const ctx = new CompletionContext(state, pos, true)
    const result = withFrozenClock(() => singboxCompletionSource(ctx))
    const block = result?.options.find((o) => o.label === 'block')
    expect(block?.detail).toBe('устарело')
  })
})

describe('наведение sing-box', () => {
  it('описывает ключ секции', () => {
    const text = '{"route":{"final":"direct"}}'
    const state = stateAt(text)
    const found = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('final') + 2))
    expect(found!.field.doc).toMatch(/\S/)
  })

  it('описывает и ключ-раздел, за которым стоит не значение', () => {
    // `route` в схеме есть как поле корня — молчать на нём незачем
    const text = '{"route":{"rules":[]}}'
    const state = stateAt(text)
    const found = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('route') + 2))
    expect(found!.field.doc).toMatch(/[Мм]аршрут/)
  })

  it('молчит там, где схема ничего не описывает', () => {
    const text = '{"outbounds":[{"type":"direct","brand_new":1}]}'
    const state = stateAt(text)
    expect(withFrozenClock(() => hoverSingboxAt(state, text.indexOf('brand_new') + 2))).toBeNull()
  })

  it('описывает ключ-раздел вложенного отображения (remnawave)', () => {
    // `remnawave` в схеме — обычное поле kind: 'object' у группы, со своим doc
    const text = '{"outbounds":[{"type":"selector","remnawave":{"includeProxies":false}}]}'
    const state = stateAt(text)
    const found = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('remnawave') + 2))
    expect(found!.field.kind).toBe('object')
    expect(found!.field.doc).toMatch(/\S/)
  })

  it('вложенное отображение панели описано и снаружи, и изнутри', () => {
    const text = '{"outbounds":[{"type":"selector","remnawave":{"includeProxies":false}}]}'
    const state = stateAt(text)
    const head = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('remnawave') + 2))
    expect(head!.field.doc).toMatch(/\S/)
    const leaf = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('includeProxies') + 2))
    expect(leaf!.field.doc).toMatch(/\S/)
  })
})

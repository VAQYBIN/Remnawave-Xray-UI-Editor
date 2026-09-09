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

describe('контекст подсказок sing-box', () => {
  it('корень документа', () => {
    const { state, pos } = at('{\n  "lo|"\n}')
    expect(withFrozenClock(() => singboxPathAt(state, pos))!.section).toBe('root')
  })

  it('элемент outbounds различает группу и сервер по типу', () => {
    const group = at('{"outbounds":[{"type":"selector","ou|"}]}')
    expect(withFrozenClock(() => singboxPathAt(group.state, group.pos))!.section).toBe('group')
    const server = at('{"outbounds":[{"type":"shadowsocks","se|"}]}')
    expect(withFrozenClock(() => singboxPathAt(server.state, server.pos))!.section).toBe('outbound')
  })

  it('правило маршрута и вложенное правило логического — одна секция', () => {
    const rule = at('{"route":{"rules":[{"do|"}]}}')
    expect(withFrozenClock(() => singboxPathAt(rule.state, rule.pos))!.section).toBe('route-rule')
    const nested = at('{"route":{"rules":[{"type":"logical","rules":[{"do|"}]}]}}')
    expect(withFrozenClock(() => singboxPathAt(nested.state, nested.pos))!.section).toBe('route-rule')
  })

  it('уже написанные ключи объекта известны — их подсказка не предлагает второй раз', () => {
    const { state, pos } = at('{"route":{"final":"d","ru|"}}')
    expect(withFrozenClock(() => singboxPathAt(state, pos))!.existingKeys).toContain('final')
  })

  it('место, которого словарь не описывает, секции не имеет', () => {
    // Молчание там, где сказать нечего: выдуманное описание читается как знание
    const { state, pos } = at('{"unknown_section":{"a|"}}')
    expect(withFrozenClock(() => singboxPathAt(state, pos))!.section).toBeUndefined()
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
    expect(found!.section).toBe('dns-server')
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
    expect(labels('{"route":{"rules":[{"network":["|"]}]}}')).toEqual(['tcp', 'udp'])
  })

  it('там, где словарь молчит, подсказок нет', () => {
    expect(labels('{"unknown_section":{"|"}}')).toEqual([])
  })

  it('внутри правила DNS подсказок нет: ключи маршрута ему чужие', () => {
    // Секции dns-rule в словаре пока нет, а ключи route-rule (outbound,
    // hijack-dns, sniff) у DNS-правила не работают: подсказка ими читалась бы
    // как знание о документе, которого у редактора нет
    const got = labels('{"dns":{"rules":[{"|"}]}}')
    expect(got).not.toContain('outbound')
    expect(got).not.toContain('hijack-dns')
    expect(got).toEqual([])
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
    // `route` в словаре есть как ключ секции root — молчать на нём незачем
    const text = '{"route":{"rules":[]}}'
    const state = stateAt(text)
    const found = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('route') + 2))
    expect(found!.field.doc).toMatch(/[Мм]аршрут/)
  })

  it('молчит там, где словарь ничего не описывает', () => {
    const text = '{"outbounds":[{"type":"direct","brand_new":1}]}'
    const state = stateAt(text)
    expect(withFrozenClock(() => hoverSingboxAt(state, text.indexOf('brand_new') + 2))).toBeNull()
  })

  it('вложенное отображение панели описано и снаружи, и изнутри', () => {
    // Один текст на обоих потребителей: `remnawave` своей секции не имеет,
    // а его лист живёт в секции группы под точкой
    const text = '{"outbounds":[{"type":"selector","remnawave":{"includeProxies":false}}]}'
    const state = stateAt(text)
    const head = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('remnawave') + 2))
    expect(head!.field.doc).toContain('includeProxies')
    const leaf = withFrozenClock(() => hoverSingboxAt(state, text.indexOf('includeProxies') + 2))
    expect(leaf!.field.doc).toMatch(/[Пп]анел/)
  })
})

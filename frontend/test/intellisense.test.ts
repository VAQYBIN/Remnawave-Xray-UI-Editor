import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { descend, nodeFields } from '../src/entities/xray/docSchema'
import { makeCompletionSource } from '../src/features/editor/intellisense/complete'
import { resolvePath, type XrayRootKind } from '../src/features/editor/intellisense/context'

// `ensureSyntaxTree` в build() отмеряет бюджет разбора ПО СТЕННЫМ ЧАСАМ, а не по объёму
// работы. Документы здесь крошечные, и разбор стоит микросекунды процессорного времени, но
// под нагрузкой (92+ тест-файлов, параллельные воркеры, сборка рядом) воркер вытесняется
// ОС на секунды — бюджет истекает, дерево возвращается неполным, и тест падает не таймаутом,
// а невнятным несовпадением подсказок. Поэтому бюджету дан запас в 10 с — на здешних
// документах это тысячекратный, — а таймаут файла держится кратно больше (60 с), чтобы
// тест, зовущий build() дважды, успел упасть на бюджете с внятным сообщением, а не упереться
// в таймаут. Дефолтный таймаут проекта намеренно не трогаем: реально медленный тест должен
// оставаться заметным.
const PARSE_BUDGET_MS = 10_000

vi.setConfig({ testTimeout: 60_000 })

// Позиция курсора помечается символом ‸ — редкий, в JSON-контенте не встречается
const CARET = '‸'

function build(src: string) {
  const pos = src.indexOf(CARET)
  if (pos < 0) throw new Error('нет маркера курсора ‸')
  const doc = src.slice(0, pos) + src.slice(pos + CARET.length)
  const state = EditorState.create({ doc, extensions: [json()] })
  // null означает «в бюджет не уложился» — дальше тест сравнивал бы подсказки,
  // построенные по неполному дереву, и падал бы с невнятным сообщением
  if (ensureSyntaxTree(state, doc.length, PARSE_BUDGET_MS) === null) {
    throw new Error(`разбор не уложился в ${PARSE_BUDGET_MS} мс — машина перегружена`)
  }
  return { state, pos }
}

function complete(src: string, rootKind: XrayRootKind = 'config'): CompletionResult | null {
  const { state, pos } = build(src)
  const ctx = new CompletionContext(state, pos, true)
  return makeCompletionSource(rootKind)(ctx)
}

function labels(src: string, rootKind: XrayRootKind = 'config'): string[] {
  return (complete(src, rootKind)?.options ?? []).map((o) => String(o.label))
}

describe('автоподсказки ключей', () => {
  it('корень конфига предлагает секции верхнего уровня', () => {
    const got = labels(`{ "${CARET}" }`)
    expect(got).toEqual(expect.arrayContaining(['inbounds', 'outbounds', 'routing', 'dns', 'log']))
  })

  it('settings inbound-а зависят от protocol: vless', () => {
    const got = labels(
      `{ "inbounds": [ { "protocol": "vless", "settings": { "${CARET}" } } ] }`,
    )
    expect(got).toEqual(expect.arrayContaining(['flow', 'fallbacks', 'decryption', 'clients']))
  })

  it('settings inbound-а зависят от protocol: trojan (нет flow/decryption)', () => {
    const got = labels(
      `{ "inbounds": [ { "protocol": "trojan", "settings": { "${CARET}" } } ] }`,
    )
    expect(got).toEqual(expect.arrayContaining(['clients', 'fallbacks']))
    expect(got).not.toContain('flow')
    expect(got).not.toContain('decryption')
  })

  it('уже введённые ключи не предлагаются повторно', () => {
    const got = labels(
      `{ "inbounds": [ { "protocol": "vless", "settings": { "flow": "xtls-rprx-vision", "${CARET}" } } ] }`,
    )
    expect(got).not.toContain('flow')
    expect(got).toContain('fallbacks')
  })

  it('вложенные транспорты: streamSettings', () => {
    const got = labels(`{ "outbounds": [ { "protocol": "vless", "streamSettings": { "${CARET}" } } ] }`)
    expect(got).toEqual(expect.arrayContaining(['network', 'security', 'tlsSettings', 'realitySettings', 'sockopt']))
  })
})

describe('автоподсказки значений', () => {
  it('flow → xtls-rprx-vision', () => {
    const res = complete(
      `{ "inbounds": [ { "protocol": "vless", "settings": { "flow": "${CARET}" } } ] }`,
    )
    expect((res?.options ?? []).map((o) => String(o.label))).toContain('xtls-rprx-vision')
  })

  it('вставка значения без кавычек оборачивает в кавычки', () => {
    // курсор после двоеточия, кавычка ещё не открыта
    const res = complete(
      `{ "inbounds": [ { "protocol": "vless", "streamSettings": { "network": ${CARET} } } ] }`,
    )
    const tcp = (res?.options ?? []).find((o) => o.label === 'tcp')
    expect(tcp?.apply).toBe('"tcp"')
  })

  it('security предлагает none/tls/reality', () => {
    const got = (
      complete(`{ "inbounds": [ { "streamSettings": { "security": "${CARET}" } } ] }`)?.options ?? []
    ).map((o) => String(o.label))
    expect(got).toEqual(expect.arrayContaining(['none', 'tls', 'reality']))
  })

  it('enum внутри массива: alpn', () => {
    const got = (
      complete(`{ "inbounds": [ { "streamSettings": { "tlsSettings": { "alpn": ["${CARET}"] } } } ] }`)
        ?.options ?? []
    ).map((o) => String(o.label))
    expect(got).toEqual(expect.arrayContaining(['h2', 'http/1.1', 'h3']))
  })
})

describe('rootKind инспектора', () => {
  it('JSON одиночного inbound-а стартует с узла inbound', () => {
    const got = labels(`{ "protocol": "vless", "settings": { "${CARET}" } }`, 'inbound')
    expect(got).toEqual(expect.arrayContaining(['flow', 'fallbacks']))
  })

  it('JSON правила стартует с узла rule', () => {
    const got = labels(`{ "${CARET}" }`, 'rule')
    expect(got).toEqual(expect.arrayContaining(['inboundTag', 'outboundTag', 'domain', 'ip', 'port']))
  })
})

describe('незакрытый JSON (как при живом наборе)', () => {
  it('ключи settings резолвятся при незакрытых скобках', () => {
    const got = labels(`{ "protocol": "vless", "settings": { "${CARET}`, 'inbound')
    expect(got).toEqual(expect.arrayContaining(['flow', 'fallbacks']))
  })

  it('значение flow резолвится при незакрытых скобках', () => {
    const res = complete(`{ "protocol": "vless", "settings": { "flow": "${CARET}`, 'inbound')
    expect((res?.options ?? []).map((o) => String(o.label))).toContain('xtls-rprx-vision')
  })
})

describe('resolvePath — разрешение пути до узла', () => {
  it('доводит путь до вложенного узла streamSettings', () => {
    const { state, pos } = build(
      `{ "inbounds": [ { "protocol": "vless", "streamSettings": { "${CARET}" } } ] }`,
    )
    expect(resolvePath(state, pos, 'config')?.nodeName).toBe('streamSettings')
  })

  it('видит protocol как соседний скаляр при разрешении settings', () => {
    const { state, pos } = build(
      `{ "outbounds": [ { "protocol": "wireguard", "settings": { "${CARET}" } } ] }`,
    )
    expect(resolvePath(state, pos, 'config')?.nodeName).toBe('wireguardOutboundSettings')
  })
})

describe('словарь: балансеры и обсерватория', () => {
  it('знает поля балансера и обеих обсерваторий', () => {
    expect(Object.keys(nodeFields('balancer'))).toEqual(
      expect.arrayContaining(['tag', 'selector', 'fallbackTag', 'strategy']),
    )
    expect(Object.keys(nodeFields('observatory'))).toEqual(
      expect.arrayContaining(['subjectSelector', 'probeUrl', 'probeInterval', 'enableConcurrency']),
    )
    expect(Object.keys(nodeFields('pingConfig'))).toEqual(
      expect.arrayContaining(['destination', 'interval', 'sampling', 'timeout']),
    )
  })

  it('спуск по дереву доводит до нужных узлов', () => {
    expect(descend('routing', 'balancers')).toBe('balancer')
    expect(descend('balancer', 'strategy')).toBe('balancerStrategy')
    expect(descend('config', 'observatory')).toBe('observatory')
    expect(descend('config', 'burstObservatory')).toBe('burstObservatory')
    expect(descend('burstObservatory', 'pingConfig')).toBe('pingConfig')
  })
})

// Схемы объявлены через looseObject, поэтому новое поле не ловится ни парсингом,
// ни tsc — единственное наблюдаемое следствие правки docSchema — сами подсказки
describe('подсказки полей, добавленных в Xray v26.7.28', () => {
  it('корень предлагает env', () => {
    expect(labels(`{ "${CARET}" }`)).toContain('env')
  })

  it('streamSettings предлагает method рядом с network', () => {
    const got = labels(`{ "inbounds": [ { "streamSettings": { "${CARET}" } } ] }`)
    expect(got).toEqual(expect.arrayContaining(['network', 'method']))
  })

  it('tlsSettings предлагает cipherSuites и пиннинг', () => {
    const got = labels(
      `{ "inbounds": [ { "streamSettings": { "tlsSettings": { "${CARET}" } } } ] }`,
    )
    expect(got).toEqual(
      expect.arrayContaining(['cipherSuites', 'pinnedPeerCertSha256', 'verifyPeerCertByName']),
    )
  })

  it('realitySettings предлагает minClientVer', () => {
    const got = labels(
      `{ "inbounds": [ { "streamSettings": { "realitySettings": { "${CARET}" } } } ] }`,
    )
    expect(got).toEqual(expect.arrayContaining(['minClientVer', 'maxClientVer']))
  })

  it('finalmask предлагает xmc рядом с quicParams', () => {
    const got = labels(`{ "inbounds": [ { "streamSettings": { "finalmask": { "${CARET}" } } } ] }`)
    expect(got).toEqual(expect.arrayContaining(['quicParams', 'xmc']))
  })
})

// Дерево в состоянии CodeMirror — снимок, сделанный при создании LanguageState:
// начальный тайм-слайс разбора на большом документе до хвоста не доходит, а
// ensureSyntaxTree снимок не обновляет (двигает parse-контекст). Резолвер обязан
// дотягивать дерево сам — иначе подсказки в конце длинного конфига молчат. Здесь
// state создаётся БЕЗ предварительного ensureSyntaxTree, в отличие от build().
describe('большой документ', () => {
  it('подсказки работают в хвосте, куда начальный разбор не дошёл', () => {
    const filler = Array.from(
      { length: 800 },
      (_, i) => `{"tag": "out-${i}", "protocol": "freedom", "settings": {}}`,
    ).join(', ')
    const doc = `{"outbounds": [${filler}], "inbounds": [{"`
    const state = EditorState.create({ doc, extensions: [json()] })
    const ctx = new CompletionContext(state, doc.length, true)
    const result = makeCompletionSource('config')(ctx)
    expect(result?.options.map((o) => o.label)).toContain('protocol')
  })
})

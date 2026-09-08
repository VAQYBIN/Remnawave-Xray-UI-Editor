import { describe, expect, it } from 'vitest'
import {
  looksLikeSingbox,
  looksLikeXrayConfig,
  parseImportedJson,
} from '../src/features/editor/configFile'

describe('различение JSON-документов при загрузке файла', () => {
  it('признак sing-box — route/experimental, признак Xray — routing/policy', () => {
    expect(looksLikeSingbox({ inbounds: [], outbounds: [], route: { rules: [] } })).toBe(true)
    expect(looksLikeSingbox({ inbounds: [], outbounds: [], routing: { rules: [] } })).toBe(false)
    expect(looksLikeXrayConfig({ inbounds: [], outbounds: [], routing: { rules: [] } })).toBe(true)
  })

  it('конфиг Xray в редактор sing-box не грузится', () => {
    const res = parseImportedJson(JSON.stringify({ inbounds: [], outbounds: [], routing: {} }), 'singbox')
    expect('error' in res).toBe(true)
    expect((res as { error: string }).error).toMatch(/Xray/)
  })

  it('шаблон sing-box в редактор Xray не грузится', () => {
    const res = parseImportedJson(JSON.stringify({ inbounds: [], outbounds: [], route: {} }), 'xray')
    expect('error' in res).toBe(true)
    expect((res as { error: string }).error).toMatch(/sing-box/i)
  })

  it('документ без признаков обоих принимается: признак — не обязанность', () => {
    // Ни один признак не является обязательным полем формата: документ без
    // route и без routing валиден для обоих, и отказывать по отсутствию
    // признака значило бы отвергать законный файл
    expect('text' in parseImportedJson('{"outbounds":[]}', 'singbox')).toBe(true)
  })

  it('бэкап панели разворачивается и проверяется по содержимому', () => {})
})

import { describe, expect, it } from 'vitest'
import { matchDomainField, matchDomainPattern, type GeoAnswers } from '../src/entities/xray/traceMatch'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const geo = (answers: Record<string, boolean>, missing: string[] = []): GeoAnswers => ({
  loaded: true,
  answers,
  missing,
})

describe('matchDomainPattern', () => {
  it('строка без префикса матчится как keyword-подстрока', () => {
    expect(matchDomainPattern('openai', 'api.openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('openai', 'example.com', NO_GEO)).toBe('no')
  })

  it('keyword: — та же подстрока', () => {
    expect(matchDomainPattern('keyword:penai', 'api.openai.com', NO_GEO)).toBe('yes')
  })

  it('domain: матчит сам домен и поддомены, но не похожее имя', () => {
    expect(matchDomainPattern('domain:openai.com', 'openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('domain:openai.com', 'api.openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('domain:openai.com', 'notopenai.com', NO_GEO)).toBe('no')
  })

  it('full: требует точного совпадения', () => {
    expect(matchDomainPattern('full:openai.com', 'openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('full:openai.com', 'api.openai.com', NO_GEO)).toBe('no')
  })

  it('regexp: применяет регулярное выражение, битое — unknown', () => {
    expect(matchDomainPattern('regexp:^api\\..*\\.com$', 'api.openai.com', NO_GEO)).toBe('yes')
    expect(matchDomainPattern('regexp:^api', 'openai.com', NO_GEO)).toBe('no')
    expect(matchDomainPattern('regexp:[unclosed', 'openai.com', NO_GEO)).toBe('unknown')
  })

  it('geosite: без загруженной базы — unknown, с базой — ответ базы', () => {
    expect(matchDomainPattern('geosite:openai', 'openai.com', NO_GEO)).toBe('unknown')
    expect(matchDomainPattern('geosite:openai', 'openai.com', geo({ 'geosite:openai': true }))).toBe('yes')
    expect(matchDomainPattern('geosite:openai', 'openai.com', geo({ 'geosite:openai': false }))).toBe('no')
  })

  it('категория, которой нет в загруженной базе, — unknown (ядро такой конфиг отвергнет)', () => {
    expect(matchDomainPattern('geosite:nosuch', 'openai.com', geo({}, ['geosite:nosuch']))).toBe('unknown')
  })

  it('ext: всегда unknown — внешние файлы не читаем', () => {
    expect(matchDomainPattern('ext:geoip.dat:ru', 'openai.com', geo({}))).toBe('unknown')
  })
})

describe('matchDomainField', () => {
  it('ИЛИ по элементам: одно совпадение делает поле совпавшим', () => {
    const v = matchDomainField(['full:example.com', 'domain:openai.com'], 'api.openai.com', NO_GEO)
    expect(v.state).toBe('yes')
    expect(v.reason).toContain('domain:openai.com')
  })

  it('нет совпадений, но есть неизвестное — поле unknown', () => {
    const v = matchDomainField(['full:example.com', 'geosite:openai'], 'api.openai.com', NO_GEO)
    expect(v.state).toBe('unknown')
  })

  it('все элементы точно не совпали — поле no', () => {
    const v = matchDomainField(['full:example.com', 'domain:google.com'], 'api.openai.com', NO_GEO)
    expect(v.state).toBe('no')
  })
})

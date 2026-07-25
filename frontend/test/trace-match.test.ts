import { describe, expect, it } from 'vitest'
import {
  ipInCidr,
  isIpAddress,
  matchDomainField,
  matchDomainPattern,
  matchIpField,
  type GeoAnswers,
} from '../src/entities/xray/traceMatch'

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

describe('isIpAddress', () => {
  it('различает IP и домен', () => {
    expect(isIpAddress('1.2.3.4')).toBe(true)
    expect(isIpAddress('2001:db8::1')).toBe(true)
    expect(isIpAddress('openai.com')).toBe(false)
    expect(isIpAddress('1.2.3.4.5')).toBe(false)
  })
})

describe('ipInCidr', () => {
  it('IPv4: попадание и промах', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.0/8')).toBe(true)
    expect(ipInCidr('11.0.0.5', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('10.0.0.5', '10.0.0.5')).toBe(true)
    expect(ipInCidr('10.0.0.6', '10.0.0.5')).toBe(false)
  })

  it('IPv4: граница префикса считается точно', () => {
    expect(ipInCidr('192.168.1.255', '192.168.1.0/24')).toBe(true)
    expect(ipInCidr('192.168.2.0', '192.168.1.0/24')).toBe(false)
  })

  it('IPv6: сокращённая запись и префикс', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true)
    expect(ipInCidr('2001:dba::1', '2001:db8::/32')).toBe(false)
    expect(ipInCidr('::1', '::1/128')).toBe(true)
  })

  it('версии не смешиваются, мусор даёт null', () => {
    expect(ipInCidr('1.2.3.4', '2001:db8::/32')).toBe(false)
    expect(ipInCidr('не-адрес', '10.0.0.0/8')).toBe(null)
    expect(ipInCidr('10.0.0.1', 'мусор/8')).toBe(null)
  })
})

describe('matchIpField', () => {
  it('IP известен: CIDR и geoip считаются', () => {
    expect(matchIpField('ip', ['10.0.0.0/8'], '10.1.2.3', 'known', NO_GEO).state).toBe('yes')
    expect(matchIpField('ip', ['geoip:ru'], '10.1.2.3', 'known', geo({ 'geoip:ru': true })).state).toBe('yes')
  })

  it('инверсия geoip:!cc переворачивает ответ базы', () => {
    expect(matchIpField('ip', ['geoip:!ru'], '1.2.3.4', 'known', geo({ 'geoip:ru': true })).state).toBe('no')
    expect(matchIpField('ip', ['geoip:!ru'], '1.2.3.4', 'known', geo({ 'geoip:ru': false })).state).toBe('yes')
  })

  it('IP не указан — unknown с просьбой указать адрес', () => {
    const v = matchIpField('ip', ['10.0.0.0/8'], undefined, 'unspecified', NO_GEO)
    expect(v.state).toBe('unknown')
    expect(v.reason).toContain('IP назначения')
  })

  it('стратегия AsIs — ip-правила по доменной цели не применяются вовсе', () => {
    const v = matchIpField('ip', ['10.0.0.0/8'], undefined, 'never', NO_GEO)
    expect(v.state).toBe('no')
    expect(v.reason).toContain('AsIs')
  })
})

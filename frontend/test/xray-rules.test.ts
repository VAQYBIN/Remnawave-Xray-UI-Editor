import { describe, expect, it } from 'vitest'
import { DOMAIN_PREFIXES, keywordEntries, portMatches, portSpecError } from '../src/entities/xray'

describe('entities/xray/rules — portSpecError', () => {
  it('валидные форматы — null', () => {
    expect(portSpecError(undefined)).toBeNull()
    expect(portSpecError(443)).toBeNull()
    expect(portSpecError('1000-2000')).toBeNull()
    expect(portSpecError('443,1000-2000,8443')).toBeNull()
  })

  it('битые форматы — русское сообщение', () => {
    expect(portSpecError('70000')).toMatch(/вне диапазона/)
    expect(portSpecError('2000-1000')).toMatch(/больше конца/)
    expect(portSpecError('abc')).toMatch(/Некорректный формат/)
    expect(portSpecError('443,,80')).toMatch(/Пустой элемент/)
  })
})

describe('entities/xray/rules — keywordEntries', () => {
  it('возвращает только записи без известных префиксов', () => {
    expect(keywordEntries(['geosite:openai', 'domain:a.com', 'example', 'full:b.com'])).toEqual(['example'])
    expect(keywordEntries(undefined)).toEqual([])
  })

  it('DOMAIN_PREFIXES содержит основные префиксы матчеров', () => {
    expect(DOMAIN_PREFIXES).toContain('geosite:')
    expect(DOMAIN_PREFIXES).toContain('regexp:')
  })
})

describe('entities/xray/rules — portMatches', () => {
  it('одиночный порт, диапазон и список', () => {
    expect(portMatches(443, 443)).toBe(true)
    expect(portMatches('443', 443)).toBe(true)
    expect(portMatches('1000-2000', 1500)).toBe(true)
    expect(portMatches('1000-2000', 2001)).toBe(false)
    expect(portMatches('80,443,8000-9000', 8080)).toBe(true)
    expect(portMatches('80,443', 8080)).toBe(false)
  })

  it('границы диапазона включаются', () => {
    expect(portMatches('1000-2000', 1000)).toBe(true)
    expect(portMatches('1000-2000', 2000)).toBe(true)
  })

  it('без спецификации порт не ограничен', () => {
    expect(portMatches(undefined, 443)).toBe(true)
  })
})

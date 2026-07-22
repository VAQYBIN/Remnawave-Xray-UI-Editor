import { describe, expect, it } from 'vitest'
import { DOMAIN_PREFIXES, keywordEntries, portSpecError } from '../src/entities/xray'

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

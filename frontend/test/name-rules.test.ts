import { describe, expect, it } from 'vitest'
import { NAME_RE } from '../src/shared/lib/nameRules'

describe('NAME_RE', () => {
  it('принимает латиницу, цифры, пробел, дефис и подчёркивание', () => {
    expect(NAME_RE.test('Germany 1')).toBe(true)
    expect(NAME_RE.test('my_template-2')).toBe(true)
  })

  it('отвергает кириллицу', () => {
    expect(NAME_RE.test('Германия')).toBe(false)
  })

  it('отвергает точку', () => {
    expect(NAME_RE.test('v1.2')).toBe(false)
  })

  it('отвергает слэш', () => {
    expect(NAME_RE.test('foo/bar')).toBe(false)
  })

  it('отвергает пустую строку', () => {
    expect(NAME_RE.test('')).toBe(false)
  })

  it('отвергает строку из одного символа', () => {
    expect(NAME_RE.test('a')).toBe(false)
  })

  // Верхняя граница 30 — та же, что в схеме бэкенда (.max(30)); без этой пары
  // подмена {2,30} на {2,} прошла бы незамеченной
  it('принимает ровно 30 символов', () => {
    expect(NAME_RE.test('a'.repeat(30))).toBe(true)
  })

  it('отвергает 31 символ', () => {
    expect(NAME_RE.test('a'.repeat(31))).toBe(false)
  })
})

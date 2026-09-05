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
})

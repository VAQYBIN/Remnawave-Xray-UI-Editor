import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { formatRule, parseRule, RULE_TYPES, rulesOf, splitTopLevel } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

describe('разбор строки правила', () => {
  it('простое правило', () => {
    expect(parseRule('DOMAIN-SUFFIX,google.com,PROXY')).toEqual({
      type: 'DOMAIN-SUFFIX',
      payload: 'google.com',
      target: 'PROXY',
      modifiers: [],
      raw: 'DOMAIN-SUFFIX,google.com,PROXY',
    })
  })

  it('модификатор no-resolve', () => {
    const rule = parseRule('IP-CIDR,17.0.0.0/8,DIRECT,no-resolve')
    expect(rule?.modifiers).toEqual(['no-resolve'])
    expect(rule?.target).toBe('DIRECT')
  })

  it('MATCH не имеет значения, только цель', () => {
    const rule = parseRule('MATCH,🌍 VPN')
    expect(rule?.type).toBe('MATCH')
    expect(rule?.payload).toBeUndefined()
    expect(rule?.target).toBe('🌍 VPN')
  })

  it('логическое правило сохраняет скобки целиком', () => {
    const rule = parseRule('AND,((DOMAIN,baidu.com),(NETWORK,UDP)),DIRECT')
    expect(rule?.type).toBe('AND')
    expect(rule?.payload).toBe('((DOMAIN,baidu.com),(NETWORK,UDP))')
    expect(rule?.target).toBe('DIRECT')
  })

  it('печать возвращает исходную строку', () => {
    for (const raw of [
      'DOMAIN,ad.com,REJECT',
      'IP-CIDR,17.0.0.0/8,DIRECT,no-resolve',
      'OR,((RULE-SET,a),(RULE-SET,b)),🌍 VPN',
      'MATCH,DIRECT',
    ]) {
      expect(formatRule(parseRule(raw)!)).toBe(raw)
    }
  })

  it('мусор не разбирается, но и не бросает', () => {
    expect(parseRule('DIRECT')).toBeNull()
    expect(parseRule('')).toBeNull()
  })

  it('незнакомый тип разбирается — он станет диагностикой, а не поломкой', () => {
    const rule = parseRule('SOMETHING-NEW,value,DIRECT')
    expect(rule?.type).toBe('SOMETHING-NEW')
    expect(RULE_TYPES).not.toContain('SOMETHING-NEW')
  })

  it('разрез по запятым верхнего уровня не лезет в скобки', () => {
    expect(splitTopLevel('AND,((A,b),(C,d)),X')).toEqual(['AND', '((A,b),(C,d))', 'X'])
  })
})

describe('правила документа', () => {
  it('читает все правила эталонного шаблона с диапазонами', () => {
    const md = parseMihomo(mihomoFixture('simple'))
    const rules = rulesOf(md)
    expect(rules.length).toBeGreaterThan(10)
    const last = rules[rules.length - 1]!
    expect(last.rule?.type).toBe('MATCH')
    expect(md.text.slice(last.range.from, last.range.to)).toBe(last.raw)
  })
})

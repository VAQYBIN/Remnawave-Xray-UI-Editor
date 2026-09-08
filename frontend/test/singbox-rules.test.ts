import { describe, expect, it } from 'vitest'
import {
  conditionKeysOf,
  isLogicalRule,
  ruleAction,
  ruleSetTagsOf,
  ruleTarget,
  rulesOf,
} from '../src/entities/singbox/rules'
import { parseSingbox } from '../src/entities/singbox/parse'

describe('правила маршрута', () => {
  it('правило без action считается маршрутным — так его трактует ядро', () => {
    expect(ruleAction({ domain: 'a.com', outbound: 'g' })).toBe('route')
    expect(ruleTarget({ domain: 'a.com', outbound: 'g' })).toBe('g')
  })

  it('action: route берёт цель из того же поля outbound', () => {
    expect(ruleAction({ action: 'route', outbound: 'g' })).toBe('route')
    expect(ruleTarget({ action: 'route', outbound: 'g' })).toBe('g')
  })

  it('у нетерминальных действий цели нет', () => {
    expect(ruleTarget({ action: 'sniff' })).toBeUndefined()
    // outbound здесь посторонний — у sniff это поле не значит «цель маршрута»,
    // и мутация без проверки action обязана вернуть его по ошибке
    expect(ruleTarget({ action: 'sniff', outbound: 'g' })).toBeUndefined()
    expect(ruleTarget({ action: 'resolve', server: 'dns-local' })).toBeUndefined()
  })

  it('служебные поля не считаются условиями', () => {
    const keys = conditionKeysOf({
      action: 'route',
      outbound: 'g',
      invert: true,
      domain_suffix: ['a.com'],
      port: 443,
    })
    expect(keys.sort()).toEqual(['domain_suffix', 'port'])
  })

  it('логическое правило опознаётся по type', () => {
    expect(isLogicalRule({ type: 'logical', mode: 'and', rules: [] })).toBe(true)
    expect(isLogicalRule({ domain: 'a.com' })).toBe(false)
  })

  it('незнакомое поле остаётся условием: молча пропустить его нельзя', () => {
    // Всё, что ниже такого правила, выполняется ровно при условии, что оно не
    // совпало, — а этого мы не знаем
    expect(conditionKeysOf({ brand_new_condition: 1, outbound: 'g' })).toEqual([
      'brand_new_condition',
    ])
  })

  it('теги наборов правил собираются из route.rule_set', () => {
    const doc = parseSingbox(
      '{"route":{"rule_set":[{"tag":"ru","type":"remote"},{"tag":"ads"}],"rules":[]}}',
    ).doc!
    expect(ruleSetTagsOf(doc)).toEqual(['ru', 'ads'])
    expect(rulesOf(doc)).toEqual([])
  })
})

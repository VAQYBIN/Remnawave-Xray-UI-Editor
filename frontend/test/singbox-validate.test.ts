import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { validateSingbox } from '../src/entities/singbox/validate'
import type { SingboxDoc } from '../src/entities/singbox/types'
import { singboxFixture } from './helpers'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

function fixtureDoc(name: 'default' | 'bundle' | 'legacy'): SingboxDoc {
  return parseSingbox(singboxFixture(name)).doc!
}

describe('диагностики sing-box', () => {
  it('настоящие шаблоны панели не дают ни одной ошибки', () => {
    for (const name of ['default', 'bundle'] as const) {
      const errors = validateSingbox(fixtureDoc(name)).filter((i) => i.level === 'error')
      expect(errors, `${name}: ${errors.map((e) => e.message).join('; ')}`).toEqual([])
    }
  })

  it('дублирующийся тег выхода — ошибка', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"direct","tag":"d"},{"type":"direct","tag":"d"}]}'),
    )
    expect(issues.some((i) => i.level === 'error' && /d/.test(i.message))).toBe(true)
  })

  it('кольцо ссылок между группами — ошибка', () => {
    const issues = validateSingbox(
      doc(`{"outbounds":[
        {"type":"selector","tag":"a","outbounds":["b"],"remnawave":{"includeProxies":false}},
        {"type":"selector","tag":"b","outbounds":["a"],"remnawave":{"includeProxies":false}}
      ]}`),
    )
    expect(issues.some((i) => i.level === 'error' && /кольц/i.test(i.message))).toBe(true)
  })

  it('пустая группа с includeProxies: false — ошибка: заполнить её некому', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"selector","tag":"g","outbounds":[],"remnawave":{"includeProxies":false}}]}'),
    )
    expect(issues.some((i) => i.level === 'error' && /g/.test(i.message))).toBe(true)
  })

  it('пустая группа БЕЗ этого ключа ошибкой не считается — её заполнит панель', () => {
    const issues = validateSingbox(doc('{"outbounds":[{"type":"selector","tag":"g","outbounds":null}]}'))
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('ссылка на несуществующий набор правил — ошибка', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"rule_set":["nope"],"outbound":"d"}],"rule_set":[{"tag":"ru"}]}}'),
    )
    expect(issues.some((i) => i.level === 'error' && /nope/.test(i.message))).toBe(true)
  })

  it('неизвестный тег — предупреждение, пока панель подставляет серверы', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"selector","tag":"g","outbounds":null}],"route":{"rules":[{"domain":"a.com","outbound":"кто-то"}]}}'),
    )
    const hit = issues.find((i) => /кто-то/.test(i.message))!
    expect(hit.level).toBe('warning')
  })

  it('тот же тег — ошибка, когда серверов от панели документ не получает', () => {
    const issues = validateSingbox(
      doc(`{"outbounds":[{"type":"selector","tag":"g","outbounds":["d"],"remnawave":{"includeProxies":false}},{"type":"direct","tag":"d"}],
            "route":{"rules":[{"domain":"a.com","outbound":"кто-то"}]}}`),
    )
    const hit = issues.find((i) => /кто-то/.test(i.message))!
    expect(hit.level).toBe('error')
  })

  it('выход, который панель в группы не положит, — предупреждение', () => {
    const issues = validateSingbox(
      doc('{"outbounds":[{"type":"vmess","tag":"old"},{"type":"selector","tag":"g","outbounds":null}]}'),
    )
    expect(issues.some((i) => i.level === 'warning' && /old/.test(i.message))).toBe(true)
  })

  it('устаревшие block и dns — предупреждение с названной причиной', () => {
    const issues = validateSingbox(fixtureDoc('legacy'))
    const legacy = issues.filter((i) => i.level === 'warning' && /1\.13|устарел/i.test(i.message))
    expect(legacy.length).toBeGreaterThan(0)
  })
})

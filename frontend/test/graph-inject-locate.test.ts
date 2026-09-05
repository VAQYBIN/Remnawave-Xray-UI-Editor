import { describe, expect, it } from 'vitest'
import { issueCountsByNode, nodeIdForPath } from '../src/entities/graph/locate'
import { searchNodes } from '../src/entities/graph/search'
import type { ValidationIssue, XrayConfig } from '../src/entities/xray'

const config = (): XrayConfig =>
  ({
    remnawave: {
      injectHosts: [
        { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' },
      ],
    },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [] },
  }) as unknown as XrayConfig

const issue = (parts: ValidationIssue['parts']): ValidationIssue =>
  ({ level: 'error', parts, path: '', message: 'тест' }) as ValidationIssue

describe('переход к группе подстановки', () => {
  it('путь диагностики ведёт к узлу группы', () => {
    expect(nodeIdForPath(['remnawave', 'injectHosts', 0], config())).toBe('inj:0')
    expect(nodeIdForPath(['remnawave', 'injectHosts', 0, 'selector'], config())).toBe('inj:0')
  })

  it('несуществующая группа не даёт узла', () => {
    expect(nodeIdForPath(['remnawave', 'injectHosts', 3], config())).toBeNull()
  })

  // Предупреждение «нет ни одной группы» садится на секцию: узла ещё нет
  it('путь без индекса узла не даёт', () => {
    expect(nodeIdForPath(['remnawave', 'injectHosts'], config())).toBeNull()
  })

  it('счётчик проблем садится на узел группы', () => {
    const counts = issueCountsByNode([issue(['remnawave', 'injectHosts', 0, 'selector'])], config())
    expect(counts['inj:0']).toEqual({ errors: 1, warnings: 0 })
  })
})

describe('поиск по группам подстановки', () => {
  it('находит по предсказанному тегу', () => {
    const hits = searchNodes(config(), {}, 'proxy-2')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ nodeId: 'inj:0', kind: 'inject' })
  })

  it('находит по подписи селектора', () => {
    expect(searchNodes(config(), {}, '^RU-')[0]?.nodeId).toBe('inj:0')
  })

  it('чужая строка не находит ничего', () => {
    expect(searchNodes(config(), {}, 'zzz')).toEqual([])
  })
})

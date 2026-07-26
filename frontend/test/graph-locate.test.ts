import { describe, expect, it } from 'vitest'
import { issueCountsByNode, nodeIdForPath } from '../src/entities/graph/locate'
import type { ValidationIssue, XrayConfig } from '../src/entities/xray'

const CONFIG = {
  inbounds: [
    { tag: 'vless-in', protocol: 'vless' },
    { tag: 'trojan-in', protocol: 'trojan' },
  ],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{ type: 'field', outboundTag: 'direct' }] },
  dns: { servers: ['1.1.1.1'] },
} as unknown as XrayConfig

function issue(parts: (string | number)[], level: 'error' | 'warning' = 'error'): ValidationIssue {
  return { parts, path: parts.join('.'), message: 'x', level }
}

describe('nodeIdForPath', () => {
  it('inbound по индексу — узел по тегу', () => {
    expect(nodeIdForPath(['inbounds', 1, 'port'], CONFIG)).toBe('in:trojan-in')
  })

  it('outbound по индексу', () => {
    expect(nodeIdForPath(['outbounds', 0, 'streamSettings'], CONFIG)).toBe('out:direct')
  })

  it('правило адресуется позиционно', () => {
    expect(nodeIdForPath(['routing', 'rules', 0, 'domain'], CONFIG)).toBe('rule:0')
  })

  it('dns — единственный узел', () => {
    expect(nodeIdForPath(['dns', 'servers'], CONFIG)).toBe('dns')
  })

  it('log узла не имеет', () => {
    expect(nodeIdForPath(['log', 'loglevel'], CONFIG)).toBeNull()
  })

  it('несуществующий индекс — null, а не битый id', () => {
    expect(nodeIdForPath(['inbounds', 9, 'tag'], CONFIG)).toBeNull()
  })

  it('routing без rules — null', () => {
    expect(nodeIdForPath(['routing', 'domainStrategy'], CONFIG)).toBeNull()
  })

  it('пустой путь — null', () => {
    expect(nodeIdForPath([], CONFIG)).toBeNull()
  })
})

describe('issueCountsByNode', () => {
  it('считает ошибки и предупреждения раздельно', () => {
    const counts = issueCountsByNode(
      [
        issue(['inbounds', 0, 'streamSettings']),
        issue(['inbounds', 0, 'tag'], 'warning'),
        issue(['routing', 'rules', 0, 'domain'], 'warning'),
        issue(['log', 'loglevel']),
      ],
      CONFIG,
    )
    expect(counts['in:vless-in']).toEqual({ errors: 1, warnings: 1 })
    expect(counts['rule:0']).toEqual({ errors: 0, warnings: 1 })
    expect(Object.keys(counts)).toHaveLength(2)
  })

  it('дубликат тега попадает в тот же узел — граф рисует его один раз', () => {
    const dup = {
      inbounds: [
        { tag: 'a', protocol: 'vless' },
        { tag: 'a', protocol: 'trojan' },
      ],
    } as unknown as XrayConfig
    const counts = issueCountsByNode(
      [issue(['inbounds', 0, 'tag']), issue(['inbounds', 1, 'tag'])],
      dup,
    )
    expect(counts['in:a']).toEqual({ errors: 2, warnings: 0 })
  })

  it('пустой список — пустой объект', () => {
    expect(issueCountsByNode([], CONFIG)).toEqual({})
  })
})

describe('пути балансеров и обсерватории', () => {
  const CFG = {
    outbounds: [{ tag: 'proxy-de', protocol: 'vless' }],
    routing: { rules: [], balancers: [{ tag: 'bal-eu', selector: ['proxy-'] }] },
    observatory: { subjectSelector: ['proxy-'] },
  } as XrayConfig

  it('путь балансера и обсерватории ведёт к своим узлам', () => {
    expect(nodeIdForPath(['routing', 'balancers', 0, 'selector'], CFG)).toBe('bal:bal-eu')
    expect(nodeIdForPath(['observatory', 'subjectSelector'], CFG)).toBe('obs')
    expect(nodeIdForPath(['burstObservatory', 'subjectSelector'], CFG)).toBe('obs')
    expect(nodeIdForPath(['routing', 'balancers', 5, 'selector'], CFG)).toBeNull()
  })
})

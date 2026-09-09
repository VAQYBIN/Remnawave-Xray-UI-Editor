import { describe, expect, it } from 'vitest'
import { applyMihomoOps, LOCK_ALIAS, LOCK_MERGED, materializeAt, mihomoLockAt, renameKeyAt } from '../src/entities/mihomo/write'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { groupsOf, ruleProvidersOf } from '../src/entities/mihomo/groups'
import { rulesOf } from '../src/entities/mihomo/rules'
import { mihomoFixture } from './helpers'

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
const lf = (name: Parameters<typeof mihomoFixture>[0]) => mihomoFixture(name).replace(/\r\n/g, '\n')

describe('applyMihomoOps: режим сплайса', () => {
  it('правка существующего скаляра меняет только его байты', () => {
    const md = parseMihomo(lf('simple'))
    const { md: next, refused } = applyMihomoOps(md, [{ op: 'set', path: ['mode'], value: 'global' }])
    expect(refused).toEqual([])
    const before = md.text.split('\n')
    const after = next.text.split('\n')
    expect(after.length).toBe(before.length)
    const changed = after.filter((line, i) => line !== before[i])
    expect(changed).toEqual(['mode: global'])
  })

  it('удаление существующего скаляра забирает только его строку', () => {
    const md = parseMihomo('mode: rule\nlog-level: info # note\nipv6: false\n')
    const { md: next } = applyMihomoOps(md, [{ op: 'remove', path: ['log-level'] }])
    expect(next.text).toBe('mode: rule\nipv6: false\n')
  })
})

describe('applyMihomoOps: режим модели', () => {
  it('новый ключ, новая секция, вставка и перестановка — якоря, алиасы, слияния и комментарии целы', () => {
    const src = lf('bundle')
    const md = parseMihomo(src)
    const { md: next, refused } = applyMihomoOps(md, [
      { op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true },
      { op: 'set', path: ['sniffer', 'sniff', 'QUIC', 'ports'], value: [443] },
      { op: 'insert', path: ['rules'], index: 0, value: 'DOMAIN,a.com,DIRECT' },
      { op: 'move', path: ['proxy-groups'], from: 0, to: 1 },
    ])
    expect(refused).toEqual([])
    expect(next.issues).toEqual([])
    for (const re of [/&\w/g, /\*\w/g, /<<:/g, /#/g]) expect(count(next.text, re)).toBe(count(src, re))
    expect(groupsOf(next)[1]!.hidden).toBe(true)
    expect(rulesOf(next)[0]!.raw).toBe('DOMAIN,a.com,DIRECT')
    expect((next.json as { sniffer: { sniff: { QUIC: { ports: number[] } } } }).sniffer.sniff.QUIC.ports).toEqual([443])
  })

  it('пачка операций считает индексы по уже изменённому документу', () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\n')
    const { md: next } = applyMihomoOps(md, [
      { op: 'insert', path: ['rules'], index: 0, value: 'DOMAIN,a.com,DIRECT' },
      { op: 'insert', path: ['rules'], index: 1, value: 'DOMAIN,b.com,DIRECT' },
      { op: 'remove', path: ['rules', 0] },
    ])
    expect(rulesOf(next).map((r) => r.raw)).toEqual(['DOMAIN,b.com,DIRECT', 'MATCH,DIRECT'])
  })

  it('пустой документ: set заводит корень и промежуточные отображения', () => {
    const { md } = applyMihomoOps(parseMihomo(''), [{ op: 'set', path: ['dns', 'enable'], value: true }])
    expect(md.text).toBe('dns:\n  enable: true\n')
  })

  it('flow-коллекция больше не запирает: вставка в `proxies: []` печатается', () => {
    const md = parseMihomo('proxy-groups:\n  - name: G\n    type: select\n    proxies: []\n')
    const { md: next, refused } = applyMihomoOps(md, [{ op: 'insert', path: ['proxy-groups', 0, 'proxies'], index: 0, value: 'DIRECT' }])
    expect(refused).toEqual([])
    expect(groupsOf(next)[0]!.proxies).toEqual(['DIRECT'])
  })

  it('CRLF-документ остаётся CRLF после перепечатки', () => {
    const md = parseMihomo(mihomoFixture('default').replace(/\r?\n/g, '\r\n'))
    const { md: next } = applyMihomoOps(md, [{ op: 'set', path: ['profile', 'store-selected'], value: true }])
    expect(next.text).not.toMatch(/(^|[^\r])\n/)
  })
})

describe('замки и отказ', () => {
  const DOC = [
    'x:', '  base: &base', '    interval: 300', '  ips: &ips', '    - 10.0.0.0/8',
    'proxy-groups:', '  - name: A', '    type: select', '    <<: *base', 'tun:', '  route-exclude-address: *ips', '',
  ].join('\n')

  it('lockAt: merged у ключа через <<, alias у значения-ссылки и на пути через неё', () => {
    const md = parseMihomo(DOC)
    expect(mihomoLockAt(md, ['proxy-groups', 0, 'interval'])).toEqual({ kind: 'merged', reason: LOCK_MERGED })
    expect(mihomoLockAt(md, ['tun', 'route-exclude-address'])).toEqual({ kind: 'alias', reason: LOCK_ALIAS })
    expect(mihomoLockAt(md, ['tun', 'route-exclude-address', 0])).toEqual({ kind: 'alias', reason: LOCK_ALIAS })
    expect(mihomoLockAt(md, ['proxy-groups', 0, 'name'])).toBeNull()
    expect(mihomoLockAt(md, ['proxy-groups', 0, 'hidden'])).toBeNull()
  })

  it('операция через замок не применяется и названа в refused; остальные применяются', () => {
    const md = parseMihomo(DOC)
    const { md: next, refused } = applyMihomoOps(md, [
      { op: 'set', path: ['proxy-groups', 0, 'interval'], value: 60 },
      { op: 'insert', path: ['tun', 'route-exclude-address'], index: 0, value: '192.168.0.0/16' },
      { op: 'set', path: ['proxy-groups', 0, 'hidden'], value: true },
    ])
    expect(refused.map((r) => r.reason)).toEqual([LOCK_MERGED, LOCK_ALIAS])
    expect(next.text).toContain('interval: 300')
    expect(groupsOf(next)[0]!.hidden).toBe(true)
  })

  it('материализация: merged становится собственным ключом, alias — копией значения; якорь у объявления цел', () => {
    const md = parseMihomo(DOC)
    const a = materializeAt(md, ['proxy-groups', 0, 'interval'])
    expect(mihomoLockAt(a, ['proxy-groups', 0, 'interval'])).toBeNull()
    expect(a.text).toContain('&base')
    const b = materializeAt(a, ['tun', 'route-exclude-address'])
    expect(mihomoLockAt(b, ['tun', 'route-exclude-address'])).toBeNull()
    expect(b.text).toContain('&ips')
    expect((b.json as { tun: { 'route-exclude-address': string[] } }).tun['route-exclude-address']).toEqual(['10.0.0.0/8'])
    const { refused } = applyMihomoOps(b, [{ op: 'set', path: ['proxy-groups', 0, 'interval'], value: 60 }])
    expect(refused).toEqual([])
  })
})

describe('renameKeyAt', () => {
  it('переименовывает ключ отображения на месте, не меняя порядок записей', () => {
    const md = parseMihomo('rule-providers:\n  a: {type: http, url: u}\n  b: {type: file, path: p}\n')
    const next = renameKeyAt(md, ['rule-providers'], 'a', 'ads')
    expect(ruleProvidersOf(next).map((r) => r.name)).toEqual(['ads', 'b'])
  })
})

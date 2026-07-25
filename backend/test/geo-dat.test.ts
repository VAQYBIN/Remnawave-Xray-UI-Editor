import { describe, expect, it } from 'vitest'
import {
  encodeGeoIpList,
  encodeGeoSiteList,
  indexEntries,
  parseCidrs,
  parseDomains,
} from '../src/geo/dat.js'

describe('geosite .dat', () => {
  const buf = encodeGeoSiteList([
    {
      code: 'GOOGLE',
      domains: [
        { type: 2, value: 'google.com', attributes: [] },
        { type: 3, value: 'ads.google.com', attributes: ['ads'] },
        { type: 0, value: 'gstatic', attributes: [] },
        { type: 1, value: '^api\\..*\\.google$', attributes: [] },
      ],
    },
    { code: 'OPENAI', domains: [{ type: 2, value: 'openai.com', attributes: [] }] },
  ])

  it('индексирует записи по коду категории', () => {
    const index = indexEntries(buf)
    expect([...index.keys()].sort()).toEqual(['GOOGLE', 'OPENAI'])
  })

  it('разбирает домены с типами и атрибутами', () => {
    const index = indexEntries(buf)
    const domains = parseDomains(index.get('GOOGLE')!)
    expect(domains).toHaveLength(4)
    expect(domains[0]).toEqual({ type: 2, value: 'google.com', attributes: [] })
    expect(domains[1]).toEqual({ type: 3, value: 'ads.google.com', attributes: ['ads'] })
    expect(domains[2]!.type).toBe(0)
    expect(domains[3]!.value).toBe('^api\\..*\\.google$')
  })

  it('разбор второй категории не зависит от первой', () => {
    const index = indexEntries(buf)
    expect(parseDomains(index.get('OPENAI')!)).toEqual([
      { type: 2, value: 'openai.com', attributes: [] },
    ])
  })

  it('пустой буфер даёт пустой индекс', () => {
    expect(indexEntries(new Uint8Array()).size).toBe(0)
  })

  it('длинные значения (varint > 127 байт) читаются целиком', () => {
    const long = 'a'.repeat(500)
    const index = indexEntries(
      encodeGeoSiteList([{ code: 'LONG', domains: [{ type: 2, value: long, attributes: [] }] }]),
    )
    expect(parseDomains(index.get('LONG')!)[0]!.value).toBe(long)
  })
})

describe('geoip .dat', () => {
  it('разбирает CIDR и reverse_match', () => {
    const buf = encodeGeoIpList([
      {
        code: 'RU',
        cidrs: [
          { ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 },
          {
            ip: new Uint8Array([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            prefix: 32,
          },
        ],
      },
      { code: 'CN', cidrs: [{ ip: new Uint8Array([1, 2, 3, 4]), prefix: 32 }], reverseMatch: true },
    ])
    const index = indexEntries(buf)
    const ru = parseCidrs(index.get('RU')!)
    expect(ru.reverseMatch).toBe(false)
    expect(ru.cidrs).toHaveLength(2)
    expect([...ru.cidrs[0]!.ip]).toEqual([10, 0, 0, 0])
    expect(ru.cidrs[0]!.prefix).toBe(8)
    expect(ru.cidrs[1]!.ip).toHaveLength(16)
    expect(parseCidrs(index.get('CN')!).reverseMatch).toBe(true)
  })

  it('prefix 0 не теряется (proto3 опускает нулевые поля)', () => {
    const buf = encodeGeoIpList([
      { code: 'ANY', cidrs: [{ ip: new Uint8Array([0, 0, 0, 0]), prefix: 0 }] },
    ])
    const parsed = parseCidrs(indexEntries(buf).get('ANY')!)
    expect(parsed.cidrs[0]!.prefix).toBe(0)
  })
})

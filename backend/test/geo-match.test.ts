import { describe, expect, it } from 'vitest'
import { bytesToIp, domainMatches, formatCidr, ipMatches, ipToBytes, parseKey } from '../src/geo/match.js'
import type { GeoDomain } from '../src/geo/dat.js'

describe('parseKey', () => {
  it('код категории приводится к верхнему регистру — в файле он такой', () => {
    expect(parseKey('geosite:google')).toEqual({
      kind: 'geosite',
      code: 'GOOGLE',
      attribute: undefined,
      negated: false,
    })
  })

  it('атрибут отделяется первым @ и идёт в нижнем регистре', () => {
    expect(parseKey('geosite:Google@Ads')).toEqual({
      kind: 'geosite',
      code: 'GOOGLE',
      attribute: 'ads',
      negated: false,
    })
  })

  it('geoip с негацией, в том числе многократной', () => {
    expect(parseKey('geoip:!ru')).toEqual({
      kind: 'geoip',
      code: 'RU',
      attribute: undefined,
      negated: true,
    })
    expect(parseKey('geoip:!!ru')?.negated).toBe(false)
  })

  it('неизвестный префикс — null', () => {
    expect(parseKey('ext:file.dat:ru')).toBeNull()
    expect(parseKey('domain:google.com')).toBeNull()
  })
})

describe('domainMatches', () => {
  const domains: GeoDomain[] = [
    { type: 2, value: 'google.com', attributes: [] },
    { type: 3, value: 'exact.example', attributes: [] },
    { type: 0, value: 'gstatic', attributes: [] },
    { type: 1, value: '^api\\d+\\.test$', attributes: [] },
    { type: 2, value: 'ads.example', attributes: ['ads'] },
  ]

  it('тип Domain матчит сам домен и поддомены', () => {
    expect(domainMatches(domains, 'google.com')).toBe(true)
    expect(domainMatches(domains, 'www.google.com')).toBe(true)
    expect(domainMatches(domains, 'notgoogle.com')).toBe(false)
  })

  it('тип Full — только точное совпадение', () => {
    expect(domainMatches(domains, 'exact.example')).toBe(true)
    expect(domainMatches(domains, 'sub.exact.example')).toBe(false)
  })

  it('тип Substr — подстрока', () => {
    expect(domainMatches(domains, 'ssl.gstatic.com')).toBe(true)
  })

  it('тип Regex — регулярное выражение', () => {
    expect(domainMatches(domains, 'api42.test')).toBe(true)
    expect(domainMatches(domains, 'apix.test')).toBe(false)
  })

  it('атрибут сужает выборку до доменов с этим ключом', () => {
    expect(domainMatches(domains, 'ads.example', 'ads')).toBe(true)
    expect(domainMatches(domains, 'google.com', 'ads')).toBe(false)
  })

  it('битый regexp в базе не роняет матчинг', () => {
    expect(domainMatches([{ type: 1, value: '[bad', attributes: [] }], 'anything')).toBe(false)
  })
})

describe('ipToBytes', () => {
  it('IPv4 и IPv6', () => {
    expect([...ipToBytes('10.0.0.1')!]).toEqual([10, 0, 0, 1])
    expect(ipToBytes('2001:db8::1')).toHaveLength(16)
    expect(ipToBytes('не-адрес')).toBeNull()
  })
})

describe('ipMatches', () => {
  it('IPv4 по маске', () => {
    const cidrs = [{ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 }]
    expect(ipMatches(cidrs, '10.1.2.3')).toBe(true)
    expect(ipMatches(cidrs, '11.1.2.3')).toBe(false)
  })

  it('граница префикса, не кратного восьми', () => {
    const cidrs = [{ ip: new Uint8Array([192, 168, 0, 0]), prefix: 20 }]
    expect(ipMatches(cidrs, '192.168.15.255')).toBe(true)
    expect(ipMatches(cidrs, '192.168.16.0')).toBe(false)
  })

  it('версии не смешиваются', () => {
    const v6 = [{ ip: new Uint8Array(16).fill(0), prefix: 0 }]
    expect(ipMatches(v6, '10.0.0.1')).toBe(false)
  })

  it('prefix 0 матчит всё в своей версии', () => {
    const all = [{ ip: new Uint8Array([0, 0, 0, 0]), prefix: 0 }]
    expect(ipMatches(all, '8.8.8.8')).toBe(true)
  })

  it('мусорный адрес не матчится', () => {
    expect(ipMatches([{ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 }], 'nope')).toBe(false)
  })
})

describe('bytesToIp и formatCidr', () => {
  it('IPv4 печатается точками', () => {
    expect(bytesToIp(new Uint8Array([1, 2, 3, 4]))).toBe('1.2.3.4')
    expect(formatCidr({ ip: new Uint8Array([10, 0, 0, 0]), prefix: 8 })).toBe('10.0.0.0/8')
  })

  it('IPv6 сжимает самую длинную серию нулей', () => {
    const loopback = new Uint8Array(16)
    loopback[15] = 1
    expect(bytesToIp(loopback)).toBe('::1')

    const cf = new Uint8Array([0x26, 0x06, 0x47, 0, 1, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(bytesToIp(cf)).toBe('2606:4700:110::1')

    expect(bytesToIp(new Uint8Array(16))).toBe('::')
  })

  it('одиночный ноль не сжимается — это не короче', () => {
    const addr = new Uint8Array([0x20, 1, 0x0d, 0xb8, 0, 0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5])
    expect(bytesToIp(addr)).toBe('2001:db8:0:1:2:3:4:5')
  })

  it('непонятная длина даёт пустую строку, а не мусор', () => {
    expect(bytesToIp(new Uint8Array([1, 2, 3]))).toBe('')
  })
})

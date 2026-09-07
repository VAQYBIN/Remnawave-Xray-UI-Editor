import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { hasIp, readIpCidrSet } from '../src/ruleset/ipcidrSet.js'
import { RuleSetError } from '../src/ruleset/errors.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const set = readIpCidrSet(parseMrs(readFileSync(join(DIR, 'geoip-private.mrs')), 1 << 20).body)

describe('набор подсетей из настоящего .mrs', () => {
  it('ловит приватные диапазоны IPv4', () => {
    expect(hasIp(set, '10.0.0.1')).toBe(true)
    expect(hasIp(set, '192.168.1.1')).toBe(true)
    expect(hasIp(set, '172.16.0.1')).toBe(true)
    expect(hasIp(set, '127.0.0.1')).toBe(true)
    expect(hasIp(set, '100.64.0.1')).toBe(true) // CGNAT
  })

  it('не ловит публичные', () => {
    expect(hasIp(set, '8.8.8.8')).toBe(false)
    expect(hasIp(set, '1.1.1.1')).toBe(false)
    expect(hasIp(set, '93.184.216.34')).toBe(false)
  })

  it('края диапазона входят в него', () => {
    expect(hasIp(set, '172.16.0.0')).toBe(true)
    expect(hasIp(set, '172.31.255.255')).toBe(true)
    expect(hasIp(set, '172.15.255.255')).toBe(false)
    expect(hasIp(set, '172.32.0.0')).toBe(false)
  })

  it('IPv6 ищется в своём семействе, а не по сырым байтам', () => {
    // Массив отсортирован как netip.Addr: сначала все IPv4, потом IPv6, и
    // «::1» лежит ПОСЛЕ «::ffff:224.0.0.0». Поиск по сырым 16 байтам сломался бы
    expect(hasIp(set, '::1')).toBe(true)
    expect(hasIp(set, 'fc00::1')).toBe(true)
    expect(hasIp(set, 'fe80::1')).toBe(true)
    expect(hasIp(set, '2606:4700:4700::1111')).toBe(false)
  })

  it('неразбираемый адрес — не совпадение, а не исключение', () => {
    expect(hasIp(set, 'не адрес')).toBe(false)
    expect(hasIp(set, '')).toBe(false)
  })

  it('чужая версия тела — отказ', () => {
    const body = Buffer.alloc(40)
    body[0] = 2
    expect(() => readIpCidrSet(body)).toThrow(RuleSetError)
  })

  it('число диапазонов больше файла — отказ', () => {
    const body = Buffer.alloc(20)
    body[0] = 1
    body.writeBigInt64BE(9999n, 1)
    expect(() => readIpCidrSet(body)).toThrow(RuleSetError)
  })
})

describe('оборванная загрузка не сходит за исправный набор подсетей', () => {
  const body = () => parseMrs(readFileSync(join(DIR, 'geoip-private.mrs')), 1 << 20).body

  it('лишние байты в хвосте — отказ', () => {
    const withTail = Buffer.concat([body(), Buffer.from([0])])
    expect(() => readIpCidrSet(withTail)).toThrow(RuleSetError)
  })

  it('усечённое тело — отказ', () => {
    expect(() => readIpCidrSet(body().subarray(0, body().length - 1))).toThrow(RuleSetError)
  })
})

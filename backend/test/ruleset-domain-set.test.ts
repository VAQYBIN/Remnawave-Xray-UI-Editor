import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { hasDomain, readDomainSet } from '../src/ruleset/domainSet.js'
import { RuleSetError } from '../src/ruleset/errors.js'
import { buildDomainSet } from './domainSetBuilder.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const MAX = 32 * 1024 * 1024
const load = (name: string) => readDomainSet(parseMrs(readFileSync(join(DIR, name)), MAX).body)

describe('набор доменов из настоящего .mrs', () => {
  const faceit = load('faceit.mrs')

  it('находит сам домен', () => {
    expect(hasDomain(faceit, 'faceit.com')).toBe(true)
    expect(hasDomain(faceit, 'faceit-cdn.net')).toBe(true)
  })

  it('находит поддомены — работает подстановка «+.»', () => {
    expect(hasDomain(faceit, 'www.faceit.com')).toBe(true)
    expect(hasDomain(faceit, 'a.b.faceit.com')).toBe(true)
    expect(hasDomain(faceit, 'cdn.faceit-cdn.net')).toBe(true)
  })

  it('регистр не важен', () => {
    expect(hasDomain(faceit, 'FACEIT.COM')).toBe(true)
    expect(hasDomain(faceit, 'WWW.Faceit.Com')).toBe(true)
  })

  it('граница метки соблюдается', () => {
    // Самая дорогая ошибка декодера: суффиксное сравнение вместо метки
    expect(hasDomain(faceit, 'notfaceit.com')).toBe(false)
    expect(hasDomain(faceit, 'myfaceit.com')).toBe(false)
  })

  it('домен в середине чужого имени не совпадает', () => {
    expect(hasDomain(faceit, 'faceit.com.evil.com')).toBe(false)
  })

  it('обрубки и пустая строка не совпадают', () => {
    expect(hasDomain(faceit, 'com')).toBe(false)
    expect(hasDomain(faceit, '.faceit.com')).toBe(false)
    expect(hasDomain(faceit, '')).toBe(false)
  })

  it('второй настоящий набор читается так же', () => {
    const eft = load('eft.mrs')
    expect(hasDomain(eft, 'escapefromtarkov.com')).toBe(true)
    expect(hasDomain(eft, 'launcher.escapefromtarkov.com')).toBe(true)
    expect(hasDomain(eft, 'tarkov.com')).toBe(true)
    expect(hasDomain(eft, 'faceit.com')).toBe(false)
  })

  it('третий настоящий набор: поддомен третьего уровня', () => {
    const ads = load('twitch-ads.mrs')
    expect(hasDomain(ads, 'gql.twitch.tv')).toBe(true)
    expect(hasDomain(ads, 'x.gql.twitch.tv')).toBe(true)
    expect(hasDomain(ads, 'twitch.tv')).toBe(false)
  })
})

describe('подстановки, которых нет в фикстурах', () => {
  it('«*» заменяет ровно одну метку', () => {
    const ds = buildDomainSet(['*.example.com'])
    expect(hasDomain(ds, 'a.example.com')).toBe(true)
    expect(hasDomain(ds, 'b.example.com')).toBe(true)
    // Две метки «*» не покрывает — этим он и отличается от «+»
    expect(hasDomain(ds, 'a.b.example.com')).toBe(false)
    expect(hasDomain(ds, 'example.com')).toBe(false)
  })

  it('«+» покрывает и сам домен, и любую глубину', () => {
    const ds = buildDomainSet(['+.example.com'])
    expect(hasDomain(ds, 'a.b.c.example.com')).toBe(true)
  })

  it('«*» в середине', () => {
    const ds = buildDomainSet(['a.*.example.com'])
    expect(hasDomain(ds, 'a.x.example.com')).toBe(true)
    expect(hasDomain(ds, 'a.example.com')).toBe(false)
    expect(hasDomain(ds, 'b.x.example.com')).toBe(false)
  })

  it('точный домен рядом с подстановкой не теряется', () => {
    const ds = buildDomainSet(['exact.com', '*.example.com'])
    expect(hasDomain(ds, 'exact.com')).toBe(true)
    expect(hasDomain(ds, 'a.example.com')).toBe(true)
    expect(hasDomain(ds, 'other.org')).toBe(false)
  })
})

describe('испорченный набор доменов', () => {
  it('чужая версия тела — отказ', () => {
    const body = Buffer.alloc(40)
    body[0] = 2
    expect(() => readDomainSet(body)).toThrow(RuleSetError)
  })

  it('длина массива за границей файла — отказ, а не чтение мусора', () => {
    const body = Buffer.alloc(20)
    body[0] = 1
    body.writeBigInt64BE(1_000_000n, 1)
    expect(() => readDomainSet(body)).toThrow(RuleSetError)
  })
})

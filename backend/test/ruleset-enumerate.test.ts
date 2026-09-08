import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { readDomainSet } from '../src/ruleset/domainSet.js'
import { readIpCidrSet, type IpCidrSet } from '../src/ruleset/ipcidrSet.js'
import { cidrsOf, domainKeys } from '../src/ruleset/enumerate.js'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'ruleset')
const PLAIN_LIMIT = 32 * 1024 * 1024

function body(name: string) {
  return parseMrs(readFileSync(join(FIXTURES, `${name}.mrs`)), PLAIN_LIMIT)
}

/** Пара «начало+конец» в том виде, в каком её пишет ядро: два раза по 16 байт */
function pair(startV4: number[], endV4: number[]): Uint8Array {
  const out = new Uint8Array(32)
  out.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 0)
  out.set(startV4, 12)
  out.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 16)
  out.set(endV4, 28)
  return out
}

describe('перечисление бора доменов', () => {
  it('faceit отдаёт ровно те четыре ключа, что выписаны в README фикстур', () => {
    const file = body('faceit')
    expect([...domainKeys(readDomainSet(file.body))]).toEqual([
      'faceit.com',
      '+.faceit.com',
      'faceit-cdn.net',
      '+.faceit-cdn.net',
    ])
    // Число ключей и count из заголовка — РАЗНЫЕ числа, и это не ошибка:
    // на каждый домен ядро кладёт и его самого, и форму «+.»
    expect(file.count).toBe(2)
  })

  it('eft и twitch-ads дают столько ключей, сколько выписано в README', () => {
    expect([...domainKeys(readDomainSet(body('eft').body))]).toHaveLength(8)
    const twitch = [...domainKeys(readDomainSet(body('twitch-ads').body))]
    expect(twitch).toHaveLength(10)
    expect(twitch).toContain('gql.twitch.tv')
    expect(twitch).toContain('+.static-cdn.jtvnw.net')
  })

  it('ключи отдаются развёрнутыми: в боре они лежат наоборот', () => {
    // Без разворота вышло бы «moc.ticaf» — тест ловит ровно эту ошибку
    expect([...domainKeys(readDomainSet(body('faceit').body))][0]).toBe('faceit.com')
  })
})

describe('обратное превращение диапазонов в CIDR', () => {
  it('geoip private распадается на семнадцать подсетей', () => {
    const cidrs = [...cidrsOf(readIpCidrSet(body('geoip-private').body))]
    expect(cidrs).toEqual([
      '10.0.0.0/8',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.0.2.0/24',
      '192.88.99.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '198.51.100.0/24',
      '203.0.113.0/24',
      '224.0.0.0/3',
      '::1/128',
      'fc00::/7',
      'fe80::/10',
      'ff00::/8',
    ])
  })

  it('диапазон, не ложащийся в одну подсеть, распадается на несколько', () => {
    // 10.0.0.1—10.0.0.4 не выражается одним CIDR: ровно тот случай, ради
    // которого нужен цикл, а не «взять префикс по длине диапазона»
    const set: IpCidrSet = { v4: [pair([10, 0, 0, 1], [10, 0, 0, 4])], v6: [] }
    expect([...cidrsOf(set)]).toEqual(['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/32'])
  })

  it('у IPv6 своя разрядность: префикс считается от 128, а не от 32', () => {
    // Начало нулевое — это ветка «младшего единичного бита нет», и она обязана
    // взять разрядность СЕМЕЙСТВА. Диапазон намеренно ограничен «::ffff»:
    // на «::/0» перепутанная разрядность не дала бы неверный ответ, она
    // подвесила бы обход — красное, но нечитаемое
    const range = new Uint8Array(32)
    range.fill(0xff, 30)
    expect([...cidrsOf({ v4: [], v6: [range] })]).toEqual(['::/112'])
  })

  it('диапазон во весь адресный простор даёт нулевой префикс', () => {
    // Ветка «начало равно нулю»: у нуля младшего единичного бита нет, и наивный
    // подсчёт нулевых разрядов зациклился бы
    const set: IpCidrSet = { v4: [pair([0, 0, 0, 0], [255, 255, 255, 255])], v6: [] }
    expect([...cidrsOf(set)]).toEqual(['0.0.0.0/0'])
  })
})

// Набор подсетей из `.mrs` с `behavior: ipcidr`. Формат —
// `component/cidr/ipcidr_set_bin.go`: версия, число диапазонов, затем пары
// адресов по 16 байт (начало и конец включительно).
import { ipToBytes } from '../geo/match.js'
import { RuleSetError } from './errors.js'

/** Префикс IPv4-mapped адреса: ядро пишет каждый адрес через As16() */
const V4_MAPPED_PREFIX = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])

export interface IpCidrSet {
  /**
   * Диапазоны, разложенные по семействам. В файле они отсортированы как
   * `netip.Addr`, где ЛЮБОЙ IPv4 меньше любого IPv6, — а не по сырым 16
   * байтам: «::1» лежит после «::ffff:224.0.0.0». Общий двоичный поиск по
   * такому массиву вернул бы неверный ответ, поэтому семейства разделены, и
   * каждое отсортировано внутри себя.
   */
  v4: Uint8Array[]
  v6: Uint8Array[]
}

const isV4Mapped = (a: Uint8Array): boolean =>
  V4_MAPPED_PREFIX.every((b, i) => a[i] === b)

/** Лексикографическое сравнение адресов одной длины */
function compare(a: Uint8Array, b: Uint8Array, bFrom: number): number {
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[bFrom + i]!
    if (d !== 0) return d
  }
  return 0
}

export function readIpCidrSet(body: Buffer): IpCidrSet {
  if (body.length < 1 || body[0] !== 1) {
    throw new RuleSetError(`Версия набора подсетей ${body[0] ?? '?'} — редактор знает только первую`)
  }
  if (body.length < 9) throw new RuleSetError('Испорченный набор подсетей: обрыв на длине')
  const n = Number(body.readBigInt64BE(1))
  if (n < 1) throw new RuleSetError('Испорченный набор подсетей: пустой список')
  if (9 + n * 32 > body.length) {
    throw new RuleSetError('Испорченный набор подсетей: список выходит за границу файла')
  }

  const v4: Uint8Array[] = []
  const v6: Uint8Array[] = []
  for (let i = 0; i < n; i++) {
    const at = 9 + i * 32
    // Пара «начало + конец» хранится одним куском в 32 байта: так сравнение
    // не создаёт срезов на каждом шаге двоичного поиска
    const pair = new Uint8Array(body.subarray(at, at + 32))
    ;(isV4Mapped(pair.subarray(0, 16)) ? v4 : v6).push(pair)
  }
  return { v4, v6 }
}

/** Попадает ли адрес хотя бы в один диапазон набора */
export function hasIp(set: IpCidrSet, ip: string): boolean {
  const bytes = ipToBytes(ip)
  if (bytes === null) return false

  // Приводим к тем же 16 байтам, какими ядро записало диапазон: у IPv4 это
  // v4-mapped форма
  const key = new Uint8Array(16)
  if (bytes.length === 4) {
    key.set(V4_MAPPED_PREFIX, 0)
    key.set(bytes, 12)
  } else {
    key.set(bytes, 0)
  }
  const ranges = bytes.length === 4 ? set.v4 : set.v6
  if (ranges.length === 0) return false

  // Последний диапазон, начало которого не больше адреса
  let lo = 0
  let hi = ranges.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (compare(key, ranges[mid]!, 0) >= 0) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return false
  // Конец диапазона включительный — вторые 16 байт пары
  return compare(key, ranges[found]!, 16) <= 0
}

/** Что-то, у чего можно спросить про адрес: набор из `.mrs` либо текстовый */
export interface IpMatcher {
  has(ip: string): boolean
}

export const ipMatcher = (set: IpCidrSet): IpMatcher => ({ has: (ip) => hasIp(set, ip) })

// Текстовые наборы `domain` и `ipcidr` разбираются в простые структуры:
// собирать ради них сжатый бор незачем — он нужен только чтобы ЧИТАТЬ то, что
// уже собрало ядро. Текстовые наборы доменов в экосистеме редки и малы, поэтому
// линейного сравнения достаточно.
import type { GeoCidr } from '../geo/dat.js'
import { ipMatches, ipToBytes } from '../geo/match.js'
import type { DomainMatcher } from './domainSet.js'
import type { IpMatcher } from './ipcidrSet.js'

/**
 * Запись текстового набора доменов. Правила те же, что у списка `domain` в
 * самом документе Mihomo: `+.` — домен и любые поддомены, `*.` — ровно одна
 * метка, ведущая точка — только поддомены, иначе точное совпадение.
 */
export function domainSetFromLines(lines: string[]): DomainMatcher {
  const entries = lines.map((line) => line.trim().toLowerCase()).filter((l) => l !== '')
  return {
    has(domain: string): boolean {
      const target = domain.trim().toLowerCase()
      if (target === '') return false
      return entries.some((entry) => matchDomainEntry(entry, target))
    },
  }
}

function matchDomainEntry(entry: string, target: string): boolean {
  if (entry.startsWith('+.')) {
    const base = entry.slice(2)
    return target === base || target.endsWith(`.${base}`)
  }
  if (entry.startsWith('*.')) {
    const base = entry.slice(2)
    if (!target.endsWith(`.${base}`)) return false
    // Ровно одна метка: в остатке точек быть не должно
    return !target.slice(0, target.length - base.length - 1).includes('.')
  }
  if (entry.startsWith('.')) return target.endsWith(entry)
  return target === entry
}

/**
 * Текстовый набор подсетей: строка на подсеть в записи CIDR. Арифметику берём
 * готовую — `ipMatches` из `geo/match.ts`, — а не пишем вторую копию: разойтись
 * этим двум было бы очень легко и очень незаметно.
 */
export function ipCidrSetFromLines(lines: string[]): IpMatcher {
  const cidrs: GeoCidr[] = []
  for (const line of lines) {
    const [addr, len] = line.trim().split('/')
    const ip = addr === undefined ? null : ipToBytes(addr)
    if (ip === null) continue // строку, которую не разобрали, молча пропускаем
    const prefix = len === undefined ? ip.length * 8 : Number(len)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > ip.length * 8) continue
    cidrs.push({ ip, prefix })
  }
  return { has: (ip: string) => ipMatches(cidrs, ip) }
}

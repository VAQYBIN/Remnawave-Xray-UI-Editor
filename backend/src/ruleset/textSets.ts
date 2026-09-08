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
    const trimmed = line.trim()
    if (trimmed === '') continue
    const slash = trimmed.indexOf('/')
    const ip = ipToBytes(slash < 0 ? trimmed : trimmed.slice(0, slash))
    if (ip === null) continue // строку, которую не разобрали, молча пропускаем
    const bits = ip.length * 8

    let prefix = bits
    if (slash >= 0) {
      const lenText = trimmed.slice(slash + 1)
      // Только десятичные цифры, и ничего больше. `Number` здесь опасен именно
      // тем, что почти всегда прав: у записи с лишней косой (`10.0.0.0/`) он
      // берёт пустую строку за НОЛЬ, и набор превращается в `0.0.0.0/0` —
      // «совпадает со всем». Одна опечатка в чужом наборе делала бы правило
      // `RULE-SET` совпавшим для любого адреса, и трассировка уверенно называла
      // бы неверный маршрут. Заодно `Number` принимает `0x8` и ` 8 `.
      if (!/^[0-9]{1,3}$/.test(lenText)) continue
      prefix = Number(lenText)
    }
    if (prefix > bits) continue
    cidrs.push({ ip, prefix })
  }
  return { has: (ip: string) => ipMatches(cidrs, ip) }
}

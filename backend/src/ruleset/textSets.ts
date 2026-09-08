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

/**
 * Сравнение идёт ПО МЕТКАМ, а не по суффиксам строки, потому что так устроен
 * поиск в ядре (`component/trie/domain.go`, `DomainTrie.search`): на каждом
 * уровне пробуется точная метка, затем `*` как ЛЮБАЯ ОДНА метка, и лишь потом
 * ветка «любой остаток», которую заводит `+`.
 *
 * Прежняя редакция знала только ведущие `*.` и `+.`, поэтому запись вида
 * `www.*.example.com` не совпадала ни с чем: ядро отвечало «да», редактор —
 * уверенное «нет», и трассировка уходила к чужому правилу. Формат набора на
 * семантику ядра не влияет, так что текстовый набор обязан отвечать так же, как
 * скомпилированный.
 */
function matchDomainEntry(entry: string, target: string): boolean {
  const t = target.split('.')
  let e = entry.split('.')

  // `+.` совпадает и с самим доменом, ведущая точка — только с поддоменами
  const complex = e[0] === '+'
  const leadingDot = e[0] === ''
  if (complex || leadingDot) e = e.slice(1)

  if (complex || leadingDot) {
    if (t.length < e.length) return false
    if (leadingDot && t.length === e.length) return false
    const tail = t.slice(t.length - e.length)
    return e.every((label, i) => label === '*' || label === tail[i])
  }

  if (t.length !== e.length) return false
  return e.every((label, i) => label === '*' || label === t[i])
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

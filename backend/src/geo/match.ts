// Матчинг по разобранным geo-данным. Регистр и разбор ключа повторяют
// common/geodata/rule_parser.go: код категории апперкейсится, атрибут — в нижний
// регистр, префикс «!» у geoip инвертирует результат и может повторяться.

import type { GeoCidr, GeoDomain } from './dat.js'

export interface GeoKey {
  kind: 'geosite' | 'geoip'
  code: string
  attribute?: string
  negated: boolean
}

export function parseKey(key: string): GeoKey | null {
  const kind = key.startsWith('geosite:') ? 'geosite' : key.startsWith('geoip:') ? 'geoip' : null
  if (kind === null) return null
  let body = key.slice(kind === 'geosite' ? 8 : 6)
  let negated = false
  while (body.startsWith('!')) {
    body = body.slice(1)
    negated = !negated
  }
  const at = body.indexOf('@')
  const code = (at === -1 ? body : body.slice(0, at)).toUpperCase()
  const attribute = at === -1 ? undefined : body.slice(at + 1).toLowerCase()
  return { kind, code, attribute, negated }
}

function oneDomainMatches(d: GeoDomain, address: string): boolean {
  if (d.type === 3) return address === d.value
  if (d.type === 2) return address === d.value || address.endsWith(`.${d.value}`)
  if (d.type === 1) {
    try {
      return new RegExp(d.value).test(address)
    } catch {
      // Битое выражение в чужой базе — не наша забота, просто не матчим
      return false
    }
  }
  return address.includes(d.value)
}

export function domainMatches(domains: GeoDomain[], address: string, attribute?: string): boolean {
  for (const d of domains) {
    if (attribute !== undefined && !d.attributes.includes(attribute)) continue
    if (oneDomainMatches(d, address)) return true
  }
  return false
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function ipToBytes(ip: string): Uint8Array | null {
  const v4 = IPV4_RE.exec(ip)
  if (v4) {
    const bytes = new Uint8Array(4)
    for (let i = 0; i < 4; i += 1) {
      const octet = Number(v4[i + 1])
      if (octet > 255) return null
      bytes[i] = octet
    }
    return bytes
  }
  if (!ip.includes(':')) return null
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0]!.split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : []
  const gap = halves.length === 2 ? 8 - head.length - tail.length : 8 - head.length
  if (gap < 0 || (halves.length === 1 && gap !== 0)) return null
  const groups = [...head, ...Array<string>(gap).fill('0'), ...tail]
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i += 1) {
    const part = groups[i]!
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null
    const word = parseInt(part, 16)
    bytes[i * 2] = word >> 8
    bytes[i * 2 + 1] = word & 0xff
  }
  return bytes
}

function inCidr(cidr: GeoCidr, addr: Uint8Array): boolean {
  if (cidr.ip.length !== addr.length) return false
  const full = cidr.prefix >> 3
  for (let i = 0; i < full; i += 1) {
    if (cidr.ip[i] !== addr[i]) return false
  }
  const rest = cidr.prefix & 7
  if (rest === 0) return true
  const mask = (0xff << (8 - rest)) & 0xff
  return (cidr.ip[full]! & mask) === (addr[full]! & mask)
}

export function ipMatches(cidrs: GeoCidr[], ip: string): boolean {
  const addr = ipToBytes(ip)
  if (!addr) return false
  return cidrs.some((cidr) => inCidr(cidr, addr))
}

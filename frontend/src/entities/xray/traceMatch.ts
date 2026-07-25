// Предикаты отдельных полей правила маршрутизации. Каждое поле отвечает на вопрос
// «совпала ли цель», и отвечает честно: 'unknown' там, где данных нет, а не догадкой.

import { portMatches, portSpecError } from './rules'

export type MatchState = 'yes' | 'no' | 'unknown'

/** Цель трассировки — то, что пользователь хочет провести через правила */
export interface TraceTarget {
  address: string
  port: number
  network: 'tcp' | 'udp'
  /** IP назначения; сервер домены не резолвит, поле заполняет пользователь */
  ip?: string
  sourceIp?: string
  sourcePort?: number
  inboundTag?: string
  user?: string
  /** http|tls|quic|bittorrent — известен только если inbound снифает трафик */
  protocol?: string
}

/**
 * Ответы geo-базы. Три состояния ключа различаются намеренно: есть ответ;
 * база загружена, но категории в ней нет (`missing` — ошибка конфига, ядро такой
 * конфиг отвергнет); база не загружена (`loaded: false`).
 */
export interface GeoAnswers {
  loaded: boolean
  answers: Record<string, boolean>
  missing: string[]
}

export interface FieldVerdict {
  field: string
  state: MatchState
  reason: string
}

function geoState(key: string, geo: GeoAnswers): MatchState {
  if (!geo.loaded) return 'unknown'
  const answer = geo.answers[key]
  return answer === undefined ? 'unknown' : answer ? 'yes' : 'no'
}

export function matchDomainPattern(pattern: string, address: string, geo: GeoAnswers): MatchState {
  if (pattern.startsWith('full:')) return address === pattern.slice(5) ? 'yes' : 'no'
  if (pattern.startsWith('domain:')) {
    const base = pattern.slice(7)
    return address === base || address.endsWith(`.${base}`) ? 'yes' : 'no'
  }
  if (pattern.startsWith('keyword:')) return address.includes(pattern.slice(8)) ? 'yes' : 'no'
  if (pattern.startsWith('regexp:')) {
    try {
      return new RegExp(pattern.slice(7)).test(address) ? 'yes' : 'no'
    } catch {
      // Битое выражение — не наше дело угадывать, что имелось в виду
      return 'unknown'
    }
  }
  if (pattern.startsWith('geosite:')) {
    // Атрибут (geosite:google@ads) — часть ключа: база отвечает уже с его учётом
    return geoState(pattern, geo)
  }
  if (pattern.startsWith('ext:')) return 'unknown'
  // Строка без префикса матчится как keyword-подстрока
  return address.includes(pattern) ? 'yes' : 'no'
}

/** ИЛИ по значениям поля: 'yes' перевешивает, 'unknown' перевешивает 'no' */
export function aggregate(
  field: string,
  states: { value: string; state: MatchState }[],
  labels: { yes: (v: string) => string; unknown: string; no: string },
): FieldVerdict {
  const hit = states.find((s) => s.state === 'yes')
  if (hit) return { field, state: 'yes', reason: labels.yes(hit.value) }
  if (states.some((s) => s.state === 'unknown')) return { field, state: 'unknown', reason: labels.unknown }
  return { field, state: 'no', reason: labels.no }
}

export function matchDomainField(patterns: string[], address: string, geo: GeoAnswers): FieldVerdict {
  const states = patterns.map((value) => ({ value, state: matchDomainPattern(value, address, geo) }))
  return aggregate('domain', states, {
    yes: (v) => `домен подходит под «${v}»`,
    unknown: 'зависит от geo-списка или внешнего файла',
    no: 'ни один шаблон домена не подходит',
  })
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Адрес в виде числа и размера в битах — чтобы сравнивать v4 и v6 одним кодом */
function parseIp(value: string): { bits: bigint; size: 32 | 128 } | null {
  const v4 = IPV4_RE.exec(value)
  if (v4) {
    let bits = 0n
    for (let i = 1; i <= 4; i += 1) {
      const octet = Number(v4[i])
      if (octet > 255) return null
      bits = (bits << 8n) | BigInt(octet)
    }
    return { bits, size: 32 }
  }
  if (!value.includes(':')) return null
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : []
  const groups = halves.length === 2 ? 8 - head.length - tail.length : 8 - head.length
  if (groups < 0 || (halves.length === 1 && groups !== 0)) return null
  const parts = [...head, ...Array<string>(groups).fill('0'), ...tail]
  let bits = 0n
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null
    bits = (bits << 16n) | BigInt(parseInt(part, 16))
  }
  return { bits, size: 128 }
}

export function isIpAddress(value: string): boolean {
  return parseIp(value) !== null
}

/** null — адрес или CIDR не разобрались; сравнивать нечего */
export function ipInCidr(ip: string, cidr: string): boolean | null {
  const [net, prefixText] = cidr.split('/')
  const a = parseIp(ip)
  const b = parseIp(net)
  if (!a || !b) return null
  if (a.size !== b.size) return false
  const prefix = prefixText === undefined ? a.size : Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > a.size) return null
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(a.size - prefix)
  return (a.bits & mask) === (b.bits & mask)
}

/** Доступность IP назначения: известен / не указан / ядро его вообще не узнает */
export type IpAvailability = 'known' | 'unspecified' | 'never'

function matchIpPattern(pattern: string, ip: string, geo: GeoAnswers): MatchState {
  if (pattern.startsWith('geoip:')) {
    const body = pattern.slice(6)
    const negated = body.startsWith('!')
    const state = geoState(`geoip:${negated ? body.slice(1) : body}`, geo)
    if (state === 'unknown') return 'unknown'
    return negated ? (state === 'yes' ? 'no' : 'yes') : state
  }
  if (pattern.startsWith('ext:')) return 'unknown'
  const hit = ipInCidr(ip, pattern)
  return hit === null ? 'unknown' : hit ? 'yes' : 'no'
}

export function matchIpField(
  field: string,
  patterns: string[],
  ip: string | undefined,
  availability: IpAvailability,
  geo: GeoAnswers,
): FieldVerdict {
  if (availability === 'never') {
    return {
      field,
      state: 'no',
      reason: 'стратегия домена AsIs: ядро не резолвит домен, поэтому ip-условия не применяются',
    }
  }
  if (availability === 'unspecified' || ip === undefined) {
    return { field, state: 'unknown', reason: 'укажите IP назначения, чтобы проверить ip-условия' }
  }
  const states = patterns.map((value) => ({ value, state: matchIpPattern(value, ip, geo) }))
  return aggregate(field, states, {
    yes: (v) => `адрес подходит под «${v}»`,
    unknown: 'зависит от geo-списка или внешнего файла',
    no: 'ни одна подсеть не подходит',
  })
}

export function matchPortField(
  field: string,
  spec: string | number,
  port: number | undefined,
): FieldVerdict {
  const formatError = portSpecError(spec)
  if (formatError) return { field, state: 'unknown', reason: `непонятный формат портов: ${formatError}` }
  if (port === undefined) return { field, state: 'unknown', reason: 'порт цели не задан' }
  return portMatches(spec, port)
    ? { field, state: 'yes', reason: `порт ${port} входит в «${spec}»` }
    : { field, state: 'no', reason: `порт ${port} не входит в «${spec}»` }
}

export function matchNetworkField(spec: string, network: string): FieldVerdict {
  const allowed = spec.split(',').map((s) => s.trim()).filter(Boolean)
  return allowed.includes(network)
    ? { field: 'network', state: 'yes', reason: `сеть ${network} разрешена` }
    : { field: 'network', state: 'no', reason: `правило только для «${spec}»` }
}

/** Точное совпадение по списку (user, inboundTag, protocol) */
export function matchExactField(
  field: string,
  patterns: string[],
  value: string | undefined,
  hint: string,
): FieldVerdict {
  if (value === undefined) return { field, state: 'unknown', reason: hint }
  return patterns.includes(value)
    ? { field, state: 'yes', reason: `«${value}» есть в списке` }
    : { field, state: 'no', reason: `«${value}» не входит в список` }
}

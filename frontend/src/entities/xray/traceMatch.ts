// Предикаты отдельных полей правила маршрутизации. Каждое поле отвечает на вопрос
// «совпала ли цель», и отвечает честно: 'unknown' там, где данных нет, а не догадкой.

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

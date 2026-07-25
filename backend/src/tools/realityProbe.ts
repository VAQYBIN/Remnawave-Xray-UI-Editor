// Проверка Reality-цели: годится ли сайт под маскировку. Своя реализация вместо
// `xray tls ping` — даёт структурированный результат и работает без бинаря ядра.

export type CheckLevel = 'ok' | 'warn' | 'error'

export interface RealityCheck {
  id: string
  level: CheckLevel
  title: string
  detail?: string
}

export interface PeerInfo {
  protocol: string | null
  cipher?: string
  alpn?: string | null
  keyExchange?: string
  subject?: string
  issuer?: string
  altNames: string[]
  validTo?: string
  /** Прошла ли цепочка проверку по системным корням */
  authorized?: boolean
  authorizationError?: string
}

// Короткий список, расширяется по мере надобности. Совпадение — повод присмотреться,
// а не вердикт: за этими же именами живут и обычные сайты.
const CDN_MARKERS = [
  'cloudflare',
  'akamai',
  'fastly',
  'cloudfront',
  'incapsula',
  'imperva',
  'sucuri',
  'stackpath',
  'bunny',
  'gcore',
  'ddos-guard',
  'qrator',
  'edgecast',
  'cdn77',
]

export function certCovers(altNames: string[], name: string): boolean {
  const host = name.trim().toLowerCase().replace(/\.$/, '')
  if (host === '') return false
  return altNames.some((entry) => {
    const pattern = entry.trim().toLowerCase().replace(/^dns:/, '')
    if (pattern === host) return true
    if (!pattern.startsWith('*.')) return false
    const suffix = pattern.slice(1) // '.example.com'
    if (!host.endsWith(suffix)) return false
    const head = host.slice(0, host.length - suffix.length)
    // Wildcard покрывает ровно один уровень и не покрывает сам домен
    return head !== '' && !head.includes('.')
  })
}

export function cdnSuspect(info: PeerInfo): string | undefined {
  const haystack = [info.issuer ?? '', info.subject ?? '', ...info.altNames].join(' ').toLowerCase()
  return CDN_MARKERS.find((marker) => haystack.includes(marker))
}

export function buildChecks(info: PeerInfo, serverNames: string[]): RealityCheck[] {
  const checks: RealityCheck[] = []

  const tls13 = info.protocol === 'TLSv1.3'
  checks.push({
    id: 'tls13',
    level: tls13 ? 'ok' : 'error',
    title: tls13 ? 'TLS 1.3' : `Нет TLS 1.3 (цель отвечает ${info.protocol ?? 'непонятно чем'})`,
    detail: tls13 ? undefined : 'Reality работает только с TLS 1.3 — такая цель не подойдёт.',
  })

  const h2 = info.alpn === 'h2'
  checks.push({
    id: 'alpn',
    level: h2 ? 'ok' : 'warn',
    title: h2 ? 'ALPN h2' : `ALPN не h2 (${info.alpn ?? 'не согласован'})`,
    detail: h2
      ? undefined
      : 'Желательно h2: клиенты чаще всего просят именно его, и профиль трафика будет ближе к настоящему.',
  })

  const x25519 = (info.keyExchange ?? '').toUpperCase().includes('X25519')
  checks.push({
    id: 'x25519',
    level: x25519 ? 'ok' : 'warn',
    title: x25519 ? 'Обмен ключами X25519' : `Обмен ключами ${info.keyExchange ?? 'неизвестен'}`,
    detail: x25519 ? undefined : 'Reality рассчитан на X25519. Другая кривая — цель хуже подходит.',
  })

  if (serverNames.length === 0) {
    checks.push({
      id: 'sni',
      level: 'warn',
      title: 'serverNames не заданы',
      detail: `Сверять сертификат не с чем. Сертификат выдан на: ${info.altNames.join(', ') || '—'}`,
    })
  } else {
    const uncovered = serverNames.filter((name) => !certCovers(info.altNames, name))
    checks.push(
      uncovered.length === 0
        ? { id: 'sni', level: 'ok', title: 'Сертификат покрывает все serverNames' }
        : {
            id: 'sni',
            level: 'error',
            title: `Сертификат не покрывает: ${uncovered.join(', ')}`,
            detail: `В сертификате: ${info.altNames.join(', ') || '—'}`,
          },
    )
  }

  // Соединение установлено с rejectUnauthorized: false — иначе негодная цель дала бы
  // отказ рукопожатия вместо вердикта. Результат проверки цепочки поэтому не
  // выбрасывается, а показывается: у нормального публичного сайта она сходится.
  const authorized = info.authorized !== false
  checks.push({
    id: 'chain',
    level: authorized ? 'ok' : 'warn',
    title: authorized
      ? 'Сертификат проверяется по системным корням'
      : 'Цепочка сертификата не проверяется',
    detail: authorized
      ? undefined
      : `Причина: ${info.authorizationError ?? 'неизвестна'}. Reality сам цепочку не проверяет, но обычный публичный сайт такого не показывает — возможно, это не та цель, за которую вы её принимаете.`,
  })

  const cdn = cdnSuspect(info)
  if (cdn !== undefined) {
    checks.push({
      id: 'cdn',
      level: 'warn',
      title: `Похоже на CDN (${cdn})`,
      detail:
        'Это подозрение по сертификату, а не факт. За CDN сертификат общий, а адреса меняются — Reality на такой цели ненадёжен.',
    })
  }

  return checks
}

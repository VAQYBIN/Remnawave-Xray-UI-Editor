// Проверка Reality-цели: годится ли сайт под маскировку. Своя реализация вместо
// `xray tls ping` — даёт структурированный результат и работает без бинаря ядра.

import { connect, type PeerCertificate } from 'node:tls'
import { assertPublicHost } from '../net/guard.js'

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

export interface RealityProbeInput {
  target: string
  serverNames?: string[]
}

export interface RealityProbeResult {
  target: string
  host?: string
  port?: number
  reachable: boolean
  error?: string
  info?: PeerInfo
  checks: RealityCheck[]
}

export interface RealityProbeOptions {
  lookupImpl?: (host: string) => Promise<{ address: string }[]>
  connectImpl?: (opts: {
    host: string
    port: number
    servername: string
    timeoutMs: number
  }) => Promise<PeerInfo>
  timeoutMs?: number
}

const TIMEOUT_MS = 5_000

export function parseTarget(target: string): { host: string; port: number } | null {
  const trimmed = target.trim()
  if (trimmed === '') return null

  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed)
  const [host, rawPort] = bracketed
    ? ([bracketed[1]!, bracketed[2]] as const)
    : (() => {
        const idx = trimmed.lastIndexOf(':')
        // Двоеточий больше одного — это IPv6 без скобок, порта в записи нет
        if (idx === -1 || trimmed.indexOf(':') !== idx) return [trimmed, undefined] as const
        return [trimmed.slice(0, idx), trimmed.slice(idx + 1)] as const
      })()

  if (host === '') return null
  if (rawPort === undefined || rawPort === '') return { host, port: 443 }
  if (!/^\d+$/.test(rawPort)) return null
  const port = Number(rawPort)
  if (port < 1 || port > 65535) return null
  return { host, port }
}

function altNamesOf(cert: PeerCertificate | undefined): string[] {
  return (cert?.subjectaltname ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^DNS:/i, ''))
    .filter((entry) => entry !== '')
}

/**
 * rejectUnauthorized: false намеренно — это инспектор, а не транспорт: сертификат
 * мы разбираем сами и обязаны увидеть даже негодный, а секретов в это соединение
 * не отправляется. Результат проверки цепочки не теряется — он уходит в вердикт
 * `chain` (см. buildChecks). minVersion TLS 1.2, чтобы цель без 1.3 не роняла
 * рукопожатие, а честно попадала в вердикт «нет TLS 1.3».
 */
const tlsConnect: NonNullable<RealityProbeOptions['connectImpl']> = (o) =>
  new Promise((resolve, reject) => {
    const socket = connect(
      {
        host: o.host,
        port: o.port,
        servername: o.servername,
        ALPNProtocols: ['h2', 'http/1.1'],
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
      },
      () => {
        const cert = socket.getPeerCertificate()
        const ephemeral = socket.getEphemeralKeyInfo() as { name?: string; type?: string } | null
        const authError: unknown = socket.authorizationError
        resolve({
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name,
          alpn: socket.alpnProtocol === false ? null : (socket.alpnProtocol ?? null),
          keyExchange: ephemeral?.name ?? ephemeral?.type,
          subject: cert?.subject?.CN,
          issuer: [cert?.issuer?.O, cert?.issuer?.CN].filter(Boolean).join(' ') || undefined,
          altNames: altNamesOf(cert),
          validTo: cert?.valid_to,
          authorized: socket.authorized,
          // В типах это Error, но в рантайме встречается и код строкой — терпим оба
          authorizationError:
            typeof authError === 'string' ? authError : (authError as Error | undefined)?.message,
        })
        socket.end()
      },
    )
    socket.setTimeout(o.timeoutMs, () => socket.destroy(new Error('Цель не ответила за 5 секунд')))
    socket.on('error', reject)
  })

export async function probeRealityTarget(
  input: RealityProbeInput,
  opts: RealityProbeOptions = {},
): Promise<RealityProbeResult> {
  const serverNames = input.serverNames ?? []
  const parsed = parseTarget(input.target)
  if (!parsed) {
    return {
      target: input.target,
      reachable: false,
      error: 'Не разобрал адрес цели: ожидается host или host:port',
      checks: [],
    }
  }

  const base = { target: input.target, host: parsed.host, port: parsed.port }
  try {
    // Тот же запрет, что у загрузки geo-баз: адрес приходит из браузера,
    // а серверу незачем ходить по внутренней сети. Опт-ина здесь нет —
    // Reality-цель по определению публичный сайт.
    await assertPublicHost(parsed.host, { lookupImpl: opts.lookupImpl })
  } catch (err) {
    return { ...base, reachable: false, error: (err as Error).message, checks: [] }
  }

  const doConnect = opts.connectImpl ?? tlsConnect
  try {
    const info = await doConnect({
      host: parsed.host,
      port: parsed.port,
      servername: serverNames[0] ?? parsed.host,
      timeoutMs: opts.timeoutMs ?? TIMEOUT_MS,
    })
    return { ...base, reachable: true, info, checks: buildChecks(info, serverNames) }
  } catch (err) {
    return { ...base, reachable: false, error: (err as Error).message, checks: [] }
  }
}

export type RealityProbe = typeof probeRealityTarget

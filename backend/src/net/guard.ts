// Защита исходящих запросов от SSRF. Пользователь задаёт ссылки на geo-базы сам,
// поэтому сервер обязан убедиться, что идёт во внешнюю сеть, а не в соседний
// контейнер или к облачным метаданным (169.254.169.254 отдаёт временные креды).
//
// Проверять только исходный URL недостаточно: публичный хост может ответить
// редиректом на внутренний адрес. Поэтому redirect: 'manual' и проверка каждого хопа.

import { lookup } from 'node:dns/promises'
import { ipToBytes } from '../geo/match.js'

export interface FetchGuardOptions {
  fetchImpl?: typeof fetch
  lookupImpl?: (host: string) => Promise<{ address: string }[]>
  /** Осознанное разрешение внутренних адресов — для зеркала в локальной сети */
  allowPrivate?: boolean
  maxHops?: number
  timeoutMs?: number
}

function v4Private(b: Uint8Array): boolean {
  const [a, second] = [b[0]!, b[1]!]
  if (a === 0 || a === 127) return true // текущая сеть, loopback
  if (a === 10) return true
  if (a === 172 && second >= 16 && second <= 31) return true
  if (a === 192 && second === 168) return true
  if (a === 169 && second === 254) return true // link-local, включая метаданные
  if (a === 100 && second >= 64 && second <= 127) return true // CGNAT
  if (a >= 224) return true // multicast и зарезервированное
  return false
}

/** Незнакомый формат тоже считаем небезопасным: лучше отказать, чем пустить наугад */
export function isPrivateAddress(ip: string): boolean {
  const bytes = ipToBytes(ip)
  if (!bytes) return true

  if (bytes.length === 4) return v4Private(bytes)

  // IPv4-mapped (::ffff:127.0.0.1) — иначе через него обходится вся проверка
  const mappedPrefix = bytes.slice(0, 12)
  const isMapped =
    mappedPrefix.slice(0, 10).every((x) => x === 0) &&
    mappedPrefix[10] === 0xff &&
    mappedPrefix[11] === 0xff
  if (isMapped) return v4Private(bytes.slice(12))

  if (bytes.every((x) => x === 0)) return true // ::
  if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return true // ::1
  if ((bytes[0]! & 0xfe) === 0xfc) return true // fc00::/7 — ULA
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true // fe80::/10 — link-local
  if (bytes[0] === 0xff) return true // ff00::/8 — multicast
  return false
}

async function assertPublicHost(
  hostname: string,
  opts: FetchGuardOptions,
): Promise<void> {
  const resolve =
    opts.lookupImpl ?? ((host: string) => lookup(host, { all: true, verbatim: true }))
  let addresses: { address: string }[]
  try {
    addresses = await resolve(hostname)
  } catch {
    throw new Error(`Не удалось разрешить имя «${hostname}»`)
  }
  if (addresses.length === 0) throw new Error(`Имя «${hostname}» ни во что не разрешается`)
  // Проверяем все адреса: достаточно одного внутреннего, чтобы отказать
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Адрес «${hostname}» указывает во внутреннюю сеть (${address}). Если это ваше зеркало, включите GEO_ALLOW_PRIVATE_URLS=true`,
      )
    }
  }
}

/**
 * Скачивание по ссылке, заданной пользователем. Редиректы проходятся вручную,
 * потому что GitHub releases всегда ведёт на CDN, а каждый хоп нужно проверить.
 */
export async function fetchExternal(url: string, opts: FetchGuardOptions = {}): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch
  const maxHops = opts.maxHops ?? 5
  let current = url

  for (let hop = 0; hop <= maxHops; hop += 1) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      throw new Error(`Некорректная ссылка: ${current}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Ссылка должна начинаться с http:// или https://')
    }
    if (!opts.allowPrivate) await assertPublicHost(parsed.hostname, opts)

    const res = await doFetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    })
    if (res.status < 300 || res.status >= 400) return res

    const location = res.headers.get('location')
    if (!location) throw new Error(`Редирект без заголовка Location (${res.status})`)
    current = new URL(location, current).toString()
  }

  throw new Error(`Слишком много редиректов (больше ${maxHops})`)
}

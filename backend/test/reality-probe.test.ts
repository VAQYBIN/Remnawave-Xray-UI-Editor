import { describe, expect, it } from 'vitest'
import {
  buildChecks,
  cdnSuspect,
  certCovers,
  parseTarget,
  probeRealityTarget,
  type PeerInfo,
} from '../src/tools/realityProbe.js'

const GOOD: PeerInfo = {
  protocol: 'TLSv1.3',
  cipher: 'TLS_AES_128_GCM_SHA256',
  alpn: 'h2',
  keyExchange: 'X25519',
  subject: 'www.example.com',
  issuer: "Let's Encrypt R3",
  altNames: ['www.example.com', '*.cdn-free.example.com'],
  validTo: 'Oct 10 12:00:00 2026 GMT',
  authorized: true,
}

describe('certCovers', () => {
  it('точное совпадение', () => {
    expect(certCovers(['www.example.com'], 'www.example.com')).toBe(true)
  })

  it('wildcard покрывает один уровень', () => {
    expect(certCovers(['*.example.com'], 'a.example.com')).toBe(true)
  })

  it('wildcard не покрывает два уровня', () => {
    expect(certCovers(['*.example.com'], 'a.b.example.com')).toBe(false)
  })

  it('wildcard не покрывает сам домен', () => {
    expect(certCovers(['*.example.com'], 'example.com')).toBe(false)
  })

  it('терпит префикс DNS: и разный регистр', () => {
    expect(certCovers(['DNS:WWW.Example.com'], 'www.example.com')).toBe(true)
  })
})

describe('cdnSuspect', () => {
  it('видит Cloudflare по эмитенту', () => {
    expect(cdnSuspect({ ...GOOD, issuer: 'Cloudflare Inc ECC CA-3' })).toBe('cloudflare')
  })

  it('чистый сертификат подозрений не вызывает', () => {
    expect(cdnSuspect(GOOD)).toBeUndefined()
  })
})

describe('buildChecks', () => {
  it('всё хорошо — ни одного warn и error', () => {
    const checks = buildChecks(GOOD, ['www.example.com'])
    expect(checks.every((c) => c.level === 'ok')).toBe(true)
  })

  it('TLS 1.2 — ошибка', () => {
    const checks = buildChecks({ ...GOOD, protocol: 'TLSv1.2' }, ['www.example.com'])
    expect(checks.find((c) => c.id === 'tls13')?.level).toBe('error')
  })

  it('без h2 — предупреждение, а не ошибка', () => {
    const checks = buildChecks({ ...GOOD, alpn: 'http/1.1' }, ['www.example.com'])
    expect(checks.find((c) => c.id === 'alpn')?.level).toBe('warn')
  })

  it('не тот обмен ключами — предупреждение', () => {
    const checks = buildChecks({ ...GOOD, keyExchange: 'P-256' }, ['www.example.com'])
    expect(checks.find((c) => c.id === 'x25519')?.level).toBe('warn')
  })

  it('сертификат не покрывает serverNames — ошибка с перечислением', () => {
    const checks = buildChecks(GOOD, ['other.test'])
    const sni = checks.find((c) => c.id === 'sni')!
    expect(sni.level).toBe('error')
    expect(sni.title).toContain('other.test')
  })

  it('serverNames не заданы — предупреждение', () => {
    expect(buildChecks(GOOD, []).find((c) => c.id === 'sni')?.level).toBe('warn')
  })

  it('CDN подаётся подозрением', () => {
    const checks = buildChecks({ ...GOOD, issuer: 'Cloudflare Inc ECC CA-3' }, ['www.example.com'])
    const cdn = checks.find((c) => c.id === 'cdn')!
    expect(cdn.level).toBe('warn')
    expect(cdn.detail).toMatch(/подозрение/i)
  })

  it('непроверяемая цепочка сертификата — предупреждение с причиной', () => {
    const checks = buildChecks(
      { ...GOOD, authorized: false, authorizationError: 'SELF_SIGNED_CERT_IN_CHAIN' },
      ['www.example.com'],
    )
    const chain = checks.find((c) => c.id === 'chain')!
    expect(chain.level).toBe('warn')
    expect(chain.detail).toContain('SELF_SIGNED_CERT_IN_CHAIN')
  })

  it('доверенная цепочка — вердикт ok', () => {
    expect(buildChecks(GOOD, ['www.example.com']).find((c) => c.id === 'chain')?.level).toBe('ok')
  })
})

describe('parseTarget', () => {
  it('хост с портом', () => {
    expect(parseTarget('example.com:8443')).toEqual({ host: 'example.com', port: 8443 })
  })

  it('без порта — 443', () => {
    expect(parseTarget('example.com')).toEqual({ host: 'example.com', port: 443 })
  })

  it('IPv6 в скобках', () => {
    expect(parseTarget('[2606:4700::1]:443')).toEqual({ host: '2606:4700::1', port: 443 })
  })

  it('мусорный порт — null', () => {
    expect(parseTarget('example.com:0')).toBeNull()
    expect(parseTarget('example.com:abc')).toBeNull()
  })
})

describe('probeRealityTarget', () => {
  const info: PeerInfo = { ...GOOD }

  it('успешная проба возвращает вердикты', async () => {
    const res = await probeRealityTarget(
      { target: 'www.example.com:443', serverNames: ['www.example.com'] },
      { lookupImpl: async () => [{ address: '93.184.216.34' }], connectImpl: async () => info },
    )
    expect(res.reachable).toBe(true)
    expect(res.port).toBe(443)
    expect(res.checks.find((c) => c.id === 'tls13')?.level).toBe('ok')
  })

  it('внутренний адрес отклоняется до соединения', async () => {
    let connected = false
    const res = await probeRealityTarget(
      { target: 'intranet.test:443' },
      {
        lookupImpl: async () => [{ address: '10.0.0.5' }],
        connectImpl: async () => {
          connected = true
          return info
        },
      },
    )
    expect(connected).toBe(false)
    expect(res.reachable).toBe(false)
    expect(res.error).toMatch(/внутреннюю сеть/i)
    expect(res.error).not.toMatch(/GEO_ALLOW_PRIVATE_URLS/)
  })

  it('SNI берётся из первого serverName', async () => {
    let servername = ''
    await probeRealityTarget(
      { target: 'www.example.com:443', serverNames: ['sni.example.com'] },
      {
        lookupImpl: async () => [{ address: '93.184.216.34' }],
        connectImpl: async (o) => {
          servername = o.servername
          return info
        },
      },
    )
    expect(servername).toBe('sni.example.com')
  })

  it('без serverNames SNI равен хосту', async () => {
    let servername = ''
    await probeRealityTarget(
      { target: 'www.example.com' },
      {
        lookupImpl: async () => [{ address: '93.184.216.34' }],
        connectImpl: async (o) => {
          servername = o.servername
          return info
        },
      },
    )
    expect(servername).toBe('www.example.com')
  })

  it('обрыв соединения — reachable: false с текстом ошибки', async () => {
    const res = await probeRealityTarget(
      { target: 'www.example.com:443' },
      {
        lookupImpl: async () => [{ address: '93.184.216.34' }],
        connectImpl: async () => {
          throw new Error('Таймаут соединения')
        },
      },
    )
    expect(res.reachable).toBe(false)
    expect(res.error).toBe('Таймаут соединения')
    expect(res.checks).toEqual([])
  })

  it('неразбираемая цель — понятное сообщение, без запроса', async () => {
    const res = await probeRealityTarget({ target: 'example.com:0' })
    expect(res.reachable).toBe(false)
    expect(res.error).toMatch(/адрес цели/i)
  })
})

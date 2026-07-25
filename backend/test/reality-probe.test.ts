import { describe, expect, it } from 'vitest'
import { buildChecks, cdnSuspect, certCovers, type PeerInfo } from '../src/tools/realityProbe.js'

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

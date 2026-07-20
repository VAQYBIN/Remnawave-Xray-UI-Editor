import { describe, expect, it } from 'vitest'
import { derivePublicKey, generateRealityKeypair } from '../src/tools/reality.js'
import { buildServer } from '../src/server.js'
import { makeTestConfig, loginCookie } from './helpers.js'

const B64URL_32 = /^[A-Za-z0-9_-]{43}$/

describe('reality tools', () => {
  it('генерирует пару ключей в base64url без padding', () => {
    const { privateKey, publicKey } = generateRealityKeypair()
    expect(privateKey).toMatch(B64URL_32)
    expect(publicKey).toMatch(B64URL_32)
    expect(privateKey).not.toBe(publicKey)
  })

  it('derivePublicKey восстанавливает публичный ключ из приватного', () => {
    const { privateKey, publicKey } = generateRealityKeypair()
    expect(derivePublicKey(privateKey)).toBe(publicKey)
  })

  it('каждый вызов даёт новую пару', () => {
    expect(generateRealityKeypair().privateKey).not.toBe(generateRealityKeypair().privateKey)
  })

  it('отклоняет ключ неверной длины', () => {
    expect(() => derivePublicKey('AAAA')).toThrow(/32 байта/)
  })
})

describe('reality routes', () => {
  it('POST /api/tools/reality-keypair без сессии → 401', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({ method: 'POST', url: '/api/tools/reality-keypair' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('POST /api/tools/reality-keypair с сессией → 200, оба поля соответствуют B64URL_32', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-keypair',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.privateKey).toMatch(B64URL_32)
    expect(json.publicKey).toMatch(B64URL_32)
    await app.close()
  })

  it('POST /api/tools/reality-public-key с телом { privateKey } от сгенерированной пары → 200, publicKey совпадает', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const { privateKey, publicKey } = generateRealityKeypair()
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-public-key',
      headers: { cookie },
      payload: { privateKey },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().publicKey).toBe(publicKey)
    await app.close()
  })

  it('POST /api/tools/reality-public-key с { privateKey: "AAAA" } → 400', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-public-key',
      headers: { cookie },
      payload: { privateKey: 'AAAA' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

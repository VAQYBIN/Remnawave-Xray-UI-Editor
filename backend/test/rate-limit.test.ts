import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'

describe('глобальный rate-limit', () => {
  it('закрытые ручки отдают заголовки лимита', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['x-ratelimit-limit'])).toBe('600')
    await app.close()
  })

  it('после потолка отвечает 429 с русским текстом', async () => {
    const app = await buildServer(makeTestConfig())
    let last = await app.inject({ method: 'GET', url: '/health' })
    for (let i = 0; i < 700 && last.statusCode !== 429; i += 1) {
      last = await app.inject({ method: 'GET', url: '/health' })
    }
    expect(last.statusCode).toBe(429)
    expect(last.json().message).toMatch(/Слишком много попыток/)
    await app.close()
  })
})

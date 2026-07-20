import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig, loginCookie } from './helpers.js'

describe('auth guard', () => {
  it('без cookie /api/auth/me возвращает 401', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('Требуется вход')
    await app.close()
  })

  it('с cookie /api/auth/me возвращает 200', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ authenticated: true })
    await app.close()
  })

  it('просроченная сессия отклоняется', async () => {
    const app = await buildServer(makeTestConfig({ sessionTtlSeconds: 0 }))
    const cookie = await loginCookie(app)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('/health открыт без сессии', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('логин ограничен по частоте: 6-я попытка — 429', async () => {
    const app = await buildServer(makeTestConfig())
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
      })
      expect(res.statusCode).toBe(401)
    }
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong' },
    })
    expect(res6.statusCode).toBe(429)
    expect(res6.json().message).toContain('Слишком много попыток')
    await app.close()
  })
})

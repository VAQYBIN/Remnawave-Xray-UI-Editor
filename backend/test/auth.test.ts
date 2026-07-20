import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'
import { makeTestConfig, TEST_PASSWORD, loginCookie } from './helpers.js'

describe('auth routes', () => {
  it('логин с верным паролем ставит cookie', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['set-cookie']).toBeDefined()
    expect(String(res.headers['set-cookie'])).toContain('xui_session')
    await app.close()
  })

  it('логин с неверным паролем — 401 по-русски', async () => {
    const app = await buildServer(makeTestConfig())
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('Неверный пароль')
    await app.close()
  })

  it('logout очищает cookie', async () => {
    const app = await buildServer(makeTestConfig())
    const cookie = await loginCookie(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['set-cookie'])).toContain('xui_session=;')
    await app.close()
  })
})

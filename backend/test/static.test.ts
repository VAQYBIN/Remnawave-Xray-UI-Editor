import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildServer } from '../src/server.js'
import { makeTestConfig, loginCookie } from './helpers.js'

const staticDir = join(process.cwd(), 'public')

describe('static serving', () => {
  it('GET / отдаёт index.html', async () => {
    const app = await buildServer(makeTestConfig({ staticDir }))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    await app.close()
  })

  it('неизвестный путь отдаёт index.html (SPA fallback)', async () => {
    const app = await buildServer(makeTestConfig({ staticDir }))
    const res = await app.inject({ method: 'GET', url: '/profiles/some-uuid' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    await app.close()
  })

  it('неизвестный /api-путь отдаёт 404 JSON', async () => {
    const app = await buildServer(makeTestConfig({ staticDir }))
    const cookie = await loginCookie(app)
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: { cookie } })
    expect(res.statusCode).toBe(404)
    expect(res.json().message).toBe('Не найдено')
    await app.close()
  })
})

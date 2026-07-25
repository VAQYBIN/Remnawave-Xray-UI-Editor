import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { GeoService } from '../src/geo/service.js'
import { encodeGeoSiteList } from '../src/geo/dat.js'
import { makeStubRemnawave } from './stub-remnawave.js'
import { loginCookie, makeTestConfig } from './helpers.js'

let app: FastifyInstance
let cookie: string
let dataDir: string

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'xui-geo-routes-'))
  await mkdir(join(dataDir, 'geodata'), { recursive: true })
  await writeFile(
    join(dataDir, 'geodata', 'geosite.dat'),
    encodeGeoSiteList([
      { code: 'GOOGLE', domains: [{ type: 2, value: 'google.com', attributes: [] }] },
    ]),
  )
  app = await buildServer(makeTestConfig({ dataDir }), {
    remnawave: makeStubRemnawave(),
    geo: new GeoService(dataDir),
  })
  cookie = await loginCookie(app)
})

afterEach(async () => {
  await app.close()
})

describe('GET /api/geo', () => {
  it('возвращает состояние баз', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/geo', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { geosite: { present: boolean; categories: number } }
    expect(body.geosite.present).toBe(true)
    expect(body.geosite.categories).toBe(1)
  })

  it('без авторизации — 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/geo' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PUT /api/geo', () => {
  it('сохраняет ссылку', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/geo',
      headers: { cookie },
      payload: { geositeUrl: 'https://example.test/dlc.dat' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { geosite: { url: string } }).geosite.url).toBe(
      'https://example.test/dlc.dat',
    )
  })

  it('нехттп-схема — 400 с русским сообщением', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/geo',
      headers: { cookie },
      payload: { geositeUrl: 'file:///etc/passwd' },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toMatch(/http/i)
  })
})

describe('POST /api/tools/geo/match', () => {
  it('отвечает по домену', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/geo/match',
      headers: { cookie },
      payload: { domain: 'www.google.com', keys: ['geosite:google', 'geosite:nosuch'] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      loaded: boolean
      answers: Record<string, boolean>
      missing: string[]
    }
    expect(body.loaded).toBe(true)
    expect(body.answers['geosite:google']).toBe(true)
    expect(body.missing).toEqual(['geosite:nosuch'])
  })

  it('keys обязателен — 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/geo/match',
      headers: { cookie },
      payload: { domain: 'google.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('пустой список ключей — пустой ответ, а не ошибка', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/geo/match',
      headers: { cookie },
      payload: { domain: 'google.com', keys: [] },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { answers: Record<string, boolean> }).answers).toEqual({})
  })
})

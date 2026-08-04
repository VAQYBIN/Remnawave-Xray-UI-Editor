import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer, type ServerDeps } from '../src/server.js'
import { XrayService } from '../src/xray/service.js'
import { makeProfile, makeStubRemnawave } from './stub-remnawave.js'
import { loginCookie, makeTestConfig } from './helpers.js'

let app: FastifyInstance
let cookie: string

async function start(overrides: ServerDeps = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'xui-xray-routes-'))
  app = await buildServer(makeTestConfig({ dataDir }), {
    remnawave: makeStubRemnawave(),
    ...overrides,
  })
  cookie = await loginCookie(app)
}

afterEach(async () => {
  await app.close()
})

describe('POST /api/tools/xray-test', () => {
  let seen: unknown

  beforeEach(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'xui-xray-stub-'))
    seen = undefined
    const stub = makeStubRemnawave([
      makeProfile({
        uuid: '11111111-1111-4111-8111-111111111111',
        config: {
          inbounds: [
            { tag: 'vless-in', protocol: 'vless', settings: { clients: [{ id: 'panel-user' }] } },
          ],
        },
      }),
    ])
    await start({
      remnawave: stub,
      xray: new XrayService('xray', dataDir, async (_bin, args) => {
        seen = args
        return { code: 0, output: 'Xray 26.7.28\nConfiguration OK.' }
      }),
    })
  })

  it('отдаёт вердикт ядра', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: { config: { inbounds: [], outbounds: [] } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ available: true, ok: true, version: '26.7.28' })
    expect(seen).toBeDefined()
  })

  it('с profileUuid клиент берётся из панели', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: {
        profileUuid: '11111111-1111-4111-8111-111111111111',
        config: {
          inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }],
          outbounds: [],
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().injected).toEqual([{ tag: 'vless-in', source: 'panel' }])
  })

  // Проверка ядром не должна падать вместе с панелью
  it('панель не ответила — откат на фиктивного клиента, а не 5xx', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: {
        profileUuid: '22222222-2222-4222-8222-222222222222',
        config: {
          inbounds: [{ tag: 'vless-in', protocol: 'vless', settings: { clients: [] } }],
          outbounds: [],
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().injected).toEqual([{ tag: 'vless-in', source: 'dummy' }])
  })

  it('без config — 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/xray-test',
      headers: { cookie },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('без авторизации — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tools/xray-test', payload: {} })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/tools/reality-target', () => {
  beforeEach(async () => {
    await start({
      probeReality: async (input) => ({
        target: input.target,
        reachable: true,
        checks: [{ id: 'tls13', level: 'ok', title: 'TLS 1.3' }],
      }),
    })
  })

  it('отдаёт вердикты пробы', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-target',
      headers: { cookie },
      payload: { target: 'www.example.com:443', serverNames: ['www.example.com'] },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { checks: { id: string }[] }).checks[0]!.id).toBe('tls13')
  })

  it('без target — 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-target',
      headers: { cookie },
      payload: { serverNames: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('без авторизации — 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/reality-target',
      payload: { target: 'a.test' },
    })
    expect(res.statusCode).toBe(401)
  })
})

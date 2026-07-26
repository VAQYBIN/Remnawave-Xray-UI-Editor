import { describe, expect, it } from 'vitest'
import {
  RemnawaveClient,
  RemnawaveError,
  describeCause,
  hintForNetworkError,
} from '../src/remnawave/client.js'

interface FakeCall { url: string; init: RequestInit }

function fakeFetch(
  handler: (url: string, init: RequestInit) => { status: number; body?: unknown },
  calls: FakeCall[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    const r = handler(url, init ?? {})
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

const profile = {
  uuid: 'a1b2c3d4-0000-0000-0000-000000000001',
  viewPosition: 0,
  name: 'Germany',
  config: { inbounds: [] },
  inbounds: [],
  nodes: [],
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
}

describe('RemnawaveClient', () => {
  it('listProfiles шлёт Bearer-токен и разворачивает response', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 'tok-123',
      fetchImpl: fakeFetch(
        () => ({ status: 200, body: { response: { total: 1, configProfiles: [profile] } } }),
        calls,
      ),
    })
    const profiles = await client.listProfiles()
    expect(profiles).toEqual([profile])
    expect(calls[0]!.url).toBe('http://panel.test/api/config-profiles')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok-123')
  })

  it('getProfile разворачивает response', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: profile } })),
    })
    expect(await client.getProfile(profile.uuid)).toEqual(profile)
  })

  it('createProfile отправляет POST {name, config}', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 201, body: { response: profile } }), calls),
    })
    await client.createProfile('Germany', { inbounds: [] })
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name: 'Germany',
      config: { inbounds: [] },
    })
  })

  it('updateProfile отправляет PATCH {uuid, config} на /api/config-profiles', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: profile } }), calls),
    })
    await client.updateProfile({ uuid: profile.uuid, config: { inbounds: [] } })
    expect(calls[0]!.url).toBe('http://panel.test/api/config-profiles')
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      uuid: profile.uuid,
      config: { inbounds: [] },
    })
  })

  it('ошибка панели превращается в RemnawaveError с её статусом и сообщением', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 404, body: { message: 'Config profile not found' } })),
    })
    const err = await client.getProfile('missing').catch((e) => e)
    expect(err).toBeInstanceOf(RemnawaveError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Config profile not found')
  })

  it('сетевая ошибка превращается в RemnawaveError 502 по-русски', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED')
      }) as typeof fetch,
    })
    const err = await client.listProfiles().catch((e) => e)
    expect(err).toBeInstanceOf(RemnawaveError)
    expect(err.status).toBe(502)
    expect(err.message).toBe('Панель Remnawave недоступна')
  })

  // fetch в Node на любую сетевую беду отвечает одинаковым «fetch failed»,
  // а настоящая причина лежит в cause. Без разворота диагностика упирается
  // в сообщение, которое не называет ничего.
  it('в details попадает вся цепочка cause, а не только верхняя ошибка', async () => {
    const cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: (async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause })
      }) as typeof fetch,
    })
    const err = await client.listProfiles().catch((e) => e)
    expect(err.details).toBe('fetch failed ← other side closed (UND_ERR_SOCKET)')
  })

  it('цепочка cause не зацикливается и не дублирует одинаковые звенья', async () => {
    const loop: { message: string; cause?: unknown } = { message: 'зациклено' }
    loop.cause = loop
    expect(describeCause(loop)).toBe('зациклено')
    expect(describeCause('строка вместо ошибки')).toBe('строка вместо ошибки')
  })

  // Панель Remnawave отвечает только через свой reverse proxy: на прямое
  // обращение к контейнеру она молча рвёт соединение. Симптом сам по себе на
  // решение не наводит — подсказка называет его.
  it('подсказывает про внутренний адрес, когда панель молча рвёт соединение', () => {
    const cause = 'fetch failed ← other side closed (UND_ERR_SOCKET)'
    expect(hintForNetworkError('http://remnawave:3000', cause)).toMatch(/публичный https-адрес/)
    // По https подсказка неуместна: адрес уже правильный, причина другая
    expect(hintForNetworkError('https://panel.example.com', cause)).toBeUndefined()
    // И на другие сетевые беды тоже — они лечатся иначе
    expect(hintForNetworkError('http://remnawave:3000', 'getaddrinfo ENOTFOUND')).toBeUndefined()
  })

  it('подсказка доезжает до RemnawaveError', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://remnawave:3000',
      token: 't',
      fetchImpl: (async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
        })
      }) as typeof fetch,
    })
    const err = await client.listProfiles().catch((e) => e)
    expect(err.hint).toMatch(/reverse proxy/)
  })

  it('getSquads разворачивает internalSquads, getNodes — массив response', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith('/api/nodes')) return { status: 200, body: { response: [{ uuid: 'n1' }] } }
        return { status: 200, body: { response: { total: 1, internalSquads: [{ uuid: 's1' }] } } }
      }),
    })
    expect(await client.getNodes()).toEqual([{ uuid: 'n1' }])
    expect(await client.getSquads()).toEqual([{ uuid: 's1' }])
  })

  it('getProfileInbounds разворачивает inbounds с activeSquads', async () => {
    const inbound = { uuid: 'i1', profileUuid: 'p1', tag: 'vless-in', type: 'vless', network: 'tcp', security: 'reality', port: 443, rawInbound: {}, activeSquads: ['s1'] }
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch((url) => {
        expect(url).toBe('http://panel.test/api/config-profiles/p1/inbounds')
        return { status: 200, body: { response: { total: 1, inbounds: [inbound] } } }
      }),
    })
    expect(await client.getProfileInbounds('p1')).toEqual([inbound])
  })
})

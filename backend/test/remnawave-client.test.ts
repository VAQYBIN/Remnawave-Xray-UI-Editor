import { describe, expect, it } from 'vitest'
import {
  RemnawaveClient,
  RemnawaveError,
  describeCause,
  describePanelError,
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
    // 204 не может нести тело — конструктор Response отвергает даже пустую строку
    const body = r.body === undefined ? null : JSON.stringify(r.body)
    return new Response(body, {
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

  // 401/403 от панели нельзя пропускать наружу как есть: тот же статус фронтенд
  // трактует как «сессия редактора истекла» и уводит на /login, где вход ничего
  // не чинит. Причина вышестоящая — значит 502, как и для недоступной панели.
  it('401 от панели превращается в 502 с подсказкой про токен', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 'протухший',
      fetchImpl: fakeFetch(() => ({ status: 401, body: { message: 'Unauthorized' } })),
    })
    const err = await client.listProfiles().catch((e) => e)
    expect(err).toBeInstanceOf(RemnawaveError)
    expect(err.status).toBe(502)
    expect(err.message).toBe('Панель Remnawave отклонила токен')
    expect(err.hint).toMatch(/REMNAWAVE_TOKEN/)
  })

  it('403 от панели обрабатывается так же, как 401', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 'без прав',
      fetchImpl: fakeFetch(() => ({ status: 403, body: { message: 'Forbidden' } })),
    })
    const err = await client.getNodes().catch((e) => e)
    expect(err.status).toBe(502)
    expect(err.message).toBe('Панель Remnawave отклонила токен')
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

  // v3.0.0 отвечает на DELETE 204 без тела, 2.8.x — 200 с {response:{isDeleted}}.
  // Метод обязан пережить оба: редактор поддерживает обе версии панели.
  it('deleteProfile переживает и 204 без тела, и 200 с телом', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 204 }), calls),
    })
    await expect(client.deleteProfile(profile.uuid)).resolves.toBeUndefined()
    expect(calls[0]!.url).toBe(`http://panel.test/api/config-profiles/${profile.uuid}`)
    expect(calls[0]!.init.method).toBe('DELETE')

    const old = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({ status: 200, body: { response: { isDeleted: true } } })),
    })
    await expect(old.deleteProfile(profile.uuid)).resolves.toBeUndefined()
  })

  it('getComputedConfig отдаёт config профиля, вычисленный панелью', async () => {
    const calls: FakeCall[] = []
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(
        () => ({
          status: 200,
          body: { response: { ...profile, config: { inbounds: [{ tag: 'vless-in' }] } } },
        }),
        calls,
      ),
    })
    expect(await client.getComputedConfig('p1')).toEqual({ inbounds: [{ tag: 'vless-in' }] })
    expect(calls[0]!.url).toBe('http://panel.test/api/config-profiles/p1/computed-config')
  })

  // Панель v3 валидирует конфиг сама и кладёт разбор в errors[]. Верхнеуровневый
  // message при этом ничего не называет — без разбора пользователь не поймёт, где чинить.
  it('валидационная ошибка панели разворачивается в перечень полей', async () => {
    const client = new RemnawaveClient({
      baseUrl: 'http://panel.test',
      token: 't',
      fetchImpl: fakeFetch(() => ({
        status: 400,
        body: {
          message: 'Validation failed',
          statusCode: 400,
          errors: [
            { validation: 'array', code: 'too_small', message: 'Outbounds cannot be empty', path: ['config', 'outbounds'] },
            { validation: 'string', code: 'invalid_string', message: 'Invalid key', path: ['config', 'inbounds', '0', 'settings', 'password'] },
          ],
        },
      })),
    })
    const err = await client.updateProfile({ uuid: 'p1', config: {} }).catch((e) => e)
    expect(err.status).toBe(400)
    expect(err.message).toBe(
      'config.outbounds — Outbounds cannot be empty; config.inbounds.0.settings.password — Invalid key',
    )
  })

  it('describePanelError без errors[] отдаёт message, а на мусоре — undefined', () => {
    expect(describePanelError({ message: 'Config profile not found' })).toBe('Config profile not found')
    expect(describePanelError({ message: 'Validation failed', errors: [] })).toBe('Validation failed')
    expect(describePanelError({ errors: 'не массив' })).toBeUndefined()
    expect(describePanelError(undefined)).toBeUndefined()
    expect(describePanelError('строка')).toBeUndefined()
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

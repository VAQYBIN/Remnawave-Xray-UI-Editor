import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildServer, type ServerDeps } from '../src/server.js'
import { registerWarpAccount } from '../src/tools/warp.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave } from './stub-remnawave.js'

const REG_RESPONSE = {
  id: 'reg-1',
  token: 'tok-1',
  config: {
    client_id: 'M0Rj', // 3 байта после base64-декодирования
    peers: [
      {
        public_key: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
        endpoint: { host: 'engage.cloudflareclient.com:2408' },
      },
    ],
    interface: { addresses: { v4: '172.16.0.2', v6: '2606:4700:110::1' } },
  },
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const publicLookup = async () => [{ address: '104.16.0.1' }]

describe('registerWarpAccount', () => {
  it('регистрирует аккаунт, включает WARP и приводит ответ к настройкам wireguard', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return okJson(REG_RESPONSE)
    }) as unknown as typeof fetch

    const account = await registerWarpAccount({ fetchImpl, lookupImpl: publicLookup })

    expect(calls[0]!.url).toBe('https://api.cloudflareclient.com/v0a2158/reg')
    expect(calls[0]!.init!.method).toBe('POST')
    // base64 с padding, а не base64url как у Reality
    expect(JSON.parse(String(calls[0]!.init!.body)).key).toMatch(/=$/)
    expect(calls[1]!.url).toBe('https://api.cloudflareclient.com/v0a2158/reg/reg-1')
    expect(calls[1]!.init!.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ warp_enabled: true })

    expect(account.address).toEqual(['172.16.0.2/32', '2606:4700:110::1/128'])
    expect(account.reserved).toEqual([51, 68, 99])
    expect(account.peer.endpoint).toBe('engage.cloudflareclient.com:2408')
    expect(account.secretKey).toHaveLength(44) // 32 байта в base64 с padding
  })

  it('нестатусный ответ регистрации превращается в понятную ошибку', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    await expect(registerWarpAccount({ fetchImpl, lookupImpl: publicLookup })).rejects.toThrow(
      /Cloudflare/i,
    )
  })

  it('неожиданная форма JSON тоже даёт ошибку, а не падение', async () => {
    const fetchImpl = vi.fn(async () => okJson({ id: 'x' })) as unknown as typeof fetch
    await expect(registerWarpAccount({ fetchImpl, lookupImpl: publicLookup })).rejects.toThrow(/ответ/i)
  })

  it('неудачный PATCH не выдаёт наполовину рабочий аккаунт', async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      return call === 1 ? okJson(REG_RESPONSE) : new Response('no', { status: 403 })
    }) as unknown as typeof fetch
    await expect(registerWarpAccount({ fetchImpl, lookupImpl: publicLookup })).rejects.toThrow(/WARP/i)
  })
})

async function startWith(deps: ServerDeps) {
  const dataDir = mkdtempSync(join(tmpdir(), 'xui-warp-routes-'))
  const app = await buildServer(makeTestConfig({ dataDir }), {
    remnawave: makeStubRemnawave(),
    ...deps,
  })
  return { app, cookie: await loginCookie(app) }
}

describe('POST /api/tools/warp-account', () => {
  it('отдаёт аккаунт при успехе', async () => {
    const account = {
      secretKey: 'k',
      address: ['172.16.0.2/32'],
      reserved: [1, 2, 3],
      peer: { publicKey: 'p', endpoint: 'e:2408' },
    }
    const { app, cookie } = await startWith({ registerWarp: async () => account })
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/warp-account',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(account)
    await app.close()
  })

  it('отказ Cloudflare превращается в 502 с подсказкой про ручной ввод', async () => {
    const { app, cookie } = await startWith({
      registerWarp: async () => {
        throw new Error('таймаут')
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/warp-account',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().message).toMatch(/вручную/)
    await app.close()
  })
})

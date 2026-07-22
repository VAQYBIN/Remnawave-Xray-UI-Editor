import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ApiError, AuthError, ConflictError, useProfileInbounds, useSquads } from '../src/shared/api'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch', () => {
  it('возвращает JSON и передаёт credentials', async () => {
    const fn = mockFetch(200, { profiles: [] })
    const res = await apiFetch<{ profiles: unknown[] }>('/api/profiles')
    expect(res.profiles).toEqual([])
    expect(fn.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
  })

  it('не шлёт content-type без тела — fastify отвергает пустой JSON (logout)', async () => {
    const fn = mockFetch(200, { ok: true })
    await apiFetch('/api/auth/logout', { method: 'POST' })
    const headers = (fn.mock.calls[0]![1]!.headers ?? {}) as Record<string, string>
    expect('content-type' in headers).toBe(false)
  })

  it('шлёт content-type при наличии тела', async () => {
    const fn = mockFetch(200, { ok: true })
    await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) })
    const headers = (fn.mock.calls[0]![1]!.headers ?? {}) as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
  })

  it('401 → AuthError с сообщением сервера', async () => {
    mockFetch(401, { message: 'Требуется вход' })
    const err = (await apiFetch('/api/profiles').catch((e) => e)) as AuthError
    expect(err).toBeInstanceOf(AuthError)
    expect(err.message).toBe('Требуется вход')
  })

  it('409 → ConflictError с current', async () => {
    const current = { uuid: 'u1', name: 'P', updatedAt: 'T' }
    mockFetch(409, { message: 'Профиль был изменён в панели после открытия', current })
    const err = (await apiFetch('/api/profiles/u1', { method: 'PATCH' }).catch((e) => e)) as ConflictError
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.current.uuid).toBe('u1')
  })

  it('500 → ApiError; сетевые сбои → ApiError со status 0 и русским текстом', async () => {
    mockFetch(500, { message: 'Внутренняя ошибка' })
    const err = (await apiFetch('/api/profiles').catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed') }))
    const err2 = (await apiFetch('/api/profiles').catch((e) => e)) as ApiError
    expect(err2).toBeInstanceOf(ApiError)
    expect(err2.status).toBe(0)
    expect(err2.message).toBe('Сервер недоступен')
  })
})

describe('api hooks', () => {
  it('экспортирует хуки контекста панели', () => {
    expect(typeof useSquads).toBe('function')
    expect(typeof useProfileInbounds).toBe('function')
  })
})

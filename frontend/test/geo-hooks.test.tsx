import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGeoCategories, useGeoCategory, useGeoMatch } from '../src/shared/api'

function mockFetch(body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function withClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useGeoMatch', () => {
  it('не запрашивает без ключей', () => {
    const fn = mockFetch({})
    const { result } = renderHook(() => useGeoMatch({ domain: 'a.com', keys: [] }), {
      wrapper: withClient(),
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(fn).not.toHaveBeenCalled()
  })

  it('не запрашивает при null', () => {
    const fn = mockFetch({})
    renderHook(() => useGeoMatch(null), { wrapper: withClient() })
    expect(fn).not.toHaveBeenCalled()
  })

  it('запрашивает и возвращает ответы', async () => {
    mockFetch({ loaded: true, answers: { 'geosite:google': true }, missing: [] })
    const { result } = renderHook(
      () => useGeoMatch({ domain: 'google.com', keys: ['geosite:google'] }),
      { wrapper: withClient() },
    )
    await waitFor(() => expect(result.current.data?.answers['geosite:google']).toBe(true))
  })
})

describe('useGeoCategories и useGeoCategory', () => {
  it('список категорий приходит распакованным', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ categories: [{ code: 'GOOGLE', count: 2 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useGeoCategories('geosite'), { wrapper: withClient() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual([{ code: 'GOOGLE', count: 2 }])
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/geo/geosite/categories')
  })

  it('страница категории запрашивается с q, offset и limit; без кода запрос не уходит', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'GOOGLE', total: 1, offset: 0, domains: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const idle = renderHook(() => useGeoCategory('geosite', null, { q: '', offset: 0 }), {
      wrapper: withClient(),
    })
    expect(idle.result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()

    const { result } = renderHook(
      () => useGeoCategory('geosite', 'GOOGLE', { q: 'api', offset: 200 }),
      { wrapper: withClient() },
    )
    await waitFor(() => expect(result.current.data).toBeDefined())
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('/api/geo/geosite/categories/GOOGLE')
    expect(url).toContain('q=api')
    expect(url).toContain('offset=200')
    expect(url).toContain('limit=200')
  })
})

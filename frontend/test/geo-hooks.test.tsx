import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGeoMatch } from '../src/shared/api'

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

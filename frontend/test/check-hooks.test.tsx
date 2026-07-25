import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRealityProbe, useXrayTest } from '../src/shared/api'

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

describe('useXrayTest', () => {
  it('отправляет конфиг в теле запроса', async () => {
    const fn = mockFetch({ available: true, ok: true, errors: [], injected: [] })
    const { result } = renderHook(() => useXrayTest(), { wrapper: withClient() })
    result.current.mutate({ outbounds: [] })
    await waitFor(() => expect(result.current.data?.ok).toBe(true))
    const [, init] = fn.mock.calls[0]! as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ config: { outbounds: [] } })
  })
})

describe('useRealityProbe', () => {
  it('возвращает вердикты', async () => {
    mockFetch({
      target: 'a.test:443',
      reachable: true,
      checks: [{ id: 'tls13', level: 'ok', title: 'TLS 1.3' }],
    })
    const { result } = renderHook(() => useRealityProbe(), { wrapper: withClient() })
    result.current.mutate({ target: 'a.test:443', serverNames: [] })
    await waitFor(() => expect(result.current.data?.checks[0]?.level).toBe('ok'))
  })
})

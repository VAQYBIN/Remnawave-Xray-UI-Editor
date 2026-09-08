import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useRefreshRuleSets,
  useRuleSetPage,
  useRuleSetStatus,
  type RuleSetQuery,
} from '../src/shared/api'

const SET: RuleSetQuery = {
  name: 'ads',
  kind: 'http',
  url: 'https://example.com/ads.mrs',
  behavior: 'domain',
  format: 'mrs',
}

function mockFetch(body: unknown) {
  const fn = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useRuleSetStatus', () => {
  it('без наборов запрос не идёт', () => {
    const fn = mockFetch({ items: [] })
    renderHook(() => useRuleSetStatus([]), { wrapper: wrapperFor(makeClient()) })
    expect(fn).not.toHaveBeenCalled()
  })

  it('возвращает состояние по каждому набору', async () => {
    mockFetch({ items: [{ name: 'ads', state: 'ready', count: 12, loadedAt: 1_700_000_000_000 }] })
    const { result } = renderHook(() => useRuleSetStatus([SET]), {
      wrapper: wrapperFor(makeClient()),
    })
    await waitFor(() => expect(result.current.data?.[0]).toMatchObject({ state: 'ready', count: 12 }))
  })
})

describe('useRefreshRuleSets', () => {
  it('шлёт названные наборы и после успеха просит пересчитать трассировку', async () => {
    const fn = mockFetch({ items: [{ name: 'ads', state: 'ready', count: 12 }] })
    const client = makeClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRefreshRuleSets(), { wrapper: wrapperFor(client) })

    await result.current.mutateAsync({ sets: [SET], names: ['ads'] })

    const body = JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.names).toEqual(['ads'])
    // Вердикты посчитаны по прежнему содержимому набора: не пересчитать их
    // значило бы показывать старый маршрут по новому файлу
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ruleset-match'] })
  })
})

describe('useRuleSetPage', () => {
  it('без набора запрос не идёт', () => {
    const fn = mockFetch({ total: 0, offset: 0, count: 0, items: [] })
    renderHook(() => useRuleSetPage(null, { offset: 0, limit: 200, q: '' }), {
      wrapper: wrapperFor(makeClient()),
    })
    expect(fn).not.toHaveBeenCalled()
  })

  it('передаёт страницу и поиск', async () => {
    const fn = mockFetch({ total: 4, offset: 2, count: 2, items: ['a.com'] })
    const { result } = renderHook(
      () => useRuleSetPage(SET, { offset: 2, limit: 200, q: 'a.c' }),
      { wrapper: wrapperFor(makeClient()) },
    )
    await waitFor(() => expect(result.current.data?.items).toEqual(['a.com']))
    const body = JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toMatchObject({ offset: 2, limit: 200, q: 'a.c' })
    expect(body.descriptor.name).toBe('ads')
  })
})

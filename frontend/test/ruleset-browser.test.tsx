import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RuleSetBrowser } from '../src/features/diagnostics/RuleSetBrowser'
import type { RuleSetQuery } from '../src/shared/api'

const SET: RuleSetQuery = {
  name: 'ads',
  kind: 'http',
  url: 'https://example.com/ads.mrs',
  behavior: 'domain',
  format: 'mrs',
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

let bodies: Record<string, unknown>[] = []
let reply: () => Response

beforeEach(() => {
  qc.clear()
  bodies = []
  reply = () =>
    new Response(
      JSON.stringify({
        total: 4,
        offset: 0,
        count: 2,
        items: ['faceit.com', '+.faceit.com', 'faceit-cdn.net', '+.faceit-cdn.net'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return reply()
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('просмотрщик содержимого набора', () => {
  it('показывает записи и объясняет расхождение с числом в заголовке', async () => {
    render(<RuleSetBrowser descriptor={SET} onBack={() => {}} />, { wrapper })
    await waitFor(() => expect(screen.getByText('faceit.com')).toBeInTheDocument())
    expect(screen.getByText('+.faceit-cdn.net')).toBeInTheDocument()
    // Оба числа названы: 4 строки против 2 записей — это не ошибка декодера
    expect(screen.getByText(/из 4/)).toBeInTheDocument()
    expect(screen.getByText(/в заголовке набора: 2/)).toBeInTheDocument()
  })

  it('у подсетей расхождение чисел объясняется так же, как у доменов', async () => {
    // Один диапазон распадается на несколько CIDR — числа расходятся и здесь.
    // Прежде подпись показывалась только при behavior: 'domain', и у набора
    // подсетей диалог показывал одно число, просмотрщик другое, без объяснения
    reply = () =>
      new Response(JSON.stringify({ total: 3, offset: 0, count: 1, items: ['10.0.0.1/32'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    render(<RuleSetBrowser descriptor={{ ...SET, behavior: 'ipcidr' }} onBack={() => {}} />, {
      wrapper,
    })
    expect(await screen.findByText(/в заголовке набора: 1/)).toBeInTheDocument()
  })

  it('когда числа совпадают, подписи нет: объяснять нечего', async () => {
    reply = () =>
      new Response(JSON.stringify({ total: 2, offset: 0, count: 2, items: ['a.com', 'b.com'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    render(<RuleSetBrowser descriptor={SET} onBack={() => {}} />, { wrapper })
    await screen.findByText('a.com')
    expect(screen.queryByText(/в заголовке набора/)).toBeNull()
  })

  it('поиск уходит на сервер и сбрасывает страницу', async () => {
    // total намного больше страницы: «Вперёд» должна быть доступна, иначе
    // offset никогда не отойдёт от 0 и сброс поиском нечем будет подтвердить
    reply = () =>
      new Response(
        JSON.stringify({
          total: 500,
          offset: 0,
          count: 2,
          items: ['faceit.com', '+.faceit.com', 'faceit-cdn.net', '+.faceit-cdn.net'],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    render(<RuleSetBrowser descriptor={SET} onBack={() => {}} />, { wrapper })
    await waitFor(() => expect(screen.getByText('faceit.com')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Вперёд →' }))
    await waitFor(() => expect(bodies.at(-1)?.offset).toBe(200))

    await userEvent.type(screen.getByLabelText('Поиск по набору'), 'cdn')
    await waitFor(() => expect(bodies.at(-1)?.q).toBe('cdn'), { timeout: 3000 })
    expect(bodies.at(-1)?.offset).toBe(0)
  })

  it('отказ показывается строкой, а не пустым списком', async () => {
    reply = () =>
      new Response(JSON.stringify({ message: 'не удалось скачать: 404' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    render(<RuleSetBrowser descriptor={SET} onBack={() => {}} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/404/)).toBeInTheDocument())
    // Отказ не смеет выглядеть как пустой набор: «Ничего не найдено» рядом с
    // причиной — это два взаимоисключающих утверждения об одном и том же
    expect(screen.queryByText(/Ничего не найдено/)).toBeNull()
  })

  it('без выбранного набора запроса нет', () => {
    render(<RuleSetBrowser descriptor={null} onBack={() => {}} />, { wrapper })
    expect(bodies).toEqual([])
    expect(screen.getByText(/Выберите набор/)).toBeInTheDocument()
  })
})

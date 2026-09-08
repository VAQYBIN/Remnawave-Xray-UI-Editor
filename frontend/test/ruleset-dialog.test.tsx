import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RuleSetsDialog } from '../src/features/diagnostics/RuleSetsDialog'
import type { RuleSetDescriptor } from '../src/entities/mihomo/ruleSets'
import type { RuleSetQuery } from '../src/shared/api'

const SETS: RuleSetDescriptor[] = [
  {
    name: 'ads',
    kind: 'http',
    url: 'https://example.com/ads.mrs',
    behavior: 'domain',
    format: 'mrs',
  },
  { name: 'local', kind: 'file' },
  { name: 'weird', kind: 'unsupported', reason: 'вид набора «чепуха» редактору незнаком' },
]
const ASKED: RuleSetQuery[] = [
  { name: 'ads', kind: 'http', url: 'https://example.com/ads.mrs', behavior: 'domain', format: 'mrs' },
]

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

let bodies: { url: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  qc.clear()
  bodies = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      bodies.push({
        url,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      // Просмотрщик содержимого спрашивает отдельную ручку — ответ по её форме,
      // а не по форме состояния, иначе рендер набора упал бы на объекте вместо строки
      if (url.includes('/page')) {
        return new Response(
          JSON.stringify({ total: 0, offset: 0, count: 0, items: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              name: 'ads',
              state: 'ready',
              count: 15_511,
              bytes: 485_000,
              loadedAt: Date.now() - 5 * 60 * 1000,
              stale: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('диалог «Наборы правил»', () => {
  it('показывает состояние сетевого набора', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/загружен/)).toBeInTheDocument())
    expect(screen.getByText('15 511')).toBeInTheDocument()
  })

  it('набор из файла и незнакомый вид показаны со своей причиной, а не спрятаны', async () => {
    // Отсутствие строки читалось бы как «этого набора в документе нет»
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText(/в файле у клиента/)).toBeInTheDocument()
    expect(screen.getByText(/«чепуха»/)).toBeInTheDocument()
  })

  it('«Обновить» шлёт имя одного набора, «Обновить все» — ни одного', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/загружен/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Обновить набор ads' }))
    await waitFor(() =>
      expect(bodies.some((b) => b.url.includes('refresh') && b.body.names !== undefined)).toBe(true),
    )
    expect(bodies.find((b) => b.url.includes('refresh'))!.body.names).toEqual(['ads'])

    await userEvent.click(screen.getByRole('button', { name: 'Обновить все' }))
    await waitFor(() =>
      expect(bodies.filter((b) => b.url.includes('refresh'))).toHaveLength(2),
    )
    expect(bodies.filter((b) => b.url.includes('refresh')).at(-1)!.body.names).toBeUndefined()
  })

  it('у набора из файла кнопки обновления нет: обновлять нечего', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(screen.queryByRole('button', { name: 'Обновить набор local' })).toBeNull()
  })

  it('пустой документ говорит об этом прямо', () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={[]} asked={[]} />, { wrapper })
    expect(screen.getByText(/нет наборов правил/)).toBeInTheDocument()
  })

  it('закрытый диалог не запрашивает состояние', () => {
    render(<RuleSetsDialog open={false} onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(bodies).toEqual([])
  })

  it('клик по имени сетевого набора открывает содержимое', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    await waitFor(() => expect(screen.getByText(/загружен/)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'ads' }))
    expect(screen.getByLabelText('Поиск по набору')).toBeInTheDocument()
  })

  it('имя набора из файла кнопкой не становится: смотреть нечего', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(screen.queryByRole('button', { name: 'local' })).toBeNull()
  })
})

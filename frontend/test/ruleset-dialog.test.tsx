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
/** Состояние, которым отвечает подменённый сервер; тест меняет его под свой случай */
let statusItems: Record<string, unknown>[] = []
/** Запрос состояния отказывает: у хука retry: false, ждать после этого нечего */
let statusFails = false

beforeEach(() => {
  qc.clear()
  bodies = []
  statusFails = false
  statusItems = [
    {
      name: 'ads',
      state: 'ready',
      count: 15_511,
      bytes: 485_000,
      loadedAt: Date.now() - 5 * 60 * 1000,
      stale: false,
    },
  ]
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
      if (statusFails && url.includes('/status')) {
        return new Response(JSON.stringify({ message: 'сервер недоступен' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ items: statusItems }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
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

  it('причина отказа доезжает до строки набора, а не подменяется общей', async () => {
    // Причина едет через сервис, роут, типы и хук — и терялась в последней
    // точке, где её никто не проверял: подмена `item.reason` на «не читается»
    // не роняла ни одного теста
    statusItems = [{ name: 'ads', state: 'error', reason: 'не удалось скачать: 404' }]
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(await screen.findByText(/не удалось скачать: 404/)).toBeInTheDocument()
  })

  it('просрочка названа: файл на месте, но будет перекачан', async () => {
    statusItems = [
      { name: 'ads', state: 'ready', count: 12, loadedAt: Date.now() - 90_000, stale: true },
    ]
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(await screen.findByText(/срок вышел/)).toBeInTheDocument()
  })

  it('незагруженный набор назван незагруженным', async () => {
    statusItems = [{ name: 'ads', state: 'missing' }]
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(await screen.findByText('ещё не загружен')).toBeInTheDocument()
  })

  it('сбой запроса состояния не выдаёт себя за ожидание', async () => {
    // «Состояние ещё не пришло» — обещание, а у хука retry: false, ждать
    // нечего. Рядом уже стоит красная строка с причиной: два ответа на один
    // вопрос в одном экране
    statusFails = true
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    expect(await screen.findByText('состояние не получено')).toBeInTheDocument()
    expect(screen.queryByText(/состояние ещё не пришло/)).toBeNull()
  })

  it('у встроенного набора кнопки обновления нет: содержимое в документе', async () => {
    const inline = [
      { name: 'own', kind: 'inline' as const, payload: ['+.a.com'], behavior: 'domain' as const, format: 'yaml' as const },
    ]
    render(<RuleSetsDialog open onClose={() => {}} sets={inline} asked={inline} />, { wrapper })
    expect(screen.queryByRole('button', { name: 'Обновить набор own' })).toBeNull()
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

  it('имя недостижимого набора кнопкой не становится: смотреть нечего', async () => {
    render(<RuleSetsDialog open onClose={() => {}} sets={SETS} asked={ASKED} />, { wrapper })
    // Оба недостижимых вида, а не один: у набора из файла содержимого нет у
    // сервера, у незнакомого вида его нет и у нас — открывать нечего в обоих
    expect(screen.queryByRole('button', { name: 'local' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'weird' })).toBeNull()
  })
})

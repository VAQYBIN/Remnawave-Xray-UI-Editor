import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { MihomoEditorPage } from '../src/features/templates/MihomoEditorPage'
import { mihomoFixture } from './helpers'
import { useDraftStore } from '../src/features/editor/draftStore'

const YAML = mihomoFixture('roscomvpn')
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** Сервер отвечает состоянием на каждый спрошенный набор — как настоящий */
function statusFor(body: { sets: { name: string }[] }) {
  return {
    items: body.sets.map((s) => ({
      name: s.name,
      state: 'ready',
      count: 128,
      bytes: 4096,
      loadedAt: Date.now() - 60_000,
      stale: false,
    })),
  }
}

beforeEach(() => {
  useDraftStore.setState({ drafts: {} })
  qc.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { sets: { name: string }[] }
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (url.includes('/ruleset/status')) return json(statusFor(body))
      if (url.includes('/ruleset/match')) return json({ answers: {} })
      if (url.includes('/geo/match')) return json({ loaded: false, answers: {}, missing: [] })
      throw new Error(`Неожиданный запрос: ${url}`)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('приёмка плана 2 на эталонном шаблоне', () => {
  it(
    'диалог показывает ВСЕ наборы документа, ни один не спрятан',
    async () => {
      render(
        <MemoryRouter>
          <MihomoEditorPage
            template={{
              uuid: 'u',
              name: 'RoscomVPN',
              templateType: 'MIHOMO',
              encodedTemplateYaml: btoa(unescape(encodeURIComponent(YAML))),
            } as never}
            hash="h"
          />
        </MemoryRouter>,
        { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> },
      )

      await userEvent.click(screen.getByRole('button', { name: 'Наборы правил' }))
      // И у диалога, и у списка внутри него — одинаковый aria-label «Наборы
      // правил» (у диалога он от заголовка); список отличаем по роли `list`,
      // иначе findByLabelText упал бы на неоднозначности из двух совпадений
      const list = await screen.findByRole('list', { name: 'Наборы правил' })
      // Двадцать шесть провайдеров эталонного шаблона — ровно столько строк
      await waitFor(() => expect(list.querySelectorAll('.rs-row')).toHaveLength(26))
    },
    // Таймаут увеличен против дефолтных 5000 мс: тест рендерит полный
    // редактор (граф + инспектор + диалог) на самом крупном фикстурном
    // документе — 465 строк YAML, 26 наборов, 31 правило. В одиночном
    // прогоне укладывается в секунду, но под полным `npm test` (128 файлов
    // конкурируют за CPU) реальное время тяжёлых рендер-тестов растягивается
    // заметно сильнее лёгких — это конкуренция за процессор, а не порча
    // теста; без запаса тест мигал бы красным только от соседства с другими
    // файлами.
    20_000,
  )
})

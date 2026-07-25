import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeoDataDialog } from '../src/features/diagnostics/GeoDataDialog'

const STATUS = {
  geosite: {
    url: 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat',
    present: true,
    loadedAt: '2026-07-24T10:00:00.000Z',
    sizeBytes: 1234567,
    categories: 1200,
  },
  geoip: {
    url: 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat',
    present: false,
  },
}

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// Тот же приём, что в api-client.test.ts: stubGlobal + unstubAllGlobals
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(STATUS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('GeoDataDialog', () => {
  it('показывает состояние загруженной базы и отсутствие второй', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/категорий: 1200/i)).toBeInTheDocument())
    expect(screen.getByText(/не загружена/i)).toBeInTheDocument()
  })

  it('кнопка загрузки дергает /api/geo/update', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/категорий: 1200/i)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /загрузить/i }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/geo/update'))).toBe(true),
    )
  })

  it('пресет подставляет ссылку Loyalsoldier в поле geosite', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Ссылка на geosite')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /loyalsoldier/i }))
    expect(screen.getByLabelText('Ссылка на geosite')).toHaveValue(
      'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
    )
  })

  it('предупреждает, что базы должны совпадать с нодами', async () => {
    wrap(<GeoDataDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/на нодах/i)).toBeInTheDocument())
  })
})

describe('GeoDataDialog — вкладки', () => {
  it('вкладка «Просмотр» показывает категории, «Источники» — ссылки', async () => {
    const viewerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/categories')) {
        return new Response(JSON.stringify({ categories: [{ code: 'GOOGLE', count: 2 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(STATUS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', viewerFetch)

    wrap(<GeoDataDialog open onClose={() => {}} />)
    expect(screen.getByLabelText('Ссылка на geosite')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Просмотр' }))
    expect(await screen.findByRole('button', { name: /GOOGLE/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Ссылка на geosite')).not.toBeInTheDocument()
  })

  it('закрытый диалог не рендерит содержимое вкладок', () => {
    wrap(<GeoDataDialog open={false} onClose={() => {}} />)
    // Иначе поля диалога перехватывают поиск по подписям на всей странице
    expect(screen.queryByLabelText('Ссылка на geosite')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Просмотр' })).not.toBeInTheDocument()
  })
})

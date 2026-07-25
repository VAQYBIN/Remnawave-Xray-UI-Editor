import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GeoBrowser } from '../src/features/diagnostics/GeoBrowser'

afterEach(() => vi.unstubAllGlobals())

const CATEGORIES = {
  categories: [
    { code: 'GOOGLE', count: 2 },
    { code: 'NETFLIX', count: 1 },
  ],
}

const PAGE = {
  code: 'GOOGLE',
  total: 2,
  offset: 0,
  domains: [
    { type: 'domain', value: 'google.com', attributes: [] },
    { type: 'full', value: 'api.google.com', attributes: ['cn'] },
  ],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderBrowser(handler: (url: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)))
  vi.stubGlobal('fetch', fetchMock)
  const onUseKey = vi.fn<(key: string) => void>()
  const onOpenSources = vi.fn<() => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <GeoBrowser onUseKey={onUseKey} onOpenSources={onOpenSources} />
    </QueryClientProvider>,
  )
  return { onUseKey, onOpenSources, fetchMock }
}

const okHandler = (url: string) => {
  if (url.includes('/categories/')) return json(PAGE)
  if (url.includes('/categories')) return json(CATEGORIES)
  throw new Error(`неожиданный запрос: ${url}`)
}

describe('GeoBrowser', () => {
  it('показывает категории со счётчиками и содержимое выбранной', async () => {
    renderBrowser(okHandler)

    const category = await screen.findByRole('button', { name: /GOOGLE/ })
    expect(category).toHaveTextContent('2')
    await userEvent.click(category)

    expect(await screen.findByText('google.com')).toBeInTheDocument()
    expect(screen.getByText('api.google.com')).toBeInTheDocument()
    // Тип и атрибут домена видны: keyword и full матчатся совершенно по-разному
    expect(screen.getByText('full')).toBeInTheDocument()
    expect(screen.getByText('@cn')).toBeInTheDocument()
  })

  it('фильтр категорий сужает список', async () => {
    renderBrowser(okHandler)
    await screen.findByRole('button', { name: /GOOGLE/ })

    await userEvent.type(screen.getByLabelText('Поиск категории'), 'net')
    expect(screen.queryByRole('button', { name: /GOOGLE/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /NETFLIX/ })).toBeInTheDocument()
  })

  it('«В правило» отдаёт ключ в нижнем регистре', async () => {
    const { onUseKey } = renderBrowser(okHandler)
    await userEvent.click(await screen.findByRole('button', { name: /GOOGLE/ }))

    await userEvent.click(await screen.findByRole('button', { name: 'В правило' }))
    expect(onUseKey).toHaveBeenCalledWith('geosite:google')
  })

  it('незагруженная база объясняется и ведёт к источникам', async () => {
    const { onOpenSources } = renderBrowser(() => json({ message: 'База geosite не загружена' }, 404))

    await userEvent.click(await screen.findByRole('button', { name: 'К источникам' }))
    expect(onOpenSources).toHaveBeenCalled()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplatesPage } from '../src/features/templates/TemplatesPage'

const TEMPLATES = [
  {
    uuid: 'a0000000-0000-4000-8000-000000000001',
    viewPosition: 0,
    name: 'Xray Default',
    tags: ['prod'],
    templateType: 'XRAY_JSON',
    templateJson: { outbounds: [] },
    encodedTemplateYaml: null,
  },
  {
    uuid: 'a0000000-0000-4000-8000-000000000002',
    viewPosition: 1,
    name: 'Mihomo',
    templateType: 'MIHOMO',
    templateJson: null,
    encodedTemplateYaml: 'eA==',
  },
]

function mockFetch(json: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  )
}

afterEach(() => vi.restoreAllMocks())

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/templates']}>
        <TemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('список шаблонов', () => {
  it('показывает шаблоны панели с типом', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    expect(await screen.findByText('Xray Default')).toBeInTheDocument()
    expect(screen.getByText('XRAY_JSON')).toBeInTheDocument()
  })

  // Прятать нельзя: список обязан отражать содержимое панели целиком
  it('неподдерживаемый тип показан, но без ссылки в редактор', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    expect(await screen.findByText('Mihomo')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mihomo' })).not.toBeInTheDocument()
    expect(screen.getByText(/откройте в панели/)).toBeInTheDocument()
  })

  it('XRAY_JSON открывается ссылкой в редактор', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    const link = await screen.findByRole('link', { name: 'Xray Default' })
    expect(link).toHaveAttribute('href', `/templates/${TEMPLATES[0]!.uuid}`)
  })

  it('пустой список предлагает создать первый шаблон', async () => {
    mockFetch({ templates: [] })
    renderPage()
    expect(await screen.findByText(/Шаблонов пока нет/)).toBeInTheDocument()
  })

  it('удаление спрашивает подтверждение', async () => {
    mockFetch({ templates: TEMPLATES })
    renderPage()
    await screen.findByText('Xray Default')
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' })[0]!)
    await waitFor(() => expect(screen.getByText(/нельзя отменить/)).toBeInTheDocument())
  })
})

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfilesPage } from '../src/features/profiles/ProfilesPage'

const profile = {
  uuid: 'u1',
  viewPosition: 0,
  name: 'Germany',
  config: {},
  inbounds: [{ uuid: 'i1', tag: 'vless-in', type: 'vless', network: 'tcp', security: 'reality', port: 443 }],
  nodes: [{ uuid: 'n1', name: 'DE-1', countryCode: 'DE' }],
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
}

function renderPage(profiles: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ profiles }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('ProfilesPage', () => {
  it('показывает карточку профиля с чипом inbound и нодой', async () => {
    renderPage([profile])
    expect(await screen.findByText('Germany')).toBeInTheDocument()
    expect(screen.getByText('vless-in :443')).toBeInTheDocument()
    expect(screen.getByText(/DE-1/)).toBeInTheDocument()
  })

  it('пустой список — empty state с призывом создать', async () => {
    renderPage([])
    expect(await screen.findByText('Профилей пока нет')).toBeInTheDocument()
  })
})

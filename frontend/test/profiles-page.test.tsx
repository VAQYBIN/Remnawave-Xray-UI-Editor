import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfilesPage } from '../src/features/profiles/ProfilesPage'
import { TEMPLATE } from '../src/features/profiles/CreateProfileDialog'
import { useDraftStore } from '../src/features/editor/draftStore'
import { usePositionsStore } from '../src/features/topology/positionsStore'

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
  it('показывает карточку профиля с метриками inbound и нодой', async () => {
    renderPage([profile])
    expect(await screen.findByText('Germany')).toBeInTheDocument()
    expect(screen.getByText('vless-in')).toBeInTheDocument()
    expect(screen.getByText(':443')).toBeInTheDocument()
    expect(screen.getByText('reality')).toBeInTheDocument()
    expect(screen.getByText(/DE-1/)).toBeInTheDocument()
  })

  it('имя профиля — ссылка на редактор, доступная с клавиатуры', async () => {
    renderPage([profile])
    const link = await screen.findByRole('link', { name: 'Germany' })
    expect(link).toHaveAttribute('href', '/profiles/u1')
  })

  it('черновик в localStorage помечает карточку и считается в шапке', async () => {
    useDraftStore.getState().setDraft(profile.uuid, '{}', profile.updatedAt)
    renderPage([profile])
    expect(await screen.findByText('Germany')).toBeInTheDocument()
    expect(screen.getByText('черновик')).toBeInTheDocument()
    expect(screen.getByText('незасейвленных черновиков: 1')).toBeInTheDocument()
    useDraftStore.getState().clearDraft(profile.uuid)
  })

  it('без черновиков счётчик в шапке не показывается', async () => {
    renderPage([profile])
    expect(await screen.findByText('Germany')).toBeInTheDocument()
    expect(screen.queryByText(/незасейвленных черновиков/)).not.toBeInTheDocument()
    expect(screen.queryByText('черновик')).not.toBeInTheDocument()
  })

  it('пустой список — empty state с призывом создать', async () => {
    renderPage([])
    expect(await screen.findByText('Профилей пока нет')).toBeInTheDocument()
  })

  it('удаление профиля очищает сохранённые позиции узлов', async () => {
    const user = userEvent.setup()
    renderPage([profile])
    expect(await screen.findByText('Germany')).toBeInTheDocument()

    usePositionsStore.getState().setPosition(profile.uuid, 'in:x', { x: 1, y: 2 })

    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    const dialog = screen.getByRole('dialog', { name: 'Удалить профиль' })
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(usePositionsStore.getState().positions[profile.uuid]).toBeUndefined())
  })
})

describe('TEMPLATE нового профиля', () => {
  it('содержит хотя бы один inbound — панель отклоняет пустой inbounds (A112)', () => {
    expect(TEMPLATE.inbounds.length).toBeGreaterThan(0)
    expect(TEMPLATE.inbounds[0]!.protocol).toBe('vless')
  })
})

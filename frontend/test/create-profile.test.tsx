import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { selectOption } from './helpers'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateProfileDialog, TEMPLATE, realityTemplate } from '../src/features/profiles/CreateProfileDialog'

describe('шаблоны профилей', () => {
  it('минимальный шаблон не изменился (A112: минимум один inbound)', () => {
    expect((TEMPLATE.inbounds as unknown[]).length).toBeGreaterThan(0)
  })

  it('reality-шаблон содержит ключ, shortId и security reality', () => {
    const cfg = realityTemplate('PRIVKEY', 'ab12cd34') as {
      inbounds: { streamSettings: { security: string; realitySettings: Record<string, unknown> } }[]
    }
    const rs = cfg.inbounds[0]!.streamSettings.realitySettings
    expect(cfg.inbounds[0]!.streamSettings.security).toBe('reality')
    expect(rs.privateKey).toBe('PRIVKEY')
    expect(rs.shortIds).toEqual(['ab12cd34'])
    expect(rs.serverNames).toEqual(['yahoo.com', 'www.yahoo.com'])
  })
})

afterEach(() => vi.unstubAllGlobals())

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreateProfileDialog open onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CreateProfileDialog — выбор пресета', () => {
  it('пресет Reality: ключи генерируются через API и попадают в конфиг профиля', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/tools/reality-keypair')) {
        return new Response(JSON.stringify({ privateKey: 'PK', publicKey: 'PB' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/profiles')) {
        expect(String(init?.body)).toContain('"privateKey":"PK"')
        return new Response(
          JSON.stringify({ profile: { uuid: 'p1', name: 'Germany', config: {} } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`неожиданный запрос: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDialog()

    await userEvent.type(screen.getByLabelText('Имя профиля'), 'Germany 1')
    await selectOption('Шаблон', 'VLESS Reality Vision')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await vi.waitFor(() => {
      const profileCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/profiles'))
      expect(profileCall).toBeDefined()
    })
    const profileCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/profiles'))!
    expect(String(profileCall[1]?.body)).toContain('"privateKey":"PK"')
  })
})

describe('CreateProfileDialog — рецепты', () => {
  it('отмеченные рецепты применяются к шаблону перед созданием', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/profiles')) {
        return new Response(
          JSON.stringify({ profile: { uuid: 'p1', name: 'Germany', config: {} } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`неожиданный запрос: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDialog()
    await userEvent.type(screen.getByLabelText('Имя профиля'), 'Germany 1')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Блокировать торренты' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Блокировать рекламу' }))
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/profiles'))).toBe(true)
    })
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/profiles'))!
    const sent = JSON.parse(String((call[1] as RequestInit).body)) as {
      config: {
        outbounds: { tag: string }[]
        routing: { rules: { protocol?: string[]; domain?: string[] }[] }
      }
    }
    expect(sent.config.outbounds.some((o) => o.tag === 'block')).toBe(true)
    expect(sent.config.routing.rules.some((r) => r.protocol?.[0] === 'bittorrent')).toBe(true)
    expect(sent.config.routing.rules.some((r) => r.domain?.[0] === 'geosite:category-ads-all')).toBe(
      true,
    )
  })
})

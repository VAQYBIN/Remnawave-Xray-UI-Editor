import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CheckReportDialog } from '../src/features/diagnostics/CheckReportDialog'

function mockRoutes(byUrl: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(byUrl).find((k) => url.includes(k))
      return new Response(JSON.stringify(key ? byUrl[key] : {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => vi.unstubAllGlobals())

const NO_TARGETS: never[] = []

describe('CheckReportDialog', () => {
  it('ядра нет — сообщение вместо ошибки', async () => {
    mockRoutes({ 'xray-test': { available: false, ok: false, errors: [], warnings: [], injected: [] } })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/проверка ядром недоступна/i)).toBeInTheDocument()
  })

  it('конфиг собирается — вердикт и версия', async () => {
    mockRoutes({
      'xray-test': {
        available: true,
        ok: true,
        version: '26.6.27',
        errors: [],
        warnings: [],
        injected: [],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/ядро собирает конфиг/i)).toBeInTheDocument()
    expect(screen.getByText(/26\.6\.27/)).toBeInTheDocument()
  })

  it('подставленный пользователь отмечается в отчёте', async () => {
    mockRoutes({
      'xray-test': { available: true, ok: true, errors: [], warnings: [], injected: ['vless-in'] },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/подставн/i)).toBeInTheDocument()
    expect(screen.getByText(/vless-in/)).toBeInTheDocument()
  })

  it('ошибка с подсказкой показывает и то, и другое', async () => {
    mockRoutes({
      'xray-test': {
        available: true,
        ok: false,
        errors: [
          {
            message: 'app/router: unable to find outbound tag: proxy',
            hint: 'Правило ссылается на тег, которого нет.',
          },
        ],
        warnings: [],
        injected: [],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/unable to find outbound tag/)).toBeInTheDocument()
    expect(screen.getByText(/тег, которого нет/)).toBeInTheDocument()
  })

  it('ошибка про geo ведёт в диалог баз', async () => {
    const onOpenGeo = vi.fn()
    mockRoutes({
      'xray-test': {
        available: true,
        ok: false,
        errors: [
          { message: 'failed to open file: geosite.dat', hint: 'Загрузите базы', code: 'geo' },
        ],
        warnings: [],
        injected: [],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={onOpenGeo}
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Geo-базы' }))
    expect(onOpenGeo).toHaveBeenCalled()
  })

  it('Reality-цель проверяется по кнопке и показывает вердикты', async () => {
    mockRoutes({
      'xray-test': { available: true, ok: true, errors: [], warnings: [], injected: [] },
      'reality-target': {
        target: 'www.microsoft.com:443',
        reachable: true,
        checks: [
          { id: 'tls13', level: 'ok', title: 'TLS 1.3' },
          { id: 'cdn', level: 'warn', title: 'Похоже на CDN (akamai)', detail: 'подозрение' },
        ],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={[
          {
            inboundTag: 'reality-in',
            target: 'www.microsoft.com:443',
            serverNames: ['www.microsoft.com'],
          },
        ]}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    const row = within(await screen.findByRole('listitem', { name: 'reality-in' }))
    await userEvent.click(row.getByRole('button', { name: /проверить цель/i }))
    await waitFor(() => expect(row.getByText('TLS 1.3')).toBeInTheDocument())
    expect(row.getByText(/похоже на cdn/i)).toBeInTheDocument()
  })

  it('предупреждения ядра показываются даже при успешной проверке', async () => {
    mockRoutes({
      'xray-test': {
        available: true,
        ok: true,
        errors: [],
        warnings: ['common/errors: The feature Trojan is deprecated.'],
        injected: [],
      },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/Trojan is deprecated/)).toBeInTheDocument()
  })

  it('успешный вердикт оговаривает, чего ядро не проверяет', async () => {
    mockRoutes({
      'xray-test': { available: true, ok: true, errors: [], warnings: [], injected: [] },
    })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/висячие теги|в рантайме/i)).toBeInTheDocument()
  })

  it('без reality-целей — прямая формулировка', async () => {
    mockRoutes({ 'xray-test': { available: true, ok: true, errors: [], warnings: [], injected: [] } })
    wrap(
      <CheckReportDialog
        open
        config={{}}
        targets={NO_TARGETS}
        onClose={() => {}}
        onOpenGeo={() => {}}
      />,
    )
    expect(await screen.findByText(/reality не используется/i)).toBeInTheDocument()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { StreamForm } from '../src/features/inspector/StreamForm'

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// Обёртка-родитель как в реальном приложении: эхо-ит onChange обратно в value через useState
// (см. StatefulOutboundForm в outbound-form.test.tsx) — StreamForm является controlled-компонентом,
// поэтому без эха value каждый keystroke откатывается к неизменному пропу.
function StatefulStreamForm({
  initial,
  onChange,
}: {
  initial: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  const [value, setValue] = useState(initial)
  const handleChange = (next: Record<string, unknown>) => {
    setValue(next)
    onChange(next)
  }
  return <StreamForm value={value} onChange={handleChange} />
}

afterEach(() => vi.unstubAllGlobals())

describe('StreamForm', () => {
  it('смена security на reality создаёт realitySettings, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ network: 'tcp', security: 'none', sockopt: { mark: 1 } }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Шифрование'), 'reality')
    expect(onChange).toHaveBeenLastCalledWith({
      network: 'tcp',
      security: 'reality',
      sockopt: { mark: 1 },
      realitySettings: {},
    })
  })

  it('reality: редактирует существующий ключ target, а не создаёт dest', async () => {
    const onChange = vi.fn()
    wrap(
      <StreamForm
        value={{ security: 'reality', realitySettings: { target: 'a.com:443' } }}
        onChange={onChange}
      />,
    )
    const input = screen.getByLabelText('Цель маскировки (dest)')
    expect(input).toHaveValue('a.com:443')
    await userEvent.type(input, 'x')
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.target).toBe('a.com:443x')
    expect(next.realitySettings.dest).toBeUndefined()
  })

  it('кнопка «Сгенерировать ключи» подставляет privateKey и показывает публичный', async () => {
    const onChange = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ privateKey: 'PRIV_43', publicKey: 'PUB_43' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    wrap(<StreamForm value={{ security: 'reality', realitySettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByText('Сгенерировать ключи'))
    await waitFor(() => expect(screen.getByText(/PUB_43/)).toBeInTheDocument())
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.privateKey).toBe('PRIV_43')
  })

  it('добавляет короткий ID кнопкой «+ ID»', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ security: 'reality', realitySettings: { shortIds: ['aa11'] } }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ ID'))
    const next = onChange.mock.lastCall![0] as { realitySettings: { shortIds: string[] } }
    expect(next.realitySettings.shortIds).toHaveLength(2)
    expect(next.realitySettings.shortIds[1]).toMatch(/^[0-9a-f]{8}$/)
  })

  it('ws: показывает поле пути', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Путь WebSocket'), '/ws')
    const next = onChange.mock.lastCall![0] as { wsSettings: Record<string, unknown> }
    expect(next.wsSettings.path).toBe('/ws')
  })
})

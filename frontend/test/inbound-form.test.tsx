import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InboundForm } from '../src/features/inspector/InboundForm'

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const VLESS = {
  tag: 'vless-in',
  port: 443,
  protocol: 'vless',
  settings: { clients: [{ id: 'u1' }], decryption: 'none' },
  streamSettings: { network: 'tcp', security: 'none' },
  sniffing: { enabled: true, destOverride: ['http'] },
  unknownField: { keep: true },
}

describe('InboundForm', () => {
  it('правка тега сохраняет все остальные поля, включая неизвестные', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={VLESS} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Тег'), '2')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.tag).toBe('vless-in2')
    expect(next.unknownField).toEqual({ keep: true })
    expect(next.settings).toEqual({ clients: [{ id: 'u1' }], decryption: 'none' })
  })

  it('смена протокола на shadowsocks показывает метод и пароль', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={{ ...VLESS, protocol: 'shadowsocks', settings: {} }} onChange={onChange} />)
    expect(screen.getByLabelText('Метод шифрования')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Сгенерировать пароль'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(typeof next.settings.password).toBe('string')
  })

  it('переключение на vless дополняет settings decryption/clients', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={{ tag: 't', protocol: 'trojan', settings: { clients: [] } }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Протокол'), 'vless')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.decryption).toBe('none')
  })

  it('sniffing переключается чекбоксом', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Sniffing включён'))
    const next = onChange.mock.lastCall![0] as { sniffing: Record<string, unknown> }
    expect(next.sniffing).toEqual({ enabled: false, destOverride: ['http'] })
  })
})

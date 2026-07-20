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

  it('переключение протокола заменяет settings чистым шаблоном нового протокола', async () => {
    const onChange = vi.fn()
    wrap(
      <InboundForm
        value={{ tag: 't', protocol: 'shadowsocks', settings: { method: 'chacha20-ietf-poly1305', password: 'p' } }}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Протокол'), 'vless')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    // настройки Shadowsocks не должны «висеть» в JSON после смены протокола
    expect(next.settings).toEqual({ clients: [], decryption: 'none' })
  })

  it('vless: flow выбирается на уровне settings, «нет» удаляет ключ', async () => {
    const onChange = vi.fn()
    const first = wrap(<InboundForm value={VLESS} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'xtls-rprx-vision')
    let next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.flow).toBe('xtls-rprx-vision')
    expect(next.settings.clients).toEqual([{ id: 'u1' }])
    first.unmount()

    onChange.mockClear()
    wrap(<InboundForm value={{ ...VLESS, settings: { ...VLESS.settings, flow: 'xtls-rprx-vision' } }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Flow'), '')
    next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect('flow' in next.settings).toBe(false)
  })

  it('vless: редактор клиентов не показывается — пользователей добавляет панель', () => {
    wrap(<InboundForm value={VLESS} onChange={vi.fn()} />)
    expect(screen.queryByText('+ Клиент')).not.toBeInTheDocument()
    expect(screen.getByText(/flow применяется ко всем пользователям/)).toBeInTheDocument()
  })

  it('trojan: редактор клиентов остаётся', () => {
    wrap(<InboundForm value={{ tag: 't', protocol: 'trojan', settings: { clients: [] } }} onChange={vi.fn()} />)
    expect(screen.getByText('+ Клиент')).toBeInTheDocument()
  })

  it('sniffing переключается чекбоксом', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Sniffing включён'))
    const next = onChange.mock.lastCall![0] as { sniffing: Record<string, unknown> }
    expect(next.sniffing).toEqual({ enabled: false, destOverride: ['http'] })
  })
})

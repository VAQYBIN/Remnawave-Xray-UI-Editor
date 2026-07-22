import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { InboundForm } from '../src/features/inspector/InboundForm'

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// Обёртка-родитель как в реальном приложении: эхо-ит onChange обратно в value через useState
function StatefulInboundForm({
  initial,
  onChange,
}: {
  initial: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
}) {
  const [value, setValue] = useState(initial)
  const handle = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <InboundForm value={value} onChange={handle} />
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

  it('trojan: редактор клиентов не показывается — пользователей добавляет панель', () => {
    wrap(<InboundForm value={{ tag: 't', protocol: 'trojan', settings: { clients: [] } }} onChange={vi.fn()} />)
    expect(screen.queryByText('+ Клиент')).not.toBeInTheDocument()
    expect(screen.getByText(/клиентов настраивать не нужно/)).toBeInTheDocument()
  })

  it('sniffing переключается чекбоксом', async () => {
    const onChange = vi.fn()
    wrap(<InboundForm value={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Sniffing включён'))
    const next = onChange.mock.lastCall![0] as { sniffing: Record<string, unknown> }
    expect(next.sniffing).toEqual({ enabled: false, destOverride: ['http'] })
  })

  it('flow из settings прокидывается в StreamForm: vision + ws даёт предупреждение', () => {
    wrap(
      <InboundForm
        value={{
          ...VLESS,
          settings: { ...VLESS.settings, flow: 'xtls-rprx-vision' },
          streamSettings: { network: 'ws', security: 'none' },
        }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/работает только поверх raw/)).toBeInTheDocument()
  })
})

describe('InboundForm — fallbacks и decryption', () => {
  it('vless: добавленный fallback пишет dest числом и path', async () => {
    const onChange = vi.fn()
    wrap(<StatefulInboundForm initial={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Fallback'))
    await userEvent.type(screen.getByLabelText('Куда (dest)'), '8080')
    await userEvent.type(screen.getByLabelText('Путь (path)'), '/web')
    const next = onChange.mock.lastCall![0] as { settings: { fallbacks: Record<string, unknown>[] } }
    expect(next.settings.fallbacks).toHaveLength(1)
    expect(next.settings.fallbacks[0]!.dest).toBe(8080)
    expect(next.settings.fallbacks[0]!.path).toBe('/web')
  })

  it('удаление последнего fallback удаляет ключ из settings', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulInboundForm
        initial={{ ...VLESS, settings: { ...VLESS.settings, fallbacks: [{ dest: 80 }] } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByLabelText('Удалить элемент 1'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.fallbacks).toBeUndefined()
  })

  it('trojan: fallbacks тоже доступны', () => {
    wrap(<StatefulInboundForm initial={{ tag: 't', protocol: 'trojan', settings: { clients: [] } }} />)
    expect(screen.getByText('+ Fallback')).toBeInTheDocument()
  })

  it('vless: decryption в «Продвинутых (VLESS)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulInboundForm initial={VLESS} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(VLESS\)/ }))
    const field = screen.getByLabelText('Decryption')
    expect(field).toHaveValue('none')
    await userEvent.type(field, '1')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.decryption).toBe('none1')
  })
})

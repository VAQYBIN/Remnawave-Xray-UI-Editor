import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OutboundForm, WARP_TEMPLATE } from '../src/features/inspector/OutboundForm'

// OutboundForm теперь рендерит StreamForm → react-query-хуки требуют провайдер
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// Обёртка-родитель как в реальном приложении: эхо-ит onChange обратно в value через useState
function StatefulOutboundForm({
  initial,
  outboundTags,
  onChange,
}: {
  initial: Record<string, unknown>
  outboundTags?: string[]
  onChange?: (next: Record<string, unknown>) => void
}) {
  const [value, setValue] = useState(initial)
  const handle = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <OutboundForm value={value} onChange={handle} outboundTags={outboundTags} />
}

describe('OutboundForm', () => {
  it('freedom: смена domainStrategy, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    wrap(
      <OutboundForm value={{ tag: 'direct', protocol: 'freedom', settings: {}, custom: 1 }} onChange={onChange} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов'), 'UseIP')
    expect(onChange).toHaveBeenLastCalledWith({
      tag: 'direct',
      protocol: 'freedom',
      settings: { domainStrategy: 'UseIP' },
      custom: 1,
    })
  })

  it('wireguard: кнопка WARP заполняет шаблон', async () => {
    const onChange = vi.fn()
    wrap(<OutboundForm value={{ tag: 'warp', protocol: 'wireguard' }} onChange={onChange} />)
    await userEvent.click(screen.getByText('Заполнить шаблон WARP'))
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'warp', protocol: 'wireguard', settings: WARP_TEMPLATE })
  })

  it('wireguard: правка publicKey пира не трогает остальное', async () => {
    const onChange = vi.fn()
    wrap(
      <OutboundForm
        value={{
          tag: 'warp',
          protocol: 'wireguard',
          settings: { secretKey: 'sk', peers: [{ publicKey: 'pk', endpoint: 'e:1', keepAlive: 25 }] },
        }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Публичный ключ пира'), 'X')
    const next = onChange.mock.lastCall![0] as { settings: { peers: Record<string, unknown>[] } }
    expect(next.settings.peers[0]).toEqual({ publicKey: 'pkX', endpoint: 'e:1', keepAlive: 25 })
  })

  it('wireguard: кнопка WARP обновляет отображаемые значения StringListField (регресс)', async () => {
    wrap(<StatefulOutboundForm initial={{ tag: 'warp', protocol: 'wireguard' }} />)
    await userEvent.click(screen.getByText('Заполнить шаблон WARP'))
    expect(screen.getByLabelText('Адреса интерфейса')).toHaveValue('172.16.0.2/32')
    expect(screen.getByLabelText('AllowedIPs пира')).toHaveValue('0.0.0.0/0\n::/0')
  })

  it('для socks показывает подсказку про JSON', () => {
    wrap(<OutboundForm value={{ tag: 's', protocol: 'socks' }} onChange={vi.fn()} />)
    expect(screen.getByText(/редактируются на вкладке JSON/)).toBeInTheDocument()
  })

  it('смена протокола заменяет settings пустым объектом', async () => {
    const onChange = vi.fn()
    wrap(
      <OutboundForm value={{ tag: 'warp', protocol: 'wireguard', settings: { secretKey: 'sk' } }} onChange={onChange} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Протокол'), 'blackhole')
    // настройки wireguard не должны «висеть» в JSON после смены протокола
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'warp', protocol: 'blackhole', settings: {} })
  })
})

describe('OutboundForm — streamSettings', () => {
  it('freedom, socks, http и vless показывают блок транспорта', () => {
    for (const protocol of ['freedom', 'socks', 'http', 'vless']) {
      const { unmount } = wrap(<OutboundForm value={{ tag: 't', protocol }} onChange={vi.fn()} />)
      expect(screen.getByLabelText('Транспорт')).toBeInTheDocument()
      unmount()
    }
  })

  it('wireguard и blackhole — без блока транспорта', () => {
    for (const protocol of ['wireguard', 'blackhole']) {
      const { unmount } = wrap(<OutboundForm value={{ tag: 't', protocol }} onChange={vi.fn()} />)
      expect(screen.queryByLabelText('Транспорт')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('правка транспорта уходит в streamSettings outbound-узла', async () => {
    const onChange = vi.fn()
    const Stateful = () => {
      const [value, setValue] = useState<Record<string, unknown>>({ tag: 'chain', protocol: 'vless' })
      return (
        <OutboundForm
          value={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      )
    }
    wrap(<Stateful />)
    await userEvent.selectOptions(screen.getByLabelText('Транспорт'), 'ws')
    await userEvent.type(screen.getByLabelText('Путь WebSocket'), '/ws')
    const next = onChange.mock.lastCall![0] as { streamSettings: Record<string, unknown> }
    expect(next.streamSettings).toEqual({ network: 'ws', wsSettings: { path: '/ws' } })
  })

  it('vless + tls: клиентский fingerprint есть, серверных сертификатов нет', async () => {
    wrap(<StatefulOutboundForm initial={{ tag: 'chain', protocol: 'vless', streamSettings: { network: 'tcp' } }} />)
    await userEvent.selectOptions(screen.getByLabelText('Шифрование'), 'tls')
    expect(screen.getByLabelText('Отпечаток (fingerprint)')).toBeInTheDocument()
    expect(screen.queryByText('+ Сертификат')).not.toBeInTheDocument()
  })

  it('dialerProxy: свой тег исключён из списка', async () => {
    wrap(
      <OutboundForm
        value={{ tag: 'proxy', protocol: 'vless' }}
        onChange={vi.fn()}
        outboundTags={['proxy', 'warp', 'direct']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    const select = screen.getByLabelText('Проксировать через outbound (dialerProxy)')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'warp' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'proxy' })).not.toBeInTheDocument()
  })
})

describe('OutboundForm — vless vnext', () => {
  it('добавление сервера: encryption none по умолчанию, адрес и порт пишутся', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'chain', protocol: 'vless', settings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Сервер'))
    await userEvent.type(screen.getByLabelText('Адрес'), 'node2.example.com')
    await userEvent.type(screen.getByLabelText('Порт'), '443')
    const next = onChange.mock.lastCall![0] as { settings: { vnext: Record<string, unknown>[] } }
    expect(next.settings.vnext).toHaveLength(1)
    expect(next.settings.vnext[0]!.address).toBe('node2.example.com')
    expect(next.settings.vnext[0]!.port).toBe(443)
    expect(next.settings.vnext[0]!.users).toEqual([{ encryption: 'none' }])
  })

  it('uuid и flow пишутся в users[0]; очистка uuid оставляет encryption', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{
          tag: 'chain',
          protocol: 'vless',
          settings: { vnext: [{ address: 'a', users: [{ encryption: 'none' }] }] },
        }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('UUID (users[0].id)'), 'uuid-1')
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'xtls-rprx-vision')
    let next = onChange.mock.lastCall![0] as { settings: { vnext: { users: Record<string, unknown>[] }[] } }
    expect(next.settings.vnext[0]!.users[0]).toEqual({ encryption: 'none', id: 'uuid-1', flow: 'xtls-rprx-vision' })

    await userEvent.clear(screen.getByLabelText('UUID (users[0].id)'))
    next = onChange.mock.lastCall![0] as { settings: { vnext: { users: Record<string, unknown>[] }[] } }
    expect(next.settings.vnext[0]!.users[0]).toEqual({ encryption: 'none', flow: 'xtls-rprx-vision' })
  })

  it('подсказки «редактируются на вкладке JSON» для vless больше нет', () => {
    wrap(<OutboundForm value={{ tag: 'c', protocol: 'vless' }} onChange={vi.fn()} />)
    expect(screen.queryByText(/редактируются на вкладке JSON/)).not.toBeInTheDocument()
  })
})

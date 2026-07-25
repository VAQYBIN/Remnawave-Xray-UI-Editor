import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { optionLabels, selectOption, selectedValue } from './helpers'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OutboundForm } from '../src/features/inspector/OutboundForm'
import { WARP_TEMPLATE } from '../src/entities/xray/recipes/warp'

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
    await selectOption('Стратегия доменов', 'UseIP')
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

  it('socks: серверы редактируются формой, подсказки про JSON нет', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 's', protocol: 'socks', settings: {} }} onChange={onChange} />)
    expect(screen.queryByText(/редактируются на вкладке JSON/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('+ Сервер'))
    await userEvent.type(screen.getByLabelText('Адрес'), '10.0.0.1')
    await userEvent.type(screen.getByLabelText('Порт'), '1080')
    await userEvent.type(screen.getByLabelText('Логин (users[0].user)'), 'admin')
    await userEvent.type(screen.getByLabelText('Пароль (users[0].pass)'), 'pw')
    const next = onChange.mock.lastCall![0] as { settings: { servers: Record<string, unknown>[] } }
    expect(next.settings.servers[0]).toEqual({ address: '10.0.0.1', port: 1080, users: [{ user: 'admin', pass: 'pw' }] })
  })

  it('смена протокола заменяет settings пустым объектом', async () => {
    const onChange = vi.fn()
    wrap(
      <OutboundForm value={{ tag: 'warp', protocol: 'wireguard', settings: { secretKey: 'sk' } }} onChange={onChange} />,
    )
    await selectOption('Протокол', 'blackhole')
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
    await selectOption('Транспорт', 'ws')
    await userEvent.type(screen.getByLabelText('Путь WebSocket'), '/ws')
    const next = onChange.mock.lastCall![0] as { streamSettings: Record<string, unknown> }
    expect(next.streamSettings).toEqual({ network: 'ws', wsSettings: { path: '/ws' } })
  })

  it('vless + tls: клиентский fingerprint есть, серверных сертификатов нет', async () => {
    wrap(<StatefulOutboundForm initial={{ tag: 'chain', protocol: 'vless', streamSettings: { network: 'tcp' } }} />)
    await selectOption('Шифрование', 'tls')
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
    expect(screen.getByLabelText('Проксировать через outbound (dialerProxy)')).toBeInTheDocument()
    const options = await optionLabels('Проксировать через outbound (dialerProxy)')
    expect(options).toContain('warp')
    expect(options).not.toContain('proxy')
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
    await selectOption('Flow', 'xtls-rprx-vision')
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

describe('OutboundForm — http servers', () => {
  it('http: очистка логина и пароля удаляет users целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{ tag: 'h', protocol: 'http', settings: { servers: [{ address: 'p', port: 3128, users: [{ user: 'a' }] }] } }}
        onChange={onChange}
      />,
    )
    await userEvent.clear(screen.getByLabelText('Логин (users[0].user)'))
    const next = onChange.mock.lastCall![0] as { settings: { servers: Record<string, unknown>[] } }
    expect(next.settings.servers[0]).toEqual({ address: 'p', port: 3128 })
  })
})

describe('OutboundForm — freedom fragment, blackhole response, wireguard полный', () => {
  it('freedom: redirect пишется, пресет tlshello заполняет fragment', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'direct', protocol: 'freedom', settings: {} }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Redirect'), ':3366')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.redirect).toBe(':3366')
    await userEvent.click(screen.getByRole('button', { name: /Fragment \(анти-DPI\)/ }))
    await userEvent.click(screen.getByText('Пресет tlshello'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.fragment).toEqual({ packets: 'tlshello', length: '100-200', interval: '10-20' })
  })

  it('freedom: очистка последнего поля fragment удаляет секцию', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{ tag: 'direct', protocol: 'freedom', settings: { fragment: { packets: 'tlshello' } } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Fragment \(анти-DPI\)/ }))
    await userEvent.clear(screen.getByLabelText('Пакеты (packets)'))
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.fragment).toBeUndefined()
  })

  it('blackhole: response.type пишется и удаляется', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'block', protocol: 'blackhole', settings: {} }} onChange={onChange} />)
    await selectOption('Ответ (response.type)', 'http')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.response).toEqual({ type: 'http' })
    await selectOption('Ответ (response.type)', '')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.response).toBeUndefined()
  })

  it('wireguard: второй пир добавляется, preSharedKey и keepAlive пишутся', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulOutboundForm
        initial={{ tag: 'warp', protocol: 'wireguard', settings: { peers: [{ publicKey: 'pk1' }] } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByText('+ Пир'))
    await userEvent.type(screen.getAllByLabelText('preSharedKey')[1]!, 'psk')
    await userEvent.type(screen.getAllByLabelText('keepAlive (сек)')[1]!, '25')
    const next = onChange.mock.lastCall![0] as { settings: { peers: Record<string, unknown>[] } }
    expect(next.settings.peers).toHaveLength(2)
    expect(next.settings.peers[0]).toEqual({ publicKey: 'pk1' })
    expect(next.settings.peers[1]).toEqual({ preSharedKey: 'psk', keepAlive: 25 })
  })

  it('wireguard: reserved парсится в числа построчно, domainStrategy пишется', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'warp', protocol: 'wireguard', settings: {} }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Reserved (по числу на строку)'), '51{enter}77')
    expect((onChange.mock.lastCall![0] as { settings: Record<string, unknown> }).settings.reserved).toEqual([51, 77])
    await selectOption('Стратегия доменов', 'ForceIPv4')
    const next = onChange.mock.lastCall![0] as { settings: Record<string, unknown> }
    expect(next.settings.domainStrategy).toBe('ForceIPv4')
  })
})

describe('OutboundForm — mux и sendThrough', () => {
  it('vless: mux включается, выключение удаляет пустой mux', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'chain', protocol: 'vless', settings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(outbound\)/ }))
    await userEvent.click(screen.getByLabelText('Mux включён'))
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).mux).toEqual({ enabled: true })
    await userEvent.type(screen.getByLabelText('Concurrency'), '8')
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).mux).toEqual({ enabled: true, concurrency: 8 })
    await userEvent.click(screen.getByLabelText('Mux включён'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.mux).toEqual({ concurrency: 8 })
  })

  it('sendThrough пишется и удаляется; у freedom mux-полей нет', async () => {
    const onChange = vi.fn()
    wrap(<StatefulOutboundForm initial={{ tag: 'direct', protocol: 'freedom', settings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(outbound\)/ }))
    expect(screen.queryByLabelText('Mux включён')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Исходящий адрес (sendThrough)'), '10.0.0.5')
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).sendThrough).toBe('10.0.0.5')
    await userEvent.clear(screen.getByLabelText('Исходящий адрес (sendThrough)'))
    expect('sendThrough' in (onChange.mock.lastCall![0] as Record<string, unknown>)).toBe(false)
  })
})

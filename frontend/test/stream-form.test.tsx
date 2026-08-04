import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { optionLabels, selectOption, selectedValue } from './helpers'
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
  mode,
  outboundTags,
}: {
  initial: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
  mode?: 'inbound' | 'outbound'
  outboundTags?: string[]
}) {
  const [value, setValue] = useState(initial)
  const handleChange = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <StreamForm value={value} onChange={handleChange} mode={mode} outboundTags={outboundTags} />
}

afterEach(() => vi.unstubAllGlobals())

describe('StreamForm', () => {
  it('смена security на reality создаёт realitySettings, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ network: 'tcp', security: 'none', sockopt: { mark: 1 } }} onChange={onChange} />)
    await selectOption('Шифрование', 'reality')
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
    const input = screen.getByLabelText('Цель маскировки (target)')
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

  it('генерирует несколько shortId кнопкой «Сгенерировать»', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ security: 'reality', realitySettings: { shortIds: ['aa11'] } }} onChange={onChange} />)
    await userEvent.click(screen.getByText('Сгенерировать'))
    const next = onChange.mock.lastCall![0] as { realitySettings: { shortIds: string[] } }
    // по умолчанию 4 — к исходному одному добавились ещё четыре
    expect(next.realitySettings.shortIds).toHaveLength(5)
    expect(next.realitySettings.shortIds.slice(1).every((s) => /^[0-9a-f]{8}$/.test(s))).toBe(true)
  })

  it('добавляет пустой shortId кнопкой «+ пустой»', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ security: 'reality', realitySettings: { shortIds: ['aa11'] } }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ пустой'))
    const next = onChange.mock.lastCall![0] as { realitySettings: { shortIds: string[] } }
    expect(next.realitySettings.shortIds).toEqual(['aa11', ''])
  })

  it('ws: показывает поле пути', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Путь WebSocket'), '/ws')
    const next = onChange.mock.lastCall![0] as { wsSettings: Record<string, unknown> }
    expect(next.wsSettings.path).toBe('/ws')
  })

  it('кнопка ставит minClientVer 0.0.0 — так пускают Mihomo и Sing-Box', async () => {
    const onChange = vi.fn()
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'reality', realitySettings: { target: 'x.com:443' } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByText('Продвинутые (Reality)'))
    await userEvent.click(screen.getByText(/0\.0\.0 — пустить/))
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.minClientVer).toBe('0.0.0')
    expect(next.realitySettings.target).toBe('x.com:443')
  })

  it('уже заданный minClientVer виден в поле', async () => {
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'reality', realitySettings: { minClientVer: '26.3.27' } }}
        onChange={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByText('Продвинутые (Reality)'))
    expect(screen.getByLabelText('Минимальная версия клиента')).toHaveValue('26.3.27')
  })

  it('транспорт читается из method', async () => {
    wrap(<StreamForm value={{ method: 'ws', security: 'none' }} onChange={vi.fn()} />)
    expect(selectedValue('Транспорт')).toBe('ws')
  })

  it('смена транспорта пишет network и убирает method', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ method: 'ws', security: 'none' }} onChange={onChange} />)
    await selectOption('Транспорт', 'grpc')
    // method перебивает network в ядре: оставить старый ключ — значит потерять правку
    expect(onChange).toHaveBeenLastCalledWith({ network: 'grpc', security: 'none' })
  })
})

describe('StreamForm — транспорты полностью', () => {
  it('ws: host, heartbeat и headers пишутся в wsSettings', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Host'), 'cdn.example.com')
    await userEvent.type(screen.getByLabelText('Heartbeat (сек)'), '30')
    await userEvent.click(screen.getByText('+ Пара'))
    await userEvent.type(screen.getByPlaceholderText('Ключ'), 'X-Token')
    await userEvent.type(screen.getByPlaceholderText('Значение'), 'abc')
    const next = onChange.mock.lastCall![0] as { wsSettings: Record<string, unknown> }
    expect(next.wsSettings.host).toBe('cdn.example.com')
    expect(next.wsSettings.heartbeatPeriod).toBe(30)
    expect(next.wsSettings.headers).toEqual({ 'X-Token': 'abc' })
  })

  it('ws: очистка последнего поля удаляет wsSettings целиком', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none', wsSettings: { path: '/a' } }} onChange={onChange} />)
    await userEvent.clear(screen.getByLabelText('Путь WebSocket'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.wsSettings).toBeUndefined()
  })

  it('grpc: authority и multiMode', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'grpc', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Authority'), 'cdn.example.com')
    await userEvent.click(screen.getByLabelText('multiMode'))
    const next = onChange.mock.lastCall![0] as { grpcSettings: Record<string, unknown> }
    expect(next.grpcSettings.authority).toBe('cdn.example.com')
    expect(next.grpcSettings.multiMode).toBe(true)
  })

  it('httpupgrade: host и headers', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'httpupgrade', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Host'), 'front.example.com')
    await userEvent.click(screen.getByText('+ Пара'))
    await userEvent.type(screen.getByPlaceholderText('Ключ'), 'X-A')
    await userEvent.type(screen.getByPlaceholderText('Значение'), '1')
    const next = onChange.mock.lastCall![0] as { httpupgradeSettings: Record<string, unknown> }
    expect(next.httpupgradeSettings.host).toBe('front.example.com')
    expect(next.httpupgradeSettings.headers).toEqual({ 'X-A': '1' })
  })

  it('xhttp: путь и режим; extra остаётся в JSON с пометкой', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'xhttp', security: 'none' }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Путь XHTTP'), '/api/data')
    await selectOption('Режим (mode)', 'packet-up')
    const next = onChange.mock.lastCall![0] as { xhttpSettings: Record<string, unknown> }
    expect(next.xhttpSettings.path).toBe('/api/data')
    expect(next.xhttpSettings.mode).toBe('packet-up')
    expect(screen.getByText(/спека XHTTP нестабильна/)).toBeInTheDocument()
  })

  it('tcp inbound: acceptProxyProtocol в «Продвинутых»; пишет в tcpSettings', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'none' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(транспорт\)/ }))
    await userEvent.click(screen.getByLabelText('Принимать PROXY protocol'))
    const next = onChange.mock.lastCall![0] as { tcpSettings: Record<string, unknown> }
    expect(next.tcpSettings).toEqual({ acceptProxyProtocol: true })
  })

  it('tcp: rawSettings-алиас — правка пишет в существующий ключ, tcpSettings не создаётся', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'none', rawSettings: { header: { type: 'none' } } }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(транспорт\)/ }))
    await userEvent.click(screen.getByLabelText('Принимать PROXY protocol'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.rawSettings).toEqual({ header: { type: 'none' }, acceptProxyProtocol: true })
    expect(next.tcpSettings).toBeUndefined()
  })

  it('tcp в outbound-режиме: блока «Продвинутые (транспорт)» нет', () => {
    wrap(<StreamForm value={{ network: 'tcp', security: 'none' }} onChange={vi.fn()} mode="outbound" />)
    expect(screen.queryByText(/Продвинутые \(транспорт\)/)).not.toBeInTheDocument()
  })
})

describe('StreamForm — TLS целиком', () => {
  it('inbound: alpn чипами, rejectUnknownSni в «Продвинутых (TLS)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'h2' }))
    expect((onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }).tlsSettings).toEqual({ alpn: ['h2'] })
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(TLS\)/ }))
    await userEvent.click(screen.getByLabelText('Отклонять неизвестный SNI (rejectUnknownSni)'))
    const next = onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }
    expect(next.tlsSettings).toEqual({ alpn: ['h2'], rejectUnknownSni: true })
  })

  it('inbound: минимальная версия TLS выбирается в «Продвинутых (TLS)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(TLS\)/ }))
    await selectOption('Мин. версия TLS', '1.3')
    const next = onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }
    expect(next.tlsSettings).toEqual({ minVersion: '1.3' })
  })

  it('inbound: сертификаты через ListEditor — файловые пути', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Сертификат'))
    await userEvent.type(screen.getByLabelText('Файл сертификата (certificateFile)'), '/etc/ssl/cert.pem')
    await userEvent.type(screen.getByLabelText('Файл ключа (keyFile)'), '/etc/ssl/key.pem')
    const next = onChange.mock.lastCall![0] as { tlsSettings: { certificates: Record<string, unknown>[] } }
    expect(next.tlsSettings.certificates).toHaveLength(1)
    expect(next.tlsSettings.certificates[0]!.certificateFile).toBe('/etc/ssl/cert.pem')
    expect(next.tlsSettings.certificates[0]!.keyFile).toBe('/etc/ssl/key.pem')
  })

  it('inbound: inline-PEM пишется массивом строк', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'tls', tlsSettings: { certificates: [{}] } }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Сертификат (PEM, построчно)'), '-----BEGIN CERTIFICATE-----\nAAA')
    const next = onChange.mock.lastCall![0] as { tlsSettings: { certificates: Record<string, unknown>[] } }
    expect(next.tlsSettings.certificates[0]!.certificate).toEqual(['-----BEGIN CERTIFICATE-----', 'AAA'])
  })

  it('outbound: fingerprint есть, сертификаты и серверные поля отсутствуют', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }}
        onChange={onChange}
        mode="outbound"
      />,
    )
    await selectOption('Отпечаток (fingerprint)', 'chrome')
    const next = onChange.mock.lastCall![0] as { tlsSettings: Record<string, unknown> }
    expect(next.tlsSettings).toEqual({ fingerprint: 'chrome' })
    expect(screen.queryByText('+ Сертификат')).not.toBeInTheDocument()
    expect(screen.queryByText(/Продвинутые \(TLS\)/)).not.toBeInTheDocument()
  })

  it('очистка SNI удаляет ключ, опустевший tlsSettings удаляется целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'tls', tlsSettings: { serverName: 'a.com' } }}
        onChange={onChange}
      />,
    )
    await userEvent.clear(screen.getByLabelText('Имя сервера (SNI)'))
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.tlsSettings).toBeUndefined()
  })
})

describe('StreamForm — Reality целиком', () => {
  it('inbound: xver пишется числом, show — в «Продвинутых (Reality)»', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'reality', realitySettings: {} }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('PROXY protocol к цели (xver)'), '1')
    expect((onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }).realitySettings.xver).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(Reality\)/ }))
    await userEvent.click(screen.getByLabelText('Отладочный вывод (show)'))
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings.show).toBe(true)
  })

  it('inbound: fingerprint-селект не показывается — это клиентское поле', () => {
    wrap(<StreamForm value={{ network: 'tcp', security: 'reality', realitySettings: {} }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Отпечаток (fingerprint)')).not.toBeInTheDocument()
  })

  it('outbound: клиентские поля serverName/password/shortId/spiderX/fingerprint', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'reality', realitySettings: {} }}
        onChange={onChange}
        mode="outbound"
      />,
    )
    await userEvent.type(screen.getByLabelText('Имя сервера (serverName)'), 'a.com')
    await userEvent.type(screen.getByLabelText('Публичный ключ сервера (password)'), 'PBK')
    await userEvent.type(screen.getByLabelText('Короткий ID (shortId)'), 'aa11')
    await userEvent.type(screen.getByLabelText('spiderX'), '/')
    await selectOption('Отпечаток (fingerprint)', 'randomized')
    const next = onChange.mock.lastCall![0] as { realitySettings: Record<string, unknown> }
    expect(next.realitySettings).toEqual({
      serverName: 'a.com',
      password: 'PBK',
      shortId: 'aa11',
      spiderX: '/',
      fingerprint: 'randomized',
    })
  })

  it('outbound: серверных полей и кнопок генерации нет', () => {
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'reality', realitySettings: {} }}
        onChange={vi.fn()}
        mode="outbound"
      />,
    )
    expect(screen.queryByText('Сгенерировать ключи')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Имена серверов (serverNames)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Приватный ключ')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Цель маскировки (target)')).not.toBeInTheDocument()
  })
})

describe('StreamForm — транспорт hysteria', () => {
  it('выбор hysteria создаёт hysteriaSettings с version: 2', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'tcp', security: 'tls', tlsSettings: {} }} onChange={onChange} />)
    await selectOption('Транспорт', 'hysteria')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.network).toBe('hysteria')
    expect(next.hysteriaSettings).toEqual({ version: 2 })
  })

  it('up/down пишутся строками, version сохраняется', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'hysteria', security: 'tls', hysteriaSettings: { version: 2 } }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Скорость вверх (up)'), '100mbps')
    await userEvent.type(screen.getByLabelText('Скорость вниз (down)'), '300mbps')
    const next = onChange.mock.lastCall![0] as { hysteriaSettings: Record<string, unknown> }
    expect(next.hysteriaSettings).toEqual({ version: 2, up: '100mbps', down: '300mbps' })
  })

  it('masquerade: тип file + каталог', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'hysteria', security: 'tls', hysteriaSettings: { version: 2 } }}
        onChange={onChange}
      />,
    )
    await selectOption('Маскировка (masquerade)', 'file')
    await userEvent.type(screen.getByLabelText('Каталог сайта (masquerade.dir)'), '/var/www')
    const next = onChange.mock.lastCall![0] as { hysteriaSettings: Record<string, unknown> }
    expect(next.hysteriaSettings.masquerade).toEqual({ type: 'file', dir: '/var/www' })
  })

  it('congestion/brutalUp пишутся в finalmask.quicParams', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'hysteria', security: 'tls', hysteriaSettings: { version: 2 } }}
        onChange={onChange}
      />,
    )
    await selectOption('Congestion control', 'brutal')
    await userEvent.type(screen.getByLabelText('brutalUp (Мбит/с)'), '100')
    const next = onChange.mock.lastCall![0] as { finalmask: { quicParams: Record<string, unknown> } }
    expect(next.finalmask.quicParams).toEqual({ congestion: 'brutal', brutalUp: 100 })
  })

  it('сброс единственного quic-параметра удаляет finalmask целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{
          network: 'hysteria',
          security: 'tls',
          hysteriaSettings: { version: 2 },
          finalmask: { quicParams: { congestion: 'bbr' } },
        }}
        onChange={onChange}
      />,
    )
    await selectOption('Congestion control', '')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.finalmask).toBeUndefined()
  })
})

describe('StreamForm — матрица совместимости', () => {
  it('reality: транспорт-селект не предлагает ws/httpupgrade/hysteria', async () => {
    wrap(<StreamForm value={{ network: 'tcp', security: 'reality', realitySettings: {} }} onChange={vi.fn()} />)
    const options = await optionLabels('Транспорт')
    expect(options).not.toContain('WebSocket')
    expect(options).not.toContain('HTTPUpgrade')
    expect(options).not.toContain('Hysteria 2 (QUIC)')
    expect(options).toContain('gRPC')
    expect(options).toContain('XHTTP')
  })

  it('ws: шифрование-селект не предлагает Reality', async () => {
    wrap(<StreamForm value={{ network: 'ws', security: 'none' }} onChange={vi.fn()} />)
    const options = await optionLabels('Шифрование')
    expect(options).not.toContain('Reality')
    expect(options).toContain('TLS')
  })

  it('существующая пара reality+ws не переписывается: опция с пометкой + предупреждение', async () => {
    const onChange = vi.fn()
    wrap(<StreamForm value={{ network: 'ws', security: 'reality', realitySettings: {} }} onChange={onChange} />)
    expect(selectedValue('Транспорт')).toBe('ws')
    expect(await optionLabels('Транспорт')).toContain('ws (несовместимо)')
    expect(screen.getByText(/Reality несовместим с транспортом «ws»/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('network raw — легитимный алиас tcp: опция «(= tcp)», предупреждения нет', async () => {
    wrap(<StreamForm value={{ network: 'raw', security: 'reality', realitySettings: {} }} onChange={vi.fn()} />)
    expect(selectedValue('Транспорт')).toBe('raw')
    expect(await optionLabels('Транспорт')).toContain('raw (= tcp)')
    expect(screen.queryByText(/несовместим/)).not.toBeInTheDocument()
  })

  it('flow vision + ws: предупреждение и транспорт-селект только с TCP', async () => {
    wrap(<StreamForm value={{ network: 'ws', security: 'none' }} onChange={vi.fn()} flow="xtls-rprx-vision" />)
    expect(screen.getByText(/работает только поверх raw/)).toBeInTheDocument()
    const options = await optionLabels('Транспорт')
    expect(options).not.toContain('gRPC')
    expect(options).toContain('TCP (raw)')
  })

  it('hysteria + none: предупреждение, шифрование-селект предлагает только TLS', async () => {
    wrap(<StreamForm value={{ network: 'hysteria', security: 'none' }} onChange={vi.fn()} />)
    expect(screen.getByText(/hysteria требует security «tls»/)).toBeInTheDocument()
    const options = await optionLabels('Шифрование')
    expect(options).toContain('TLS')
    expect(options).not.toContain('Reality')
    expect(options).toContain('none (несовместимо)')
  })

  it('hysteria + tls без certificates: предупреждение про сертификат; с certificates — нет', () => {
    const { unmount } = wrap(
      <StreamForm value={{ network: 'hysteria', security: 'tls', tlsSettings: {} }} onChange={vi.fn()} />,
    )
    expect(screen.getByText(/нужен настоящий TLS-сертификат/)).toBeInTheDocument()
    unmount()
    wrap(
      <StreamForm
        value={{ network: 'hysteria', security: 'tls', tlsSettings: { certificates: [{ certificateFile: '/a' }] } }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByText(/нужен настоящий TLS-сертификат/)).not.toBeInTheDocument()
  })
})

describe('StreamForm — sockopt', () => {
  it('outbound: dialerProxy выбирается из тегов outbound', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'none' }}
        onChange={onChange}
        mode="outbound"
        outboundTags={['direct', 'warp']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    await selectOption('Проксировать через outbound (dialerProxy)', 'warp')
    const next = onChange.mock.lastCall![0] as { sockopt: Record<string, unknown> }
    expect(next.sockopt).toEqual({ dialerProxy: 'warp' })
  })

  it('outbound: битый dialerProxy виден с пометкой «нет в конфиге»', async () => {
    wrap(
      <StreamForm
        value={{ network: 'tcp', security: 'none', sockopt: { dialerProxy: 'ghost' } }}
        onChange={vi.fn()}
        mode="outbound"
        outboundTags={['warp']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    expect(selectedValue('Проксировать через outbound (dialerProxy)')).toBe('ghost')
    expect(await optionLabels('Проксировать через outbound (dialerProxy)')).toContain('ghost (нет в конфиге)')
  })

  it('outbound: сброс единственного ключа удаляет sockopt целиком', async () => {
    const onChange = vi.fn()
    wrap(
      <StatefulStreamForm
        initial={{ network: 'tcp', security: 'none', sockopt: { dialerProxy: 'warp' } }}
        onChange={onChange}
        mode="outbound"
        outboundTags={['warp']}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    await selectOption('Проксировать через outbound (dialerProxy)', '')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.sockopt).toBeUndefined()
  })

  it('inbound: dialerProxy отсутствует, acceptProxyProtocol и mark пишутся', async () => {
    const onChange = vi.fn()
    wrap(<StatefulStreamForm initial={{ network: 'ws', security: 'none' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Сетевые опции \(sockopt\)/ }))
    expect(screen.queryByLabelText('Проксировать через outbound (dialerProxy)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Принимать PROXY protocol (sockopt)'))
    await userEvent.type(screen.getByLabelText('Метка пакетов (mark)'), '255')
    const next = onChange.mock.lastCall![0] as { sockopt: Record<string, unknown> }
    expect(next.sockopt).toEqual({ acceptProxyProtocol: true, mark: 255 })
  })
})

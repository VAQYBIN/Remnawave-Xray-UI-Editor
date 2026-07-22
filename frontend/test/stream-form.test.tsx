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
  mode,
}: {
  initial: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
  mode?: 'inbound' | 'outbound'
}) {
  const [value, setValue] = useState(initial)
  const handleChange = (next: Record<string, unknown>) => {
    setValue(next)
    onChange?.(next)
  }
  return <StreamForm value={value} onChange={handleChange} mode={mode} />
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
    await userEvent.selectOptions(screen.getByLabelText('Режим (mode)'), 'packet-up')
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
    await userEvent.selectOptions(screen.getByLabelText('Мин. версия TLS'), '1.3')
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
    await userEvent.selectOptions(screen.getByLabelText('Отпечаток (fingerprint)'), 'chrome')
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

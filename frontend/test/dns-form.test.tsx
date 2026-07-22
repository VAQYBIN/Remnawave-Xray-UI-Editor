import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { selectOption } from './helpers'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DnsForm } from '../src/features/inspector/DnsForm'

// Обёртка-родитель: эхо-ит onChange обратно в value (DnsForm — controlled)
function StatefulDnsForm({
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
  return <DnsForm value={value} onChange={handle} />
}

describe('DnsForm — servers', () => {
  it('строка-адрес редактируется и остаётся строкой', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: ['8.8.8.8'] }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), '8')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual(['8.8.8.88'])
  })

  it('добавленный сервер — простая карточка; ввод адреса пишет строку', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{}} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Сервер'))
    await userEvent.type(screen.getByLabelText('Адрес'), '1.1.1.1')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual(['1.1.1.1'])
  })

  it('переключение в расширенный объект переносит адрес; domains пишутся', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: ['8.8.8.8'] }} onChange={onChange} />)
    await selectOption('Тип сервера', 'full')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual([{ address: '8.8.8.8' }])
    await userEvent.type(screen.getByLabelText('Домены (domains)'), 'geosite:category-ru')
    const next = onChange.mock.lastCall![0] as { servers: { domains?: string[] }[] }
    expect(next.servers[0]!.domains).toEqual(['geosite:category-ru'])
  })

  it('объект-сервер: неизвестные поля сохраняются при правке порта', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: [{ address: '1.1.1.1', unknownOpt: true }] }} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Порт'), '53')
    expect((onChange.mock.lastCall![0] as { servers: unknown[] }).servers).toEqual([
      { address: '1.1.1.1', unknownOpt: true, port: 53 },
    ])
  })

  it('удаление последнего сервера удаляет ключ servers', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{ servers: ['8.8.8.8'] }} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Удалить элемент 1'))
    expect((onChange.mock.lastCall![0] as Record<string, unknown>).servers).toBeUndefined()
  })
})

describe('DnsForm — hosts, queryStrategy, продвинутые', () => {
  it('hosts: строковые пары редактируются, записи-массивы сохраняются', async () => {
    const onChange = vi.fn()
    render(
      <StatefulDnsForm
        initial={{ hosts: { 'multi.example.com': ['1.1.1.1', '2.2.2.2'], 'b.com': '3.3.3.3' } }}
        onChange={onChange}
      />,
    )
    expect(screen.getByText(/multi\.example\.com/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('+ Пара'))
    await userEvent.type(screen.getAllByPlaceholderText('example.com')[1]!, 'c.com')
    await userEvent.type(screen.getAllByPlaceholderText('1.2.3.4')[1]!, '4.4.4.4')
    const next = onChange.mock.lastCall![0] as { hosts: Record<string, unknown> }
    expect(next.hosts).toEqual({
      'multi.example.com': ['1.1.1.1', '2.2.2.2'],
      'b.com': '3.3.3.3',
      'c.com': '4.4.4.4',
    })
  })

  it('queryStrategy, tag и clientIp пишутся', async () => {
    const onChange = vi.fn()
    render(<StatefulDnsForm initial={{}} onChange={onChange} />)
    await selectOption('Стратегия запросов (queryStrategy)', 'UseIPv4')
    await userEvent.type(screen.getByLabelText('Тег (tag)'), 'dns-out')
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые \(DNS\)/ }))
    await userEvent.type(screen.getByLabelText('IP клиента (clientIp)'), '203.0.113.1')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next.queryStrategy).toBe('UseIPv4')
    expect(next.tag).toBe('dns-out')
    expect(next.clientIp).toBe('203.0.113.1')
  })
})

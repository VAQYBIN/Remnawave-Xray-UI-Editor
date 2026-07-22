import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { selectOption } from './helpers'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSettingsDialog } from '../src/features/editor/ConfigSettingsDialog'

describe('ConfigSettingsDialog — маршрутизация', () => {
  it('выбор domainStrategy создаёт routing, остальной конфиг не задет', async () => {
    const onChange = vi.fn()
    render(<ConfigSettingsDialog open config={{ inbounds: [] }} onChange={onChange} onClose={() => {}} />)
    await selectOption('Стратегия доменов (domainStrategy)', 'IPIfNonMatch')
    expect(onChange).toHaveBeenLastCalledWith({ inbounds: [], routing: { domainStrategy: 'IPIfNonMatch' } })
  })

  it('сброс единственного поля удаляет routing целиком', async () => {
    const onChange = vi.fn()
    render(
      <ConfigSettingsDialog open config={{ routing: { domainStrategy: 'AsIs' } }} onChange={onChange} onClose={() => {}} />,
    )
    await selectOption('Стратегия доменов (domainStrategy)', '')
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('rules и неизвестные поля routing сохраняются при правке domainMatcher', async () => {
    const onChange = vi.fn()
    const config = { routing: { rules: [{ type: 'field' }], custom: 1 } }
    render(<ConfigSettingsDialog open config={config} onChange={onChange} onClose={() => {}} />)
    await selectOption('Матчер доменов (domainMatcher)', 'linear')
    expect(onChange).toHaveBeenLastCalledWith({
      routing: { rules: [{ type: 'field' }], custom: 1, domainMatcher: 'linear' },
    })
  })

  it('кнопка «Закрыть настройки» вызывает onClose', async () => {
    const onClose = vi.fn()
    render(<ConfigSettingsDialog open config={{}} onChange={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть настройки' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('ConfigSettingsDialog — лог', () => {
  it('выбор loglevel создаёт log', async () => {
    const onChange = vi.fn()
    render(<ConfigSettingsDialog open config={{}} onChange={onChange} onClose={() => {}} />)
    await selectOption('Уровень лога (loglevel)', 'debug')
    expect(onChange).toHaveBeenLastCalledWith({ log: { loglevel: 'debug' } })
  })

  it('правка access не трогает остальные поля log', async () => {
    const onChange = vi.fn()
    render(
      <ConfigSettingsDialog
        open
        config={{ log: { loglevel: 'warning', access: '/var/log/a.log' } }}
        onChange={onChange}
        onClose={() => {}}
      />,
    )
    await userEvent.type(screen.getByLabelText('Файл access-лога'), '2')
    expect(onChange).toHaveBeenLastCalledWith({ log: { loglevel: 'warning', access: '/var/log/a.log2' } })
  })

  it('dnsLog: включение даёт true, выключение удаляет ключ и пустой log', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ConfigSettingsDialog open config={{}} onChange={onChange} onClose={() => {}} />,
    )
    await userEvent.click(screen.getByLabelText('Логировать DNS-запросы (dnsLog)'))
    expect(onChange).toHaveBeenLastCalledWith({ log: { dnsLog: true } })
    rerender(<ConfigSettingsDialog open config={{ log: { dnsLog: true } }} onChange={onChange} onClose={() => {}} />)
    await userEvent.click(screen.getByLabelText('Логировать DNS-запросы (dnsLog)'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('сброс loglevel в «не задан» при других полях log сохраняет их', async () => {
    const onChange = vi.fn()
    render(
      <ConfigSettingsDialog open config={{ log: { loglevel: 'error', dnsLog: true } }} onChange={onChange} onClose={() => {}} />,
    )
    await selectOption('Уровень лога (loglevel)', '')
    expect(onChange).toHaveBeenLastCalledWith({ log: { dnsLog: true } })
  })
})

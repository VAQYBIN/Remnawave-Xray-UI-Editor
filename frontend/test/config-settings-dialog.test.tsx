import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSettingsDialog } from '../src/features/editor/ConfigSettingsDialog'

describe('ConfigSettingsDialog — маршрутизация', () => {
  it('выбор domainStrategy создаёт routing, остальной конфиг не задет', async () => {
    const onChange = vi.fn()
    render(<ConfigSettingsDialog open config={{ inbounds: [] }} onChange={onChange} onClose={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов (domainStrategy)'), 'IPIfNonMatch')
    expect(onChange).toHaveBeenLastCalledWith({ inbounds: [], routing: { domainStrategy: 'IPIfNonMatch' } })
  })

  it('сброс единственного поля удаляет routing целиком', async () => {
    const onChange = vi.fn()
    render(
      <ConfigSettingsDialog open config={{ routing: { domainStrategy: 'AsIs' } }} onChange={onChange} onClose={() => {}} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов (domainStrategy)'), '')
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('rules и неизвестные поля routing сохраняются при правке domainMatcher', async () => {
    const onChange = vi.fn()
    const config = { routing: { rules: [{ type: 'field' }], custom: 1 } }
    render(<ConfigSettingsDialog open config={config} onChange={onChange} onClose={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Матчер доменов (domainMatcher)'), 'linear')
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

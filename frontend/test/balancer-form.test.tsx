import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BalancerForm } from '../src/features/inspector/BalancerForm'
import { ObservatoryForm } from '../src/features/inspector/ObservatoryForm'
import { selectOption } from './helpers'

const tags = ['proxy-de', 'proxy-nl', 'direct']

describe('BalancerForm', () => {
  it('показывает кандидатов, совпавших с префиксом', () => {
    render(
      <BalancerForm value={{ tag: 'bal-eu', selector: ['proxy-'] }} onChange={() => {}} outboundTags={tags} />,
    )
    expect(screen.getByText(/proxy-de, proxy-nl/)).toBeInTheDocument()
  })

  it('пустой селектор подсвечен ошибкой', () => {
    render(<BalancerForm value={{ tag: 'bal-eu', selector: [] }} onChange={() => {}} outboundTags={tags} />)
    expect(screen.getByText(/не совпал ни с одним outbound/i)).toBeInTheDocument()
  })

  it('смена стратегии уходит наверх', async () => {
    const onChange = vi.fn<(v: Record<string, unknown>) => void>()
    render(
      <BalancerForm value={{ tag: 'bal-eu', selector: ['proxy-'] }} onChange={onChange} outboundTags={tags} />,
    )
    await selectOption('Стратегия', 'leastPing')
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: expect.objectContaining({ type: 'leastPing' }) }),
    )
  })

  it('для leastPing без обсерватории предлагает её настроить', async () => {
    const onSetup = vi.fn<(kind: 'observatory' | 'burst', subjects: string[]) => void>()
    render(
      <BalancerForm
        value={{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }}
        onChange={() => {}}
        outboundTags={tags}
        observatory={{ present: false, missing: [] }}
        onSetupObservatory={onSetup}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Настроить проверку живости' }))
    expect(onSetup).toHaveBeenCalledWith('observatory', ['proxy-de', 'proxy-nl'])
  })

  it('сообщает о непокрытых кандидатах', () => {
    render(
      <BalancerForm
        value={{ tag: 'bal-eu', selector: ['proxy-'], strategy: { type: 'leastPing' } }}
        onChange={() => {}}
        outboundTags={tags}
        observatory={{ present: true, missing: ['proxy-nl'] }}
      />,
    )
    expect(screen.getByText(/не покрывает proxy-nl/)).toBeInTheDocument()
  })
})

describe('ObservatoryForm', () => {
  it('включение burst создаёт секцию с пустым subjectSelector', async () => {
    const onChange = vi.fn<(v: Record<string, unknown>) => void>()
    render(<ObservatoryForm value={{}} onChange={onChange} outboundTags={tags} />)
    await userEvent.click(screen.getByLabelText('Замеры под нагрузкой (burstObservatory)'))
    expect(onChange).toHaveBeenCalledWith({ burstObservatory: { subjectSelector: [] } })
  })

  it('выключение секции убирает её из значения', async () => {
    const onChange = vi.fn<(v: Record<string, unknown>) => void>()
    render(
      <ObservatoryForm
        value={{ observatory: { subjectSelector: ['proxy-'] } }}
        onChange={onChange}
        outboundTags={tags}
      />,
    )
    await userEvent.click(screen.getByLabelText('Фоновые пробы (observatory)'))
    expect(onChange).toHaveBeenCalledWith({})
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { TraceBar } from '../src/features/diagnostics/TraceBar'
import type { TraceTarget } from '../src/entities/xray'
import { selectOption } from './helpers'

/** Контролируемый компонент требует эхо-обёртки, иначе userEvent.type теряет символы */
function Harness({ onChange }: { onChange: (t: TraceTarget | null) => void }) {
  const [value, setValue] = useState<TraceTarget | null>(null)
  return (
    <TraceBar
      value={value}
      onChange={(t) => {
        setValue(t)
        onChange(t)
      }}
    />
  )
}

describe('TraceBar', () => {
  it('пустой адрес — трассировки нет', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('введённый адрес даёт цель с портом 443 и tcp по умолчанию', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: 'openai.com', port: 443, network: 'tcp' }),
    )
  })

  it('порт и сеть меняются', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    await userEvent.clear(screen.getByLabelText('Порт'))
    await userEvent.type(screen.getByLabelText('Порт'), '80')
    await selectOption('Сеть', 'udp')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ port: 80, network: 'udp' }))
  })

  it('IP назначения попадает в цель, пустое поле не попадает', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ip: undefined }))
    await userEvent.type(screen.getByLabelText('IP назначения'), '10.1.2.3')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ip: '10.1.2.3' }))
  })

  it('очистка адреса выключает трассировку', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const address = screen.getByLabelText('Адрес')
    await userEvent.type(address, 'openai.com')
    await userEvent.clear(address)
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

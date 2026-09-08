import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { TraceBar } from '../src/features/diagnostics/TraceBar'
import type { TraceTarget } from '../src/entities/xray'
import { selectOption } from './helpers'

/** Контролируемый компонент требует эхо-обёртки, иначе userEvent.type теряет символы */
function Harness({
  onChange,
  showProcess,
}: {
  onChange: (t: TraceTarget | null) => void
  showProcess?: boolean
}) {
  const [value, setValue] = useState<TraceTarget | null>(null)
  return (
    <TraceBar
      value={value}
      showProcess={showProcess}
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

describe('TraceBar: подписи полей', () => {
  // Заголовок строки переехал на кнопку дока, которая её открывает («Куда
  // пойдёт трафик») — здесь остаётся то, чем владеет сам компонент: каждое
  // поле подписано и связано с контролом, иначе ввод в доке читается как ничей.
  it.each(['Адрес', 'Порт', 'Сеть', 'IP назначения'])('поле «%s» подписано', (label) => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByLabelText(label)).toBeInTheDocument()
  })
})

describe('TraceBar: поле процесса', () => {
  // Правила `PROCESS-*` есть только у Mihomo, а строка ввода общая: у Xray поле
  // предлагало бы заполнить то, на что ни одно правило не смотрит
  it('без showProcess поля нет', () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.queryByLabelText('Процесс')).toBeNull()
  })

  it('с showProcess поле подписано и связано с контролом', () => {
    render(<Harness onChange={() => {}} showProcess />)
    expect(screen.getByLabelText('Процесс')).toBeInTheDocument()
  })

  it('введённое имя доходит до onChange как target.process', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} showProcess />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ process: undefined }))
    await userEvent.type(screen.getByLabelText('Процесс'), 'chrome.exe')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ process: 'chrome.exe' }))
  })

  it('спрятанное поле не тащит процесс в цель', async () => {
    // Значение может прийти из пропа `value` (компонент им засевает состояние).
    // Если поле спрятано, нести его в цель значило бы соврать, что процесс учли:
    // у Xray правил по процессу нет вовсе.
    const onChange = vi.fn()
    render(
      <TraceBar
        value={{ address: 'openai.com', port: 443, network: 'tcp', process: 'chrome.exe' }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Порт'), '0')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ process: undefined }))
  })

  it('путь доходит целиком — по разделителю трассировка отличает его от имени', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} showProcess />)
    await userEvent.type(screen.getByLabelText('Адрес'), 'openai.com')
    await userEvent.type(screen.getByLabelText('Процесс'), '/usr/lib/chrome')
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ process: '/usr/lib/chrome' }),
    )
  })
})

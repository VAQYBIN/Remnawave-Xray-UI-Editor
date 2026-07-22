import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RuleForm, keywordEntries, portSpecError } from '../src/features/inspector/RuleForm'

const TAGS = { inboundTags: ['vless-in', 'ss-in'], outboundTags: ['direct', 'warp'] }

// Эхо-обёртка как в реальном приложении: onChange возвращается в value через useState
function StatefulRuleForm({ initial }: { initial: Record<string, unknown> }) {
  const [value, setValue] = useState(initial)
  return <RuleForm value={value} onChange={setValue} {...TAGS} />
}

describe('RuleForm — базовые поля', () => {
  it('outboundTag выбирается из существующих outbound, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', custom: 1 }} onChange={onChange} {...TAGS} />)
    await userEvent.selectOptions(screen.getByLabelText('Outbound (куда отправить)'), 'warp')
    expect(onChange).toHaveBeenLastCalledWith({ custom: 1, outboundTag: 'warp' })
  })

  it('сброс outboundTag в «— не задан —» удаляет ключ', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', outboundTag: 'direct' }} onChange={onChange} {...TAGS} />)
    await userEvent.selectOptions(screen.getByLabelText('Outbound (куда отправить)'), '')
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('битая ссылка outboundTag видна как выбранная опция', () => {
    render(<RuleForm value={{ type: 'field', outboundTag: 'ghost' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByLabelText('Outbound (куда отправить)')).toHaveValue('ghost')
  })

  it('inboundTag — чипы: клик добавляет, снятие последнего удаляет ключ', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ss-in' }))
    expect(onChange).toHaveBeenLastCalledWith({ inboundTag: ['ss-in'] })
    rerender(<RuleForm value={{ type: 'field', inboundTag: ['ss-in'] }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ss-in' }))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('битый inboundTag из правила присутствует чипом и снимается', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', inboundTag: ['ghost-in'] }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ghost-in' }))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('network выбирается, protocol переключается чипами', async () => {
    render(<StatefulRuleForm initial={{ type: 'field' }} />)
    await userEvent.selectOptions(screen.getByLabelText('Сеть (network)'), 'tcp,udp')
    await userEvent.click(screen.getByRole('button', { name: 'bittorrent' }))
    expect(screen.getByLabelText('Сеть (network)')).toHaveValue('tcp,udp')
    expect(screen.getByRole('button', { name: 'bittorrent' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('user и source — в «Продвинутых», по умолчанию скрыты', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    expect(screen.queryByLabelText('IP источника (source)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые/ }))
    await userEvent.type(screen.getByLabelText('IP источника (source)'), '10.0.0.1')
    expect(onChange).toHaveBeenLastCalledWith({ source: ['10.0.0.1'] })
  })

  it('подсказки про порядок правил и sniffing на месте', () => {
    render(<RuleForm value={{ type: 'field' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByText(/сверху вниз/)).toBeInTheDocument()
    expect(screen.getByText(/включённом sniffing/)).toBeInTheDocument()
  })
})

describe('portSpecError', () => {
  it('валидные форматы: одиночный порт, диапазон, список', () => {
    expect(portSpecError(undefined)).toBeNull()
    expect(portSpecError(443)).toBeNull()
    expect(portSpecError('1000-2000')).toBeNull()
    expect(portSpecError('443,1000-2000,8443')).toBeNull()
  })

  it('невалидные форматы дают русское сообщение', () => {
    expect(portSpecError('70000')).toMatch(/вне диапазона/)
    expect(portSpecError('2000-1000')).toMatch(/больше конца/)
    expect(portSpecError('abc')).toMatch(/Некорректный формат/)
    expect(portSpecError('443,,80')).toMatch(/Пустой элемент/)
  })
})

describe('keywordEntries', () => {
  it('отделяет строки без известного префикса', () => {
    expect(keywordEntries(['geosite:openai', 'domain:a.com', 'example', 'full:b.com'])).toEqual(['example'])
    expect(keywordEntries(undefined)).toEqual([])
  })
})

describe('RuleForm — домены, IP, порты', () => {
  it('редактирование доменов даёт массив; шпаргалка префиксов видна', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    expect(screen.getByText(/geosite: \(категория\)/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Домены'), 'geosite:openai\ndomain:a.com')
    expect(onChange).toHaveBeenLastCalledWith({ domain: ['geosite:openai', 'domain:a.com'] })
  })

  it('домен без префикса подсвечивается предупреждением о keyword-матчинге', () => {
    render(<RuleForm value={{ type: 'field', domain: ['geosite:openai', 'example'] }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByText(/keyword-матчинг по подстроке: example/)).toBeInTheDocument()
  })

  it('редактирование IP даёт массив', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    await userEvent.type(screen.getByLabelText('IP назначения'), 'geoip:private')
    expect(onChange).toHaveBeenLastCalledWith({ ip: ['geoip:private'] })
  })

  it('битый порт показывает ошибку, валидный — нет', () => {
    const { rerender } = render(<RuleForm value={{ type: 'field', port: '2000-1000' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByText(/больше конца/)).toBeInTheDocument()
    rerender(<RuleForm value={{ type: 'field', port: '1000-2000' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.queryByText(/больше конца/)).not.toBeInTheDocument()
  })

  it('ввод порта уходит числом, диапазон — строкой', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    const port = screen.getByLabelText('Порт назначения')
    await userEvent.type(port, '443')
    expect(onChange).toHaveBeenLastCalledWith({ port: 443 })
    await userEvent.type(port, '-500')
    expect(onChange).toHaveBeenLastCalledWith({ port: '443-500' })
  })

  it('sourcePort — в «Продвинутых»', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    expect(screen.queryByLabelText('Порт источника (sourcePort)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Продвинутые/ }))
    await userEvent.type(screen.getByLabelText('Порт источника (sourcePort)'), '53')
    expect(onChange).toHaveBeenLastCalledWith({ sourcePort: 53 })
  })
})

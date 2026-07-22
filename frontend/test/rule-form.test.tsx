import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RuleForm } from '../src/features/inspector/RuleForm'

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
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', custom: 1, outboundTag: 'warp' })
  })

  it('сброс outboundTag в «— не задан —» удаляет ключ', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', outboundTag: 'direct' }} onChange={onChange} {...TAGS} />)
    await userEvent.selectOptions(screen.getByLabelText('Outbound (куда отправить)'), '')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field' })
  })

  it('битая ссылка outboundTag видна как выбранная опция', () => {
    render(<RuleForm value={{ type: 'field', outboundTag: 'ghost' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByLabelText('Outbound (куда отправить)')).toHaveValue('ghost')
  })

  it('inboundTag — чипы: клик добавляет, снятие последнего удаляет ключ', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<RuleForm value={{ type: 'field' }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ss-in' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', inboundTag: ['ss-in'] })
    rerender(<RuleForm value={{ type: 'field', inboundTag: ['ss-in'] }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ss-in' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field' })
  })

  it('битый inboundTag из правила присутствует чипом и снимается', async () => {
    const onChange = vi.fn()
    render(<RuleForm value={{ type: 'field', inboundTag: ['ghost-in'] }} onChange={onChange} {...TAGS} />)
    await userEvent.click(screen.getByRole('button', { name: 'ghost-in' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field' })
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
    expect(onChange).toHaveBeenLastCalledWith({ type: 'field', source: ['10.0.0.1'] })
  })

  it('подсказки про порядок правил и sniffing на месте', () => {
    render(<RuleForm value={{ type: 'field' }} onChange={vi.fn()} {...TAGS} />)
    expect(screen.getByText(/сверху вниз/)).toBeInTheDocument()
    expect(screen.getByText(/включённом sniffing/)).toBeInTheDocument()
  })
})

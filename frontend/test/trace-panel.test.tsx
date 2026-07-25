import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TracePanel } from '../src/features/diagnostics/TracePanel'
import type { TraceResult } from '../src/entities/xray'

const result: TraceResult = {
  verdicts: [
    {
      index: 0,
      state: 'no',
      outboundTag: 'warp',
      fields: [{ field: 'domain', state: 'no', reason: 'ни один шаблон домена не подходит' }],
    },
    {
      index: 1,
      state: 'unknown',
      outboundTag: 'warp',
      fields: [{ field: 'domain', state: 'unknown', reason: 'зависит от geo-списка или внешнего файла' }],
    },
    { index: 2, state: 'yes', outboundTag: 'direct', fields: [] },
  ],
  winner: { ruleIndex: 2, outboundTag: 'direct' },
  caveats: ['Правила #2 зависят от данных, которых нет, и стоят выше победителя — реальный маршрут может отличаться.'],
}

describe('TracePanel', () => {
  it('показывает победителя и его outbound', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    // Итог ищем внутри своего блока: тег «direct» встречается ещё и в строке правила
    const summary = within(screen.getByLabelText('Итог трассировки'))
    expect(summary.getByText(/правило #3/i)).toBeInTheDocument()
    expect(summary.getByText('direct')).toBeInTheDocument()
  })

  it('нумерует правила от единицы и подписывает состояние каждого', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    // Список правил адресуем по имени: caveats — тоже <ul>, и getAllByRole('listitem') смешал бы их
    const rows = within(screen.getByRole('list', { name: 'Правила' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('#1')
    expect(rows[0]).toHaveTextContent('не совпало')
    expect(rows[1]).toHaveTextContent('нет данных')
    expect(rows[2]).toHaveTextContent('совпало')
  })

  it('показывает причину по каждому полю', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/ни один шаблон домена не подходит/)).toBeInTheDocument()
  })

  it('выводит caveats', () => {
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/может отличаться/)).toBeInTheDocument()
  })

  it('клик по строке правила выбирает его в графе', async () => {
    const onSelectRule = vi.fn()
    render(<TracePanel result={result} onClose={() => {}} onSelectRule={onSelectRule} />)
    await userEvent.click(screen.getByRole('button', { name: /#1/ }))
    expect(onSelectRule).toHaveBeenCalledWith(0)
  })

  it('дефолтный маршрут подписан явно, когда ни одно правило не совпало', () => {
    const noMatch: TraceResult = {
      verdicts: [],
      winner: { ruleIndex: null, outboundTag: 'direct' },
      caveats: [],
    }
    render(<TracePanel result={noMatch} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/ни одно правило не совпало/i)).toBeInTheDocument()
  })

  it('второй проход по IP показывается отдельным блоком', () => {
    const twoPass: TraceResult = {
      ...result,
      ipVerdicts: [{ index: 0, state: 'yes', outboundTag: 'warp', fields: [] }],
    }
    render(<TracePanel result={twoPass} onClose={() => {}} onSelectRule={() => {}} />)
    expect(screen.getByText(/по разрешённому адресу/i)).toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MihomoTracePanel } from '../src/features/diagnostics/MihomoTracePanel'
import type { MihomoTraceResult } from '../src/entities/mihomo/trace'

/** Победитель — ВТОРОЕ правило: первое обязано остаться проигравшим */
const result: MihomoTraceResult = {
  verdicts: [
    { index: 0, state: 'no', target: 'REJECT' },
    { index: 1, state: 'yes', target: 'VPN' },
  ],
  winner: { ruleIndex: 1, target: 'VPN' },
  caveats: ['Цель пришла из подсписка «ru» — правило верхнего списка только открыло его.'],
}

const noop = () => {}

function summaryOf() {
  return within(screen.getByLabelText('Итог трассировки'))
}

function rows() {
  return within(screen.getByRole('list', { name: 'Правила' })).getAllByRole('listitem')
}

describe('MihomoTracePanel', () => {
  it('называет победившее правило и его цель', () => {
    render(<MihomoTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/правило #2/i)).toBeInTheDocument()
    // Цель ищем внутри блока итога: «VPN» встречается ещё и в строке правила
    expect(summary.getByText('VPN')).toBeInTheDocument()
    // Проигравшая цель победителем не объявлена
    expect(summary.queryByText('REJECT')).not.toBeInTheDocument()
  })

  it('нумерует правила от единицы, подписывает состояние и отмечает победителя', () => {
    render(<MihomoTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    const list = rows()
    expect(list).toHaveLength(2)
    expect(list[0]).toHaveTextContent('#1')
    expect(list[0]).toHaveTextContent('не совпало')
    expect(list[0]).not.toHaveAttribute('data-winner')
    expect(list[1]).toHaveTextContent('#2')
    expect(list[1]).toHaveTextContent('совпало')
    expect(list[1]).toHaveAttribute('data-winner')
  })

  it('остановка объясняется и победителем не притворяется', () => {
    const stopped: MihomoTraceResult = {
      verdicts: [
        { index: 0, state: 'no', target: 'REJECT' },
        {
          index: 1,
          state: 'unknown',
          target: 'VPN',
          reason: 'набор правил «ads» лежит по ссылке',
        },
      ],
      stopped: { index: 1, reason: 'набор правил «ads» лежит по ссылке' },
      caveats: [],
    }
    render(<MihomoTracePanel result={stopped} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/остановлен на правиле #2/i)).toBeInTheDocument()
    expect(summary.getByText(/набор правил «ads»/)).toBeInTheDocument()
    // Ни победы, ни маршрута: сказать, куда уйдёт трафик, нечем
    expect(summary.queryByText(/победило/i)).not.toBeInTheDocument()
    expect(rows()[1]).toHaveTextContent('проверить нечем')
  })

  it('причина остановки видна и в строке самого правила', () => {
    const stopped: MihomoTraceResult = {
      verdicts: [{ index: 0, state: 'unknown', reason: 'редактор не знает тип правила «FOO»' }],
      stopped: { index: 0, reason: 'редактор не знает тип правила «FOO»' },
      caveats: [],
    }
    render(<MihomoTracePanel result={stopped} onClose={noop} onSelectRule={noop} />)
    expect(within(rows()[0]!).getByText(/не знает тип правила «FOO»/)).toBeInTheDocument()
  })

  it('дефолтный маршрут подписан явно, когда ни одно правило не совпало', () => {
    const fell: MihomoTraceResult = {
      verdicts: [{ index: 0, state: 'no', target: 'VPN' }],
      winner: { ruleIndex: null, target: 'DIRECT' },
      caveats: [],
    }
    render(<MihomoTracePanel result={fell} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/ни одно правило не совпало/i)).toBeInTheDocument()
    expect(summary.getByText('DIRECT')).toBeInTheDocument()
    // Номера правила у дефолта нет — придумывать его нечем
    expect(summary.queryByText(/правило #/i)).not.toBeInTheDocument()
  })

  it('выводит оговорки', () => {
    render(<MihomoTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    expect(screen.getByText(/из подсписка «ru»/)).toBeInTheDocument()
  })

  it('сноска об усечении печатается только там, где список действительно оборван', () => {
    const note = /ниже .* список не выполняется/i
    // Победитель: правила ниже него не выполняются
    const { unmount } = render(
      <MihomoTracePanel result={result} onClose={noop} onSelectRule={noop} />,
    )
    expect(screen.getByText(note)).toBeInTheDocument()
    unmount()

    // Список пройден целиком — усечения не было, сообщать не о чем
    const fell: MihomoTraceResult = {
      verdicts: [{ index: 0, state: 'no', target: 'VPN' }],
      winner: { ruleIndex: null, target: 'DIRECT' },
      caveats: [],
    }
    const second = render(<MihomoTracePanel result={fell} onClose={noop} onSelectRule={noop} />)
    expect(screen.queryByText(note)).not.toBeInTheDocument()
    second.unmount()

    // Правил нет вовсе
    render(
      <MihomoTracePanel result={{ verdicts: [], caveats: [] }} onClose={noop} onSelectRule={noop} />,
    )
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })

  it('клик по строке правила выбирает его в графе', async () => {
    const onSelectRule = vi.fn()
    render(<MihomoTracePanel result={result} onClose={noop} onSelectRule={onSelectRule} />)
    await userEvent.click(screen.getByRole('button', { name: /#1/ }))
    expect(onSelectRule).toHaveBeenCalledWith(0)
  })

  it('оговорка про незагруженные базы предлагает открыть диалог geo', async () => {
    const onOpenGeo = vi.fn()
    const withGeo: MihomoTraceResult = {
      ...result,
      caveats: ['Geo-базы не загружены: вердикты по GEOSITE и GEOIP неизвестны.'],
    }
    render(
      <MihomoTracePanel
        result={withGeo}
        onClose={noop}
        onSelectRule={noop}
        onOpenGeo={onOpenGeo}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /geo-базы/i }))
    expect(onOpenGeo).toHaveBeenCalled()
  })

  it('без оговорки про geo кнопки нет', () => {
    render(
      <MihomoTracePanel result={result} onClose={noop} onSelectRule={noop} onOpenGeo={noop} />,
    )
    expect(screen.queryByRole('button', { name: /geo-базы/i })).not.toBeInTheDocument()
  })

  it('закрытие панели поднимается наверх', async () => {
    const onClose = vi.fn()
    render(<MihomoTracePanel result={result} onClose={onClose} onSelectRule={noop} />)
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalled()
  })
})

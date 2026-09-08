import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SingboxTracePanel } from '../src/features/diagnostics/SingboxTracePanel'
import { parseSingbox } from '../src/entities/singbox/parse'
import { traceSingbox, type SingboxTraceResult } from '../src/entities/singbox/trace'
import type { TraceTarget } from '../src/entities/xray'

/**
 * Каждая фикстура — НАСТОЯЩИЙ разбор маленького документа, а не литерал
 * результата: литерал разрешил бы состояние, которого `SingboxTraceOutcome` не
 * допускает (например, «ни победителя, ни остановки»), и панель проверялась бы
 * на том, чего трассировка не производит.
 */
function trace(json: string, target: Partial<TraceTarget> = {}): SingboxTraceResult {
  const doc = parseSingbox(json).doc!
  return traceSingbox(doc, { address: 'a.com', port: 443, network: 'tcp', ...target })
}

const OUTS = '{"type":"direct","tag":"direct"},{"type":"selector","tag":"g","outbounds":null}'

/** Побеждает ВТОРОЕ правило: первое обязано остаться проигравшим */
function winnerResult(): SingboxTraceResult {
  return trace(`{"outbounds":[${OUTS}],"route":{"rules":[
    {"domain":"b.com","outbound":"direct"},
    {"domain":"a.com","outbound":"g"}
  ],"final":"direct"}}`)
}

const noop = () => {}

function summaryOf() {
  return within(screen.getByLabelText('Итог трассировки'))
}

function rows() {
  return within(screen.getByRole('list', { name: 'Правила' })).getAllByRole('listitem')
}

describe('SingboxTracePanel', () => {
  it('называет победившее правило и его выход', () => {
    const result = winnerResult()
    expect(result.winner).toEqual({ ruleIndex: 1, target: 'g' })
    render(<SingboxTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/правило #2/i)).toBeInTheDocument()
    expect(summary.getByText('g')).toBeInTheDocument()
    // Проигравший выход победителем не объявлен
    expect(summary.queryByText('direct')).not.toBeInTheDocument()
  })

  it('нумерует правила от единицы, подписывает состояние и отмечает победителя', () => {
    render(<SingboxTracePanel result={winnerResult()} onClose={noop} onSelectRule={noop} />)
    const list = rows()
    expect(list).toHaveLength(2)
    expect(list[0]).toHaveTextContent('#1')
    expect(list[0]).toHaveTextContent('не совпало')
    expect(list[0]).not.toHaveAttribute('data-winner')
    expect(list[1]).toHaveTextContent('#2')
    expect(list[1]).toHaveTextContent('совпало')
    expect(list[1]).toHaveAttribute('data-winner')
  })

  it('остановка на правиле объясняется и победителем не притворяется', () => {
    const result = trace(`{"outbounds":[${OUTS}],"route":{"rules":[
      {"domain":"b.com","outbound":"direct"},
      {"clash_mode":"Global","outbound":"g"}
    ],"final":"direct"}}`)
    expect(result.stopped?.index).toBe(1)
    render(<SingboxTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/остановлен на правиле #2/i)).toBeInTheDocument()
    expect(summary.getByText(/режим выбирается в клиенте/i)).toBeInTheDocument()
    // Ни победы, ни маршрута: сказать, куда уйдёт трафик, нечем
    expect(summary.queryByText(/победило/i)).not.toBeInTheDocument()
    // Причина видна и в строке самого правила
    expect(rows()[1]).toHaveTextContent('проверить нечем')
    expect(within(rows()[1]!).getByText(/режим выбирается в клиенте/i)).toBeInTheDocument()
  })

  /**
   * Своё у sing-box против Mihomo ровно одно, и оно здесь: остановка бывает НЕ
   * на правиле. Номера у неё нет, и печатать «#0» или «#null» нельзя.
   */
  it('остановка до списка правил не получает номера правила', () => {
    const result = trace(`{"outbounds":[${OUTS}],"route":{"rules":[
      {"domain":"a.com","outbound":"direct"}
    ],"final":"g"}}`, { address: '   ' })
    expect(result.stopped?.index).toBeNull()
    render(<SingboxTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/вне списка правил/i)).toBeInTheDocument()
    expect(summary.getByText(/цель трассировки не задана/i)).toBeInTheDocument()
    expect(summary.queryByText(/правило #/i)).not.toBeInTheDocument()
  })

  /**
   * Второй вид остановки вне списка: список пройден ДО КОНЦА, а маршрут по
   * умолчанию из документа не выводится. Сказать про него «разбор не начался»
   * было бы прямым враньём — отсюда нейтральная формулировка места и причина,
   * которая и различает случаи.
   */
  it('остановка после списка не выдаёт себя за неначавшийся разбор', () => {
    const result = trace(`{"outbounds":[{"type":"direct"}],"route":{"rules":[
      {"domain":"b.com","outbound":"x"}
    ]}}`)
    expect(result.stopped?.index).toBeNull()
    expect(result.verdicts).toHaveLength(1)
    render(<SingboxTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/вне списка правил/i)).toBeInTheDocument()
    expect(summary.getByText(/route\.final не задан/i)).toBeInTheDocument()
    expect(summary.queryByText(/не начался/i)).not.toBeInTheDocument()
  })

  it('дефолтный маршрут подписан явно, когда ни одно правило не совпало', () => {
    const result = trace(`{"outbounds":[${OUTS}],"route":{"rules":[
      {"domain":"b.com","outbound":"direct"}
    ],"final":"g"}}`)
    expect(result.winner).toEqual({ ruleIndex: null, target: 'g' })
    render(<SingboxTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    const summary = summaryOf()
    expect(summary.getByText(/ни одно правило не совпало/i)).toBeInTheDocument()
    expect(summary.getByText('g')).toBeInTheDocument()
    // Номера правила у дефолта нет — придумывать его нечем
    expect(summary.queryByText(/правило #/i)).not.toBeInTheDocument()
  })

  it('выводит оговорку о незаданном route.final', () => {
    const result = trace(`{"outbounds":[${OUTS}],"route":{"rules":[
      {"domain":"b.com","outbound":"direct"}
    ]}}`)
    expect(result.caveats).toHaveLength(1)
    render(<SingboxTracePanel result={result} onClose={noop} onSelectRule={noop} />)
    expect(screen.getByText(/route\.final не задан/i)).toBeInTheDocument()
    expect(screen.getByText(/перестановка outbounds/i)).toBeInTheDocument()
  })

  it('сноска об усечении печатается только там, где список действительно оборван', () => {
    const note = /ниже .* список не выполняется/i

    // Победитель: правила ниже него не выполняются
    const first = render(
      <SingboxTracePanel result={winnerResult()} onClose={noop} onSelectRule={noop} />,
    )
    expect(screen.getByText(note)).toBeInTheDocument()
    first.unmount()

    // Остановка НА правиле: ниже неё список тоже не выполняется
    const stopped = trace(`{"outbounds":[${OUTS}],"route":{"rules":[
      {"clash_mode":"Global","outbound":"g"},
      {"domain":"a.com","outbound":"direct"}
    ],"final":"direct"}}`)
    const second = render(
      <SingboxTracePanel result={stopped} onClose={noop} onSelectRule={noop} />,
    )
    expect(screen.getByText(note)).toBeInTheDocument()
    second.unmount()

    // Список пройден целиком — усечения не было, сообщать не о чем
    const fell = trace(`{"outbounds":[${OUTS}],"route":{"rules":[
      {"domain":"b.com","outbound":"direct"}
    ],"final":"g"}}`)
    const third = render(<SingboxTracePanel result={fell} onClose={noop} onSelectRule={noop} />)
    expect(screen.queryByText(note)).not.toBeInTheDocument()
    third.unmount()

    // Остановка вне списка: скрывать ей нечего — до правил разбор не дошёл
    render(
      <SingboxTracePanel
        result={trace(`{"outbounds":[${OUTS}],"route":{"rules":[{"domain":"a.com","outbound":"direct"}]}}`, {
          address: '',
        })}
        onClose={noop}
        onSelectRule={noop}
      />,
    )
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })

  it('клик по строке правила выбирает его в графе', async () => {
    const onSelectRule = vi.fn()
    render(<SingboxTracePanel result={winnerResult()} onClose={noop} onSelectRule={onSelectRule} />)
    await userEvent.click(screen.getByRole('button', { name: /#1/ }))
    expect(onSelectRule).toHaveBeenCalledWith(0)
  })

  it('закрытие панели поднимается наверх', async () => {
    const onClose = vi.fn()
    render(<SingboxTracePanel result={winnerResult()} onClose={onClose} onSelectRule={noop} />)
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalled()
  })
})

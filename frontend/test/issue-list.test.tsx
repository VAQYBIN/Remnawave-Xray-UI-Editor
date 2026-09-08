import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IssueList } from '../src/features/editor/IssueList'
import type { ValidationIssue } from '../src/entities/xray'

const ISSUES: ValidationIssue[] = [
  {
    parts: ['inbounds', 0, 'streamSettings'],
    path: 'inbounds.0.streamSettings',
    message: 'Reality несовместим с ws',
    level: 'error',
  },
  {
    parts: ['log', 'loglevel'],
    path: 'log.loglevel',
    message: 'странный уровень',
    level: 'warning',
  },
]

describe('IssueList', () => {
  it('без onSelect строки остаются текстом', () => {
    render(<IssueList issues={ISSUES} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Reality несовместим с ws')).toBeInTheDocument()
  })

  it('клик по проблеме отдаёт её наверх', async () => {
    const onSelect = vi.fn()
    render(<IssueList issues={ISSUES} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /Reality несовместим/ }))
    expect(onSelect).toHaveBeenCalledWith(ISSUES[0])
  })

  it('непереходимая проблема кнопкой не становится', () => {
    render(
      <IssueList issues={ISSUES} onSelect={() => {}} canSelect={(issue) => issue.parts[0] !== 'log'} />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('странный уровень')).toBeInTheDocument()
  })

  it('пустой список не выдумывает сообщения: их говорит вызывающий', () => {
    // Ни один вызывающий сюда с пустым списком не приходит — оба показывают
    // список только при непустых диагностиках, а «проблем нет» пишут сами и
    // своими словами. Прежнее умолчание «Конфиг валиден» было второй копией
    // того сообщения, до которой не доходило исполнение
    render(<IssueList issues={[]} />)
    expect(screen.queryByText('Конфиг валиден')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    // Список остаётся списком: ветки «вместо списка — абзац» здесь больше нет
    expect(screen.getByRole('list')).toBeInTheDocument()
  })
})

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

  it('пустой список — прежнее сообщение', () => {
    render(<IssueList issues={[]} />)
    expect(screen.getByText('Конфиг валиден')).toBeInTheDocument()
  })
})

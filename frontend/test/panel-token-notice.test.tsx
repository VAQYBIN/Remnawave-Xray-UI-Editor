import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelTokenNotice } from '../src/features/editor/PanelTokenNotice'
import type { PanelTokenStatus } from '../src/shared/api/types'

const status = (over: Partial<PanelTokenStatus>): PanelTokenStatus => ({
  expiresAt: '2026-10-02T18:00:00.000Z',
  daysLeft: 30,
  expired: false,
  expiringSoon: false,
  ...over,
})

describe('PanelTokenNotice', () => {
  it('молчит, пока до истечения далеко', () => {
    const { container } = render(<PanelTokenNotice status={status({})} />)
    expect(container).toBeEmptyDOMElement()
  })

  // Срок неизвестен (токен панели — не JWT) — это не повод пугать оператора.
  it('молчит, когда статуса нет или срок не разобран', () => {
    const { container: a } = render(<PanelTokenNotice status={undefined} />)
    expect(a).toBeEmptyDOMElement()
    const { container: b } = render(
      <PanelTokenNotice status={status({ expiresAt: null, daysLeft: null })} />,
    )
    expect(b).toBeEmptyDOMElement()
  })

  it('предупреждает за неделю до истечения', () => {
    render(<PanelTokenNotice status={status({ daysLeft: 5, expiringSoon: true })} />)
    expect(screen.getByText(/токен панели истекает через 5 дней/i)).toBeInTheDocument()
  })

  it('склоняет остаток дней по-русски', () => {
    const text = (daysLeft: number) => {
      const { unmount } = render(
        <PanelTokenNotice status={status({ daysLeft, expiringSoon: true })} />,
      )
      const found = screen.getByRole('status').textContent ?? ''
      unmount()
      return found
    }
    expect(text(1)).toContain('через 1 день')
    expect(text(2)).toContain('через 2 дня')
    expect(text(5)).toContain('через 5 дней')
    expect(text(0)).toContain('сегодня')
  })

  it('про истёкший токен говорит прямо и называет, что чинить', () => {
    render(<PanelTokenNotice status={status({ daysLeft: -3, expired: true, expiringSoon: true })} />)
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(/истёк/i)
    expect(notice).toHaveTextContent(/REMNAWAVE_TOKEN/)
  })

  it('точную дату кладёт в подсказку, а не в строку статус-бара', () => {
    render(<PanelTokenNotice status={status({ daysLeft: 2, expiringSoon: true })} />)
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('02.10.2026'))
  })
})

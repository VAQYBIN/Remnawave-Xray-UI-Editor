import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Chip, CollapsibleSection, Dialog, EmptyState } from '../src/shared/ui'

describe('UI-кит', () => {
  it('Chip с направлением in получает класс chip-in и точку направления', () => {
    render(<Chip dir="in">vless-in :443</Chip>)
    const chip = screen.getByText('vless-in :443')
    expect(chip).toHaveClass('chip', 'chip-in')
    expect(chip.querySelector('.chip-dot')).not.toBeNull()
  })

  it('Chip без направления не имеет точки', () => {
    render(<Chip dir="none">freedom</Chip>)
    expect(screen.getByText('freedom').querySelector('.chip-dot')).toBeNull()
  })

  it('Button рендерит вариант danger', () => {
    render(<Button variant="danger">Удалить</Button>)
    expect(screen.getByRole('button', { name: 'Удалить' })).toHaveClass('btn', 'btn-danger')
  })

  it('EmptyState показывает заголовок и подсказку', () => {
    render(<EmptyState title="Профилей пока нет" hint="Создайте первый" />)
    expect(screen.getByText('Профилей пока нет')).toBeInTheDocument()
    expect(screen.getByText('Создайте первый')).toBeInTheDocument()
  })

  it('Dialog с wide получает класс dialog-wide', () => {
    render(
      <Dialog open={false} title="Тест" onClose={() => {}} wide>
        <p>содержимое</p>
      </Dialog>,
    )
    expect(document.querySelector('dialog')).toHaveClass('dialog', 'dialog-wide')
  })
})

describe('CollapsibleSection', () => {
  it('по умолчанию закрыт, открывается и закрывается по клику', async () => {
    render(
      <CollapsibleSection title="Продвинутые">
        <span>секретное поле</span>
      </CollapsibleSection>,
    )
    expect(screen.queryByText('секретное поле')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /Продвинутые/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getByText('секретное поле')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)
    expect(screen.queryByText('секретное поле')).not.toBeInTheDocument()
  })

  it('defaultOpen открывает сразу', () => {
    render(
      <CollapsibleSection title="Продвинутые" defaultOpen>
        <span>видно</span>
      </CollapsibleSection>,
    )
    expect(screen.getByText('видно')).toBeInTheDocument()
  })
})

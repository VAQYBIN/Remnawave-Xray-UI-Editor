import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, Chip, EmptyState } from '../src/shared/ui'

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
})

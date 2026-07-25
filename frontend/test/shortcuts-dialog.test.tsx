import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsDialog } from '../src/features/editor/ShortcutsDialog'

describe('ShortcutsDialog', () => {
  it('перечисляет сочетания', () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />)
    expect(screen.getByText('Ctrl+Z')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Shift+Z')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+F')).toBeInTheDocument()
    expect(screen.getByText('Esc')).toBeInTheDocument()
  })

  it('кнопка «Закрыть» зовёт onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ShortcutsDialog open onClose={onClose} />)
    // Кнопок с именем «Закрыть» две: крестик в шапке Dialog и кнопка внизу — берём нижнюю
    const buttons = screen.getAllByRole('button', { name: 'Закрыть' })
    await user.click(buttons[buttons.length - 1]!)
    expect(onClose).toHaveBeenCalled()
  })
})

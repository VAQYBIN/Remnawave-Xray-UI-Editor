import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MenuButton } from '../src/shared/ui'

const ITEMS = [
  { id: 'inbound', label: 'Вход' },
  { id: 'outbound', label: 'Выход' },
  { id: 'locked', label: 'Недоступно', disabled: true },
]

describe('MenuButton', () => {
  it('закрыт по умолчанию, открывается кликом и показывает пункты', async () => {
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: '+ Добавить' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Вход', 'Выход', 'Недоступно'])
  })

  it('выбор пункта зовёт onPick с id и закрывает меню', async () => {
    const onPick = vi.fn()
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Выход' }))
    expect(onPick).toHaveBeenCalledWith('outbound')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('отключённый пункт не выбирается', async () => {
    const onPick = vi.fn()
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    expect(screen.getByRole('menuitem', { name: 'Недоступно' })).toBeDisabled()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Недоступно' }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Escape закрывает меню и не всплывает наружу', async () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <MenuButton label="+ Добавить" items={ITEMS} onPick={vi.fn()} />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(outer).not.toHaveBeenCalled()
  })

  it('стрелки двигают фокус по пунктам, Enter выбирает', async () => {
    const onPick = vi.fn()
    render(<MenuButton label="+ Добавить" items={ITEMS} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith('outbound')
  })
})

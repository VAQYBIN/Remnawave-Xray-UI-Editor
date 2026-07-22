import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox, Select } from '../src/shared/ui'
import { computePosition, typeaheadIndex } from '../src/shared/ui/Select'
import { optionLabels, selectOption, selectedValue } from './helpers'

const OPTIONS = [
  { value: 'a', label: 'Альфа' },
  { value: 'b', label: 'Бета' },
  { value: 'c', label: 'Гамма' },
]

function StatefulSelect({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('a')
  return (
    <Select
      aria-label="Прото"
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

describe('Select — выбор мышью', () => {
  it('показывает подпись выбранной опции, а не значение', () => {
    render(<StatefulSelect />)
    expect(screen.getByLabelText('Прото')).toHaveTextContent('Альфа')
  })

  it('список закрыт до клика и открывается по клику', async () => {
    render(<StatefulSelect />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Прото'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByLabelText('Прото')).toHaveAttribute('aria-expanded', 'true')
  })

  it('клик по опции отдаёт value и закрывает список', async () => {
    const onChange = vi.fn()
    render(<StatefulSelect onChange={onChange} />)
    await selectOption('Прото', 'b')
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(selectedValue('Прото')).toBe('b')
  })

  it('выбранная опция помечена aria-selected', async () => {
    render(<StatefulSelect />)
    await userEvent.click(screen.getByLabelText('Прото'))
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-value', 'a')
  })

  it('клик вне списка закрывает его без изменения значения', async () => {
    const onChange = vi.fn()
    render(
      <div>
        <StatefulSelect onChange={onChange} />
        <button type="button">снаружи</button>
      </div>,
    )
    await userEvent.click(screen.getByLabelText('Прото'))
    await userEvent.click(screen.getByRole('button', { name: 'снаружи' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('optionLabels отдаёт подписи и возвращает список в закрытое состояние', async () => {
    render(<StatefulSelect />)
    expect(await optionLabels('Прото')).toEqual(['Альфа', 'Бета', 'Гамма'])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('Select — клавиатура', () => {
  it('открывается стрелкой вниз и выбирает по Enter', async () => {
    const onChange = vi.fn()
    render(<StatefulSelect onChange={onChange} />)
    screen.getByLabelText('Прото').focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('Escape закрывает список без выбора и возвращает фокус на триггер', async () => {
    const onChange = vi.fn()
    render(<StatefulSelect onChange={onChange} />)
    const trigger = screen.getByLabelText('Прото')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('End переводит активную опцию на последнюю', async () => {
    const onChange = vi.fn()
    render(<StatefulSelect onChange={onChange} />)
    screen.getByLabelText('Прото').focus()
    await userEvent.keyboard('{ArrowDown}{End}{Enter}')
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('набор буквы прыгает к опции с этой подписи', async () => {
    const onChange = vi.fn()
    render(<StatefulSelect onChange={onChange} />)
    screen.getByLabelText('Прото').focus()
    await userEvent.keyboard('{ArrowDown}Г{Enter}')
    expect(onChange).toHaveBeenCalledWith('c')
  })
})

describe('computePosition', () => {
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 20, width: 200 }) as DOMRect

  it('раскрывает вниз, когда снизу достаточно места', () => {
    const pos = computePosition(rect(100, 130), 800)
    expect(pos.top).toBe(134)
    expect(pos.bottom).toBeUndefined()
    expect(pos.left).toBe(20)
    expect(pos.width).toBe(200)
  })

  it('раскрывает вверх с якорем снизу, чтобы короткий список не отрывался от кнопки', () => {
    const pos = computePosition(rect(600, 630), 660)
    expect(pos.top).toBeUndefined()
    expect(pos.bottom).toBe(64) // 660 - 600 + 4
    expect(pos.maxHeight).toBeLessThanOrEqual(320)
  })
})

describe('typeaheadIndex', () => {
  it('ищет за текущей позицией, затем по кругу', () => {
    expect(typeaheadIndex(OPTIONS, 'б', 0)).toBe(1)
    expect(typeaheadIndex(OPTIONS, 'а', 1)).toBe(0)
    expect(typeaheadIndex(OPTIONS, 'я', 0)).toBe(-1)
  })

  it('регистр не важен', () => {
    expect(typeaheadIndex(OPTIONS, 'га', -1)).toBe(2)
  })
})

describe('Checkbox', () => {
  it('переключается и отдаёт boolean', async () => {
    const onChange = vi.fn()
    render(<Checkbox label="Sniffing включён" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Sniffing включён'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

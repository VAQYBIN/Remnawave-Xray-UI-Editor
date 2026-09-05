import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InjectGroupForm } from '../src/features/inspector/InjectGroupForm'
import { selectOption, selectedValue } from './helpers'

describe('форма группы подстановки', () => {
  it('показывает предсказанные теги для префиксной схемы', () => {
    render(<InjectGroupForm value={{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }} onChange={() => {}} />)
    expect(screen.getByText(/proxy, proxy-2, proxy-3/)).toBeInTheDocument()
  })

  it('смена способа именования снимает остальные — состояние «два сразу» невыразимо', async () => {
    const onChange = vi.fn()
    render(<InjectGroupForm value={{ selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy' }} onChange={onChange} />)
    await selectOption('Способ именования тегов', 'тег хоста')
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ useHostTagAsTag: true }),
    )
    const next = onChange.mock.calls[0]![0] as Record<string, unknown>
    expect(next.tagPrefix).toBeUndefined()
    expect(next.useHostRemarkAsTag).toBeUndefined()
  })

  it('для тегов панели честно предупреждает, что связи не выводятся', () => {
    render(<InjectGroupForm value={{ selector: { type: 'tagRegex' }, useHostRemarkAsTag: true }} onChange={() => {}} />)
    expect(screen.getByText(/знает только панель/)).toBeInTheDocument()
  })

  it('параметр селектора зависит от его типа', async () => {
    const onChange = vi.fn()
    render(<InjectGroupForm value={{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p' }} onChange={onChange} />)
    // У sameTagAsRecipient параметра нет
    expect(screen.queryByLabelText('Регулярное выражение')).not.toBeInTheDocument()
    await selectOption('Тип селектора', 'tagRegex — по регулярке на тег хоста')
    expect(onChange).toHaveBeenCalled()
  })

  it('пул по умолчанию показан как HIDDEN', () => {
    render(<InjectGroupForm value={{ selector: { type: 'uuids' } }} onChange={() => {}} />)
    expect(selectedValue('Пул выбора хостов')).toContain('HIDDEN')
  })

  it('введённый префикс переживает переключение схемы туда и обратно', async () => {
    // Компонент управляемый: держим значение в стейте, иначе цикл не воспроизвести
    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({
        selector: { type: 'sameTagAsRecipient' },
        tagPrefix: 'myprefix',
      })
      return <InjectGroupForm value={value} onChange={setValue} />
    }
    render(<Harness />)
    await selectOption('Способ именования тегов', 'тег хоста')
    await selectOption('Способ именования тегов', 'префикс — proxy, proxy-2…')
    expect(screen.getByLabelText('Префикс тегов')).toHaveValue('myprefix')
  })

  it('очистка префикса пишет пустую строку, а не удаляет ключ', async () => {
    // Управляемый компонент: без стейта не увидеть, что переключатель схемы
    // не прыгает под руками после очистки поля
    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({
        selector: { type: 'sameTagAsRecipient' },
        tagPrefix: 'myprefix',
      })
      return <InjectGroupForm value={value} onChange={setValue} />
    }
    render(<Harness />)
    await userEvent.clear(screen.getByLabelText('Префикс тегов'))

    // Ключ остался — именно пустой строкой, а не undefined/отсутствием ключа
    expect(screen.getByLabelText('Префикс тегов')).toHaveValue('')
    // Схема осталась «префикс»: переключатель не провалился в «способ не выбран»
    expect(selectedValue('Способ именования тегов')).toBe('tagPrefix')
    // Валидация всё равно предупреждает — способ именования пуст
    expect(screen.getByText(/Способ именования не выбран/)).toBeInTheDocument()
  })

  it('после очистки поле принимает новый ввод как обычно', async () => {
    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({
        selector: { type: 'sameTagAsRecipient' },
        tagPrefix: 'myprefix',
      })
      return <InjectGroupForm value={value} onChange={setValue} />
    }
    render(<Harness />)
    const input = screen.getByLabelText('Префикс тегов')
    await userEvent.clear(input)
    await userEvent.type(input, 'newprefix')
    expect(input).toHaveValue('newprefix')
  })
})

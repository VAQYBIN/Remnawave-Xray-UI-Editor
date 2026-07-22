import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  CheckboxField,
  MultiSelectField,
  PortField,
  StringListField,
  TagListField,
  TextField,
} from '../src/features/inspector/fields'

describe('TextField', () => {
  it('пустая строка превращается в undefined (ключ удаляется)', async () => {
    const onChange = vi.fn()
    render(<TextField label="Тег" value="vless-in" onChange={onChange} />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

describe('PortField', () => {
  it('числовые строки становятся number, диапазоны остаются строкой', async () => {
    const onChange = vi.fn()
    render(<PortField label="Порт" value={undefined} onChange={onChange} />)
    const input = screen.getByLabelText('Порт')
    await userEvent.type(input, '8')
    expect(onChange).toHaveBeenLastCalledWith(8)
    await userEvent.type(input, '-9')
    expect(onChange).toHaveBeenLastCalledWith('8-9')
  })
})

describe('StringListField', () => {
  it('строки → массив, пустые отбрасываются', async () => {
    const onChange = vi.fn()
    render(<StringListField label="Имена" value={['a.com']} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Имена'), '\nb.com')
    expect(onChange).toHaveBeenLastCalledWith(['a.com', 'b.com'])
  })
})

describe('TagListField', () => {
  it('удаляет элемент по крестику и добавляет по кнопке', async () => {
    const onChange = vi.fn()
    const onAdd = vi.fn()
    render(
      <TagListField label="shortIds" value={['ab12', 'cd34']} onChange={onChange} onAdd={onAdd} addLabel="+ ID" />,
    )
    await userEvent.click(screen.getByLabelText('Удалить ab12'))
    expect(onChange).toHaveBeenCalledWith(['cd34'])
    await userEvent.click(screen.getByText('+ ID'))
    expect(onAdd).toHaveBeenCalled()
  })
})

describe('CheckboxField', () => {
  it('включение даёт true, выключение даёт undefined (ключ удаляется)', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<CheckboxField label="multiMode" value={undefined} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('multiMode'))
    expect(onChange).toHaveBeenLastCalledWith(true)
    rerender(<CheckboxField label="multiMode" value={true} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('multiMode'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('показывает подсказку', () => {
    render(<CheckboxField label="routeOnly" hint="Только для маршрутизации" value={undefined} onChange={() => {}} />)
    expect(screen.getByText('Только для маршрутизации')).toBeInTheDocument()
  })
})

describe('MultiSelectField', () => {
  const options = [
    { value: 'http', label: 'http' },
    { value: 'tls', label: 'tls' },
    { value: 'quic', label: 'quic' },
  ]

  it('клик добавляет значение, повторный клик убирает; пусто → undefined', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MultiSelectField label="destOverride" options={options} value={['http']} onChange={onChange} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'tls' }))
    expect(onChange).toHaveBeenLastCalledWith(['http', 'tls'])
    rerender(<MultiSelectField label="destOverride" options={options} value={['http']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'http' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('выбранные чипы помечены aria-pressed', () => {
    render(<MultiSelectField label="destOverride" options={options} value={['tls']} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'tls' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'http' })).toHaveAttribute('aria-pressed', 'false')
  })
})

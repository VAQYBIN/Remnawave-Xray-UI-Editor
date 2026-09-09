import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NumberField, TriStateField } from '../src/features/inspector/fields'
import { ListEditor } from '../src/features/inspector/collections'

describe('TriStateField', () => {
  it('три состояния: не задано, да, нет — и явное false выразимо', async () => {
    const onChange = vi.fn()
    render(<TriStateField label="auto_route" value={undefined} onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'auto_route' })
    expect(screen.getByRole('button', { name: 'не задано' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'нет' }))
    expect(onChange).toHaveBeenLastCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: 'да' }))
    expect(onChange).toHaveBeenLastCalledWith(true)
    await userEvent.click(screen.getByRole('button', { name: 'не задано' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(group).toBeInTheDocument()
  })

  it('показывает текущее false нажатым', () => {
    render(<TriStateField label="x" value={false} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'нет' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('NumberField', () => {
  it('по умолчанию берёт только неотрицательные целые', async () => {
    const onChange = vi.fn()
    render(<NumberField label="n" value={undefined} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('n'), '-1')
    expect(onChange).not.toHaveBeenCalledWith(-1)
  })

  it('с min < 0 принимает отрицательные, с integer: false — дробные', async () => {
    const onChange = vi.fn()
    render(<NumberField label="m" value={undefined} onChange={onChange} min={-10} integer={false} />)
    const input = screen.getByLabelText('m')
    await userEvent.type(input, '-2.5')
    expect(onChange).toHaveBeenLastCalledWith(-2.5)
  })

  it('ниже min не пишет', async () => {
    const onChange = vi.fn()
    render(<NumberField label="k" value={undefined} onChange={onChange} min={1024} />)
    await userEvent.type(screen.getByLabelText('k'), '5')
    expect(onChange).not.toHaveBeenCalledWith(5)
  })

  it('подсказка рендерится', () => {
    render(<NumberField label="p" hint="Порт сервера." value={1} onChange={vi.fn()} />)
    expect(screen.getByText('Порт сервера.')).toBeInTheDocument()
  })
})

describe('ListEditor с перестановкой', () => {
  const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
  it('стрелки меняют соседей местами и гаснут на краях', async () => {
    const onChange = vi.fn()
    render(
      <ListEditor
        label="список"
        value={items}
        onChange={onChange}
        createItem={() => ({ name: '' })}
        addLabel="+ Ещё"
        reorder
        renderItem={(item) => <span>{item.name}</span>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Переместить элемент 1 выше' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Переместить элемент 3 ниже' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить элемент 2 выше' }))
    expect(onChange).toHaveBeenCalledWith([{ name: 'b' }, { name: 'a' }, { name: 'c' }])
  })

  it('без reorder стрелок нет', () => {
    render(
      <ListEditor
        label="список"
        value={items}
        onChange={vi.fn()}
        createItem={() => ({ name: '' })}
        addLabel="+ Ещё"
        renderItem={(item) => <span>{item.name}</span>}
      />,
    )
    expect(screen.queryByRole('button', { name: /Переместить/ })).toBeNull()
  })
})

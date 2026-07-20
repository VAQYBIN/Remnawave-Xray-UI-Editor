import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox, Select } from '../src/shared/ui'

describe('Select', () => {
  it('рендерит опции и меняет значение', async () => {
    const onChange = vi.fn()
    render(
      <Select aria-label="Прото" defaultValue="a" onChange={(e) => onChange(e.target.value)}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    )
    await userEvent.selectOptions(screen.getByLabelText('Прото'), 'b')
    expect(onChange).toHaveBeenCalledWith('b')
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

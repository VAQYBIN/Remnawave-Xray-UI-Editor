import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SchemaForm } from '../src/features/inspector/schema/SchemaForm'
import { map, ports, str } from '../src/shared/schema'
import type { DocOp, DocWriter } from '../src/shared/schema'

const FIELDS = [
  str('name', 'Имя.'),
  map('hosts', 'Хосты.', { values: 'strings' }),
  ports('ports', 'Порты.'),
]

describe('SchemaForm: расширения части 2', () => {
  it('замок с действием рисует кнопку и зовёт run', async () => {
    const run = vi.fn()
    const writer: DocWriter = {
      apply: vi.fn(),
      lockAt: (path) => (path.at(-1) === 'name' ? { reason: 'Через якорь.', action: { label: 'Развернуть значение здесь', run } } : null),
    }
    render(<SchemaForm fields={FIELDS} value={{ name: 'a' }} path={[]} writer={writer} />)
    expect(screen.getByText('Через якорь.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Развернуть значение здесь' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('map со strings читает строку и список, пишет списком', async () => {
    const ops: DocOp[] = []
    const writer: DocWriter = { apply: (next) => ops.push(...next), lockAt: () => null }
    render(
      <SchemaForm fields={FIELDS} value={{ hosts: { 'a.com': '1.1.1.1', 'b.com': ['2.2.2.2', '3.3.3.3'] } }} path={[]} writer={writer} />,
    )
    const values = screen.getAllByPlaceholderText('Значение') as HTMLInputElement[]
    expect(values.map((v) => v.value)).toEqual(['1.1.1.1', '2.2.2.2, 3.3.3.3'])
    await userEvent.type(values[0]!, ', 4.4.4.4')
    expect(ops.at(-1)).toEqual({
      op: 'set', path: ['hosts'],
      value: { 'a.com': ['1.1.1.1', '4.4.4.4'], 'b.com': ['2.2.2.2', '3.3.3.3'] },
    })
  })

  it('элемент port: цифры пишутся числом, диапазон — строкой', async () => {
    const ops: DocOp[] = []
    const writer: DocWriter = { apply: (next) => ops.push(...next), lockAt: () => null }
    render(<SchemaForm fields={FIELDS} value={{ ports: [80] }} path={[]} writer={writer} />)
    const area = screen.getByLabelText('ports')
    await userEvent.type(area, '\n8080-8880')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['ports'], value: [80, '8080-8880'] })
  })
})

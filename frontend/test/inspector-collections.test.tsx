import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeyValueField, ListEditor } from '../src/features/inspector/collections'
import { TextField } from '../src/features/inspector/fields'

describe('KeyValueField', () => {
  it('редактирование значения отдаёт объект; строки с пустым ключом отбрасываются', async () => {
    const onChange = vi.fn()
    render(<KeyValueField label="Заголовки" value={{ Host: 'a.com' }} onChange={onChange} />)
    const valueInput = screen.getByDisplayValue('a.com')
    await userEvent.clear(valueInput)
    await userEvent.type(valueInput, 'b.com')
    expect(onChange).toHaveBeenLastCalledWith({ Host: 'b.com' })
  })

  it('добавляет пустую строку по кнопке, удаляет по крестику; пусто → undefined', async () => {
    const onChange = vi.fn()
    render(<KeyValueField label="Заголовки" value={{ Host: 'a.com' }} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Пара'))
    expect(screen.getAllByPlaceholderText('Ключ')).toHaveLength(2)
    await userEvent.click(screen.getByLabelText('Удалить пару 1'))
    await userEvent.click(screen.getByLabelText('Удалить пару 1'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

interface Peer {
  publicKey?: string
  endpoint?: string
}

function PeersEditor({ value, onChange }: { value: Peer[] | undefined; onChange: (v: Peer[] | undefined) => void }) {
  return (
    <ListEditor<Peer>
      label="Пиры"
      value={value}
      onChange={onChange}
      createItem={() => ({})}
      addLabel="+ Пир"
      renderItem={(item, update) => (
        <TextField label="Endpoint" value={item.endpoint} onChange={(v) => update({ endpoint: v })} />
      )}
    />
  )
}

describe('ListEditor', () => {
  it('добавляет элемент из createItem и правит поле через update', async () => {
    const onChange = vi.fn()
    render(<PeersEditor value={undefined} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Пир'))
    expect(onChange).toHaveBeenLastCalledWith([{}])
  })

  it('update патчит нужный элемент по индексу', async () => {
    const onChange = vi.fn()
    render(<PeersEditor value={[{ endpoint: 'a:1' }, { endpoint: 'b:2' }]} onChange={onChange} />)
    const second = screen.getByDisplayValue('b:2')
    await userEvent.type(second, '5')
    expect(onChange).toHaveBeenLastCalledWith([{ endpoint: 'a:1' }, { endpoint: 'b:25' }])
  })

  it('удаляет элемент по крестику; пусто → undefined', async () => {
    const onChange = vi.fn()
    render(<PeersEditor value={[{ endpoint: 'a:1' }]} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Удалить элемент 1'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

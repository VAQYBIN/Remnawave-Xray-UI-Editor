import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoSubRuleForm } from '../src/features/inspector/MihomoSubRuleForm'
import { makeWriter } from './schemaHelpers'

describe('форма подсписка Mihomo', () => {
  it('подсписок: карточки правил, порядок, удаление, добавление, переименование', async () => {
    const { ops, writer } = makeWriter()
    const onRename = vi.fn(() => null)
    render(
      <MihomoSubRuleForm
        rules={['DOMAIN,a.com,DIRECT', 'MATCH,REJECT']}
        path={['sub-rules', 's']}
        writer={writer}
        refs={{ 'proxy-target': ['DIRECT', 'REJECT'] }}
        name="s"
        onRename={onRename}
      />,
    )
    expect(screen.getAllByLabelText('Тип')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Переместить элемент 2 выше' }))
    expect(ops.at(-1)).toEqual({ op: 'move', path: ['sub-rules', 's'], from: 1, to: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'Удалить элемент 1' }))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['sub-rules', 's', 0] })
    await userEvent.click(screen.getByRole('button', { name: '+ Правило' }))
    expect(ops.at(-1)).toEqual({ op: 'insert', path: ['sub-rules', 's'], index: 2, value: 'DOMAIN-SUFFIX,example.com,DIRECT' })
    await userEvent.type(screen.getByLabelText('Имя'), '2')
    // Коммит — на blur/Enter, не на каждой клавише (I1)
    expect(onRename).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(onRename).toHaveBeenLastCalledWith('s2')
  })

  // Пустой подсписок — обычное дело (заведён только что); кнопка ниже сама
  // заводит первое правило, форма не должна выглядеть как ошибка.
  it('пустой подсписок предлагает завести первое правило', () => {
    const { writer } = makeWriter()
    render(
      <MihomoSubRuleForm
        rules={[]}
        path={['sub-rules', 's']}
        writer={writer}
        refs={{}}
        name="s"
        onRename={vi.fn(() => null)}
      />,
    )
    expect(screen.getByText(/Правил пока нет/)).toBeInTheDocument()
  })
})

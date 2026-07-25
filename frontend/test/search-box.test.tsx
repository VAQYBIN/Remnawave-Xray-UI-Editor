import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBox } from '../src/features/topology/SearchBox'
import type { SearchHit } from '../src/entities/graph/search'

const HITS: SearchHit[] = [
  { nodeId: 'in:vless-in', kind: 'inbound', title: 'vless-in', matchedOn: 'тег: vless-in' },
  { nodeId: 'rule:0', kind: 'rule', title: 'правило 1', matchedOn: 'домен: geosite:google' },
]

describe('SearchBox', () => {
  it('ввод уходит наверх', async () => {
    const onQuery = vi.fn()
    render(<SearchBox query="" hits={[]} onQuery={onQuery} onPick={() => {}} />)
    await userEvent.type(screen.getByLabelText('Поиск по конфигу'), 'vl')
    expect(onQuery).toHaveBeenCalled()
  })

  it('показывает совпадения и объясняет их', () => {
    render(<SearchBox query="v" hits={HITS} onQuery={() => {}} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /vless-in/ })).toBeInTheDocument()
    expect(screen.getByText('домен: geosite:google')).toBeInTheDocument()
  })

  it('выбор отдаёт id узла', async () => {
    const onPick = vi.fn()
    render(<SearchBox query="v" hits={HITS} onQuery={() => {}} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: /правило 1/ }))
    expect(onPick).toHaveBeenCalledWith('rule:0')
  })

  it('пустой запрос списка не показывает', () => {
    render(<SearchBox query="" hits={HITS} onQuery={() => {}} onPick={() => {}} />)
    expect(screen.queryByRole('button', { name: /vless-in/ })).not.toBeInTheDocument()
  })

  it('запрос без совпадений говорит об этом прямо', () => {
    render(<SearchBox query="нетакого" hits={[]} onQuery={() => {}} onPick={() => {}} />)
    expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument()
  })
})

describe('SearchBox: фокус по сигналу', () => {
  it('focusSignal переводит фокус в поле поиска', () => {
    const { rerender } = render(
      <SearchBox query="" hits={[]} onQuery={vi.fn()} onPick={vi.fn()} focusSignal={0} />,
    )
    rerender(<SearchBox query="" hits={[]} onQuery={vi.fn()} onPick={vi.fn()} focusSignal={1} />)
    expect(screen.getByLabelText('Поиск по конфигу')).toHaveFocus()
  })
})

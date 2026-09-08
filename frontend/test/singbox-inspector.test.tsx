import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SingboxInspector } from '../src/features/topology/SingboxInspector'
import { parseSingbox } from '../src/entities/singbox/parse'
import type { SingboxDraft } from '../src/features/editor/useSingboxDraft'

const DOC = parseSingbox(`{
  "inbounds": [{"type":"tun","tag":"tun-in"}],
  "outbounds": [
    {"type":"selector","tag":"g","outbounds":null},
    {"type":"direct","tag":"direct"}
  ],
  "route": {"rules":[{"domain":["a.com"],"outbound":"direct"},{"action":"sniff"}]}
}`).doc!

/** Подставной черновик: инспектору нужны ровно эти поля, и подделывать больше нечего */
function makeDraft(selectedNode: string | null): SingboxDraft {
  return {
    selectedNode,
    changeDoc: vi.fn(),
    setSelectedNode: vi.fn(),
  } as unknown as SingboxDraft
}

describe('инспектор sing-box', () => {
  it('выбирает форму по префиксу id узла', () => {
    const { rerender } = render(
      <SingboxInspector draft={makeDraft('out:direct')} doc={DOC} nodeId="out:direct" />,
    )
    expect(screen.getByLabelText('Тег')).toHaveValue('direct')

    rerender(<SingboxInspector draft={makeDraft('rule:0')} doc={DOC} nodeId="rule:0" />)
    expect(screen.getByLabelText('Действие')).toBeInTheDocument()

    rerender(<SingboxInspector draft={makeDraft('inbound:tun-in')} doc={DOC} nodeId="inbound:tun-in" />)
    expect(screen.getByLabelText('Тег')).toHaveValue('tun-in')
  })

  it('узел подстановки показывает справку, а не форму', () => {
    // Содержимое создаёт панель: полей, которые тут можно править, нет вовсе
    render(<SingboxInspector draft={makeDraft('hosts:panel')} doc={DOC} nodeId="hosts:panel" />)
    expect(screen.getByText(/подставит панель/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Тег')).toBeNull()
  })

  it('кнопки порядка и удаления действуют на ВЫБРАННЫЙ узел, а не на проп', async () => {
    // Разойдись эти два источника — кнопка удалила бы не то, что на экране
    const draft = makeDraft('rule:1')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="rule:0" />)
    await userEvent.click(screen.getByRole('button', { name: /удалить правило/i }))
    const next = (draft.changeDoc as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    // Удалено правило #2 (выбранное), а не #1 из пропа
    expect(next.route.rules).toHaveLength(1)
    expect(next.route.rules[0].domain).toEqual(['a.com'])
  })

  it('удаление узла подстановки отказывает с причиной, а не молчит', async () => {
    const draft = makeDraft('hosts:panel')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="hosts:panel" />)
    expect(screen.queryByRole('button', { name: /удалить/i })).toBeNull()
    expect(draft.changeDoc).not.toHaveBeenCalled()
  })

  // План писал сюда clear + type('d2') и ждал тега «d2». Так не выходит:
  // подставной черновик документ назад не возвращает, поле управляемое, и React
  // возвращает ему прежнее значение после каждого события — набирается
  // «direct2», а не «d2». Проверка от этого не слабее: она спрашивает то же
  // самое — одна правка формы даёт РОВНО ОДНУ запись, и в ней документ целиком.
  it('правка формы уходит одной записью в changeDoc', async () => {
    const draft = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.type(screen.getByLabelText('Тег'), '2')
    const calls = (draft.changeDoc as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0]![0].outbounds[1].tag).toBe('direct2')
    // Документ доехал целиком: changeDoc принимает документ, а не патч
    expect(calls[0]![0].route.rules).toHaveLength(2)
  })

  it('смена тега уводит выбор за узлом', async () => {
    // Узел адресуется тегом: останься выбор на прежнем id, инспектор закрылся
    // бы прямо во время ввода
    const draft = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.type(screen.getByLabelText('Тег'), '2')
    expect(draft.setSelectedNode).toHaveBeenCalledWith('out:direct2')
  })

  it('пустой тег не пишется в документ, а объясняется', async () => {
    // Тег стёрли бы — и узел исчез бы с холста вместе с единственным способом
    // на него сослаться
    const draft = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    expect(draft.changeDoc).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/тег/i)
  })
})

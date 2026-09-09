import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SingboxInspector } from '../src/features/topology/SingboxInspector'
import { parseSingbox } from '../src/entities/singbox/parse'
import { applyOps, type DocOp, type Lock, type SchemaPath } from '../src/shared/schema'
import type { SingboxDraft } from '../src/features/editor/useSingboxDraft'
import { optionLabels, selectOption, selectedValue, singboxFixture } from './helpers'

const DOC = parseSingbox(`{
  "inbounds": [{"type":"tun","tag":"tun-in"}],
  "outbounds": [
    {"type":"selector","tag":"g","outbounds":null},
    {"type":"direct","tag":"direct"}
  ],
  "route": {"rules":[{"domain":["a.com"],"outbound":"direct"},{"action":"sniff"}]}
}`).doc!

/** Подставной черновик: правки применяются к документу, чтобы тесты видели результат */
function makeDraft(selectedNode: string | null, doc = DOC) {
  let current = doc
  const applyOpsFn = vi.fn((ops: DocOp[]) => { current = applyOps(current, ops) })
  const draft = {
    selectedNode,
    setSelectedNode: vi.fn(),
    changeDoc: vi.fn(),
    applyOps: applyOpsFn,
    lockAt: vi.fn((path: SchemaPath): Lock | null =>
      path.length === 3 && path[0] === 'outbounds' && path[2] === 'outbounds' ? { reason: 'Список заполняет панель.' } : null,
    ),
  } as unknown as SingboxDraft
  return { draft, doc: () => current }
}

describe('инспектор sing-box', () => {
  it('выбирает форму по префиксу id узла', () => {
    const { rerender } = render(
      <SingboxInspector draft={makeDraft('out:direct').draft} doc={DOC} nodeId="out:direct" />,
    )
    expect(screen.getByLabelText('Тег')).toHaveValue('direct')

    rerender(<SingboxInspector draft={makeDraft('rule:0').draft} doc={DOC} nodeId="rule:0" />)
    expect(screen.getByLabelText('Действие')).toBeInTheDocument()

    rerender(<SingboxInspector draft={makeDraft('inbound:tun-in').draft} doc={DOC} nodeId="inbound:tun-in" />)
    expect(screen.getByLabelText('Тег')).toHaveValue('tun-in')
  })

  // Словарь тип block больше не предлагает (удалён в 1.13), но документ уже
  // написан — открыть его надо как есть, объяснив замену, а не подменив тип
  // первым вариантом списка
  it('живой шаблон с удалённым типом открывается без потери', async () => {
    const doc = parseSingbox(singboxFixture('legacy')).doc!
    render(<SingboxInspector draft={makeDraft('out:block').draft} doc={doc} nodeId="out:block" />)
    expect(selectedValue('Тип')).toBe('block')
    expect(await optionLabels('Тип')).toContain('block')
    expect(screen.getByText(/устарело.*1\.13/i)).toBeInTheDocument()
  })

  it('карточка конечной точки не предлагает полей обычного выхода', async () => {
    // Узел `out:<tag>` рисуется и по endpoints: не различи инспектор список,
    // селект типа записал бы в endpoints тип outbound'а (vless), а поле
    // «Сервер» предложило бы править то, чего у wireguard нет
    const doc = parseSingbox(`{
      "outbounds": [{"type":"direct","tag":"direct"}],
      "endpoints": [{"type":"wireguard","tag":"wg","address":["10.0.0.2/32"]}]
    }`).doc!
    render(<SingboxInspector draft={makeDraft('out:wg').draft} doc={doc} nodeId="out:wg" />)
    expect(screen.getByLabelText('Тег')).toHaveValue('wg')
    expect(screen.queryByLabelText('Сервер')).toBeNull()
    expect(await optionLabels('Тип')).not.toContain('vless')
  })

  it('обычный выход правится как раньше', async () => {
    // 'direct' — не серверный тип (адреса у него нет): для проверки полей
    // обычного сервера нужен тип из SERVER_OUTBOUND_TYPES
    const doc = parseSingbox(`{
      "outbounds": [{"type":"vless","tag":"proxy","server":"1.2.3.4","server_port":443,"uuid":"u"}],
      "endpoints": [{"type":"wireguard","tag":"wg"}]
    }`).doc!
    render(<SingboxInspector draft={makeDraft('out:proxy').draft} doc={doc} nodeId="out:proxy" />)
    expect(screen.getByLabelText('Сервер')).toBeInTheDocument()
    expect(await optionLabels('Тип')).toContain('vless')
  })

  it('узел подстановки показывает справку, а не форму', () => {
    // Содержимое создаёт панель: полей, которые тут можно править, нет вовсе
    render(<SingboxInspector draft={makeDraft('hosts:panel').draft} doc={DOC} nodeId="hosts:panel" />)
    expect(screen.getByText(/подставит панель/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Тег')).toBeNull()
  })

  it('у узла подстановки нет кнопки удаления: записи под него в документе нет', () => {
    const { draft } = makeDraft('hosts:panel')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="hosts:panel" />)
    expect(screen.queryByRole('button', { name: /удалить/i })).toBeNull()
    expect(draft.applyOps).not.toHaveBeenCalled()
  })

  it('правка формы уходит операцией в черновик и ведёт выбор за новым тегом', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.type(screen.getByLabelText('Тег'), '2')
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'set', path: ['outbounds', 1, 'tag'], value: 'direct2' }])
    expect(draft.setSelectedNode).toHaveBeenCalledWith('out:direct2')
  })

  it('пустой тег отклоняется с объяснением, документ не трогается', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    expect(draft.applyOps).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/пустым он не остаётся/)
  })

  it('смена типа с direct на selector переводит выбор на group:', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await selectOption('Тип', 'selector')
    expect(draft.setSelectedNode).toHaveBeenCalledWith('group:direct')
  })

  it('порядок показывается у выхода и входа, а не только у правила', async () => {
    const { draft } = makeDraft('out:direct')
    const { rerender } = render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    expect(screen.getByText('порядок: 2 из 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить выше' }))
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'move', path: ['outbounds'], from: 1, to: 0 }])
    rerender(<SingboxInspector draft={makeDraft('inbound:tun-in').draft} doc={DOC} nodeId="inbound:tun-in" />)
    expect(screen.getByText('порядок: 1 из 1')).toBeInTheDocument()
  })

  it('перестановка правила ведёт выбор за ним', async () => {
    const { draft } = makeDraft('rule:1')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="rule:1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Переместить выше' }))
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'move', path: ['route', 'rules'], from: 1, to: 0 }])
    expect(draft.setSelectedNode).toHaveBeenCalledWith('rule:0')
  })

  it('doc:settings открывает панель «Документ»', () => {
    const { draft } = makeDraft('doc:settings')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="doc:settings" />)
    expect(screen.getByText('документ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DNS-серверы' })).toBeInTheDocument()
  })

  it('старые псевдоузлы больше не разводятся', () => {
    const { draft } = makeDraft('doc:rule-sets')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="doc:rule-sets" />)
    expect(screen.getByText('Для этого узла формы нет.')).toBeInTheDocument()
  })

  it('удаление выхода идёт операцией по индексу', async () => {
    const { draft } = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить выход' }))
    expect(draft.applyOps).toHaveBeenCalledWith([{ op: 'remove', path: ['outbounds', 1] }])
    expect(draft.setSelectedNode).toHaveBeenCalledWith(null)
  })
})

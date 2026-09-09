// Инспектор Mihomo поверх писателя (задача 10) и форм по схеме (задачи 11–12):
// формы получают writer = draft.writer без обёртки, имя правится через
// draft.rename, порядок и удаление — операциями draft.applyOps по пути записи.
// Помощник draftStub собирает минимум, который читает инспектор, не настоящий
// хук — тела форм и писателя здесь не участники теста.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { MihomoInspector } from '../src/features/topology/MihomoInspector'
import { selectOption } from './helpers'
import type { MihomoDraft } from '../src/features/editor/useMihomoDraft'

function draftStub(over: Record<string, unknown> = {}) {
  return {
    writer: { apply: vi.fn(), lockAt: () => null },
    rename: vi.fn(() => null),
    applyOps: vi.fn(),
    setSelectedNode: vi.fn(),
    selectedNode: null,
    lockAt: () => null,
    ...over,
  } as unknown as MihomoDraft
}

describe('инспектор узла Mihomo', () => {
  it('группа: форма группы, порядок и удаление через операции', async () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\n  - name: B\n    type: select\n')
    const draft = draftStub({ selectedNode: 'group:B' })
    render(<MihomoInspector draft={draft} md={md} nodeId="group:B" />)
    expect(screen.getByText('порядок: 2 из 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить выше' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'move', path: ['proxy-groups'], from: 1, to: 0 }])
    await userEvent.click(screen.getByRole('button', { name: 'Удалить группу' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'remove', path: ['proxy-groups', 1] }], null)
  })

  it('сервер и провайдер: свои формы; у провайдера только удаление по имени', async () => {
    const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nproxy-providers:\n  P: {type: http, url: u}\n')
    const { rerender } = render(<MihomoInspector draft={draftStub({ selectedNode: 'proxy:s' })} md={md} nodeId="proxy:s" />)
    expect(screen.getByText('сервер')).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toHaveValue('s')
    const draft = draftStub({ selectedNode: 'provider:P' })
    rerender(<MihomoInspector draft={draft} md={md} nodeId="provider:P" />)
    expect(screen.queryByText(/порядок:/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Удалить провайдера' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'remove', path: ['proxy-providers', 'P'] }], null)
  })

  it('переименование идёт через draft.rename с видом записи', async () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\n    type: select\n')
    const draft = draftStub({ selectedNode: 'group:A' })
    render(<MihomoInspector draft={draft} md={md} nodeId="group:A" />)
    await userEvent.type(screen.getByLabelText('Имя'), 'B')
    expect(draft.rename).toHaveBeenLastCalledWith('group', 'A', 'AB')
  })

  it('подсписок редактируется формой; правило подсписка пишет по пути sub-rules', async () => {
    const md = parseMihomo('sub-rules:\n  s:\n    - DOMAIN,a.com,DIRECT\n')
    const draft = draftStub({ selectedNode: 'subrule:s' })
    render(<MihomoInspector draft={draft} md={md} nodeId="subrule:s" />)
    await selectOption('Тип', 'DOMAIN-SUFFIX')
    expect(draft.writer.apply).toHaveBeenLastCalledWith([{ op: 'set', path: ['sub-rules', 's', 0], value: 'DOMAIN-SUFFIX,a.com,DIRECT' }])
  })

  it('перестановка правила ведёт выбор за ним', async () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\n  - MATCH,REJECT\n')
    const draft = draftStub({ selectedNode: 'rule:0' })
    render(<MihomoInspector draft={draft} md={md} nodeId="rule:0" />)
    await userEvent.click(screen.getByRole('button', { name: 'Переместить ниже' }))
    expect(draft.applyOps).toHaveBeenLastCalledWith([{ op: 'move', path: ['rules'], from: 0, to: 1 }], 'rule:1')
  })

  it('doc:settings открывает панель «Документ»', () => {
    const md = parseMihomo('mode: rule\n')
    render(<MihomoInspector draft={draftStub({ selectedNode: 'doc:settings' })} md={md} nodeId="doc:settings" />)
    expect(screen.getByText('документ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Общие' })).toBeInTheDocument()
  })
})

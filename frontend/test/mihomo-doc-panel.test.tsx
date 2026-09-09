// Панель «Документ» Mihomo поверх общего DocPanel: раздел-объект без
// контейнеров, разделы-отображения (наборы, провайдеры, подсписки) по имени
// записи, раздел-список для входов. draftStub — тот же минимум, что у
// mihomo-inspector.test.tsx: панель читает только draft.writer и draft.rename.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { MihomoDocPanel } from '../src/features/topology/MihomoDocPanel'
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

describe('панель «Документ» Mihomo', () => {
  it('раздел «Общие» — корневые скаляры без контейнеров; DNS заводится стартером', async () => {
    const md = parseMihomo('mode: rule\nproxy-groups: []\n')
    const draft = draftStub()
    render(<MihomoDocPanel draft={draft} md={md} />)
    await userEvent.click(screen.getByRole('button', { name: 'Общие' }))
    const general = screen.getByRole('region', { name: 'Общие' })
    expect(within(general).getByLabelText('mode')).toBeInTheDocument()
    expect(within(general).queryByText('proxy-groups')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'DNS' }))
    await userEvent.click(within(screen.getByRole('region', { name: 'DNS' })).getByRole('button', { name: 'Завести раздел' }))
    expect(draft.writer.apply).toHaveBeenLastCalledWith([{ op: 'set', path: ['dns'], value: expect.objectContaining({ enable: true, 'enhanced-mode': 'fake-ip' }) }])
  })

  it('наборы правил — записи по имени с формой набора; «+ Набор правил» заводит ruleset', async () => {
    const md = parseMihomo('rule-providers:\n  ads: {type: http, behavior: domain, url: u}\n')
    const draft = draftStub()
    render(<MihomoDocPanel draft={draft} md={md} />)
    await userEvent.click(screen.getByRole('button', { name: 'Наборы правил' }))
    const region = screen.getByRole('region', { name: 'Наборы правил' })
    expect(within(region).getByLabelText('Имя')).toHaveValue('ads')
    expect(within(region).getByLabelText('url')).toHaveValue('u')
    await userEvent.click(within(region).getByRole('button', { name: '+ Набор правил' }))
    expect(draft.writer.apply).toHaveBeenLastCalledWith([{ op: 'set', path: ['rule-providers', 'ruleset'], value: { type: 'http', behavior: 'domain', format: 'mrs', url: '', interval: 86400 } }])
  })

  it('входы — список с формой входа; подсписки — форма подсписка', async () => {
    const md = parseMihomo('listeners:\n  - {name: l, type: mixed, port: 1}\nsub-rules:\n  s: [MATCH,DIRECT]\n')
    const draft = draftStub()
    render(<MihomoDocPanel draft={draft} md={md} />)
    await userEvent.click(screen.getByRole('button', { name: 'Входы' }))
    expect(within(screen.getByRole('region', { name: 'Входы' })).getByLabelText('Имя')).toHaveValue('l')
    await userEvent.click(screen.getByRole('button', { name: 'Подсписки' }))
    expect(within(screen.getByRole('region', { name: 'Подсписки' })).getByRole('button', { name: '+ Правило' })).toBeInTheDocument()
  })
})

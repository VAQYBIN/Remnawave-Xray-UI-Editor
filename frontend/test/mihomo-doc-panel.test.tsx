// Панель «Документ» Mihomo поверх общего DocPanel: раздел-объект без
// контейнеров, разделы-отображения (наборы, провайдеры, подсписки) по имени
// записи, раздел-список для входов. draftStub — тот же минимум, что у
// mihomo-inspector.test.tsx: панель читает только draft.writer и draft.rename.

import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { applyMihomoOps } from '../src/entities/mihomo/write'
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

/**
 * Черновик с НАСТОЯЩИМ писателем: `apply` прогоняет операции через
 * `applyMihomoOps` и держит результат в состоянии — то, что `draftStub` (голый
 * `vi.fn()`) не может показать: `md` там никогда не меняется, а значит и
 * компонент `MihomoDocPanel` никогда не перерендеривается, и вопрос
 * «переживает ли открытая форма перерендер» не встаёт вовсе.
 */
function RealDraftHarness({ initial }: { initial: string }) {
  const [md, setMd] = useState(() => parseMihomo(initial))
  const draft = {
    writer: {
      apply: (ops: Parameters<typeof applyMihomoOps>[1]) => {
        const { md: next } = applyMihomoOps(md, ops)
        setMd(next)
      },
      lockAt: () => null,
    },
    rename: () => null,
  } as unknown as MihomoDraft
  return <MihomoDocPanel draft={draft} md={md} />
}

describe('панель «Документ» Mihomo — стабильность форм при перерендере', () => {
  // DocPanel рендерит spec.Form КАК ТИП КОМПОНЕНТА: другая функция на каждый
  // рендер — для React другой компонент, и он размонтирует поддерево карточки
  // целиком. Схема пишет операцию на каждое нажатие клавиши, значит `md`
  // (а с ним и весь MihomoDocPanel) меняется на каждый символ — без
  // мемоизации таблиц lists/maps открытое поле слетало бы с фокуса на первом
  // же символе. draftStub с vi.fn() этого не поймал бы: md там не меняется.
  it('ввод в поле записи не размонтирует форму: фокус переживает правку', async () => {
    render(<RealDraftHarness initial={'listeners:\n  - {name: l, type: mixed, port: 1}\n'} />)
    await userEvent.click(screen.getByRole('button', { name: 'Входы' }))
    const input = within(screen.getByRole('region', { name: 'Входы' })).getByLabelText('Имя')
    input.focus()
    await userEvent.type(input, 'x')
    expect(document.activeElement).toBe(input)
    expect(input).toHaveValue('lx')
  })

  it('ввод в поле провайдера не размонтирует форму: фокус переживает правку', async () => {
    render(<RealDraftHarness initial={'proxy-providers:\n  P: {type: http, url: u}\n'} />)
    await userEvent.click(screen.getByRole('button', { name: 'Провайдеры' }))
    const input = within(screen.getByRole('region', { name: 'Провайдеры' })).getByLabelText('url')
    input.focus()
    await userEvent.type(input, '1')
    expect(document.activeElement).toBe(input)
    expect(input).toHaveValue('u1')
  })
})

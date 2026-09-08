import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { EditorShell, type EditorShellProps } from '../src/features/editor/EditorShell'
import type { EditorShellDraft } from '../src/features/editor/useDocumentDraft'

function shellDraft(over: Partial<EditorShellDraft> = {}): EditorShellDraft {
  return {
    docKey: 'u-1',
    text: 'текст',
    dirty: false,
    issues: [],
    errorCount: 0,
    warningCount: 0,
    tab: 'graph',
    openGraphTab: vi.fn(),
    openTextTab: vi.fn(),
    undoAvailable: false,
    redoAvailable: false,
    doUndo: vi.fn(),
    doRedo: vi.fn(),
    canSelectIssue: () => true,
    selectIssue: vi.fn(),
    issuesOpen: false,
    setIssuesOpen: vi.fn(),
    shortcutsOpen: false,
    setShortcutsOpen: vi.fn(),
    writeDraft: vi.fn(),
    resetDraft: vi.fn(),
    setSelectedNode: vi.fn(),
    ...over,
  }
}

function renderShell(draft: EditorShellDraft, over: Partial<EditorShellProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditorShell
          draft={draft}
          kind="templates"
          back={{ to: '/templates', label: '← Шаблоны' }}
          title="Документ"
          tabs={{ graph: 'Топология' }}
          validLabel="Конфиг валиден"
          canvas={<div>канвас</div>}
          textView={<div>текст документа</div>}
          save={<button type="button">Сохранить в панель</button>}
          {...over}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EditorShell', () => {
  // Подпись графа приходит пропом, подпись ТЕКСТОВОЙ вкладки — выводится из
  // формата документа: второй проп рядом с docFormat был бы второй истиной о
  // формате, и «YAML» на вкладке могло бы соседствовать с json-поведением
  // диалога версий
  it('подпись графа приходит пропсом, а текстовой вкладки — из формата документа', () => {
    renderShell(shellDraft())
    expect(screen.getByRole('button', { name: 'Топология' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'YAML' })).toBeNull()
  })

  it('docFormat=yaml переименовывает текстовую вкладку', () => {
    renderShell(shellDraft(), { docFormat: 'yaml' })
    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'JSON' })).toBeNull()
  })

  it('на вкладке графа показывает канвас, на текстовой — текстовый слот', () => {
    const { rerender } = renderShell(shellDraft())
    expect(screen.getByText('канвас')).toBeInTheDocument()
    // Отрицательные утверждения обязательны: без них тест пройдёт и у оболочки,
    // которая рендерит оба слота сразу, то есть не проверит саму разводку
    expect(screen.queryByText('текст документа')).toBeNull()
    rerender(<div />)
    renderShell(shellDraft({ tab: 'text' }))
    expect(screen.getByText('текст документа')).toBeInTheDocument()
    expect(screen.queryByText('канвас')).toBeNull()
  })

  it('слоты попадают каждый в своё место разметки', () => {
    const { container } = renderShell(shellDraft(), {
      subtitle: 'подзаголовок-маркер',
      actions: <button type="button">кнопка-маркер</button>,
      statusExtra: <span>статус-маркер</span>,
      children: <span>диалог-маркер</span>,
    })
    const topbar = container.querySelector('.wb-topbar') as HTMLElement
    const title = container.querySelector('.wb-title') as HTMLElement
    const statusbar = container.querySelector('.wb-statusbar') as HTMLElement
    const stage = container.querySelector('.wb-stage') as HTMLElement

    expect(within(title).getByText('подзаголовок-маркер')).toBeInTheDocument()
    expect(within(topbar).getByRole('button', { name: 'кнопка-маркер' })).toBeInTheDocument()
    expect(within(statusbar).getByText('статус-маркер')).toBeInTheDocument()
    // children — поток диалогов: ни в топбаре, ни в статус-баре, ни на сцене
    const dialogSlot = screen.getByText('диалог-маркер')
    expect(topbar.contains(dialogSlot)).toBe(false)
    expect(statusbar.contains(dialogSlot)).toBe(false)
    expect(stage.contains(dialogSlot)).toBe(false)
    expect(container.querySelector('.workbench')?.contains(dialogSlot)).toBe(true)
  })

  it('подпись «проблем нет» приходит пропсом', () => {
    renderShell(shellDraft(), { validLabel: 'Документ в порядке' })
    expect(screen.getByText('Документ в порядке')).toBeInTheDocument()
    // Расхождение подписей и доказывает, что строка не зашита в хроме
    expect(screen.queryByText('Конфиг валиден')).toBeNull()
  })

  it('счётчики проблем раскрываются в список', async () => {
    const issues = [
      { parts: ['rules', 0], path: 'rules.0', message: 'плохое правило', level: 'error' as const },
    ]
    renderShell(shellDraft({ issues, errorCount: 1, issuesOpen: true }))
    expect(screen.getByText('ошибок: 1')).toBeInTheDocument()
    expect(screen.getByText(/плохое правило/)).toBeInTheDocument()
  })

  it('сброс черновика спрашивает подтверждение и только потом зовёт resetDraft', async () => {
    const resetDraft = vi.fn()
    renderShell(shellDraft({ dirty: true, resetDraft }))
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить к версии панели' }))
    expect(resetDraft).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(resetDraft).toHaveBeenCalledOnce()
  })
})

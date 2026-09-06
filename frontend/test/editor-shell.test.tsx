import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { EditorShell } from '../src/features/editor/EditorShell'
import type { EditorShellDraft } from '../src/features/editor/useDocumentDraft'

function shellDraft(over: Partial<EditorShellDraft> = {}): EditorShellDraft {
  return {
    docKey: 'u-1',
    storageKey: 'template:u-1',
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

function renderShell(draft: EditorShellDraft) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditorShell
          draft={draft}
          kind="templates"
          back={{ to: '/templates', label: '← Шаблоны' }}
          title="Документ"
          tabs={{ graph: 'Топология', text: 'YAML' }}
          canvas={<div>канвас</div>}
          textView={<div>текст документа</div>}
          save={<button type="button">Сохранить в панель</button>}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EditorShell', () => {
  it('подписи вкладок приходят пропсом', () => {
    renderShell(shellDraft())
    expect(screen.getByRole('button', { name: 'Топология' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument()
  })

  it('на вкладке графа показывает канвас, на текстовой — текстовый слот', () => {
    const { rerender } = renderShell(shellDraft())
    expect(screen.getByText('канвас')).toBeInTheDocument()
    rerender(<div />)
    renderShell(shellDraft({ tab: 'text' }))
    expect(screen.getByText('текст документа')).toBeInTheDocument()
  })

  it('без проблем статус-бар говорит, что документ валиден', () => {
    renderShell(shellDraft())
    expect(screen.getByText('Конфиг валиден')).toBeInTheDocument()
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

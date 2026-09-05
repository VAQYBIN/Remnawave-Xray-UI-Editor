// Проводка Workbench → TopologyView. Отдельный файл, потому что TopologyView здесь
// подменён моком: в настоящем живёт док с кнопками «+ Рецепт» и поиском, на которые
// смотрят тесты в workbench.test.tsx.
//
// Без этого теста регресс возвращается незамеченным: подмени в Workbench
// `docKey={draft.storageKey}` на `docKey={draft.docKey}` — и весь набор останется
// зелёным, а профиль и шаблон с совпавшим uuid снова разделят запись позиций.
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Workbench } from '../src/features/editor/Workbench'
import { useConfigDraft } from '../src/features/editor/useConfigDraft'
import { useDraftStore } from '../src/features/editor/draftStore'
import { usePositionsStore } from '../src/features/topology/positionsStore'

// Мок кладёт позицию узла ровно тем ключом, который получил пропом, — то есть
// проверяется не словарь positionsStore, а именно значение docKey из Workbench
vi.mock('../src/features/topology/TopologyView', () => ({
  TopologyView: ({ docKey }: { docKey: string }) => {
    usePositionsStore.getState().setPosition(docKey, 'in:socks', { x: 10, y: 20 })
    return <div data-testid="topology" data-dockey={docKey} />
  },
}))

const CONFIG = {
  log: { loglevel: 'warning' },
  inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

const UUID = 'same-uuid'

function Harness({ docKind }: { docKind: 'profile' | 'template' }) {
  const draft = useConfigDraft({ docKind, docKey: UUID, panelConfig: CONFIG, baseVersion: 'v1', ctx: {} })
  return (
    <Workbench
      draft={draft}
      kind={docKind === 'profile' ? 'profiles' : 'templates'}
      back={{ to: '/', label: '← Назад' }}
      title="Документ"
      save={<button type="button">Сохранить в панель</button>}
    />
  )
}

function renderWorkbench(docKind: 'profile' | 'template') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Harness docKind={docKind} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Workbench → TopologyView', () => {
  beforeEach(() => {
    localStorage.clear()
    useDraftStore.setState({ drafts: {} })
    usePositionsStore.setState({ positions: {} })
  })

  it('шаблону достаётся ключ с префиксом вида, а не голый uuid', () => {
    renderWorkbench('template')
    expect(screen.getByTestId('topology')).toHaveAttribute('data-dockey', `template:${UUID}`)
    const stored = usePositionsStore.getState().positions
    expect(stored[`template:${UUID}`]?.['in:socks']).toEqual({ x: 10, y: 20 })
    expect(stored[UUID]).toBeUndefined()
  })

  it('профиль с тем же uuid пишет позиции в свою запись', () => {
    renderWorkbench('profile')
    expect(screen.getByTestId('topology')).toHaveAttribute('data-dockey', `profile:${UUID}`)
    expect(usePositionsStore.getState().positions[`profile:${UUID}`]).toBeDefined()
    expect(usePositionsStore.getState().positions[`template:${UUID}`]).toBeUndefined()
  })
})

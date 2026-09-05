import { act, render, renderHook, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Workbench } from '../src/features/editor/Workbench'
import { useConfigDraft } from '../src/features/editor/useConfigDraft'
import { useDraftStore } from '../src/features/editor/draftStore'
import { usePositionsStore } from '../src/features/topology/positionsStore'

const CONFIG = {
  log: { loglevel: 'warning' },
  inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

function Harness({ recipes }: { recipes?: boolean }) {
  const draft = useConfigDraft({
    docKind: 'template',
    docKey: 'doc-1',
    panelConfig: CONFIG,
    baseVersion: 'v1',
    ctx: {},
  })
  return (
    <Workbench
      draft={draft}
      kind="templates"
      back={{ to: '/templates', label: '← Шаблоны' }}
      title="Мой шаблон"
      onOpenRecipes={recipes ? () => {} : undefined}
      save={<button type="button">Сохранить в панель</button>}
    />
  )
}

function renderWorkbench(props: { recipes?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Harness {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Workbench', () => {
  it('рисует заголовок, вкладки и кнопку сохранения страницы', () => {
    renderWorkbench()
    expect(screen.getByRole('heading', { name: 'Мой шаблон' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Топология' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить в панель' })).toBeInTheDocument()
  })

  // Пара из положительного и отрицательного случая: без первого второй тихо
  // выродился бы в тавтологию, перестань док рисоваться вовсе
  it('с обработчиком рецептов кнопка есть', () => {
    renderWorkbench({ recipes: true })
    expect(screen.getByRole('button', { name: /Рецепт/ })).toBeInTheDocument()
  })

  it('без обработчика рецептов кнопки рецептов нет', () => {
    renderWorkbench()
    expect(screen.queryByRole('button', { name: /Рецепт/ })).not.toBeInTheDocument()
  })

  it('валидный документ не показывает проблем', () => {
    renderWorkbench()
    expect(screen.getByText('Конфиг валиден')).toBeInTheDocument()
  })
})

// Uuid конфиг-профиля и uuid шаблона подписки живут в разных пространствах панели
// и вполне могут совпасть. Ради этого случая ключи локальных хранилищ разведены по
// виду документа — здесь проверяется, что развод действительно работает.
describe('ключи хранилищ разведены по виду документа', () => {
  const UUID = 'same-uuid'

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  function draftOf(docKind: 'profile' | 'template') {
    return renderHook(
      () =>
        useConfigDraft({ docKind, docKey: UUID, panelConfig: CONFIG, baseVersion: 'v1', ctx: {} }),
      { wrapper },
    )
  }

  beforeEach(() => {
    localStorage.clear()
    useDraftStore.setState({ drafts: {} })
    usePositionsStore.setState({ positions: {} })
  })

  it('storageKey префиксован видом, а docKey остаётся голым uuid', () => {
    const profile = draftOf('profile')
    const template = draftOf('template')
    // docKey уходит в адрес бэкапов (/api/profiles/<uuid>/backups) — префикс сломал бы запрос
    expect(profile.result.current.docKey).toBe(UUID)
    expect(template.result.current.docKey).toBe(UUID)
    expect(profile.result.current.storageKey).toBe(`profile:${UUID}`)
    expect(template.result.current.storageKey).toBe(`template:${UUID}`)
  })

  it('черновик профиля не виден шаблону с тем же uuid', () => {
    const profile = draftOf('profile')
    const template = draftOf('template')

    act(() => profile.result.current.writeDraft('{"a":1}', { history: false }))

    expect(profile.result.current.text).toBe('{"a":1}')
    expect(profile.result.current.dirty).toBe(true)
    // Шаблон продолжает показывать документ панели: чужой черновик его не касается
    expect(template.result.current.text).toBe(JSON.stringify(CONFIG, null, 2))
    expect(template.result.current.dirty).toBe(false)
  })

  it('шаг истории одного документа не даёт undo другому', () => {
    const profile = draftOf('profile')
    const template = draftOf('template')

    act(() => profile.result.current.writeDraft('{"a":1}', { history: true }))

    expect(profile.result.current.undoAvailable).toBe(true)
    expect(template.result.current.undoAvailable).toBe(false)
  })

  it('позиции узлов профиля и шаблона независимы', () => {
    const profile = draftOf('profile')
    const template = draftOf('template')
    const { setPosition } = usePositionsStore.getState()

    // Ровно тот ключ, который Workbench отдаёт TopologyView пропом docKey
    setPosition(profile.result.current.storageKey, 'in:socks', { x: 10, y: 20 })
    setPosition(template.result.current.storageKey, 'in:socks', { x: 99, y: 99 })

    const stored = usePositionsStore.getState().positions
    expect(stored[`profile:${UUID}`]?.['in:socks']).toEqual({ x: 10, y: 20 })
    expect(stored[`template:${UUID}`]?.['in:socks']).toEqual({ x: 99, y: 99 })

    usePositionsStore.getState().resetPositions(`template:${UUID}`)
    expect(usePositionsStore.getState().positions[`profile:${UUID}`]).toBeDefined()
  })
})

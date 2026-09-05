import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Workbench } from '../src/features/editor/Workbench'
import { useConfigDraft } from '../src/features/editor/useConfigDraft'

const CONFIG = {
  log: { loglevel: 'warning' },
  inbounds: [{ tag: 'socks', protocol: 'socks', port: 10808 }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

function Harness({ recipes }: { recipes?: boolean }) {
  const draft = useConfigDraft({
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

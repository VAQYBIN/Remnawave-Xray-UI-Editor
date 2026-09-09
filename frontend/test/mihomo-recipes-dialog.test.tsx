import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecipesDialog } from '../src/features/recipes/RecipesDialog'
import { MIHOMO_RECIPE_ENTRIES } from '../src/features/recipes/mihomoRecipes'
import { parseMihomo, type MihomoDoc } from '../src/entities/mihomo'
import { mihomoFixture } from './helpers'

function renderWith(md: MihomoDoc) {
  const onApply = vi.fn<(next: MihomoDoc) => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RecipesDialog
        open
        model={md}
        entries={MIHOMO_RECIPE_ENTRIES}
        print={(m) => m.text}
        onApply={onApply}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
  return { onApply }
}

describe('диалог рецептов Mihomo', () => {
  it('показывает все шесть рецептов', () => {
    renderWith(parseMihomo(mihomoFixture('default')))
    expect(screen.getByRole('button', { name: /Разделить трафик по наборам правил/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Блокировка рекламы/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /DNS с fake-ip/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Локальный вход/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Локальные сети напрямую/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /WARP-сервер/ })).toBeInTheDocument()
  })

  it('split показывает каталог наборов и цели документа, без цели — ошибка валидации', async () => {
    renderWith(parseMihomo(mihomoFixture('default')))
    await userEvent.click(screen.getByRole('button', { name: /Разделить трафик по наборам правил/ }))
    expect(screen.getByText('Реклама (category-ads-all)')).toBeInTheDocument()
    expect(screen.getByText('Укажите цель')).toBeInTheDocument()
  })

  it('применение ads пишет правило блокировки рекламы в модель', async () => {
    const { onApply } = renderWith(parseMihomo(''))
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    const applied = onApply.mock.calls[0]![0] as MihomoDoc
    expect(applied.text).toContain('RULE-SET,geosite-category-ads-all,REJECT')
  })
})

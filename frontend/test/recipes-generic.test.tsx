import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecipesDialog, type RecipeEntry } from '../src/features/recipes/RecipesDialog'
import { TextField } from '../src/features/inspector/fields'

interface Model { items: string[] }
interface Params { name: string }

const ADD: RecipeEntry<Model, Params> = {
  recipe: {
    id: 'add',
    title: 'Добавить элемент',
    summary: 'Кладёт имя в список',
    defaults: { name: 'x' },
    validate: (p) => (p.name.trim() === '' ? 'Укажите имя' : null),
    plan: (m, p) =>
      m.items.includes(p.name)
        ? { model: m, changes: [{ status: 'exists', text: `${p.name} — уже есть` }], notes: [] }
        : { model: { items: [...m.items, p.name] }, changes: [{ status: 'add', text: p.name }], notes: [{ text: 'заметка' }] },
  },
  Form: ({ value, onChange }) => (
    <TextField label="Имя" value={value.name} onChange={(v) => onChange({ name: v ?? '' })} />
  ),
}

describe('обобщённый диалог рецептов', () => {
  it('показывает план по модели и применяет его', async () => {
    const onApply = vi.fn()
    render(
      <RecipesDialog open model={{ items: [] }} entries={[ADD]} print={(m) => JSON.stringify(m)} onApply={onApply} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /Добавить элемент/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.getByText('заметка')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(onApply).toHaveBeenCalledWith({ items: ['x'] })
  })

  it('без новых изменений кнопка «Применить» выключена, ошибка параметров видна', async () => {
    render(
      <RecipesDialog open model={{ items: ['x'] }} entries={[ADD]} print={(m) => JSON.stringify(m)} onApply={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Имя'))
    expect(screen.getByText('Укажите имя')).toBeInTheDocument()
  })

  it('закрытый диалог не рисует форм', () => {
    render(
      <RecipesDialog open={false} model={{ items: [] }} entries={[ADD]} print={(m) => JSON.stringify(m)} onApply={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.queryByLabelText('Имя')).toBeNull()
  })
})

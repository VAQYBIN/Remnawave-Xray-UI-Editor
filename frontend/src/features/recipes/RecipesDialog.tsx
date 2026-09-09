// Диалог рецептов, обобщённый по модели: список слева, форма параметров и
// предпросмотр справа, diff по кнопке. Реестр Xray стал первым экземпляром
// (`xrayRecipes.tsx`), поведение и разметка у него прежние — его тесты
// контрольная группа этого обобщения.

import { useMemo, useState, type ReactNode } from 'react'
import type { Recipe, RecipePlan } from '../../shared/recipes/types'
import { Button, Dialog } from '../../shared/ui'
import { DiffView } from '../editor/DiffView'

export interface RecipeEntry<TModel, TParams = unknown> {
  recipe: Recipe<TModel, TParams>
  Form: (props: { value: TParams; onChange: (v: TParams) => void; model: TModel }) => ReactNode
}

interface Props<TModel> {
  open: boolean
  model: TModel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- параметры у рецептов разные, пара recipe/Form согласована внутри записи
  entries: RecipeEntry<TModel, any>[]
  /** Текст для diff: у JSON-документов — JSON.stringify(model, null, 2) */
  print: (model: TModel) => string
  onApply: (model: TModel) => void
  /** Кнопка «Geo-базы» у заметок с needsGeo; у ядер без geo-баз не передаётся */
  onOpenGeo?: () => void
  onClose: () => void
}

export function RecipesDialog<TModel>({ open, model, entries, print, onApply, onOpenGeo, onClose }: Props<TModel>) {
  const [id, setId] = useState(entries[0]?.recipe.id ?? '')
  // Параметры всех рецептов держим сразу: переключение списка не теряет введённое
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(entries.map((e) => [e.recipe.id, e.recipe.defaults])),
  )
  const [diff, setDiff] = useState(false)

  const entry = entries.find((e) => e.recipe.id === id) ?? entries[0]
  const current = entry === undefined ? undefined : params[entry.recipe.id] ?? entry.recipe.defaults

  // Закрытый диалог не считает план и не рисует формы: иначе их поля и кнопки
  // остаются в дереве доступности и перехватывают поиск по подписям на всей странице
  const plan = useMemo<RecipePlan<TModel>>(
    () => (open && entry ? entry.recipe.plan(model, current) : { model, changes: [], notes: [] }),
    [open, entry, model, current],
  )
  const error = entry ? entry.recipe.validate(current) : null
  const canApply = error === null && plan.changes.some((c) => c.status === 'add')

  function apply() {
    onApply(plan.model)
    setDiff(false)
    onClose()
  }

  return (
    <Dialog open={open} title="Рецепты" onClose={onClose} wide>
      {!open || entry === undefined ? null : diff ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Слева — текущий черновик, справа — каким он станет после рецепта.
          </p>
          <DiffView original={print(model)} modified={print(plan.model)} maxHeight="55vh" />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setDiff(false)}>
              ← К параметрам
            </Button>
            <span className="spacer" />
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="recipes-layout">
            <div className="recipe-list">
              {entries.map((e) => (
                <button
                  key={e.recipe.id}
                  type="button"
                  className={e.recipe.id === entry.recipe.id ? 'recipe-item recipe-item-active' : 'recipe-item'}
                  aria-pressed={e.recipe.id === entry.recipe.id}
                  onClick={() => setId(e.recipe.id)}
                >
                  <span className="recipe-item-title">{e.recipe.title}</span>
                  <span className="recipe-item-summary">{e.recipe.summary}</span>
                </button>
              ))}
            </div>

            <div className="recipe-body">
              <entry.Form
                value={current}
                model={model}
                onChange={(v) => setParams({ ...params, [entry.recipe.id]: v })}
              />

              <h3 className="recipe-preview-title">Будет добавлено</h3>
              <ul className="recipe-changes" aria-label="Изменения рецепта">
                {plan.changes.map((c, i) => (
                  <li
                    key={`${c.text}:${i}`}
                    className={c.status === 'add' ? 'recipe-add' : c.status === 'refused' ? 'recipe-refused' : 'recipe-exists'}
                  >
                    <span aria-hidden="true">{c.status === 'add' ? '+' : c.status === 'refused' ? '⨯' : '✓'}</span> {c.text}
                  </li>
                ))}
              </ul>

              {plan.notes.map((n) => (
                <p key={n.text} className="recipe-note">
                  {n.text}
                  {n.needsGeo === true && onOpenGeo !== undefined && (
                    <Button variant="ghost" onClick={onOpenGeo}>
                      Geo-базы
                    </Button>
                  )}
                </p>
              ))}

              {error !== null && <span className="field-error">{error}</span>}
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <span className="spacer" />
            <Button onClick={() => setDiff(true)}>Показать diff</Button>
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

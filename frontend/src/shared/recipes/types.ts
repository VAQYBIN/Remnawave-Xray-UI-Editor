// Рецепт над моделью документа — движок один на три ядра. План возвращает
// новую модель, список изменений для предпросмотра и заметки; вход не
// мутируется, повторное применение не добавляет ничего (идемпотентность —
// забота самого рецепта, а не диалога).

export interface RecipeChange {
  status: 'add' | 'exists'
  text: string
}

/** needsGeo включает в диалоге кнопку «Geo-базы» — у ядер без geo-баз её нет */
export interface RecipeNote {
  text: string
  needsGeo?: true
}

export interface RecipePlan<TModel> {
  model: TModel
  changes: RecipeChange[]
  notes: RecipeNote[]
}

export interface Recipe<TModel, TParams> {
  id: string
  title: string
  summary: string
  defaults: TParams
  validate(params: TParams): string | null
  plan(model: TModel, params: TParams): RecipePlan<TModel>
}

import type { XrayConfig } from '../config'

/** Строка предпросмотра: «+ outbound warp» или «✓ правило … уже есть» */
export interface RecipeChange {
  status: 'add' | 'exists'
  text: string
}

/** Замечание рецепта. needsGeo включает в диалоге кнопку «Geo-базы» */
export interface RecipeNote {
  text: string
  needsGeo?: true
}

export interface RecipePlan {
  /** Результат применения; исходный конфиг не мутируется */
  config: XrayConfig
  changes: RecipeChange[]
  notes: RecipeNote[]
}

/** Правило маршрутизации. Inbound и Outbound уже есть в соседних модулях слоя */
export type Rule = NonNullable<NonNullable<XrayConfig['routing']>['rules']>[number]

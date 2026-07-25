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

export type Outbound = NonNullable<XrayConfig['outbounds']>[number]
export type Rule = NonNullable<NonNullable<XrayConfig['routing']>['rules']>[number]
export type Inbound = NonNullable<XrayConfig['inbounds']>[number]

// Шесть рецептов Xray-профиля как записи обобщённого диалога. Сами рецепты
// (`entities/xray/recipes`) не меняются: их план отдаёт `config`, обёртка
// переводит его в `model`. Поля форм получают теги из модели здесь, а не через
// пропы диалога — у диалога модели вида документа больше нет.

import type { XrayConfig } from '../../entities/xray'
import {
  BALANCE_DEFAULTS,
  BLOCK_DEFAULTS,
  CHAIN_DEFAULTS,
  RECIPES,
  TORRENT_DEFAULTS,
  WARP_DEFAULTS,
  planAds,
  planBalance,
  planChain,
  planPrivate,
  planTorrent,
  planWarp,
  validateBalance,
  validateBlock,
  validateChain,
  validateWarp,
  type BalanceParams,
  type BlockParams,
  type ChainParams,
  type RecipeId,
  type RecipePlan as XrayPlan,
  type TorrentParams,
  type WarpParams,
} from '../../entities/xray'
import type { RecipePlan } from '../../shared/recipes/types'
import { BalanceForm } from './forms/BalanceForm'
import { BlockForm } from './forms/BlockForm'
import { ChainForm } from './forms/ChainForm'
import { TorrentForm } from './forms/TorrentForm'
import { WarpForm } from './forms/WarpForm'
import type { RecipeEntry } from './RecipesDialog'

function toModel(plan: XrayPlan): RecipePlan<XrayConfig> {
  return { model: plan.config, changes: plan.changes, notes: plan.notes }
}

function meta(id: RecipeId): { id: string; title: string; summary: string } {
  const found = RECIPES.find((r) => r.id === id)!
  return { id: found.id, title: found.title, summary: found.summary }
}

const inboundTags = (c: XrayConfig) =>
  (c.inbounds ?? []).map((i) => i.tag).filter((t): t is string => typeof t === 'string')
const outboundTags = (c: XrayConfig) =>
  (c.outbounds ?? []).map((o) => o.tag).filter((t): t is string => typeof t === 'string')

const warp: RecipeEntry<XrayConfig, WarpParams> = {
  recipe: { ...meta('warp'), defaults: WARP_DEFAULTS, validate: validateWarp, plan: (m, p) => toModel(planWarp(m, p)) },
  Form: ({ value, onChange }) => <WarpForm value={value} onChange={onChange} />,
}
const torrent: RecipeEntry<XrayConfig, TorrentParams> = {
  recipe: { ...meta('torrent'), defaults: TORRENT_DEFAULTS, validate: validateBlock, plan: (m, p) => toModel(planTorrent(m, p)) },
  Form: ({ value, onChange, model }) => <TorrentForm value={value} inboundTags={inboundTags(model)} onChange={onChange} />,
}
const ads: RecipeEntry<XrayConfig, BlockParams> = {
  recipe: { ...meta('ads'), defaults: BLOCK_DEFAULTS, validate: validateBlock, plan: (m, p) => toModel(planAds(m, p)) },
  Form: ({ value, onChange }) => <BlockForm value={value} onChange={onChange} />,
}
const priv: RecipeEntry<XrayConfig, BlockParams> = {
  recipe: { ...meta('private'), defaults: BLOCK_DEFAULTS, validate: validateBlock, plan: (m, p) => toModel(planPrivate(m, p)) },
  Form: ({ value, onChange }) => <BlockForm value={value} onChange={onChange} />,
}
const chain: RecipeEntry<XrayConfig, ChainParams> = {
  recipe: { ...meta('chain'), defaults: CHAIN_DEFAULTS, validate: validateChain, plan: (m, p) => toModel(planChain(m, p)) },
  Form: ({ value, onChange, model }) => <ChainForm value={value} outboundTags={outboundTags(model)} onChange={onChange} />,
}
const balance: RecipeEntry<XrayConfig, BalanceParams> = {
  recipe: { ...meta('balance'), defaults: BALANCE_DEFAULTS, validate: validateBalance, plan: (m, p) => toModel(planBalance(m, p)) },
  Form: ({ value, onChange, model }) => <BalanceForm value={value} outboundTags={outboundTags(model)} onChange={onChange} />,
}

/** Порядок — как в RECIPES: warp, torrent, ads, private, chain, balance */
export const XRAY_RECIPES: RecipeEntry<XrayConfig, any>[] = [warp, torrent, ads, priv, chain, balance]

// Реестр рецептов. Параметры у рецептов разные, поэтому связка «id → параметры»
// сделана картой AllParams, а не дженериком: так UI хранит состояние всех форм сразу
// (переключение рецепта не теряет введённое), а planFor/validateFor сужают тип switch’ем.

import type { XrayConfig } from '../config'
import {
  BLOCK_DEFAULTS,
  TORRENT_DEFAULTS,
  planAds,
  planPrivate,
  planTorrent,
  validateBlock,
} from './block'
import type { BlockParams, TorrentParams } from './block'
import { BALANCE_DEFAULTS, planBalance, validateBalance } from './balance'
import type { BalanceParams } from './balance'
import { CHAIN_DEFAULTS, planChain, validateChain } from './chain'
import type { ChainParams } from './chain'
import { WARP_DEFAULTS, planWarp, validateWarp } from './warp'
import type { WarpParams } from './warp'
import type { RecipePlan } from './types'

export * from './types'
export * from './apply'
export * from './balance'
export * from './block'
export * from './chain'
export * from './warp'

export type RecipeId = 'warp' | 'torrent' | 'ads' | 'private' | 'chain' | 'balance'

export interface AllParams {
  warp: WarpParams
  torrent: TorrentParams
  ads: BlockParams
  private: BlockParams
  chain: ChainParams
  balance: BalanceParams
}

export const DEFAULT_PARAMS: AllParams = {
  warp: WARP_DEFAULTS,
  torrent: TORRENT_DEFAULTS,
  ads: BLOCK_DEFAULTS,
  private: BLOCK_DEFAULTS,
  chain: CHAIN_DEFAULTS,
  balance: BALANCE_DEFAULTS,
}

export const RECIPES: { id: RecipeId; title: string; summary: string }[] = [
  {
    id: 'warp',
    title: 'WARP для сервисов',
    summary: 'WireGuard-выход Cloudflare и правило на выбранные категории',
  },
  {
    id: 'torrent',
    title: 'Блокировка торрентов',
    summary: 'Правило по протоколу bittorrent в чёрную дыру плюс включение sniffing',
  },
  {
    id: 'ads',
    title: 'Блокировка рекламы',
    summary: 'Категория geosite:category-ads-all в чёрную дыру',
  },
  {
    id: 'private',
    title: 'Блокировка локальных сетей',
    summary: 'Закрывает клиентам локальную сеть ноды и сам сервер',
  },
  {
    id: 'chain',
    title: 'Цепочка через другой сервер',
    summary: 'Outbound на второй сервер и маршрут в него',
  },
  {
    id: 'balance',
    title: 'Балансировка',
    summary: 'Объединяет несколько выходов в балансер и переводит на него правила',
  },
]

export function planFor(config: XrayConfig, id: RecipeId, all: AllParams): RecipePlan {
  switch (id) {
    case 'warp':
      return planWarp(config, all.warp)
    case 'torrent':
      return planTorrent(config, all.torrent)
    case 'ads':
      return planAds(config, all.ads)
    case 'private':
      return planPrivate(config, all.private)
    case 'chain':
      return planChain(config, all.chain)
    case 'balance':
      return planBalance(config, all.balance)
  }
}

export function validateFor(id: RecipeId, all: AllParams): string | null {
  switch (id) {
    case 'warp':
      return validateWarp(all.warp)
    case 'torrent':
      return validateBlock(all.torrent)
    case 'ads':
      return validateBlock(all.ads)
    case 'private':
      return validateBlock(all.private)
    case 'chain':
      return validateChain(all.chain)
    case 'balance':
      return validateBalance(all.balance)
  }
}

// Реестр рецептов Mihomo поверх обобщённого движка (frontend/src/shared/recipes/types.ts).
// Планы уже возвращают { model }: переводить нечего, запись реестра — обёртка
// вокруг plan*/validate*/*_DEFAULTS без промежуточного слоя, как у sing-box
// (entities/singbox/recipes/index.ts).

import type { Recipe } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { ADS_DEFAULTS, planAds, validateAds, type AdsParams } from './ads'
import { DNS_DEFAULTS, planDns, validateDns, type DnsParams } from './dns'
import { LOCAL_DEFAULTS, planLocal, validateLocal, type LocalParams } from './local'
import { PRIVATE_DEFAULTS, planPrivate, validatePrivate, type PrivateParams } from './private'
import { SPLIT_DEFAULTS, planSplit, validateSplit, type SplitParams } from './split'
import { WARP_DEFAULTS, planWarp, validateWarp, type WarpParams } from './warp'

export * from './apply'
export * from './catalog'
export * from './split'
export * from './ads'
export * from './dns'
export * from './local'
export * from './private'
export * from './warp'

const split: Recipe<MihomoDoc, SplitParams> = {
  id: 'split',
  title: 'Разделить трафик по наборам правил',
  summary: 'Наборы правил из каталога — в один выход одним правилом',
  defaults: SPLIT_DEFAULTS,
  validate: validateSplit,
  plan: planSplit,
}

const ads: Recipe<MihomoDoc, AdsParams> = {
  id: 'ads',
  title: 'Блокировка рекламы',
  summary: 'Категория geosite category-ads-all → REJECT первым правилом',
  defaults: ADS_DEFAULTS,
  validate: validateAds,
  plan: planAds,
}

const dns: Recipe<MihomoDoc, DnsParams> = {
  id: 'dns',
  title: 'DNS с fake-ip',
  summary: 'Удалённый и локальный DNS плюс fake-ip и fake-ip-filter',
  defaults: DNS_DEFAULTS,
  validate: validateDns,
  plan: planDns,
}

const local: Recipe<MihomoDoc, LocalParams> = {
  id: 'local',
  title: 'Локальный вход',
  summary: 'mixed-port и allow-lan для локального трафика машины',
  defaults: LOCAL_DEFAULTS,
  validate: validateLocal,
  plan: planLocal,
}

const priv: Recipe<MihomoDoc, PrivateParams> = {
  id: 'private',
  title: 'Локальные сети напрямую',
  summary: 'Набор geoip-private и правило DIRECT первым',
  defaults: PRIVATE_DEFAULTS,
  validate: validatePrivate,
  plan: planPrivate,
}

const warp: Recipe<MihomoDoc, WarpParams> = {
  id: 'warp',
  title: 'WARP-сервер',
  summary: 'WireGuard-сервер Cloudflare по ключу и адресам аккаунта',
  defaults: WARP_DEFAULTS,
  validate: validateWarp,
  plan: planWarp,
}

/** Порядок — как в диалоге: split, ads, dns, local, private, warp */
export const MIHOMO_RECIPES: Recipe<MihomoDoc, any>[] = [split, ads, dns, local, priv, warp] // eslint-disable-line @typescript-eslint/no-explicit-any -- параметры у рецептов разные, пара recipe/id согласована внутри записи

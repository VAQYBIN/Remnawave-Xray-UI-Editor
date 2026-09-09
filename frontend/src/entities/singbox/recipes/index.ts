// Реестр рецептов sing-box поверх обобщённого движка (frontend/src/shared/recipes/types.ts).
// В отличие от Xray, где RecipePlan{config} требовал перевода в RecipePlan<TModel>,
// планы здесь уже возвращают {model}: переводить нечего, запись реестра — обёртка
// вокруг plan*/validate*/*_DEFAULTS без промежуточного слоя.

import type { Recipe } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
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

const split: Recipe<SingboxDoc, SplitParams> = {
  id: 'split',
  title: 'Разделить трафик по наборам правил',
  summary: 'Наборы правил из каталога — в один выход одним правилом',
  defaults: SPLIT_DEFAULTS,
  validate: validateSplit,
  plan: planSplit,
}

const ads: Recipe<SingboxDoc, AdsParams> = {
  id: 'ads',
  title: 'Блокировка рекламы',
  summary: 'Категория geosite category-ads-all → reject, по желанию NXDOMAIN на DNS',
  defaults: ADS_DEFAULTS,
  validate: validateAds,
  plan: planAds,
}

const dns: Recipe<SingboxDoc, DnsParams> = {
  id: 'dns',
  title: 'DNS с fake-ip',
  summary: 'Удалённый и локальный DNS плюс fake-ip, sniff и hijack-dns',
  defaults: DNS_DEFAULTS,
  validate: validateDns,
  plan: planDns,
}

const local: Recipe<SingboxDoc, LocalParams> = {
  id: 'local',
  title: 'Локальный вход',
  summary: 'Inbound mixed/socks/http на 127.0.0.1 для локального трафика машины',
  defaults: LOCAL_DEFAULTS,
  validate: validateLocal,
  plan: planLocal,
}

const priv: Recipe<SingboxDoc, PrivateParams> = {
  id: 'private',
  title: 'Локальные сети напрямую',
  summary: 'Правило ip_is_private → выбранный выход, сразу за sniff/hijack-dns',
  defaults: PRIVATE_DEFAULTS,
  validate: validatePrivate,
  plan: planPrivate,
}

const warp: Recipe<SingboxDoc, WarpParams> = {
  id: 'warp',
  title: 'WARP-эндпоинт',
  summary: 'WireGuard-эндпоинт Cloudflare по ключу и адресам аккаунта',
  defaults: WARP_DEFAULTS,
  validate: validateWarp,
  plan: planWarp,
}

/** Порядок — как в диалоге: split, ads, dns, local, private, warp */
export const SINGBOX_RECIPES: Recipe<SingboxDoc, any>[] = [split, ads, dns, local, priv, warp] // eslint-disable-line @typescript-eslint/no-explicit-any -- параметры у рецептов разные, пара recipe/id согласована внутри записи

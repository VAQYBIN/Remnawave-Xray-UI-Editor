// Рецепт «WARP для выбранных сервисов»: wireguard-outbound Cloudflare + одно правило
// со списком категорий. Публичный ключ пира и endpoint одинаковы для всех аккаунтов,
// secretKey и адреса выдаются при регистрации устройства (wgcf или кнопка «Получить ключи»).

import type { XrayConfig } from '../config'
import { ensureOutbound, ensureRule, ruleOrdinal } from './apply'
import { GEO_NOTE } from './block'
import type { RecipeChange, RecipePlan } from './types'

export const WARP_PEER = {
  publicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
  endpoint: 'engage.cloudflareclient.com:2408',
  allowedIPs: ['0.0.0.0/0', '::/0'],
}

/** Шаблон для кнопки «Заполнить шаблон WARP» в форме outbound’а */
export const WARP_TEMPLATE = {
  secretKey: 'ВСТАВЬТЕ_ПРИВАТНЫЙ_КЛЮЧ_WARP',
  address: ['172.16.0.2/32'],
  mtu: 1280,
  peers: [WARP_PEER],
}

export const WARP_SERVICES: { value: string; label: string }[] = [
  { value: 'geosite:openai', label: 'OpenAI / ChatGPT' },
  { value: 'geosite:google', label: 'Google' },
  { value: 'geosite:netflix', label: 'Netflix' },
  { value: 'geosite:spotify', label: 'Spotify' },
  { value: 'geosite:twitter', label: 'Twitter / X' },
  { value: 'geosite:facebook', label: 'Meta / Facebook' },
  { value: 'geosite:discord', label: 'Discord' },
  { value: 'geosite:tiktok', label: 'TikTok' },
  { value: 'geosite:apple', label: 'Apple' },
  { value: 'geosite:microsoft', label: 'Microsoft' },
]

export interface WarpParams {
  tag: string
  /** Коды geosite с префиксом, например geosite:openai */
  services: string[]
  /** Свои домены и категории */
  domains: string[]
  secretKey: string
  addresses: string[]
  reserved: number[]
  mtu: number
}

export const WARP_DEFAULTS: WarpParams = {
  tag: 'warp',
  services: ['geosite:openai'],
  domains: [],
  secretKey: '',
  addresses: ['172.16.0.2/32'],
  reserved: [],
  mtu: 1280,
}

export function validateWarp(params: WarpParams): string | null {
  if (params.tag.trim() === '') return 'Укажите тег outbound’а'
  if (params.secretKey.trim() === '') {
    return 'Вставьте приватный ключ WARP или нажмите «Получить ключи»'
  }
  if (params.services.length === 0 && params.domains.length === 0) {
    return 'Выберите сервисы или укажите свои домены — иначе правило некуда направить'
  }
  return null
}

function warpOutbound(params: WarpParams) {
  const settings: Record<string, unknown> = {
    secretKey: params.secretKey,
    address: params.addresses,
    mtu: params.mtu,
    peers: [WARP_PEER],
  }
  // reserved нужен не всем аккаунтам: пустой массив в конфиг не пишем
  if (params.reserved.length > 0) settings.reserved = params.reserved
  return { tag: params.tag, protocol: 'wireguard', settings }
}

export function planWarp(config: XrayConfig, params: WarpParams): RecipePlan {
  const changes: RecipeChange[] = []

  const outbound = ensureOutbound(config, warpOutbound(params))
  changes.push({
    status: outbound.status,
    text:
      outbound.status === 'add'
        ? `outbound ${params.tag} (wireguard)`
        : `outbound ${params.tag} — уже есть, используем`,
  })

  const domain = [...params.services, ...params.domains]
  const rule = ensureRule(outbound.config, { domain, outboundTag: params.tag }, 'route')
  const list =
    domain.length > 2 ? `${domain.slice(0, 2).join(', ')} и ещё ${domain.length - 2}` : domain.join(', ')
  changes.push({
    status: rule.status,
    text:
      rule.status === 'add'
        ? `правило ${list} → ${params.tag} (${ruleOrdinal(rule.index)})`
        : `правило ${list} → ${params.tag} — уже есть`,
  })

  const notes = params.services.length > 0 ? [GEO_NOTE] : []
  return { config: rule.config, changes, notes }
}

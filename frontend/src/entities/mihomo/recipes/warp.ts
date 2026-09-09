// Рецепт «WARP-сервер»: proxy-запись wireguard с тем же публичным ключом
// пира, что и у рецептов Xray/sing-box (`WARP_PEER` из
// `entities/xray/recipes/warp.ts`) — факт про сеть Cloudflare общий для всех
// трёх ядер, второй копии ему не нужно.

import { WARP_PEER } from '../../xray/recipes/warp'
import type { RecipeChange, RecipeNote, RecipePlan } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { ensureListEntry, statusText } from './apply'

export interface WarpParams {
  name: string
  privateKey: string
  addresses: string[]
  reserved: number[]
  mtu: number
  /** Завести отдельную группу select с этим сервером */
  group: boolean
}

export const WARP_DEFAULTS: WarpParams = {
  name: 'WARP',
  privateKey: '',
  addresses: ['172.16.0.2/32'],
  reserved: [],
  mtu: 1280,
  group: false,
}

export function validateWarp(p: WarpParams): string | null {
  if (p.name.trim() === '') return 'Укажите имя сервера'
  if (p.privateKey.trim() === '') return 'Вставьте приватный ключ WARP или нажмите «Получить ключи»'
  return null
}

/** Хост и порт пира — разбор `WARP_PEER.endpoint`, а не вторая копия строки (см. entities/singbox/recipes/warp.ts) */
function peerHostPort(): { host: string; port: number } {
  const at = WARP_PEER.endpoint.lastIndexOf(':')
  return { host: WARP_PEER.endpoint.slice(0, at), port: Number(WARP_PEER.endpoint.slice(at + 1)) }
}

/** `addresses` приходят с маской (`172.16.0.2/32`), а поля `ip`/`ipv6` записи Mihomo — без неё */
const withoutMask = (address: string) => address.split('/')[0]!

export function planWarp(md: MihomoDoc, p: WarpParams): RecipePlan<MihomoDoc> {
  const { host, port } = peerHostPort()
  const entry: Record<string, unknown> = {
    name: p.name,
    type: 'wireguard',
    server: host,
    port,
    ip: withoutMask(p.addresses[0] ?? ''),
  }
  if (p.addresses[1] !== undefined) entry.ipv6 = withoutMask(p.addresses[1])
  entry['private-key'] = p.privateKey
  entry['public-key'] = WARP_PEER.publicKey
  // reserved нужен не всем аккаунтам: пустой массив в конфиг не пишем
  if (p.reserved.length > 0) entry.reserved = p.reserved
  entry.udp = true
  entry.mtu = p.mtu

  const proxy = ensureListEntry(md, ['proxies'], entry, 'start')
  const changes: RecipeChange[] = [
    { status: proxy.status, text: statusText(proxy.status, { add: `сервер ${p.name} (wireguard)`, exists: `сервер ${p.name} — уже есть` }) },
  ]
  const notes: RecipeNote[] = [...proxy.notes]
  let next = proxy.md

  if (p.group) {
    const group = ensureListEntry(next, ['proxy-groups'], { name: 'WARP', type: 'select', proxies: [p.name] }, 'end')
    next = group.md
    notes.push(...group.notes)
    changes.push({ status: group.status, text: statusText(group.status, { add: 'группа WARP (select)', exists: 'группа WARP — уже есть' }) })
  }

  return { model: next, changes, notes }
}

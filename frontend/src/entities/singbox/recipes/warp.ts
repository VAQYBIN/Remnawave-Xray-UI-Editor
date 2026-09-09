// Рецепт «WARP-эндпоинт»: wireguard-endpoint Cloudflare с тем же публичным
// ключом пира, что и у рецепта Xray, — факт про сеть Cloudflare общий для
// обоих ядер, второй копии ему не нужно (см. entities/xray/recipes/warp.ts).

import { WARP_PEER } from '../../xray/recipes/warp'
import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { ensureAt } from './apply'

export interface WarpParams {
  tag: string
  privateKey: string
  addresses: string[]
  reserved: number[]
  mtu: number
}

export const WARP_DEFAULTS: WarpParams = {
  tag: 'warp',
  privateKey: '',
  addresses: ['172.16.0.2/32'],
  reserved: [],
  mtu: 1280,
}

export function validateWarp(p: WarpParams): string | null {
  if (p.tag.trim() === '') return 'Укажите тег эндпоинта'
  if (p.privateKey.trim() === '') return 'Вставьте приватный ключ WARP или нажмите «Получить ключи»'
  return null
}

/**
 * Хост и порт пира — разбор `WARP_PEER.endpoint` (`host:port`), а не вторая
 * копия строки: адрес и порт Cloudflare — тот же факт про сеть, что и у
 * рецепта Xray, и держать его в двух местах значило бы держать два раза одно
 * и то же значение, которые могут разъехаться при следующей правке одного из них.
 */
function peerHostPort(): { host: string; port: number } {
  const at = WARP_PEER.endpoint.lastIndexOf(':')
  return { host: WARP_PEER.endpoint.slice(0, at), port: Number(WARP_PEER.endpoint.slice(at + 1)) }
}

export function planWarp(doc: SingboxDoc, p: WarpParams): RecipePlan<SingboxDoc> {
  const { host, port } = peerHostPort()
  const entry: Record<string, unknown> = {
    type: 'wireguard',
    tag: p.tag,
    address: p.addresses,
    private_key: p.privateKey,
    mtu: p.mtu,
    peers: [
      {
        address: host,
        port,
        public_key: WARP_PEER.publicKey,
        allowed_ips: ['0.0.0.0/0', '::/0'],
        reserved: p.reserved,
      },
    ],
  }

  const res = ensureAt(doc, ['endpoints'], entry, 'tag', 'end')
  const changes: RecipeChange[] = [
    { status: res.status, text: res.status === 'add' ? `эндпоинт ${p.tag} (wireguard)` : `эндпоинт ${p.tag} — уже есть` },
  ]
  return { model: res.doc, changes, notes: [] }
}

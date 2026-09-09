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

export function planWarp(doc: SingboxDoc, p: WarpParams): RecipePlan<SingboxDoc> {
  const entry: Record<string, unknown> = {
    type: 'wireguard',
    tag: p.tag,
    address: p.addresses,
    private_key: p.privateKey,
    mtu: p.mtu,
    peers: [
      {
        address: 'engage.cloudflareclient.com',
        port: 2408,
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

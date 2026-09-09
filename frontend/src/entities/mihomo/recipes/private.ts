// Рецепт «Локальные сети напрямую»: набор geoip-private тем же payload'ом,
// что заводит стартер панели, и правило DIRECT ПЕРВЫМ (`start`) — частные
// подсети обязаны обходить прокси раньше любого другого правила, иначе они
// уйдут в прокси наравне с остальным трафиком.

import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { ensureListEntry, ensureMapEntry } from './apply'

// 16 подсетей — тот же список, что кладёт стартер панели (entities/mihomo/starters.ts)
const PRIVATE_SUBNETS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '255.255.255.255/32',
]

export type PrivateParams = Record<string, never>

export const PRIVATE_DEFAULTS: PrivateParams = {}

export function validatePrivate(_p: PrivateParams): string | null {
  return null
}

export function planPrivate(md: MihomoDoc, _p: PrivateParams): RecipePlan<MihomoDoc> {
  const provider = ensureMapEntry(md, ['rule-providers'], 'geoip-private', {
    type: 'inline',
    behavior: 'ipcidr',
    payload: PRIVATE_SUBNETS,
  })
  const changes: RecipeChange[] = [
    { status: provider.status, text: provider.status === 'add' ? 'набор geoip-private' : 'набор geoip-private — уже есть' },
  ]

  const rule = ensureListEntry(provider.md, ['rules'], 'RULE-SET,geoip-private,DIRECT,no-resolve', 'start')
  changes.push({
    status: rule.status,
    text: rule.status === 'add' ? 'правило: локальные сети → DIRECT' : 'правило локальных сетей уже есть',
  })

  return { model: rule.md, changes, notes: [...provider.notes, ...rule.notes] }
}

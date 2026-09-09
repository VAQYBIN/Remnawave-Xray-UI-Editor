// Рецепт «Локальные сети напрямую»: набор geoip-private тем же payload'ом,
// что заводит стартер панели, и правило DIRECT ПЕРВЫМ (`start`) — частные
// подсети обязаны обходить прокси раньше любого другого правила, иначе они
// уйдут в прокси наравне с остальным трафиком.

import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { MihomoDoc } from '../parse'
import { ensureListEntry, ensureMapEntry } from './apply'

// 18 подсетей — дословно и в том же порядке, что у панельного шаблона по
// умолчанию (test/fixtures/mihomo/default.yaml, rule-providers.geoip-private.payload).
// Список обязан совпадать с ним, а не с произвольным «правильным» набором
// приватных диапазонов: рецепт воспроизводит именно то, что панель сама
// вкладывает в новый шаблон, и включает IPv6-диапазоны (::/127, fc00::/7,
// fe80::/10, ff00::/8) — без них локальные адреса IPv6 (в частности,
// fe80::/10, link-local) ушли бы в прокси наравне с обычным трафиком.
const PRIVATE_SUBNETS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3',
  '::/127', 'fc00::/7', 'fe80::/10', 'ff00::/8',
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

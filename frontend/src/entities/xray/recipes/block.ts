// Рецепты, которые гасят трафик в blackhole: торренты, реклама, локальные сети.
// Все три переиспользуют один outbound-«чёрную дыру» — по умолчанию с тегом block.

import type { XrayConfig } from '../config'
import { ensureOutbound, ensureRule, ensureSniffing, ruleOrdinal } from './apply'
import type { RecipeChange, RecipeNote, RecipePlan, Rule } from './types'

export interface BlockParams {
  blockTag: string
}

export interface TorrentParams extends BlockParams {
  /** Пусто — все inbound’ы конфига */
  inboundTags: string[]
}

export const BLOCK_DEFAULTS: BlockParams = { blockTag: 'block' }
export const TORRENT_DEFAULTS: TorrentParams = { blockTag: 'block', inboundTags: [] }

export const GEO_NOTE: RecipeNote = {
  text: 'Правило использует geo-категории: без загруженных geo-баз ядро не запустится.',
  needsGeo: true,
}

export function validateBlock(params: BlockParams): string | null {
  if (params.blockTag.trim() === '') return 'Укажите тег блокирующего outbound’а'
  return null
}

function blackhole(tag: string) {
  return { tag, protocol: 'blackhole', settings: {} }
}

/** Общая часть всех трёх рецептов: outbound-«чёрная дыра» + набор правил */
function planBlocking(
  config: XrayConfig,
  blockTag: string,
  rules: { rule: Rule; text: string }[],
): { config: XrayConfig; changes: RecipeChange[] } {
  const changes: RecipeChange[] = []
  const outbound = ensureOutbound(config, blackhole(blockTag))
  changes.push({
    status: outbound.status,
    text:
      outbound.status === 'add'
        ? `outbound ${blockTag} (blackhole)`
        : `outbound ${blockTag} — уже есть, используем`,
  })

  let next = outbound.config
  for (const item of rules) {
    const res = ensureRule(next, item.rule, 'block')
    next = res.config
    changes.push({
      status: res.status,
      text:
        res.status === 'add'
          ? `правило ${item.text} → ${blockTag} (${ruleOrdinal(res.index)})`
          : `правило ${item.text} → ${blockTag} — уже есть`,
    })
  }
  return { config: next, changes }
}

export function planTorrent(config: XrayConfig, params: TorrentParams): RecipePlan {
  const base = planBlocking(config, params.blockTag, [
    { rule: { protocol: ['bittorrent'], outboundTag: params.blockTag }, text: 'протокол bittorrent' },
  ])

  const sniff = ensureSniffing(base.config, params.inboundTags)
  const changes = [...base.changes]
  if (sniff.changed.length > 0) {
    changes.push({ status: 'add', text: `sniffing включён у: ${sniff.changed.join(', ')}` })
  } else {
    changes.push({ status: 'exists', text: 'sniffing уже включён' })
  }

  return {
    config: sniff.config,
    changes,
    notes: [
      {
        text: 'Определение bittorrent работает только при включённом sniffing — рецепт включает его сам.',
      },
    ],
  }
}

export function planAds(config: XrayConfig, params: BlockParams): RecipePlan {
  const base = planBlocking(config, params.blockTag, [
    {
      rule: { domain: ['geosite:category-ads-all'], outboundTag: params.blockTag },
      text: 'geosite:category-ads-all',
    },
  ])
  return { config: base.config, changes: base.changes, notes: [GEO_NOTE] }
}

export function planPrivate(config: XrayConfig, params: BlockParams): RecipePlan {
  // Два правила вместо одного: ip и domain внутри правила работают по «или», но
  // раздельные правила понятнее в топологии и отключаются по одному
  const base = planBlocking(config, params.blockTag, [
    { rule: { ip: ['geoip:private'], outboundTag: params.blockTag }, text: 'geoip:private' },
    { rule: { domain: ['geosite:private'], outboundTag: params.blockTag }, text: 'geosite:private' },
  ])
  return {
    config: base.config,
    changes: base.changes,
    notes: [
      GEO_NOTE,
      { text: 'Закрывает клиентам доступ к локальной сети ноды и к самому серверу.' },
    ],
  }
}

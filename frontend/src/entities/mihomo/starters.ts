// Заготовки записей для меню «+ Добавить» и панели «Документ»: минимум, который
// ядро примет и который сразу виден на холсте. Имя уникально в пространстве,
// где оно адресует узел: группы, серверы и встроенные цели — одно (правило
// ссылается на них одним полем). У группы нет `proxies`: панель допишет хосты
// и так, а пустой список печатался бы flow-скобками.

import { uniqueName } from '../../shared/schema'
import { groupsOf, providersOf, proxiesOf, ruleProvidersOf, subRuleNames } from './groups'
import type { MihomoDoc } from './parse'
import { BUILTIN_TARGETS } from './resolve'
import { rulesOf } from './rules'

const targets = (md: MihomoDoc): string[] => [...groupsOf(md).map((g) => g.name), ...proxiesOf(md).map((p) => p.name), ...BUILTIN_TARGETS]

const listenerNames = (md: MihomoDoc): string[] => {
  const root = md.json as { listeners?: unknown } | null
  return (Array.isArray(root?.listeners) ? root.listeners : [])
    .map((l) => (l as { name?: unknown } | null)?.name)
    .filter((n): n is string => typeof n === 'string')
}

export function startGroup(md: MihomoDoc): Record<string, unknown> {
  return { name: uniqueName(targets(md), 'Группа'), type: 'select' }
}

/** direct — единственный вид статического сервера, документированный панелью («без прокси») */
export function startProxy(md: MihomoDoc): Record<string, unknown> {
  return { name: uniqueName(targets(md), 'Сервер'), type: 'direct', udp: true }
}

export function providerName(md: MihomoDoc): string {
  return uniqueName(providersOf(md).map((p) => p.name), 'provider')
}
export function ruleProviderName(md: MihomoDoc): string {
  return uniqueName(ruleProvidersOf(md).map((r) => r.name), 'ruleset')
}
export function subRuleName(md: MihomoDoc): string {
  return uniqueName(subRuleNames(md), 'sub-rule')
}

export function startProvider(_md: MihomoDoc, _name: string): Record<string, unknown> {
  return { type: 'http', url: '', interval: 86400 }
}
export function startRuleProvider(_md: MihomoDoc, _name: string): Record<string, unknown> {
  return { type: 'http', behavior: 'domain', format: 'mrs', url: '', interval: 86400 }
}
export function startSubRule(): unknown[] {
  return []
}
export function startListener(md: MihomoDoc): Record<string, unknown> {
  return { name: uniqueName(listenerNames(md), 'вход'), type: 'mixed', listen: '127.0.0.1', port: 7890 }
}
export function startTunnel(): Record<string, unknown> {
  return { network: ['tcp', 'udp'], address: '127.0.0.1:0', target: '', proxy: '' }
}

/**
 * Куда и чем «+ Правило» заводит правило. Перед выбранным — самое частое
 * намерение писателя; иначе перед финальным MATCH: в Mihomo выигрывает первое
 * совпавшее, и правило ПОСЛЕ MATCH рождалось бы мёртвым. Второй MATCH перед
 * финальным сделал бы мёртвым уже финальный, поэтому заготовка — безобидное
 * DOMAIN-SUFFIX. Правил нет вовсе или список кончается обычным правилом —
 * MATCH,DIRECT в конец, где он уместен.
 */
export function nextRulePlacement(md: MihomoDoc, selectedRule: number | null): { raw: string; at: number } {
  const rules = rulesOf(md)
  if (selectedRule !== null && rules.some((r) => r.index === selectedRule)) {
    return { raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: selectedRule }
  }
  const last = rules[rules.length - 1]
  if (last?.rule?.type === 'MATCH') return { raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: last.index }
  return { raw: 'MATCH,DIRECT', at: rules.length }
}

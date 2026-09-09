// Рецепт «DNS с fake-ip»: удалённый и локальный DNS-серверы плюс fake-ip.
// Каждый шаг — ensureScalar/ensureListEntry: значение, уже заданное автором
// (стартер панели включает dns.enable, enhanced-mode и fake-ip-range сразу),
// рецепт не перезаписывает и честно отвечает 'exists'.

import type { RecipeChange, RecipeNote, RecipePlan } from '../../../shared/recipes/types'
import { ruleProvidersOf } from '../groups'
import type { MihomoDoc } from '../parse'
import { ensureListEntry, ensureScalar, statusText } from './apply'

export interface DnsParams {
  /** Удалённый DNS — идёт в dns.nameserver */
  remote: string
  /** Локальный (бутстрап) DNS — идёт в dns.default-nameserver */
  local: string
  fakeIp: boolean
}

export const DNS_DEFAULTS: DnsParams = { remote: 'https://1.1.1.1/dns-query', local: '1.1.1.1', fakeIp: true }

export function validateDns(p: DnsParams): string | null {
  if (p.remote.trim() === '') return 'Укажите удалённый DNS-сервер'
  if (p.local.trim() === '') return 'Укажите локальный DNS-сервер'
  return null
}

export function planDns(md: MihomoDoc, p: DnsParams): RecipePlan<MihomoDoc> {
  const changes: RecipeChange[] = []
  const notes: RecipeNote[] = []
  let next = md

  const enable = ensureScalar(next, ['dns', 'enable'], true)
  next = enable.md
  notes.push(...enable.notes)
  changes.push({ status: enable.status, text: statusText(enable.status, { add: 'dns.enable = true', exists: 'dns.enable уже задан' }) })

  if (p.fakeIp) {
    const mode = ensureScalar(next, ['dns', 'enhanced-mode'], 'fake-ip')
    next = mode.md
    notes.push(...mode.notes)
    changes.push({ status: mode.status, text: statusText(mode.status, { add: 'dns.enhanced-mode = fake-ip', exists: 'dns.enhanced-mode уже задан' }) })

    const range = ensureScalar(next, ['dns', 'fake-ip-range'], '198.18.0.1/16')
    next = range.md
    notes.push(...range.notes)
    changes.push({ status: range.status, text: statusText(range.status, { add: 'dns.fake-ip-range = 198.18.0.1/16', exists: 'dns.fake-ip-range уже задан' }) })
  }

  const local = ensureListEntry(next, ['dns', 'default-nameserver'], p.local, 'end')
  next = local.md
  notes.push(...local.notes)
  changes.push({ status: local.status, text: statusText(local.status, { add: `default-nameserver: ${p.local}`, exists: `${p.local} уже в default-nameserver` }) })

  const remote = ensureListEntry(next, ['dns', 'nameserver'], p.remote, 'end')
  next = remote.md
  notes.push(...remote.notes)
  changes.push({ status: remote.status, text: statusText(remote.status, { add: `nameserver: ${p.remote}`, exists: `${p.remote} уже в nameserver` }) })

  // rule-set:geosite-private — только если такой набор в документе уже есть:
  // ссылка на несуществующий набор в fake-ip-filter была бы диагностикой
  // «неизвестное имя», которую рецепт сам себе и выписал бы
  const filters = ['*.lan', '+.local', 'localhost']
  if (ruleProvidersOf(next).some((r) => r.name === 'geosite-private')) filters.push('rule-set:geosite-private')
  for (const filter of filters) {
    const res = ensureListEntry(next, ['dns', 'fake-ip-filter'], filter, 'end')
    next = res.md
    notes.push(...res.notes)
    changes.push({ status: res.status, text: statusText(res.status, { add: `fake-ip-filter: ${filter}`, exists: `${filter} уже в fake-ip-filter` }) })
  }

  const store = ensureScalar(next, ['profile', 'store-fake-ip'], true)
  next = store.md
  notes.push(...store.notes)
  changes.push({ status: store.status, text: statusText(store.status, { add: 'profile.store-fake-ip = true', exists: 'profile.store-fake-ip уже задан' }) })

  return { model: next, changes, notes }
}

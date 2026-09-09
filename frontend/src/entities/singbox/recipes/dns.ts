// Рецепт «DNS с fake-ip»: удалённый DNS через detour, локальный — для клиента
// в режиме Direct, и fake-ip — источник адресов для sniff/route по домену.
// sniff и hijack-dns обязаны стоять ПЕРВЫМИ двумя правилами маршрута и в этом
// порядке — без sniff ядро не узнает домен назначения, без hijack-dns запрос
// к самому DNS не попадёт под остальные правила и не даст fake-ip сработать.
// Поэтому им нужна не простая вставка «в начало» (ensureAt при уже
// существующем sniff поставила бы hijack-dns ПЕРЕД ним), а вставка сразу
// ПОСЛЕ фактической позиции sniff.

import { applyOps } from '../../../shared/schema'
import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { ensureAt, ensureCacheFile, sameEntry } from './apply'

const SNIFF = { action: 'sniff' }
const HIJACK = { protocol: 'dns', action: 'hijack-dns' }

export interface DnsParams {
  /** Адрес или detour удалённого DNS-сервера (tls) */
  remote: string
  /** Тег выхода, через который резолвится удалённый DNS */
  detour: string
}

export const DNS_DEFAULTS: DnsParams = { remote: '', detour: '' }

export function validateDns(p: DnsParams): string | null {
  if (p.remote.trim() === '') return 'Укажите адрес удалённого DNS'
  return null
}

/** sniff и hijack-dns первыми правилами, в этом порядке; идемпотентно вне зависимости от того, что уже стоит следом */
function ensureLeadingSniffHijack(doc: SingboxDoc): { doc: SingboxDoc; changes: RecipeChange[] } {
  const changes: RecipeChange[] = []
  let next = doc
  const rules = doc.route?.rules ?? []
  const sniffIndex = rules.findIndex((r) => sameEntry(r, SNIFF))
  let hijackInsertAt: number
  if (sniffIndex === -1) {
    next = applyOps(next, [{ op: 'insert', path: ['route', 'rules'], index: 0, value: SNIFF }])
    changes.push({ status: 'add', text: 'правило: sniff' })
    hijackInsertAt = 1
  } else {
    changes.push({ status: 'exists', text: 'правило sniff уже есть' })
    hijackInsertAt = sniffIndex + 1
  }
  const rulesNow = next.route?.rules ?? []
  const hijackIndex = rulesNow.findIndex((r) => sameEntry(r, HIJACK))
  if (hijackIndex === -1) {
    next = applyOps(next, [{ op: 'insert', path: ['route', 'rules'], index: hijackInsertAt, value: HIJACK }])
    changes.push({ status: 'add', text: 'правило: hijack-dns' })
  } else {
    changes.push({ status: 'exists', text: 'правило hijack-dns уже есть' })
  }
  return { doc: next, changes }
}

export function planDns(doc: SingboxDoc, p: DnsParams): RecipePlan<SingboxDoc> {
  const changes: RecipeChange[] = []
  let next = doc

  const remote = ensureAt(next, ['dns', 'servers'], { tag: 'dns-remote', type: 'tls', server: p.remote, detour: p.detour }, 'tag', 'end')
  next = remote.doc
  changes.push({ status: remote.status, text: remote.status === 'add' ? 'сервер dns-remote (tls)' : 'сервер dns-remote — уже есть' })

  const local = ensureAt(next, ['dns', 'servers'], { tag: 'dns-local', type: 'local' }, 'tag', 'end')
  next = local.doc
  changes.push({ status: local.status, text: local.status === 'add' ? 'сервер dns-local' : 'сервер dns-local — уже есть' })

  const fakeip = ensureAt(
    next,
    ['dns', 'servers'],
    { tag: 'dns-fakeip', type: 'fakeip', inet4_range: '198.18.0.0/15', inet6_range: 'fc00::/18' },
    'tag',
    'end',
  )
  next = fakeip.doc
  changes.push({ status: fakeip.status, text: fakeip.status === 'add' ? 'сервер dns-fakeip' : 'сервер dns-fakeip — уже есть' })

  const directRule = ensureAt(next, ['dns', 'rules'], { clash_mode: 'Direct', server: 'dns-local' }, 'deep', 'end')
  next = directRule.doc
  changes.push({ status: directRule.status, text: directRule.status === 'add' ? 'DNS-правило: Direct → dns-local' : 'DNS-правило Direct уже есть' })

  const globalRule = ensureAt(next, ['dns', 'rules'], { clash_mode: 'Global', server: 'dns-remote' }, 'deep', 'end')
  next = globalRule.doc
  changes.push({ status: globalRule.status, text: globalRule.status === 'add' ? 'DNS-правило: Global → dns-remote' : 'DNS-правило Global уже есть' })

  const fakeipRule = ensureAt(next, ['dns', 'rules'], { query_type: ['A', 'AAAA'], server: 'dns-fakeip' }, 'deep', 'end')
  next = fakeipRule.doc
  changes.push({
    status: fakeipRule.status,
    text: fakeipRule.status === 'add' ? 'DNS-правило: A/AAAA → dns-fakeip' : 'DNS-правило fake-ip уже есть',
  })

  if (next.dns?.final === undefined || next.dns.final === '') {
    next = applyOps(next, [{ op: 'set', path: ['dns', 'final'], value: 'dns-remote' }])
    changes.push({ status: 'add', text: 'dns.final = dns-remote' })
  } else {
    changes.push({ status: 'exists', text: 'dns.final уже задан' })
  }

  const leading = ensureLeadingSniffHijack(next)
  next = leading.doc
  changes.push(...leading.changes)

  if (next.route?.default_domain_resolver === undefined) {
    next = applyOps(next, [{ op: 'set', path: ['route', 'default_domain_resolver'], value: { server: 'dns-local' } }])
    changes.push({ status: 'add', text: 'route.default_domain_resolver = dns-local' })
  } else {
    changes.push({ status: 'exists', text: 'route.default_domain_resolver уже задан' })
  }

  const cache = ensureCacheFile(next, { store_fakeip: true })
  next = cache.doc
  changes.push({ status: cache.status, text: cache.status === 'add' ? 'experimental.cache_file включён (store_fakeip)' : 'cache_file уже включён' })

  return {
    model: next,
    changes,
    notes: [{ text: 'fake-ip требует TUN-режима на клиенте — на конфиге без inbound tun адреса fake-ip не разрешатся в реальные.' }],
  }
}

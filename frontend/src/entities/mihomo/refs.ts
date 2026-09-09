// Ссылки по имени: где в документе упомянуто имя группы, сервера, провайдера,
// набора правил или подсписка. ОДИН перечень мест на два потребителя:
// переименование ведёт ссылки за собой, валидация ищет ссылки в пустоту.
// Второй список разошёлся бы с первым на первом же новом месте ссылки.

import type { DocOp, SchemaPath } from '../../shared/schema'
import type { PathParts } from '../xray/config'
import { scalar } from './edits'
import { groupsOf, providersOf, proxiesOf, ruleProvidersOf, subRuleEntries } from './groups'
import type { MihomoDoc } from './parse'
import { BUILTIN_TARGETS } from './resolve'
import { formatRule, parseRule, ruleEntriesOf, rulesOf } from './rules'
import { applyMihomoOps, mihomoLockAt, renameKeyAt } from './write'

export type NamedKind = 'group' | 'proxy' | 'provider' | 'rule-provider' | 'sub-rule'

export interface RefSite {
  kind: NamedKind
  name: string
  path: PathParts
  form: 'scalar' | 'rule' | 'policy-key' | 'filter-entry'
}

export function namesOf(md: MihomoDoc, kind: NamedKind): string[] {
  switch (kind) {
    case 'group': return groupsOf(md).map((g) => g.name)
    case 'proxy': return proxiesOf(md).map((p) => p.name)
    case 'provider': return providersOf(md).map((p) => p.name)
    case 'rule-provider': return ruleProvidersOf(md).map((r) => r.name)
    case 'sub-rule': return subRuleEntries(md).map((s) => s.name)
  }
}

/** Пространство, в котором имя обязано быть уникальным: цели маршрута делят одно */
function namespace(md: MihomoDoc, kind: NamedKind): string[] {
  if (kind === 'group' || kind === 'proxy') return [...namesOf(md, 'group'), ...namesOf(md, 'proxy'), ...BUILTIN_TARGETS]
  return namesOf(md, kind)
}

const j = (md: MihomoDoc): Record<string, unknown> => (typeof md.json === 'object' && md.json !== null ? (md.json as Record<string, unknown>) : {})
const rec = (v: unknown): Record<string, unknown> | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Имена наборов внутри условия правила: `(RULE-SET,x)` на любой глубине */
function ruleSetsInPayload(payload: string): string[] {
  const out: string[] = []
  for (const m of payload.matchAll(/\(RULE-SET,([^()]*)\)/g)) out.push(m[1]!.trim())
  return out
}

export function referenceSites(md: MihomoDoc): RefSite[] {
  const sites: RefSite[] = []
  const root = j(md)
  // Находка ревью I2: `targetKind` раньше звался на КАЖДОМ месте ссылки и сам
  // строил список имён групп/серверов полным обходом дерева (`namesOf` →
  // `groupsOf`/`proxiesOf`) — на документе с N ссылками и M именами это
  // O(N·M) вместо O(N+M). Множества строятся один раз на весь вызов.
  const groupNames = new Set(namesOf(md, 'group'))
  const proxyNames = new Set(namesOf(md, 'proxy'))
  /** Вид цели маршрута по имени: группа перед сервером, как у resolveTarget */
  const targetKind = (name: string): NamedKind | null => {
    if (groupNames.has(name)) return 'group'
    if (proxyNames.has(name)) return 'proxy'
    return null
  }
  const target = (path: PathParts, value: unknown) => {
    if (typeof value !== 'string' || value === '') return
    const kind = targetKind(value)
    // Имя, которого нет ни среди групп, ни среди серверов, — тоже ссылка (на
    // хост панели или опечатку): валидации нужно знать о ней, kind — лучший из
    // возможных; переименование по такому имени никогда не спросят
    sites.push({ kind: kind ?? 'proxy', name: value, path, form: 'scalar' })
  }

  list(root.proxies).forEach((p, i) => target(['proxies', i, 'dialer-proxy'], rec(p)?.['dialer-proxy']))
  list(root['proxy-groups']).forEach((g, i) => {
    const group = rec(g) ?? {}
    list(group.proxies).forEach((name, k) => target(['proxy-groups', i, 'proxies', k], name))
    target(['proxy-groups', i, 'default-selected'], group['default-selected'])
    target(['proxy-groups', i, 'empty-fallback'], group['empty-fallback'])
    list(group.use).forEach((name, k) => {
      if (typeof name === 'string') sites.push({ kind: 'provider', name, path: ['proxy-groups', i, 'use', k], form: 'scalar' })
    })
  })
  for (const [name, p] of Object.entries(rec(root['proxy-providers']) ?? {})) {
    const provider = rec(p) ?? {}
    target(['proxy-providers', name, 'proxy'], provider.proxy)
    target(['proxy-providers', name, 'dialer-proxy'], provider['dialer-proxy'])
    target(['proxy-providers', name, 'override', 'dialer-proxy'], rec(provider.override)?.['dialer-proxy'])
  }
  for (const [name, r] of Object.entries(rec(root['rule-providers']) ?? {})) target(['rule-providers', name, 'proxy'], rec(r)?.proxy)
  list(root.listeners).forEach((l, i) => {
    const listener = rec(l) ?? {}
    target(['listeners', i, 'proxy'], listener.proxy)
    if (typeof listener.rule === 'string') sites.push({ kind: 'sub-rule', name: listener.rule, path: ['listeners', i, 'rule'], form: 'scalar' })
  })
  list(root.tunnels).forEach((t, i) => target(['tunnels', i, 'proxy'], rec(t)?.proxy))
  target(['ntp', 'dialer-proxy'], rec(root.ntp)?.['dialer-proxy'])

  const dns = rec(root.dns) ?? {}
  for (const policyKey of ['nameserver-policy', 'proxy-server-nameserver-policy']) {
    for (const key of Object.keys(rec(dns[policyKey]) ?? {})) {
      if (!key.startsWith('rule-set:')) continue
      for (const name of key.slice('rule-set:'.length).split(',')) {
        sites.push({ kind: 'rule-provider', name: name.trim(), path: ['dns', policyKey, key], form: 'policy-key' })
      }
    }
  }
  list(dns['fake-ip-filter']).forEach((entry, i) => {
    if (typeof entry !== 'string') return
    if (entry.startsWith('rule-set:')) {
      sites.push({ kind: 'rule-provider', name: entry.slice('rule-set:'.length).trim(), path: ['dns', 'fake-ip-filter', i], form: 'filter-entry' })
      return
    }
    const rule = parseRule(entry)
    if (rule?.type === 'RULE-SET' && rule.payload) sites.push({ kind: 'rule-provider', name: rule.payload, path: ['dns', 'fake-ip-filter', i], form: 'rule' })
  })
  const tun = rec(root.tun) ?? {}
  for (const key of ['route-address-set', 'route-exclude-address-set']) {
    list(tun[key]).forEach((name, i) => {
      if (typeof name === 'string') sites.push({ kind: 'rule-provider', name, path: ['tun', key, i], form: 'scalar' })
    })
  }

  const ruleList = (entries: ReturnType<typeof rulesOf>, base: PathParts) => {
    for (const entry of entries) {
      const rule = entry.rule
      if (rule === null) continue
      const at: PathParts = [...base, entry.index]
      if (rule.type === 'RULE-SET' && rule.payload) sites.push({ kind: 'rule-provider', name: rule.payload, path: at, form: 'rule' })
      for (const name of ruleSetsInPayload(rule.payload ?? '')) sites.push({ kind: 'rule-provider', name, path: at, form: 'rule' })
      if (rule.type === 'SUB-RULE') {
        sites.push({ kind: 'sub-rule', name: rule.target, path: at, form: 'rule' })
        continue
      }
      const kind = targetKind(rule.target)
      sites.push({ kind: kind ?? 'proxy', name: rule.target, path: at, form: 'rule' })
    }
  }
  ruleList(rulesOf(md), ['rules'])
  for (const { name, node } of subRuleEntries(md)) ruleList(ruleEntriesOf(md, node), ['sub-rules', name])
  return sites
}

export function referencesTo(md: MihomoDoc, kind: NamedKind, name: string): RefSite[] {
  const sameSpace = kind === 'group' || kind === 'proxy' ? ['group', 'proxy'] : [kind]
  return referenceSites(md).filter((s) => sameSpace.includes(s.kind) && s.name === name)
}

export type RenameRefusal = 'empty' | 'taken' | 'unprintable' | 'not-found' | 'locked'

const RENAME_TEXT: Record<RenameRefusal, string> = {
  empty: 'Имя не может быть пустым: по нему на запись ссылаются правила и группы.',
  taken: 'Такое имя уже занято в этом пространстве имён — группы, серверы и встроенные цели адресуются одним полем.',
  unprintable: 'В имени есть перевод строки — одной строкой YAML его не записать.',
  'not-found': 'Записи с таким именем в документе больше нет — она изменилась после отрисовки.',
  locked: 'Имя или ссылка на него приходят через якорь «*» или слияние «<<:» — сначала разверните значение на месте.',
}

export function renameRefusalText(refusal: RenameRefusal): string {
  return RENAME_TEXT[refusal]
}

/** Строка правила с заменённым именем: цель, RULE-SET снаружи и внутри условий, SUB-RULE */
function renameInRule(raw: string, kind: NamedKind, from: string, to: string): string {
  const rule = parseRule(raw)
  if (rule === null) return raw
  let payload = rule.payload
  if (kind === 'rule-provider' && payload !== undefined) {
    if (rule.type === 'RULE-SET' && payload === from) payload = to
    payload = payload.replace(/\(RULE-SET,([^()]*)\)/g, (m, inner: string) => (inner.trim() === from ? `(RULE-SET,${to})` : m))
  }
  let target = rule.target
  if (kind === 'sub-rule' && rule.type === 'SUB-RULE' && target === from) target = to
  if ((kind === 'group' || kind === 'proxy') && rule.type !== 'SUB-RULE' && target === from) target = to
  return formatRule({ ...rule, payload, target })
}

/**
 * Путь к самой записи: `name` у списочных видов (`proxies[]`/`proxy-groups[]`),
 * сам ключ у отображений (`provider`/`rule-provider`/`sub-rule`). `undefined` —
 * только по внутренней несогласованности с `namesOf` (не должно случаться,
 * `renameAt` уже проверил `from` через тот же `namesOf` выше).
 */
function definitionPathOf(md: MihomoDoc, kind: NamedKind, from: string): SchemaPath | undefined {
  if (kind === 'group') {
    const index = groupsOf(md).find((g) => g.name === from)?.index
    return index === undefined ? undefined : ['proxy-groups', index, 'name']
  }
  if (kind === 'proxy') {
    const index = proxiesOf(md).find((p) => p.name === from)?.index
    return index === undefined ? undefined : ['proxies', index, 'name']
  }
  const section = kind === 'provider' ? 'proxy-providers' : kind === 'rule-provider' ? 'rule-providers' : 'sub-rules'
  return [section, from]
}

export function renameAt(md: MihomoDoc, kind: NamedKind, from: string, to: string): { md: MihomoDoc; refusal?: RenameRefusal } {
  if (to.trim() === '') return { md, refusal: 'empty' }
  if (scalar(to) === null) return { md, refusal: 'unprintable' }
  if (!namesOf(md, kind).includes(from)) return { md, refusal: 'not-found' }
  if (to !== from && namespace(md, kind).includes(to)) return { md, refusal: 'taken' }
  if (to === from) return { md }

  const sites = referencesTo(md, kind, from)
  const defPath = definitionPathOf(md, kind, from)
  if (defPath === undefined) return { md, refusal: 'not-found' }

  // Замок — на самой записи ИЛИ хоть на одной ссылке на неё — останавливает
  // переименование ДО первой правки, на исходном `md`. Правки идут пачкой из
  // нескольких вызовов `applyMihomoOps`/`renameKeyAt`: отказ одной из них,
  // обнаруженный только ПОСТФАКТУМ, оставил бы документ наполовину
  // переименованным — часть ссылок на новое имя, часть (та, что через якорь
  // или слияние) так и на старое, либо саму запись переименовали, а ссылка на
  // неё, живущая в тексте объявления якоря, — нет. Живые шаблоны Mihomo это
  // обычная форма (`<<:`-слияния и `*alias` в `x-anchors`), а не патология.
  const lockedPaths = [defPath, ...sites.map((s) => s.path as SchemaPath)]
  if (lockedPaths.some((p) => mihomoLockAt(md, p) !== null)) return { md, refusal: 'locked' }

  const ops: DocOp[] = []
  for (const site of sites) {
    const path = site.path as SchemaPath
    switch (site.form) {
      case 'scalar':
        ops.push({ op: 'set', path, value: to })
        break
      case 'filter-entry':
        ops.push({ op: 'set', path, value: `rule-set:${to}` })
        break
      case 'rule': {
        const raw = (valueAtJson(md, path) as string | undefined) ?? ''
        ops.push({ op: 'set', path, value: renameInRule(raw, kind, from, to) })
        break
      }
      case 'policy-key': {
        // Ключ отображения: переименовать сам ключ, значение оставить.
        // Находка ревью C2: `n.replace(from, to)` бил по ПЕРВОМУ вхождению
        // подстроки `from` в сегменте, а не по разобранному имени — у
        // `"rule-set:ru"` подстрока `ru` совпадает и внутри слова `rule`, и
        // замена уходила в «adsle-set:ru» вместо «rule-set:ads». Сегмент
        // собирается заново из разобранных частей, а не substring-заменой.
        const key = String(path[path.length - 1])
        const nextKey = key.split(',').map((n) => {
          const t = n.trim()
          return t === from ? to : t === `rule-set:${from}` ? `rule-set:${to}` : n
        }).join(',')
        ops.push({ op: 'set', path: [...path.slice(0, -1), nextKey], value: valueAtJson(md, path) })
        ops.push({ op: 'remove', path })
        break
      }
    }
  }
  const written = applyMihomoOps(md, ops)
  // `refused` здесь — независимая от предпроверки выше находка (второй, ещё
  // не проверенный путь к тому же узлу и подобное): любой отказ означает, что
  // часть ссылок не переписана, а возвращать в этом случае что-либо, кроме
  // ИСХОДНОГО документа, значит вернуть наполовину переименованный.
  if (written.refused.length > 0) return { md, refusal: 'unprintable' }
  let next = written.md

  // Сама запись: поле name у списка, ключ у отображения
  if (kind === 'group' || kind === 'proxy') {
    const named = applyMihomoOps(next, [{ op: 'set', path: defPath, value: to }])
    if (named.refused.length > 0) return { md, refusal: 'unprintable' }
    next = named.md
  } else {
    const section = kind === 'provider' ? 'proxy-providers' : kind === 'rule-provider' ? 'rule-providers' : 'sub-rules'
    const renamed = renameKeyAt(next, [section], from, to)
    // `renameKeyAt` не сигналит отказ отдельным полем — на «ключа среди своих
    // нет» она молча возвращает документ БЕЗ ИЗМЕНЕНИЙ. Единственный способ
    // заметить это здесь — сравнить текст: если он не изменился, правки не
    // было, а исходный документ (`md`), а не промежуточный `next`, — то, что
    // нужно вернуть, иначе ссылки окажутся переписаны на имя, которого сама
    // запись так и не получила.
    if (renamed.text === next.text) return { md, refusal: 'unprintable' }
    next = renamed
  }
  return { md: next }
}

function valueAtJson(md: MihomoDoc, path: SchemaPath): unknown {
  let cur: unknown = md.json
  for (const step of path) {
    if (typeof step === 'number') { if (!Array.isArray(cur)) return undefined; cur = cur[step] }
    else { const r = rec(cur); if (r === undefined) return undefined; cur = r[step] }
  }
  return cur
}

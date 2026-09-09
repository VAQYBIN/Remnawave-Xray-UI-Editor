// Диагностики документа. Главное правило то же, что у Mihomo: имена серверов,
// которые подставит панель, редактору неизвестны, поэтому «ссылка на неизвестный
// тег» — предупреждение. Ошибкой она становится ровно тогда, когда серверов от
// панели документ не получает вовсе (`documentGetsPanelServers` === false):
// тогда неизвестному имени взяться неоткуда, и это либо опечатка, либо ссылка
// на выход, который автор забыл добавить.

import { deprecatedAt, isRecord, walkSchema } from '../../shared/schema'
import type { PathParts, ValidationIssue } from '../xray/config'
import {
  GROUP_OUTBOUND_TYPES,
  PROXY_OUTBOUND_TYPES,
  documentGetsPanelServers,
  groupsOf,
  outboundsOf,
  panelFillsGroup,
} from './outbounds'
import { ruleSetTagsOf, ruleTarget, rulesOf } from './rules'
import { OUTBOUND_TYPE_VALUES, SINGBOX_SCHEMA } from './schema'
import type { SingboxDoc, SingboxOutbound } from './types'

function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: parts.join('.'), message, level }
}

/** Типы выходов, которые панель не кладёт в списки групп, но и претензий к ним нет */
const NEUTRAL_TYPES = new Set(['direct', ...GROUP_OUTBOUND_TYPES])

/**
 * Типы, устаревшие по схеме (`block`, `dns`, `wireguard`): про них уже
 * скажет предупреждение `deprecated` ниже, со своей причиной и заменой —
 * вторая, более общая претензия «панель не добавит его в группы» здесь
 * была бы шумом на том же пути документа.
 */
const DEPRECATED_OUTBOUND_TYPES = new Set(
  OUTBOUND_TYPE_VALUES.filter((v) => v.deprecated !== undefined).map((v) => v.value),
)

/** Теги записей списка (серверы DNS и подобные): у каждой свой `tag`, порядок не важен */
function tagsOfList(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .map((item) => (isRecord(item) ? item.tag : undefined))
    .filter((tag): tag is string => typeof tag === 'string' && tag !== '')
}

function tagsOf(doc: SingboxDoc): Set<string> {
  const tags = new Set<string>()
  for (const outbound of outboundsOf(doc)) {
    if (typeof outbound.tag === 'string') tags.add(outbound.tag)
  }
  // Эндпоинты (WireGuard, Tailscale) — такая же адресуемая тегом цель, как и
  // обычный выход: правило route может сослаться на endpoints так же, как на
  // outbounds, и без этого ссылка на эндпоинт ложно считалась бы неизвестной.
  for (const endpoint of Array.isArray(doc.endpoints) ? doc.endpoints : []) {
    const tag = (endpoint as { tag?: unknown }).tag
    if (typeof tag === 'string') tags.add(tag)
  }
  return tags
}

function listed(group: SingboxOutbound): string[] {
  return Array.isArray(group.outbounds) ? group.outbounds.filter((t) => typeof t === 'string') : []
}

/** Кольцо ссылок между группами: ядро на таком конфиге не поднимется */
function findCycle(doc: SingboxDoc): string[] | null {
  const groups = new Map(
    groupsOf(doc)
      .filter((g): g is SingboxOutbound & { tag: string } => typeof g.tag === 'string')
      .map((g) => [g.tag, g]),
  )
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const walk = (tag: string): string[] | null => {
    if (state.get(tag) === 'done') return null
    if (state.get(tag) === 'visiting') return [...stack.slice(stack.indexOf(tag)), tag]
    const group = groups.get(tag)
    if (group === undefined) return null
    state.set(tag, 'visiting')
    stack.push(tag)
    for (const next of listed(group)) {
      const found = walk(next)
      if (found !== null) return found
    }
    stack.pop()
    state.set(tag, 'done')
    return null
  }

  for (const tag of groups.keys()) {
    const found = walk(tag)
    if (found !== null) return found
  }
  return null
}

export function validateSingbox(doc: SingboxDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const outbounds = outboundsOf(doc)
  const known = tagsOf(doc)
  // Получает ли документ серверы от панели ХОТЬ КУДА-НИБУДЬ (documentGetsPanelServers,
  // entities/singbox/outbounds.ts) — а не «есть ли группы вообще». Если панели
  // некуда подставлять серверы (нет групп, либо у всех includeProxies: false),
  // то ЛЮБОЙ незнакомый тег — гарантированно опечатка автора, а не будущее имя
  // хоста, и об этом стоит говорить как об ошибке, а не как о предупреждении,
  // которое можно пролистать.
  const panelServes = documentGetsPanelServers(doc)
  const unknownLevel: 'error' | 'warning' = panelServes ? 'warning' : 'error'
  const unknownHint = panelServes ? ' — если это имя подставит панель, всё в порядке' : ''

  const seen = new Set<string>()
  outbounds.forEach((outbound, index) => {
    const tag = typeof outbound.tag === 'string' ? outbound.tag : undefined
    if (tag !== undefined) {
      // Дубликат ломает не только ядро: узлы графа адресуются тегом, и один из
      // них молча пропадёт с холста (как и у Mihomo/Xray)
      if (seen.has(tag)) {
        issues.push(issue(['outbounds', index, 'tag'], `Тег «${tag}» уже занят другим выходом`, 'error'))
      }
      seen.add(tag)
    }

    if (!NEUTRAL_TYPES.has(outbound.type) && !PROXY_OUTBOUND_TYPES.has(outbound.type) && !DEPRECATED_OUTBOUND_TYPES.has(outbound.type)) {
      // Не «неизвестный тип» вообще — тип может быть валидным выходом ядра
      // (wireguard, tor, ssh, …), просто панель его не подставит в группы при
      // автозаполнении. Претензия ровно в этом, а не в том, что тип не существует
      issues.push(
        issue(
          ['outbounds', index, 'type'],
          `Выход «${tag ?? outbound.type}» панель не добавит в списки групп: она подставляет только vless, trojan, shadowsocks и hysteria2. Сослаться на него можно вручную`,
          'warning',
        ),
      )
    }

    if (GROUP_OUTBOUND_TYPES.has(outbound.type) && !panelFillsGroup(outbound) && listed(outbound).length === 0) {
      // panelFillsGroup(outbound) === false здесь означает ровно
      // includeProxies: false: без него пустой список — валидный черновик,
      // который панель дозаполнит (см. тест ниже про outbounds: null)
      issues.push(
        issue(
          ['outbounds', index, 'outbounds'],
          `Группа «${tag ?? '?'}» пуста, а includeProxies: false запрещает панели её заполнять`,
          'error',
        ),
      )
    }

    for (const [position, target] of listed(outbound).entries()) {
      if (!known.has(target)) {
        issues.push(
          issue(
            ['outbounds', index, 'outbounds', position],
            `Группа «${tag ?? '?'}» ссылается на неизвестный выход «${target}»${unknownHint}`,
            unknownLevel,
          ),
        )
      }
    }
  })

  const cycle = findCycle(doc)
  if (cycle !== null) {
    issues.push(issue(['outbounds'], `Кольцо ссылок между группами: ${cycle.join(' → ')}`, 'error'))
  }

  const ruleSets = new Set(ruleSetTagsOf(doc))
  rulesOf(doc).forEach((rule, index) => {
    const target = ruleTarget(rule)
    if (target !== undefined && !known.has(target)) {
      issues.push(
        issue(
          ['route', 'rules', index, 'outbound'],
          `Правило ссылается на неизвестный выход «${target}»${unknownHint}`,
          unknownLevel,
        ),
      )
    }
    const sets = Array.isArray(rule.rule_set)
      ? rule.rule_set
      : typeof rule.rule_set === 'string'
        ? [rule.rule_set]
        : []
    for (const set of sets) {
      // Набор правил объявляется самим документом (route.rule_set) — панель
      // сюда ничего не подставляет, поэтому неизвестное имя тут ошибка
      // безусловно, вне зависимости от panelServes
      if (typeof set === 'string' && !ruleSets.has(set)) {
        issues.push(
          issue(
            ['route', 'rules', index, 'rule_set'],
            `Набор правил «${set}» не описан в route.rule_set`,
            'error',
          ),
        )
      }
    }
  })

  const final = doc.route?.final
  if (typeof final === 'string' && final !== '' && !known.has(final)) {
    issues.push(
      issue(['route', 'final'], `Выход по умолчанию «${final}» не описан${unknownHint}`, unknownLevel),
    )
  }

  // Устаревшее — по схеме, где угодно в дереве. Предупреждение, а не ошибка:
  // документ мог быть сохранён более старой панелью и разбирается нашей сквозной
  // схемой; мешает такой ключ только `sing-box check` на актуальном бинаре
  walkSchema(SINGBOX_SCHEMA, doc, (path, fields, value) => {
    for (const d of deprecatedAt(fields, value)) {
      const what = d.value === undefined ? `Ключ ${d.key}` : `Значение ${d.key}: ${d.value}`
      issues.push(issue([...path, d.key], `${what} — Устарело с ${d.deprecation.since}: ${d.deprecation.replacement}`, 'warning'))
    }
  })

  // Ссылки на DNS-серверы и наборы правил: и то и другое объявляет сам
  // документ, панель сюда ничего не подставляет — неизвестный тег всегда опечатка
  const dnsTags = new Set(tagsOfList(doc.dns?.servers))
  const ruleSetTags = new Set(ruleSetTagsOf(doc))
  const checkDns = (path: PathParts, tag: unknown) => {
    if (typeof tag === 'string' && tag !== '' && !dnsTags.has(tag)) {
      issues.push(issue(path, `DNS-сервер «${tag}» не описан в dns.servers`, 'error'))
    }
  }
  checkDns(['dns', 'final'], doc.dns?.final)
  ;(doc.dns?.rules ?? []).forEach((rule, i) => {
    checkDns(['dns', 'rules', i, 'server'], rule.server)
    const sets = Array.isArray(rule.rule_set) ? rule.rule_set : typeof rule.rule_set === 'string' ? [rule.rule_set] : []
    for (const set of sets) {
      if (typeof set === 'string' && !ruleSetTags.has(set)) {
        issues.push(issue(['dns', 'rules', i, 'rule_set'], `Набор правил «${set}» не описан в route.rule_set`, 'error'))
      }
    }
  })
  rulesOf(doc).forEach((rule, i) => {
    if (rule.action === 'resolve') checkDns(['route', 'rules', i, 'server'], rule.server)
  })
  const resolver = doc.route?.default_domain_resolver
  if (isRecord(resolver)) checkDns(['route', 'default_domain_resolver', 'server'], resolver.server)
  else if (typeof resolver === 'string') checkDns(['route', 'default_domain_resolver'], resolver)
  outbounds.forEach((o, i) => {
    const r = o.domain_resolver
    if (isRecord(r)) checkDns(['outbounds', i, 'domain_resolver', 'server'], r.server)
    else if (typeof r === 'string') checkDns(['outbounds', i, 'domain_resolver'], r)
  })

  return issues
}

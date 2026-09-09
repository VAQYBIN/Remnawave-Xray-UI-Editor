// Диагностики документа. Главное правило то же, что у Mihomo: имена серверов,
// которые подставит панель, редактору неизвестны, поэтому «ссылка на неизвестный
// тег» — предупреждение. Ошибкой она становится ровно тогда, когда серверов от
// панели документ не получает вовсе (`documentGetsPanelServers` === false):
// тогда неизвестному имени взяться неоткуда, и это либо опечатка, либо ссылка
// на выход, который автор забыл добавить.

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
import type { SingboxDoc, SingboxOutbound } from './types'

function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: parts.join('.'), message, level }
}

/** Типы выходов, которые панель не кладёт в списки групп, но и претензий к ним нет */
const NEUTRAL_TYPES = new Set(['direct', ...GROUP_OUTBOUND_TYPES])

/**
 * Устаревшие выходы: ядро 1.13 (целевая версия проекта, см. Global Constraints
 * плана) их не знает вовсе — `block` и `dns` убрали из sing-box в пользу
 * действий правила. Предупреждение, а не ошибка: документ мог быть сохранён
 * более старой панелью и продолжает разбираться нашей схемой (она сквозная), а
 * само присутствие такого выхода не мешает сохранить документ — мешает оно
 * только `sing-box check` на актуальном бинаре, и об этом сказано словами, а не
 * молчаливым отказом сохранять.
 *
 * Значение — чем заменить. Карта экспортируется: тот же факт называет форма
 * выхода под селектом типа, и второй список рядом с этим разошёлся бы с первым
 * на первом же удалённом ядром типе.
 */
export const REMOVED_OUTBOUND_TYPES: Record<string, string> = {
  block: 'action: reject',
  dns: 'action: hijack-dns',
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

    const replacement = REMOVED_OUTBOUND_TYPES[outbound.type]
    if (replacement !== undefined) {
      issues.push(
        issue(
          ['outbounds', index, 'type'],
          `Выход типа ${outbound.type} ядро 1.13 не знает: вместо него ${replacement} в правиле`,
          'warning',
        ),
      )
    } else if (!NEUTRAL_TYPES.has(outbound.type) && !PROXY_OUTBOUND_TYPES.has(outbound.type)) {
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

  return issues
}

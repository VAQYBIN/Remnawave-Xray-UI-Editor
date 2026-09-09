// Граф sing-box: входы → правила → группы → выходы.
//
// Полос четыре, но колонок может быть больше: группа ссылается на группу
// (`selector` перечисляет `urltest`, а закреплённая группа — вообще любые), и
// полоса групп разворачивается по глубине ссылок, как у Mihomo. Кольцо ссылок
// глубину не вешает: узел, уже находящийся в обходе, даёт нулевой вклад, а сама
// ошибка приходит диагностикой из validate.ts.
//
// DNS в граф не идёт: это независимый от маршрута механизм, и на одном холсте
// получились бы два разных графа поверх друг друга. DNS живёт в формах,
// диагностиках и подсказках.

import type { Edge, Node } from '@xyflow/react'
import {
  GROUP_OUTBOUND_TYPES,
  PROXY_OUTBOUND_TYPES,
  defaultRoute,
  groupsOf,
  outboundsOf,
  panelFillsGroup,
} from '../../singbox/outbounds'
import {
  NON_TERMINAL_ACTIONS,
  conditionKeysOf,
  ruleAction,
  ruleTarget,
  rulesOf,
} from '../../singbox/rules'
import type { SingboxDoc, SingboxOutbound } from '../../singbox/types'

export const SINGBOX_COLUMN_W = 430
export const SINGBOX_ROW_H = 130

/**
 * Действия, которые ЗАВЕРШАЮТ подбор, но выход не называют. Спека перечисляла
 * только `reject`, и это был бы верный список, если бы остальные два вели себя
 * иначе. Они ведут себя так же: трассировка называет победителем и `hijack-dns`,
 * и `bypass`. Оставить их без узла значило бы нарисовать их как `sniff` —
 * правилом, которое никуда не ведёт, — а они ведут, просто не в outbound.
 */
export const TERMINAL_BUILTINS: ReadonlySet<string> = new Set(['reject', 'hijack-dns', 'bypass'])

function tagOf(outbound: { tag?: unknown }): string | undefined {
  return typeof outbound.tag === 'string' && outbound.tag !== '' ? outbound.tag : undefined
}

function listedTags(group: SingboxOutbound): string[] {
  return Array.isArray(group.outbounds)
    ? group.outbounds.filter((t): t is string => typeof t === 'string')
    : []
}

/**
 * Глубина группы = насколько далеко она стоит от выходов. Считается от нуля у
 * группы, не ссылающейся на другие группы. Ссылки берутся из списков, записанных
 * в документе: у заполняемой панелью группы список всё равно будет затёрт, но
 * глубина нужна только для раскладки, и раскладывать по написанному честнее,
 * чем схлопывать все такие группы в одну колонку.
 */
export function groupDepths(doc: SingboxDoc): Map<string, number> {
  const groups = new Map<string, SingboxOutbound>()
  for (const group of groupsOf(doc)) {
    const tag = tagOf(group)
    if (tag !== undefined && !groups.has(tag)) groups.set(tag, group)
  }
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  const depth = (tag: string): number => {
    const known = depths.get(tag)
    if (known !== undefined) return known
    // Узел уже в обходе — кольцо ссылок (A → B → A). Возвращаем 0, а не
    // рекурсируем дальше: ошибку кольца ловит validateSingbox, граф просто
    // должен нарисоваться без переполнения стека
    if (visiting.has(tag)) return 0
    const group = groups.get(tag)
    if (group === undefined) return 0
    visiting.add(tag)
    let max = 0
    for (const child of listedTags(group)) {
      if (groups.has(child)) max = Math.max(max, depth(child) + 1)
    }
    visiting.delete(tag)
    depths.set(tag, max)
    return max
  }

  for (const tag of groups.keys()) depth(tag)
  return depths
}

/** Короткие подписи условий правила для карточки */
function summaryOf(rule: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of conditionKeysOf(rule)) {
    const raw = rule[key]
    // Пустой список — не условие, а незаполненное поле: так выглядит правило,
    // только что заведённое кнопкой «+ Правило». Назвать его в сводке значит
    // сказать, что правило чем-то ограничено, — а оно совпадает со всем
    if (Array.isArray(raw) && raw.length === 0) continue
    const value = Array.isArray(raw) ? raw.join(', ') : String(raw)
    out.push(value === '' ? key : `${key}: ${value}`)
  }
  return out
}

export function buildSingboxGraph(doc: SingboxDoc): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Единая точка добавления узла на все виды сразу. Документ ВПРАВЕ содержать
  // два выхода с одним тегом (это диагностируемая ошибка, а не повод спрятать
  // граф), а тег группы может совпасть с тегом сервера. React Flow на дубликате
  // id не падает, а тихо теряет узел с холста — поэтому дедупликация одна на
  // все виды, а не заплатка на каждую коллизию. Побеждает первый добавленный.
  const nodeIds = new Set<string>()
  const pushNode = (node: Node) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  // Одно и то же имя встречается в списках дважды (или у нескольких правил одна
  // цель) — без дедупликации id ребра задвоится и React Flow сломается на рендере
  const edgeIds = new Set<string>()
  const pushEdge = (id: string, source: string, target: string) => {
    if (edgeIds.has(id)) return
    edgeIds.add(id)
    edges.push({ id, source, target })
  }

  const outbounds = outboundsOf(doc)
  const fallback = defaultRoute(doc)
  const depths = groupDepths(doc)
  const maxDepth = Math.max(0, ...depths.values())
  // Полосы: входы, правила, затем группы по глубине, затем выходы
  const inboundColumn = 0
  const ruleColumn = 1
  const groupColumn = (tag: string) => 2 + (maxDepth - (depths.get(tag) ?? 0))
  const outColumn = 2 + maxDepth + 1

  const inbounds = Array.isArray(doc.inbounds) ? doc.inbounds : []
  inbounds.forEach((inbound, index) => {
    const tag = tagOf(inbound)
    if (tag === undefined) return
    pushNode({
      id: `inbound:${tag}`,
      type: 'singboxInbound',
      position: { x: inboundColumn * SINGBOX_COLUMN_W, y: 0 },
      data: {
        kind: 'singbox-inbound',
        index,
        tag,
        type: String(inbound.type ?? ''),
        port: inbound.listen_port as number | string | undefined,
      },
    })
  })

  const groupTags = new Set<string>()
  outbounds.forEach((outbound, index) => {
    const tag = tagOf(outbound)
    if (tag === undefined) return
    if (GROUP_OUTBOUND_TYPES.has(outbound.type)) {
      groupTags.add(tag)
      pushNode({
        id: `group:${tag}`,
        type: 'singboxGroup',
        position: { x: groupColumn(tag) * SINGBOX_COLUMN_W, y: 0 },
        data: {
          kind: 'singbox-group',
          index,
          tag,
          type: outbound.type,
          listed: listedTags(outbound).length,
          panelFills: panelFillsGroup(outbound),
          // Та же формула, что у out:<tag> ниже: дефолт — по route.final, а при
          // пустом final — по позиции. Группа тоже может быть первым элементом
          // outbounds (у дефолтного шаблона панели так и есть), и вторая копия
          // правила здесь разошлась бы с первой при следующей правке одной из них
          isDefault: fallback.tag === tag,
        },
      })
      return
    }
    pushNode({
      id: `out:${tag}`,
      type: 'singboxOut',
      position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
      data: {
        kind: 'singbox-out',
        index,
        tag,
        type: outbound.type,
        isDefault: fallback.tag === tag,
        panelPicks: PROXY_OUTBOUND_TYPES.has(outbound.type),
      },
    })
  })

  // Эндпоинты (WireGuard, Tailscale) — такая же адресуемая тегом цель маршрута,
  // как выход, и живут в той же колонке. Формами они не правятся (осознанный
  // YAGNI спеки), но спрятать их с холста значило бы соврать, что маршрут ведёт
  // в никуда
  const endpoints = Array.isArray(doc.endpoints) ? doc.endpoints : []
  endpoints.forEach((endpoint, index) => {
    const tag = tagOf(endpoint)
    if (tag === undefined) return
    pushNode({
      id: `out:${tag}`,
      type: 'singboxOut',
      position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
      data: {
        kind: 'singbox-out',
        index: outbounds.length + index,
        tag,
        type: String(endpoint.type ?? 'endpoint'),
        isDefault: fallback.tag === tag,
        panelPicks: false,
      },
    })
  })

  const filled = groupsOf(doc).filter(panelFillsGroup)
  if (filled.length > 0) {
    pushNode({
      id: 'hosts:panel',
      type: 'singboxHosts',
      position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
      data: { kind: 'singbox-hosts', groups: filled.length },
    })
  }

  for (const group of groupsOf(doc)) {
    const tag = tagOf(group)
    if (tag === undefined) continue
    if (panelFillsGroup(group)) {
      // Список этой группы панель затрёт целиком — рисовать его рёбрами значило
      // бы изображать связи, которых в отданном клиенту конфиге не будет
      pushEdge(`e:sbgroup:${tag}->hosts:panel`, `group:${tag}`, 'hosts:panel')
      continue
    }
    for (const target of listedTags(group)) {
      const id = groupTags.has(target) ? `group:${target}` : `out:${target}`
      if (!nodeIds.has(id)) continue
      pushEdge(`e:sbgroup:${tag}->${id}`, `group:${tag}`, id)
    }
  }

  rulesOf(doc).forEach((rule, index) => {
    const action = ruleAction(rule)
    const target = action === 'route' ? ruleTarget(rule) : undefined
    pushNode({
      id: `rule:${index}`,
      type: 'singboxRule',
      position: { x: ruleColumn * SINGBOX_COLUMN_W, y: index * SINGBOX_ROW_H },
      data: {
        kind: 'singbox-rule',
        index,
        action,
        summary: summaryOf(rule),
        ruleSets: Array.isArray(rule.rule_set)
          ? rule.rule_set.filter((s): s is string => typeof s === 'string')
          : typeof rule.rule_set === 'string'
            ? [rule.rule_set]
            : [],
        target,
      },
    })

    // Вход не привязан к маршруту у sing-box: ребро рисуется ТОЛЬКО когда
    // правило само назвало вход через `inbound`. Связь «просто так» изобразила
    // бы поток, которого нет
    const named = Array.isArray(rule.inbound)
      ? rule.inbound.filter((t): t is string => typeof t === 'string')
      : typeof rule.inbound === 'string'
        ? [rule.inbound]
        : []
    for (const inTag of named) {
      if (!nodeIds.has(`inbound:${inTag}`)) continue
      pushEdge(`e:sbin:${inTag}->rule:${index}`, `inbound:${inTag}`, `rule:${index}`)
    }

    if (NON_TERMINAL_ACTIONS.has(action)) return
    if (TERMINAL_BUILTINS.has(action)) {
      pushNode({
        id: `builtin:${action}`,
        type: 'singboxBuiltin',
        position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
        data: { kind: 'singbox-builtin', action },
      })
      pushEdge(`e:sbrule:${index}->builtin:${action}`, `rule:${index}`, `builtin:${action}`)
      return
    }
    if (target === undefined) return
    const id = groupTags.has(target) ? `group:${target}` : `out:${target}`
    if (!nodeIds.has(id)) return
    pushEdge(`e:sbrule:${index}->${id}`, `rule:${index}`, id)
  })

  return { nodes, edges }
}

/**
 * Расстановка по вертикали внутри колонки. `buildSingboxGraph` расставляет узлы
 * по колонкам (x), а y оставляет нулевым: сколько колонок займут группы, видно
 * только после обхода всех выходов. Порядок внутри колонки — порядок появления
 * узла в графе, то есть порядок объявления в документе. Сортировать по имени
 * нельзя: пользователь ищет выход там, где он стоит в его файле.
 */
export function layoutSingbox(nodes: Node[]): Node[] {
  const rows = new Map<number, number>()
  return nodes.map((node) => {
    const x = node.position.x
    const row = rows.get(x) ?? 0
    rows.set(x, row + 1)
    return { ...node, position: { x, y: row * SINGBOX_ROW_H } }
  })
}

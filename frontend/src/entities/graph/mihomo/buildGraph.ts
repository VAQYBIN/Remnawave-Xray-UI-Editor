// Граф Mihomo: правила → группы → выходы. Группы ссылаются на группы, поэтому
// колонка групп не одна — глубина считается от выходов. Кольцо ссылок глубину
// не вешает: узел, уже находящийся в обходе, даёт нулевой вклад, а сама ошибка
// приходит диагностикой из validate.ts.

import { isScalar, isSeq } from 'yaml'
import { groupsOf, providersOf, subRuleEntries, type MihomoGroup } from '../../mihomo/groups'
import { groupGetsHosts, hasRootMarker } from '../../mihomo/inject'
import type { MihomoDoc } from '../../mihomo/parse'
import { resolveTarget } from '../../mihomo/resolve'
import { parseRule, rulesOf } from '../../mihomo/rules'
import { edgeId } from '../edgeIds'
import type { FlowEdge, FlowNode } from '../types'

export const MIHOMO_COLUMN_W = 430
export const MIHOMO_ROW_H = 130

export function groupDepths(groups: MihomoGroup[]): Map<string, number> {
  const byName = new Map(groups.map((g) => [g.name, g]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  const depth = (name: string): number => {
    const known = depths.get(name)
    if (known !== undefined) return known
    const group = byName.get(name)
    if (group === undefined) return 0
    // Узел уже в обходе — кольцо ссылок (A → B → A). Возвращаем 0, а не
    // рекурсируем дальше: ошибку кольца ловит validateMihomo, граф просто
    // должен нарисоваться без переполнения стека.
    if (visiting.has(name)) return 0
    visiting.add(name)
    let max = 0
    for (const child of group.proxies) {
      if (!byName.has(child)) continue
      max = Math.max(max, depth(child) + 1)
    }
    visiting.delete(name)
    depths.set(name, max)
    return max
  }

  for (const group of groups) depth(group.name)
  return depths
}

interface SubRuleList {
  name: string
  /** Число строк в подсписке — карточка показывает его вместо десятка узлов */
  count: number
  /** Цели правил подсписка в порядке появления, без повторов */
  targets: string[]
}

/**
 * Подсписки правил для графа. КАКИЕ подсписки есть, решает не этот файл, а
 * `subRuleEntries` из модели — тот же источник, на котором стоят валидация и
 * резолвер диагностик: собственный обход секции разошёлся бы с ними, и узлы
 * `subrule:<имя>` перестали бы совпадать с тем, на что ссылаются диагностики.
 * Здесь только СВОЁ поверх имён: число правил и их цели.
 *
 * Значение, которое не оказалось списком, узел всё равно получает — с нулём
 * правил и без целей: подсписок в документе объявлен, и прятать его с холста
 * из-за кривого содержимого значило бы соврать, что его нет.
 *
 * Значение скаляра берём ДЕКОДИРОВАННЫМ, а не срезом текста: в кавычках
 * (`- "MATCH,DIRECT"`) YAML их уже снял, и разбор среза дал бы тип правила
 * `"MATCH` (тот же приём, что в `rulesOf`).
 */
function subRuleLists(md: MihomoDoc): SubRuleList[] {
  return subRuleEntries(md).map(({ name, node }) => {
    if (!isSeq(node)) return { name, count: 0, targets: [] }
    const targets: string[] = []
    for (const item of node.items) {
      const value = isScalar(item) && typeof item.value === 'string' ? item.value : null
      const target = value === null ? undefined : parseRule(value)?.target
      // Без дедупликации две строки на одну цель дали бы два ребра с одним id —
      // pushEdge второе отбросит, но targets уже соврал бы про число выходов
      if (target !== undefined && !targets.includes(target)) targets.push(target)
    }
    return { name, count: node.items.length, targets }
  })
}

function pickOf(group: MihomoGroup): 'all' | 'random' | 'shuffled' {
  if (group.remnawave.selectRandomProxy === true) return 'random'
  if (group.remnawave.shuffleProxiesOrder === true) return 'shuffled'
  return 'all'
}

export function buildMihomoGraph(md: MihomoDoc): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const groups = groupsOf(md)
  const providers = providersOf(md)
  const depths = groupDepths(groups)
  const maxDepth = Math.max(0, ...depths.values())
  const outputColumn = maxDepth + 2

  const pushEdge = (source: string, target: string) => {
    const id = edgeId(source, target)
    // Одно и то же имя может встретиться в proxies/use дважды (или у нескольких
    // правил один target) — без дедупликации id ребра задублируется и React Flow
    // сломается на рендере.
    if (edges.some((e) => e.id === id)) return
    edges.push({ id, source, target })
  }

  // Единая точка добавления узла. validateMihomo НАМЕРЕННО допускает две группы
  // с одинаковым `name` (это диагностируемая ошибка документа, а не повод скрыть
  // граф от пользователя) и никак не резервирует имя `root` от корневого маркера
  // подстановки — оба случая дают одинаковый id у разных узлов. React Flow на
  // дубликат id не падает, а тихо теряет узел с холста, поэтому дедупликация
  // обязана быть одна на все виды узлов, а не по заплатке на коллизию.
  //
  // Побеждает первый добавленный узел. Порядок обхода ниже: группы (каждая —
  // сразу вместе со своим узлом подстановки, если группа его получает) →
  // корневая подстановка → провайдеры → правила → подсписки правил → встроенные
  // цели (заводятся по мере обнаружения при разборе рёбер групп, правил и
  // подсписков). Отсюда для двух
  // одноимённых групп побеждает первая по порядку в `proxy-groups`; для группы,
  // названной `root` и получающей хосты, — её собственный узел `hosts:root`, а
  // не корневая подстановка: группа объявлена явно автором документа, маркер на
  // `proxies` — общий и безымянный, и если бы победил он, фильтр группы исчез
  // бы из графа без следа.
  const nodeIds = new Set<string>()
  const pushNode = (node: FlowNode) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }

  const builtins = new Set<string>()
  const ensureBuiltin = (name: string) => {
    if (builtins.has(name)) return
    builtins.add(name)
    pushNode({
      id: `builtin:${name}`,
      type: 'mihomoBuiltin',
      position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
      data: { kind: 'mihomo-builtin', name },
    })
  }

  groups.forEach((group) => {
    // Глубина считается от выходов — группа без исходящих ссылок на другие
    // группы стоит в колонке, ближайшей к выходам (column = maxDepth+1).
    const column = maxDepth - (depths.get(group.name) ?? 0) + 1
    pushNode({
      id: `group:${group.name}`,
      type: 'mihomoGroup',
      position: { x: column * MIHOMO_COLUMN_W, y: 0 },
      data: {
        kind: 'mihomo-group',
        index: group.index,
        name: group.name,
        type: group.type,
        manual: group.proxies.length,
        hidden: group.hidden,
        getsHosts: groupGetsHosts(group),
      },
    })

    // Узел подстановки рисуем, только если панель реально положит сюда хосты
    // САМА (не через use — провайдер уже даёт свой узел, дублировать нечего).
    if (groupGetsHosts(group) && group.use.length === 0) {
      const id = `hosts:${group.name}`
      pushNode({
        id,
        type: 'mihomoHosts',
        position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
        data: {
          kind: 'mihomo-hosts',
          owner: group.name,
          filter: group.filter,
          excludeFilter: group.excludeFilter,
          pick: pickOf(group),
        },
      })
      pushEdge(`group:${group.name}`, id)
    }
  })

  if (hasRootMarker(md)) {
    pushNode({
      id: 'hosts:root',
      type: 'mihomoHosts',
      position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
      data: { kind: 'mihomo-hosts', owner: 'root', pick: 'all' },
    })
  }

  providers.forEach((provider) => {
    pushNode({
      id: `provider:${provider.name}`,
      type: 'mihomoProvider',
      position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
      data: {
        kind: 'mihomo-provider',
        name: provider.name,
        type: provider.type,
        dialerProxy: provider.dialerProxy,
      },
    })
  })

  groups.forEach((group) => {
    for (const name of group.proxies) {
      const kind = resolveTarget(md, name)
      if (kind === 'group') pushEdge(`group:${group.name}`, `group:${name}`)
      if (kind === 'provider') pushEdge(`group:${group.name}`, `provider:${name}`)
      if (kind === 'builtin') {
        ensureBuiltin(name)
        pushEdge(`group:${group.name}`, `builtin:${name}`)
      }
    }
    for (const name of group.use) pushEdge(`group:${group.name}`, `provider:${name}`)
  })

  const subRules = subRuleLists(md)
  const subRuleNames = new Set(subRules.map((s) => s.name))

  rulesOf(md).forEach((entry) => {
    const id = `rule:${entry.index}`
    pushNode({
      id,
      type: 'mihomoRule',
      position: { x: 0, y: entry.index * MIHOMO_ROW_H },
      data: {
        kind: 'mihomo-rule',
        index: entry.index,
        type: entry.rule?.type ?? '?',
        payload: entry.rule?.payload,
        target: entry.rule?.target,
        modifiers: entry.rule?.modifiers ?? [],
      },
    })
    const target = entry.rule?.target
    if (target === undefined) return
    // У SUB-RULE третье поле — имя ПОДСПИСКА из `sub-rules`, а не группы:
    // resolveTarget здесь соврал бы, если имя подсписка случайно совпало с
    // именем группы, и ребро ушло бы не туда. Ссылка на подсписок, которого
    // нет, ребра не даёт — её ловит диагностикой validateMihomo.
    if (entry.rule?.type === 'SUB-RULE') {
      if (subRuleNames.has(target)) pushEdge(id, `subrule:${target}`)
      return
    }
    const kind = resolveTarget(md, target)
    if (kind === 'group') pushEdge(id, `group:${target}`)
    if (kind === 'provider') pushEdge(id, `provider:${target}`)
    if (kind === 'builtin') {
      ensureBuiltin(target)
      pushEdge(id, `builtin:${target}`)
    }
  })

  // Подсписки — одна карточка на подсписок, в той же колонке, что и правила.
  // Раскрывать подсписок отдельными узлами незачем: это упорядоченный список
  // строк, порядок в нём значим, и колонка из десяти безымянных узлов читается
  // хуже одной карточки с числом правил — сами правила показывает инспектор.
  // А вот куда подсписок девает трафик, видно быть обязано, иначе правило
  // `SUB-RULE,(…),block` ведёт в пустоту: рёбра идут в цели его собственных
  // правил тем же резолвером, что и у остальных узлов.
  subRules.forEach((sub) => {
    const id = `subrule:${sub.name}`
    pushNode({
      id,
      type: 'mihomoSubRule',
      position: { x: 0, y: 0 },
      data: { kind: 'mihomo-subrule', name: sub.name, count: sub.count, targets: sub.targets },
    })
    for (const target of sub.targets) {
      const kind = resolveTarget(md, target)
      if (kind === 'group') pushEdge(id, `group:${target}`)
      if (kind === 'provider') pushEdge(id, `provider:${target}`)
      if (kind === 'builtin') {
        ensureBuiltin(target)
        pushEdge(id, `builtin:${target}`)
      }
    }
  })

  return { nodes, edges }
}

/**
 * Раскладка по вертикали. `buildMihomoGraph` расставляет узлы по колонкам (x),
 * а y оставляет нулевым: в какой колонке узел окажется, известно только после
 * обхода всех групп. Здесь колонки разбираются по порядку добавления и узлы в
 * каждой раскладываются столбиком.
 *
 * Порядок внутри колонки — это порядок появления узла в графе, то есть порядок
 * объявления сущности в документе. Сортировать по имени нельзя: пользователь
 * ищет группу там, где она стоит в его файле.
 */
export function layoutMihomo(nodes: FlowNode[]): FlowNode[] {
  const rows = new Map<number, number>()
  return nodes.map((node) => {
    const row = rows.get(node.position.x) ?? 0
    rows.set(node.position.x, row + 1)
    return { ...node, position: { x: node.position.x, y: row * MIHOMO_ROW_H } }
  })
}

// Граф Mihomo: правила → группы → выходы. Группы ссылаются на группы, поэтому
// колонка групп не одна — глубина считается от выходов. Кольцо ссылок глубину
// не вешает: узел, уже находящийся в обходе, даёт нулевой вклад, а сама ошибка
// приходит диагностикой из validate.ts.

import { groupsOf, providersOf, type MihomoGroup } from '../../mihomo/groups'
import { groupGetsHosts, hasRootMarker } from '../../mihomo/inject'
import type { MihomoDoc } from '../../mihomo/parse'
import { resolveTarget } from '../../mihomo/resolve'
import { rulesOf } from '../../mihomo/rules'
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

  const builtins = new Set<string>()
  const ensureBuiltin = (name: string) => {
    if (builtins.has(name)) return
    builtins.add(name)
    nodes.push({
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
    nodes.push({
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
      nodes.push({
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
    nodes.push({
      id: 'hosts:root',
      type: 'mihomoHosts',
      position: { x: outputColumn * MIHOMO_COLUMN_W, y: 0 },
      data: { kind: 'mihomo-hosts', owner: 'root', pick: 'all' },
    })
  }

  providers.forEach((provider) => {
    nodes.push({
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

  rulesOf(md).forEach((entry) => {
    const id = `rule:${entry.index}`
    nodes.push({
      id,
      type: 'mihomoRule',
      position: { x: 0, y: entry.index * MIHOMO_ROW_H },
      data: {
        kind: 'mihomo-rule',
        index: entry.index,
        type: entry.rule?.type ?? '?',
        payload: entry.rule?.payload,
        modifiers: entry.rule?.modifiers ?? [],
      },
    })
    const target = entry.rule?.target
    if (target === undefined) return
    const kind = resolveTarget(md, target)
    if (kind === 'group') pushEdge(id, `group:${target}`)
    if (kind === 'provider') pushEdge(id, `provider:${target}`)
    if (kind === 'builtin') {
      ensureBuiltin(target)
      pushEdge(id, `builtin:${target}`)
    }
  })

  return { nodes, edges }
}

// Коммутация кабелем поверх сплайсов. Ни одна операция не печатает документ:
// все возвращают TextEdit[], которые накладывает вызывающий.

import { isMap, isSeq, stringify } from 'yaml'
import { groupsOf } from '../../mihomo/groups'
import { setRuleTarget, type TextEdit } from '../../mihomo/edits'
import { rangeOf, sectionNode, type MihomoDoc } from '../../mihomo/parse'
import { rulesOf } from '../../mihomo/rules'

type NodeKind = 'rule' | 'group' | 'provider' | 'builtin' | 'hosts'

function split(id: string): { kind: NodeKind; rest: string } | null {
  const at = id.indexOf(':')
  if (at === -1) return null
  const kind = id.slice(0, at) as NodeKind
  if (!['rule', 'group', 'provider', 'builtin', 'hosts'].includes(kind)) return null
  return { kind, rest: id.slice(at + 1) }
}

/**
 * Из узла подстановки кабель не выходит и в него не входит: его содержимое
 * создаёт панель, а ребро к нему рисует граф по факту наличия маркера.
 */
export function isValidMihomoConnection(source: string, target: string): boolean {
  const from = split(source)
  const to = split(target)
  if (from === null || to === null) return false
  if (from.kind === 'hosts' || to.kind === 'hosts') return false
  if (to.kind === 'rule') return false
  if (from.kind === 'rule' || from.kind === 'group') {
    return to.kind === 'group' || to.kind === 'provider' || to.kind === 'builtin'
  }
  return false
}

function nameOf(id: string): string {
  return split(id)?.rest ?? ''
}

export function connectMihomo(md: MihomoDoc, source: string, target: string): TextEdit[] {
  if (!isValidMihomoConnection(source, target)) return []
  const from = split(source)!
  const name = nameOf(target)

  if (from.kind === 'rule') {
    const index = Number(from.rest)
    const entry = rulesOf(md).find((r) => r.index === index)
    if (entry?.rule?.target === name) return []
    return setRuleTarget(md, index, name)
  }

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined || group.proxies.includes(name)) return []

  const section = sectionNode(md, 'proxy-groups')
  const item = isSeq(section) ? section.items[group.index] : undefined
  const pair = isMap(item)
    ? item.items.find((p) => (p.key as { value?: unknown } | null)?.value === 'proxies')
    : undefined
  const list = pair?.value
  if (!isSeq(list) || list.items.length === 0) return []

  const last = list.items[list.items.length - 1]
  const range = rangeOf(last)
  if (range === null) return []
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const indent = md.text.slice(lineStart, range.from).replace(/-\s*$/, '')
  const lineEnd = md.text.indexOf('\n', range.to)
  const insertAt = lineEnd === -1 ? md.text.length : lineEnd + 1
  return [{ from: insertAt, to: insertAt, insert: `${indent}- ${stringify(name).trimEnd()}\n` }]
}

export function disconnectMihomo(md: MihomoDoc, edge: string): TextEdit[] {
  const match = /^e:(.+)->(.+)$/.exec(edge)
  if (match === null) return []
  const from = split(match[1]!)
  const name = nameOf(match[2]!)
  // У правила цель обязательна: разрывать нечего, вызывающий предложит сменить её
  if (from === null || from.kind !== 'group') return []

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined) return []
  const section = sectionNode(md, 'proxy-groups')
  const item = isSeq(section) ? section.items[group.index] : undefined
  const pair = isMap(item)
    ? item.items.find((p) => (p.key as { value?: unknown } | null)?.value === 'proxies')
    : undefined
  const list = pair?.value
  if (!isSeq(list)) return []

  const entry = list.items.find((i) => (i as { value?: unknown } | null)?.value === name)
  const range = rangeOf(entry)
  if (range === null) return []
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', range.to)
  return [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }]
}

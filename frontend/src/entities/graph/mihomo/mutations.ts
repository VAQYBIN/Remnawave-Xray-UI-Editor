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

/** Пара `proxies` группы по её индексу в `proxy-groups` — общая точка для connect/disconnect */
function proxiesPair(md: MihomoDoc, groupIndex: number) {
  const section = sectionNode(md, 'proxy-groups')
  const item = isSeq(section) ? section.items[groupIndex] : undefined
  return isMap(item)
    ? item.items.find((p) => (p.key as { value?: unknown } | null)?.value === 'proxies')
    : undefined
}

/**
 * Шаг вложенности, которым в ЭТОМ документе оформлены блочные списки под ключом
 * (`key:` на своей строке, элементы — следующей строкой глубже). Не хардкодим 2
 * пробела: автор шаблона мог выбрать 4 — берём первую же пару «ключ → список» из
 * текста и меряем разницу отступов. Ничего не нашли — 2 пробела, обычный YAML-стиль.
 */
function detectIndentStep(text: string): number {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i]!
    if (!/^\s*\S.*:(?:\s*#.*)?$/.test(line) || /^\s*-/.test(line)) continue
    const keyIndent = /^ */.exec(line)![0].length
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]!
      if (next.trim() === '') continue
      const m = /^( *)-\s/.exec(next)
      if (m !== null && m[1]!.length > keyIndent) return m[1]!.length - keyIndent
      break
    }
  }
  return 2
}

/**
 * Точка вставки сразу ПОСЛЕ строки, на которой лежит `searchFrom` — конец этой
 * строки плюс перевод строки. Если перевод строки после `searchFrom` не нашёлся,
 * это последняя строка файла без завершающего \n: вставка пришлась бы прямо в
 * конец этой строки (`proxies:      - DIRECT` в одну строку — невалидный YAML),
 * поэтому в таком случае сами добавляем ведущий `\n` к вставляемому тексту, а не
 * полагаемся на то, что он уже есть в файле.
 */
function afterLine(text: string, searchFrom: number): { at: number; prefix: string } {
  const lineEnd = text.indexOf('\n', searchFrom)
  return lineEnd === -1 ? { at: text.length, prefix: '\n' } : { at: lineEnd + 1, prefix: '' }
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

  const pair = proxiesPair(md, group.index)
  if (pair === undefined) return [] // ключа proxies нет вовсе — структуру группы не выдумываем
  const list = pair.value
  // Список в одну строку (`[DIRECT, Fast]`) физическая строка держит и ключ, и все
  // элементы разом — дописать элемент сплайсом по диапазону нельзя, не сломав YAML
  if (isSeq(list) && list.flow === true) return []

  if (isSeq(list) && list.items.length > 0) {
    const last = list.items[list.items.length - 1]
    const range = rangeOf(last)
    if (range === null) return []
    const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
    const indent = md.text.slice(lineStart, range.from).replace(/-\s*$/, '')
    const { at, prefix } = afterLine(md.text, range.to)
    return [{ from: at, to: at, insert: `${prefix}${indent}- ${stringify(name).trimEnd()}\n` }]
  }

  // Элементов нет — список либо пуст, либо ключ вообще без значения (частый случай:
  // `proxies: # LEAVE THIS LINE!` — панель нальёт сюда хостов сама). Якоря-элемента
  // нет, поэтому отступ считаем от строки ключа, а не от несуществующей записи —
  // и вставляем ПОСЛЕ всей строки ключа, чтобы не задеть комментарий-маркер на ней.
  const keyRange = rangeOf(pair.key as unknown)
  if (keyRange === null) return []
  const keyLineStart = md.text.lastIndexOf('\n', keyRange.from - 1) + 1
  const keyIndent = md.text.slice(keyLineStart, keyRange.from)
  const indent = keyIndent + ' '.repeat(detectIndentStep(md.text))
  const { at, prefix } = afterLine(md.text, keyRange.from)
  return [{ from: at, to: at, insert: `${prefix}${indent}- ${stringify(name).trimEnd()}\n` }]
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
  const pair = proxiesPair(md, group.index)
  const list = pair?.value
  if (!isSeq(list)) return []
  // Список в одну строку — тот же случай, что и в connectMihomo: физическая строка
  // держит ключ и все элементы разом, удаление строки стёрло бы список целиком
  if (list.flow === true) return []

  const entry = list.items.find((i) => (i as { value?: unknown } | null)?.value === name)
  const range = rangeOf(entry)
  if (range === null) return []
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', range.to)
  return [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }]
}

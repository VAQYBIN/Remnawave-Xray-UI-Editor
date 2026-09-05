// Единственный способ изменить документ. Каждая операция возвращает список
// правок по диапазонам исходного текста; перепечатка документа целиком
// (doc.toString()) запрещена — она меняет байты, которых пользователь не
// касался, и уничтожает комментарии-маркеры подстановки.

import { isAlias, isMap, isSeq, stringify, type Pair } from 'yaml'
import { groupsOf } from './groups'
import { rangeOf, sectionNode, type MihomoDoc } from './parse'
import { rulesOf } from './rules'

export interface TextEdit {
  from: number
  to: number
  insert: string
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.from < sorted[i - 1]!.to) {
      throw new Error('Правки пересекаются — такой набор нельзя применить однозначно')
    }
  }
  let out = ''
  let cursor = 0
  for (const edit of sorted) {
    out += text.slice(cursor, edit.from) + edit.insert
    cursor = edit.to
  }
  return out + text.slice(cursor)
}

/** Печать одного скалярного значения так, как его записал бы YAML */
function scalar(value: string | boolean): string {
  return stringify(value).trimEnd()
}

export type FieldOrigin = 'own' | 'merged' | 'absent'

function groupNode(md: MihomoDoc, index: number): unknown {
  const node = sectionNode(md, 'proxy-groups')
  return isSeq(node) ? node.items[index] : undefined
}

function ownPair(map: unknown, key: string): Pair | undefined {
  if (!isMap(map)) return undefined
  return map.items.find((p) => (p.key as { value?: unknown } | null)?.value === key)
}

/**
 * Есть ли значение ключа `key` в отображении `map` через слияние `<<`. Библиотека
 * `yaml` не разворачивает `<<` сама по себе (парсинг идёт без опции `merge`), поэтому
 * `map.get()` слияние не видит — обходим цепочку алиасов вручную, как groups.ts.
 */
function mergedPresent(md: MihomoDoc, map: unknown, key: string, seen: Set<unknown> = new Set()): boolean {
  if (!isMap(map) || seen.has(map)) return false
  seen.add(map)
  const mergePair = ownPair(map, '<<')
  if (mergePair === undefined) return false
  const targets = isSeq(mergePair.value) ? mergePair.value.items : [mergePair.value]
  return targets.some((target) => {
    const resolved = isAlias(target) ? target.resolve(md.doc) : target
    return ownPair(resolved, key) !== undefined || mergedPresent(md, resolved, key, seen)
  })
}

/**
 * Откуда у поля значение. `merged` — оно пришло через `<<: *anchor`, и править
 * его сплайсом нельзя: изменение затронуло бы все места, где используется якорь.
 */
export function fieldOrigin(md: MihomoDoc, groupIndex: number, key: string): FieldOrigin {
  const node = groupNode(md, groupIndex)
  if (ownPair(node, key) !== undefined) return 'own'
  if (mergedPresent(md, node, key)) return 'merged'
  return 'absent'
}

/**
 * Отступ строки, на которой начинается указанное смещение. Для элемента
 * последовательности («  - name: a») ведущие символы включают дефис — заменяем
 * каждый непробельный символ на пробел, а не отрезаем хвост: так колонка новой
 * строки совпадает с колонкой ключа, от которого считаем отступ, а не с колонкой
 * дефиса.
 */
function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const line = text.slice(lineStart, offset)
  return line.replace(/\S/g, ' ')
}

export function setGroupField(
  md: MihomoDoc,
  groupIndex: number,
  key: string,
  value: string | boolean,
): TextEdit[] {
  const origin = fieldOrigin(md, groupIndex, key)
  // Значение из якоря правкой не трогаем: форма показывает такое поле только для чтения
  if (origin === 'merged') return []

  const node = groupNode(md, groupIndex)
  if (origin === 'own') {
    const range = rangeOf(ownPair(node, key)?.value)
    if (range === null) return []
    return [{ from: range.from, to: range.to, insert: scalar(value) }]
  }

  // Поля нет — дописываем строкой после первого собственного ключа группы
  const first = isMap(node) ? node.items[0] : undefined
  const anchor = rangeOf(first?.value)
  if (anchor === null || anchor === undefined) return []
  const indent = indentAt(md.text, rangeOf(first?.key as unknown)?.from ?? anchor.from)
  return [{ from: anchor.to, to: anchor.to, insert: `\n${indent}${key}: ${scalar(value)}` }]
}

/**
 * Переименование группы. Меняется объявление и каждая ссылка: в rules, в списках
 * proxies других групп и в override.dialer-proxy провайдеров. Пропустить хоть
 * одну — оставить документ с висячей ссылкой.
 */
export function renameGroup(md: MihomoDoc, from: string, to: string): TextEdit[] {
  const edits: TextEdit[] = []
  const groups = groupsOf(md)
  const target = groups.find((g) => g.name === from)
  if (target === undefined) return []

  const namePair = ownPair(groupNode(md, target.index), 'name')
  const nameRange = rangeOf(namePair?.value)
  if (nameRange !== null) edits.push({ from: nameRange.from, to: nameRange.to, insert: scalar(to) })

  const section = sectionNode(md, 'proxy-groups')
  if (isSeq(section)) {
    section.items.forEach((item) => {
      const list = ownPair(item, 'proxies')?.value
      if (!isSeq(list)) return
      list.items.forEach((entry) => {
        if ((entry as { value?: unknown } | null)?.value !== from) return
        const range = rangeOf(entry)
        if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
      })
    })
  }

  rulesOf(md).forEach((entry) => {
    if (entry.rule?.target !== from) return
    // Правим срез исходного ТЕКСТА (`entry.raw`/`entry.range`), а не `entry.rule.raw`:
    // тот хранит декодированное значение без кавычек и по смещениям с текстом не согласован.
    const cut = entry.raw.lastIndexOf(from)
    const insert = entry.raw.slice(0, cut) + to + entry.raw.slice(cut + from.length)
    edits.push({ from: entry.range.from, to: entry.range.to, insert })
  })

  const providers = sectionNode(md, 'proxy-providers')
  if (isMap(providers)) {
    providers.items.forEach((pair) => {
      const override = ownPair(pair.value, 'override')?.value
      const dialer = ownPair(override, 'dialer-proxy')?.value
      if ((dialer as { value?: unknown } | null)?.value !== from) return
      const range = rangeOf(dialer)
      if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
    })
  }

  return edits
}

export function setRuleTarget(md: MihomoDoc, ruleIndex: number, target: string): TextEdit[] {
  const entry = rulesOf(md).find((r) => r.index === ruleIndex)
  if (entry?.rule === undefined || entry.rule === null) return []
  const insert = [
    entry.rule.type,
    ...(entry.rule.payload === undefined ? [] : [entry.rule.payload]),
    target,
    ...entry.rule.modifiers,
  ].join(',')
  return [{ from: entry.range.from, to: entry.range.to, insert }]
}

/** Удаление элемента списка забирает строку целиком — иначе останется «- » */
export function removeRule(md: MihomoDoc, ruleIndex: number): TextEdit[] {
  const entry = rulesOf(md).find((r) => r.index === ruleIndex)
  if (entry === undefined) return []
  const lineStart = md.text.lastIndexOf('\n', entry.range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', entry.range.to)
  return [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }]
}

export function addRule(md: MihomoDoc, raw: string, at?: number): TextEdit[] {
  const rules = rulesOf(md)
  if (rules.length === 0) return []
  const anchor = at === undefined ? rules[rules.length - 1]! : rules.find((r) => r.index === at)
  if (anchor === undefined) return []
  const lineStart = md.text.lastIndexOf('\n', anchor.range.from - 1) + 1
  const indent = md.text.slice(lineStart, anchor.range.from).replace(/-\s*$/, '')
  const line = `${indent}- ${raw}\n`
  if (at === undefined) {
    const lineEnd = md.text.indexOf('\n', anchor.range.to)
    const insertAt = lineEnd === -1 ? md.text.length : lineEnd + 1
    return [{ from: insertAt, to: insertAt, insert: line }]
  }
  return [{ from: lineStart, to: lineStart, insert: line }]
}

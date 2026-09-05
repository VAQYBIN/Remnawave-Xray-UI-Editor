// Единственный способ изменить документ. Каждая операция возвращает список
// правок по диапазонам исходного текста; перепечатка документа целиком
// (doc.toString()) запрещена — она меняет байты, которых пользователь не
// касался, и уничтожает комментарии-маркеры подстановки.

import { isAlias, isMap, isScalar, isSeq, stringify, type Pair } from 'yaml'
import { groupsOf } from './groups'
import { rangeOf, sectionNode, type MihomoDoc, type Range } from './parse'
import { formatRule, parseRule, rulesOf, type MihomoRule } from './rules'

export interface TextEdit {
  from: number
  to: number
  insert: string
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  for (const e of edits) {
    // Минорная находка ревью: без этих проверок испорченная правка (например,
    // диапазон задом наперёд или за пределами текста) молча портит документ
    // вместо явной ошибки на этапе применения.
    if (e.from > e.to) {
      throw new Error('Правка задаёт диапазон задом наперёд: начало больше конца')
    }
    if (e.from < 0 || e.to > text.length) {
      throw new Error('Правка выходит за границы текста')
    }
  }
  // Тай-брейк по концу диапазона (находка I1): сортировка только по началу
  // делала результат зависимым от порядка совпадающих по началу правок во
  // входном массиве — Array.prototype.sort стабилен, но порядок вызова
  // (передал их caller в этом порядке или в обратном) не гарантия ничего.
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to)
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    // Решение В: две вставки нулевой длины в одну и ту же точку тай-брейком не
    // разводятся (у них совпадают и from, и to) — какая должна лечь первой,
    // не решить сортировкой, поэтому это тоже конфликт, а не «повезло с порядком».
    const samePoint = prev.from === prev.to && cur.from === cur.to && prev.from === cur.from
    if (cur.from < prev.to || samePoint) {
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

/**
 * Печать ЦЕЛОЙ строки правила сериализатором (решение Г), а не склейкой через
 * запятую: цель с двоеточием, решёткой или пробелами при склейке даёт либо
 * невалидный YAML, либо превращает строку правила в отображение с комментарием
 * (находка I3) — сериализатор сам решает, нужны ли кавычки и какие.
 */
function ruleText(rule: MihomoRule): string {
  return scalar(formatRule(rule))
}

export type FieldOrigin = 'own' | 'merged' | 'absent'

function groupsSection(md: MihomoDoc): unknown {
  return sectionNode(md, 'proxy-groups')
}

function groupNode(md: MihomoDoc, index: number): unknown {
  const node = groupsSection(md)
  return isSeq(node) ? node.items[index] : undefined
}

function ownPair(map: unknown, key: string): Pair | undefined {
  if (!isMap(map)) return undefined
  return map.items.find((p) => (p.key as { value?: unknown } | null)?.value === key)
}

function pairValue(pair: Pair | undefined): unknown {
  return pair?.value
}

/** Собственное значение поля (без учёта `<<`), приведённое к строке для сравнения */
function scalarOf(node: unknown): unknown {
  return (node as { value?: unknown } | null)?.value
}

/** Коллекция во flow-стиле (`[a, b]`/`{a: b}`) — решение А: такие места сплайсом не правим */
function isFlowNode(node: unknown): boolean {
  return (isMap(node) || isSeq(node)) && (node as { flow?: boolean }).flow === true
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

/** Позиция конца СТРОКИ (символ `\n` или конец текста), на которой лежит `offset` */
function lineEndFrom(text: string, offset: number): number {
  const nl = text.indexOf('\n', offset)
  return nl === -1 ? text.length : nl
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
    // Минорная находка: пустое значение («type:» без содержимого) начинается
    // сразу после двоеточия без пробела — без пробела склейка даст «type:url-test».
    const needsSpace = md.text[range.from - 1] === ':'
    return [{ from: range.from, to: range.to, insert: (needsSpace ? ' ' : '') + scalar(value) }]
  }

  // Поле отсутствует — дописываем его после СОБСТВЕННОГО ключа `name`. У любой
  // валидной группы `name` есть и это всегда скаляр (см. groupsOf) — раньше якорем
  // служил ПЕРВЫЙ ключ группы вообще (`items[0]`); если им оказывалась блочная
  // коллекция (типично для `proxies` с маркером подстановки — самый частый
  // случай), диапазон её значения в yaml включает отступ СЛЕДУЮЩЕГО соседа по
  // списку, и вставка рвала документ (находка C3). У `name` такого не бывает.
  const namePair = ownPair(node, 'name')
  const nameRange = rangeOf(namePair?.value)
  if (nameRange === null) return []
  const keyStart = rangeOf(namePair?.key as unknown)?.from ?? nameRange.from
  const indent = indentAt(md.text, keyStart)
  // Вставляем в конец СТРОКИ, а не в конец значения (находка I5): иначе хвостовой
  // комментарий («- name: g  # важный») окажется приклеен уже к новому полю.
  const at = lineEndFrom(md.text, nameRange.to)
  return [{ from: at, to: at, insert: `\n${indent}${key}: ${scalar(value)}` }]
}

/** Разбор строк-правил произвольного списка (`rules`, любой список в `sub-rules`) */
function ruleEntriesIn(md: MihomoDoc, node: unknown): { rule: MihomoRule | null; range: Range }[] {
  if (!isSeq(node)) return []
  const out: { rule: MihomoRule | null; range: Range }[] = []
  node.items.forEach((item) => {
    const range = rangeOf(item)
    if (range === null) return
    const raw = md.text.slice(range.from, range.to)
    // Разбираем декодированное значение скаляра, а не срез текста — в кавычках
    // их YAML уже снял (см. симметричный комментарий в rules.ts:rulesOf).
    const value = isScalar(item) && typeof item.value === 'string' ? item.value : raw
    out.push({ rule: parseRule(value), range })
  })
  return out
}

/**
 * Переименование группы. Меняется объявление и каждая ссылка на имя по всему
 * документу: списки участников (`proxies`) других групп, top-level `rules` и
 * `sub-rules`, `dialer-proxy` у провайдеров/прокси/групп, `listeners[].proxy`.
 * Пропустить хоть одну ссылку — оставить документ с висячей ссылкой (I2/I4).
 *
 * Если хотя бы одна нужная правка не может быть выполнена безопасно —
 * собственное имя группы пришло через слияние (решение Б), или совпадение
 * лежит внутри коллекции во flow-стиле (решение А) — отказывает ЦЕЛИКОМ,
 * без частичного применения: частичное переименование это та же дыра, от
 * которой правки должны защищать, только с более убедительным на вид итогом.
 */
export function renameGroup(md: MihomoDoc, from: string, to: string): TextEdit[] {
  const groups = groupsOf(md)
  const target = groups.find((g) => g.name === from)
  if (target === undefined) return []

  const groupOrigin = fieldOrigin(md, target.index, 'name')
  if (groupOrigin !== 'own') return []

  const namePair = ownPair(groupNode(md, target.index), 'name')
  const nameRange = rangeOf(namePair?.value)
  if (nameRange === null) return []

  const edits: TextEdit[] = [{ from: nameRange.from, to: nameRange.to, insert: scalar(to) }]
  let blocked = false

  const groupsSectionNode = groupsSection(md)
  if (isSeq(groupsSectionNode)) {
    for (const item of groupsSectionNode.items) {
      const list = pairValue(ownPair(item, 'proxies'))
      if (isSeq(list)) {
        const matches = list.items.filter((entry) => scalarOf(entry) === from)
        if (matches.length > 0 && isFlowNode(list)) {
          blocked = true
        } else {
          for (const entry of matches) {
            const range = rangeOf(entry)
            if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
          }
        }
      }
      // dialer-proxy у самой группы (находка I4)
      const dialer = ownPair(item, 'dialer-proxy')
      if (dialer !== undefined && scalarOf(dialer.value) === from) {
        const range = rangeOf(dialer.value)
        if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
      }
    }
  }

  // top-level `rules` и каждый именованный список в `sub-rules` (находка I4) —
  // это тот же формат строк, просто под другим ключом.
  const ruleLists: unknown[] = [sectionNode(md, 'rules')]
  const subRules = sectionNode(md, 'sub-rules')
  if (isMap(subRules)) {
    for (const pair of subRules.items) ruleLists.push(pair.value)
  }
  for (const list of ruleLists) {
    if (!isSeq(list)) continue
    const entries = ruleEntriesIn(md, list).filter((e) => e.rule?.target === from)
    if (entries.length === 0) continue
    if (isFlowNode(list)) {
      blocked = true
      continue
    }
    for (const entry of entries) {
      edits.push({ from: entry.range.from, to: entry.range.to, insert: ruleText({ ...entry.rule!, target: to }) })
    }
  }

  // dialer-proxy у провайдеров (через override) и у отдельных proxies[] (находка I4)
  const providers = sectionNode(md, 'proxy-providers')
  if (isMap(providers)) {
    for (const pair of providers.items) {
      const override = pairValue(ownPair(pair.value, 'override'))
      const dialer = ownPair(override, 'dialer-proxy')
      if (dialer !== undefined && scalarOf(dialer.value) === from) {
        const range = rangeOf(dialer.value)
        if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
      }
    }
  }

  const proxies = sectionNode(md, 'proxies')
  if (isSeq(proxies)) {
    for (const item of proxies.items) {
      const dialer = ownPair(item, 'dialer-proxy')
      if (dialer !== undefined && scalarOf(dialer.value) === from) {
        const range = rangeOf(dialer.value)
        if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
      }
    }
  }

  const listeners = sectionNode(md, 'listeners')
  if (isSeq(listeners)) {
    for (const item of listeners.items) {
      const proxyField = ownPair(item, 'proxy')
      if (proxyField !== undefined && scalarOf(proxyField.value) === from) {
        const range = rangeOf(proxyField.value)
        if (range !== null) edits.push({ from: range.from, to: range.to, insert: scalar(to) })
      }
    }
  }

  return blocked ? [] : edits
}

export function setRuleTarget(md: MihomoDoc, ruleIndex: number, target: string): TextEdit[] {
  // Решение А: `rules: [...]` во flow-стиле — не наш случай, отказ
  if (isFlowNode(sectionNode(md, 'rules'))) return []
  const entry = rulesOf(md).find((r) => r.index === ruleIndex)
  if (entry?.rule === undefined || entry.rule === null) return []
  return [{ from: entry.range.from, to: entry.range.to, insert: ruleText({ ...entry.rule, target }) }]
}

/** Удаление элемента списка забирает строку целиком — иначе останется «- » */
export function removeRule(md: MihomoDoc, ruleIndex: number): TextEdit[] {
  // Решение А / находка C2: удаление одного элемента `rules: [A, B]` построчной
  // арифметикой стирает всю секцию целиком — такой список не наш случай.
  if (isFlowNode(sectionNode(md, 'rules'))) return []
  const entry = rulesOf(md).find((r) => r.index === ruleIndex)
  if (entry === undefined) return []
  const lineStart = md.text.lastIndexOf('\n', entry.range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', entry.range.to)
  return [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }]
}

export function addRule(md: MihomoDoc, raw: string, at?: number): TextEdit[] {
  // Решение А / находка C2: во flow-списке нет «строк», по которым тут считаем
  if (isFlowNode(sectionNode(md, 'rules'))) return []
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
    // Находка C1: без завершающего перевода строки в исходнике точка вставки —
    // это конец последней НЕЗАВЕРШЁННОЙ строки, а не начало новой; без своего
    // `\n` перед вставкой два правила слипнутся в одну мусорную строку.
    const needsNewline = insertAt > 0 && md.text[insertAt - 1] !== '\n'
    return [{ from: insertAt, to: insertAt, insert: (needsNewline ? '\n' : '') + line }]
  }
  return [{ from: lineStart, to: lineStart, insert: line }]
}

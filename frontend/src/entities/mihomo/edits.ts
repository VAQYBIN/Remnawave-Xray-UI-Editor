// Единственный способ изменить документ. Каждая операция возвращает список
// правок по диапазонам исходного текста; перепечатка документа целиком
// (doc.toString()) запрещена — она меняет байты, которых пользователь не
// касался, и уничтожает комментарии-маркеры подстановки.
//
// Контракт модуля: правки применяются ПО ОДНОЙ, с переразбором документа
// (`parseMihomo`) между вызовами. Диапазоны в `TextEdit` — это диапазоны ИСХОДНОГО
// текста, переданного в конкретный вызов; они не валидны для текста ПОСЛЕ другой
// правки. Поэтому, например, две операции «добавить отсутствующее поле» к одной
// группе В ОДНОМ вызове `applyEdits` дают исключение о пересечении диапазонов —
// это не баг, а следствие контракта: обе правки целятся в одну и ту же точку
// одного и того же (ещё не изменённого) текста. Инспектор обязан применять
// правки одну за другой и заново разбирать документ перед следующей операцией,
// а не собирать их пачкой.

import { isAlias, isMap, isScalar, isSeq, stringify, type Pair } from 'yaml'
import { groupsOf } from './groups'
import { parseMihomo, rangeOf, sectionNode, type MihomoDoc, type Range } from './parse'
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

  // Остаток 1: группа целиком записана во flow-стиле (`{name: a, type: select}`) —
  // у неё нет «строк» с отступом, по которым построена вставка ниже; попытка
  // дописать `\n<indent>key: value` рвёт синтаксис («All mapping items must
  // start at the same column»). Строковую вставку в такую структуру не сделать
  // безопасно в принципе — решение А (замена скаляра «own»-веткой выше по-прежнему
  // безопасна и работает, а вот вставку новой строки распространяем на отказ.
  if (isFlowNode(node)) return []

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
 * Обходит документ целиком и вызывает `onScalar` для каждого узла-скаляра со
 * строковым значением — КРОМЕ узлов из `skip` (уже обработаны отдельно) и
 * содержимого алиасов (`*ref`): алиас сам по себе не содержит текста, реальный
 * текст стоит ровно один раз там, где объявлен якорь (`&ref`), и обычный обход
 * дерева сверху вниз посетит ЭТО место естественным образом (якоря в mihomo-
 * шаблонах — обычные ключи документа, например под `x-anchors`, а не что-то
 * внешнее). Отсюда и главное свойство обхода: он находит КАЖДУЮ ссылку без
 * привязки к конкретным именам ключей (`proxy`, `dialer-proxy`, `proxies`,
 * суффикс `#...` и что угодно ещё) — что и требовалось: перечисление категорий
 * по именам ключей уже дважды оказывалось неполным.
 *
 * `insideFlow` сообщает колбэку, что скаляр лежит внутри коллекции во
 * flow-стиле (решение А) — в том числе если flow-стиль стоит у коллекции,
 * ГДЕ ФИЗИЧЕСКИ ОБЪЯВЛЕН якорь: правка внутри такой коллекции не безопаснее,
 * чем правка внутри `rules: [A, B]`, потому что там нет «строк», к которым
 * привязана арифметика правок.
 */
function walkScalars(
  node: unknown,
  insideFlow: boolean,
  skip: Set<unknown>,
  onScalar: (node: unknown, value: string, insideFlow: boolean) => void,
): void {
  if (node === undefined || node === null || skip.has(node)) return
  if (isAlias(node)) return // текст — у объявления, не здесь; см. комментарий выше
  if (isScalar(node)) {
    const value = (node as { value?: unknown }).value
    if (typeof value === 'string') onScalar(node, value, insideFlow)
    return
  }
  if (isSeq(node)) {
    const flow = insideFlow || isFlowNode(node)
    for (const item of node.items) walkScalars(item, flow, skip, onScalar)
    return
  }
  if (isMap(node)) {
    const flow = insideFlow || isFlowNode(node)
    for (const pair of node.items) walkScalars(pair.value, flow, skip, onScalar)
  }
}

/** Значение скаляра ссылается на группу `from` — целиком или как суффикс `#<имя>` в DNS-строке */
function referenceReplacement(value: string, from: string, to: string): string | null {
  if (value === from) return to
  const suffix = `#${from}`
  if (value.endsWith(suffix)) return value.slice(0, value.length - suffix.length) + `#${to}`
  return null
}

/** Есть ли в поддереве хоть один скаляр, всё ещё ссылающийся на `name` (часть Б — постусловие) */
function hasDanglingReference(node: unknown, name: string): boolean {
  let found = false
  walkScalars(node, false, new Set(), (_node, value) => {
    if (referenceReplacement(value, name, name) !== null) found = true
  })
  return found
}

/**
 * Переименование группы. Меняется объявление и КАЖДАЯ ссылка на имя по всему
 * документу — не по списку известных ключей (список по определению неполон,
 * это уже дважды подтвердилось на практике), а обходом ВСЕГО дерева документа
 * (`walkScalars`): любой скаляр, равный старому имени целиком или оканчивающийся
 * на `#<старое имя>` (суффикс-подсказка в DNS-строках вида
 * `https://.../dns-query#🌍 VPN`), — это ссылка, и её правит обход, а не
 * отдельная ветка кода под конкретное название ключа.
 *
 * Обход НЕ разворачивает алиасы (`*ref`): реальный текст ссылки, разделяемой
 * через `<<`-слияние или обычный `*alias`, стоит ОДИН раз — там, где объявлен
 * якорь (`&ref`, обычно в `x-anchors`), и обычный проход по дереву сверху вниз
 * найдёт эту единственную запись сам, без специального разворота слияний.
 * Значит, правка в этом одном месте чинит СРАЗУ все места, которые эту запись
 * заимствуют, — то же свойство, ради которого раньше отдельно писали код под
 * `dialer-proxy`, `proxies`, `sub-rules` и так далее. Отсюда и симметрия с тем,
 * как ищут саму группу (`groupsOf` тоже разворачивает слияния) — теперь она
 * не требует явного кода, потому что весь документ обходится целиком.
 *
 * Правила (`rules`) и `sub-rules` — исключение: значение правила НЕ равно
 * имени группы целиком (это часть CSV-строки `ТИП,значение,ЦЕЛЬ`), поэтому
 * их правит отдельный проход через `parseRule`/`formatRule` (решение Г) — им
 * обход намеренно не касается (`skip`), чтобы не задавать один и тот же
 * диапазон дважды.
 *
 * Если хотя бы одна ссылка не может быть переписана безопасно — собственное
 * имя группы пришло через слияние (решение Б), правка задела бы коллекцию во
 * flow-стиле, ГДЕ БЫ та ни лежала физически (решение А, распространено и на
 * место объявления якоря — см. `walkScalars`), — операция отказывает ЦЕЛИКОМ,
 * без частичного применения: частичное переименование это та же дыра, от
 * которой правки должны защищать, только с более убедительным на вид итогом.
 *
 * Часть Б (постусловие). Перечисление категорий уже дважды оказывалось
 * неполным, поэтому финальная защита — не список, а факт: применяем
 * собранные правки к КОПИИ текста, разбираем результат заново и обходом того
 * же `walkScalars` проверяем, что старого имени не осталось нигде — ни как
 * значение целиком, ни как суффикс `#<имя>`. Заодно проверяем, что результат
 * вообще разбирается без новых ошибок YAML: если проверка не может доверять
 * разбору, она не может ничего гарантировать. Это дороже по времени (лишний
 * разбор всего документа), но переименование — редкая ручная операция, а
 * тихая порча чужого конфига обходится пользователю дороже любого лишнего
 * отказа. НЕ убирать эту проверку ради скорости — именно она страхует от
 * четвёртого пропущенного места в списке категорий, который найдут не здесь.
 */
export function renameGroup(md: MihomoDoc, from: string, to: string): TextEdit[] {
  const groups = groupsOf(md)
  const target = groups.find((g) => g.name === from)
  if (target === undefined) return []

  const groupOrigin = fieldOrigin(md, target.index, 'name')
  if (groupOrigin !== 'own') return []

  const namePair = ownPair(groupNode(md, target.index), 'name')
  const nameValueNode = namePair?.value
  const nameRange = rangeOf(nameValueNode)
  if (nameRange === null) return []

  const edits: TextEdit[] = [{ from: nameRange.from, to: nameRange.to, insert: scalar(to) }]
  let blocked = false

  // Правила уже обрабатываются отдельно (см. ниже) — исключаем их из общего
  // обхода, а не потому что там не может быть совпадений, а чтобы не задать
  // один и тот же диапазон правкой дважды.
  const skip = new Set<unknown>([nameValueNode])
  skip.add(sectionNode(md, 'rules'))
  const subRules = sectionNode(md, 'sub-rules')
  const ruleLists: unknown[] = [sectionNode(md, 'rules')]
  if (isMap(subRules)) {
    for (const pair of subRules.items) {
      ruleLists.push(pair.value)
      skip.add(pair.value)
    }
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

  // Всё остальное — списки участников групп, dialer-proxy где угодно, `proxy`
  // у провайдеров, DNS-строки с суффиксом и всё, что ещё не названо словами —
  // одним обходом всего документа. Совпадение внутри flow-коллекции (решение А,
  // распространено и на место объявления якоря) правку не получает — вместо
  // этого блокирует всю операцию, чтобы не оставить половинчатое переименование.
  walkScalars(md.doc.contents, false, skip, (node, value, insideFlow) => {
    const replacement = referenceReplacement(value, from, to)
    if (replacement === null) return
    if (insideFlow) {
      blocked = true
      return
    }
    const range = rangeOf(node)
    if (range === null) return
    edits.push({ from: range.from, to: range.to, insert: scalar(replacement) })
  })

  return blocked ? [] : maybeBlockOnUnsafePostcondition(md, from, edits)
}

/**
 * Часть Б — постусловие. Применяет собранные правки к копии текста, разбирает
 * результат заново и требует ДВУХ вещей: документ по-прежнему валиден по YAML
 * (иначе доверять последующей проверке нечему) и старого имени не осталось ни
 * в одном скаляре — ни целиком, ни как суффикс `#<имя>`. Если что-то не так —
 * операция отказывает целиком (`[]`), а не возвращает половину правок: список
 * категорий-мест уже дважды оказывался неполным, и третий пропуск — вопрос
 * времени, а не вероятности. НЕ убирать эту проверку ради скорости.
 */
function maybeBlockOnUnsafePostcondition(md: MihomoDoc, from: string, edits: TextEdit[]): TextEdit[] {
  const preview = applyEdits(md.text, edits)
  const previewDoc = parseMihomo(preview)
  if (previewDoc.issues.length > 0) return []
  if (hasDanglingReference(previewDoc.doc.contents, from)) return []
  return edits
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
  // Остаток 2 (решение Г распространяется и на вставку): `raw` — вход формы,
  // а не гарантированно валидная CSV-строка правила. Печатаем не его буквально,
  // а результат разбора, пересобранный сериализатором — если раскладка `raw`
  // на поля правила зафиксирует, что цель содержит `: `, `#` и т.п., итоговая
  // строка получит нужные кавычки. Буквальная вставка `raw` без этого дала бы
  // валидный YAML-документ (в этом и опасность — никакой диагностики), но уже
  // не список правил, а отображение с обрезанным по `#` содержимым.
  const rule = parseRule(raw)
  if (rule === null) return []
  const rules = rulesOf(md)
  if (rules.length === 0) return []
  const anchor = at === undefined ? rules[rules.length - 1]! : rules.find((r) => r.index === at)
  if (anchor === undefined) return []
  const lineStart = md.text.lastIndexOf('\n', anchor.range.from - 1) + 1
  const indent = md.text.slice(lineStart, anchor.range.from).replace(/-\s*$/, '')
  const line = `${indent}- ${ruleText(rule)}\n`
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

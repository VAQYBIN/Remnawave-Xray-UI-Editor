// Сплайс-примитивы для СКАЛЯРНОГО режима писателя (`entities/mihomo/write.ts`):
// правка существующего собственного однострочного значения — диапазон в
// исходном тексте, а не перепечатка документа целиком (`doc.toString()`
// меняет байты, которых пользователь не касался, и уничтожает комментарии).
// Всё структурное (новый ключ, элемент списка, порядок, flow-коллекция) —
// забота писателя и модели `Document`, этот модуль таких правок не делает
// вовсе: `setFieldAt`/`removeFieldAt` отказывают (`[]`), а не заводят ключ.
//
// Контракт `applyEdits`: правки в одном вызове — это диапазоны ОДНОГО и того
// же (ещё не изменённого) исходного текста; пересекающиеся диапазоны кидают
// исключение, а не молча портят документ.

import { isAlias, isMap, isScalar, isSeq, stringify, type Pair } from 'yaml'
import type { PathParts } from '../xray/config'
import { dealias, mergedHas, mergedNode } from './merge'
import { rangeOf, type MihomoDoc, type Range } from './parse'

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

/**
 * Печать одного скалярного значения так, как его записал бы YAML — ОБЯЗАНА
 * уместиться в одну строку, иначе `null`.
 *
 * `lineWidth: 0` отключает перенос длинных строк (по умолчанию у `stringify`
 * порог 80 символов, «мягкий», но реальный) — находка ревью, раунд 3: без
 * этого длинное значение с пробелом сериализатор МОЛЧА переносит на две
 * строки, а сплайс вставляет в документ разорванный посередине скаляр.
 *
 * Но перенос по ширине — не единственный способ получить многострочный
 * результат: если в САМОМ значении есть перевод строки, `stringify` печатает
 * его блочным скаляром (`|-`) — тоже валидный YAML сам по себе, но сплайс
 * вставляет этот блок туда, где документ ждёт ОДНУ строку (например, значение
 * посреди `key: <тут>` или элемент списка `- <тут>`), и результат синтаксически
 * рвётся. Находка ревью, раунд 4: то же семейство дефекта, что и перенос по
 * ширине, только другая причина переноса — значит, чинить нужно ОБЩИМ
 * правилом («печать обязана быть одной строкой»), а не отдельно под каждую
 * форму переноса, которую мы уже встретили (жду и не жду третью).
 *
 * Каждый вызывающий ОБЯЗАН трактовать `null` как отказ КОНКРЕТНОЙ правки —
 * вернуть пустой список правок, а не подставить `null` в шаблон строки
 * (тогда получилась бы буквальная строка `"null"`).
 *
 * Экспортирован ради `entities/mihomo/refs.ts` (переименование ссылкой):
 * та же проверка однострочности нужна и там, а вторая копия разошлась бы с
 * этой на первом же значении, которое сериализатор решит перенести.
 */
export function scalar(value: string | boolean | number): string | null {
  const printed = stringify(value, { lineWidth: 0 }).trimEnd()
  return printed.includes('\n') ? null : printed
}

/**
 * `alias` (ревью раунд 1, находка 1) — путь к полю прошёл через `*alias` на
 * ПРОМЕЖУТОЧНОМ сегменте составного ключа (`remnawave: *rw`, дальше
 * `include-proxies` внутри `*rw`): отображение, в котором физически лежит
 * поле, — это разделяемое объявление якоря (`&rw`), а не собственная секция
 * узла. Правка по такому пути изменила бы ВСЕ места, которые используют этот
 * алиас, и притом произвольно выбрала бы, чьей строкой считать удаление —
 * тот же класс дефекта, что и `merged` (слияние `<<`), только сооружённый
 * через `*alias`, а не через `<<`. Читателям (`readFieldAt`) `alias` не
 * мешает — значение читается как обычно, просто без права записи.
 *
 * Тем же членом отвечает и второй случай (ревью раунд 2, находки 1 и 2): сам
 * ЛИСТ пути — ссылка (`interval: *n`, `proxies: *base`). Ключ здесь свой, но
 * значение принадлежит объявлению якоря, и правка по диапазону токена `*n`
 * просто СТЁРЛА БЫ авторскую ссылку литералом, ничего об этом не сказав.
 * Определение члена от этого не расширяется: «писать сюда нельзя, потому что
 * правка затронет объявление якоря» — ровно тот же смысл, что и у пути через
 * промежуточный алиас.
 */
export type FieldOrigin = 'own' | 'merged' | 'absent' | 'alias'

function ownPair(map: unknown, key: string): Pair | undefined {
  if (!isMap(map)) return undefined
  return map.items.find((p) => (p.key as { value?: unknown } | null)?.value === key)
}

/**
 * Коллекция во flow-стиле (`[a, b]`/`{a: b}`) — решение А: такие места сплайсом не
 * правим. Не экспортирована: единственный потребитель сейчас — `removeFieldAt`
 * в этом же файле (снятие поля во flow-отображении отказывает, а не рвёт строку).
 */
function isFlowNode(node: unknown): boolean {
  return (isMap(node) || isSeq(node)) && (node as { flow?: boolean }).flow === true
}

/**
 * Перевод строки ЭТОГО документа. Живые шаблоны панели приезжают в CRLF
 * (`bundle.yaml`, `default.yaml` во фикстурах — именно такие); печать модели
 * (`entities/mihomo/write.ts`) вставляет свой перевод строки захардкоженным
 * `\n` и приводит результат к этому же терминатору, чтобы документ не стал
 * смешанным — часть строк `\r\n`, часть голый `\n` — от правки, которую
 * пользователь не касался.
 *
 * Признак — наличие хотя бы одной пары `\r\n`. Уже смешанный документ мы не
 * лечим (это была бы перепечатка байтов, которых пользователь не трогал) —
 * только не добавляем к нему своего.
 */
export function newlineOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Начало строки, следующей ПОСЛЕ блочного значения (например, диапазон
 * блочного списка), чей диапазон заканчивается на `to`.
 *
 * У блочной коллекции второй элемент `node.range` уже включает завершающий
 * перевод строки последнего потомка — то есть указывает на НАЧАЛО следующей
 * физической строки, а не на конец своей (легко проверить: диапазон значения
 * `proxies:\n  - DIRECT\n` заканчивается сразу после этого `\n`, на первом
 * символе следующей строки). Наивный `text.indexOf('\n', to) + 1`, который
 * годится для СКАЛЯРНОГО диапазона (там `to` — середина строки, до хвостового
 * комментария), в этом случае искал бы \n уже СЛЕДУЮЩЕЙ строки и включил бы
 * её в правку целиком.
 *
 * Не экспортирована: единственный потребитель сейчас — `removeFieldAt` в
 * этом же файле (снятие поля с блочным значением забирает его строки целиком,
 * не захватывая соседа).
 */
function afterBlock(text: string, to: number): number {
  if (to > 0 && text[to - 1] === '\n') return to
  const nl = text.indexOf('\n', to)
  return nl === -1 ? text.length : nl + 1
}

/**
 * Отображение по пути; undefined — путь не ведёт к отображению. Общий спуск для
 * `originAt`/`setFieldAt`/`removeFieldAt`/`readFieldAt` — писатель адресует
 * поле парой (путь до узла графа, ключ внутри него), а не голым индексом
 * группы.
 */
function mapAt(md: MihomoDoc, parts: PathParts): unknown {
  let node: unknown = md.doc.contents
  for (const part of parts) {
    if (typeof part === 'number') {
      if (!isSeq(node)) return undefined
      node = node.items[part]
      continue
    }
    if (!isMap(node)) return undefined
    node = node.items.find((p) => (p.key as { value?: unknown } | null)?.value === part)?.value
  }
  return isMap(node) ? node : undefined
}

/**
 * Спуск по составному ключу (`remnawave.include-proxies`) до отображения, в
 * котором лежит последний сегмент. Промежуточного отображения нет — undefined:
 * заводить вложенный блок в чужом файле правка не имеет права, это структурное
 * изменение, а не смена значения.
 *
 * `aliased` (ревью раунд 1, находка 1) — хотя бы один ПРОМЕЖУТОЧНЫЙ сегмент
 * дошёл до своего отображения через `*alias` (`remnawave: *rw`), а не собственным
 * вложенным блоком. `dealias` ниже нужен, чтобы вообще НАЙТИ это отображение
 * (иначе `isMap(Alias)` — `false`, и спуск дальше невозможен), но найденное
 * отображение при этом — общее объявление якоря (`&rw`), используемое, возможно,
 * ещё где-то. Флаг поднимается независимо от того, «свой» или «через `<<`»
 * искомый ключ внутри этого отображения: сам факт прихода через алиас уже
 * запрещает запись, кем бы полем оно ни оказалось.
 */
function ownerOf(
  md: MihomoDoc,
  map: unknown,
  key: string,
): { map: unknown; leaf: string; aliased: boolean } | undefined {
  const segments = key.split('.')
  const leaf = segments.pop()!
  let node = map
  let aliased = false
  for (const segment of segments) {
    if (!isMap(node)) return undefined
    const raw = node.items.find((p) => (p.key as { value?: unknown } | null)?.value === segment)?.value
    if (isAlias(raw)) aliased = true
    node = dealias(md, raw)
  }
  return isMap(node) ? { map: node, leaf, aliased } : undefined
}

/**
 * Откуда у поля значение. `merged` — оно пришло через `<<: *anchor` в ТОМ ЖЕ
 * отображении; `alias` — либо путь до отображения прошёл через `*alias` на
 * промежуточном сегменте составного ключа (см. `ownerOf`), либо ссылкой
 * является само значение найденной собственной пары (`interval: *n`).
 * Ни то, ни другое сплайсом не трогается: правка затронула бы объявление
 * якоря — в первом случае у всех его потребителей, во втором стёрла бы саму
 * ссылку, подменив её литералом.
 */
export function originAt(md: MihomoDoc, parts: PathParts, key: string): FieldOrigin {
  const owner = ownerOf(md, mapAt(md, parts), key)
  if (owner === undefined) return 'absent'
  if (owner.aliased) return 'alias'
  const own = ownPair(owner.map, owner.leaf)
  // Ключ свой, а значение — ссылка: `setFieldAt` заменил бы диапазон токена
  // `*n` литералом и молча уничтожил бы авторскую ссылку (ревью раунд 2).
  if (own !== undefined) return isAlias(own.value) ? 'alias' : 'own'
  return mergedHas(md, owner.map, owner.leaf) ? 'merged' : 'absent'
}

/** Диапазон пары «ключ: значение» — от начала ключа до конца значения */
function pairRangeOf(pair: Pair): Range | null {
  const key = rangeOf(pair.key as unknown)
  const value = rangeOf(pair.value)
  if (key === null) return null
  return { from: key.from, to: value?.to ?? key.to }
}

/**
 * Правка ТОЛЬКО существующего собственного однострочного поля — сплайс по
 * диапазону значения. Отсутствующий ключ раньше вставлялся третьей веткой
 * (якорем служила последняя скалярная пара отображения), но с переходом
 * писателя (`entities/mihomo/write.ts`) на модель `Document` для всего, что не
 * укладывается в сплайс, эта ветка стала МЁРТВОЙ: `spliceOp` там зовёт
 * `setFieldAt` только когда `originAt(...) === 'own'`, а у отсутствующего ключа
 * `originAt` отвечает `'absent'` — сюда такой путь просто не доходит, недостающий
 * ключ заводит режим модели. `key` вида `remnawave.include-proxies` — путь:
 * сначала отображение `remnawave` внутри узла по `parts`, потом ключ в нём;
 * отсутствие промежуточного отображения — отказ (`ownerOf` вернёт undefined),
 * а не создание вложенного блока в чужом файле.
 */
export function setFieldAt(
  md: MihomoDoc,
  parts: PathParts,
  key: string,
  value: string | boolean | number,
): TextEdit[] {
  // Значение из якоря правкой не трогаем — ни пришедшее через `<<` в этом же
  // отображении (`merged`), ни через `*alias` на промежуточном сегменте пути
  // (`alias`, находка 1 ревью раунд 1): форма показывает такое поле только для
  // чтения — изменение задело бы все места, где используется якорь.
  const origin = originAt(md, parts, key)
  if (origin === 'merged' || origin === 'alias') return []
  const owner = ownerOf(md, mapAt(md, parts), key)
  if (owner === undefined) return []
  const printed = scalar(value)
  if (printed === null) return [] // печать не уместилась в одну строку (раунд 4) — отказ

  // Ключа нет среди собственных пар — отказ, а не вставка новой строки: сплайс
  // умеет только заменить существующее значение, завести ключ способна лишь
  // модель `Document` (режим писателя).
  const existing = ownPair(owner.map, owner.leaf)
  if (existing === undefined) return []
  const range = rangeOf(existing.value)
  if (range === null) return []
  // Находка ревью (финальный раунд): замена по диапазону значения верна только
  // для ОДНОСТРОЧНОГО значения. У свёрнутого (`filter: >-`), литерального (`|`)
  // и у блочного СПИСКА диапазон занимает несколько физических строк и
  // заканчивается уже на начале следующей — вставка одной напечатанной строки
  // на его место склеивает соседнюю строку с этой («filter: zzz    type: select»)
  // либо, у списка, оставляет скаляр на месте элементов и порчу не видно даже
  // по ошибкам разбора. Схема объявляет поле строкой, а чужой документ держит
  // тут блок — это штатное расхождение, ради которого модуль и существует,
  // поэтому исход прежний: ОТКАЗ, а не «примерно правильная» правка. Форма по
  // пустому списку правок покажет замок.
  if (md.text.slice(range.from, range.to).includes('\n')) return []
  // Минорная находка: пустое значение («type:» без содержимого) начинается
  // сразу после двоеточия без пробела — без пробела склейка даст «type:url-test».
  const needsSpace = md.text[range.from - 1] === ':'
  return [{ from: range.from, to: range.to, insert: (needsSpace ? ' ' : '') + printed }]
}

/**
 * Снятие СВОЕГО поля вместе со строкой — иначе останется висящий отступ. Поле
 * из слияния снять нельзя тем же способом, что и отредактировать: строка
 * принадлежит объявлению якоря, а не месту, где стоит `<<`, и удалять там
 * нечего — сам ключ `<<` в этом узле никуда не денется.
 */
export function removeFieldAt(md: MihomoDoc, parts: PathParts, key: string): TextEdit[] {
  if (originAt(md, parts, key) !== 'own') return []
  const owner = ownerOf(md, mapAt(md, parts), key)!
  if (isFlowNode(owner.map)) return []
  const pair = ownPair(owner.map, owner.leaf)!
  const range = pairRangeOf(pair)
  if (range === null) return []
  // Удаление ключа забирает его строки целиком — иначе останется висящий отступ.
  // Конец считает `afterBlock`, а не наивный `indexOf('\n', range.to)`: у поля с
  // БЛОЧНЫМ значением (свёрнутый `>-`, литеральный `|`, список) диапазон уже
  // заканчивается на начале следующей физической строки, и поиск \n от него
  // захватывал СОСЕДНЕЕ поле — молча, без единой ошибки разбора (находка ревью,
  // финальный раунд). Для однострочного скаляра `afterBlock` даёт ровно то же,
  // что и прежняя арифметика, — подстановка без побочных эффектов.
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  return [{ from: lineStart, to: afterBlock(md.text, range.to), insert: '' }]
}

/**
 * Значение поля вместе с происхождением. Формы читают ТОЛЬКО отсюда: отдельный
 * читатель разошёлся бы с писателем в трактовке якорей — а это ровно то место,
 * где расхождение стоит порчи чужого файла.
 */
export function readFieldAt(
  md: MihomoDoc,
  parts: PathParts,
  key: string,
): { value: string | number | boolean | string[] | undefined; origin: FieldOrigin } {
  const origin = originAt(md, parts, key)
  if (origin === 'absent') return { value: undefined, origin }
  const owner = ownerOf(md, mapAt(md, parts), key)
  if (owner === undefined) return { value: undefined, origin: 'absent' }
  // Через слияние значение лежит у якоря — читаем его тем же обходом `<<`,
  // которым groups.ts читает behavior и type в живых шаблонах
  const node = dealias(md, mergedNode(md, owner.map, owner.leaf))
  if (isSeq(node)) {
    const json = node.toJSON()
    return {
      value: Array.isArray(json) ? json.filter((v): v is string => typeof v === 'string') : [],
      origin,
    }
  }
  if (!isScalar(node)) return { value: undefined, origin }
  const value = node.value
  return {
    value:
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : undefined,
    origin,
  }
}


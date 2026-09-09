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
import type { PathParts } from '../xray/config'
import { groupsOf } from './groups'
import { dealias, mergedHas, mergedNode } from './merge'
import { parseMihomo, rangeOf, sectionNode, type MihomoDoc, type Range } from './parse'
import { formatRule, parseRule, ruleEntriesOf, rulesOf, type MihomoRule } from './rules'

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
 * вернуть пустой список (или, в `renameGroup`, где правок несколько за один
 * проход, — заблокировать всю операцию целиком), а не подставить `null` в
 * шаблон строки (тогда получилась бы буквальная строка `"null"`).
 *
 * Находка ревью, раунд 5: правило однострочности — не только про правки
 * группы/правила из ЭТОГО модуля. `entities/graph/mihomo/mutations.ts`
 * (коммутация кабелем — connect/disconnect) печатает имя узла той же
 * командой `stringify` и вставляет результат в список `proxies` — тот же
 * риск, тот же класс дефекта. Вместо того чтобы чинить его ТАМ отдельной
 * копией этой же проверки (именно так дефект и родился дважды — по ширине
 * в раунде 3 и по переводу строки в раунде 4, каждый раз в новом месте),
 * `scalar()` экспортирован и используется в обоих модулях — одно родовое
 * лечение, а не две синхронизируемые копии. Зависимость направлена как и
 * раньше: `graph/mihomo` уже импортирует из `mihomo/edits`, обратной
 * зависимости это не создаёт.
 */
export function scalar(value: string | boolean | number): string | null {
  const printed = stringify(value, { lineWidth: 0 }).trimEnd()
  return printed.includes('\n') ? null : printed
}

/**
 * Шаг вложенности, которым в ЭТОМ документе оформлены блочные списки под ключом
 * (`key:` на своей строке, элементы — следующей строкой глубже). Не хардкодим 2
 * пробела: автор шаблона мог выбрать 4 — берём первую же пару «ключ → список» из
 * текста и меряем разницу отступов. Ничего не нашли — 2 пробела, обычный YAML-стиль.
 *
 * Живёт здесь, а не в `entities/graph/mihomo/mutations.ts` (коммутация кабелем,
 * единственный текущий вызывающий): это общая забота вставки в пустой блочный
 * список, а не свойство коммутации — план 2 добавит форму «добавить участника
 * группы», и её тоже придётся звать отсюда. Направление зависимости прежнее:
 * модуль графа импортирует из модуля модели, обратного импорта нет.
 */
export function detectIndentStep(text: string): number {
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
 * Печать ЦЕЛОЙ строки правила сериализатором (решение Г), а не склейкой через
 * запятую: цель с двоеточием, решёткой или пробелами при склейке даёт либо
 * невалидный YAML, либо превращает строку правила в отображение с комментарием
 * (находка I3) — сериализатор сам решает, нужны ли кавычки и какие. `null` —
 * см. `scalar()`: печать самой строки правила не уместилась в одну строку.
 */
function ruleText(rule: MihomoRule): string | null {
  return scalar(formatRule(rule))
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

/**
 * Коллекция во flow-стиле (`[a, b]`/`{a: b}`) — решение А: такие места сплайсом не
 * правим. Экспортирована: `entities/graph/mihomo/mutations.ts` (коммутация кабелем)
 * различает по ней «ключа нет» и «список во flow-стиле» отдельными причинами отказа
 * (`MihomoRefusal`), а не одним и тем же пустым результатом.
 */
export function isFlowNode(node: unknown): boolean {
  return (isMap(node) || isSeq(node)) && (node as { flow?: boolean }).flow === true
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

/**
 * Перевод строки ЭТОГО документа. Живые шаблоны панели приезжают в CRLF
 * (`bundle.yaml`, `default.yaml` во фикстурах — именно такие), а вставки
 * собирались с захардкоженным `\n`: документ становился смешанным — часть строк
 * `\r\n`, часть голый `\n`. Разбор на это не жалуется, но diff показывает
 * изменёнными строки, которых никто не касался, и правка перестаёт читаться.
 *
 * Признак — наличие хотя бы одной пары `\r\n`. Уже смешанный документ мы не
 * лечим (это была бы перепечатка байтов, которых пользователь не трогал) —
 * только не добавляем к нему своего.
 *
 * Один помощник на всех писателей, включая кабель в `graph/mihomo/mutations.ts`:
 * вторая копия этой развилки разошлась бы с первой ровно так же, как дважды
 * расходился расчёт конца блока (`afterBlock`).
 */
export function newlineOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Позиция конца СТРОКИ (символ `\n` или конец текста), на которой лежит `offset` */
function lineEndFrom(text: string, offset: number): number {
  const nl = text.indexOf('\n', offset)
  return nl === -1 ? text.length : nl
}

/**
 * Конец области, занятой значением ГОЛОГО ключа (`proxies:` без значения): своя
 * строка плюс идущие следом строки-комментарии с бо́льшим отступом, чем у ключа.
 * Такой комментарий принадлежит ЗНАЧЕНИЮ ключа, а не следующей паре, и вставка
 * нового поля сразу за строкой ключа встала бы МЕЖДУ ключом и комментарием.
 *
 * Для маркера подстановки это не косметика: `markerAfterKey` (`marker.ts`) ищет
 * его в области от ключа до СЛЕДУЮЩЕГО ключа отображения, и новая пара,
 * вставленная между `proxies:` и `# LEAVE THIS LINE!`, уводит маркер за границу
 * этой области — YAML остаётся валидным, а узел подстановки молча исчезает с
 * холста. Воспроизводится на `bundle.yaml`, группа «⚡️ Fastest», где голый
 * `proxies:` — последняя пара группы.
 *
 * Пустая строка и строка с меньшим или равным отступом область закрывают: там
 * начинается территория соседа, и вставка обязана встать ДО неё.
 */
function nullValueEnd(text: string, keyStart: number, valueEnd: number): number {
  const keyIndent = keyStart - (text.lastIndexOf('\n', keyStart - 1) + 1)
  let end = lineEndFrom(text, valueEnd)
  while (end < text.length) {
    const lineStart = end + 1
    const lineEnd = lineEndFrom(text, lineStart)
    // Только строки-комментарии целиком: значение у ключа отсутствует, ничего
    // другого принадлежать ему тут не может
    const indent = /^( *)#/.exec(text.slice(lineStart, lineEnd))?.[1]
    if (indent === undefined || indent.length <= keyIndent) break
    end = lineEnd
  }
  return end
}

/**
 * Начало строки, следующей ПОСЛЕ блочной коллекции (элемент `proxy-groups`,
 * блочный список `proxies` и подобные), чей диапазон заканчивается на `to`.
 *
 * У блочной коллекции второй элемент `node.range` уже включает завершающий
 * перевод строки последнего потомка — то есть указывает на НАЧАЛО следующей
 * физической строки, а не на конец своей (легко проверить: диапазон значения
 * `proxies:\n  - DIRECT\n` заканчивается сразу после этого `\n`, на первом
 * символе следующей строки). Наивный `text.indexOf('\n', to) + 1`, который
 * годится для СКАЛЯРНОГО диапазона (там `to` — середина строки, до хвостового
 * комментария), в этом случае искал бы \n уже СЛЕДУЮЩЕЙ строки и включил бы
 * её в правку целиком — тот же класс дефекта, что и находка C3 плана 1 (там
 * его обошли, выбрав якорем гарантированно скалярный ключ `name`), только
 * здесь коллекция и есть сам предмет правки, обойти её нечем.
 *
 * Экспортирован ради `entities/graph/mihomo/mutations.ts` (коммутация кабелем):
 * там удаление участника группы считало конец строки тем же наивным
 * `indexOf('\n', range.to)` и на многострочной записи имени съедало СЛЕДУЮЩЕГО
 * участника. Второй копии этой арифметики в проекте быть не должно — она уже
 * дважды разъезжалась с оригиналом.
 */
export function afterBlock(text: string, to: number): number {
  if (to > 0 && text[to - 1] === '\n') return to
  const nl = text.indexOf('\n', to)
  return nl === -1 ? text.length : nl + 1
}

/**
 * Отображение по пути; undefined — путь не ведёт к отображению. Общий спуск для
 * `originAt`/`setFieldAt`/`removeFieldAt`/`readFieldAt`/`setListAt` — формы
 * инспектора адресуют поле парой (путь до узла графа, ключ внутри него), а не
 * голым индексом группы, как раньше умел только `setGroupField`.
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

/**
 * Тонкая обёртка над `originAt` для частого случая «поле группы» — сигнатура и
 * поведение сохранены ради `mutations.ts` (коммутация кабелем) и тестов плана 1.
 */
export function fieldOrigin(md: MihomoDoc, groupIndex: number, key: string): FieldOrigin {
  return originAt(md, ['proxy-groups', groupIndex], key)
}

/** Диапазон пары «ключ: значение» — от начала ключа до конца значения */
function pairRangeOf(pair: Pair): Range | null {
  const key = rangeOf(pair.key as unknown)
  const value = rangeOf(pair.value)
  if (key === null) return null
  return { from: key.from, to: value?.to ?? key.to }
}

/**
 * Последняя СВОЯ пара отображения со скалярным значением — безопасный якорь для
 * вставки отсутствующего поля. Раньше (`setGroupField`) якорем всегда служил
 * ключ `name`: он гарантированно есть у группы и гарантированно однострочный.
 * У произвольной секции (`dns`, `remnawave` и т.п.) такого гарантированного
 * ключа нет, поэтому здесь берётся ЛЮБАЯ скалярная своя пара — блочная
 * коллекция (список/отображение) не годится по той же причине, что и раньше
 * (находка C3): её диапазон в yaml может включать отступ следующего соседа, и
 * вставка по такому диапазону рвёт документ.
 */
function lastScalarPair(map: unknown): Pair | undefined {
  if (!isMap(map)) return undefined
  let found: Pair | undefined
  for (const pair of map.items) {
    if (isScalar(pair.value)) found = pair
  }
  return found
}

/**
 * Правка поля ЛЮБОЙ секции документа, а не только группы — `setGroupField`
 * теперь тонкая обёртка над этой функцией (задача 7). `key` вида
 * `remnawave.include-proxies` — путь: сначала отображение `remnawave` внутри
 * узла по `parts`, потом ключ в нём; отсутствие промежуточного отображения —
 * отказ (`ownerOf` вернёт undefined), а не создание вложенного блока в чужом
 * файле.
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

  const existing = ownPair(owner.map, owner.leaf)
  if (existing !== undefined) {
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

  // Остаток 1: отображение целиком записано во flow-стиле (`{a: b}`) — у него
  // нет «строк» с отступом, по которым построена вставка ниже; попытка
  // дописать `\n<indent>key: value` рвёт синтаксис («All mapping items must
  // start at the same column»). Замена скаляра выше по-прежнему безопасна и
  // работает (решения А это не касается) — а вот вставку новой строки
  // распространяем на отказ.
  if (isFlowNode(owner.map)) return []

  // Поле отсутствует — дописываем его после последней СВОЕЙ скалярной пары
  // отображения (см. `lastScalarPair`). Нет ни одной скалярной пары — отказ,
  // а не рискованная вставка после блочной коллекции.
  const anchor = lastScalarPair(owner.map)
  if (anchor === undefined) return []
  const anchorRange = rangeOf(anchor.value)
  if (anchorRange === null) return []
  const keyStart = rangeOf(anchor.key as unknown)?.from ?? anchorRange.from
  const indent = indentAt(md.text, keyStart)
  // Вставляем в конец СТРОКИ, а не в конец значения (находка I5): иначе хвостовой
  // комментарий («- name: g  # важный») окажется приклеен уже к новому полю.
  // У голого ключа строка не одна: комментарии под ним принадлежат его значению
  // (см. `nullValueEnd`) — вставка между ключом и маркером отвязала бы маркер.
  const bareKey = isScalar(anchor.value) && anchor.value.value === null
  const end = bareKey
    ? nullValueEnd(md.text, keyStart, anchorRange.to)
    : lineEndFrom(md.text, anchorRange.to)
  const nl = newlineOf(md.text)
  const line = `${indent}${owner.leaf}: ${printed}`
  // Вставляем НАЧАЛОМ следующей строки, а не хвостом текущей: в CRLF-документе
  // ведущий перевод строки встал бы между `\r` и `\n` якорной строки и порвал бы
  // её терминатор надвое. `end` — позиция `\n` (`lineEndFrom`), значит `end + 1`
  // и есть начало следующей строки, каким бы ни был терминатор.
  if (end < md.text.length) return [{ from: end + 1, to: end + 1, insert: line + nl }]
  // Конец файла без завершающего перевода строки: следующей строки нет, её
  // придётся начать самим (находка C1 в третьем обличье)
  return [{ from: end, to: end, insert: nl + line }]
}

/** Тонкая обёртка над `setFieldAt` для частого случая «поле группы» — сигнатура
 *  и поведение сохранены ради тестов плана 1. */
export function setGroupField(
  md: MihomoDoc,
  groupIndex: number,
  key: string,
  value: string | boolean,
): TextEdit[] {
  return setFieldAt(md, ['proxy-groups', groupIndex], key, value)
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

/**
 * Замена блочного списка целиком. Диапазон списка заменяется напечатанными
 * строками с тем же отступом, что был у первого элемента (а если элементов не
 * было — отступ ключа плюс шаг вложенности документа).
 */
export function setListAt(
  md: MihomoDoc,
  parts: PathParts,
  key: string,
  values: string[],
): TextEdit[] {
  if (originAt(md, parts, key) !== 'own') return []
  const owner = ownerOf(md, mapAt(md, parts), key)!
  const pair = ownPair(owner.map, key.split('.').pop()!)!
  const list = pair.value
  // Алиас на список (`proxies: *base`, находка 2 ревью раунд 1) — ключ «свой»
  // (origin === 'own', вот почему это не ловится проверкой выше), но его
  // ЗНАЧЕНИЕ — ссылка на чужое объявление, а не блочный список и не «пусто».
  // Без этой проверки ветка «пустого списка» ниже приняла бы диапазон алиаса
  // за отсутствующий список и дописала бы новый блок РЯДОМ с ним, оставив сам
  // алиас на строке ключа — синтаксически битый документ (воспроизведено на
  // `bundle.yaml`: `dns.default-nameserver: *dns_ru`).
  //
  // После ревью раунд 2 такой ключ отсеивается ещё проверкой origin выше
  // (`alias`), и сюда дойти уже нельзя. Проверку оставляем: `setListAt`
  // экспортирован, и защита от порчи документа не должна зависеть от того, кто
  // и в каком порядке спросил происхождение поля до вызова.
  if (isAlias(list)) return []
  // Список в одну строку держит ключ и элементы одной физической строкой —
  // построчная арифметика ниже его порвёт (решение А, как в connectMihomo)
  if (isSeq(list) && list.flow === true) return []
  // Значение — не блочный список и не «пусто» (голый ключ без значения либо с
  // маркером-комментарием, `isScalar(list) && list.value === null`) — структуру
  // придумывать не будем, отказ
  if (!isSeq(list) && !(isScalar(list) && list.value === null)) return []
  const printed = values.map((v) => scalar(v))
  // Хоть один элемент не печатается одной строкой — отказ целиком, а не
  // частичная запись: половина списка хуже, чем несделанная правка
  if (printed.some((p) => p === null)) return []

  const listRange = rangeOf(list)
  const first = isSeq(list) ? list.items[0] : undefined
  const firstRange = rangeOf(first)
  // Отступ элементов: у существующего первого элемента — его собственный,
  // у пустого списка — отступ ключа плюс шаг вложенности документа
  const keyRange = rangeOf(pair.key as unknown)
  if (keyRange === null) return []
  const indent =
    firstRange === null
      ? md.text.slice(md.text.lastIndexOf('\n', keyRange.from - 1) + 1, keyRange.from) +
        ' '.repeat(detectIndentStep(md.text))
      : md.text
          .slice(md.text.lastIndexOf('\n', firstRange.from - 1) + 1, firstRange.from)
          .replace(/-\s*$/, '')
  const nl = newlineOf(md.text)
  const block = printed.map((p) => `${indent}- ${p}${nl}`).join('')

  // Пустой список записан на строке ключа (`proxies: []` или `proxies:` с
  // комментарием-маркером) — заменять его диапазон нельзя, там же может стоять
  // маркер подстановки; дописываем блок ПОСЛЕ строки ключа
  if (listRange === null || firstRange === null) {
    const lineEnd = md.text.indexOf('\n', keyRange.from)
    const at = lineEnd === -1 ? md.text.length : lineEnd + 1
    const lead = at > 0 && md.text[at - 1] !== '\n' ? nl : ''
    return [{ from: at, to: at, insert: lead + block }]
  }

  // Есть блочные элементы — заменяем их строки целиком, от начала строки
  // первого элемента до конца строки последнего (`afterBlock` — находка
  // задачи 7: диапазон списка сам по себе уже указывает на начало СЛЕДУЮЩЕЙ
  // строки, наивный поиск \n от него захватил бы и её)
  const lineStart = md.text.lastIndexOf('\n', firstRange.from - 1) + 1
  const to = afterBlock(md.text, listRange.to)
  return [{ from: lineStart, to, insert: block }]
}


/**
 * Ключи, чьё значение НИКОГДА не считается ссылкой на группу — обход в них не
 * заходит вовсе, что бы там ни было написано (находка ревью, раунд 3:
 * «в обходе точность важнее полноты»). Причина у каждого своя, но исход один —
 * совпадение значения с именем группы здесь СЛУЧАЙНОСТЬ, а не ссылка:
 *  - `filter`/`exclude-filter`/`exclude-type` матчат имена ХОСТОВ (прокси),
 *    а не групп — переписав их, группа перестанет ловить свои же серверы;
 *  - `name` — идентичность ДРУГОЙ сущности (прокси, набора правил и т.п.),
 *    просто совпавшая по строке с именем этой группы;
 *  - `icon`/`url`/`path`/`additional-prefix` — произвольные строки/URL, где
 *    имя группы может встретиться как случайная подстрока/суффикс;
 *  - `payload` — элементы набора правил (IP/домен-паттерны), не имена групп;
 *  - `hosts`/`fake-ip-filter` — статические host-записи и правила fake-ip,
 *    имя группы там в принципе не ссылка ни на что;
 *  - `use` — список имён ПРОВАЙДЕРОВ (`proxy-providers`), а не групп (находка
 *    ревью, раунд 4): провайдер, названный так же, как переименовываемая
 *    группа, иначе получил бы переписанную ссылку при неизменном собственном
 *    объявлении — тихий разрыв, который постусловие ниже не ловит вообще
 *    (старого имени в документе не останется, для него всё будет чисто).
 * Асимметрия рисков объясняет выбор в пользу точности: пропущенную ссылку
 * ловит постусловие ниже и операция честно отказывает (пользователь видит
 * «не сработало» и правит руками) — а лишнюю правку постусловие не ловит
 * НИЧЕМ: оно ищет остатки старого имени, а лишняя правка их как раз убирает.
 */
const EXCLUDED_REFERENCE_KEYS = new Set([
  'filter', 'exclude-filter', 'exclude-type', 'name', 'icon', 'url', 'path',
  'additional-prefix', 'payload', 'hosts', 'fake-ip-filter', 'use',
])

/**
 * Обходит документ целиком и вызывает `onScalar` для каждого узла-скаляра со
 * строковым значением — КРОМЕ узлов из `skip` (уже обработаны отдельно),
 * значений ключей из `EXCLUDED_REFERENCE_KEYS` (заведомо не ссылки — см. выше)
 * и содержимого алиасов (`*ref`): алиас сам по себе не содержит текста,
 * реальный текст стоит ровно один раз там, где объявлен якорь (`&ref`), и
 * обычный обход дерева сверху вниз посетит ЭТО место естественным образом
 * (якоря в mihomo-шаблонах — обычные ключи документа, например под
 * `x-anchors`, а не что-то внешнее). Отсюда и главное свойство обхода: он
 * находит КАЖДУЮ ссылку без привязки к конкретным именам ключей (`proxy`,
 * `dialer-proxy`, `proxies`, суффикс `#...` и что угодно ещё) — что и
 * требовалось: перечисление категорий по именам ключей уже дважды оказывалось
 * неполным. Список ИСКЛЮЧЕНИЙ — другое дело: это не про полноту, а про то, что
 * значение этих ключей в принципе не может быть ссылкой на группу.
 *
 * `mode.insideFlow` сообщает колбэку, что скаляр лежит внутри коллекции во
 * flow-стиле (решение А) — в том числе если flow-стиль стоит у коллекции,
 * ГДЕ ФИЗИЧЕСКИ ОБЪЯВЛЕН якорь: правка внутри такой коллекции не безопаснее,
 * чем правка внутри `rules: [A, B]`, потому что там нет «строк», к которым
 * привязана арифметика правок.
 *
 * `mode.dnsOnly` — тем же способом, что `insideFlow`, взводится один раз при
 * входе в поддерево ключа `dns` и остаётся взведённым до конца поддерева.
 * Находка ревью, раунд 4: под `dns` (`nameserver`, `nameserver-policy` и
 * подобные) ссылка на группу — это ТОЛЬКО суффикс `#<имя>` в DNS-строке вида
 * `https://.../dns-query#🌍 VPN` (задокументированное поведение mihomo), а
 * голый скаляр, равный имени группы целиком, — совпадение, а не ссылка: там
 * в принципе ожидаются адреса/IP/ключевые слова, а не имена групп. Вне `dns`
 * голое совпадение остаётся ссылкой (участник группы, `dialer-proxy`, `proxy`
 * у провайдера и так далее) — поэтому это именно РЕЖИМ обхода, а не ещё один
 * исключённый ключ.
 *
 * Оба флага взведённого режима переданы одним объектом `WalkMode`, а не двумя
 * соседними булевыми параметрами: перестановка `insideFlow` и `dnsOnly`
 * местами раньше не давала ни ошибки типов, ни красного теста, а на этой
 * функции держится корректность переименования.
 */
interface WalkMode {
  insideFlow: boolean
  dnsOnly: boolean
}

function walkScalars(
  node: unknown,
  mode: WalkMode,
  skip: Set<unknown>,
  onScalar: (node: unknown, value: string, mode: WalkMode) => void,
): void {
  if (node === undefined || node === null || skip.has(node)) return
  if (isAlias(node)) return // текст — у объявления, не здесь; см. комментарий выше
  if (isScalar(node)) {
    const value = (node as { value?: unknown }).value
    if (typeof value === 'string') onScalar(node, value, mode)
    return
  }
  if (isSeq(node)) {
    const insideFlow = mode.insideFlow || isFlowNode(node)
    for (const item of node.items) walkScalars(item, { ...mode, insideFlow }, skip, onScalar)
    return
  }
  if (isMap(node)) {
    const insideFlow = mode.insideFlow || isFlowNode(node)
    for (const pair of node.items) {
      const key = (pair.key as { value?: unknown } | null)?.value
      if (typeof key === 'string' && EXCLUDED_REFERENCE_KEYS.has(key)) continue
      const dnsOnly = mode.dnsOnly || key === 'dns'
      walkScalars(pair.value, { insideFlow, dnsOnly }, skip, onScalar)
    }
  }
}

const WALK_ROOT: WalkMode = { insideFlow: false, dnsOnly: false }

/**
 * Значение скаляра ссылается на группу `from` — целиком (кроме `dnsOnly`,
 * находка ревью раунд 4 — см. `walkScalars`) или как суффикс `#<имя>` в
 * DNS-строке (везде, включая `dnsOnly`).
 */
function referenceReplacement(value: string, from: string, to: string, dnsOnly: boolean): string | null {
  const suffix = `#${from}`
  if (value.endsWith(suffix)) return value.slice(0, value.length - suffix.length) + `#${to}`
  if (dnsOnly) return null
  if (value === from) return to
  return null
}

/** Есть ли в поддереве хоть один скаляр, всё ещё ссылающийся на `name` (часть Б — постусловие) */
function hasDanglingReference(node: unknown, name: string): boolean {
  let found = false
  walkScalars(node, WALK_ROOT, new Set(), (_node, value, mode) => {
    if (referenceReplacement(value, name, name, mode.dnsOnly) !== null) found = true
  })
  return found
}

/**
 * Находка 3 (раунд 3): постусловие должно ловить и то, до чего сам обход в
 * принципе не достаёт — не потому что забыли категорию, а потому что там
 * НЕТ узла-скаляра, равного имени целиком: правило (`rules`/`sub-rules`),
 * заданное через алиас на весь список (`rules: *base`) или слияние верхнего
 * уровня, — `walkScalars` не разворачивает алиасы принципиально (см. его
 * комментарий), а `tunnels` в CSV-форме — секция, о которой основной проход
 * вообще не знает (список категорий по именам ключей уже дважды оказывался
 * неполным — здесь та же болезнь, но её не лечит новая категория, а РОДОВОЙ
 * тест: разбираем скаляр КАК правило, а не проверяем его на равенство имени.
 *
 * `parseRule` не проверяет тип на принадлежность `RULE_TYPES` — этим и
 * пользуемся: строка `tcp,127.0.0.1:7888,🌍 VPN` из `tunnels` разбирается
 * так же, как обычное правило, и её последнее поле распознаётся как цель.
 *
 * `SUB-RULE` исключён: его цель — имя ПОДСПИСКА в `sub-rules`, а не группы
 * (см. `renameGroup` — по той же причине его не переименовывает и основной
 * проход), поэтому оставленный `SUB-RULE,...,<старое имя>` — это ожидаемо
 * неизменное значение, а не висячая ссылка.
 */
function hasDanglingRuleTarget(node: unknown, from: string): boolean {
  let found = false
  walkScalars(node, WALK_ROOT, new Set(), (_node, value) => {
    const rule = parseRule(value)
    if (rule !== null && rule.type !== 'SUB-RULE' && rule.target === from) found = true
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
  const matches = groups.filter((g) => g.name === from)
  // Дубликат имени — допустимое состояние документа (диагностика уже метит
  // его ошибкой, но документ читается и рисуется): find() переименовал бы
  // только первую, вторая осталась бы сиротой без единого способа её
  // адресовать. Лучше не сделать ничего, чем сделать половину.
  if (matches.length !== 1) return []
  // Симметрично проверке выше, только на стороне ЦЕЛИ (находка ревью, финальный
  // раунд): переименование в занятое имя САМО создаёт ту неоднозначность, из-за
  // которой отказывает проверка источника — две группы с одним именем плюс
  // самоссылка (участник переименованной группы теперь зовётся так же, как она).
  // Диагностики на это загораются, то есть порча не молчаливая, но откатить
  // операцию редактором уже нельзя: `matches.length !== 1` теперь отказывает на
  // любом переименовании обеих групп, и распутывать документ приходится руками.
  // Форма проверяет только непустоту имени, так что единственное место, где это
  // можно поймать, — здесь.
  if (groups.some((g) => g.name === to)) return []
  const target = matches[0]!

  const groupOrigin = fieldOrigin(md, target.index, 'name')
  if (groupOrigin !== 'own') return []

  const namePair = ownPair(groupNode(md, target.index), 'name')
  const nameValueNode = namePair?.value
  const nameRange = rangeOf(nameValueNode)
  if (nameRange === null) return []
  const printedTo = scalar(to)
  if (printedTo === null) return [] // новое имя не печатается одной строкой (раунд 4) — отказ

  const edits: TextEdit[] = [{ from: nameRange.from, to: nameRange.to, insert: printedTo }]
  let blocked = false

  // Правила уже обрабатываются отдельно (см. ниже) — исключаем их из общего
  // обхода, а не потому что там не может быть совпадений, а чтобы не задать
  // один и тот же диапазон правкой дважды. Собственное имя группы
  // (`nameValueNode`) отдельно в `skip` НЕ добавлено — вместо этого обход
  // пропускает ЛЮБОЕ значение ключа `name` через `EXCLUDED_REFERENCE_KEYS`
  // (находка 2, раунд 3). Это не «стало избыточным», а НЕЯВНАЯ ЗАВИСИМОСТЬ:
  // убери `name` из списка исключений — и правка выше (объявление) столкнётся
  // со второй правкой того же диапазона от общего обхода, applyEdits кинет
  // исключение о пересечении. Список исключений — это не просто оптимизация
  // точности, а ЕДИНСТВЕННОЕ, что не даёт объявлению получить двойную правку.
  const skip = new Set<unknown>()
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
    // Находка 2 (раунд 3): цель `SUB-RULE` — это имя ПОДСПИСКА в `sub-rules`,
    // а не группы; переименовывать её здесь — переименовать не то (документ
    // остался бы синтаксически цел, но ссылка была бы уже не на ту сущность).
    const entries = ruleEntriesOf(md, list).filter((e) => e.rule?.target === from && e.rule.type !== 'SUB-RULE')
    if (entries.length === 0) continue
    if (isFlowNode(list)) {
      blocked = true
      continue
    }
    for (const entry of entries) {
      const printed = ruleText({ ...entry.rule!, target: to })
      if (printed === null) {
        // Печать не уместилась в одну строку (раунд 4) — отказ всей операции,
        // а не пропуск этой одной правки: пропуск оставил бы СТАРУЮ цель,
        // и постусловие (`hasDanglingRuleTarget`) поймало бы её как висячую
        // ссылку — тот же итог, только после лишней работы. Проще и честнее
        // отказать сразу.
        blocked = true
        continue
      }
      edits.push({ from: entry.range.from, to: entry.range.to, insert: printed })
    }
  }

  // Всё остальное — списки участников групп, dialer-proxy где угодно, `proxy`
  // у провайдеров, DNS-строки с суффиксом и всё, что ещё не названо словами —
  // одним обходом всего документа. Совпадение внутри flow-коллекции (решение А,
  // распространено и на место объявления якоря) правку не получает — вместо
  // этого блокирует всю операцию, чтобы не оставить половинчатое переименование.
  walkScalars(md.doc.contents, WALK_ROOT, skip, (node, value, mode) => {
    const replacement = referenceReplacement(value, from, to, mode.dnsOnly)
    if (replacement === null) return
    if (mode.insideFlow) {
      blocked = true
      return
    }
    const range = rangeOf(node)
    if (range === null) return
    const printed = scalar(replacement)
    if (printed === null) {
      // Тот же случай, что и с правилами выше: печать не уместилась в одну
      // строку — отказ всей операции, а не тихий пропуск ссылки.
      blocked = true
      return
    }
    edits.push({ from: range.from, to: range.to, insert: printed })
  })

  return blocked ? [] : maybeBlockOnUnsafePostcondition(md, from, edits)
}

/**
 * Часть Б — постусловие. Применяет собранные правки к копии текста, разбирает
 * результат заново и требует ТРЁХ вещей: документ по-прежнему валиден по YAML
 * (иначе доверять последующим проверкам нечему), старого имени не осталось ни
 * в одном скаляре — ни целиком, ни как суффикс `#<имя>` (`hasDanglingReference`,
 * исключения — те же `EXCLUDED_REFERENCE_KEYS`, что и при сборе правок: иначе
 * постусловие наказывало бы за ПРАВИЛЬНО оставленный `filter`/`name`/`hosts`
 * ложным отказом), и ни один скаляр не разбирается как правило с целью,
 * равной старому имени (`hasDanglingRuleTarget`, находка 3 — ловит правила,
 * до которых сам обход в принципе не достаёт: алиас на весь список правил,
 * слияние верхнего уровня, `tunnels` в CSV-форме). Если что-то не так —
 * операция отказывает целиком (`[]`), а не возвращает половину правок: список
 * категорий-мест уже трижды оказывался неполным, и это не будет последним
 * разом. НЕ убирать эти проверки ради скорости.
 */
function maybeBlockOnUnsafePostcondition(md: MihomoDoc, from: string, edits: TextEdit[]): TextEdit[] {
  const preview = applyEdits(md.text, edits)
  const previewDoc = parseMihomo(preview)
  if (previewDoc.issues.length > 0) return []
  if (hasDanglingReference(previewDoc.doc.contents, from)) return []
  if (hasDanglingRuleTarget(previewDoc.doc.contents, from)) return []
  return edits
}

export function setRuleTarget(md: MihomoDoc, ruleIndex: number, target: string): TextEdit[] {
  // Решение А: `rules: [...]` во flow-стиле — не наш случай, отказ
  if (isFlowNode(sectionNode(md, 'rules'))) return []
  const entry = rulesOf(md).find((r) => r.index === ruleIndex)
  if (entry?.rule === undefined || entry.rule === null) return []
  const printed = ruleText({ ...entry.rule, target })
  // Находка ревью, раунд 4: печать могла не уместиться в одну строку (перевод
  // строки в `target`) — здесь, в отличие от `renameGroup`, постусловия нет,
  // поэтому отказ обязан быть явным, а не понадеявшимся на что-то ещё.
  if (printed === null) return []
  return [{ from: entry.range.from, to: entry.range.to, insert: printed }]
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

/**
 * Первое правило документа: якорной строки, от которой считаются отступы, ещё
 * нет, и оба случая различает наличие самого ключа `rules`.
 *
 * Раньше на оба отвечал пустой список правок, и кнопка «+ Правило» молча не
 * работала ровно там, где правило нужнее всего, — в документе, где правил ещё
 * нет. Подсказка пустого холста при этом обещала «заведите группу и правило
 * кнопками ниже».
 *
 * Ключ есть, но под ним не пусто (отображение, скаляр со значением, ссылка на
 * якорь) — отказ: структуру чужого документа редактор не выдумывает, это тот же
 * принцип, по которому отказывает `addGroup`. Корень не отображение — отказ по
 * той же причине.
 */
function firstRuleEdits(md: MihomoDoc, printed: string): TextEdit[] {
  const root = md.doc.contents
  if (!isMap(root)) return []
  const step = ' '.repeat(detectIndentStep(md.text))
  const nl = newlineOf(md.text)
  const pair = root.items.find((p) => (p.key as { value?: unknown } | null)?.value === 'rules')

  // Ключа нет вовсе — секция дописывается в конец документа. Свой перевод
  // строки перед ней обязателен, если документ им не оканчивается (находка C1):
  // иначе `rules:` приклеится к последней незавершённой строке.
  if (pair === undefined) {
    const at = md.text.length
    const lead = at > 0 && md.text[at - 1] !== '\n' ? nl : ''
    return [{ from: at, to: at, insert: `${lead}rules:${nl}${step}- ${printed}${nl}` }]
  }

  if (!(isScalar(pair.value) && pair.value.value === null)) return []
  const keyRange = rangeOf(pair.key as unknown)
  if (keyRange === null) return []
  const keyLineStart = md.text.lastIndexOf('\n', keyRange.from - 1) + 1
  const indent = md.text.slice(keyLineStart, keyRange.from) + step
  const lineEnd = md.text.indexOf('\n', keyRange.from)
  const insertAt = lineEnd === -1 ? md.text.length : lineEnd + 1
  const lead = insertAt > 0 && md.text[insertAt - 1] !== '\n' ? nl : ''
  return [{ from: insertAt, to: insertAt, insert: `${lead}${indent}- ${printed}${nl}` }]
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
  const printed = ruleText(rule)
  // Находка ревью, раунд 4: перевод строки внутри `raw` (например, в цели)
  // заставил бы сериализатор напечатать блочный скаляр (`|-`) вместо одной
  // строки — сплайс вставил бы многострочный кусок туда, где список правил
  // ждёт ровно одну новую строку. Отказ, а не порча.
  if (printed === null) return []
  const rules = rulesOf(md)
  // Правил ещё нет: считать отступ не от чего, и оба случая («ключ голый» и
  // «ключа нет») разбирает отдельный помощник
  if (rules.length === 0) return firstRuleEdits(md, printed)
  const anchor = at === undefined ? rules[rules.length - 1]! : rules.find((r) => r.index === at)
  if (anchor === undefined) return []
  const lineStart = md.text.lastIndexOf('\n', anchor.range.from - 1) + 1
  const indent = md.text.slice(lineStart, anchor.range.from).replace(/-\s*$/, '')
  const nl = newlineOf(md.text)
  const line = `${indent}- ${printed}${nl}`
  if (at === undefined) {
    const lineEnd = md.text.indexOf('\n', anchor.range.to)
    const insertAt = lineEnd === -1 ? md.text.length : lineEnd + 1
    // Находка C1: без завершающего перевода строки в исходнике точка вставки —
    // это конец последней НЕЗАВЕРШЁННОЙ строки, а не начало новой; без своего
    // перевода строки перед вставкой два правила слипнутся в одну мусорную строку.
    const needsNewline = insertAt > 0 && md.text[insertAt - 1] !== '\n'
    return [{ from: insertAt, to: insertAt, insert: (needsNewline ? nl : '') + line }]
  }
  return [{ from: lineStart, to: lineStart, insert: line }]
}

/**
 * Новая группа в конец `proxy-groups`. Тип `select` и пустой список участников —
 * минимум, который ядро примет и который сразу виден в графе. Маркер подстановки
 * НЕ ставим: где панель подставляет хосты, решает автор шаблона, а угаданный
 * маркер молча изменил бы состав подписки.
 *
 * `proxies:` — ГОЛЫЙ ключ, а не `proxies: []`. Пустой список в YAML выразим
 * только flow-коллекцией, а от неё по решению А отказываются все писатели
 * (`setListAt`, `connectMihomo`): группа, заведённая кнопкой, оказывалась
 * заперта до ручной правки текста — форма и кабель показывали замок на пустом
 * месте. Голый ключ и писатели принимают («пусто» — `isScalar && value ===
 * null`), и ровно так группа выглядит в дефолтном шаблоне панели.
 */
export function addGroup(md: MihomoDoc, name: string): TextEdit[] {
  const printed = scalar(name)
  if (printed === null) return []
  const nl = newlineOf(md.text)
  const insertion = (indent: string) =>
    `${indent}- name: ${printed}${nl}${indent}  type: select${nl}${indent}  proxies:${nl}`

  const section = sectionNode(md, 'proxy-groups')
  if (isSeq(section)) {
    // `proxy-groups: [...]` (решение А) — flow-стиль не наш случай, отказ.
    // Пустой БЛОЧНЫЙ список синтаксически не существует (пустая последовательность
    // в YAML всегда flow, `[]`) — значит, если мы здесь и не flow, элемент есть
    if (isFlowNode(section)) return []
    const last = section.items[section.items.length - 1]
    const lastRange = rangeOf(last)
    if (lastRange === null) return []
    // Есть соседи — берём их отступ и вставляем после последней строки элемента.
    // Отступ считаем до дефиса и заменяем его пробелами, как в indentOf: колонка
    // ключа, а не колонка дефиса
    const lineStart = md.text.lastIndexOf('\n', lastRange.from - 1) + 1
    const indent = md.text.slice(lineStart, lastRange.from).replace(/-\s*$/, '')
    const at = afterBlock(md.text, lastRange.to)
    // Без завершающего перевода строки в исходнике точка вставки — конец
    // последней НЕЗАВЕРШЁННОЙ строки: свой перевод строки обязателен (находка C1)
    const lead = at > 0 && md.text[at - 1] !== '\n' ? nl : ''
    return [{ from: at, to: at, insert: lead + insertion(indent) }]
  }

  // Не блочный список — заводим ПЕРВУЮ группу только если ключ `proxy-groups`
  // в документе есть и стоит буквально ПУСТЫМ (`proxy-groups:` без значения —
  // частый случай, когда список заполняет панель). Находка 4 (ревью раунд 1):
  // раньше этот фолбэк был НЕДОСТИЖИМ — guard выше (`!isSeq(section)`) отсекал
  // именно этот случай раньше, чем до фолбэка доходило дело, и он срабатывал
  // только на патологии (`isSeq(section) === true`, но `lastRange === null`,
  // что для блочной последовательности не бывает вовсе). Ключа нет в документе
  // совсем, значение — flow `[]` (уже отфильтровано выше), алиас или что-то ещё
  // — отказ: заводить секцию с нуля не в этой задаче, а «что-то ещё» — не наш
  // случай (принцип отказа вместо порчи, как и везде в этом модуле).
  if (!isMap(md.doc.contents)) return []
  const keyPair = md.doc.contents.items.find(
    (p) => (p.key as { value?: unknown } | null)?.value === 'proxy-groups',
  )
  if (keyPair === undefined) return []
  if (!(isScalar(keyPair.value) && keyPair.value.value === null)) return []
  const keyRange = rangeOf(keyPair.key as unknown)
  if (keyRange === null) return []
  const step = detectIndentStep(md.text)
  const keyLineStart = md.text.lastIndexOf('\n', keyRange.from - 1) + 1
  const indent = md.text.slice(keyLineStart, keyRange.from) + ' '.repeat(step)
  const lineEnd = md.text.indexOf('\n', keyRange.from)
  const at = lineEnd === -1 ? md.text.length : lineEnd + 1
  const lead = at > 0 && md.text[at - 1] !== '\n' ? nl : ''
  return [{ from: at, to: at, insert: lead + insertion(indent) }]
}

/**
 * Удаление группы забирает все её строки: от начала своей строки с дефисом до
 * начала следующей физической строки. `afterBlock(range.to)` — тот же диапазон
 * блочной коллекции, что и везде в модуле: он УЖЕ указывает на начало строки,
 * следующей за собственным содержимым узла, будь то строка следующей группы
 * ИЛИ строка постороннего комментария перед ней. Находка 6 (ревью раунд 1):
 * прежняя версия считала конец от начала строки СЛЕДУЮЩЕГО элемента
 * (`nextRange.from`), а не от конца ТЕКУЩЕГО — если между группами стоит
 * комментарий («относящийся» к следующей группе, физически лежащий над её
 * дефисом), такой расчёт включал его в удаляемый диапазон вместе с чужой
 * группой. `afterBlock` через диапазон ТЕКУЩЕГО элемента останавливается
 * ровно на границе его собственного содержимого и чужой комментарий не задевает.
 */
export function removeGroup(md: MihomoDoc, index: number): TextEdit[] {
  const section = sectionNode(md, 'proxy-groups')
  if (!isSeq(section) || isFlowNode(section)) return []
  const item = section.items[index]
  const range = rangeOf(item)
  if (range === null) return []
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  return [{ from: lineStart, to: afterBlock(md.text, range.to), insert: '' }]
}

/**
 * Диапазон физической строки, на которой лежит `range`, разложенный на
 * СОДЕРЖИМОЕ (без завершающего `\n`) и ТЕРМИНАТОР (`'\n'`, если он в тексте
 * есть, иначе `''` — бывает только у самой последней строки файла). Раздельно
 * они нужны `moveMihomoRule` (находка 5→доп. находка раунда 2): перевод строки
 * принадлежит МЕСТУ в файле, а не содержимому строки, которое туда переехало
 * при обмене — если менять местами диапазоны «строка целиком, включая свой
 * терминатор», перевод строки уедет вместе с содержимым, а не останется на
 * месте (находка C1 плана 1 в новом обличье: `addRule`/`addGroup` по той же
 * причине сами дописывают `\n`, когда его в исходнике не было).
 */
function lineOf(text: string, range: Range): { from: number; contentTo: number; terminator: '\n' | '' } {
  const from = text.lastIndexOf('\n', range.from - 1) + 1
  const nl = text.indexOf('\n', range.to)
  return { from, contentTo: nl === -1 ? text.length : nl, terminator: nl === -1 ? '' : '\n' }
}

/**
 * Перестановка правила: две правки, меняющие местами СОДЕРЖИМОЕ двух физических
 * строк (без завершающего `\n`), а терминатор каждой строки остаётся НА МЕСТЕ.
 * Находка 5 (ревью раунд 1): диапазон элемента (`entry.range`) у скаляра
 * заканчивается ДО хвостового комментария (см. `scalar()`/`rangeOf`) — обмен
 * одними только этими диапазонами оставлял комментарий на своей физической
 * строке, то есть приклеивал его к ЧУЖОМУ правилу, которое туда переехало.
 * Строка могла быть и в кавычках, и с комментарием на конце, и заданной
 * алиасом — пересборка из полей потеряла бы это молча, поэтому меняется
 * местами именно СРЕЗ ТЕКСТА строки, а не разобранное правило.
 *
 * Доп. находка ревью раунда 2 (сам раунд 1 её и внёс): если ПОСЛЕДНЯЯ строка
 * файла не оканчивается на `\n`, у нужного правила терминатор — `''`, у
 * соседнего — `'\n'`. Обмен диапазонами «строка вместе со своим терминатором»
 * (как было) переносил `\n` вместе с содержимым — перевод строки между двумя
 * переставленными правилами исчезал, и они слипались в один скаляр, а
 * `parseMihomo` результата не подавал об этом никакого сигнала (документ
 * оставался синтаксически валидным, просто терял одно правило). Раздельный
 * обмен «содержимое ↔ содержимое» и «терминатор остаётся на месте» (см.
 * `lineOf`) не зависит от того, есть ли у файла завершающий перевод строки.
 */
export function moveMihomoRule(md: MihomoDoc, index: number, dir: -1 | 1): TextEdit[] {
  if (isFlowNode(sectionNode(md, 'rules'))) return []
  const rules = rulesOf(md)
  const from = rules.find((r) => r.index === index)
  const to = rules.find((r) => r.index === index + dir)
  if (from === undefined || to === undefined) return []
  const fromLine = lineOf(md.text, from.range)
  const toLine = lineOf(md.text, to.range)
  const fromContent = md.text.slice(fromLine.from, fromLine.contentTo)
  const toContent = md.text.slice(toLine.from, toLine.contentTo)
  return [
    {
      from: fromLine.from,
      to: fromLine.contentTo + fromLine.terminator.length,
      insert: toContent + fromLine.terminator,
    },
    {
      from: toLine.from,
      to: toLine.contentTo + toLine.terminator.length,
      insert: fromContent + toLine.terminator,
    },
  ]
}

/** Пересборка строки правила целиком — тот же путь печати, что у `addRule` */
export function replaceRuleText(md: MihomoDoc, index: number, raw: string): TextEdit[] {
  if (isFlowNode(sectionNode(md, 'rules'))) return []
  const entry = rulesOf(md).find((r) => r.index === index)
  if (entry === undefined) return []
  const rule = parseRule(raw)
  // Форма не имеет права записать в документ то, чего сама не разбирает
  if (rule === null) return []
  const printed = ruleText(rule)
  if (printed === null) return []
  return [{ from: entry.range.from, to: entry.range.to, insert: printed }]
}

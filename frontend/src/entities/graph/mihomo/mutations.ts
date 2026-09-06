// Коммутация кабелем поверх сплайсов. Ни одна операция не печатает документ:
// все возвращают TextEdit[], которые накладывает вызывающий.

import { isMap, isSeq } from 'yaml'
import { groupsOf } from '../../mihomo/groups'
import { detectIndentStep, fieldOrigin, isFlowNode, scalar, setRuleTarget, type TextEdit } from '../../mihomo/edits'
import { rangeOf, sectionNode, type MihomoDoc } from '../../mihomo/parse'
import { rulesOf } from '../../mihomo/rules'

type NodeKind = 'rule' | 'subrule' | 'group' | 'provider' | 'builtin' | 'hosts'

function split(id: string): { kind: NodeKind; rest: string } | null {
  const at = id.indexOf(':')
  if (at === -1) return null
  const kind = id.slice(0, at) as NodeKind
  if (!['rule', 'subrule', 'group', 'provider', 'builtin', 'hosts'].includes(kind)) return null
  return { kind, rest: id.slice(at + 1) }
}

/**
 * Из узла подстановки кабель не выходит и в него не входит: его содержимое
 * создаёт панель, а ребро к нему рисует граф по факту наличия маркера.
 *
 * `ruleType` — тип правила-источника, когда он известен вызывающему (сам
 * идентификатор узла несёт только индекс, не тип). У `SUB-RULE` третье поле —
 * имя подсписка в `sub-rules`, а не группы: перетаскивание кабеля дало бы
 * `SUB-RULE,...,<группа>`, конфиг, который ядро не примет (см. validate.ts,
 * edits.ts). Без переданного типа отказать по одному id нельзя — эту часть
 * проверки дублирует `connectMihomo`, у которого документ на руках.
 *
 * Вид `subrule` в `split` есть только ради разбора id рёбер (`disconnectMihomo`
 * обязан назвать настоящую причину, а не «такие узлы не соединяются»): соединять
 * с подсписком нельзя ни в одну сторону, и оба направления выпадают в общий
 * `return false` ниже.
 */
export function isValidMihomoConnection(source: string, target: string, ruleType?: string): boolean {
  const from = split(source)
  const to = split(target)
  if (from === null || to === null) return false
  if (from.kind === 'hosts' || to.kind === 'hosts') return false
  if (to.kind === 'rule') return false
  if (from.kind === 'rule' && ruleType === 'SUB-RULE') return false
  if (from.kind === 'rule' || from.kind === 'group') {
    return to.kind === 'group' || to.kind === 'provider' || to.kind === 'builtin'
  }
  return false
}

function nameOf(id: string): string {
  return split(id)?.rest ?? ''
}

/**
 * Почему коммутация не выполнилась. Пустой список правок сам по себе ничего не
 * объясняет, а кабель, отскакивающий молча, читается как поломка редактора —
 * поэтому причина обязательна и переводится на русский в одном месте.
 */
export type MihomoRefusal =
  | 'invalid-pair'
  | 'already-connected'
  | 'rule-target-required'
  | 'sub-rule-source'
  | 'flow-list'
  | 'merged-list'
  | 'no-proxies-key'
  | 'unprintable-name'
  | 'unprintable-rule'
  | 'not-found'

export interface MihomoEditResult {
  edits: TextEdit[]
  /** undefined — правка построена; иначе список пуст, и здесь причина */
  refusal?: MihomoRefusal
}

const REFUSAL_TEXT: Record<MihomoRefusal, string> = {
  'invalid-pair': 'Такие узлы не соединяются: из узла подстановки кабель не выходит, а правило не может быть целью. Выберите другую пару узлов.',
  'already-connected': 'Эти узлы уже соединены — добавлять нечего.',
  'rule-target-required': 'У правила цель обязательна: строка правила без неё невалидна, поэтому связь можно только СМЕНИТЬ, а не убрать. Протяните кабель к другой цели или задайте её в форме правила.',
  'sub-rule-source': 'У правила SUB-RULE третье поле — имя подсписка из sub-rules, а не группы. Выберите подсписок в форме правила.',
  'flow-list': 'Список записан в одну строку (`[A, B]`). Такую строку правка сплайсом порвала бы — перепишите список в столбик, и кабель заработает.',
  'merged-list': 'Список участников пришёл через якорь (`<<: *anchor`) — правка задела бы все места, где этот якорь используется. Правьте его в тексте, у объявления якоря.',
  'no-proxies-key': 'У группы нет ключа `proxies` — структуру группы редактор не выдумывает. Добавьте ключ в тексте, дальше кабель сработает.',
  'unprintable-name': 'В имени узла есть перевод строки — вставить его одной строкой YAML нельзя. Уберите перевод строки из имени в тексте, и кабель заработает.',
  'unprintable-rule': 'Строка правила не печатается в одну строку — правьте её в тексте.',
  'not-found': 'Узла или связи уже нет в документе — он изменился с момента отрисовки графа (узел переименован или удалён). Обновите выбор и повторите.',
}

export function refusalText(refusal: MihomoRefusal): string {
  return REFUSAL_TEXT[refusal]
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

export function connectMihomo(md: MihomoDoc, source: string, target: string): MihomoEditResult {
  if (!isValidMihomoConnection(source, target)) return { edits: [], refusal: 'invalid-pair' }
  const from = split(source)!
  const name = nameOf(target)
  // Обе точки вставки ниже печатают имя через общий `scalar()` из
  // `entities/mihomo/edits.ts` (не переизобретаем здесь ту же проверку —
  // находка ревью, раунд 5): он и отключает перенос по ширине (раунд 3), и
  // отказывает `null`-ом, если в САМОМ имени есть перевод строки и результат
  // всё равно многострочный (раунд 4) — без этого сплайс вставил бы блочный
  // скаляр туда, где список `proxies` ждёт одну строку, и документ бы
  // молча сломался.

  if (from.kind === 'rule') {
    const index = Number(from.rest)
    const entry = rulesOf(md).find((r) => r.index === index)
    if (entry?.rule == null) return { edits: [], refusal: 'not-found' }
    // Тип правила известен только здесь, где документ на руках
    if (entry.rule.type === 'SUB-RULE') return { edits: [], refusal: 'sub-rule-source' }
    if (entry.rule.target === name) return { edits: [], refusal: 'already-connected' }
    if (isFlowNode(sectionNode(md, 'rules'))) return { edits: [], refusal: 'flow-list' }
    const edits = setRuleTarget(md, index, name)
    // setRuleTarget печатает СТРОКУ ЦЕЛИКОМ: отказать могло и из-за перевода
    // строки в цели, и из-за него же в значении правила — различить нечем, и
    // выдумывать различие вредно: пользователю нужно одно и то же действие
    return edits.length > 0 ? { edits } : { edits: [], refusal: 'unprintable-rule' }
  }

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined) return { edits: [], refusal: 'not-found' }
  if (group.proxies.includes(name)) return { edits: [], refusal: 'already-connected' }

  // «Ключа нет» и «ключ пришёл через слияние» — разные тупики с разным выходом,
  // и разводит их только fieldOrigin: сам proxiesPair видит лишь собственные ключи
  const origin = fieldOrigin(md, group.index, 'proxies')
  if (origin === 'merged') return { edits: [], refusal: 'merged-list' }
  const pair = proxiesPair(md, group.index)
  if (pair === undefined) return { edits: [], refusal: 'no-proxies-key' }
  const list = pair.value
  // Список в одну строку (`[DIRECT, Fast]`) физическая строка держит и ключ, и все
  // элементы разом — дописать элемент сплайсом по диапазону нельзя, не сломав YAML
  if (isSeq(list) && list.flow === true) return { edits: [], refusal: 'flow-list' }

  const printedName = scalar(name)
  if (printedName === null) return { edits: [], refusal: 'unprintable-name' }

  if (isSeq(list) && list.items.length > 0) {
    const last = list.items[list.items.length - 1]
    const range = rangeOf(last)
    if (range === null) return { edits: [], refusal: 'not-found' }
    const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
    const indent = md.text.slice(lineStart, range.from).replace(/-\s*$/, '')
    const { at, prefix } = afterLine(md.text, range.to)
    return { edits: [{ from: at, to: at, insert: `${prefix}${indent}- ${printedName}\n` }] }
  }

  // Элементов нет — список либо пуст, либо ключ вообще без значения (частый случай:
  // `proxies: # LEAVE THIS LINE!` — панель нальёт сюда хостов сама). Якоря-элемента
  // нет, поэтому отступ считаем от строки ключа, а не от несуществующей записи —
  // и вставляем ПОСЛЕ всей строки ключа, чтобы не задеть комментарий-маркер на ней.
  const keyRange = rangeOf(pair.key as unknown)
  if (keyRange === null) return { edits: [], refusal: 'not-found' }
  const keyLineStart = md.text.lastIndexOf('\n', keyRange.from - 1) + 1
  const keyIndent = md.text.slice(keyLineStart, keyRange.from)
  const indent = keyIndent + ' '.repeat(detectIndentStep(md.text))
  const { at, prefix } = afterLine(md.text, keyRange.from)
  return { edits: [{ from: at, to: at, insert: `${prefix}${indent}- ${printedName}\n` }] }
}

export function disconnectMihomo(md: MihomoDoc, edge: string): MihomoEditResult {
  const match = /^e:(.+)->(.+)$/.exec(edge)
  if (match === null) return { edits: [], refusal: 'not-found' }
  const from = split(match[1]!)
  const name = nameOf(match[2]!)
  if (from === null) return { edits: [], refusal: 'invalid-pair' }
  // У правила цель обязательна — и у правила из `rules`, и у правила подсписка
  // (`subrule:<имя>` ведёт в цели СВОИХ строк): строка без третьего поля ядру не
  // конфиг, так что убрать связь нельзя, можно только сменить. Причина называет
  // именно это. Раньше здесь возвращался `invalid-pair` с текстом про узел
  // подстановки — неверное объяснение хуже отсутствующего: писатель шёл искать
  // причину, которой в его документе нет.
  if (from.kind === 'rule' || from.kind === 'subrule') {
    return { edits: [], refusal: 'rule-target-required' }
  }
  if (from.kind !== 'group') return { edits: [], refusal: 'invalid-pair' }

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined) return { edits: [], refusal: 'not-found' }
  const pair = proxiesPair(md, group.index)
  const list = pair?.value
  if (!isSeq(list)) return { edits: [], refusal: 'not-found' }
  // Список в одну строку — тот же случай, что и в connectMihomo: физическая строка
  // держит ключ и все элементы разом, удаление строки стёрло бы список целиком
  if (list.flow === true) return { edits: [], refusal: 'flow-list' }

  const entry = list.items.find((i) => (i as { value?: unknown } | null)?.value === name)
  const range = rangeOf(entry)
  if (range === null) return { edits: [], refusal: 'not-found' }
  const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
  const lineEnd = md.text.indexOf('\n', range.to)
  return { edits: [{ from: lineStart, to: lineEnd === -1 ? md.text.length : lineEnd + 1, insert: '' }] }
}

// Коммутация кабелем — операции над документом (DocOp), а не сплайсы текста.
// Писатель (`entities/mihomo/write.ts`) сам решает режим правки (сплайс
// однострочного скаляра или модель Document) и сам отказывает на пути через
// алиас/слияние; здесь спрашиваем `mihomoLockAt` заранее — не для того, чтобы
// продублировать защиту, а чтобы назвать причину отказа СРАЗУ, до попытки
// собрать операцию, а не после того, как писатель её тихо не применил.

import { isMap, isScalar, isSeq } from 'yaml'
import type { DocOp } from '../../../shared/schema'
import { groupsOf } from '../../mihomo/groups'
import { mihomoLockAt } from '../../mihomo/write'
import { sectionNode, type MihomoDoc } from '../../mihomo/parse'
import { formatRule, rulesOf } from '../../mihomo/rules'

type NodeKind = 'rule' | 'subrule' | 'group' | 'provider' | 'proxy' | 'builtin' | 'hosts'

function split(id: string): { kind: NodeKind; rest: string } | null {
  const at = id.indexOf(':')
  if (at === -1) return null
  const kind = id.slice(0, at) as NodeKind
  if (!['rule', 'subrule', 'group', 'provider', 'proxy', 'builtin', 'hosts'].includes(kind)) return null
  return { kind, rest: id.slice(at + 1) }
}

/**
 * Из узла подстановки кабель не выходит и в него не входит: его содержимое
 * создаёт панель, а ребро к нему рисует граф по факту наличия ключей группы.
 *
 * `ruleType` — тип правила-источника, когда он известен вызывающему (сам
 * идентификатор узла несёт только индекс, не тип). У `SUB-RULE` третье поле —
 * имя подсписка в `sub-rules`, а не группы: перетаскивание кабеля дало бы
 * `SUB-RULE,...,<группа>`, конфиг, который ядро не примет (см. validate.ts).
 * Без переданного типа отказать по одному id нельзя — эту часть проверки
 * дублирует `connectMihomo`, у которого документ на руках.
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
    return to.kind === 'group' || to.kind === 'provider' || to.kind === 'proxy' || to.kind === 'builtin'
  }
  return false
}

function nameOf(id: string): string {
  return split(id)?.rest ?? ''
}

/**
 * Почему коммутация не выполнилась. Пустой список операций сам по себе ничего
 * не объясняет, а кабель, отскакивающий молча, читается как поломка редактора —
 * поэтому причина обязательна и переводится на русский в одном месте.
 *
 * Прежних `flow-list`, `no-proxies-key`, `unprintable-name`, `unprintable-rule`
 * здесь больше нет: все четыре были свойством ПРАВКИ СПЛАЙСОМ (список в одну
 * строку нельзя дописать по диапазону, ключа без операции модели не завести,
 * перевод строки в имени рвал бы однострочную вставку) — операция `insert`/`set`
 * поверх модели `Document` не знает этих ограничений вовсе: список в одну
 * строку получает новый элемент, отсутствующий ключ `proxies` заводится, а
 * имя с переводом строки печатается тем же узлом, что и любой другой скаляр.
 */
export type MihomoRefusal =
  | 'invalid-pair'
  | 'already-connected'
  | 'rule-target-required'
  | 'panel-hosts-edge'
  | 'sub-rule-source'
  | 'merged-list'
  | 'alias-list'
  | 'proxies-not-a-list'
  | 'not-found'

export interface MihomoEditResult {
  ops: DocOp[]
  /** undefined — операция построена; иначе список пуст, и здесь причина */
  refusal?: MihomoRefusal
}

const REFUSAL_TEXT: Record<MihomoRefusal, string> = {
  'invalid-pair': 'Такие узлы не соединяются: из узла подстановки кабель не выходит, а правило не может быть целью. Выберите другую пару узлов.',
  'already-connected': 'Эти узлы уже соединены — добавлять нечего.',
  'rule-target-required': 'У правила цель обязательна: строка правила без неё невалидна, поэтому связь можно только СМЕНИТЬ, а не убрать. Протяните кабель к другой цели или задайте её в форме правила.',
  'panel-hosts-edge': 'Эту связь создаёт панель, а не документ: она допишет имена хостов в конец списка proxies группы (или ядро соберёт их через include-all). Записи в proxies под это ребро нет — разрывать нечего. Чтобы панель ничего не дописывала, поставьте в форме группы remnawave.include-proxies = false.',
  'sub-rule-source': 'У правила SUB-RULE третье поле — имя подсписка из sub-rules, а не группы. Выберите подсписок в форме правила.',
  'merged-list': 'Список участников пришёл через якорь (`<<: *anchor`) — правка задела бы все места, где этот якорь используется. Правьте его в тексте, у объявления якоря.',
  'alias-list': 'Список участников задан ссылкой на якорь (`proxies: *base`): здесь лежит не сам список, а ссылка на него. Правка отсюда переписала бы объявление якоря и задела все места, где он используется. Правьте список у объявления якоря, на вкладке YAML.',
  // Ключ есть, но под ним не список: скаляр (`proxies: oops`) или вложенное
  // отображение. Дописать элемент в такое значение нельзя, не подменив то, что
  // там записано, — а тихая подмена страшнее отказа.
  'proxies-not-a-list': 'Под ключом `proxies` у группы стоит не список: там скаляр или вложенное отображение. Дописать участника в такое значение нельзя, не заменив то, что там записано. Приведите `proxies` к списку в столбик на вкладке YAML, и кабель заработает.',
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

export function connectMihomo(md: MihomoDoc, source: string, target: string): MihomoEditResult {
  if (!isValidMihomoConnection(source, target)) return { ops: [], refusal: 'invalid-pair' }
  const from = split(source)!
  const name = nameOf(target)

  if (from.kind === 'rule') {
    const index = Number(from.rest)
    const entry = rulesOf(md).find((r) => r.index === index)
    if (entry?.rule == null) return { ops: [], refusal: 'not-found' }
    // Тип правила известен только здесь, где документ на руках
    if (entry.rule.type === 'SUB-RULE') return { ops: [], refusal: 'sub-rule-source' }
    if (entry.rule.target === name) return { ops: [], refusal: 'already-connected' }
    return { ops: [{ op: 'set', path: ['rules', index], value: formatRule({ ...entry.rule, target: name }) }] }
  }

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined) return { ops: [], refusal: 'not-found' }
  if (group.proxies.includes(name)) return { ops: [], refusal: 'already-connected' }

  // Замок спрашиваем ДО построения операции: список, пришедший через слияние
  // или заданный ссылкой на якорь, физически лежит у ОБЪЯВЛЕНИЯ якоря, и
  // операция по этому пути там же и применилась бы — задев все его потребители.
  const lock = mihomoLockAt(md, ['proxy-groups', group.index, 'proxies'])
  if (lock?.kind === 'merged') return { ops: [], refusal: 'merged-list' }
  if (lock?.kind === 'alias') return { ops: [], refusal: 'alias-list' }

  const pair = proxiesPair(md, group.index)
  const value = pair?.value
  // Ключа нет вовсе (`value === undefined`) — не отказ: `insert` заведёт его
  // сам (режим модели создаёт недостающие звенья пути). Отказ — только когда
  // ключ ЕСТЬ, но под ним не список и не голый ключ без значения.
  if (value !== undefined && !isSeq(value) && !(isScalar(value) && value.value === null)) {
    return { ops: [], refusal: 'proxies-not-a-list' }
  }
  const length = isSeq(value) ? value.items.length : 0
  return { ops: [{ op: 'insert', path: ['proxy-groups', group.index, 'proxies'], index: length, value: name }] }
}

export function disconnectMihomo(md: MihomoDoc, edge: string): MihomoEditResult {
  const match = /^e:(.+)->(.+)$/.exec(edge)
  if (match === null) return { ops: [], refusal: 'not-found' }
  const from = split(match[1]!)
  const to = split(match[2]!)
  const name = to?.rest ?? ''
  if (from === null) return { ops: [], refusal: 'invalid-pair' }
  // Ребро в узел подстановки рисует не документ, а правило панели: в списке
  // `proxies` соответствующей записи попросту НЕТ, и общий путь ниже отвечал
  // бы `not-found` — «узел изменился с момента отрисовки». Узел никуда не
  // девался, и объяснение было бы ложным того же сорта, что и у ребра
  // правила. Решает здесь ЦЕЛЬ, а не источник, поэтому проверка стоит первой.
  if (to?.kind === 'hosts') return { ops: [], refusal: 'panel-hosts-edge' }
  // У правила цель обязательна — и у правила из `rules`, и у правила подсписка
  // (`subrule:<имя>` ведёт в цели СВОИХ строк): строка без третьего поля ядру не
  // конфиг, так что убрать связь нельзя, можно только сменить.
  if (from.kind === 'rule' || from.kind === 'subrule') {
    return { ops: [], refusal: 'rule-target-required' }
  }
  if (from.kind !== 'group') return { ops: [], refusal: 'invalid-pair' }

  const group = groupsOf(md).find((g) => g.name === from.rest)
  if (group === undefined) return { ops: [], refusal: 'not-found' }
  // Те же два тупика, что и у соединения, и по той же причине: список, пришедший
  // через слияние или заданный ссылкой на якорь, физически лежит у ОБЪЯВЛЕНИЯ
  // якоря — удаление элемента отсюда задело бы всех его потребителей.
  const lock = mihomoLockAt(md, ['proxy-groups', group.index, 'proxies'])
  if (lock?.kind === 'merged') return { ops: [], refusal: 'merged-list' }
  if (lock?.kind === 'alias') return { ops: [], refusal: 'alias-list' }

  // `group.proxies` уже развёрнут дealias/merge — но раз мы дошли сюда, замка
  // нет, и список лежит собственным ключом, так что индекс в нём совпадает с
  // индексом элемента в документе.
  const k = group.proxies.indexOf(name)
  if (k === -1) return { ops: [], refusal: 'not-found' }
  return { ops: [{ op: 'remove', path: ['proxy-groups', group.index, 'proxies', k] }] }
}

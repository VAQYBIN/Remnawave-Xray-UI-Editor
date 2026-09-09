// Коммутация кабелем поверх сплайсов. Ни одна операция не печатает документ:
// все возвращают TextEdit[], которые накладывает вызывающий.

import { isMap, isScalar, isSeq } from 'yaml'
import { groupsOf } from '../../mihomo/groups'
import {
  afterBlock,
  detectIndentStep,
  fieldOrigin,
  isFlowNode,
  newlineOf,
  scalar,
  setRuleTarget,
  type TextEdit,
} from '../../mihomo/edits'
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
  | 'panel-hosts-edge'
  | 'sub-rule-source'
  | 'flow-list'
  | 'merged-list'
  | 'alias-list'
  | 'no-proxies-key'
  | 'proxies-not-a-list'
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
  // Ни одно основание здесь НЕ названо намеренно. Решает `panelInjectsHosts`
  // (`entities/mihomo/inject.ts`) — единственный источник правды о том, рисуется
  // ли узел подстановки, и оснований у него не пара и не «четыре»: считать их в
  // комментарии значит завести второй список, который разойдётся с первым (уже
  // расходился). Назвать часть — для остальных групп назвать основание, которого
  // у них нет: писатель пошёл бы искать в документе маркер, а маркера там не
  // будет. Текст обязан оставаться истинным при ЛЮБОМ решении
  // `panelInjectsHosts`, поэтому он говорит про факт, а за подробностями
  // отправляет туда, где основания видно. Не путать с `groupGetsHosts` из того
  // же файла: тот отвечает на другой вопрос («группа не останется пустой») и за
  // это ребро не отвечает вовсе.
  //
  // Мест ДВА, и назвать их обязано оба. Всё, что `panelInjectsHosts` читает
  // КЛЮЧАМИ группы, показывает её форма. Единственное исключение — маркер
  // `# LEAVE THIS LINE!`: это КОММЕНТАРИЙ внутри списка `proxies`, полем формы
  // он не является и в ней не появится вовсе. Отправив только в форму, мы
  // завели бы писателя с маркером в тупик — он увидел бы все флаги выключенными.
  'panel-hosts-edge': 'Эту связь создаёт панель, а не документ: группа получает хосты от панели, и если панель их подставит, они попадут в группу сами. Записи в `proxies` под это ребро нет — разрывать нечего. Флаги получения хостов ищите в форме группы, а маркер подстановки — на вкладке YAML: это комментарий в списке `proxies`, полем формы он не показывается.',
  'sub-rule-source': 'У правила SUB-RULE третье поле — имя подсписка из sub-rules, а не группы. Выберите подсписок в форме правила.',
  'flow-list': 'Список записан в одну строку (`[A, B]`). Такую строку правка сплайсом порвала бы — перепишите список в столбик, и кабель заработает.',
  'merged-list': 'Список участников пришёл через якорь (`<<: *anchor`) — правка задела бы все места, где этот якорь используется. Правьте его в тексте, у объявления якоря.',
  'alias-list': 'Список участников задан ссылкой на якорь (`proxies: *base`): здесь лежит не сам список, а ссылка на него. Правка отсюда переписала бы объявление якоря и задела все места, где он используется. Правьте список у объявления якоря, на вкладке YAML.',
  'no-proxies-key': 'У группы нет ключа `proxies` — структуру группы редактор не выдумывает. Добавьте ключ в тексте, дальше кабель сработает.',
  // Ключ есть, но под ним не список: скаляр (`proxies: oops`) или вложенное
  // отображение. Дописать элемент сплайсом в такое значение нельзя — выйдет либо
  // мусорный скаляр со списком строкой ниже (разбор при этом МОЛЧИТ), либо битый
  // YAML. Отдельная причина, а не `no-proxies-key`: ключ на месте, и писателя надо
  // отправить смотреть его ЗНАЧЕНИЕ, а не искать отсутствующий ключ.
  'proxies-not-a-list': 'Под ключом `proxies` у группы стоит не список: там скаляр или вложенное отображение. Дописать участника в такое значение сплайсом нельзя, не сломав документ. Приведите `proxies` к списку в столбик на вкладке YAML, и кабель заработает.',
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
 * поэтому в таком случае сами добавляем ведущий перевод строки к вставляемому
 * тексту, а не полагаемся на то, что он уже есть в файле. Какой именно перевод —
 * решает документ (`newlineOf`): в CRLF-шаблоне панели голый `\n` дал бы
 * смешанные окончания.
 */
function afterLine(text: string, searchFrom: number): { at: number; prefix: string } {
  const lineEnd = text.indexOf('\n', searchFrom)
  return lineEnd === -1 ? { at: text.length, prefix: newlineOf(text) } : { at: lineEnd + 1, prefix: '' }
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

  // «Ключа нет», «ключ пришёл через слияние» и «значением ключа стоит ссылка на
  // якорь» — три разных тупика с разным выходом, и разводит их только
  // fieldOrigin: сам proxiesPair видит лишь собственные ключи и не отличает
  // список от ссылки на него.
  //
  // Ветка `alias` — находка соседа: при `proxies: *base` собственная пара ЕСТЬ,
  // её значение — узел Alias, и общий путь ниже дописывал элемент после строки
  // со ссылкой. YAML получался битым (три ошибки разбора), а `refusal`
  // оставался пустым: редактор молча ломал документ и отчитывался об успехе.
  const origin = fieldOrigin(md, group.index, 'proxies')
  if (origin === 'merged') return { edits: [], refusal: 'merged-list' }
  if (origin === 'alias') return { edits: [], refusal: 'alias-list' }
  const pair = proxiesPair(md, group.index)
  if (pair === undefined) return { edits: [], refusal: 'no-proxies-key' }
  const list = pair.value
  // Список в одну строку (`[DIRECT, Fast]`) физическая строка держит и ключ, и все
  // элементы разом — дописать элемент сплайсом по диапазону нельзя, не сломав YAML
  if (isSeq(list) && list.flow === true) return { edits: [], refusal: 'flow-list' }
  // Форма значения — та же проверка, что и у `setListAt` (`entities/mihomo/edits.ts`),
  // и это не перестраховка, а устранение расхождения: ДВА писателя в один и тот же
  // ключ трактовали один документ по-разному. `setListAt` честно отказывал на «не
  // блочный список и не пусто», а здесь `proxies: oops` давало `refusal: undefined`
  // и дописывало `- DIRECT` строкой ниже скаляра — на это разбор не ругается вовсе,
  // список участников молча становился мусором. «Пусто» — голый ключ без значения
  // (в том числе с комментарием-маркером на строке): `isScalar(list) && value === null`.
  if (!isSeq(list) && !(isScalar(list) && list.value === null)) {
    return { edits: [], refusal: 'proxies-not-a-list' }
  }

  const printedName = scalar(name)
  if (printedName === null) return { edits: [], refusal: 'unprintable-name' }

  if (isSeq(list) && list.items.length > 0) {
    const last = list.items[list.items.length - 1]
    const range = rangeOf(last)
    if (range === null) return { edits: [], refusal: 'not-found' }
    const lineStart = md.text.lastIndexOf('\n', range.from - 1) + 1
    const indent = md.text.slice(lineStart, range.from).replace(/-\s*$/, '')
    const { at, prefix } = afterLine(md.text, range.to)
    return { edits: [{ from: at, to: at, insert: `${prefix}${indent}- ${printedName}${newlineOf(md.text)}` }] }
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
  return { edits: [{ from: at, to: at, insert: `${prefix}${indent}- ${printedName}${newlineOf(md.text)}` }] }
}

export function disconnectMihomo(md: MihomoDoc, edge: string): MihomoEditResult {
  const match = /^e:(.+)->(.+)$/.exec(edge)
  if (match === null) return { edits: [], refusal: 'not-found' }
  const from = split(match[1]!)
  const to = split(match[2]!)
  const name = to?.rest ?? ''
  if (from === null) return { edits: [], refusal: 'invalid-pair' }
  // Ребро в узел подстановки рисует не документ, а маркер (или `include-all`):
  // в списке `proxies` соответствующей записи попросту НЕТ, и общий путь ниже
  // отвечал бы `not-found` — «узел изменился с момента отрисовки». Узел никуда
  // не девался, и объяснение было бы ложным того же сорта, что и у ребра
  // правила. Решает здесь ЦЕЛЬ, а не источник, поэтому проверка стоит первой.
  if (to?.kind === 'hosts') return { edits: [], refusal: 'panel-hosts-edge' }
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
  // Те же два тупика, что и у соединения, и по той же причине: список, пришедший
  // через слияние или заданный ссылкой на якорь, физически лежит у ОБЪЯВЛЕНИЯ
  // якоря. Порчи здесь нет — `isSeq` ниже отсеет и Alias, и отсутствующую пару,
  // — но отвечать на это `not-found` («документ изменился с момента отрисовки»)
  // значит соврать: документ не менялся, а связь есть и видна на холсте.
  const origin = fieldOrigin(md, group.index, 'proxies')
  if (origin === 'merged') return { edits: [], refusal: 'merged-list' }
  if (origin === 'alias') return { edits: [], refusal: 'alias-list' }
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
  // Конец удаляемого куска считает общий `afterBlock` (`entities/mihomo/edits.ts`),
  // а не наивный `indexOf(перевод строки, range.to)`: имя участника, записанное
  // многострочно (`- >-` со свёрнутым скаляром), заканчивается уже на начале
  // следующей строки, и поиск от него забирал СЛЕДУЮЩЕГО участника вместе с этим —
  // молча, без единой ошибки разбора. Для обычного однострочного имени `afterBlock`
  // даёт ровно то же значение, что и прежняя арифметика.
  return { edits: [{ from: lineStart, to: afterBlock(md.text, range.to), insert: '' }] }
}

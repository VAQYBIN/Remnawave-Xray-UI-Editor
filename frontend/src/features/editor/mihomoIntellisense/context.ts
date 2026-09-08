// Где стоит курсор: в какой секции документа, вводится ключ или значение, какие
// ключи в этом отображении уже есть. Дерево берём у библиотеки `yaml` — она
// разбирает актуальный текст целиком и синхронно, поэтому здесь нет ни бюджета
// разбора, ни отстающего снимка дерева, как у резолвера Xray (см. CLAUDE.md).

import { isMap, isSeq } from 'yaml'
import type { PathParts } from '../../../entities/xray'
import {
  fieldOf,
  fieldsOf,
  parseMihomo,
  pathAt,
  rangeOf,
  sectionForKey,
  type MihomoDoc,
  type MihomoField,
  type MihomoSectionName,
} from '../../../entities/mihomo'

/**
 * Ключ, за которым стоит не значение, а целый раздел документа. В словаре
 * `docSchema` таких нет намеренно: он питает ещё и формы инспектора, и `rules`
 * стал бы там текстовым полем поверх списка правил. Описания живут здесь, и
 * читают их ОБА потребителя — список ключей корня и наведение: пока они лежали
 * внутри `complete.ts`, подсказка при наборе эти ключи описывала, а наведение
 * на уже написанные молчало.
 */
export interface MihomoContainerKey {
  key: string
  doc: string
  /** Отображение или список — тултип показывает это значком типа */
  type: 'map' | 'list'
}

const CONTAINER_KEYS: MihomoContainerKey[] = [
  {
    key: 'proxies',
    type: 'list',
    doc: 'Список серверов. В шаблоне подписки обычно пуст: если панель подставит хосты, они попадут сюда, по маркеру `# LEAVE THIS LINE!`.',
  },
  {
    key: 'proxy-groups',
    type: 'list',
    doc: 'Группы выбора и балансировки: селекторы, url-test, fallback и прочие.',
  },
  {
    key: 'rules',
    type: 'list',
    doc: 'Правила маршрутизации. Проверяются сверху вниз, побеждает первое совпавшее; трафик, не подошедший ни под одно, уходит напрямую.',
  },
  {
    key: 'sub-rules',
    type: 'map',
    doc: 'Именованные подсписки правил для SUB-RULE. Если в подсписке не совпало ни одно правило, проход возвращается в основной список.',
  },
  {
    key: 'proxy-providers',
    type: 'map',
    doc: 'Внешние источники серверов: файл или URL, с интервалом обновления.',
  },
  {
    key: 'rule-providers',
    type: 'map',
    doc: 'Внешние наборы правил: файл или URL, с интервалом обновления.',
  },
  {
    key: 'dns',
    type: 'map',
    doc: 'Встроенный резолвер ядра: серверы, режим fake-ip, политики по доменам. Работает, когда внутри стоит enable: true, иначе имена резолвит система.',
  },
  {
    key: 'tun',
    type: 'map',
    doc: 'Приём трафика через виртуальный сетевой интерфейс: система отдаёт ядру весь трафик, а не только направленный в его порты. Требует прав в системе.',
  },
  {
    key: 'sniffer',
    type: 'map',
    doc: 'Определение домена по содержимому соединения (SNI у TLS, Host у HTTP). Нужен, когда клиент пришёл сразу по IP: без него правила по доменам такой трафик не увидят.',
  },
  {
    key: 'profile',
    type: 'map',
    doc: 'Что ядро помнит между перезапусками: выбранного участника группы и соответствия fake-ip.',
  },
]

/** Описание ключа-контейнера ВЕРХНЕГО уровня, если он нам знаком */
export function containerKey(key: string): MihomoContainerKey | undefined {
  return CONTAINER_KEYS.find((c) => c.key === key)
}

/** Контейнеры, у которых нет своей секции словаря — остальные придут из него */
export function plainContainerKeys(): MihomoContainerKey[] {
  return CONTAINER_KEYS.filter((c) => sectionForKey(c.key) === undefined)
}

/**
 * Вложенное отображение составного ключа (`remnawave`, `override`,
 * `health-check`): описания у него нет, зато есть перечень листьев — его и
 * показываем. Один текст на подсказку и на наведение, чтобы не разошлись.
 */
export function nestedNamespace(
  section: MihomoSectionName,
  head: string,
): MihomoContainerKey | undefined {
  const leaves = fieldsOf(section)
    .filter((f) => f.key.startsWith(`${head}.`))
    .map((f) => f.key.slice(head.length + 1))
  if (leaves.length === 0) return undefined
  return { key: head, type: 'map', doc: `Вложенное отображение: ${leaves.join(', ')}` }
}

export interface MihomoCursor {
  section: MihomoSectionName
  parts: PathParts
  /** Ключи, уже введённые в этом отображении — из них подсказки вычитаются */
  existingKeys: string[]
  mode: 'key' | 'value'
  /** Имя ключа, значение которого вводится (mode === 'value') */
  key?: string
}

// «  type: » и «  nameserver: 1.1.1.1 8.8» — вводим ЗНАЧЕНИЕ; «  ty» — КЛЮЧ.
// Пробел внутри значения его значением быть не перестаёт: список серверов и
// строка вроде «expected-status: 200/204» пишутся с пробелами
const VALUE_RE = /^\s*(?:-\s*)?([A-Za-z0-9_-]+)\s*:(?:\s.*)?$/
// Отступ строки и, если строка заводит элемент списка, его дефис
const KEY_INDENT_RE = /^(\s*)(-\s*)?/

/**
 * Хвост пути внутри секции. Пусто — это сама секция; единственный сегмент,
 * который служит префиксом составного ключа (`remnawave`, `override`,
 * `health-check`), — вложенное отображение той же секции. Всё остальное
 * словарь не описывает.
 */
function withinSection(rest: PathParts, section: MihomoSectionName): MihomoSectionName | null {
  if (rest.length === 0) return section
  const [only] = rest
  if (rest.length === 1 && typeof only === 'string') {
    return fieldsOf(section).some((f) => f.key.startsWith(`${only}.`)) ? section : null
  }
  return null
}

/**
 * Секция словаря, описывающая отображение по этому пути; null — про это место
 * словарь не знает ничего, и тогда молчание единственный честный ответ.
 * Откат к корню был бы враньём: `port` внутри записи `proxies` — порт сервера,
 * а не «порт HTTP-входа» из корневых настроек.
 *
 * `item` — курсор заводит НОВЫЙ элемент списка (строка начинается с дефиса), и
 * путь ведёт к самому списку. Единственный описанный список отображений —
 * `proxy-groups`; `proxies` и `rules` словарь не описывает, у `rules` элементы
 * и вовсе скаляры.
 */
function sectionOf(parts: PathParts, item: boolean): MihomoSectionName | null {
  if (item) return parts.length === 1 && parts[0] === 'proxy-groups' ? 'proxy-group' : null

  const [head, second] = parts
  if (head === undefined) return 'root'
  if (head === 'proxy-groups') {
    return typeof second === 'number' ? withinSection(parts.slice(2), 'proxy-group') : null
  }
  if (head === 'proxy-providers') {
    return typeof second === 'string' ? withinSection(parts.slice(2), 'proxy-provider') : null
  }
  if (head === 'rule-providers') {
    return typeof second === 'string' ? withinSection(parts.slice(2), 'rule-provider') : null
  }
  if (typeof head !== 'string') return null
  const section = sectionForKey(head)
  if (section !== undefined) return withinSection(parts.slice(1), section)
  // Не секция — значит либо вложенное отображение составного ключа корня
  // (`remnawave`), либо место, которого словарь не знает
  return withinSection(parts, 'root')
}

function keyOf(node: unknown): string | undefined {
  const value = (node as { value?: unknown } | null)?.value
  return typeof value === 'string' ? value : undefined
}

/** Значение собственного ключа отображения либо элемент списка (без разворота слияний) */
function child(node: unknown, part: string | number): unknown {
  if (typeof part === 'number') return isSeq(node) ? node.items[part] : undefined
  if (!isMap(node)) return undefined
  return node.items.find((pair) => keyOf(pair.key) === part)?.value
}

function nodeAt(md: MihomoDoc, parts: PathParts): unknown {
  let node: unknown = md.doc.contents
  for (const part of parts) {
    node = child(node, part)
    if (node === undefined || node === null) return undefined
  }
  return node
}

function columnAt(text: string, offset: number): number {
  return offset - (text.lastIndexOf('\n', offset - 1) + 1)
}

/**
 * Колонка, в которой начинается сегмент пути: ключ отображения либо дефис
 * элемента списка. У блочного списка дефисы всех элементов стоят в одной
 * колонке — её и берём у самого списка, потому что ключи ВНУТРИ элемента
 * сдвинуты правее и по ним уровень вложенности не отличить.
 */
function segmentColumn(md: MihomoDoc, parts: PathParts, depth: number): number | null {
  const parent = nodeAt(md, parts.slice(0, depth - 1))
  const segment = parts[depth - 1]
  if (typeof segment === 'number') {
    const range = isSeq(parent) ? rangeOf(parent) : null
    return range ? columnAt(md.text, range.from) : null
  }
  if (!isMap(parent)) return null
  const pair = parent.items.find((p) => keyOf(p.key) === segment)
  const range = pair ? rangeOf(pair.key) : null
  return range ? columnAt(md.text, range.from) : null
}

/**
 * Путь до отображения, которому принадлежит курсор. Путь-заготовка ведёт к
 * тому, что стоит В тексте, а курсор — к тому, что в него только вводится:
 * лишние сегменты снимаются по отступу. Сегмент, начинающийся левее курсора
 * или на его колонке, — это уже сосед или предок, а не хозяин строки.
 */
function containerOf(md: MihomoDoc, parts: PathParts, column: number): PathParts {
  let depth = parts.length
  while (depth > 0) {
    const at = segmentColumn(md, parts, depth)
    if (at === null || at < column) break
    depth -= 1
  }
  return parts.slice(0, depth)
}

/**
 * Путь до СПИСКА, элемент которого заводит строка с дефисом. Ищется по колонке
 * самого дефиса: у блочного списка все его дефисы стоят в одной колонке, и она
 * же — колонка курсора.
 *
 * Сравнивать, как в containerOf, с колонкой ключа-родителя нельзя: стиль
 *
 *     proxy-groups:
 *     - name: A
 *
 * валиден, и там ключ и дефис стоят в ОДНОЙ колонке — по строгому сравнению
 * срезался бы весь путь до корня, и подсказки исчезали бы на всех списках с
 * нулевым отступом. Список — надёжный якорь ещё и потому, что элемента в
 * тексте может не быть вовсе.
 *
 * Инвариант, на котором стоит поиск: вдоль ОДНОЙ цепочки префиксов колонки
 * дефисов строго возрастают с глубиной — вложенный блочный список обязан быть
 * отбит вправо относительно дефиса родителя, а список, начинающийся в той же
 * колонке, это уже не вложение, а следующий брат того же списка. Значит
 * совпадение колонки отбирает не более одного кандидата, а списки из соседних
 * ветвей документа отсекает сам префикс пути. Это следствие правил отступов
 * YAML, а не измерение, — потому и закреплено тестом на вложенный список.
 *
 * null — списка с такой колонкой над курсором нет; тогда про место ничего не
 * известно, и вызывающий молчит.
 */
function seqAtColumn(md: MihomoDoc, parts: PathParts, column: number): PathParts | null {
  for (let depth = parts.length; depth >= 0; depth -= 1) {
    const node = nodeAt(md, parts.slice(0, depth))
    const range = isSeq(node) ? rangeOf(node) : null
    if (range !== null && columnAt(md.text, range.from) === column) return parts.slice(0, depth)
  }
  return null
}

/**
 * Курсор внутри flow-коллекции (`proxies: [DIRECT]`, `dns: {enable: true}`).
 * Словарь описывает пары «ключ: значение» блочного стиля; внутри квадратных
 * скобок уместны имена серверов и групп, которых он не знает, а внутри фигурных
 * подсказка вставила бы значение туда, где ядро ждёт список. Молчим.
 *
 * Проверяется именно ДИАПАЗОН узла, а не сам факт flow-значения по пути: путь
 * курсора, стоящего на КЛЮЧЕ такой строки, уже ведёт в коллекцию, и проверка по
 * пути погасила бы описание самого ключа — а `nameserver: [1.1.1.1]` объяснять
 * надо ровно так же, как блочный вариант.
 *
 * Путь берётся ТОЛЬКО от курсора, а не от подставного якоря выше: после
 * закрытой скобки (`proxies: [DIRECT]` и курсор на следующей строке) курсор уже
 * не в коллекции, и подсказки корня там законны.
 */
function inFlow(md: MihomoDoc, atCursor: PathParts, pos: number): boolean {
  const covers = (node: unknown): boolean => {
    if (!(isSeq(node) || isMap(node)) || (node as { flow?: boolean }).flow !== true) return false
    const range = rangeOf(node)
    return range !== null && pos >= range.from && pos <= range.to
  }
  let node: unknown = md.doc.contents
  if (covers(node)) return true
  for (const part of atCursor) {
    node = child(node, part)
    if (covers(node)) return true
  }
  return false
}

/** Последний непробельный символ до позиции; -1 — выше курсора пусто */
function lastNonSpaceBefore(text: string, pos: number): number {
  let i = pos - 1
  while (i >= 0 && /\s/.test(text[i])) i -= 1
  return i
}

/**
 * Курсор внутри комментария. В YAML решётка начинает комментарий в начале
 * строки или после пробела — внутри значения (`https://dns#🌍 VPN`) она
 * обычная. Подсказывать там нечего, а над строкой `# LEAVE THIS LINE!`, по
 * которой панель ищет место подстановки хостов, — тем более.
 */
function inComment(before: string): boolean {
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === '#' && (i === 0 || /\s/.test(before[i - 1]))) return true
  }
  return false
}

export function contextAt(text: string, pos: number): MihomoCursor | null {
  if (pos < 0 || pos > text.length) return null
  const md = parseMihomo(text)

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const before = text.slice(lineStart, pos)
  if (inComment(before)) return null
  const value = VALUE_RE.exec(before)
  const mode = value ? 'value' : 'key'
  const key = value?.[1]
  const indent = KEY_INDENT_RE.exec(before)
  // Строка с дефисом — это ЭЛЕМЕНТ списка, и хозяин у неё сам список: секцию
  // элемента задаёт он, а самого элемента в тексте может ещё не быть. Дефис
  // считается дефисом и без пробела за ним: набравший его заводит элемент, и
  // ключи секции ему нужны уже сейчас
  const item = indent?.[2] !== undefined
  const column = indent?.[1].length ?? 0

  // Путь берём от курсора. На «пустом» месте — отступе новой строки — его не
  // накрывает ни один узел: разбор о ненаписанное ещё не спотыкается, но и
  // диапазона там нет. Тогда отталкиваемся от последнего непробельного символа
  // выше, а лишние сегменты снимет containerOf.
  const atCursor = pathAt(md, pos)
  if (inFlow(md, atCursor, pos)) return null

  let parts = atCursor
  if (parts.length === 0) {
    const probe = lastNonSpaceBefore(text, pos)
    if (probe >= 0) parts = pathAt(md, probe)
  }

  if (item) {
    const seq = seqAtColumn(md, parts, column)
    if (seq === null) return null
    parts = seq
  } else {
    parts = containerOf(md, parts, column)
    // Страховка на случай, когда отступ ничего не решил: значение вводится
    // ВНУТРИ пары, а ключами отображения его содержимое считать нельзя
    if (mode === 'value' && parts.length > 0 && parts[parts.length - 1] === key) {
      parts = parts.slice(0, -1)
    }
  }

  const section = sectionOf(parts, item)
  if (section === null) return null

  const node = nodeAt(md, parts)
  const existingKeys = isMap(node)
    ? node.items.map((pair) => keyOf(pair.key)).filter((k): k is string => k !== undefined)
    : []

  return { section, parts, existingKeys, mode, key }
}

/**
 * Имя вложенного отображения словаря, в котором стоит курсор (`remnawave`,
 * `override`, `health-check`). Составные ключи словаря — это путь через такое
 * отображение, а не имя ключа с точкой, поэтому в тексте строка несёт только
 * короткое имя листа.
 */
export function nestedIn(cursor: MihomoCursor): string | undefined {
  const last = cursor.parts[cursor.parts.length - 1]
  if (typeof last !== 'string') return undefined
  return fieldsOf(cursor.section).some((f) => f.key.startsWith(`${last}.`)) ? last : undefined
}

/** Поле словаря по имени ключа строки — с учётом вложенного отображения */
export function fieldFor(cursor: MihomoCursor, key: string): MihomoField | undefined {
  const prefix = nestedIn(cursor)
  return (
    (prefix === undefined ? undefined : fieldOf(cursor.section, `${prefix}.${key}`)) ??
    fieldOf(cursor.section, key)
  )
}

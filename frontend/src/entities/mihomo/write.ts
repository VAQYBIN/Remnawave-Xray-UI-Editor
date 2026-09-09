// Писатель Mihomo: операции DocOp над документом в ДВУХ режимах. Правка
// существующего собственного однострочного скаляра в блочном отображении —
// сплайс по диапазону (байты вне правки не меняются: правка формы читается в
// diff одной строкой). Всё структурное — новый ключ, вложенное отображение,
// элемент списка, порядок, flow-коллекция, многострочный скаляр — Document
// библиотеки yaml с перепечаткой toString({ lineWidth: 0 }). Спайк и тест
// ниже держат инвариант: якоря, алиасы, слияния и комментарии переживают круг.
//
// Отказ вместо порчи: путь через алиас или ключ из слияния не пишется —
// операция уходит в `refused` с причиной, остальные применяются. Форма до
// этого не доводит (спрашивает lockAt), это защита для рецептов и кабелей.
//
// Каждая операция перечитывает документ: следующая считает диапазоны по уже
// изменённому тексту, и пачка операций в одном вызове безопасна.

import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, type Document, type Pair } from 'yaml'
import type { DocOp, SchemaPath } from '../../shared/schema'
import { applyEdits, newlineOf, originAt, removeFieldAt, setFieldAt } from './edits'
import { dealias, mergedHas, mergedNode } from './merge'
import { parseMihomo, type MihomoDoc } from './parse'

export const LOCK_ALIAS = 'Значение приходит через ссылку на якорь «*» — правится в тексте, у объявления якоря.'
export const LOCK_MERGED = 'Значение приходит через слияние «<<:» — правится в тексте, у объявления слитого отображения.'

export interface MihomoLock {
  kind: 'alias' | 'merged'
  reason: string
}

export interface MihomoRefused {
  op: DocOp
  reason: string
}

export interface MihomoWriteResult {
  md: MihomoDoc
  refused: MihomoRefused[]
}

function keyOf(pair: Pair): string | undefined {
  const value = (pair.key as { value?: unknown } | null)?.value
  return typeof value === 'string' ? value : undefined
}

function ownPair(map: unknown, key: string): Pair | undefined {
  return isMap(map) ? map.items.find((p) => keyOf(p) === key) : undefined
}

/**
 * Замок по пути. Обход идёт по СОБСТВЕННЫМ узлам: алиас на любом сегменте —
 * замок alias (значение лежит у объявления якоря, писать сюда значит писать
 * туда); ключ, которого нет среди собственных, но который есть через `<<:` —
 * замок merged. Отсутствующий ключ без слияния — не замок: туда можно писать,
 * промежуточные отображения заведёт режим модели.
 */
export function mihomoLockAt(md: MihomoDoc, path: SchemaPath): MihomoLock | null {
  let node: unknown = md.doc.contents
  for (const step of path) {
    if (isAlias(node)) return { kind: 'alias', reason: LOCK_ALIAS }
    if (typeof step === 'number') {
      if (!isSeq(node)) return null
      node = node.items[step]
      continue
    }
    if (!isMap(node)) return null
    const own = ownPair(node, step)
    if (own === undefined) {
      return mergedHas(md, node, step) ? { kind: 'merged', reason: LOCK_MERGED } : null
    }
    node = own.value
  }
  return isAlias(node) ? { kind: 'alias', reason: LOCK_ALIAS } : null
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}

/** Перепечатка модели с сохранением перевода строки документа */
function print(md: MihomoDoc, doc: Document.Parsed): MihomoDoc {
  let text = doc.toString({ lineWidth: 0 })
  if (newlineOf(md.text) === '\r\n') text = text.replace(/\r?\n/g, '\r\n')
  return parseMihomo(text)
}

function freshDoc(md: MihomoDoc): Document.Parsed {
  return parseDocument(md.text, { keepSourceTokens: true, merge: true })
}

function isScalarValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * Режим сплайса: последний сегмент — строковый ключ БЕЗ точки (составные ключи
 * `setFieldAt` разбирает как путь, а у hosts ключом служит домен с точками),
 * ключ собственный, значение — скаляр, и печать уместилась в одну строку.
 * Всё прочее возвращает null — операция идёт в режим модели.
 */
function spliceOp(md: MihomoDoc, op: DocOp): string | null {
  if (op.op !== 'set' && op.op !== 'remove') return null
  const key = op.path[op.path.length - 1]
  if (typeof key !== 'string' || key.includes('.') || op.path.length === 0) return null
  const parent = op.path.slice(0, -1)
  if (originAt(md, parent, key) !== 'own') return null
  const edits = op.op === 'set'
    ? (isScalarValue(op.value) ? setFieldAt(md, parent, key, op.value) : [])
    : removeFieldAt(md, parent, key)
  return edits.length > 0 ? applyEdits(md.text, edits) : null
}

/**
 * Итог операции режима модели. Находка ревью задачи 6: `deleteIn` тихо
 * возвращает `false` на отсутствующем ключе, а `move`/`insert` с чужим типом
 * узла раньше просто выходили без действия — и в обоих случаях вызывающий
 * всё равно перепечатывал документ целиком (`toString`) РАДИ НУЛЕВОГО
 * изменения: форматирование могло сдвинуться без единой содержательной
 * правки, а `refused` остался бы пуст, соврав об успехе. Теперь у операции
 * есть явный третий исход — «не изменилось», и вызывающий не перепечатывает
 * документ на нём вовсе.
 */
type ModelOpOutcome = { ok: true } | { ok: false; reason: string }

const OK: ModelOpOutcome = { ok: true }

function applyModelOp(doc: Document.Parsed, op: DocOp): ModelOpOutcome {
  switch (op.op) {
    case 'set':
      doc.setIn(op.path, op.value)
      return OK
    case 'remove':
      // Тихий `false` — ключа по этому пути не было; исключение (путь через
      // скаляр) долетает до `applyMihomoOps` само и ловится там try/catch'ем.
      return doc.deleteIn(op.path)
        ? OK
        : { ok: false, reason: 'операция не изменила документ: по этому пути ничего нет' }
    case 'insert': {
      // Различаем ОТСУТСТВУЮЩИЙ путь (там можно завести список — это и есть
      // «режим модели заводит ключи») и путь, где уже лежит СВОЁ значение
      // другого вида: `hasIn` идёт по коллекциям с самого начала пути и
      // возвращает false и там, где промежуточный узел — не коллекция,
      // и там, где последний узел отсутствует, — ровно то отличие, которое
      // нужно от «есть значение, но это не список» (замена его пустым
      // списком стёрла бы то, что там было записано).
      //
      // Третий случай — голый ключ БЕЗ значения (`proxies: # LEAVE THIS
      // LINE!`, каркас `starterMihomo.ts`): `hasIn` на нём отвечает true
      // (под ключом лежит `Scalar(null)`, комментарий несёт именно он), хотя
      // писать туда нечего — это то же «отсутствует», просто с довеском в
      // виде декоративного маркера панели.
      const exists = doc.hasIn(op.path)
      const cur = doc.getIn(op.path, true)
      const missing = !exists || (isScalar(cur) && cur.value === null)
      let seq = cur
      if (missing) {
        seq = doc.createNode([])
        doc.setIn(op.path, seq)
      } else if (!isSeq(seq)) {
        return { ok: false, reason: 'по этому пути не список — вставка заменила бы значение пустым списком' }
      }
      const list = seq as { items: unknown[] }
      list.items.splice(clamp(op.index, list.items.length), 0, doc.createNode(op.value))
      return OK
    }
    case 'move': {
      const seq = doc.getIn(op.path, true)
      if (!isSeq(seq)) return { ok: false, reason: 'по этому пути нет списка — перестановка невозможна' }
      const items = seq.items as unknown[]
      if (op.from < 0 || op.from >= items.length || op.to < 0 || op.to >= items.length) {
        return { ok: false, reason: 'индекс перестановки вне списка' }
      }
      const [moved] = items.splice(op.from, 1)
      items.splice(op.to, 0, moved)
      return OK
    }
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}

/** Путь, по которому операция обязана быть свободна от замков: у insert/move — сам список */
function lockPathOf(op: DocOp): SchemaPath {
  return op.path
}

export function applyMihomoOps(md: MihomoDoc, ops: DocOp[]): MihomoWriteResult {
  let current = md
  const refused: MihomoRefused[] = []
  for (const op of ops) {
    const lock = mihomoLockAt(current, lockPathOf(op))
    if (lock !== null) {
      refused.push({ op, reason: lock.reason })
      continue
    }
    const spliced = spliceOp(current, op)
    if (spliced !== null) {
      current = parseMihomo(spliced)
      continue
    }
    const doc = freshDoc(current)
    let outcome: ModelOpOutcome
    try {
      outcome = applyModelOp(doc, op)
    } catch (e) {
      refused.push({ op, reason: `документ не принял правку: ${(e as Error).message}` })
      continue
    }
    if (!outcome.ok) {
      refused.push({ op, reason: outcome.reason })
      continue
    }
    current = print(current, doc)
  }
  return { md: current, refused }
}

/**
 * Материализация: значение из якоря копируется на место — собственным ключом
 * (merged) либо копией узла вместо ссылки (alias). Объявление якоря остаётся
 * нетронутым, остальные его потребители — тоже. Это правка документа
 * пользователя по его явному выбору, а не побочный эффект набора текста.
 */
export function materializeAt(md: MihomoDoc, path: SchemaPath): MihomoDoc {
  const lock = mihomoLockAt(md, path)
  if (lock === null) return md
  const doc = freshDoc(md)
  if (lock.kind === 'merged') {
    const key = path[path.length - 1]
    const parent = doc.getIn(path.slice(0, -1), true)
    if (typeof key !== 'string' || !isMap(parent)) return md
    const source = dealias(md, mergedNode(md, parent, key))
    // `source` — узел ИЗ `md.doc` (`mergedNode`/`dealias` разрешают алиасы
    // относительно него, не относительно свежего `doc`): `.toJS(md.doc, ...)`
    // резолвит его вложенные ссылки/слияния относительно ТОГО документа,
    // где они и объявлены.
    //
    // Находка ревью задачи 6: `.toJSON()` без контекста (`ToJSOptions`) —
    // не то же самое, что `.toJS()`. У `Alias` без контекста `toJSON`
    // возвращает служебный `{ source: <имя якоря> }` вместо значения, на
    // которое ссылается алиас (см. `Alias.toJSON` в исходниках `yaml`), а у
    // отображения со СВОИМ `<<:` внутри `toJSON` без контекста падает
    // (`Merge sources must be maps or map aliases` — `addMergeToJSMap` не
    // может разрешить алиас цели слияния без `ctx.doc`). `mergedNode`
    // разворачивает цепочки ссылок и слияний НАМЕРЕННО глубоко — скопированное
    // значение обязано быть развёрнуто так же глубоко, а не только на первом
    // уровне, иначе материализация тихо портит документ или падает.
    if (!isNode(source)) return md
    doc.setIn(path, doc.createNode(source.toJS(md.doc, { maxAliasCount: -1 })))
    return print(md, doc)
  }
  // alias: первый сегмент пути, чьё собственное значение — ссылка
  let node: unknown = doc.contents
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    const pair = typeof step === 'string' ? ownPair(node, step) : undefined
    const child: unknown = typeof step === 'number' ? (isSeq(node) ? node.items[step] : undefined) : pair?.value
    if (isAlias(child)) {
      const resolved = child.resolve(doc)
      // Тот же приём, что у merged-ветки выше, но относительно СВЕЖЕГО `doc`:
      // здесь и алиас, и цель его разрешения принадлежат `doc` (обход начат от
      // `doc.contents`), поэтому контекст для `toJS` — сам `doc`.
      if (!isNode(resolved)) return md
      const copy = doc.createNode(resolved.toJS(doc, { maxAliasCount: -1 }))
      if (pair !== undefined) pair.value = copy
      else if (isSeq(node) && typeof step === 'number') node.items[step] = copy
      return print(md, doc)
    }
    node = child
  }
  return md
}

/** Переименование ключа отображения НА МЕСТЕ: порядок записей сохраняется */
export function renameKeyAt(md: MihomoDoc, mapPath: SchemaPath, from: string, to: string): MihomoDoc {
  const doc = freshDoc(md)
  const map = doc.getIn(mapPath, true)
  const pair = ownPair(map, from)
  if (pair === undefined) return md
  pair.key = doc.createNode(to)
  return print(md, doc)
}

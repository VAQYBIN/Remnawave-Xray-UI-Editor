// Операции писателя. Форма не отдаёт наружу целое значение: она эмитит
// операции по пути, и одна и та же форма служит модельным ядрам (копия объекта)
// и Mihomo (сплайс или правка модели yaml). Здесь — применение к JSON-модели.

import type { SchemaPath } from './types'
import { isRecord } from './resolve'

export type DocOp =
  | { op: 'set'; path: SchemaPath; value: unknown }
  | { op: 'remove'; path: SchemaPath }
  | { op: 'insert'; path: SchemaPath; index: number; value: unknown }
  | { op: 'move'; path: SchemaPath; from: number; to: number }

export interface Lock {
  /** Почему значение по этому пути правится только в тексте — по-русски, форма показывает как есть */
  reason: string
}

export interface DocWriter {
  apply(ops: DocOp[]): void
  /** null — правится; иначе форма рисует поле на чтение с причиной */
  lockAt(path: SchemaPath): Lock | null
}

/**
 * Контейнер по пути. `create` заводит недостающие звенья: ключ → объект,
 * индекс → список. Так `set` по несуществующему пути и заводит секцию
 * панели «Документ» — отдельной операции «создать раздел» не нужно.
 * `depth` — сколько шагов в полном пути пройти (не слой путь, а читай nextStep
 * из полного пути — так set с численным финальным сегментом создаст массив).
 */
function containerAt(root: unknown, path: SchemaPath, depth: number, create: boolean): unknown {
  let cur: unknown = root
  for (let i = 0; i < depth; i += 1) {
    const step = path[i]
    const nextStep = path[i + 1]
    if (typeof step === 'number') {
      if (!Array.isArray(cur)) return undefined
      if (cur[step] === undefined) {
        if (!create) return undefined
        cur[step] = typeof nextStep === 'number' ? [] : {}
      }
      cur = cur[step]
    } else {
      if (!isRecord(cur)) return undefined
      if (cur[step] === undefined) {
        if (!create) return undefined
        cur[step] = typeof nextStep === 'number' ? [] : {}
      }
      cur = cur[step]
    }
  }
  return cur
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}

/** Применение к копии: вход держит React, и правка на месте не вызвала бы перерисовку */
export function applyOps<T>(model: T, ops: DocOp[]): T {
  const next = structuredClone(model) as unknown
  for (const op of ops) {
    if (op.op === 'set') {
      const parent = containerAt(next, op.path, op.path.length - 1, true)
      const last = op.path[op.path.length - 1]
      if (last === undefined) continue
      if (typeof last === 'number') {
        if (Array.isArray(parent)) parent[last] = op.value
      } else if (isRecord(parent)) {
        parent[last] = op.value
      }
      continue
    }
    if (op.op === 'remove') {
      const parent = containerAt(next, op.path, op.path.length - 1, false)
      const last = op.path[op.path.length - 1]
      if (typeof last === 'number') {
        if (Array.isArray(parent) && last < parent.length) parent.splice(last, 1)
      } else if (last !== undefined && isRecord(parent)) {
        delete parent[last]
      }
      continue
    }
    if (op.op === 'insert') {
      const parent = containerAt(next, op.path, op.path.length - 1, true)
      const last = op.path[op.path.length - 1]
      if (typeof last !== 'string' || !isRecord(parent)) continue
      if (parent[last] === undefined) parent[last] = []
      const list = parent[last]
      if (!Array.isArray(list)) continue
      list.splice(clamp(op.index, list.length), 0, op.value)
      continue
    }
    if (op.op === 'move') {
      const list = containerAt(next, op.path, op.path.length, false)
      if (!Array.isArray(list)) continue
      if (op.from < 0 || op.from >= list.length || op.to < 0 || op.to >= list.length) continue
      const [moved] = list.splice(op.from, 1)
      list.splice(op.to, 0, moved)
      continue
    }
    // Исчерпывающая проверка: если типы операций расширены, тайпчек падёт здесь
    const _exhaustive: never = op
    return _exhaustive
  }
  return next as T
}

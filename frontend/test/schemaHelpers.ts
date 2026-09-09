import type { DocOp, DocWriter, Lock, SchemaPath } from '../src/shared/schema'

/** Писатель-ловушка: копит операции и отвечает замком по заданным путям */
export function makeWriter(locks: { path: SchemaPath; reason: string }[] = []) {
  const ops: DocOp[] = []
  const writer: DocWriter = {
    apply: (next) => ops.push(...next),
    lockAt: (path): Lock | null => {
      const hit = locks.find((l) => JSON.stringify(l.path) === JSON.stringify(path))
      return hit ? { reason: hit.reason } : null
    },
  }
  return { ops, writer }
}

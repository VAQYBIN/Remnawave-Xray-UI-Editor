import { groupsOf, providersOf } from './groups'
import type { MihomoDoc } from './parse'

/** Имена, которые ядро понимает само; COMPATIBLE — заглушка пустой группы */
export const BUILTIN_TARGETS = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'] as const

export type TargetKind = 'group' | 'provider' | 'builtin' | 'unknown'

export function resolveTarget(md: MihomoDoc, name: string): TargetKind {
  if ((BUILTIN_TARGETS as readonly string[]).includes(name)) return 'builtin'
  if (groupsOf(md).some((g) => g.name === name)) return 'group'
  if (providersOf(md).some((p) => p.name === name)) return 'provider'
  return 'unknown'
}

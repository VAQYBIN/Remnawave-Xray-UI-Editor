import { groupsOf, providersOf, proxiesOf } from './groups'
import type { MihomoDoc } from './parse'

/** Имена, которые ядро понимает само; COMPATIBLE — заглушка пустой группы */
export const BUILTIN_TARGETS = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'] as const

export type TargetKind = 'group' | 'proxy' | 'provider' | 'builtin' | 'unknown'

// Порядок проверки — builtin → group → proxy → provider. Группа проверяется
// раньше сервера намеренно: имя статического сервера и имя группы делят одно
// пространство имён (обе цели правила), и живые шаблоны иногда называют группу
// так же, как один из её собственных серверов (селектор с тем же именем, что
// у единственного кандидата) — тогда побеждает группа, а не сервер. Сервер —
// раньше провайдера по той же логике: `proxies`/цель правила ссылаются на
// статический сервер напрямую, а провайдер в эти поля попадает только через
// `use`, поэтому при совпадении имён более прямая ссылка обязана победить.
export function resolveTarget(md: MihomoDoc, name: string): TargetKind {
  if ((BUILTIN_TARGETS as readonly string[]).includes(name)) return 'builtin'
  if (groupsOf(md).some((g) => g.name === name)) return 'group'
  if (proxiesOf(md).some((p) => p.name === name)) return 'proxy'
  if (providersOf(md).some((p) => p.name === name)) return 'provider'
  return 'unknown'
}

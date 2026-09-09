// Рецепт «Локальный вход»: заводит mixed/socks/http-inbound на 127.0.0.1 —
// тот же порт, что открывают клиенты по умолчанию, чтобы пустить через
// собранный документ локальный трафик машины (браузер, curl, systemwide-proxy).

import type { RecipeChange, RecipePlan } from '../../../shared/recipes/types'
import type { SingboxDoc } from '../types'
import { ensureAt } from './apply'

export interface LocalParams {
  kind: 'mixed' | 'socks' | 'http'
  port: number
  setSystemProxy: boolean
}

export const LOCAL_DEFAULTS: LocalParams = { kind: 'mixed', port: 2080, setSystemProxy: false }

export function validateLocal(p: LocalParams): string | null {
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) return 'Порт должен быть от 1 до 65535'
  return null
}

export function planLocal(doc: SingboxDoc, p: LocalParams): RecipePlan<SingboxDoc> {
  const entry: Record<string, unknown> = {
    type: p.kind,
    tag: `${p.kind}-in`,
    listen: '127.0.0.1',
    listen_port: p.port,
  }
  // false — умолчание ядра для этого ключа: как и у CheckboxField, не пишем его в документ
  if (p.setSystemProxy) entry.set_system_proxy = true

  const res = ensureAt(doc, ['inbounds'], entry, 'tag', 'end')
  const changes: RecipeChange[] = [
    { status: res.status, text: res.status === 'add' ? `inbound ${entry.tag} (${p.kind}, порт ${p.port})` : `inbound ${entry.tag} — уже есть` },
  ]
  return { model: res.doc, changes, notes: [] }
}

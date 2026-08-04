// Профили Remnawave хранятся с пустым clients — пользователей инжектит панель.
// computed-config отвечает на вопрос, которого не знал dummyClient: как именно
// выглядит клиент, которого панель реально подставляет. Берём оттуда одного на
// inbound; всё, чему пары не нашлось, уходит в фиктивных как раньше.

import { needsClient, withDummyClients } from './dummyClient.js'

export interface Injected {
  tag: string
  /** 'panel' — клиент взят из computed-config, 'dummy' — подставлен редактором */
  source: 'panel' | 'dummy'
}

export interface PanelInjection {
  config: unknown
  injected: Injected[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** tag → первый клиент inbound'а вычисленного конфига */
function panelClientsByTag(computed: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>()
  if (!isRecord(computed) || !Array.isArray(computed.inbounds)) return map
  for (const raw of computed.inbounds) {
    if (!isRecord(raw) || typeof raw.tag !== 'string') continue
    const settings = isRecord(raw.settings) ? raw.settings : undefined
    const clients = settings?.clients
    if (!Array.isArray(clients) || clients.length === 0) continue
    map.set(raw.tag, clients[0])
  }
  return map
}

export function withPanelClients(draft: unknown, computed?: unknown): PanelInjection {
  const byTag = panelClientsByTag(computed)
  const injected: Injected[] = []

  let staged: unknown = draft
  if (byTag.size > 0 && isRecord(draft) && Array.isArray(draft.inbounds)) {
    const next = structuredClone(draft) as Record<string, unknown>
    for (const raw of next.inbounds as unknown[]) {
      if (!isRecord(raw) || typeof raw.tag !== 'string') continue
      if (!needsClient(raw)) continue
      const client = byTag.get(raw.tag)
      if (client === undefined) continue
      if (!isRecord(raw.settings)) raw.settings = {}
      ;(raw.settings as Record<string, unknown>).clients = [client]
      injected.push({ tag: raw.tag, source: 'panel' })
    }
    staged = next
  }

  const dummy = withDummyClients(staged)
  return {
    config: dummy.config,
    injected: [...injected, ...dummy.injected.map((tag) => ({ tag, source: 'dummy' as const }))],
  }
}

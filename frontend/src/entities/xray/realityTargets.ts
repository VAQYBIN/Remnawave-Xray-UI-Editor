import type { XrayConfig } from './config'

export interface RealityTargetRef {
  inboundTag: string
  /** Всегда host:port — проба на бэкенде ждёт именно такую запись */
  target: string
  serverNames: string[]
}

/** Цель без порта в конфиге допустима: ядро подразумевает 443 */
function withPort(target: string): string {
  const trimmed = target.trim()
  if (trimmed.startsWith('[')) return /\]:\d+$/.test(trimmed) ? trimmed : `${trimmed}:443`
  return /:\d+$/.test(trimmed) ? trimmed : `${trimmed}:443`
}

export function realityTargetsOf(config: XrayConfig): RealityTargetRef[] {
  const out: RealityTargetRef[] = []
  for (const inbound of config.inbounds ?? []) {
    const stream = inbound.streamSettings as
      | {
          security?: string
          realitySettings?: { target?: unknown; dest?: unknown; serverNames?: unknown }
        }
      | undefined
    if (stream?.security !== 'reality') continue
    const reality = stream.realitySettings
    // dest — устаревшее имя того же поля; в конфигах панели встречаются оба
    const raw = reality?.target ?? reality?.dest
    if (typeof raw !== 'string' || raw.trim() === '') continue
    out.push({
      inboundTag: inbound.tag,
      target: withPort(raw),
      serverNames: Array.isArray(reality?.serverNames)
        ? (reality.serverNames.filter((n) => typeof n === 'string') as string[])
        : [],
    })
  }
  return out
}

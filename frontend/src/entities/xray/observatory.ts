// Глобальные секции проверки живости outbound'ов. Их ровно две на конфиг:
// observatory (нужна стратегии leastPing) и burstObservatory (leastLoad).
// subjectSelector, как и selector балансера, матчит теги ПО ПРЕФИКСУ.

import { z } from 'zod'
import type { XrayConfig } from './config'

export const ObservatorySchema = z
  .object({
    subjectSelector: z.array(z.string()).optional(),
    probeUrl: z.string().optional(),
    probeInterval: z.string().optional(),
    enableConcurrency: z.boolean().optional(),
  })
  .passthrough()

export const PingConfigSchema = z
  .object({
    destination: z.string().optional(),
    connectivity: z.string().optional(),
    interval: z.string().optional(),
    sampling: z.number().optional(),
    timeout: z.string().optional(),
    httpMethod: z.string().optional(),
  })
  .passthrough()

export const BurstObservatorySchema = z
  .object({
    subjectSelector: z.array(z.string()).optional(),
    pingConfig: PingConfigSchema.optional(),
  })
  .passthrough()

export type Observatory = z.infer<typeof ObservatorySchema>
export type BurstObservatory = z.infer<typeof BurstObservatorySchema>

export type ObservatoryKind = 'observatory' | 'burst'

export function subjectCovers(subjectSelector: string[] | undefined, tag: string): boolean {
  return (subjectSelector ?? []).some((p) => tag.startsWith(p))
}

/**
 * Создаёт секцию или ДОПОЛНЯЕТ её subjectSelector непокрытыми тегами. Чужие значения
 * не затираются: секция общая на конфиг, и другой балансер мог вписать туда своё.
 * Когда добавлять нечего — ТОТ ЖЕ конфиг (вызывающий сравнивает через ===).
 */
export function ensureObservatorySection(
  config: XrayConfig,
  kind: ObservatoryKind,
  subjects: string[],
): XrayConfig {
  const key = kind === 'burst' ? 'burstObservatory' : 'observatory'
  const current = config[key] as { subjectSelector?: string[] } | undefined
  const existing = current?.subjectSelector ?? []
  const missing = subjects.filter((tag) => !subjectCovers(existing, tag))
  if (current !== undefined && missing.length === 0) return config
  return {
    ...config,
    [key]: { ...(current ?? {}), subjectSelector: [...existing, ...missing] },
  }
}

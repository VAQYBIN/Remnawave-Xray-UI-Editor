import { z } from 'zod'
import { InboundSchema } from './inbounds'
import { OutboundSchema } from './outbounds'
import { RoutingSchema } from './routing'

const obj = () => z.object({}).passthrough()

export const XrayConfigSchema = z
  .object({
    log: obj().optional(),
    dns: obj().optional(),
    inbounds: z.array(InboundSchema).optional(),
    outbounds: z.array(OutboundSchema).optional(),
    routing: RoutingSchema.optional(),
    policy: obj().optional(),
    transport: obj().optional(),
    stats: obj().optional(),
    reverse: obj().optional(),
    fakedns: z.union([obj(), z.array(obj())]).optional(),
    observatory: obj().optional(),
    burstObservatory: obj().optional(),
    api: obj().optional(),
  })
  .passthrough()

export type XrayConfig = z.infer<typeof XrayConfigSchema>

export interface ValidationIssue {
  path: string
  message: string
  level: 'error' | 'warning'
}

export function analyzeIntegrity(config: XrayConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const inbounds = config.inbounds ?? []
  const outbounds = config.outbounds ?? []

  const seenTags = new Map<string, string>()
  inbounds.forEach((inb, i) => {
    const key = `inbound:${inb.tag}`
    if (seenTags.has(key)) {
      issues.push({ path: `inbounds.${i}.tag`, message: `Дубликат тега inbound «${inb.tag}»`, level: 'warning' })
    }
    seenTags.set(key, inb.tag)
  })
  outbounds.forEach((out, i) => {
    const key = `outbound:${out.tag}`
    if (seenTags.has(key)) {
      issues.push({ path: `outbounds.${i}.tag`, message: `Дубликат тега outbound «${out.tag}»`, level: 'warning' })
    }
    seenTags.set(key, out.tag)
  })

  const seenPorts = new Map<string, string>()
  inbounds.forEach((inb, i) => {
    if (inb.port === undefined) return
    const port = String(inb.port)
    const prev = seenPorts.get(port)
    if (prev) {
      issues.push({
        path: `inbounds.${i}.port`,
        message: `Порт ${port} уже занят inbound «${prev}»`,
        level: 'warning',
      })
    } else {
      seenPorts.set(port, inb.tag)
    }
  })

  const inboundTags = new Set(inbounds.map((x) => x.tag))
  const outboundTags = new Set(outbounds.map((x) => x.tag))
  const rules = config.routing?.rules ?? []
  rules.forEach((rule, i) => {
    if (rule.outboundTag && !outboundTags.has(rule.outboundTag)) {
      issues.push({
        path: `routing.rules.${i}.outboundTag`,
        message: `Правило ссылается на несуществующий outbound «${rule.outboundTag}»`,
        level: 'warning',
      })
    }
    for (const tag of rule.inboundTag ?? []) {
      if (!inboundTags.has(tag)) {
        issues.push({
          path: `routing.rules.${i}.inboundTag`,
          message: `Правило ссылается на несуществующий inbound «${tag}»`,
          level: 'warning',
        })
      }
    }
  })

  return issues
}

export function validateXrayConfig(text: string): {
  ok: boolean
  config?: unknown
  issues: ValidationIssue[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: `Некорректный JSON: ${err instanceof Error ? err.message : String(err)}`,
          level: 'error',
        },
      ],
    }
  }

  const parsed = XrayConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      config: raw,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        level: 'error' as const,
      })),
    }
  }

  return { ok: true, config: raw, issues: analyzeIntegrity(parsed.data) }
}

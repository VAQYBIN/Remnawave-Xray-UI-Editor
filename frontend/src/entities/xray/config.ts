import { z } from 'zod'
import { flowNetworkIssue, hysteriaCertificateIssue, securityNetworkIssue } from './compat'
import { DnsSchema } from './dns'
import { InboundSchema } from './inbounds'
import { LogSchema } from './log'
import { OutboundSchema } from './outbounds'
import { keywordEntries, portSpecError } from './rules'
import { RoutingSchema } from './routing'

const obj = () => z.object({}).passthrough()

// Поднабор streamSettings, который читают проверки матрицы (схема — passthrough,
// поэтому типизируем только нужные ключи)
interface StreamSubset {
  network?: string
  security?: string
  tlsSettings?: { certificates?: unknown[] }
  sockopt?: { dialerProxy?: string }
}

export const XrayConfigSchema = z
  .object({
    log: LogSchema.optional(),
    dns: DnsSchema.optional(),
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
  const balancerTags = new Set(
    (config.routing?.balancers ?? [])
      .map((b) => (b as { tag?: unknown }).tag)
      .filter((t): t is string => typeof t === 'string'),
  )
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
    // Балансеры редактируются только в JSON, но висячая ссылка должна быть видна
    if (rule.balancerTag && !balancerTags.has(rule.balancerTag)) {
      issues.push({
        path: `routing.rules.${i}.balancerTag`,
        message: `Правило ссылается на несуществующий балансер «${rule.balancerTag}»`,
        level: 'warning',
      })
    }
    const keywords = keywordEntries(rule.domain)
    if (keywords.length > 0) {
      issues.push({
        path: `routing.rules.${i}.domain`,
        message: `Домены без префикса матчатся как подстрока (keyword): ${keywords.join(', ')}`,
        level: 'warning',
      })
    }
    const portErr = portSpecError(rule.port)
    if (portErr) issues.push({ path: `routing.rules.${i}.port`, message: portErr, level: 'error' })
    const sourcePortErr = portSpecError(rule.sourcePort)
    if (sourcePortErr) {
      issues.push({ path: `routing.rules.${i}.sourcePort`, message: sourcePortErr, level: 'error' })
    }
  })

  // Матрица совместимости streamSettings: такие конфиги ядро Xray не запустит,
  // поэтому level 'error' — сознательно блокирует «Сохранить в панель»
  inbounds.forEach((inb, i) => {
    const stream = inb.streamSettings as StreamSubset | undefined
    if (stream) {
      const secNet = securityNetworkIssue(stream.security, stream.network)
      if (secNet) issues.push({ path: `inbounds.${i}.streamSettings`, message: secNet, level: 'error' })
      const cert = hysteriaCertificateIssue(stream.network, stream.security, stream.tlsSettings)
      if (cert) issues.push({ path: `inbounds.${i}.streamSettings`, message: cert, level: 'error' })
    }
    if (inb.protocol === 'vless') {
      // Панель Remnawave применяет flow из settings ко всем пользователям inbound'а
      const flow = (inb.settings as { flow?: string } | undefined)?.flow
      const flowIssue = flowNetworkIssue(flow, stream?.network)
      if (flowIssue) issues.push({ path: `inbounds.${i}.settings.flow`, message: flowIssue, level: 'error' })
    }
  })

  outbounds.forEach((out, i) => {
    const stream = out.streamSettings as StreamSubset | undefined
    if (stream) {
      const secNet = securityNetworkIssue(stream.security, stream.network)
      if (secNet) issues.push({ path: `outbounds.${i}.streamSettings`, message: secNet, level: 'error' })
      const dialer = stream.sockopt?.dialerProxy
      if (dialer !== undefined && dialer !== '' && !outboundTags.has(dialer)) {
        issues.push({
          path: `outbounds.${i}.streamSettings.sockopt.dialerProxy`,
          message: `dialerProxy ссылается на несуществующий outbound «${dialer}»`,
          level: 'warning',
        })
      }
    }
    if (out.protocol === 'vless') {
      const vnext = (out.settings as { vnext?: { users?: { flow?: string }[] }[] } | undefined)?.vnext ?? []
      vnext.forEach((server, si) => {
        for (const [ui, user] of (server.users ?? []).entries()) {
          const flowIssue = flowNetworkIssue(user.flow, stream?.network)
          if (flowIssue) {
            issues.push({
              path: `outbounds.${i}.settings.vnext.${si}.users.${ui}.flow`,
              message: flowIssue,
              level: 'error',
            })
          }
        }
      })
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

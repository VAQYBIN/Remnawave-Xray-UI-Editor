import { z } from 'zod'
import { BALANCER_STRATEGIES, balancerCandidates } from './balancers'
import { flowNetworkIssue, hysteriaCertificateIssue, securityNetworkIssue } from './compat'
import { DnsSchema } from './dns'
import { InboundSchema } from './inbounds'
import { LogSchema } from './log'
import { BurstObservatorySchema, ObservatorySchema, subjectCovers } from './observatory'
import { OutboundSchema } from './outbounds'
import { keywordEntries, portSpecError } from './rules'
import { RoutingSchema } from './routing'

const obj = () => z.looseObject({})

// Поднабор streamSettings, который читают проверки матрицы (схема пропускает
// неизвестные поля, поэтому типизируем только нужные ключи)
interface StreamSubset {
  network?: string
  security?: string
  tlsSettings?: { certificates?: unknown[] }
  sockopt?: { dialerProxy?: string }
}

export const XrayConfigSchema = z.looseObject({
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
  observatory: ObservatorySchema.optional(),
  burstObservatory: BurstObservatorySchema.optional(),
  api: obj().optional(),
})

export type XrayConfig = z.infer<typeof XrayConfigSchema>

/** Путь до места проблемы: строки — ключи, числа — индексы массивов */
export type PathParts = (string | number)[]

export function formatPath(parts: PathParts): string {
  return parts.join('.')
}

export interface ValidationIssue {
  parts: PathParts
  /** Производное от parts представление: показ в статус-баре и сортировка */
  path: string
  message: string
  level: 'error' | 'warning'
}

// Единственное место сборки: path обязан оставаться согласованным с parts
function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: formatPath(parts), message, level }
}

export function analyzeIntegrity(config: XrayConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const inbounds = config.inbounds ?? []
  const outbounds = config.outbounds ?? []

  const seenTags = new Map<string, string>()
  inbounds.forEach((inb, i) => {
    const key = `inbound:${inb.tag}`
    if (seenTags.has(key)) {
      issues.push(issue(['inbounds', i, 'tag'], `Дубликат тега inbound «${inb.tag}»`, 'warning'))
    }
    seenTags.set(key, inb.tag)
  })
  outbounds.forEach((out, i) => {
    const key = `outbound:${out.tag}`
    if (seenTags.has(key)) {
      issues.push(issue(['outbounds', i, 'tag'], `Дубликат тега outbound «${out.tag}»`, 'warning'))
    }
    seenTags.set(key, out.tag)
  })

  const seenPorts = new Map<string, string>()
  inbounds.forEach((inb, i) => {
    if (inb.port === undefined) return
    const port = String(inb.port)
    const prev = seenPorts.get(port)
    if (prev) {
      issues.push(
        issue(['inbounds', i, 'port'], `Порт ${port} уже занят inbound «${prev}»`, 'warning'),
      )
    } else {
      seenPorts.set(port, inb.tag)
    }
  })

  const inboundTags = new Set(inbounds.map((x) => x.tag))
  const outboundTags = new Set(outbounds.map((x) => x.tag))
  const rules = config.routing?.rules ?? []
  const balancers = config.routing?.balancers ?? []
  const balancerTags = new Set(balancers.map((b) => b.tag))
  rules.forEach((rule, i) => {
    if (rule.outboundTag && !outboundTags.has(rule.outboundTag)) {
      issues.push(
        issue(
          ['routing', 'rules', i, 'outboundTag'],
          `Правило ссылается на несуществующий outbound «${rule.outboundTag}»`,
          'warning',
        ),
      )
    }
    for (const tag of rule.inboundTag ?? []) {
      if (!inboundTags.has(tag)) {
        issues.push(
          issue(
            ['routing', 'rules', i, 'inboundTag'],
            `Правило ссылается на несуществующий inbound «${tag}»`,
            'warning',
          ),
        )
      }
    }
    if (rule.balancerTag && !balancerTags.has(rule.balancerTag)) {
      issues.push(
        issue(
          ['routing', 'rules', i, 'balancerTag'],
          `Правило ссылается на несуществующий балансер «${rule.balancerTag}»`,
          'warning',
        ),
      )
    }
    // При обоих заданных тегах ядро берёт outboundTag — балансер просто не работает
    if (rule.balancerTag && rule.outboundTag) {
      issues.push(
        issue(
          ['routing', 'rules', i, 'balancerTag'],
          `У правила заданы и outboundTag «${rule.outboundTag}», и балансер «${rule.balancerTag}» — ядро возьмёт outboundTag, балансер не сработает`,
          'warning',
        ),
      )
    }
    const keywords = keywordEntries(rule.domain)
    if (keywords.length > 0) {
      issues.push(
        issue(
          ['routing', 'rules', i, 'domain'],
          `Домены без префикса матчатся как подстрока (keyword): ${keywords.join(', ')}`,
          'warning',
        ),
      )
    }
    const portErr = portSpecError(rule.port)
    if (portErr) issues.push(issue(['routing', 'rules', i, 'port'], portErr, 'error'))
    const sourcePortErr = portSpecError(rule.sourcePort)
    if (sourcePortErr) {
      issues.push(issue(['routing', 'rules', i, 'sourcePort'], sourcePortErr, 'error'))
    }
  })

  // Балансер выбирает outbound по ПРЕФИКСУ тега, а стратегии leastPing/leastLoad
  // работают только вместе с глобальной секцией обсерватории
  const seenBalancerTags = new Set<string>()
  balancers.forEach((bal, i) => {
    if (seenBalancerTags.has(bal.tag)) {
      issues.push(
        issue(['routing', 'balancers', i, 'tag'], `Дубликат тега балансера «${bal.tag}»`, 'error'),
      )
    }
    seenBalancerTags.add(bal.tag)

    const candidates = balancerCandidates(config, bal)
    if (candidates.length === 0) {
      issues.push(
        issue(
          ['routing', 'balancers', i, 'selector'],
          'Селектор не совпал ни с одним outbound — балансеру не из чего выбирать',
          'error',
        ),
      )
    }
    if (bal.fallbackTag !== undefined && !outboundTags.has(bal.fallbackTag)) {
      issues.push(
        issue(
          ['routing', 'balancers', i, 'fallbackTag'],
          `Запасной выход «${bal.fallbackTag}» не найден среди outbound'ов`,
          'warning',
        ),
      )
    }

    const type = bal.strategy?.type
    if (type !== undefined && !(BALANCER_STRATEGIES as readonly string[]).includes(type)) {
      issues.push(
        issue(
          ['routing', 'balancers', i, 'strategy'],
          `Неизвестная стратегия «${type}»; ядро знает: ${BALANCER_STRATEGIES.join(', ')}`,
          'warning',
        ),
      )
    }
    if (type === 'leastPing' || type === 'leastLoad') {
      const kindKey = type === 'leastPing' ? 'observatory' : 'burstObservatory'
      const section = config[kindKey]
      if (section === undefined) {
        issues.push(
          issue(
            ['routing', 'balancers', i, 'strategy'],
            `Стратегия ${type} измеряет выходы через ${kindKey} — этой секции в конфиге нет`,
            'warning',
          ),
        )
      } else {
        const missed = candidates.filter((tag) => !subjectCovers(section.subjectSelector, tag))
        if (missed.length > 0) {
          issues.push(
            issue(
              [kindKey, 'subjectSelector'],
              `Обсерватория не покрывает ${missed.join(', ')} — ядро не будет их мерить`,
              'warning',
            ),
          )
        }
      }
    }
  })

  // Матрица совместимости streamSettings: такие конфиги ядро Xray не запустит,
  // поэтому level 'error' — сознательно блокирует «Сохранить в панель»
  inbounds.forEach((inb, i) => {
    const stream = inb.streamSettings as StreamSubset | undefined
    if (stream) {
      const secNet = securityNetworkIssue(stream.security, stream.network)
      if (secNet) issues.push(issue(['inbounds', i, 'streamSettings'], secNet, 'error'))
      const cert = hysteriaCertificateIssue(stream.network, stream.security, stream.tlsSettings)
      if (cert) issues.push(issue(['inbounds', i, 'streamSettings'], cert, 'error'))
    }
    if (inb.protocol === 'vless') {
      // Панель Remnawave применяет flow из settings ко всем пользователям inbound'а
      const flow = (inb.settings as { flow?: string } | undefined)?.flow
      const flowIssue = flowNetworkIssue(flow, stream?.network)
      if (flowIssue) issues.push(issue(['inbounds', i, 'settings', 'flow'], flowIssue, 'error'))
    }
  })

  outbounds.forEach((out, i) => {
    const stream = out.streamSettings as StreamSubset | undefined
    if (stream) {
      const secNet = securityNetworkIssue(stream.security, stream.network)
      if (secNet) issues.push(issue(['outbounds', i, 'streamSettings'], secNet, 'error'))
      const dialer = stream.sockopt?.dialerProxy
      if (dialer !== undefined && dialer !== '' && !outboundTags.has(dialer)) {
        issues.push(
          issue(
            ['outbounds', i, 'streamSettings', 'sockopt', 'dialerProxy'],
            `dialerProxy ссылается на несуществующий outbound «${dialer}»`,
            'warning',
          ),
        )
      }
    }
    if (out.protocol === 'vless') {
      const vnext = (out.settings as { vnext?: { users?: { flow?: string }[] }[] } | undefined)?.vnext ?? []
      vnext.forEach((server, si) => {
        for (const [ui, user] of (server.users ?? []).entries()) {
          const flowIssue = flowNetworkIssue(user.flow, stream?.network)
          if (flowIssue) {
            issues.push(
              issue(
                ['outbounds', i, 'settings', 'vnext', si, 'users', ui, 'flow'],
                flowIssue,
                'error',
              ),
            )
          }
        }
      })
    }
  })

  // Правило по домену или протоколу не сработает, если inbound не снифает трафик:
  // ядро просто не узнает ни домена, ни протокола
  const blindTags = inbounds
    .filter((inb) => {
      const sniffing = inb.sniffing as { enabled?: boolean; destOverride?: string[] } | undefined
      return sniffing?.enabled !== true || (sniffing.destOverride?.length ?? 0) === 0
    })
    .map((inb) => inb.tag)

  if (blindTags.length > 0) {
    rules.forEach((rule, i) => {
      // Пустой inboundTag означает «все inbound-ы»
      const scope = rule.inboundTag?.length ? rule.inboundTag : [...inboundTags]
      const blind = scope.filter((tag) => blindTags.includes(tag))
      if (blind.length === 0) return
      const list = blind.map((t) => `«${t}»`).join(', ')
      if (rule.domain?.length) {
        issues.push(
          issue(
            ['routing', 'rules', i, 'domain'],
            `Правило матчит по домену, но на ${list} выключен sniffing — ядро не увидит домен`,
            'warning',
          ),
        )
      }
      if (rule.protocol?.length) {
        issues.push(
          issue(
            ['routing', 'rules', i, 'protocol'],
            `Правило матчит по протоколу, но на ${list} выключен sniffing — ядро не определит протокол`,
            'warning',
          ),
        )
      }
    })
  }

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
        issue([], `Некорректный JSON: ${err instanceof Error ? err.message : String(err)}`, 'error'),
      ],
    }
  }

  const parsed = XrayConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      config: raw,
      issues: parsed.error.issues.map((i) => issue(i.path as PathParts, i.message, 'error')),
    }
  }

  return { ok: true, config: raw, issues: analyzeIntegrity(parsed.data) }
}

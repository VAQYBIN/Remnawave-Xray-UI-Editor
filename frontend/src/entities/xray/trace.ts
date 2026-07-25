// Куда уйдёт трафик: правила проверяются сверху вниз, побеждает первое полностью
// совпавшее. Поля внутри правила соединяются через И, значения внутри поля — через ИЛИ.

import type { XrayConfig } from './config'
import {
  isIpAddress,
  matchDomainField,
  matchExactField,
  matchIpField,
  matchNetworkField,
  matchPortField,
  type FieldVerdict,
  type GeoAnswers,
  type IpAvailability,
  type MatchState,
  type TraceTarget,
} from './traceMatch'

export interface RuleVerdict {
  index: number
  state: MatchState
  outboundTag?: string
  balancerTag?: string
  fields: FieldVerdict[]
}

export interface TraceWinner {
  /** null — ни одно правило не совпало, сработал дефолт (первый outbound) */
  ruleIndex: number | null
  outboundTag?: string
  balancerTag?: string
}

export interface TraceResult {
  verdicts: RuleVerdict[]
  ipVerdicts?: RuleVerdict[]
  winner?: TraceWinner
  caveats: string[]
}

type Rule = {
  domain?: string[]
  ip?: string[]
  port?: string | number
  sourcePort?: string | number
  network?: string
  protocol?: string[]
  user?: string[]
  source?: string[]
  inboundTag?: string[]
  outboundTag?: string
  balancerTag?: string
}

/** Правило совпало, если совпали ВСЕ заданные поля; точный промах перевешивает неизвестное */
function combine(fields: FieldVerdict[]): MatchState {
  if (fields.some((f) => f.state === 'no')) return 'no'
  if (fields.some((f) => f.state === 'unknown')) return 'unknown'
  return 'yes'
}

function judgeRule(
  rule: Rule,
  index: number,
  target: TraceTarget,
  geo: GeoAnswers,
  ipAvailability: IpAvailability,
): RuleVerdict {
  const fields: FieldVerdict[] = []
  if (rule.domain?.length) fields.push(matchDomainField(rule.domain, target.address, geo))
  if (rule.ip?.length) fields.push(matchIpField('ip', rule.ip, target.ip, ipAvailability, geo))
  if (rule.port !== undefined) fields.push(matchPortField('port', rule.port, target.port))
  if (rule.network !== undefined) fields.push(matchNetworkField(rule.network, target.network))
  if (rule.source?.length) {
    fields.push(
      matchIpField('source', rule.source, target.sourceIp, target.sourceIp ? 'known' : 'unspecified', geo),
    )
  }
  if (rule.sourcePort !== undefined) {
    fields.push(matchPortField('sourcePort', rule.sourcePort, target.sourcePort))
  }
  if (rule.protocol?.length) {
    fields.push(
      matchExactField(
        'protocol',
        rule.protocol,
        target.protocol,
        'протокол виден только при включённом sniffing — задайте его в цели',
      ),
    )
  }
  if (rule.user?.length) {
    fields.push(matchExactField('user', rule.user, target.user, 'пользователь цели не задан'))
  }
  if (rule.inboundTag?.length) {
    fields.push(matchExactField('inboundTag', rule.inboundTag, target.inboundTag, 'inbound цели не задан'))
  }

  return {
    index,
    state: combine(fields),
    outboundTag: rule.outboundTag,
    balancerTag: rule.balancerTag,
    fields,
  }
}

function judgeAll(
  config: XrayConfig,
  target: TraceTarget,
  geo: GeoAnswers,
  ipAvailability: IpAvailability,
): RuleVerdict[] {
  const rules = (config.routing?.rules ?? []) as Rule[]
  return rules.map((rule, index) => judgeRule(rule, index, target, geo, ipAvailability))
}

function pickWinner(verdicts: RuleVerdict[], config: XrayConfig): TraceWinner | undefined {
  const hit = verdicts.find((v) => v.state === 'yes')
  if (hit) {
    return { ruleIndex: hit.index, outboundTag: hit.outboundTag, balancerTag: hit.balancerTag }
  }
  // Ни одно правило не совпало — ядро отправляет трафик в первый outbound
  const fallback = config.outbounds?.[0]?.tag
  if (fallback === undefined) return undefined
  return { ruleIndex: null, outboundTag: fallback, balancerTag: undefined }
}

export function traceRoute(config: XrayConfig, target: TraceTarget, geo: GeoAnswers): TraceResult {
  // Цель-IP не требует резолва; для доменной цели ip-условия при AsIs не применяются
  const ipAvailability: IpAvailability = isIpAddress(target.address)
    ? 'known'
    : target.ip !== undefined
      ? 'known'
      : 'never'
  const effectiveTarget: TraceTarget =
    isIpAddress(target.address) && target.ip === undefined ? { ...target, ip: target.address } : target

  const verdicts = judgeAll(config, effectiveTarget, geo, ipAvailability)
  return { verdicts, winner: pickWinner(verdicts, config), caveats: [] }
}

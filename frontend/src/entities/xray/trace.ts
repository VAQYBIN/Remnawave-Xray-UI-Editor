// Куда уйдёт трафик: правила проверяются сверху вниз, побеждает первое полностью
// совпавшее. Поля внутри правила соединяются через И, значения внутри поля — через ИЛИ.

import { balancerCandidates, findBalancer } from './balancers'
import type { XrayConfig } from './config'
import {
  describeSelector,
  hasPanelNamedTags,
  injectedTagOwners,
  injectGroupsOf,
  predictedTags,
} from './inject'
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

/** Выход, которого в конфиге физически нет: его подставит панель по группе */
export interface InjectedOutbound {
  groupIndex: number
  /** Подпись селектора для человека: describeSelector(group) */
  selector: string
  selectFrom?: string
}

export interface TraceWinner {
  /** null — ни одно правило не совпало, сработал дефолт (первый outbound) */
  ruleIndex: number | null
  outboundTag?: string
  balancerTag?: string
  /** Выходы, между которыми балансер будет выбирать; сам выбор — за ядром */
  balancerCandidates?: string[]
  balancerStrategy?: string
  /** Выход победителя подставит панель */
  injected?: InjectedOutbound
  /** Кандидаты балансера, которых подставит панель (подмножество balancerCandidates) */
  injectedTags?: string[]
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
  neverReason?: string,
): RuleVerdict {
  const fields: FieldVerdict[] = []
  if (rule.domain?.length) fields.push(matchDomainField(rule.domain, target.address, geo))
  if (rule.ip?.length) {
    fields.push(matchIpField('ip', rule.ip, target.ip, ipAvailability, geo, neverReason))
  }
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
  neverReason?: string,
): RuleVerdict[] {
  const rules = (config.routing?.rules ?? []) as Rule[]
  return rules.map((rule, index) =>
    judgeRule(rule, index, target, geo, ipAvailability, neverReason),
  )
}

/** Доклеивает к победителю кандидатов балансера; без балансера возвращает ТОТ ЖЕ объект */
function withBalancer(winner: TraceWinner, config: XrayConfig): TraceWinner {
  if (!winner.balancerTag) return winner
  const balancer = findBalancer(config, winner.balancerTag)
  if (!balancer) return winner
  return {
    ...winner,
    balancerCandidates: balancerCandidates(config, balancer),
    balancerStrategy: balancer.strategy?.type ?? 'random',
  }
}

/** Помечает победителя, чей выход или кандидаты придут из подстановки */
function withInject(winner: TraceWinner, config: XrayConfig): TraceWinner {
  const groups = injectGroupsOf(config)
  if (groups.length === 0) return winner
  const owners = injectedTagOwners(config)
  const next = { ...winner }
  const owner = winner.outboundTag !== undefined ? owners.get(winner.outboundTag) : undefined
  if (owner !== undefined) {
    next.injected = {
      groupIndex: owner,
      selector: describeSelector(groups[owner]!),
      selectFrom: groups[owner]!.selectFrom,
    }
  }
  const injectedCandidates = (winner.balancerCandidates ?? []).filter((t) => owners.has(t))
  if (injectedCandidates.length > 0) next.injectedTags = injectedCandidates
  return next
}

function pickWinner(verdicts: RuleVerdict[], config: XrayConfig): TraceWinner | undefined {
  const hit = verdicts.find((v) => v.state === 'yes')
  if (hit) {
    return withInject(
      withBalancer(
        { ruleIndex: hit.index, outboundTag: hit.outboundTag, balancerTag: hit.balancerTag },
        config,
      ),
      config,
    )
  }
  // Панель вставляет инжектируемые outbound'ы в НАЧАЛО массива, поэтому в шаблоне
  // подписки дефолтом становится первый подставленный сервер, а не outbounds[0].
  // Группа-победитель известна безусловно (это первая группа), а вот её тег — не
  // всегда: для схемы `panel` он неизвестен заранее, поэтому injected ставим
  // напрямую, а не через withInject (та ищет владельца по outboundTag и для
  // схемы `panel` ничего бы не нашла).
  const groups = injectGroupsOf(config)
  if (groups.length > 0) {
    const first = groups[0]!
    return {
      ruleIndex: null,
      outboundTag: predictedTags(first)[0],
      balancerTag: undefined,
      injected: {
        groupIndex: 0,
        selector: describeSelector(first),
        selectFrom: first.selectFrom,
      },
    }
  }
  // Ни одно правило не совпало и групп подстановки нет — ядро отправляет трафик в первый outbound
  const fallback = config.outbounds?.[0]?.tag
  if (fallback === undefined) return undefined
  return { ruleIndex: null, outboundTag: fallback, balancerTag: undefined }
}

/** Все geo-ключи, встречающиеся в правилах. Экспортируется: этап 2 спросит по ним бэкенд. */
export function geoKeysOf(config: XrayConfig): string[] {
  const rules = (config.routing?.rules ?? []) as Rule[]
  const keys: string[] = []
  for (const rule of rules) {
    for (const value of rule.domain ?? []) if (value.startsWith('geosite:')) keys.push(value)
    for (const value of [...(rule.ip ?? []), ...(rule.source ?? [])]) {
      if (value.startsWith('geoip:')) keys.push(value)
    }
  }
  return keys
}

/** Снифер выключен или ничего не переопределяет — домена и протокола ядро не увидит */
function sniffingBlind(config: XrayConfig, inboundTag: string | undefined): boolean {
  if (inboundTag === undefined) return false
  const inbound = (config.inbounds ?? []).find((i) => i.tag === inboundTag)
  if (!inbound) return false
  const sniffing = inbound.sniffing as { enabled?: boolean; destOverride?: string[] } | undefined
  return sniffing?.enabled !== true || (sniffing.destOverride?.length ?? 0) === 0
}

function collectCaveats(
  config: XrayConfig,
  target: TraceTarget,
  geo: GeoAnswers,
  verdicts: RuleVerdict[],
  winner: TraceWinner | undefined,
  strategy: string,
): string[] {
  const caveats: string[] = []

  const winnerIndex = winner?.ruleIndex ?? verdicts.length
  const unknownAbove = verdicts.filter((v) => v.state === 'unknown' && v.index < winnerIndex)
  if (unknownAbove.length > 0) {
    const numbers = unknownAbove.map((v) => `#${v.index + 1}`).join(', ')
    caveats.push(
      `Правила ${numbers} зависят от данных, которых нет, и стоят выше победителя — реальный маршрут может отличаться.`,
    )
  }

  const geoKeys = geoKeysOf(config)
  if (geoKeys.length > 0 && !geo.loaded) {
    caveats.push('Geo-базы не загружены: вердикты по geosite:/geoip: неизвестны.')
  }
  for (const key of geo.missing) {
    caveats.push(`Категории «${key}» нет в загруженной базе — ядро отвергнет такой конфиг.`)
  }

  const needsSniffing = verdicts.some((v) =>
    v.fields.some((f) => f.field === 'domain' || f.field === 'protocol'),
  )
  if (needsSniffing && sniffingBlind(config, target.inboundTag)) {
    caveats.push(
      `На inbound «${target.inboundTag}» выключен sniffing — ядро не увидит домен и протокол, условия по ним не сработают.`,
    )
  }

  if (strategy === 'IPIfNonMatch' && target.ip === undefined && !isIpAddress(target.address)) {
    caveats.push(
      'Стратегия IPIfNonMatch делает второй проход по разрешённому адресу — укажите IP назначения, чтобы увидеть его.',
    )
  }

  const groups = injectGroupsOf(config)
  if (groups.length > 0 && winner?.ruleIndex === null) {
    caveats.push(
      'Ни одно правило не совпало. В шаблоне подписки дефолтом становится не первый outbound из документа: панель вставляет подставленные серверы в начало массива, и трафик уйдёт в первый из них.',
    )
  }
  if (winner?.injected) {
    caveats.push(
      `Выход подставит панель по группе «${winner.injected.selector}» (пул ${winner.injected.selectFrom ?? 'HIDDEN'}) — в самом документе такого outbound'а нет.`,
    )
  }
  if (winner?.injectedTags?.length) {
    caveats.push(
      `Кандидаты ${winner.injectedTags.join(', ')} предсказаны по префиксу: сколько серверов подставится на самом деле, знает только панель.`,
    )
  }
  if (groups.length > 0 && hasPanelNamedTags(config)) {
    caveats.push(
      'Часть групп именует выходы по примечанию или тегу хоста — такие теги предсказать нельзя, и связи по ним показаны не полностью.',
    )
  }

  // Балансер выбирает выход по замерам в рантайме — редактор знает только список
  if (winner?.balancerTag) {
    const candidates = winner.balancerCandidates ?? []
    if (candidates.length === 0) {
      caveats.push(
        `У балансера «${winner.balancerTag}» нет кандидатов: трафик уйдёт в запасной выход либо будет отброшен.`,
      )
    } else {
      caveats.push(
        `Балансер «${winner.balancerTag}» (${winner.balancerStrategy}) выберет один из выходов: ${candidates.join(', ')} — конкретный выбирает ядро в рантайме по замерам.`,
      )
    }
  }

  return caveats
}

export function traceRoute(config: XrayConfig, target: TraceTarget, geo: GeoAnswers): TraceResult {
  const strategy = config.routing?.domainStrategy ?? 'AsIs'
  const targetIsIp = isIpAddress(target.address)
  const effectiveTarget: TraceTarget =
    targetIsIp && target.ip === undefined ? { ...target, ip: target.address } : target

  // AsIs: ядро не резолвит домен, ip-условия по доменной цели не применяются.
  // IPOnDemand: резолв происходит на первом же ip-условии, поэтому адрес доступен сразу.
  const firstPassIp: IpAvailability =
    targetIsIp || strategy === 'IPOnDemand'
      ? effectiveTarget.ip === undefined
        ? 'unspecified'
        : 'known'
      : 'never'

  // Причина отказа ip-условия должна называть ту стратегию, что стоит в конфиге
  const neverReason =
    strategy === 'IPIfNonMatch'
      ? 'на первом проходе домен ещё не разрешён в адрес; укажите IP назначения, чтобы увидеть второй проход'
      : 'стратегия домена AsIs: ядро не резолвит домен, поэтому ip-условия не применяются'

  const verdicts = judgeAll(config, effectiveTarget, geo, firstPassIp, neverReason)
  let winner = pickWinner(verdicts, config)
  let ipVerdicts: RuleVerdict[] | undefined

  // IPIfNonMatch: если по домену никто не совпал — повторяем проход по адресу
  const noRuleMatched = !verdicts.some((v) => v.state === 'yes')
  if (strategy === 'IPIfNonMatch' && noRuleMatched && effectiveTarget.ip !== undefined) {
    ipVerdicts = judgeAll(config, effectiveTarget, geo, 'known')
    winner = pickWinner(ipVerdicts, config)
  }

  const caveats = collectCaveats(config, effectiveTarget, geo, ipVerdicts ?? verdicts, winner, strategy)
  return { verdicts, ipVerdicts, winner, caveats }
}

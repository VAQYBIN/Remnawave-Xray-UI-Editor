// Трассировка маршрута: куда уйдёт запрос к заданной цели. Правила проверяются
// сверху вниз, побеждает ПЕРВОЕ совпавшее — как у Xray и у Mihomo.
//
// Правило честности то же, что у Mihomo: разбор ОСТАНАВЛИВАЕТСЯ на правиле,
// условие которого проверить нечем, и прямо называет причину. Молчаливый
// пропуск дал бы уверенный неверный ответ — всё, что стоит ниже, выполняется
// ровно при условии, что непроверяемое правило не совпало, а этого мы не знаем.
// По той же причине правила ниже остановки не попадают и в `verdicts`: их
// состояние неизвестно не потому, что они не совпали, а потому, что до них не
// дошли.
//
// Семантика domain_suffix взята из исходников ядра (SagerNet/sing,
// common/domain/matcher.go), а не из документации: документация говорит лишь
// «Match domain suffix». Без ведущей точки совпадение идёт по границе метки и
// включает сам домен; с ведущей точкой — обычный строковый суффикс, и сам домен
// уже не совпадает.
//
// Арифметика адресов и подсетей — общая с Xray и Mihomo
// (`entities/xray/traceMatch`). Своя копия разбора IPv4/IPv6 была бы второй
// реализацией одного и того же и разошлась бы с первой на первом же IPv6.

import { ipInCidr, isIpAddress, type MatchState, type TraceTarget } from '../xray/traceMatch'
import { defaultRoute } from './outbounds'
import {
  CHECKABLE_CONDITIONS,
  NON_TERMINAL_ACTIONS,
  conditionKeysOf,
  isLogicalRule,
  ruleAction,
  ruleTarget,
  rulesOf,
} from './rules'
import type { SingboxDoc, SingboxRule } from './types'

export interface SingboxRuleVerdict {
  index: number
  state: MatchState
  /** У 'unknown' причина обязательна: без неё остановка необъяснима */
  reason?: string
  target?: string
}

/** Куда уйдёт трафик; ruleIndex === null — ни одно правило не совпало */
export interface SingboxTraceWinner {
  ruleIndex: number | null
  target: string
}

/**
 * Правило, на котором проход остановлен: проверить его редактор не может.
 * `index === null` — остановка не на правиле, а до списка или после него:
 * цель не задана вовсе либо маршрут по умолчанию из документа не выводится.
 * Тот же приём, что и у `ruleIndex` победителя: null значит «не правило списка».
 */
export interface SingboxTraceStop {
  index: number | null
  reason: string
}

/**
 * Исход прохода — РОВНО одно из двух, и это сказано типом, а не соглашением.
 * Победитель есть всегда, кроме остановки: список, пройденный до конца без
 * совпадений, получает дефолтный выход, а документ, из которого дефолт не
 * выводится, честно останавливается. Поэтому «ни того, ни другого» не бывает, а
 * «оба сразу» не бывает тем более: ниже остановки не выполняется ничего.
 *
 * Бриф задачи описывал оба поля просто необязательными — такой тип разрешает все
 * четыре сочетания, включая невозможные. Расплачивался бы за это интерфейс:
 * мёртвой защитной веткой, которая читается как поддержанный сценарий, и —
 * хуже — правом вывести победителя, не спросив об остановке. Уверенный неверный
 * ответ там, где весь смысл разбора в честном «не знаю».
 */
export type SingboxTraceOutcome =
  | { winner: SingboxTraceWinner; stopped?: never }
  | { winner?: never; stopped: SingboxTraceStop }

export type SingboxTraceResult = {
  verdicts: SingboxRuleVerdict[]
  caveats: string[]
} & SingboxTraceOutcome

/** Результат проверки одного условия; у 'unknown' причина обязательна */
interface Cond {
  state: MatchState
  reason?: string
}

const YES: Cond = { state: 'yes' }
const NO: Cond = { state: 'no' }

/**
 * Цель трассировки в том виде, в каком её видит разбор условий.
 *
 * Снаружи она приходит общим `TraceTarget` — тем же, что заполняет `TraceBar` и
 * читают трассировки Xray и Mihomo. План 1 завёл здесь свою голую строку, и с
 * ней `port`/`port_range` вынужденно останавливали проход, хотя спека числит их
 * проверяемыми. Вторая форма цели рядом с общей была расхождением, а не
 * упрощением.
 */
interface Ctx {
  /** Имя запроса; пусто, если цель задана адресом */
  host: string
  /** Адрес назначения: сама цель, если это IP, либо поле «IP назначения» */
  ip: string | undefined
  port: number
  network: 'tcp' | 'udp'
  /** Может ли ядро узнать домен запроса, которого в цели нет */
  sniffs: boolean
}

function contextOf(doc: SingboxDoc, target: TraceTarget): Ctx {
  const address = target.address.trim()
  const targetIsIp = isIpAddress(address)
  return {
    host: targetIsIp ? '' : address,
    // IP берётся из цели, если она сама адрес, иначе из поля, которое заполнил
    // пользователь: домены сервер не резолвит, и выдумывать адрес нельзя
    ip: targetIsIp ? address : target.ip?.trim() || undefined,
    port: target.port,
    network: target.network,
    sniffs: documentSniffs(doc),
  }
}

/** `1000:2000`, `:2000`, `1000:` — форма ядра (sing-box, route rule port_range) */
function parsePortRange(raw: string): { from: number; to: number } | null {
  const at = raw.indexOf(':')
  if (at < 0) return null
  const from = raw.slice(0, at).trim()
  const to = raw.slice(at + 1).trim()
  const lo = from === '' ? 0 : Number(from)
  const hi = to === '' ? 65535 : Number(to)
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) return null
  return { from: lo, to: hi }
}

function values(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v))
  if (raw === undefined || raw === null) return []
  return [String(raw)]
}

/** Совпадение по границе метки: `example.com` ловит и сам домен, и поддомены */
function matchesSuffix(target: string, suffix: string): boolean {
  if (suffix.startsWith('.')) return target.endsWith(suffix)
  return target === suffix || target.endsWith(`.${suffix}`)
}

/**
 * Подсети, адреса из которых ядро приватными и считает: `ip_is_private`
 * спрашивает `IsPublicAddr` (sing, common/network), а тот складывает предикаты
 * `netip.Addr` — private, loopback, link-local (unicast и multicast),
 * interface-local multicast и unspecified. Перечислять их подсетями дешевле, чем
 * повторять предикаты: арифметика уже есть в `ipInCidr`, и v6 она считает так же,
 * как v4. Проверять по префиксу строки нельзя вовсе — «10.» поймал бы «10.0.0.1»
 * и не поймал бы «::ffff:10.0.0.1», а `fd00::1` не поймал бы ничего.
 */
const PRIVATE_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '224.0.0.0/24',
  '0.0.0.0/32',
  '::1/128',
  '::/128',
  'fc00::/7',
  'fe80::/10',
  'ff01::/16',
  'ff02::/16',
]

/**
 * Домённое условие против цели-адреса. Ядро в этом случае сравнивать нечего и
 * возвращает false (`route/rule/rule_item_domain.go`: пустой domainHost — сразу
 * `return false`), поэтому обычный ответ здесь «нет», а не остановка: иначе
 * трассировка адреса упиралась бы в первое же домённое правило, а их в живых
 * шаблонах десятки подряд.
 *
 * Но домен в метаданных может ВЗЯТЬСЯ — если документ включает сниффинг, ядро
 * вычитает имя из SNI или заголовка Host уже в работе. Какое это будет имя,
 * редактор не знает по определению: в цели его не вводили.
 */
function domainAgainstIp(ctx: Ctx): Cond {
  if (!ctx.sniffs) return NO
  return {
    state: 'unknown',
    reason:
      'цель задана адресом, а документ включает сниффинг: какое имя ядро вычитает из запроса, редактору неизвестно',
  }
}

/**
 * Условие по адресу назначения, когда цель — домен, а поле «IP назначения» в
 * цели пусто. Причина называет и выход из положения: адрес домену даст DNS уже
 * в работе, но пользователь может вписать его сам — сервер домены не резолвит.
 */
function ipAgainstDomain(key: string): Cond {
  return {
    state: 'unknown',
    reason: `условие «${key}» смотрит на адрес назначения: домену его даст DNS уже в работе, а поле «IP назначения» в цели не заполнено`,
  }
}

function checkCondition(ctx: Ctx, key: string, raw: unknown): Cond {
  if (!CHECKABLE_CONDITIONS.has(key)) return { state: 'unknown', reason: reasonFor(key, raw) }

  switch (key) {
    case 'domain':
      if (ctx.host === '') return domainAgainstIp(ctx)
      return values(raw).includes(ctx.host) ? YES : NO
    case 'domain_suffix':
      if (ctx.host === '') return domainAgainstIp(ctx)
      return values(raw).some((s) => matchesSuffix(ctx.host, s)) ? YES : NO
    case 'domain_keyword':
      if (ctx.host === '') return domainAgainstIp(ctx)
      return values(raw).some((s) => ctx.host.includes(s)) ? YES : NO
    case 'domain_regex': {
      if (ctx.host === '') return domainAgainstIp(ctx)
      for (const pattern of values(raw)) {
        try {
          if (new RegExp(pattern).test(ctx.host)) return YES
        } catch {
          // Выражение автора шаблона может быть невалидным для JS — это не повод
          // падать и не повод считать промахом
          return { state: 'unknown', reason: `выражение «${pattern}» не разбирается как регулярное` }
        }
      }
      return NO
    }
    case 'ip_cidr': {
      const ip = ctx.ip
      if (ip === undefined) return ipAgainstDomain(key)
      const cidrs = values(raw)
      let sawUsable = false
      for (const cidr of cidrs) {
        const hit = ipInCidr(ip, cidr)
        // Неразбираемую подсеть пропускаем, но помним: если разобралась хоть
        // одна, «нет» честное — остальные ядро отвергнет вместе с документом
        if (hit === null) continue
        sawUsable = true
        if (hit) return YES
      }
      if (sawUsable) return NO
      return {
        state: 'unknown',
        reason:
          cidrs.length === 0
            ? `у условия «${key}» не задано ни одной подсети`
            : `ни одна подсеть условия «${key}» не разбирается: ${cidrs.join(', ')}`,
      }
    }
    case 'ip_is_private': {
      // Осмысленное значение здесь ровно одно. `false` ядро, судя по
      // `omitempty` и виду поля, просто не превращает в условие — но «просто не
      // превращает» и «требует публичный адрес» дают ПРОТИВОПОЛОЖНЫЕ ответы, а
      // выбрать между ними по документу нельзя
      if (raw !== true) {
        return {
          state: 'unknown',
          reason: `у ключа «${key}» значение не true: выключено оно или требует публичный адрес — по документу не определить`,
        }
      }
      const ip = ctx.ip
      if (ip === undefined) return ipAgainstDomain(key)
      return PRIVATE_RANGES.some((cidr) => ipInCidr(ip, cidr) === true) ? YES : NO
    }
    case 'port':
      return values(raw).some((p) => Number(p) === ctx.port) ? YES : NO
    case 'port_range': {
      const ranges = values(raw)
      let usable = false
      for (const range of ranges) {
        const parsed = parsePortRange(range)
        if (parsed === null) continue
        usable = true
        if (ctx.port >= parsed.from && ctx.port <= parsed.to) return YES
      }
      if (usable) return NO
      // Неразбираемый диапазон — это не промах: ядро отвергнет такой документ
      // вместе с правилом, и делать вид, что правило не совпало, значит дать
      // уверенный ответ по строке, смысла которой мы не знаем
      return {
        state: 'unknown',
        reason:
          ranges.length === 0
            ? `у условия «${key}» не задано ни одного диапазона`
            : `диапазон портов «${ranges.join(', ')}» не разбирается`,
      }
    }
    case 'network':
      return values(raw).some((n) => n === ctx.network) ? YES : NO
    default:
      return { state: 'unknown', reason: reasonFor(key, raw) }
  }
}

/**
 * Почему условие непроверяемо. Текст видит человек, который смотрит на своё
 * правило и не понимает, почему редактор молчит, — поэтому он называет, ЧЕГО
 * редактор не знает, а не «проверить не удалось».
 */
function reasonFor(key: string, raw: unknown): string {
  if (key === 'rule_set') {
    const names = values(raw)
    const list = names.length === 0 ? '' : ` (${names.join(', ')})`
    return `содержимое набора правил${list} редактор не читает — что в нём, знает только клиент`
  }
  const named: Record<string, string> = {
    clash_mode: 'режим выбирается в клиенте, а не в документе',
    inbound: 'зависит от того, каким входом пришло соединение',
    protocol: 'протокол определяется сниффингом уже в работе',
    client: 'клиент определяется сниффингом уже в работе',
  }
  const exact = named[key]
  if (exact !== undefined) return exact
  if (key.startsWith('process_') || key === 'package_name') return 'зависит от процесса на устройстве'
  if (key.startsWith('source_')) return 'зависит от источника соединения'
  if (key.startsWith('wifi_')) return 'зависит от сети Wi-Fi на устройстве'
  if (key.startsWith('user')) return 'зависит от пользователя соединения'
  if (key.startsWith('network_')) return 'зависит от типа сети на устройстве'
  // Незнакомое условие называется незнакомым, а не подводится под догадку по
  // префиксу имени: `ip_version` и `ip_accept_any` — про адрес, но сравнивают
  // разное, и общая формулировка соврала бы об одном из них
  return `условие «${key}» редактору незнакомо`
}

/** «И» по всем условиям правила: точное «нет» перевешивает неизвестность */
function judge(ctx: Ctx, rule: SingboxRule): Cond {
  if (isLogicalRule(rule)) return judgeLogical(ctx, rule)

  let unknown: string | undefined
  for (const key of conditionKeysOf(rule)) {
    const res = checkCondition(ctx, key, rule[key])
    if (res.state === 'no') return applyInvert(rule, NO)
    if (res.state === 'unknown' && unknown === undefined) unknown = res.reason
  }
  if (unknown !== undefined) return { state: 'unknown', reason: unknown }
  // Правило без единого условия совпадает со всем — так его понимает и ядро
  return applyInvert(rule, YES)
}

/**
 * Логическое правило. Неизвестность пробрасывается наружу и останавливает
 * проход, КРОМЕ случая, когда ответ определён при любом её значении. Такой
 * случай ровно один на режим, и они разные:
 *   `and(нет, неизвестно)` = нет — точный промах решает;
 *   `or (да,  неизвестно)` = да  — точное совпадение решает.
 * Обратные пары решения НЕ дают: `or(нет, неизвестно)` — это неизвестно, а не
 * «нет».
 */
function judgeLogical(ctx: Ctx, rule: SingboxRule): Cond {
  const nested = Array.isArray(rule.rules) ? rule.rules : []
  if (nested.length === 0) {
    return { state: 'unknown', reason: 'у логического правила нет вложенных условий' }
  }
  // Значение по умолчанию — то же, что у ядра: без `mode` документ невалиден, но
  // считать такое правило «или» значило бы расширить его, а «и» — сузить
  const mode = rule.mode === 'or' ? 'or' : 'and'

  let unknown: string | undefined
  for (const inner of nested) {
    const res = judge(ctx, inner as SingboxRule)
    if (mode === 'and' && res.state === 'no') return applyInvert(rule, NO)
    if (mode === 'or' && res.state === 'yes') return applyInvert(rule, YES)
    if (res.state === 'unknown' && unknown === undefined) unknown = res.reason
  }
  if (unknown !== undefined) return { state: 'unknown', reason: unknown }
  return applyInvert(rule, mode === 'and' ? YES : NO)
}

/** Инвертируется только определённый ответ: отрицать непроверенное нечем */
function applyInvert(rule: SingboxRule, res: Cond): Cond {
  if (rule.invert !== true || res.state === 'unknown') return res
  return res.state === 'yes' ? NO : YES
}

/**
 * Может ли ядро узнать домен запроса, которого в цели нет. Записей две: действие
 * `sniff` в правилах маршрута (нынешняя форма) и поле `sniff` у входа (прежняя,
 * ею полны живые шаблоны). Достаточно любой: обе дают ядру имя из запроса.
 */
function documentSniffs(doc: SingboxDoc): boolean {
  if (rulesOf(doc).some((rule) => ruleAction(rule) === 'sniff')) return true
  const inbounds = Array.isArray(doc.inbounds) ? doc.inbounds : []
  return inbounds.some((inbound) => inbound.sniff === true)
}

export function traceSingbox(doc: SingboxDoc, target: TraceTarget): SingboxTraceResult {
  const verdicts: SingboxRuleVerdict[] = []
  const caveats: string[] = []
  if (target.address.trim() === '') {
    // Ответить «пойдёт по умолчанию» было бы уверенным ответом на незаданный
    // вопрос: пустая строка не промахивается мимо правил, она их не спрашивает
    return {
      verdicts,
      caveats,
      stopped: { index: null, reason: 'цель трассировки не задана — о каком запросе спрашивают, неизвестно' },
    }
  }
  const ctx = contextOf(doc, target)

  for (const [index, rule] of rulesOf(doc).entries()) {
    const res = judge(ctx, rule)

    if (res.state === 'unknown') {
      const reason = res.reason ?? 'условие правила проверить нечем'
      verdicts.push({ index, state: 'unknown', reason })
      return { verdicts, caveats, stopped: { index, reason } }
    }

    if (res.state === 'no') {
      verdicts.push({ index, state: 'no' })
      continue
    }

    // Совпало. Нетерминальное действие выход не выбирает — идём дальше
    const action = ruleAction(rule)
    if (NON_TERMINAL_ACTIONS.has(action)) {
      verdicts.push({ index, state: 'yes', reason: `действие ${action} выход не выбирает` })
      continue
    }

    // У route выход назван полем всегда. У bypass поле то же самое, но
    // необязательное (`configuration/route/rule_action`): с ним bypass ведёт
    // туда же, куда и route, без него winner — имя действия, как у reject и
    // hijack-dns. `ruleTarget` для bypass не годится — она признаёт выходом
    // только route, здесь читаем поле напрямую
    const bypassTarget = action === 'bypass' && typeof rule.outbound === 'string' ? rule.outbound : undefined
    const winner = action === 'route' ? ruleTarget(rule) : (bypassTarget ?? action)
    if (winner === undefined) {
      const reason = 'правило совпало, но выход у него не указан — куда уйдёт трафик, из документа не следует'
      verdicts.push({ index, state: 'unknown', reason })
      return { verdicts, caveats, stopped: { index, reason } }
    }
    verdicts.push({ index, state: 'yes', target: winner })
    return { verdicts, caveats, winner: { ruleIndex: index, target: winner } }
  }

  const fallback = defaultRoute(doc)
  if (fallback.tag === undefined) {
    return {
      verdicts,
      caveats,
      stopped: {
        index: null,
        reason:
          'ни одно правило не совпало, route.final не задан, а первый выход списка без тега — назвать маршрут по умолчанию нечем',
      },
    }
  }
  if (!fallback.fromFinal) {
    caveats.push(
      `route.final не задан, поэтому ядро возьмёт первый выход списка — «${fallback.tag}». Любая перестановка outbounds меняет этот ответ.`,
    )
  }
  return { verdicts, caveats, winner: { ruleIndex: null, target: fallback.tag } }
}

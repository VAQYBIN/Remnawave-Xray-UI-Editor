// Куда уйдёт домен или адрес по правилам шаблона Mihomo: список проверяется
// сверху вниз, побеждает ПЕРВОЕ совпавшее правило — как в Xray.
//
// Отличие от трассировки Xray — в границе честности. Правило, которое редактор
// проверить не может (условие по источнику или входу, набор правил, который не
// удалось загрузить, правило по процессу, когда процесс в цели не указан),
// ОСТАНАВЛИВАЕТ проход, а не пропускается. Пропустить его значило
// бы соврать: всё, что стоит ниже, выполняется ровно при условии, что
// непроверяемое правило не совпало, — а этого условия мы не знаем. По той же
// причине в `verdicts` не попадают правила ниже остановки: их состояние
// неизвестно не потому, что они не совпали, а потому, что до них не дошли.
//
// Ниже ПОБЕДИТЕЛЯ список тоже обрывается, и здесь причина другая — размер. У
// Xray правил в конфиге единицы, и показать их все полезно; у mihomo списки
// живых шаблонов — 40–200 строк, почти целиком из `RULE-SET`, и хвост в две
// сотни серых строк превратил бы панель разбора в шум. Подписать их «не
// проверялось» было бы честно, но не помогло бы: читать всё равно нечего.
//
// Предикаты полей общие с Xray (`entities/xray/traceMatch`): geo-данные те же, а
// второй разбор CIDR был бы второй копией той же арифметики. Своё здесь —
// шаблоны доменов (у Mihomo свой синтаксис) и разбор правила-строки.

import { isScalar, isSeq } from 'yaml'
import {
  ipInCidr,
  isIpAddress,
  matchPortField,
  type GeoAnswers,
  type MatchState,
  type TraceTarget,
} from '../xray/traceMatch'
import { ruleProvidersOf, subRuleEntries } from './groups'
import type { MihomoDoc } from './parse'
import { resolveTarget } from './resolve'
import { parseRule, rulesOf, splitTopLevel, RULE_TYPES, type MihomoRule } from './rules'

export interface MihomoRuleVerdict {
  index: number
  state: MatchState
  target?: string
  /** Почему правило не проверено (state === 'unknown') */
  reason?: string
}

export interface MihomoTraceResult {
  verdicts: MihomoRuleVerdict[]
  /** ruleIndex === null — ни одно правило не совпало и MATCH в списке нет */
  winner?: { ruleIndex: number | null; target: string }
  /** Правило, на котором проход остановлен: проверить его редактор не может */
  stopped?: { index: number; reason: string }
  caveats: string[]
}

/** Условие правила: тип и значение — то же, из чего состоит и само правило */
interface Cond {
  type: string
  payload?: string
}

/**
 * Ответ бэкенда по одному набору правил. Форма — ровно та, что отдаёт
 * `backend/src/ruleset/service.ts`: `domain` и `ipcidr` считаются там (декодеры
 * бора и диапазонов есть только на сервере), а `classical` приезжает строками,
 * потому что это правила Mihomo и их вычислитель — здесь.
 */
export type RuleSetAnswer =
  | { state: 'yes' | 'no'; count: number }
  | { state: 'lines'; lines: string[]; count: number }
  | { state: 'unavailable'; reason: string }

export interface RuleSetAnswers {
  answers: Record<string, RuleSetAnswer>
  /** Ответы ещё едут: это «пока не знаем», а не «недоступен» */
  pending: boolean
}

const NO_RULE_SETS: RuleSetAnswers = { answers: {}, pending: false }

/** Условие без цели: то, из чего состоит и правило, и строка набора classical */
interface ConditionLike {
  type: string
  payload?: string
  modifiers: string[]
}

/** Ядро отвергает эти типы внутри classical при разборе набора */
const FORBIDDEN_IN_CLASSICAL = new Set(['MATCH', 'RULE-SET', 'SUB-RULE'])

/** Результат проверки условия; у 'unknown' причина обязательна */
interface CondResult {
  state: MatchState
  reason?: string
}

/** Вердикт целого правила: у совпавшего есть цель, у непроверяемого — причина */
interface Judged extends CondResult {
  target?: string
  /** Имя подсписка, из которого пришла цель, — для оговорки */
  via?: string
}

const YES: CondResult = { state: 'yes' }
const NO: CondResult = { state: 'no' }

/**
 * Цель, которая не заканчивает маршрут: правило с ней СЧИТАЕТСЯ совпавшим, но
 * его ветка пропускается, и разбор продолжается со следующих правил. Объявлять
 * такое правило победителем значило бы дать уверенный неверный ответ — ровно то,
 * ради запрета чего в этой трассировке заведена остановка.
 */
const PASS_TARGET = 'PASS'

/**
 * Типы, которые редактор знает, но проверить не может: этих данных в цели
 * трассировки нет и взять их неоткуда. Список выводится из `RULE_TYPES`, а не
 * переписывается руками: новый тип ядра, добавленный в модель, попадёт сюда сам
 * и в худшем случае остановит проход — то есть промолчит вместо того, чтобы
 * соврать «не совпало».
 */
const NO_DATA_TYPES = new Set<string>(
  RULE_TYPES.filter(
    (t) =>
      t === 'IP-SUFFIX' ||
      t === 'IP-ASN' ||
      t === 'UID' ||
      t === 'DSCP' ||
      t.startsWith('SRC-') ||
      t.startsWith('IN-'),
  ),
)

/*
 * Правила по процессу. Семантика взята из `rules/common/process.go` и
 * `component/wildcard/wildcard.go`, а не из документации: точные типы сравнивают
 * целиком через `strings.EqualFold`, `-WILDCARD` — через `wildcard.Match` с
 * обеими сторонами в нижнем регистре, `-REGEX` — через `regexp2` с флагом
 * IgnoreCase, и это ПОИСК ПОДСТРОКИ, а не совпадение целиком.
 *
 * Имя и путь у ядра — РАЗНЫЕ поля метаданных соединения, а поле формы одно.
 * Разводим их по введённому значению (см. `processCond`): вывести путь из имени
 * нельзя, а подставить догадку значило бы дать уверенный неверный ответ.
 */
const PROCESS_PATH_TYPES = new Set(['PROCESS-PATH', 'PROCESS-PATH-WILDCARD', 'PROCESS-PATH-REGEX'])
const PROCESS_NAME_TYPES = new Set(['PROCESS-NAME', 'PROCESS-NAME-WILDCARD', 'PROCESS-NAME-REGEX'])

/** `*` — ноль и больше символов, `?` — ровно один, совпадение целиком */
function wildcardMatch(pattern: string, value: string): boolean {
  let p = 0
  let i = 0
  let star = -1
  let mark = 0
  while (i < value.length) {
    const c = pattern[p]
    if (p < pattern.length && (c === '?' || c === value[i])) {
      p++
      i++
      continue
    }
    if (p < pattern.length && c === '*') {
      star = p
      mark = i
      p++
      continue
    }
    if (star !== -1) {
      p = star + 1
      mark++
      i = mark
      continue
    }
    return false
  }
  while (p < pattern.length && pattern[p] === '*') p++
  return p === pattern.length
}

function matchProcess(type: string, pattern: string, value: string): CondResult {
  if (type.endsWith('-REGEX')) {
    let re: RegExp
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      return {
        state: 'unknown',
        reason: `выражение «${pattern}» не разбирается как регулярное`,
      }
    }
    // Не заякорено намеренно: ядро зовёт MatchString, а это поиск подстроки
    return re.test(value) ? YES : NO
  }
  if (type.endsWith('-WILDCARD')) {
    return wildcardMatch(pattern.toLowerCase(), value.toLowerCase()) ? YES : NO
  }
  return pattern.toLowerCase() === value.toLowerCase() ? YES : NO
}

function processCond(ctx: Ctx, type: string, payload: string): CondResult {
  const raw = ctx.target.process?.trim()
  if (raw === undefined || raw === '') {
    return {
      state: 'unknown',
      reason: `условие «${type}» проверяется по процессу — укажите его в цели трассировки`,
    }
  }
  // Разделитель отличает путь от имени: имя и путь у ядра — РАЗНЫЕ поля
  const isPath = raw.includes('/') || raw.includes('\\')
  if (PROCESS_PATH_TYPES.has(type)) {
    if (!isPath) {
      return {
        state: 'unknown',
        reason: `условие «${type}» сравнивает путь процесса, а в цели указано только имя`,
      }
    }
    return matchProcess(type, payload, raw)
  }
  const name = isPath ? (raw.split(/[\\/]/).pop() ?? raw) : raw
  return matchProcess(type, payload, name)
}

/**
 * Логическое правило прячет условия в скобках: `AND,((DOMAIN,a),(NETWORK,udp)),T`.
 * Разбираем ровно один уровень: внешние скобки снимаются, содержимое режется по
 * запятым ВЕРХНЕГО уровня (splitTopLevel уже умеет считать глубину), каждый
 * кусок — это `(ТИП,значение)`. Вложенные логические условия внутри логических
 * встречаются, и рекурсия здесь бесплатна: тот же разбор на элементе.
 */
function parseConditions(payload: string): Cond[] | null {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null
  const inner = trimmed.slice(1, -1)
  const parts = splitTopLevel(inner).map((p) => p.trim())
  const out: Cond[] = []
  for (const part of parts) {
    const cond = parseOneCondition(part)
    if (cond === null) return null
    out.push(cond)
  }
  return out
}

/**
 * Одно условие в скобках: `(NETWORK,udp)`. Отдельно от `parseConditions`, потому
 * что у SUB-RULE условие ровно одно и уровень скобок у него ОДИН, а не два.
 */
function parseOneCondition(text: string): Cond | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null
  const [type, ...rest] = splitTopLevel(trimmed.slice(1, -1))
  if (type === undefined || type.trim() === '') return null
  return { type: type.trim(), payload: rest.join(',') || undefined }
}

/** Все метасимволы регулярного выражения, включая обе подстановки шаблона домена */
const RE_META = /[.*+?^${}()|[\]\\]/g

function escapeRe(value: string): string {
  return value.replace(RE_META, '\\$&')
}

/** Домен по шаблону конкретного типа правила Mihomo */
function matchDomain(type: string, pattern: string, address: string): MatchState {
  const a = address.toLowerCase()
  const p = pattern.toLowerCase()
  if (type === 'DOMAIN') return a === p ? 'yes' : 'no'
  if (type === 'DOMAIN-SUFFIX') return a === p || a.endsWith(`.${p}`) ? 'yes' : 'no'
  if (type === 'DOMAIN-KEYWORD') return a.includes(p) ? 'yes' : 'no'
  if (type === 'DOMAIN-WILDCARD') {
    // Подстановки ядра здесь ровно две: `*` — ноль или более ЛЮБЫХ символов,
    // `?` — ровно один. Доки mihomo отдельно предупреждают, что это НЕ те
    // подстановки, что в clash-form списках доменов (там `*` — один сегмент), и
    // что `+` здесь обычный символ, а не квантификатор.
    //
    // Шаблон приходит из чужого документа, поэтому экранируется всё, кроме двух
    // подстановок: иначе `[` или `\` в имени превратили бы `new RegExp` в
    // SyntaxError. try/catch — вторая застава: трассировка считается на каждую
    // правку текста, ErrorBoundary в приложении нет, и исключение отсюда гасит
    // весь редактор.
    try {
      const body = escapeRe(p).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')
      return new RegExp(`^${body}$`).test(a) ? 'yes' : 'no'
    } catch {
      return 'unknown'
    }
  }
  if (type === 'DOMAIN-REGEX') {
    // Регулярка автора шаблона может быть невалидной для JS — это не повод
    // падать: честно говорим «проверить не могу»
    try {
      return new RegExp(pattern).test(address) ? 'yes' : 'no'
    } catch {
      return 'unknown'
    }
  }
  return 'unknown'
}

/**
 * Ответ geo-базы по ключу. Три состояния различаются намеренно: ответ есть;
 * база загружена, но категории в ней нет; база не загружена. Во всех неясных
 * случаях — 'unknown' с причиной: догадка здесь стоила бы неверного маршрута.
 */
function geoCond(key: string, geo: GeoAnswers): CondResult {
  if (!geo.loaded) {
    return { state: 'unknown', reason: `geo-базы не загружены — ответить по «${key}» нечем` }
  }
  const answer = geo.answers[key]
  if (answer === undefined) {
    return { state: 'unknown', reason: `ответа базы по «${key}» нет` }
  }
  return answer ? YES : NO
}

interface Ctx {
  md: MihomoDoc
  target: TraceTarget
  geo: GeoAnswers
  /** Имена наборов правил, чьё содержимое — только подсети (`behavior: ipcidr`) */
  ipcidrProviders: Set<string>
  /** Что бэкенд ответил по наборам правил документа */
  ruleSets: RuleSetAnswers
}

/**
 * Правила, которые смотрят ТОЛЬКО на IP назначения. При `no-resolve` и цели без
 * адреса ядро отвечает по ним определённым «нет», а не «не знаю»:
 *   `rules/common/ipcidr.go` — `return ip.IsValid() && i.ipnet.Contains(...)`;
 *   `rules/common/geoip.go`  — `if !ip.IsValid() { return false, "" }`.
 * Список закрытый и короткий намеренно: сюда попадает только то, чей `Match`
 * прочитан в исходниках ядра. `IP-SUFFIX`/`IP-ASN` в него не входят — они
 * остаются в `NO_DATA_TYPES` и по-прежнему останавливают проход.
 */
const IP_ONLY_TYPES = new Set(['IP-CIDR', 'IP-CIDR6', 'GEOIP'])

/**
 * Правило по IP, которому `no-resolve` запретил резолв, а IP в цели нет, —
 * определённый промах. Домен ядро в этом случае не разрешает по прямому указанию
 * документа, `DstIP` остаётся невалидным, и `Match` возвращает false. Для
 * `RULE-SET` это верно ровно при `behavior: ipcidr`: набор целиком про подсети,
 * и содержимое файла на ответ не влияет (`rules/provider/rule_set.go` при
 * `noResolveIP` зануляет сам колбэк резолва). При `behavior: domain` и
 * `classical` резолв набору не нужен вовсе, и ответить без файла нечем; у
 * провайдера, которого в документе нет, `behavior` взять неоткуда — обоих
 * случаев здесь нет, и проход на них останавливается, как раньше.
 */
function missesWithoutResolve(ctx: Ctx, rule: ConditionLike): boolean {
  if (!rule.modifiers.includes('no-resolve')) return false
  if (ctx.target.ip !== undefined) return false
  if (IP_ONLY_TYPES.has(rule.type)) return true
  return (
    rule.type === 'RULE-SET' && rule.payload !== undefined && ctx.ipcidrProviders.has(rule.payload)
  )
}

/**
 * Строка набора `classical` — правило БЕЗ цели: ядро разбирает её
 * `ParseRulePayload(rule, false)`. Обычный `parseRule` тут не годится: он ждёт
 * три поля и на `PROCESS-NAME,uTorrent.exe` вернул бы null, потеряв всю строку.
 */
export function parseClassicalEntry(line: string): ConditionLike | null {
  const parts = splitTopLevel(line.trim())
  if (parts.length < 2) return null
  const type = parts[0]!.trim()
  if (type === '') return null
  return { type, payload: parts[1], modifiers: parts.slice(2) }
}

/**
 * Отказы, видные ДО разбора условия: они смотрят на модификаторы, а не на тип.
 * Общие у правила документа и у строки набора — модификатор в строке набора
 * значит ровно то же самое.
 */
function earlyRefusal(ctx: Ctx, rule: ConditionLike): CondResult | null {
  // Модификатор `src` разворачивает условие на источник соединения, о котором
  // цель трассировки ничего не знает: посчитать его как условие по назначению
  // значило бы дать уверенный неверный ответ
  if (rule.modifiers.includes('src')) {
    return {
      state: 'unknown',
      reason: `модификатор src разворачивает «${rule.type}» на источник соединения — таких данных в цели трассировки нет`,
    }
  }
  if (missesWithoutResolve(ctx, rule)) return NO
  return null
}

/** Условие целиком: сперва отказы по модификаторам, потом разбор самого условия */
function judgeCondition(ctx: Ctx, rule: ConditionLike): CondResult {
  return earlyRefusal(ctx, rule) ?? evalCondition(ctx, { type: rule.type, payload: rule.payload })
}

/**
 * Набор `classical` — это ИЛИ по его строкам (`classical_strategy.go`): ядро
 * идёт по списку и возвращает true на первом совпавшем. Отсюда две
 * несимметричные ветки. Точное «да» решает исход независимо от того, сколько
 * строк рядом непроверяемы. А вот непроверяемая строка БЕЗ единого «да» делает
 * неизвестным весь набор: счесть его промахом молча значило бы соврать — ровно
 * то, ради запрета чего в этой трассировке заведена остановка.
 */
function evalClassical(ctx: Ctx, name: string, lines: string[]): CondResult {
  let unknown: CondResult | null = null
  for (const line of lines) {
    const entry = parseClassicalEntry(line)
    if (entry === null) {
      unknown ??= { state: 'unknown', reason: `в наборе «${name}» не разбирается строка «${line}»` }
      continue
    }
    if (FORBIDDEN_IN_CLASSICAL.has(entry.type)) {
      unknown ??= {
        state: 'unknown',
        reason: `в наборе «${name}» строка «${line}»: ядро не принимает «${entry.type}» внутри classical`,
      }
      continue
    }
    const res = judgeCondition(ctx, entry)
    if (res.state === 'yes') return YES
    if (res.state === 'unknown') {
      unknown ??= { state: 'unknown', reason: `в наборе «${name}»: ${res.reason}` }
    }
  }
  return unknown ?? NO
}

function evalCondition(ctx: Ctx, cond: Cond): CondResult {
  const { type, payload } = cond
  if (type === 'MATCH') return YES
  if (type === 'AND' || type === 'OR' || type === 'NOT') {
    return evalLogic(ctx, type, payload)
  }
  if (payload === undefined || payload === '') {
    return { state: 'unknown', reason: `у условия «${type}» нет значения` }
  }
  if (type.startsWith('DOMAIN')) {
    const state = matchDomain(type, payload, ctx.target.address)
    return state === 'unknown'
      ? { state, reason: `выражение «${payload}» не разбирается как регулярное` }
      : { state }
  }
  if (type === 'GEOSITE') return geoCond(`geosite:${payload}`, ctx.geo)
  if (type === 'GEOIP') return geoCond(`geoip:${payload}`, ctx.geo)
  if (type === 'IP-CIDR' || type === 'IP-CIDR6') {
    if (ctx.target.ip === undefined) {
      return {
        state: 'unknown',
        reason: 'укажите IP назначения — без адреса подсеть проверить нечем',
      }
    }
    const hit = ipInCidr(ctx.target.ip, payload)
    return hit === null
      ? { state: 'unknown', reason: `подсеть «${payload}» не разбирается` }
      : hit
        ? YES
        : NO
  }
  if (type === 'DST-PORT') {
    // У mihomo несколько портов перечисляются через `/` (`DST-PORT,80/443`):
    // запятая здесь невозможна в принципе — она разделяет поля самого правила.
    // Арифметику диапазонов берём общую с Xray, поменяв разделитель, а вот текст
    // отказа пишем свой: сообщение Xray обещало бы список через запятую.
    const verdict = matchPortField('port', payload.split('/').join(','), ctx.target.port)
    return verdict.state === 'unknown'
      ? {
          state: 'unknown',
          reason: `порты «${payload}» не разбираются: ожидается 443, 1000-2000 или их список через «/»`,
        }
      : { state: verdict.state }
  }
  if (type === 'NETWORK') {
    // Живые шаблоны пишут `NETWORK,UDP` заглавными — регистр здесь не значит ничего
    return payload.trim().toLowerCase() === ctx.target.network ? YES : NO
  }
  if (type === 'RULE-SET') {
    // Наборы редактор теперь скачивает (бэкенд опрашивает их по ссылке), и
    // ответ бывает четырёх видов. «Ответа нет» — не то же самое, что «набор
    // недоступен»: в первом случае мы не спрашивали или ещё не дождались, во
    // втором спросили и получили отказ с причиной. Оба — остановка, но текст
    // должен называть, что именно произошло.
    const answer = ctx.ruleSets.answers[payload]
    if (answer === undefined) {
      return {
        state: 'unknown',
        reason: ctx.ruleSets.pending
          ? `набор правил «${payload}» ещё загружается`
          : `набор правил «${payload}»: содержимое редактору неизвестно`,
      }
    }
    if (answer.state === 'unavailable') {
      return { state: 'unknown', reason: `набор правил «${payload}»: ${answer.reason}` }
    }
    if (answer.state === 'lines') return evalClassical(ctx, payload, answer.lines)
    return answer.state === 'yes' ? YES : NO
  }
  if (PROCESS_NAME_TYPES.has(type) || PROCESS_PATH_TYPES.has(type)) {
    return processCond(ctx, type, payload)
  }
  if (NO_DATA_TYPES.has(type)) {
    return {
      state: 'unknown',
      reason: `условие «${type}» проверяется по данным источника или входа — в цели трассировки их нет`,
    }
  }
  return { state: 'unknown', reason: `редактор не знает тип правила «${type}»` }
}

/**
 * И, ИЛИ, НЕ над вложенными условиями. Общее правило: неизвестное пробрасывается
 * наружу и останавливает проход, КРОМЕ случаев, когда ответ определён при любом
 * его значении. Таких случаев ровно два, и они разные у AND и у OR:
 *   `AND(нет, неизвестно)` = нет — точный промах решает;
 *   `OR (да,  неизвестно)` = да  — точное совпадение решает.
 * Обратные пары решения НЕ дают: `OR(нет, неизвестно)` — это неизвестное, а не
 * «нет». Формулировка «точный промах перевешивает неизвестное» верна только для
 * AND; как общее правило она уже один раз попала отсюда в `CLAUDE.md` и была
 * поймана финальным ревью.
 * У NOT инвертируется только определённый ответ: неизвестное выходит наружу как
 * есть — отрицать то, чего не проверили, значило бы выдумать ответ.
 */
function evalLogic(ctx: Ctx, type: string, payload: string | undefined): CondResult {
  if (payload === undefined) {
    return { state: 'unknown', reason: `у правила ${type} нет условий` }
  }
  const conds = parseConditions(payload)
  if (conds === null || conds.length === 0) {
    return {
      state: 'unknown',
      reason: `условия правила ${type} не разбираются: ожидалась запись вида ((ТИП,значение),(ТИП,значение))`,
    }
  }
  if (type === 'NOT') {
    if (conds.length !== 1) {
      return { state: 'unknown', reason: 'NOT принимает ровно одно условие' }
    }
    const res = evalCondition(ctx, conds[0]!)
    if (res.state === 'unknown') return res
    return res.state === 'yes' ? NO : YES
  }
  const results = conds.map((c) => evalCondition(ctx, c))
  if (type === 'AND') {
    if (results.some((r) => r.state === 'no')) return NO
    const unknown = results.find((r) => r.state === 'unknown')
    return unknown ?? YES
  }
  if (results.some((r) => r.state === 'yes')) return YES
  const unknown = results.find((r) => r.state === 'unknown')
  return unknown ?? NO
}

/**
 * Правила подсписка `sub-rules`. Значение скаляра берём ДЕКОДИРОВАННЫМ, а не
 * срезом текста: в кавычках (`- "MATCH,DIRECT"`) YAML их уже снял, и разбор
 * среза дал бы тип правила `"MATCH` (тот же приём, что в `rulesOf`).
 * null — подсписка нет либо его значение не список: проверять нечего.
 */
function subRuleRules(md: MihomoDoc, name: string): (MihomoRule | null)[] | null {
  const entry = subRuleEntries(md).find((e) => e.name === name)
  if (entry === undefined || !isSeq(entry.node)) return null
  return entry.node.items.map((item) =>
    isScalar(item) && typeof item.value === 'string' ? parseRule(item.value) : null,
  )
}

/** Проход по подсписку: те же правила и та же остановка, что и в основном списке */
function walkSubRule(ctx: Ctx, name: string, seen: Set<string>): Judged {
  if (seen.has(name)) {
    return { state: 'unknown', reason: `подсписок «${name}» ссылается сам на себя — проход зациклился` }
  }
  const rules = subRuleRules(ctx.md, name)
  if (rules === null) {
    return {
      state: 'unknown',
      reason: `подсписка «${name}» в документе нет либо он не список — проверить нечего`,
    }
  }
  const nested = new Set(seen).add(name)
  for (const rule of rules) {
    const res = judgeRule(ctx, rule, nested)
    if (res.state === 'unknown') {
      return { ...res, reason: `в подсписке «${name}»: ${res.reason}` }
    }
    // PASS внутри подсписка выводит из него обратно в основной список — то же
    // самое, что и «ничего не совпало», только по явной команде документа
    if (res.state === 'yes' && res.target === PASS_TARGET) return { state: 'no', via: name }
    if (res.state === 'yes') return { ...res, via: res.via ?? name }
  }
  // Ни одно правило подсписка не совпало — проход возвращается в основной
  // список. Это ВЫВОД из документации ядра, а не проверенный факт: там сказано,
  // что `PASS` выводит из подсписка в основные правила и что ссылка на
  // несуществующий подсписок откатывается туда же — обе формулировки не имели
  // бы смысла, будь ветка подсписка терминальной. Прямого утверждения «ничего
  // не совпало — идём дальше по основному списку» в доках нет.
  return { state: 'no', via: name }
}

/** Вердикт одного правила целиком: условие плюс цель, куда уйдёт трафик */
function judgeRule(ctx: Ctx, rule: MihomoRule | null, seen: Set<string>): Judged {
  if (rule === null) {
    return { state: 'unknown', reason: 'строку правила разобрать не удалось' }
  }
  // Отказы по модификаторам проверяются ДО ветки SUB-RULE: `src` разворачивает
  // на источник и её тоже
  const early = earlyRefusal(ctx, rule)
  if (early !== null) return early
  if (rule.type === 'SUB-RULE') {
    if (rule.payload === undefined) {
      return { state: 'unknown', reason: 'у правила SUB-RULE нет условия' }
    }
    const cond = parseOneCondition(rule.payload)
    if (cond === null) {
      return {
        state: 'unknown',
        reason: 'условие SUB-RULE не разбирается: ожидалась запись вида (ТИП,значение)',
      }
    }
    const gate = evalCondition(ctx, cond)
    if (gate.state !== 'yes') return gate
    return walkSubRule(ctx, rule.target, seen)
  }
  const res = evalCondition(ctx, { type: rule.type, payload: rule.payload })
  return res.state === 'yes' ? { state: 'yes', target: rule.target } : res
}

/**
 * Все geo-ключи документа — по ним трассировщик спрашивает бэкенд. Обход тот же,
 * что у самой трассировки: ключ бывает и внутри логического условия, и в
 * подсписке правил, и спросить о нём надо ДО того, как проход туда дойдёт.
 */
export function geoKeysOfMihomo(md: MihomoDoc): string[] {
  const keys: string[] = []
  const push = (key: string) => {
    if (!keys.includes(key)) keys.push(key)
  }

  const fromCond = (cond: Cond) => {
    if (cond.type === 'GEOSITE' && cond.payload) return push(`geosite:${cond.payload}`)
    if (cond.type === 'GEOIP' && cond.payload) return push(`geoip:${cond.payload}`)
    if (cond.type === 'AND' || cond.type === 'OR' || cond.type === 'NOT') {
      for (const nested of parseConditions(cond.payload ?? '') ?? []) fromCond(nested)
    }
  }

  for (const entry of rulesOf(md)) {
    if (entry.rule === null) continue
    fromCond({ type: entry.rule.type, payload: entry.rule.payload })
  }
  for (const { name } of subRuleEntries(md)) {
    for (const rule of subRuleRules(md, name) ?? []) {
      if (rule === null) continue
      fromCond({ type: rule.type, payload: rule.payload })
    }
  }
  return keys
}

/** Есть ли в документе geo-условия — от этого зависит оговорка о базах */
function usesGeo(md: MihomoDoc): boolean {
  return geoKeysOfMihomo(md).length > 0
}

export function traceMihomo(
  md: MihomoDoc,
  target: TraceTarget,
  geo: GeoAnswers,
  // Значение по умолчанию обязательно: у traceMihomo есть вызывающие, которым
  // наборы правил не нужны, и трогать их в этой задаче незачем
  ruleSets: RuleSetAnswers = NO_RULE_SETS,
): MihomoTraceResult {
  // Цель-адрес и есть IP назначения: требовать вписать его второй раз незачем
  const effective: TraceTarget =
    isIpAddress(target.address) && target.ip === undefined
      ? { ...target, ip: target.address }
      : target
  const ctx: Ctx = {
    md,
    target: effective,
    geo,
    // Регистр не значит ничего: живые шаблоны пишут behavior строчными, а на
    // документе с иным написанием ядро всё равно не поднимется
    ipcidrProviders: new Set(
      ruleProvidersOf(md)
        .filter((p) => p.behavior?.trim().toLowerCase() === 'ipcidr')
        .map((p) => p.name),
    ),
    ruleSets,
  }

  const verdicts: MihomoRuleVerdict[] = []
  let winner: MihomoTraceResult['winner']
  let stopped: MihomoTraceResult['stopped']
  const notes: Notes = { opened: [], passed: [] }

  const entries = rulesOf(md)
  for (const entry of entries) {
    const res = judgeRule(ctx, entry.rule, new Set())
    verdicts.push({
      index: entry.index,
      state: res.state,
      // У совпавшего правила цель — та, куда трафик уйдёт на самом деле (у
      // SUB-RULE она приходит из подсписка); у остальных — то, что написано
      target: res.target ?? entry.rule?.target,
      reason: res.reason,
    })
    if (res.state === 'unknown') {
      stopped = { index: entry.index, reason: res.reason ?? 'проверить это правило редактор не может' }
      break
    }
    if (res.state === 'no') {
      // Подсписок открылся, но ни одно его правило не подошло — проход вернулся
      // сюда. Пользователю это так же неочевидно, как и выигрыш из подсписка
      if (res.via !== undefined) notes.opened.push({ index: entry.index, name: res.via })
      continue
    }
    // Правило совпало, но его цель — PASS: ветка пропускается, разбор идёт дальше
    if (res.target === PASS_TARGET) {
      notes.passed.push(entry.index)
      continue
    }
    winner = { ruleIndex: entry.index, target: res.target ?? entry.rule!.target }
    notes.via = res.via
    break
  }

  // Дошли до конца списка и ни одно правило не совпало. MATCH в таком документе
  // нет по построению (он совпадает всегда), и весь неподошедший трафик ядро
  // отправляет напрямую.
  if (winner === undefined && stopped === undefined) {
    winner = { ruleIndex: null, target: 'DIRECT' }
  }

  return { verdicts, winner, stopped, caveats: collectCaveats(ctx, winner, notes) }
}

/** Что случилось по дороге и требует объяснения — сам вердикт об этом молчит */
interface Notes {
  /** Подсписок, из которого пришла цель победителя */
  via?: string
  /** Подсписки, которые открылись, но никого не выбрали */
  opened: { index: number; name: string }[]
  /** Правила, совпавшие в PASS: ветка пропущена, проход продолжен */
  passed: number[]
}

function collectCaveats(
  ctx: Ctx,
  winner: MihomoTraceResult['winner'],
  notes: Notes,
): string[] {
  const caveats: string[] = []

  if (winner?.ruleIndex === null) {
    caveats.push(
      'Ни одно правило не совпало, а MATCH в списке нет: трафик, не подошедший ни под одно правило, пойдёт напрямую (DIRECT).',
    )
  }
  if (notes.via !== undefined) {
    caveats.push(
      `Цель пришла из подсписка «${notes.via}» — правило верхнего списка только открыло его.`,
    )
  }
  for (const { index, name } of notes.opened) {
    // «Маршрут не определился», а не «ничего не совпало»: из подсписка выводит и
    // PASS, при котором правило как раз совпало
    caveats.push(
      `Условие правила #${index + 1} совпало и открыло подсписок «${name}», но маршрут в нём не определился — проход вернулся в основной список.`,
    )
  }
  for (const index of notes.passed) {
    caveats.push(
      `Правило #${index + 1} совпало, но его цель — PASS: ветка пропущена, и разбор продолжился со следующих правил.`,
    )
  }
  if (!ctx.geo.loaded && usesGeo(ctx.md)) {
    caveats.push('Geo-базы не загружены: вердикты по GEOSITE и GEOIP неизвестны.')
  }
  for (const key of ctx.geo.missing) {
    // Что сделает с таким документом ядро клиента, редактор не знает: базы у
    // клиента свои. Утверждаем только то, что следует из отсутствия категории
    caveats.push(`Категории «${key}» нет в загруженной базе — правило по ней не сработает.`)
  }
  // Имена подставленных панелью хостов редактор не знает по определению, поэтому
  // цель, которой нет в документе, — не ошибка и утверждать о ней нечего
  if (winner !== undefined && resolveTarget(ctx.md, winner.target) === 'unknown') {
    caveats.push(
      `Цели «${winner.target}» нет среди групп и провайдеров документа. Возможно, это имя хоста, который подставит панель, — тогда маршрут разрешится, но подтвердить это редактор не может.`,
    )
  }

  return caveats
}

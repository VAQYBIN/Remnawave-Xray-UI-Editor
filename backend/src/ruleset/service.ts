// Загрузка и опрос наборов правил, на которые ссылается документ шаблона.
//
// Разделение с фронтендом проходит по инструменту: `domain` и `ipcidr` считаем
// здесь, потому что декодеры бора и диапазонов есть только тут; `classical`
// отдаём строками, потому что это правила Mihomo, а их вычислитель живёт во
// фронтенде, и второй его копии в проекте не будет.
import { join } from 'node:path'
import { fetchExternalBytes, type FetchGuardOptions } from '../net/guard.js'
import { RuleSetCache } from './cache.js'
import { domainMatcher, readDomainSet, type DomainMatcher } from './domainSet.js'
import { cidrsOf, domainKeys } from './enumerate.js'
import { RuleSetError } from './errors.js'
import { ipMatcher, readIpCidrSet, type IpMatcher } from './ipcidrSet.js'
import { parseMrs, type RuleBehavior } from './mrs.js'
import { parsePayload } from './payload.js'
import { domainSetFromLines, ipCidrSetFromLines } from './textSets.js'

/** Значения из спеки; менять их — менять спеку */
export const LIMITS = {
  wireBytes: 8 * 1024 * 1024,
  plainBytes: 32 * 1024 * 1024,
  setsPerDocument: 64,
  cacheBytes: 256 * 1024 * 1024,
  parsedBytes: 64 * 1024 * 1024,
  classicalLines: 10_000,
  minTtlMs: 60 * 60 * 1000,
  /**
   * Сколько наборов качаем разом. Требование спеки: без него документ с
   * шестьюдесятью четырьмя провайдерами при пустом кэше открывает столько же
   * исходящих соединений сразу, каждое со своим таймаутом
   */
  concurrentDownloads: 8,
}

export type RuleSetLimits = typeof LIMITS

export interface RuleSetDescriptor {
  name: string
  kind: 'http' | 'inline'
  url?: string
  payload?: string[]
  behavior: RuleBehavior
  format: 'mrs' | 'yaml' | 'text'
  /** Секунды из документа; сервис сам поднимает до часа, если меньше */
  intervalSec?: number
}

export type RuleSetAnswer =
  | { state: 'yes' | 'no'; count: number; loadedAt?: number }
  | { state: 'lines'; lines: string[]; count: number; loadedAt?: number }
  | { state: 'unavailable'; reason: string }

export interface RuleSetStatusItem {
  name: string
  state: 'ready' | 'missing' | 'error'
  /** Записей по заголовку набора — не число ключей бора */
  count?: number
  /** Размер разобранного содержимого в байтах */
  bytes?: number
  loadedAt?: number
  /** Файл в кэше старше TTL: следующая трассировка перекачает его */
  stale?: boolean
  reason?: string
}

export interface RuleSetPage {
  total: number
  offset: number
  /** `count` из заголовка набора — рядом с `total`, и это разные числа */
  count: number
  items: string[]
}

// Наборы `domain` и `ipcidr` приходят и из `.mrs`, и из текста, поэтому
// сервис держит не структуру, а то, у чего можно спросить: откуда взялся
// ответ, ему знать незачем
interface ParsedBase {
  count: number
  bytes: number
  /** Когда файл скачан; у встроенного набора времени нет — он часть документа */
  loadedAt?: number
  /**
   * Содержимое набора по одной записи. Генератор, а не массив: у `geoip/us`
   * 300 531 диапазон, и материализовать их все ради одной страницы просмотрщика
   * значило бы держать в памяти сотни мегабайт строк
   */
  entries: () => Iterable<string>
}

type Parsed =
  | (ParsedBase & { kind: 'domain'; matcher: DomainMatcher })
  | (ParsedBase & { kind: 'ipcidr'; matcher: IpMatcher })
  | (ParsedBase & { kind: 'classical'; lines: string[] })

/** Разобранный набор помнится не навсегда: у него тот же срок годности, что у файла */
interface Remembered {
  parsed: Parsed
  expiresAt: number
}

/**
 * Причина неудачной загрузки по-русски. Сообщения undici английские и
 * технические («fetch failed», «getaddrinfo ENOTFOUND»), а пользователь читает
 * их как состояние своего набора. Незнакомое пропускаем как есть: выдуманный
 * перевод хуже непонятного оригинала, а сам `err` доезжает в `cause`.
 */
function downloadReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'имя хоста не разрешается'
  if (code === 'ECONNREFUSED') return 'соединение отклонено'
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(message)) return 'истекло время ожидания'
  if (/^Сервер ответил /.test(message) || /больше d+ байт/.test(message)) return message
  if (/внутреннюю сеть|Некорректная ссылка|должна начинаться|редирект/i.test(message)) return message
  return message
}

/**
 * Отказ, который обязаны давать ОБА пути — и `load`, и `status`. Литерал в
 * двух местах однажды поправят в одном: пользователь получил бы разный текст на
 * один и тот же отказ, а тест на текст остался бы зелёным на разъехавшихся
 * сообщениях.
 */
const INLINE_MRS_REFUSAL = 'Формат mrs не бывает встроенным в документ'

export class RuleSetService {
  private readonly cache: RuleSetCache
  /** Разобранное держим в памяти: набор подсетей крупной страны разбирается заметно */
  private readonly parsed = new Map<string, Remembered>()
  /** Загрузки в полёте: одна ссылка в документе встречается не раз */
  private readonly loading = new Map<string, Promise<Parsed>>()
  private parsedBytes = 0

  /**
   * Сколько наборов лежит разобранными. Существует ради теста на вытеснение:
   * иначе предел объёма памяти нельзя отличить от его отсутствия — наружу он
   * никак не проявляется, и потому не проверялся ничем.
   */
  get parsedCount(): number {
    return this.parsed.size
  }

  private readonly limits: RuleSetLimits

  constructor(
    dataDir: string,
    private readonly net: FetchGuardOptions = {},
    // Пределы переопределяются только в тестах: проверять их боевыми значениями
    // значило бы держать в репозитории фикстуры в десятки мегабайт, и ровно
    // поэтому два из семи не проверялись ничем
    limits: Partial<RuleSetLimits> = {},
  ) {
    this.limits = { ...LIMITS, ...limits }
    this.cache = new RuleSetCache(join(dataDir, 'rulesets'), {
      totalBytes: this.limits.cacheBytes,
    })
  }

  async match(
    target: { address: string; ip?: string },
    sets: RuleSetDescriptor[],
  ): Promise<Record<string, RuleSetAnswer>> {
    const answers: Record<string, RuleSetAnswer> = {}
    const { allowed, refused, reason } = this.withinDocumentLimit(sets)
    for (const set of refused) {
      answers[set.name] = { state: 'unavailable', reason }
    }

    // Ни одна из этих задач не отклоняется: иначе обход завершился бы на первом
    // же отказе, не дождавшись соседей, и часть наборов осталась бы без ответа
    // вовсе. И идут они не все разом: документ с шестьюдесятью четырьмя
    // провайдерами при пустом кэше открыл бы столько же соединений сразу
    const results = await this.pool(allowed, async (set) => {
      try {
        return { name: set.name, answer: this.answer(await this.load(set), target) }
      } catch (err) {
        return {
          name: set.name,
          answer: {
            state: 'unavailable' as const,
            // Наружу пускаем только текст известного отказа: чужое исключение
            // выглядело бы как состояние набора и увело бы пользователя
            // разбираться с его документом вместо нашей ошибки
            reason: err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
          },
        }
      }
    })
    for (const { name, answer } of results) answers[name] = answer

    return answers
  }

  private answer(parsed: Parsed, target: { address: string; ip?: string }): RuleSetAnswer {
    if (parsed.kind === 'classical') {
      return { state: 'lines', lines: parsed.lines, count: parsed.count, loadedAt: parsed.loadedAt }
    }
    if (parsed.kind === 'domain') {
      return {
        state: parsed.matcher.has(target.address) ? 'yes' : 'no',
        count: parsed.count,
        loadedAt: parsed.loadedAt,
      }
    }
    // Без IP в цели набор подсетей не совпадает: резолвить домены сервер не
    // берётся, а догадка здесь стоила бы неверного маршрута
    // Без IP в цели набор подсетей не отвечает НИЧЕГО — и «нет» здесь было бы
    // ложью. Ядро в этом случае домен резолвит и проверяет полученный адрес;
    // какой он выйдет, мы не знаем. Сказать «не совпало» значило бы отправить
    // трассировку дальше по списку и уверенно назвать неверный маршрут.
    //
    // Случай, когда отсутствие IP законно означает промах, ровно один — правило
    // с модификатором no-resolve, — но про модификатор знает документ, а не
    // набор, и решается он на стороне трассировки, до обращения сюда.
    if (target.ip === undefined) {
      return { state: 'unavailable', reason: 'в цели трассировки нет IP назначения' }
    }
    return {
      state: parsed.matcher.has(target.ip) ? 'yes' : 'no',
      count: parsed.count,
      loadedAt: parsed.loadedAt,
    }
  }

  private async load(set: RuleSetDescriptor): Promise<Parsed> {
    if (set.kind === 'inline') {
      if (set.format === 'mrs') throw new RuleSetError(INLINE_MRS_REFUSAL)
      // Встроенный набор не запоминаем: ключом было бы имя, а содержимое
      // правится вместе с документом — запомненное отвечало бы за прошлую
      // редакцию. Разбор списка строк и не стоит того, чтобы его беречь.
      // Через parsePayload эти строки НЕ идут: там разбирается документ с
      // ключом payload, а здесь уже готовые записи — второй разбор их потерял бы
      const lines = set.payload ?? []
      return this.fromLines(set, lines, lines.join('\n').length)
    }
    if (set.url === undefined) throw new RuleSetError('У набора не указана ссылка')

    const cacheKey = `${set.url}|${set.behavior}|${set.format}`
    const hit = this.parsed.get(cacheKey)
    if (hit !== undefined && hit.expiresAt > Date.now()) return hit.parsed

    // Наборы одного документа грузятся разом, и одна ссылка встречается в нём
    // не раз. Без этой карты каждый её экземпляр качал бы файл сам и писал бы
    // в один и тот же путь кэша одновременно с соседями: лишний трафик кратно
    // числу повторов и чтение поверх недописанного файла
    const inFlight = this.loading.get(cacheKey)
    if (inFlight !== undefined) return inFlight
    const started = this.loadUncached(set, cacheKey)
    this.loading.set(cacheKey, started)
    try {
      return await started
    } finally {
      this.loading.delete(cacheKey)
    }
  }

  private async loadUncached(set: RuleSetDescriptor, cacheKey: string): Promise<Parsed> {
    if (set.url === undefined) throw new RuleSetError('У набора не указана ссылка')

    const ttl = Math.max(this.limits.minTtlMs, (set.intervalSec ?? 0) * 1000)
    const cached = await this.cache.read(set.url, ttl)

    let bytes: Uint8Array
    let loadedAt: number
    if (cached !== null) {
      bytes = cached.bytes
      loadedAt = cached.loadedAt
    } else {
      bytes = await fetchExternalBytes(set.url, {
        ...this.net,
        maxBytes: this.limits.wireBytes,
      }).catch((err: unknown) => {
        throw new RuleSetError(`не удалось скачать: ${downloadReason(err)}`, { cause: err })
      })
      loadedAt = Date.now()
      await this.cache.write(set.url, bytes)
    }

    const parsed: Parsed = { ...this.build(set, bytes), loadedAt }
    this.remember(cacheKey, parsed, loadedAt + ttl)
    return parsed
  }

  private build(set: RuleSetDescriptor, bytes: Uint8Array): Parsed {
    // Размер меряем ПОСЛЕ распаковки. Байты с провода тут не годятся: у .mrs
    // они впятеро меньше распакованного, и счётчик показывал бы 64 МБ там, где
    // в памяти лежат сотни, — вытеснение не сработало бы ни разу
    let size = bytes.byteLength

    if (set.format === 'mrs') {
      const file = parseMrs(bytes, this.limits.plainBytes)
      size = file.body.length
      if (file.behavior !== set.behavior) {
        // Документ обещал одно, файл содержит другое: считать по файлу — значит
        // ответить не на тот вопрос, который задало правило
        throw new RuleSetError(
          `в документе указан вид «${set.behavior}», а в файле «${file.behavior}»`,
        )
      }
      if (file.behavior === 'classical') {
        throw new RuleSetError('вид classical в формате mrs не встречается')
      }
      if (file.behavior === 'domain') {
        const ds = readDomainSet(file.body)
        return {
          kind: 'domain',
          matcher: domainMatcher(ds),
          entries: () => domainKeys(ds),
          count: file.count,
          bytes: size,
        }
      }
      const ranges = readIpCidrSet(file.body)
      return {
        kind: 'ipcidr',
        matcher: ipMatcher(ranges),
        entries: () => cidrsOf(ranges),
        count: file.count,
        bytes: size,
      }
    }

    return this.fromLines(set, parsePayload(Buffer.from(bytes).toString('utf8'), set.format), size)
  }

  /** Разбор общий для текстового файла и для встроенного в документ списка */
  private fromLines(set: RuleSetDescriptor, lines: string[], size: number): Parsed {
    if (set.behavior === 'classical') {
      if (lines.length > this.limits.classicalLines) {
        throw new RuleSetError(`в наборе больше ${this.limits.classicalLines} строк`)
      }
      return { kind: 'classical', lines, count: lines.length, bytes: size, entries: () => lines }
    }
    if (set.behavior === 'domain') {
      return {
        kind: 'domain',
        matcher: domainSetFromLines(lines),
        count: lines.length,
        bytes: size,
        entries: () => lines,
      }
    }
    return {
      kind: 'ipcidr',
      matcher: ipCidrSetFromLines(lines),
      count: lines.length,
      bytes: size,
      entries: () => lines,
    }
  }

  /** Разобранное вытесняем по объёму: счётчик, а не число наборов */
  private remember(key: string, parsed: Parsed, expiresAt: number): void {
    const previous = this.parsed.get(key)
    if (previous !== undefined) this.parsedBytes -= previous.parsed.bytes
    // Перезапись не должна оставлять ключ на прежнем месте очереди: свежий
    // набор вытесняется последним, а не первым
    this.parsed.delete(key)
    this.parsed.set(key, { parsed, expiresAt })
    this.parsedBytes += parsed.bytes
    while (this.parsedBytes > this.limits.parsedBytes && this.parsed.size > 1) {
      const oldest = this.parsed.keys().next().value as string
      this.parsedBytes -= this.parsed.get(oldest)?.parsed.bytes ?? 0
      this.parsed.delete(oldest)
    }
  }

  /**
   * Разделить наборы документа по пределу на документ. Предел режет НАБОР, а не
   * запрос: первые 64 получают настоящий ответ, остальные — причину.
   *
   * Один хелпер на все три операции, и это не вкусовщина. У `match` срез был с
   * самого начала, а `status` и `refresh` оставались с единственной защитой в
   * виде размера тела: минимальный дескриптор весит меньше сотни байт, в
   * восьмимегабайтное тело их влезает под сотню тысяч, и `refresh` пошёл бы
   * качать по каждому. Находка ревью задачи 3.
   */
  private withinDocumentLimit(sets: RuleSetDescriptor[]): {
    allowed: RuleSetDescriptor[]
    refused: RuleSetDescriptor[]
    reason: string
  } {
    return {
      allowed: sets.slice(0, this.limits.setsPerDocument),
      refused: sets.slice(this.limits.setsPerDocument),
      reason: `в документе больше ${this.limits.setsPerDocument} наборов — этот не проверялся`,
    }
  }

  /**
   * Прогнать задачи с пределом одновременности, сохраняя порядок результатов.
   *
   * Отказ ОДНОЙ задачи обрывает весь обход: соседи не дождутся своей очереди, и
   * часть наборов останется без ответа. Поэтому `fn` обязана ловить свои
   * исключения сама и возвращать отказ значением — хелпер этого за неё не
   * делает. Все три нынешних вызывающих так и устроены.
   */
  private async pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++
        if (index >= items.length) return
        out[index] = await fn(items[index]!)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(this.limits.concurrentDownloads, items.length) }, worker),
    )
    return out
  }

  /**
   * Состояние наборов ПО КЭШУ. Сеть здесь не трогается принципиально: документ
   * с 26 наборами превратил бы открытие диалога в 26 загрузок, и пользователь
   * читал бы пустой список секунд десять. Качает `refresh`, у него есть кнопка.
   */
  async status(sets: RuleSetDescriptor[]): Promise<RuleSetStatusItem[]> {
    const { allowed, refused, reason } = this.withinDocumentLimit(sets)
    const items = await this.pool(allowed, async (set) => {
      try {
        return await this.statusOf(set)
      } catch (err) {
        return {
          name: set.name,
          state: 'error' as const,
          reason: err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
        }
      }
    })
    // Лишние идут строками с причиной, а не пропадают: строки нет — читается
    // как «набора нет в документе»
    return [...items, ...refused.map((set) => ({ name: set.name, state: 'error' as const, reason }))]
  }

  private async statusOf(set: RuleSetDescriptor): Promise<RuleSetStatusItem> {
    if (set.kind === 'inline') {
      // Тот же запрет, что в load.
      // Без этой проверки status ответил бы «готов» по набору, который match
      // тут же назовёт недоступным, — два разных ответа на один вопрос.
      if (set.format === 'mrs') throw new RuleSetError(INLINE_MRS_REFUSAL)
      const lines = set.payload ?? []
      const parsed = this.fromLines(set, lines, lines.join('\n').length)
      return { name: set.name, state: 'ready', count: parsed.count, bytes: parsed.bytes }
    }
    if (set.url === undefined) throw new RuleSetError('У набора не указана ссылка')

    const file = await this.cache.peek(set.url)
    if (file === null) return { name: set.name, state: 'missing' }

    const ttl = Math.max(this.limits.minTtlMs, (set.intervalSec ?? 0) * 1000)
    const cacheKey = `${set.url}|${set.behavior}|${set.format}`
    // Разобранное берём из памяти, если оно там есть: разбор `geoip/us` — это
    // 300 тысяч диапазонов, и повторять его на каждое открытие диалога незачем
    let parsed = this.parsed.get(cacheKey)?.parsed
    if (parsed === undefined) {
      parsed = { ...this.build(set, file.bytes), loadedAt: file.loadedAt }
      this.remember(cacheKey, parsed, file.loadedAt + ttl)
    }
    return {
      name: set.name,
      state: 'ready',
      count: parsed.count,
      bytes: parsed.bytes,
      loadedAt: file.loadedAt,
      stale: Date.now() - file.loadedAt > ttl,
    }
  }

  /**
   * Принудительная перезагрузка. `names` не задан — обновляем всё сетевое.
   * Причина неудачи доезжает до ответа: без неё состояние стало бы «не
   * загружен», и пользователь жал бы кнопку по кругу, не понимая, что не так.
   */
  async refresh(sets: RuleSetDescriptor[], names?: string[]): Promise<RuleSetStatusItem[]> {
    // Качаем только внутри предела: без этого один запрос заказывал бы
    // столько загрузок, сколько дескрипторов уместилось в тело
    const wanted = this.withinDocumentLimit(sets).allowed.filter(
      (set) => set.kind === 'http' && (names === undefined || names.includes(set.name)),
    )
    const failures = new Map<string, string>()
    await this.pool(wanted, async (set) => {
      await this.forget(set)
      try {
        await this.load(set)
      } catch (err) {
        failures.set(
          set.name,
          err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
        )
      }
    })
    const items = await this.status(sets)
    return items.map((item) => {
      const reason = failures.get(item.name)
      return reason === undefined ? item : { ...item, state: 'error' as const, reason }
    })
  }

  /** Забыть набор целиком: и разобранное, и файл — иначе `load` вернёт старое */
  private async forget(set: RuleSetDescriptor): Promise<void> {
    if (set.url === undefined) return
    const cacheKey = `${set.url}|${set.behavior}|${set.format}`
    const remembered = this.parsed.get(cacheKey)
    if (remembered !== undefined) {
      this.parsedBytes -= remembered.parsed.bytes
      this.parsed.delete(cacheKey)
    }
    await this.cache.remove(set.url)
  }

  /**
   * Страница содержимого для просмотрщика. В отличие от `status`, качать можно:
   * пользователь сам открыл набор и ждёт именно его.
   *
   * `total` считается по ФАКТИЧЕСКИ перечисленному, а не берётся из заголовка:
   * у набора доменов ключей вдвое больше записей (на каждый домен ядро кладёт
   * и форму `+.`), а при поиске их вообще столько, сколько совпало. Заголовочный
   * `count` едет рядом отдельным полем — оба числа правда, и подменять одно
   * другим нельзя.
   */
  async page(
    set: RuleSetDescriptor,
    opts: { offset: number; limit: number; q?: string },
  ): Promise<RuleSetPage> {
    const parsed = await this.load(set)
    const q = opts.q?.trim().toLowerCase() ?? ''
    const items: string[] = []
    let total = 0
    for (const entry of parsed.entries()) {
      if (q !== '' && !entry.toLowerCase().includes(q)) continue
      total++
      if (total > opts.offset && items.length < opts.limit) items.push(entry)
    }
    return { total, offset: opts.offset, count: parsed.count, items }
  }
}

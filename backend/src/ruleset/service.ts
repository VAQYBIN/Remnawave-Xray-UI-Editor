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
}

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
  | { state: 'yes' | 'no'; count: number }
  | { state: 'lines'; lines: string[]; count: number }
  | { state: 'unavailable'; reason: string }

// Наборы `domain` и `ipcidr` приходят и из `.mrs`, и из текста, поэтому
// сервис держит не структуру, а то, у чего можно спросить: откуда взялся
// ответ, ему знать незачем
type Parsed =
  | { kind: 'domain'; matcher: DomainMatcher; count: number; bytes: number }
  | { kind: 'ipcidr'; matcher: IpMatcher; count: number; bytes: number }
  | { kind: 'classical'; lines: string[]; count: number; bytes: number }

/** Разобранный набор помнится не навсегда: у него тот же срок годности, что у файла */
interface Remembered {
  parsed: Parsed
  expiresAt: number
}

export class RuleSetService {
  private readonly cache: RuleSetCache
  /** Разобранное держим в памяти: набор подсетей крупной страны разбирается заметно */
  private readonly parsed = new Map<string, Remembered>()
  private parsedBytes = 0

  constructor(
    dataDir: string,
    private readonly net: FetchGuardOptions = {},
  ) {
    this.cache = new RuleSetCache(join(dataDir, 'rulesets'), { totalBytes: LIMITS.cacheBytes })
  }

  async match(
    target: { address: string; ip?: string },
    sets: RuleSetDescriptor[],
  ): Promise<Record<string, RuleSetAnswer>> {
    const answers: Record<string, RuleSetAnswer> = {}
    // Предел режет лишние наборы, а не весь запрос: документ с 65 наборами
    // обязан получить ответ по первым 64 и честную причину по остальным
    const allowed = sets.slice(0, LIMITS.setsPerDocument)
    for (const set of sets.slice(LIMITS.setsPerDocument)) {
      answers[set.name] = {
        state: 'unavailable',
        reason: `в документе больше ${LIMITS.setsPerDocument} наборов — этот не проверялся`,
      }
    }

    // Ни одна из этих задач не отклоняется: иначе Promise.all завершился бы на
    // первом же отказе, не дождавшись соседей, и часть наборов осталась бы без
    // ответа вовсе
    await Promise.all(
      allowed.map(async (set) => {
        try {
          answers[set.name] = this.answer(await this.load(set), target)
        } catch (err) {
          answers[set.name] = {
            state: 'unavailable',
            // Наружу пускаем только текст известного отказа: чужое исключение
            // выглядело бы как состояние набора и увело бы пользователя
            // разбираться с его документом вместо нашей ошибки
            reason: err instanceof RuleSetError ? err.message : 'не удалось прочитать набор',
          }
        }
      }),
    )

    return answers
  }

  private answer(parsed: Parsed, target: { address: string; ip?: string }): RuleSetAnswer {
    if (parsed.kind === 'classical') {
      return { state: 'lines', lines: parsed.lines, count: parsed.count }
    }
    if (parsed.kind === 'domain') {
      return { state: parsed.matcher.has(target.address) ? 'yes' : 'no', count: parsed.count }
    }
    // Без IP в цели набор подсетей не совпадает: резолвить домены сервер не
    // берётся, а догадка здесь стоила бы неверного маршрута
    const hit = target.ip !== undefined && parsed.matcher.has(target.ip)
    return { state: hit ? 'yes' : 'no', count: parsed.count }
  }

  private async load(set: RuleSetDescriptor): Promise<Parsed> {
    if (set.kind === 'inline') {
      if (set.format === 'mrs') throw new RuleSetError('Формат mrs не бывает встроенным в документ')
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

    const ttl = Math.max(LIMITS.minTtlMs, (set.intervalSec ?? 0) * 1000)
    const cached = await this.cache.read(set.url, ttl)

    let bytes: Uint8Array
    let loadedAt: number
    if (cached !== null) {
      bytes = cached.bytes
      loadedAt = cached.loadedAt
    } else {
      bytes = await fetchExternalBytes(set.url, {
        ...this.net,
        maxBytes: LIMITS.wireBytes,
      }).catch((err: unknown) => {
        throw new RuleSetError(
          `не удалось скачать: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
      loadedAt = Date.now()
      await this.cache.write(set.url, bytes)
    }

    const parsed = this.build(set, bytes)
    this.remember(cacheKey, parsed, loadedAt + ttl)
    return parsed
  }

  private build(set: RuleSetDescriptor, bytes: Uint8Array): Parsed {
    const size = bytes.byteLength

    if (set.format === 'mrs') {
      const file = parseMrs(bytes, LIMITS.plainBytes)
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
      return file.behavior === 'domain'
        ? {
            kind: 'domain',
            matcher: domainMatcher(readDomainSet(file.body)),
            count: file.count,
            bytes: size,
          }
        : {
            kind: 'ipcidr',
            matcher: ipMatcher(readIpCidrSet(file.body)),
            count: file.count,
            bytes: size,
          }
    }

    return this.fromLines(set, parsePayload(Buffer.from(bytes).toString('utf8'), set.format), size)
  }

  /** Разбор общий для текстового файла и для встроенного в документ списка */
  private fromLines(set: RuleSetDescriptor, lines: string[], size: number): Parsed {
    if (set.behavior === 'classical') {
      if (lines.length > LIMITS.classicalLines) {
        throw new RuleSetError(`в наборе больше ${LIMITS.classicalLines} строк`)
      }
      return { kind: 'classical', lines, count: lines.length, bytes: size }
    }
    if (set.behavior === 'domain') {
      return {
        kind: 'domain',
        matcher: domainSetFromLines(lines),
        count: lines.length,
        bytes: size,
      }
    }
    return {
      kind: 'ipcidr',
      matcher: ipCidrSetFromLines(lines),
      count: lines.length,
      bytes: size,
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
    while (this.parsedBytes > LIMITS.parsedBytes && this.parsed.size > 1) {
      const oldest = this.parsed.keys().next().value as string
      this.parsedBytes -= this.parsed.get(oldest)?.parsed.bytes ?? 0
      this.parsed.delete(oldest)
    }
  }
}

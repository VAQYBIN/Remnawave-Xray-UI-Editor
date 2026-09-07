// Сжатый префиксный бор (succinct trie) из `.mrs` с `behavior: domain`.
// Формат — `component/trie/domain_set_bin.go`, поиск — построчный порт
// `DomainSet.Has` из `component/trie/domain_set.go`. Документации на это нет,
// и пересказ своими словами здесь запрещён: у алгоритма нетривиальный откат по
// подстановке, а неверный ответ выглядел бы как знание.
//
// Ключи в наборе лежат ПЕРЕВЁРНУТЫМИ, поэтому цель читается с конца.
import { RuleSetError } from './errors.js'

/** Байты, значащие для поиска */
const DOT = 0x2e
const STAR = 0x2a // одна метка
const PLUS = 0x2b // всё остальное

export interface DomainSet {
  /**
   * Битовые карты 64-битных слов файла, разложенные по 32-битным: младшее
   * слово пары первым. Тогда бит `i` — это `words[i >>> 5]`, и `BigInt`,
   * который был бы здесь на порядок медленнее, не нужен.
   */
  leaves: Uint32Array
  labelBitmap: Uint32Array
  labels: Uint8Array
  /**
   * Префиксные суммы единиц по словам `labelBitmap`. В файле их нет — ядро
   * строит свои `ranks`/`selects` само. На ответ они не влияют, но без них
   * `select` линеен, а на наборе из ста тысяч доменов это десятки миллионов
   * операций на один запрос.
   */
  ranks: Int32Array
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return (x * 0x01010101) >>> 24
}

const getBit = (words: Uint32Array, i: number): number => {
  const w = words[i >>> 5]
  return w === undefined ? 0 : (w >>> (i & 31)) & 1
}

/** Сколько нулей в карте меток до i-го бита, не включая его */
function countZeros(ds: DomainSet, i: number): number {
  const w = i >>> 5
  const rest = i & 31
  const whole = ds.ranks[Math.min(w, ds.ranks.length - 1)] ?? 0
  const partial = rest === 0 ? 0 : popcount((ds.labelBitmap[w] ?? 0) & ((1 << rest) - 1))
  return i - (whole + partial)
}

/** Позиция k-й единицы в карте меток; нумерация с нуля */
function selectIthOne(ds: DomainSet, k: number): number {
  const words = ds.labelBitmap
  let lo = 0
  let hi = words.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (ds.ranks[mid]! <= k) lo = mid
    else hi = mid - 1
  }
  let seen = ds.ranks[lo]!
  const word = words[lo] ?? 0
  for (let b = 0; b < 32; b++) {
    if (((word >>> b) & 1) !== 0) {
      if (seen === k) return lo * 32 + b
      seen++
    }
  }
  throw new RuleSetError('Испорченный набор доменов: в карте меток не хватает единиц')
}

function readWords(body: Buffer, at: number): { words: Uint32Array; next: number } {
  if (at + 8 > body.length) throw new RuleSetError('Испорченный набор доменов: обрыв на длине массива')
  const n = Number(body.readBigInt64BE(at))
  const start = at + 8
  if (n < 1) throw new RuleSetError('Испорченный набор доменов: пустой массив')
  if (start + n * 8 > body.length) {
    throw new RuleSetError('Испорченный набор доменов: массив выходит за границу файла')
  }
  const words = new Uint32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const off = start + i * 8
    // uint64 записан big-endian; кладём младшую половину первой, чтобы
    // нумерация битов совпала с той, по которой ходит поиск
    words[i * 2] = body.readUInt32BE(off + 4)
    words[i * 2 + 1] = body.readUInt32BE(off)
  }
  return { words, next: start + n * 8 }
}

export function readDomainSet(body: Buffer): DomainSet {
  if (body.length < 1 || body[0] !== 1) {
    throw new RuleSetError(`Версия набора доменов ${body[0] ?? '?'} — редактор знает только первую`)
  }
  let at = 1
  const leaves = readWords(body, at)
  at = leaves.next
  const bitmap = readWords(body, at)
  at = bitmap.next

  if (at + 8 > body.length) throw new RuleSetError('Испорченный набор доменов: обрыв на длине меток')
  const labelsLen = Number(body.readBigInt64BE(at))
  at += 8
  if (labelsLen < 1 || at + labelsLen > body.length) {
    throw new RuleSetError('Испорченный набор доменов: метки выходят за границу файла')
  }

  // Тело обязано разобраться РОВНО до конца. Распаковщик zstd не проверяет
  // целостность кадра: у оборванной на середине загрузки заголовок цел, и без
  // этой проверки обрубок лёг бы в кэш как исправный набор
  if (at + labelsLen !== body.length) {
    throw new RuleSetError(
      `Испорченный набор доменов: разобрано ${at + labelsLen} байт из ${body.length}`,
    )
  }

  const words = bitmap.words
  const ranks = new Int32Array(words.length + 1)
  for (let i = 0; i < words.length; i++) ranks[i + 1] = ranks[i]! + popcount(words[i]!)

  return {
    leaves: leaves.words,
    labelBitmap: words,
    labels: body.subarray(at, at + labelsLen),
    ranks,
  }
}

/**
 * Есть ли домен в наборе. Построчный порт `DomainSet.Has`: метка `restart`
 * повторяет `goto RESTART` оригинала, стек хранит точки отката по «*».
 */
export function hasDomain(ds: DomainSet, key: string): boolean {
  if (key.length === 0) return false
  // Читаем цель с конца и приводим ASCII к нижнему регистру на лету — то же
  // самое делает revLowerAt в ядре, не создавая перевёрнутой копии строки
  const revLowerAt = (i: number): number => {
    const c = key.charCodeAt(key.length - 1 - i)
    return c >= 0x41 && c <= 0x5a ? c + 0x20 : c
  }

  let nodeId = 0
  let bmIdx = 0
  const stack: { bmIdx: number; index: number }[] = []

  for (let i = 0; i < key.length; i++) {
    restart: for (;;) {
      const c = revLowerAt(i)
      for (;; bmIdx++) {
        if (getBit(ds.labelBitmap, bmIdx) !== 0) {
          // Метки узла кончились. Если была подстановка «*» — откатываемся к
          // ней и пробуем следующую метку цели; если нет — совпадения нет
          const cursor = stack.pop()
          if (cursor === undefined) return false
          const nextNodeId = countZeros(ds, cursor.bmIdx + 1)
          let nextBmIdx = selectIthOne(ds, nextNodeId - 1) + 1
          let j = cursor.index
          while (j < key.length && revLowerAt(j) !== DOT) j++
          if (j === key.length) {
            if (getBit(ds.leaves, nextNodeId) !== 0) return true
            continue restart
          }
          let moved = false
          for (; nextBmIdx - nextNodeId < ds.labels.length; nextBmIdx++) {
            if (ds.labels[nextBmIdx - nextNodeId] === DOT) {
              bmIdx = nextBmIdx
              nodeId = nextNodeId
              i = j
              moved = true
              break
            }
          }
          if (moved) continue restart
          return false
        }
        const label = ds.labels[bmIdx - nodeId]
        if (label === PLUS) return true
        if (label === STAR) stack.push({ bmIdx, index: i })
        else if (label === c) break
      }
      nodeId = countZeros(ds, bmIdx + 1)
      bmIdx = selectIthOne(ds, nodeId - 1) + 1
      break
    }
  }

  return getBit(ds.leaves, nodeId) !== 0
}

/** Что-то, у чего можно спросить про домен: бор из `.mrs` либо текстовый набор */
export interface DomainMatcher {
  has(domain: string): boolean
}

export const domainMatcher = (ds: DomainSet): DomainMatcher => ({
  has: (domain) => hasDomain(ds, domain),
})

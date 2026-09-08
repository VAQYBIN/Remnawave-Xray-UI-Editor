// Перечисление содержимого набора — то, чего не умеет поиск: `has()` отвечает
// про один ключ, а просмотрщику надо показать все.
//
// Обход бора — построчный порт `DomainSet.keys`/`Foreach`
// (`component/trie/domain_set.go`), по тому же правилу, что и `Has`: чужой
// алгоритм пересказу своими словами не подлежит. Ключи внутри лежат
// перевёрнутыми, поэтому наружу они отдаются развёрнутыми обратно — это и
// делает `Foreach` через `utils.Reverse`.
import { bytesToIp } from '../geo/match.js'
import { countZeros, getBit, selectIthOne, type DomainSet } from './domainSet.js'
import type { IpCidrSet } from './ipcidrSet.js'

export function* domainKeys(ds: DomainSet): Generator<string> {
  // `currentKey` оригинала: путь от корня, накапливаемый по байтам меток
  const key: number[] = []

  function* traverse(nodeId: number, bmIdx: number): Generator<string> {
    if (getBit(ds.leaves, nodeId) !== 0) {
      yield String.fromCharCode(...[...key].reverse())
    }
    for (; ; bmIdx++) {
      if (getBit(ds.labelBitmap, bmIdx) !== 0) return
      key.push(ds.labels[bmIdx - nodeId]!)
      const nextNodeId = countZeros(ds, bmIdx + 1)
      const nextBmIdx = selectIthOne(ds, nextNodeId - 1) + 1
      yield* traverse(nextNodeId, nextBmIdx)
      key.pop()
    }
  }

  yield* traverse(0, 0)
}

/** Адрес из 16 байт в целое: диапазоны сравниваются и складываются как числа */
function toBig(pair: Uint8Array, from: number): bigint {
  let v = 0n
  for (let i = 0; i < 16; i++) v = (v << 8n) | BigInt(pair[from + i]!)
  return v
}

function toBytes(value: bigint, v4: boolean): Uint8Array {
  const out = new Uint8Array(16)
  let rest = value
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  // У IPv4 ядро хранит v4-mapped форму; показываем привычные четыре октета
  return v4 ? out.subarray(12) : out
}

/**
 * Диапазон «начало—конец» обратно в подсети. Одним CIDR он выражается далеко не
 * всегда (10.0.0.1—10.0.0.4 — это три подсети), поэтому от начала откусывается
 * наибольший блок, который и выровнен по началу, и помещается в остаток.
 */
export function* cidrsOf(set: IpCidrSet): Generator<string> {
  for (const [ranges, v4] of [
    [set.v4, true],
    [set.v6, false],
  ] as [Uint8Array[], boolean][]) {
    const bits = v4 ? 32n : 128n
    for (const range of ranges) {
      let start = toBig(range, 0)
      const end = toBig(range, 16)
      while (start <= end) {
        // Сколько младших разрядов у начала нулевые — столько бит и можно
        // отдать под хвост подсети. У нуля их «все»: младшего единичного бита
        // там нет, и подсчёт разрядов зациклился бы
        //
        // `zeros` шире семейства не бывает, и это не удача, а следствие
        // раскладки: у IPv4 в разрядах 32–47 стоит префикс `::ffff:`, поэтому
        // нулевых младших разрядов там не больше 32; у IPv6 ненулевое начало
        // даёт не больше 127. Ограничение ниже — страховка от невозможного
        // состояния, а не работающая ветка: покрыть её тестом нечем, и
        // притворяться, что она проверена, не станем
        let size = bits
        if (start !== 0n) {
          let zeros = 0n
          while (((start >> zeros) & 1n) === 0n) zeros++
          if (zeros < size) size = zeros
        }
        // ...но не больше, чем осталось до конца диапазона
        while (size > 0n && (1n << size) - 1n > end - start) size--
        yield `${bytesToIp(toBytes(start, v4))}/${bits - size}`
        start += 1n << size
      }
    }
  }
}

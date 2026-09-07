import type { DomainSet } from '../src/ruleset/domainSet.js'

/**
 * Порт `DomainTrie.NewDomainSet` из `component/trie/domain_set.go` — ровно
 * настолько, чтобы собирать наборы с подстановками и проверять на них поиск.
 *
 * Осознанное упрощение: разворот строки побайтовый, а в ядре он по рунам. Для
 * ASCII это одно и то же, и все наши тестовые домены — ASCII. На не-ASCII
 * строитель соврал бы, поэтому в тестах их нет.
 *
 * Это НЕ проверка декодера: строитель и читатель написаны одной рукой и могут
 * ошибаться одинаково. Сверка с ядром — на настоящих фикстурах `.mrs`.
 */
export function buildDomainSet(domains: string[]): DomainSet {
  const keys = domains.map((d) => [...d].reverse().join('')).sort()
  if (keys.length === 0) throw new Error('пустой набор')

  const leaves: number[] = []
  const labelBitmap: number[] = []
  const labels: number[] = []

  const setBit = (bm: number[], i: number, v: number): void => {
    while (i >>> 5 >= bm.length) bm.push(0)
    if (v !== 0) bm[i >>> 5]! |= 1 << (i & 31)
  }

  const queue: { s: number; e: number; col: number }[] = [{ s: 0, e: keys.length, col: 0 }]
  let lIdx = 0
  for (let i = 0; i < queue.length; i++) {
    const elt = queue[i]!
    if (elt.col === keys[elt.s]!.length) {
      elt.s++
      setBit(leaves, i, 1)
    }
    for (let j = elt.s; j < elt.e; ) {
      const frm = j
      while (j < elt.e && keys[j]!.charCodeAt(elt.col) === keys[frm]!.charCodeAt(elt.col)) j++
      queue.push({ s: frm, e: j, col: elt.col + 1 })
      labels.push(keys[frm]!.charCodeAt(elt.col))
      setBit(labelBitmap, lIdx, 0)
      lIdx++
    }
    setBit(labelBitmap, lIdx, 1)
    lIdx++
  }
  // Обе карты дотягиваем до одной длины: читатель ходит по ним одинаково
  while (leaves.length < labelBitmap.length) leaves.push(0)

  const words = Uint32Array.from(labelBitmap)
  const ranks = new Int32Array(words.length + 1)
  for (let i = 0; i < words.length; i++) {
    ranks[i + 1] = ranks[i]! + popcount(words[i]!)
  }
  return { leaves: Uint32Array.from(leaves), labelBitmap: words, labels: Uint8Array.from(labels), ranks }
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return (x * 0x01010101) >>> 24
}

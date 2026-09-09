// Общий обход YAML-слияния `<<: *anchor`. Библиотека `yaml` не разворачивает
// `<<` сама по себе (парсинг идёт без опции `merge`), поэтому `map.get()`
// слияние не видит — этот обход нужен чтению модели (`groups.ts`), правкам
// (`edits.ts`: происхождение поля) и писателю (`write.ts`: замок по алиасу
// или слиянию, материализация) одинаково. Раньше это были почти одинаковые
// копии в разных файлах — расхождение в трактовке якорей это ровно тот класс
// тихой порчи документа, ради которого выбрана вся архитектура правок
// сплайсами. Модуль приватный: наружу (`index.ts`) не идёт, это внутренняя
// арифметика модели, а не API форм.

import { isAlias, isMap, isSeq } from 'yaml'
import type { MihomoDoc } from './parse'

/** Пара по СОБСТВЕННОМУ ключу отображения — без учёта `<<`. */
function ownPair(map: unknown, key: string) {
  if (!isMap(map)) return undefined
  return map.items.find((p) => (p.key as { value?: unknown } | null)?.value === key)
}

/**
 * Пара слияния `<<` в отображении. `parseMihomo` разбирает документ с опцией
 * `{ merge: true }` (нужна снимку `json` — задача 6): с ней библиотека сама
 * резолвит текст ключа `<<` через тег `tag:yaml.org,2002:merge` в
 * `Symbol('<<')`, а не оставляет его строкой — `ownPair(map, '<<')` после
 * этого перестаёт находить пару вовсе (строка `'<<'` не равна символу).
 * Ключ при этом физически остаётся в `items` (только с другим значением
 * `.value`), поэтому ищем и по строке, и по описанию символа — оба случая
 * относятся к ОДНОМУ И ТОМУ ЖЕ месту в документе, а какой из них даст парсер,
 * зависит только от опции `merge`, которая нашему коду не подчиняется.
 */
function mergePairOf(map: unknown) {
  if (!isMap(map)) return undefined
  return map.items.find((p) => {
    const value = (p.key as { value?: unknown } | null)?.value
    return value === '<<' || (typeof value === 'symbol' && value.description === '<<')
  })
}

/**
 * Узел значения ключа `key` в отображении `map` с учётом YAML-слияния `<<`:
 * на живых шаблонах Mihomo `behavior` набора правил, `type` провайдера и поля
 * группы сплошь и рядом заданы не собственным ключом, а якорем (`<<: *base`).
 * Без обхода `<<` такое поле всегда было бы `undefined`, хотя ядро видит
 * значение через слияние.
 *
 * Семантика YAML сохранена: собственный ключ побеждает всегда; если `<<` —
 * список алиасов, более ранний побеждает более поздний (первое совпадение по
 * порядку в цикле); поиск рекурсивный — алиас может сам ссылаться на
 * отображение со своим `<<`. `seen` защищает от зацикленных ссылок.
 */
export function mergedNode(md: MihomoDoc, map: unknown, key: string, seen: Set<unknown> = new Set()): unknown {
  if (!isMap(map) || seen.has(map)) return undefined
  seen.add(map)
  const own = ownPair(map, key)
  if (own) return own.value
  const mergePair = mergePairOf(map)
  if (!mergePair) return undefined
  const targets = isSeq(mergePair.value) ? mergePair.value.items : [mergePair.value]
  for (const target of targets) {
    const resolved = isAlias(target) ? target.resolve(md.doc) : target
    const value = mergedNode(md, resolved, key, seen)
    if (value !== undefined) return value
  }
  return undefined
}

/** Разворачивает алиас в узел, на который он ссылается (для значений вида `key: *alias`) */
export function dealias(md: MihomoDoc, node: unknown): unknown {
  return isAlias(node) ? node.resolve(md.doc) : node
}

/**
 * Есть ли значение ключа `key` в отображении `map` через слияние `<<`, БЕЗ учёта
 * собственного ключа отображения (вызывающий проверяет «own» отдельно — см.
 * `originAt` (`edits.ts`), которому важно различить «свой ключ» и «пришло через
 * якорь», а не просто «значение где-то есть»).
 */
export function mergedHas(md: MihomoDoc, map: unknown, key: string, seen: Set<unknown> = new Set()): boolean {
  if (!isMap(map) || seen.has(map)) return false
  seen.add(map)
  const mergePair = mergePairOf(map)
  if (mergePair === undefined) return false
  const targets = isSeq(mergePair.value) ? mergePair.value.items : [mergePair.value]
  return targets.some((target) => {
    const resolved = isAlias(target) ? target.resolve(md.doc) : target
    return ownPair(resolved, key) !== undefined || mergedHas(md, resolved, key, seen)
  })
}

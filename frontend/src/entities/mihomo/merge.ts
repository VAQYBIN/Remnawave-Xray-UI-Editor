// Общий обход YAML-слияния `<<: *anchor`. Библиотека `yaml` не разворачивает
// `<<` сама по себе (парсинг идёт без опции `merge`), поэтому `map.get()`
// слияние не видит — этот обход нужен и чтению модели (`groups.ts`), и правкам
// (`edits.ts`: происхождение поля, чтение поля с учётом слияний) одинаково.
// Раньше это были две почти одинаковые копии в `groups.ts` и `edits.ts`; третий
// вызывающий (`readFieldAt`) сделал бы их уже тремя — а расхождение в трактовке
// якорей это ровно тот класс тихой порчи документа, ради которого выбрана вся
// архитектура правок сплайсами. Модуль приватный: наружу (`index.ts`) не идёт,
// это внутренняя арифметика модели, а не API форм.

import { isAlias, isMap, isSeq } from 'yaml'
import type { MihomoDoc } from './parse'

/** Пара по СОБСТВЕННОМУ ключу отображения — без учёта `<<`. */
function ownPair(map: unknown, key: string) {
  if (!isMap(map)) return undefined
  return map.items.find((p) => (p.key as { value?: unknown } | null)?.value === key)
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
  const mergePair = ownPair(map, '<<')
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
 * `originAt`/`fieldOrigin`, которым важно различить «свой ключ» и «пришло через
 * якорь», а не просто «значение где-то есть»).
 */
export function mergedHas(md: MihomoDoc, map: unknown, key: string, seen: Set<unknown> = new Set()): boolean {
  if (!isMap(map) || seen.has(map)) return false
  seen.add(map)
  const mergePair = ownPair(map, '<<')
  if (mergePair === undefined) return false
  const targets = isSeq(mergePair.value) ? mergePair.value.items : [mergePair.value]
  return targets.some((target) => {
    const resolved = isAlias(target) ? target.resolve(md.doc) : target
    return ownPair(resolved, key) !== undefined || mergedHas(md, resolved, key, seen)
  })
}

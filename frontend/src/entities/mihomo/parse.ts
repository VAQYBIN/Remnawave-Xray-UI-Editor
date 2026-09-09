// Разбор шаблона Mihomo. Документ библиотеки `yaml` сохраняется целиком: из него
// берутся не только значения, но и диапазоны узлов в исходном тексте — на них
// строятся все правки (см. edits.ts). Модель обратно в текст не печатается.

import { isMap, isNode, parseDocument, type Document } from 'yaml'
import type { ValidationIssue } from '../xray/config'

export interface Range {
  from: number
  to: number
}

export interface MihomoDoc {
  text: string
  doc: Document.Parsed
  /** Только ошибки разбора YAML; смысловые проверки живут в validate.ts */
  issues: ValidationIssue[]
  /**
   * Снимок ЗНАЧЕНИЙ документа (toJS с развёрнутыми алиасами и слияниями) —
   * модель для форм, спуска по схеме и валидации устаревшего. Узлы дерева и
   * диапазоны — по-прежнему в `doc`: писать надо туда, читать значения — отсюда.
   * У пустого и у неразбираемого документа — `{}`: форма на нём рисует «Ещё
   * поля», а не падает на toJS с нерешённым алиасом.
   */
  json: unknown
}

/**
 * Снимок значений документа. `maxAliasCount: -1` отключает защиту от
 * «billion laughs» (документ шаблона — доверенный ввод пользователя, а не
 * произвольный чужой YAML), иначе `toJS` бросает на документе с несколькими
 * использованиями одного якоря раньше третьего дубля. Любое исключение (в
 * том числе неразрешимый алиас) — `{}`, а не падение формы.
 */
function snapshot(doc: Document.Parsed): unknown {
  try {
    const js: unknown = doc.toJS({ maxAliasCount: -1 })
    return typeof js === 'object' && js !== null && !Array.isArray(js) ? js : {}
  } catch {
    return {}
  }
}

/**
 * Начало сообщения об ошибке РАЗБОРА — единственный признак, по которому
 * читающая сторона отличает её от смысловых проверок validate.ts. Сохранение
 * шаблона Mihomo блокируется только на ней: документ, который не разбирается,
 * панель примет, а подписка сломается. Отдельного поля в `ValidationIssue`
 * ради этого не заводим, но и сравнивать текст на месте нельзя — связь между
 * двумя файлами держалась бы на совпадении строки.
 */
export const YAML_SYNTAX_PREFIX = 'Синтаксис YAML'

export function parseMihomo(text: string): MihomoDoc {
  // `merge: true` разворачивает `<<` в собственную пару документа (с тегом
  // `!!merge`, а не голым ключом) — снимку это и нужно: без опции `toJS` не
  // видит слияние вовсе. `mergedNode`/`mergedHas` (merge.ts) продолжают сами
  // обходить `<<` по `items` — с `merge: true` он там и остаётся, только
  // значение ключа становится `Symbol('<<')`, а не строкой (`merge.ts`
  // ищет пару по обоим случаям — см. `mergePairOf`).
  const doc = parseDocument(text, { keepSourceTokens: true, merge: true })
  const issues: ValidationIssue[] = doc.errors.map((e) => ({
    parts: [],
    path: '',
    message: `${YAML_SYNTAX_PREFIX}: ${e.message}`,
    level: 'error' as const,
    // Путь у синтаксической ошибки назвать нечем — документ на этом месте и
    // не разобрался, — зато место известно точно. Берём его здесь, у самой
    // ошибки: читающей стороне взять его больше неоткуда, а сопоставление
    // «i-я диагностика ↔ i-я ошибка документа» держалось бы на порядке
    at: clampRange(e.pos, text.length),
  }))
  return { text, doc, issues, json: snapshot(doc) }
}

/**
 * Смещения ошибки — в границы текста. Библиотека ставит конец ошибки за
 * последним символом на незакрытой конструкции, а CodeMirror на диапазоне
 * вне документа бросает.
 */
function clampRange([from, to]: [number, number], length: number): Range {
  const start = Math.min(Math.max(from, 0), length)
  return { from: start, to: Math.min(Math.max(to, start), length) }
}

/**
 * Диапазон узла в исходном тексте. `node.range` — тройка
 * [начало, конец значения, конец узла с завершающими пробелами и комментарием];
 * правкам нужен второй элемент, иначе замена съест чужой комментарий.
 */
export function rangeOf(node: unknown): Range | null {
  // node.range в типах yaml объявлен как `Range | null | undefined` (Range — их тройка,
  // а не наш интерфейс): под strict-проверкой одного сравнения с undefined мало.
  if (!isNode(node) || !node.range) return null
  const [from, to] = node.range
  return { from, to }
}

/** Узел секции верхнего уровня; undefined — секции в документе нет */
export function sectionNode(md: MihomoDoc, key: string): unknown {
  const contents = md.doc.contents
  if (!isMap(contents)) return undefined
  return contents.get(key, true) ?? undefined
}

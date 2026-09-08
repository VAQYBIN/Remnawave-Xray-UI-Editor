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
  const doc = parseDocument(text, { keepSourceTokens: true })
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
  return { text, doc, issues }
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

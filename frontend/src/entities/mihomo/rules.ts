// Правило Mihomo — строка вида ТИП,значение,цель[,модификатор]. Логические типы
// прячут вложенные условия в скобках, поэтому разрез идёт по запятым ВЕРХНЕГО
// уровня: наивный split(',') разорвал бы ((DOMAIN,a),(NETWORK,UDP)) пополам.

import { isScalar, isSeq } from 'yaml'
import { rangeOf, sectionNode, type MihomoDoc, type Range } from './parse'

export const RULE_TYPES = [
  'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'DOMAIN-REGEX', 'GEOSITE',
  'IP-CIDR', 'IP-CIDR6', 'IP-SUFFIX', 'IP-ASN', 'GEOIP',
  'SRC-GEOIP', 'SRC-IP-ASN', 'SRC-IP-CIDR', 'SRC-IP-SUFFIX',
  'DST-PORT', 'SRC-PORT', 'IN-PORT', 'IN-TYPE', 'IN-USER', 'IN-NAME',
  'PROCESS-PATH', 'PROCESS-PATH-WILDCARD', 'PROCESS-PATH-REGEX',
  'PROCESS-NAME', 'PROCESS-NAME-WILDCARD', 'PROCESS-NAME-REGEX',
  'UID', 'NETWORK', 'DSCP', 'RULE-SET', 'SUB-RULE',
  'AND', 'OR', 'NOT', 'MATCH',
] as const

/**
 * Типы без значения: сразу после типа идёт цель. Экспортирован ради формы
 * правила: ей ответ нужен ДО разбора строки (у только что выбранного типа
 * значения ещё нет), а вторая копия множества разошлась бы с этой молча — и
 * ровно тогда, когда в ядре появится второй такой тип.
 */
export const NO_PAYLOAD = new Set(['MATCH'])

export const RULE_MODIFIERS = ['no-resolve', 'src'] as const

export interface MihomoRule {
  type: string
  payload?: string
  target: string
  modifiers: string[]
  raw: string
}

export function splitTopLevel(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

export function parseRule(raw: string): MihomoRule | null {
  const parts = splitTopLevel(raw.trim())
  if (parts.length < 2) return null
  const type = parts[0]!.trim()
  if (type === '') return null
  if (NO_PAYLOAD.has(type)) {
    return { type, target: parts[1]!, modifiers: parts.slice(2), raw }
  }
  if (parts.length < 3) return null
  return { type, payload: parts[1], target: parts[2]!, modifiers: parts.slice(3), raw }
}

export function formatRule(rule: MihomoRule): string {
  const parts = [rule.type]
  if (rule.payload !== undefined) parts.push(rule.payload)
  parts.push(rule.target, ...rule.modifiers)
  return parts.join(',')
}

export interface RuleEntry {
  index: number
  /** null — строку разобрать не удалось; validate.ts сделает из этого ошибку */
  rule: MihomoRule | null
  /**
   * Точный срез исходного ТЕКСТА документа по `range` — включая кавычки, если строка
   * правила была в кавычках YAML (`- "MATCH,DIRECT"`). Это не то же самое, что
   * `rule.raw`: тот хранит значение, из которого разобран `rule` (кавычки уже сняты
   * YAML-парсером). `raw` здесь нужен будущим правкам сплайсами по `range` — заменять
   * им можно только сам исходный текст, а не собранное из полей `rule`.
   */
  raw: string
  range: Range
}

/**
 * Разбор строк-правил ПРОИЗВОЛЬНОГО списка: секции `rules` либо любого списка
 * внутри `sub-rules`. Единственное место, где строка документа превращается в
 * правило, — до этого тот же десяток строк был переписан трижды (здесь, в
 * `edits.ts` и в `trace.ts`), и каждая копия несла свой пересказ приёма ниже.
 *
 * Разбираем ДЕКОДИРОВАННОЕ значение скаляра, а не срез текста: в кавычках
 * (`- "MATCH,DIRECT"`) их YAML уже снял, а разбор среза как есть загнал бы
 * кавычку в тип правила (`"MATCH`) — валидное правило стало бы диагностикой на
 * ровном месте. Не список — пустой результат: «списка нет» и «список пуст»
 * различает вызывающий, ему для этого хватает самого узла.
 */
export function ruleEntriesOf(md: MihomoDoc, node: unknown): RuleEntry[] {
  if (!isSeq(node)) return []
  const out: RuleEntry[] = []
  node.items.forEach((item, index) => {
    const range = rangeOf(item)
    if (range === null) return
    const raw = md.text.slice(range.from, range.to)
    const value = isScalar(item) && typeof item.value === 'string' ? item.value : raw
    out.push({ index, rule: parseRule(value), raw, range })
  })
  return out
}

export function rulesOf(md: MihomoDoc): RuleEntry[] {
  return ruleEntriesOf(md, sectionNode(md, 'rules'))
}

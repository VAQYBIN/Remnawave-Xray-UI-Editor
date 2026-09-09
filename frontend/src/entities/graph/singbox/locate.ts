// Соответствие «путь диагностики → узел графа». Живёт рядом с buildGraph,
// потому что схему id (`inbound:<tag>`, `rule:<index>`, `group:<tag>`,
// `out:<tag>`) задаёт именно он.
//
// Диагностики адресуют выход ПОЗИЦИЕЙ в массиве, а узел графа назван ТЕГОМ:
// перевод между ними — работа этого файла, и делать его где-то ещё значило бы
// завести вторую схему id.

import type { PathParts, ValidationIssue } from '../../xray/config'
import type { IssueCount } from '../types'
import { GROUP_OUTBOUND_TYPES, outboundsOf } from '../../singbox/outbounds'
import { rulesOf } from '../../singbox/rules'
import type { SingboxDoc } from '../../singbox/types'

/**
 * Корневые секции без узлов на холсте: у них нет колонки графа, но диагностика
 * по ним не молчит — она открывает панель «Документ» (см. SingboxDocPanel).
 */
const DOC_HEADS = new Set(['log', 'dns', 'ntp', 'certificate', 'experimental'])

export function singboxNodeIdForPath(parts: PathParts, doc: SingboxDoc): string | null {
  const [head, second, third, fourth] = parts

  if (head === 'inbounds' && typeof second === 'number') {
    const inbounds = Array.isArray(doc.inbounds) ? doc.inbounds : []
    const tag = inbounds[second]?.tag
    return typeof tag === 'string' && tag !== '' ? `inbound:${tag}` : null
  }

  if (head === 'outbounds' || head === 'endpoints') {
    // Диагностика уровня всей секции узла не имеет: показать её на первом
    // попавшемся выходе значило бы соврать про место проблемы
    if (typeof second !== 'number') return null
    const list = head === 'outbounds' ? outboundsOf(doc) : Array.isArray(doc.endpoints) ? doc.endpoints : []
    const item = list[second]
    if (item === undefined) return null
    const tag = (item as { tag?: unknown }).tag
    if (typeof tag !== 'string' || tag === '') return null
    const type = (item as { type?: unknown }).type
    return typeof type === 'string' && GROUP_OUTBOUND_TYPES.has(type) ? `group:${tag}` : `out:${tag}`
  }

  if (head === 'route' && second === 'rules' && typeof third === 'number') {
    return rulesOf(doc)[third] === undefined ? null : `rule:${third}`
  }

  // Вложенное правило логического правила рисуется той же карточкой, что и само
  // правило: отдельных узлов у вложенных условий на графе нет по устройству
  if (head === 'route' && second === 'rules' && typeof third === 'number' && fourth === 'rules') {
    return rulesOf(doc)[third] === undefined ? null : `rule:${third}`
  }

  // Секции без узлов на холсте живут в панели «Документ»: клик по диагностике
  // открывает её, а не молчит. Правила маршрута обработаны выше — они на холсте
  if (typeof head === 'string' && DOC_HEADS.has(head)) return 'doc:settings'
  if (head === 'route' && second !== 'rules') return 'doc:settings'

  return null
}

export function singboxIssueCounts(
  issues: ValidationIssue[],
  doc: SingboxDoc,
): Record<string, IssueCount> {
  const counts: Record<string, IssueCount> = {}
  for (const issue of issues) {
    const id = singboxNodeIdForPath(issue.parts, doc)
    if (id === null) continue
    const entry = (counts[id] ??= { errors: 0, warnings: 0 })
    if (issue.level === 'error') entry.errors += 1
    else entry.warnings += 1
  }
  return counts
}

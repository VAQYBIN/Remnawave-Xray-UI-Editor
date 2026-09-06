// Соответствие «путь диагностики → узел графа». Живёт в entities/graph/mihomo,
// потому что схему id (`group:<name>`, `rule:<index>`, `provider:<name>`,
// `hosts:<owner>`, `builtin:<name>`) задаёт buildMihomoGraph.

import { groupsOf, providersOf } from '../../mihomo/groups'
import type { MihomoDoc } from '../../mihomo/parse'
import { rulesOf } from '../../mihomo/rules'
import type { PathParts, ValidationIssue } from '../../xray/config'
import type { IssueCount } from '../types'

export function mihomoNodeIdForPath(parts: PathParts, md: MihomoDoc): string | null {
  const [head, second] = parts

  if (head === 'rules' && typeof second === 'number') {
    return rulesOf(md).some((r) => r.index === second) ? `rule:${second}` : null
  }

  if (head === 'proxy-groups') {
    // Диагностика уровня всей секции (кольцо групп) узла не имеет: показать её
    // на первой попавшейся группе значило бы соврать про место проблемы
    if (typeof second !== 'number') return null
    const name = groupsOf(md).find((g) => g.index === second)?.name
    return name === undefined ? null : `group:${name}`
  }

  if (head === 'proxy-providers' && typeof second === 'string') {
    return providersOf(md).some((p) => p.name === second) ? `provider:${second}` : null
  }

  // rule-providers узлами не рисуются — это словарь, а не маршрут (см. спеку)
  return null
}

export function mihomoIssueCounts(
  issues: ValidationIssue[],
  md: MihomoDoc,
): Record<string, IssueCount> {
  const counts: Record<string, IssueCount> = {}
  for (const issue of issues) {
    const id = mihomoNodeIdForPath(issue.parts, md)
    if (!id) continue
    const cur = (counts[id] ??= { errors: 0, warnings: 0 })
    if (issue.level === 'error') cur.errors += 1
    else cur.warnings += 1
  }
  return counts
}

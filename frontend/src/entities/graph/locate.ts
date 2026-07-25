// Соответствие «путь диагностики → узел графа». Живёт в entities/graph, потому что
// схему id (`in:<tag>`, `out:<tag>`, `rule:<index>`, `dns`) задаёт buildGraph.

import type { PathParts, ValidationIssue, XrayConfig } from '../xray'
import type { IssueCount } from './types'

export function nodeIdForPath(parts: PathParts, config: XrayConfig): string | null {
  const [head, second, third] = parts

  if (head === 'dns') return config.dns ? 'dns' : null

  if (head === 'inbounds' && typeof second === 'number') {
    const tag = config.inbounds?.[second]?.tag
    return tag ? `in:${tag}` : null
  }

  if (head === 'outbounds' && typeof second === 'number') {
    const tag = config.outbounds?.[second]?.tag
    return tag ? `out:${tag}` : null
  }

  if (head === 'routing' && second === 'rules' && typeof third === 'number') {
    return config.routing?.rules?.[third] ? `rule:${third}` : null
  }

  return null
}

export function issueCountsByNode(
  issues: ValidationIssue[],
  config: XrayConfig,
): Record<string, IssueCount> {
  const counts: Record<string, IssueCount> = {}
  for (const issue of issues) {
    const id = nodeIdForPath(issue.parts, config)
    if (!id) continue
    // Дубликаты тегов buildGraph пропускает: обе проблемы садятся на тот
    // единственный узел, который реально нарисован
    const cur = (counts[id] ??= { errors: 0, warnings: 0 })
    if (issue.level === 'error') cur.errors += 1
    else cur.warnings += 1
  }
  return counts
}

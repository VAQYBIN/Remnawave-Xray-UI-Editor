// Соответствие «путь диагностики → узел графа». Живёт в entities/graph/mihomo,
// потому что схему id (`group:<name>`, `rule:<index>`, `subrule:<name>`,
// `provider:<name>`, `proxy:<name>`, `hosts:<owner>`, `builtin:<name>`) задаёт
// buildMihomoGraph.

import { groupsOf, providersOf, proxiesOf, subRuleNames } from '../../mihomo/groups'
import type { MihomoDoc } from '../../mihomo/parse'
import { rulesOf } from '../../mihomo/rules'
import type { PathParts, ValidationIssue } from '../../xray/config'
import type { IssueCount } from '../types'

/**
 * Пути настроек документа — без узла на холсте вовсе, ведут на псевдоузел
 * «Документ». Список закрыт намеренно (а не «всё, что не холст», в одну
 * сторону): он должен читаться отдельно от `CANVAS_KEYS`, а не выводиться из
 * него, — секция маршрута появится в модели раньше, чем про неё вспомнят
 * здесь, и тогда лучше молчаливое «не узел», чем ложный `doc:settings`.
 */
const SETTINGS_KEYS = new Set([
  'rule-providers', 'dns', 'tun', 'sniffer', 'profile', 'ntp', 'experimental',
  'hosts', 'listeners', 'tunnels', 'tls', 'remnawave',
])

/** Ключи корня, у которых узлы на холсте есть — всё остальное строкового ключа уходит на «Документ» */
const CANVAS_KEYS = new Set(['rules', 'proxy-groups', 'sub-rules', 'proxy-providers', 'proxies'])

export function mihomoNodeIdForPath(parts: PathParts, md: MihomoDoc): string | null {
  const [head, second] = parts

  if (head === 'rules' && typeof second === 'number') {
    return rulesOf(md).some((r) => r.index === second) ? `rule:${second}` : null
  }

  if (head === 'proxies' && typeof second === 'number') {
    const name = proxiesOf(md).find((p) => p.index === second)?.name
    return name === undefined ? null : `proxy:${name}`
  }

  if (head === 'proxy-groups') {
    // Диагностика уровня всей секции (кольцо групп) узла не имеет: показать её
    // на первой попавшейся группе значило бы соврать про место проблемы
    if (typeof second !== 'number') return null
    const name = groupsOf(md).find((g) => g.index === second)?.name
    return name === undefined ? null : `group:${name}`
  }

  // Подсписок правил рисуется ОДНОЙ карточкой: отдельных узлов у его правил
  // нет по устройству графа, поэтому диагностика любой глубины внутри
  // `sub-rules/<имя>` ведёт на узел самого подсписка. Диагностика уровня всей
  // секции (`['sub-rules']`) узла не имеет — как и у `proxy-groups`: показать
  // её на первом попавшемся подсписке значило бы соврать про место проблемы.
  if (head === 'sub-rules' && typeof second === 'string') {
    return subRuleNames(md).includes(second) ? `subrule:${second}` : null
  }

  if (head === 'proxy-providers' && typeof second === 'string') {
    return providersOf(md).some((p) => p.name === second) ? `provider:${second}` : null
  }

  // Всё остальное с ключом-строкой в корне — либо перечисленный словарь
  // (`rule-providers`, `dns`, `tun`…), либо корневой скаляр (`mode`), у
  // которого узла на холсте не было и не будет: обе категории ведут на
  // псевдоузел «Документ», а не молчат, — иначе диагностика по такому пути
  // была бы никуда не кликабельна, а панель «Документ» её всё равно покажет.
  if (typeof head === 'string' && (SETTINGS_KEYS.has(head) || !CANVAS_KEYS.has(head))) return 'doc:settings'

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

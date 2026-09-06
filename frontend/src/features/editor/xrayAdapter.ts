// Реализация адаптера поверх существующего кода Xray. Ни одной новой строки
// логики: только раскладка уже работающих функций по полям интерфейса.

import { validateXrayConfig, type XrayConfig } from '../../entities/xray'
import { issueCountsByNode, nodeIdForPath } from '../../entities/graph/locate'
import { searchNodes } from '../../entities/graph/search'
import type { DocumentAdapter } from './documentAdapter'

export const xrayAdapter: DocumentAdapter<XrayConfig> = {
  textTabLabel: 'JSON',
  parse: (text) => {
    const validation = validateXrayConfig(text)
    return {
      // Топология строится только по документу, прошедшему схему
      model: validation.ok ? (validation.config as XrayConfig) : undefined,
      issues: validation.issues,
    }
  },
  issueCounts: (issues, config) => issueCountsByNode(issues, config),
  nodeIdForPath: (parts, config) => nodeIdForPath(parts, config),
  search: (config, ctx, query) => searchNodes(config, ctx, query),
}

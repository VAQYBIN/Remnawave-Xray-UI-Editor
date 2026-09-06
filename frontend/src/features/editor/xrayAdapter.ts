// Реализация адаптера поверх существующего кода Xray. Ни одной новой строки
// логики: только раскладка уже работающих функций по полям интерфейса.

import { validateXrayConfig, type XrayConfig } from '../../entities/xray'
import { issueCountsByNode, nodeIdForPath } from '../../entities/graph/locate'
import { searchNodes } from '../../entities/graph/search'
import type { DocumentAdapter } from './documentAdapter'

/**
 * Разбор с памятью на одну запись по тексту. Один и тот же документ проверяется
 * дважды: ядро зовёт `parse` ради модели и диагностик, а `useConfigDraft` —
 * ради публичного `validation` (страницы шлют `validation.config` в панель, и
 * там он заполнен даже при провале схемы, когда модели уже нет). Внутри
 * `validateXrayConfig` — `JSON.parse`, разбор схемы и проверка целостности
 * целиком, а на вкладке JSON это попадает на каждое нажатие клавиши.
 *
 * Записей ровно одна: в один момент редактируется один документ, а лишняя
 * ёмкость — лишнее место, где можно ошибиться. Ключ — сам текст, вытеснение
 * только следующим текстом: никаких сроков жизни.
 */
let lastText: string | undefined
let lastResult: ReturnType<typeof validateXrayConfig> | undefined

export function validateCached(text: string): ReturnType<typeof validateXrayConfig> {
  if (lastResult !== undefined && lastText === text) return lastResult
  lastResult = validateXrayConfig(text)
  lastText = text
  return lastResult
}

export const xrayAdapter: DocumentAdapter<XrayConfig> = {
  textTabLabel: 'JSON',
  parse: (text) => {
    const validation = validateCached(text)
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

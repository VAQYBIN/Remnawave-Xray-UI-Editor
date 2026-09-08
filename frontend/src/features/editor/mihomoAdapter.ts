// Адаптер документа для шаблонов Mihomo. Модель — разобранный документ
// библиотеки `yaml` целиком: из него берутся и значения, и диапазоны узлов,
// на которых стоят все правки.

import { parseMihomo, validateMihomo, type MihomoDoc } from '../../entities/mihomo'
import { searchMihomo } from '../../entities/mihomo/search'
import { mihomoIssueCounts, mihomoNodeIdForPath } from '../../entities/graph/mihomo/locate'
import type { DocumentAdapter } from './documentAdapter'

export const mihomoAdapter: DocumentAdapter<MihomoDoc> = {
  parse: (text) => {
    const md = parseMihomo(text)
    return {
      // Модель гасим ТОЛЬКО когда разбирать нечего вовсе. Синтаксическая ошибка
      // ниже по тексту оставляет документ частично разобранным, и граф по нему
      // строится: спека прямо требует, чтобы одна опечатка не лишала картинки.
      model: md.doc.contents === null ? undefined : md,
      issues: validateMihomo(md),
    }
  },
  issueCounts: (issues, md) => mihomoIssueCounts(issues, md),
  nodeIdForPath: (parts, md) => mihomoNodeIdForPath(parts, md),
  // Контекст графа у шаблона пуст — сквадов здесь нет
  search: (md, _ctx, query) => searchMihomo(md, query),
}

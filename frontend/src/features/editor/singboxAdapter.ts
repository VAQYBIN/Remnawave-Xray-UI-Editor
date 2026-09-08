// Адаптер документа для шаблонов sing-box. Ни одной новой строки логики: только
// раскладка уже работающих функций модели по полям интерфейса — как у Xray.

import { parseSingbox, validateSingbox, type SingboxDoc } from '../../entities/singbox'
import { searchSingbox } from '../../entities/singbox/search'
import { singboxIssueCounts, singboxNodeIdForPath } from '../../entities/graph/singbox/locate'
import type { DocumentAdapter } from './documentAdapter'

export const singboxAdapter: DocumentAdapter<SingboxDoc> = {
  parse: (text) => {
    const res = parseSingbox(text)
    // Модель гасим ровно тогда, когда её нет: разбор либо дал документ, либо
    // объяснил, почему не дал. Диагностики возвращаются в обоих случаях
    if (res.doc === undefined) return { model: undefined, issues: res.issues }
    return { model: res.doc, issues: [...res.issues, ...validateSingbox(res.doc)] }
  },
  issueCounts: (issues, doc) => singboxIssueCounts(issues, doc),
  nodeIdForPath: (parts, doc) => singboxNodeIdForPath(parts, doc),
  // Контекст графа у шаблона пуст — сквадов здесь нет
  search: (doc, _ctx, query) => searchSingbox(doc, query),
}

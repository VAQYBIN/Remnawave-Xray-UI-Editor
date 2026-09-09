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
      // Модель есть ВСЕГДА, включая пустой документ: это законная отправная
      // точка сценария «с нуля», и холст на ней показывает пустой док с
      // кнопкой «+ Добавить», а не гаснет — та же причина, по которой
      // синтаксическая ошибка ниже по тексту не лишает картинки: документ
      // остаётся частично разобранным, и граф по нему строится.
      model: md,
      issues: validateMihomo(md),
    }
  },
  issueCounts: (issues, md) => mihomoIssueCounts(issues, md),
  nodeIdForPath: (parts, md) => mihomoNodeIdForPath(parts, md),
  // Контекст графа у шаблона пуст — сквадов здесь нет
  search: (md, _ctx, query) => searchMihomo(md, query),
}

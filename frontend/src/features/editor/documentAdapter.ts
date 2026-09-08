// Что оболочке редактора нужно знать о документе, чтобы не знать о нём больше
// ничего. Реализаций две: xrayAdapter (JSON-конфиг Xray) и mihomoAdapter (YAML
// шаблона Mihomo). Ядро черновика (useDocumentDraft) читает ТОЛЬКО отсюда.
//
// Графа и текстовой вкладки здесь нет намеренно: обе приходят в оболочку слотами
// (ReactNode) от страницы, и ядро их не вызывает. Поле, которого никто не читает,
// устаревает молча — заводить его авансом хуже, чем добавить, когда появится
// вызывающий.

import type { PathParts, ValidationIssue } from '../../entities/xray'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import type { SearchHit } from '../../entities/graph/search'

export interface DocumentAdapter<TModel> {
  /**
   * Разбор текста. `model === undefined` — документ не разбирается, граф не
   * строится, оболочка показывает пустое состояние. Диагностики возвращаются в
   * обоих случаях: одна опечатка не должна лишать пользователя объяснения.
   */
  parse(text: string): { model: TModel | undefined; issues: ValidationIssue[] }
  /** Счётчики проблем по id узла графа — рисуются значком на карточке */
  issueCounts(issues: ValidationIssue[], model: TModel): Record<string, IssueCount>
  /** Путь диагностики → id узла графа; null — узла для этого пути нет */
  nodeIdForPath(parts: PathParts, model: TModel): string | null
  /** Поиск узлов по строке запроса */
  search(model: TModel, ctx: GraphContext, query: string): SearchHit[]
}

import type { ValidationIssue } from '../../entities/xray'

/**
 * Список диагностик. Пустой список сюда не приходит: и статус-бар
 * (`EditorShell`), и диалог сохранения показывают список только при непустых
 * диагностиках, а «проблем нет» говорят сами — своими словами, потому что
 * слово «конфиг» верно для Xray и неверно для шаблона подписки Mihomo.
 * Вторая копия того же сообщения жила здесь параметром, до которого не
 * доходило исполнение.
 */
export function IssueList({
  issues,
  onSelect,
  canSelect,
}: {
  issues: ValidationIssue[]
  onSelect?: (issue: ValidationIssue) => void
  /** Куда переходить, решает вызывающий: на топологии узел есть не у всякой проблемы */
  canSelect?: (issue: ValidationIssue) => boolean
}) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {issues.map((issue, i) => {
        const body = (
          <>
            <span
              className={
                issue.level === 'error' ? 'issue-badge issue-error' : 'issue-badge issue-warning'
              }
            >
              {issue.level === 'error' ? 'ошибка' : 'внимание'}
            </span>
            {issue.path && <span className="mono muted">{issue.path}</span>}
            <span>{issue.message}</span>
          </>
        )
        const selectable = onSelect !== undefined && (canSelect === undefined || canSelect(issue))
        return (
          <li key={i}>
            {selectable ? (
              <button
                type="button"
                className="issue-row issue-row-link"
                onClick={() => onSelect(issue)}
              >
                {body}
              </button>
            ) : (
              <div className="issue-row">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

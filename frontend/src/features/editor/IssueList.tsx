import type { ValidationIssue } from '../../entities/xray'

export function IssueList({
  issues,
  onSelect,
  canSelect,
  emptyLabel = 'Конфиг валиден',
}: {
  issues: ValidationIssue[]
  onSelect?: (issue: ValidationIssue) => void
  /** Куда переходить, решает вызывающий: на топологии узел есть не у всякой проблемы */
  canSelect?: (issue: ValidationIssue) => boolean
  /**
   * Что сказать, когда проблем нет. Слово «конфиг» верно для Xray, но не для
   * шаблона подписки Mihomo — подпись задаёт вызывающий. Умолчание оставлено
   * ради вызывающих, которым нечего сказать иначе.
   */
  emptyLabel?: string
}) {
  if (issues.length === 0) {
    return <p className="muted">{emptyLabel}</p>
  }
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

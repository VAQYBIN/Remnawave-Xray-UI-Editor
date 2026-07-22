import type { ValidationIssue } from '../../entities/xray'

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return <p className="muted">Конфиг валиден</p>
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {issues.map((issue, i) => (
        <li key={i} className="issue-row">
          <span className={issue.level === 'error' ? 'issue-badge issue-error' : 'issue-badge issue-warning'}>
            {issue.level === 'error' ? 'ошибка' : 'внимание'}
          </span>
          {issue.path && <span className="mono muted">{issue.path}</span>}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  )
}

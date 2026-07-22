import type { ValidationIssue } from '../../entities/xray'

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return <p style={{ color: 'var(--ok)', margin: '8px 0' }}>Конфиг валиден</p>
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 4 }}>
      {issues.map((issue, i) => (
        <li key={i} className="row" style={{ alignItems: 'baseline' }}>
          <span
            className="chip-dot"
            style={{ background: issue.level === 'error' ? 'var(--danger)' : 'var(--out)' }}
          />
          {issue.path && <span className="mono muted">{issue.path}</span>}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  )
}

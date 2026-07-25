import type { ValidationIssue } from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'
import { DiffView } from './DiffView'
import { IssueList } from './IssueList'

interface Props {
  open: boolean
  onClose: () => void
  original: string
  modified: string
  issues: ValidationIssue[]
  busy: boolean
  onConfirm: () => void
  error?: string
}

export function SaveDialog({ open, onClose, original, modified, issues, busy, onConfirm, error }: Props) {
  const warnings = issues.filter((i) => i.level === 'warning')

  return (
    <Dialog open={open} title="Сохранить в панель" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        Слева — версия панели, справа — ваш черновик.
      </p>
      {/* Пока open=true, нативный <dialog> модален и блокирует ввод в редактор, поэтому
          modified не может измениться при открытом диалоге: DiffView монтируется на
          открытие и уничтожается на закрытие. */}
      {open && <DiffView original={original} modified={modified} />}
      {warnings.length > 0 && (
        <>
          <IssueList issues={warnings} />
          <p className="muted">Панель — финальный арбитр: можно сохранить с предупреждениями.</p>
        </>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {warnings.length > 0 ? 'Сохранить всё равно' : 'Сохранить'}
        </Button>
      </div>
    </Dialog>
  )
}

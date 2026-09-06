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
  // Показываем ВСЕ диагностики, а не только предупреждения. У Xray разницы нет:
  // ошибки блокируют кнопку сохранения, и до диалога такой документ не доходит.
  // У шаблона Mihomo блокирует только синтаксис YAML, поэтому сюда доезжают
  // ошибки — повтор имени группы, кольцо групп, неразбираемое правило, — и
  // именно они по-настоящему ломают подписку. Спрятать их здесь значило бы
  // показать человеку ровно то, что неважно, и умолчать о важном.
  const hasErrors = issues.some((i) => i.level === 'error')

  return (
    <Dialog open={open} title="Сохранить в панель" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        Слева — версия панели, справа — ваш черновик.
      </p>
      {/* Пока open=true, нативный <dialog> модален и блокирует ввод в редактор, поэтому
          modified не может измениться при открытом диалоге: DiffView монтируется на
          открытие и уничтожается на закрытие. */}
      {open && <DiffView original={original} modified={modified} />}
      {issues.length > 0 && (
        <>
          <IssueList issues={issues} />
          <p className="muted">
            {hasErrors
              ? 'Панель — финальный арбитр: она примет и такой документ, но клиенты получат подписку с этими ошибками.'
              : 'Панель — финальный арбитр: можно сохранить с предупреждениями.'}
          </p>
        </>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {issues.length > 0 ? 'Сохранить всё равно' : 'Сохранить'}
        </Button>
      </div>
    </Dialog>
  )
}

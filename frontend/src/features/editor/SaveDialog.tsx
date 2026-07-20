import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@uiw/react-codemirror'
import type { ValidationIssue } from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'
import { IssueList } from './IssueList'

const diffTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
})

interface Props {
  open: boolean
  onClose: () => void
  original: string
  modified: string
  issues: ValidationIssue[]
  busy: boolean
  onConfirm: () => void
}

export function SaveDialog({ open, onClose, original, modified, issues, busy, onConfirm }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const warnings = issues.filter((i) => i.level === 'warning')

  useEffect(() => {
    if (!open || !ref.current) return
    const view = new MergeView({
      a: { doc: original, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      b: { doc: modified, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      parent: ref.current,
    })
    return () => view.destroy()
  }, [open, original, modified])

  return (
    <Dialog open={open} title="Сохранить в панель" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Слева — версия панели, справа — ваш черновик.
      </p>
      <div ref={ref} style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }} />
      {warnings.length > 0 && (
        <>
          <IssueList issues={warnings} />
          <p className="muted">Панель — финальный арбитр: можно сохранить с предупреждениями.</p>
        </>
      )}
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

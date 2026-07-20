import { useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import type { XrayConfig } from '../../entities/xray'
import { getNodeJson } from '../../entities/graph/mutations'
import { Button, Dialog } from '../../shared/ui'

const inspectorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
})

interface Props {
  config: XrayConfig
  nodeId: string
  onApply: (value: unknown) => void
  onRemove: () => void
  onClose: () => void
}

export function NodeInspector({ config, nodeId, onApply, onRemove, onClose }: Props) {
  const original = useMemo(() => JSON.stringify(getNodeJson(config, nodeId) ?? {}, null, 2), [config, nodeId])
  const [text, setText] = useState(original)
  const [parseError, setParseError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const extensions = useMemo(() => [json(), inspectorTheme], [])

  function apply() {
    try {
      onApply(JSON.parse(text))
      setParseError(null)
    } catch {
      setParseError('Некорректный JSON')
    }
  }

  return (
    <aside
      style={{
        width: 380, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8,
        border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface)',
      }}
    >
      <div className="row">
        <span className="mono">{nodeId}</span>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть">✕</Button>
      </div>
      <CodeMirror key={`${nodeId}:${original}`} value={text} height="calc(100vh - 340px)" theme="dark" extensions={extensions} onChange={setText} />
      {parseError && <span className="field-error">{parseError}</span>}
      <div className="row">
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>Удалить узел</Button>
        <span className="spacer" />
        <Button variant="primary" onClick={apply} disabled={text === original}>Применить</Button>
      </div>
      <Dialog open={confirmOpen} title="Удалить узел" onClose={() => setConfirmOpen(false)}>
        <p>Удалить «{nodeId}» из конфига? Ссылки правил на него останутся и будут подсвечены как предупреждения.</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Отмена</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(false)
              onRemove()
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </aside>
  )
}

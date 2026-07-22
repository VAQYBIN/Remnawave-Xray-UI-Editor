import { useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import type { XrayConfig } from '../../entities/xray'
import { getNodeJson } from '../../entities/graph/mutations'
import { Button, Dialog } from '../../shared/ui'
import { InboundForm } from '../inspector/InboundForm'
import { OutboundForm } from '../inspector/OutboundForm'
import { RuleForm } from '../inspector/RuleForm'

const inspectorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
})

type Obj = Record<string, unknown>

interface Props {
  config: XrayConfig
  nodeId: string
  inboundSquads?: Record<string, string[]>
  onApply: (value: unknown) => void
  onRemove: () => void
  onClose: () => void
}

function parseNode(text: string): Obj | null {
  try {
    const v = JSON.parse(text) as unknown
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null
  } catch {
    return null
  }
}

export function NodeInspector({ config, nodeId, inboundSquads, onApply, onRemove, onClose }: Props) {
  const original = useMemo(() => JSON.stringify(getNodeJson(config, nodeId) ?? {}, null, 2), [config, nodeId])
  const [text, setText] = useState(original)
  const [parseError, setParseError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [retagValue, setRetagValue] = useState<Obj | null>(null)
  const extensions = useMemo(() => [json(), inspectorTheme], [])

  const kind = nodeId.startsWith('in:')
    ? 'inbound'
    : nodeId.startsWith('out:')
      ? 'outbound'
      : nodeId.startsWith('rule:')
        ? 'rule'
        : 'other'
  const [tab, setTab] = useState<'form' | 'json'>(kind === 'other' ? 'json' : 'form')
  const parsedNode = useMemo(() => parseNode(text), [text])
  const oldTag = kind === 'inbound' ? nodeId.slice(3) : ''

  function apply() {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setParseError('Некорректный JSON')
      return
    }
    // Узел конфига — всегда объект; число или массив молча сломали бы конфиг
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('Узел должен быть JSON-объектом')
      return
    }
    setParseError(null)
    const node = parsed as Obj
    if (kind === 'inbound' && node.tag !== oldTag && (inboundSquads?.[oldTag]?.length ?? 0) > 0) {
      // Панель привязывает сквады к тегу — предупреждаем о потере привязки
      setRetagValue(node)
      return
    }
    onApply(node)
  }

  return (
    <aside
      style={{
        width: 420, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8,
        border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--surface)',
      }}
    >
      <div className="row">
        <span className="mono">{nodeId}</span>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть">✕</Button>
      </div>

      {kind !== 'other' && (
        <div className="row" style={{ gap: 4 }}>
          <Button variant={tab === 'form' ? 'primary' : 'ghost'} onClick={() => setTab('form')}>Форма</Button>
          <Button variant={tab === 'json' ? 'primary' : 'ghost'} onClick={() => setTab('json')}>JSON узла</Button>
        </div>
      )}

      {tab === 'form' && kind !== 'other' && (
        <div className="inspector-form">
          {parsedNode === null && <p className="muted">JSON узла некорректен — исправьте его на вкладке «JSON узла».</p>}
          {parsedNode !== null && kind === 'inbound' && (
            <InboundForm value={parsedNode} onChange={(next) => setText(JSON.stringify(next, null, 2))} />
          )}
          {parsedNode !== null && kind === 'outbound' && (
            <OutboundForm value={parsedNode} onChange={(next) => setText(JSON.stringify(next, null, 2))} />
          )}
          {parsedNode !== null && kind === 'rule' && (
            <RuleForm
              value={parsedNode}
              onChange={(next) => setText(JSON.stringify(next, null, 2))}
              inboundTags={(config.inbounds ?? []).map((i) => i.tag)}
              outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
            />
          )}
        </div>
      )}

      {(tab === 'json' || kind === 'other') && (
        <CodeMirror
          key={`${nodeId}:${original}`}
          value={text}
          height="calc(100vh - 380px)"
          theme="dark"
          extensions={extensions}
          onChange={setText}
        />
      )}

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

      <Dialog open={retagValue !== null} title="Смена тега inbound" onClose={() => setRetagValue(null)}>
        <p>
          К тегу «{oldTag}» в панели привязаны сквады ({(inboundSquads?.[oldTag] ?? []).length}). После смены тега
          панель потеряет привязку — сквады придётся включить заново.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setRetagValue(null)}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (retagValue) onApply(retagValue)
              setRetagValue(null)
            }}
          >
            Сменить тег
          </Button>
        </div>
      </Dialog>
    </aside>
  )
}

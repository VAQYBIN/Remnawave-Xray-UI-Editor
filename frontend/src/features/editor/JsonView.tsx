import { useMemo } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import { validateXrayConfig } from '../../entities/xray'
import { xrayIntellisense } from './intellisense'
import { diagnosticsFor } from './jsonLocate'

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--void)', fontSize: '13px', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
  '.cm-gutters': { backgroundColor: 'var(--void)', borderRight: '1px solid var(--rail)' },
})

function xrayLinter() {
  return linter((view) =>
    diagnosticsFor(view.state, validateXrayConfig(view.state.doc.toString()).issues),
  )
}

export function JsonView({ text, onChange }: { text: string; onChange: (v: string) => void }) {
  const extensions = useMemo(
    () => [json(), lintGutter(), xrayLinter(), xrayIntellisense('config'), editorTheme],
    [],
  )
  return <CodeMirror value={text} height="100%" theme="dark" extensions={extensions} onChange={onChange} />

}

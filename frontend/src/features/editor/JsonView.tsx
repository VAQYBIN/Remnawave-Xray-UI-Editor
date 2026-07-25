import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import { validateXrayConfig, type PathParts } from '../../entities/xray'
import { xrayIntellisense } from './intellisense'
import { diagnosticsFor, locateRange } from './jsonLocate'

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

export function JsonView({
  text,
  onChange,
  reveal,
}: {
  text: string
  onChange: (v: string) => void
  /** Куда прокрутить: nonce нужен, чтобы повторный клик по той же проблеме сработал снова */
  reveal?: { parts: PathParts; nonce: number } | null
}) {
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal) return
    const range = locateRange(view.state, reveal.parts)
    if (!range) return
    view.dispatch({
      selection: { anchor: range.from, head: range.to },
      effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
    })
    view.focus()
  }, [reveal])

  const extensions = useMemo(
    () => [json(), lintGutter(), xrayLinter(), xrayIntellisense('config'), editorTheme],
    [],
  )
  return (
    <CodeMirror
      value={text}
      height="100%"
      theme="dark"
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
    />
  )
}

import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { linter, lintGutter } from '@codemirror/lint'
import { locateMihomo, parseMihomo, validateMihomo } from '../../entities/mihomo'
import type { PathParts } from '../../entities/xray'
import { editorTheme } from './editorTheme'
import { mihomoIntellisense } from './mihomoIntellisense'
import { mihomoDiagnostics } from './yamlLocate'

function mihomoLinter() {
  return linter((view) => {
    // Разбор ровно один на прогон: он нужен и проверкам, и поиску мест. Текст
    // берётся у буфера редактора — печатать модель обратно нельзя
    const md = parseMihomo(view.state.doc.toString())
    return mihomoDiagnostics(md, validateMihomo(md))
  })
}

export function YamlView({
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
    const range = locateMihomo(parseMihomo(view.state.doc.toString()), reveal.parts)
    if (!range) return
    view.dispatch({
      selection: { anchor: range.from, head: range.to },
      effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
    })
    view.focus()
  }, [reveal])

  const extensions = useMemo(
    () => [yaml(), lintGutter(), mihomoLinter(), mihomoIntellisense(), editorTheme],
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

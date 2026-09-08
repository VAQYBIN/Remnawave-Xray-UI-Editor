// Текстовая вкладка шаблона sing-box. Отдельный компонент, а не проп у
// `JsonView`: тот держит линтер Xray прямо внутри, и параметризация превратила
// бы его в развилку на каждый вид документа. У Mihomo по той же причине свой
// `YamlView`.

import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import { parseSingbox } from '../../entities/singbox/parse'
import { validateSingbox } from '../../entities/singbox/validate'
import type { PathParts } from '../../entities/xray'
import { editorTheme } from './editorTheme'
import { diagnosticsFor, locateRange } from './jsonLocate'
import { singboxIntellisense } from './singboxIntellisense'

function singboxLinter() {
  return linter((view) => {
    const text = view.state.doc.toString()
    const parsed = parseSingbox(text)
    // Не разобрался — проверять нечего: диагностики схемы говорили бы про
    // документ, которого нет. Разобрался — показываем и разбор, и проверки
    const issues =
      parsed.doc === undefined ? parsed.issues : [...parsed.issues, ...validateSingbox(parsed.doc)]
    return diagnosticsFor(view.state, issues)
  })
}

export function SingboxJsonView({
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
    () => [json(), lintGutter(), singboxLinter(), singboxIntellisense(), editorTheme],
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

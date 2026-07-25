import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@uiw/react-codemirror'

const diffTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
})

interface Props {
  original: string
  modified: string
  maxHeight?: string
}

/**
 * Сравнение двух версий конфига. Вьюха пересоздаётся при смене документов:
 * MergeView не умеет менять их на лету, а переключений здесь единицы.
 */
export function DiffView({ original, modified, maxHeight = '65vh' }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const view = new MergeView({
      a: { doc: original, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      b: { doc: modified, extensions: [json(), EditorView.editable.of(false), diffTheme] },
      parent: ref.current,
    })
    return () => view.destroy()
  }, [original, modified])

  return <div ref={ref} className="diff-frame" style={{ maxHeight }} />
}

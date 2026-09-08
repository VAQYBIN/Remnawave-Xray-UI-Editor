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
  /**
   * Куда прокрутить: nonce нужен, чтобы повторный клик по той же проблеме
   * сработал снова. `at` — готовое место у диагностики, которой путь назвать
   * нечем (синтаксическая ошибка разбора).
   */
  reveal?: { parts: PathParts; at?: { from: number; to: number }; nonce: number } | null
}) {
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal) return
    // Готовое место — прямо из диагностики; резолвер по пути зовём только
    // когда его нет. У синтаксической ошибки путь пуст, и резолвер вернул бы
    // весь документ либо ничего
    const range =
      reveal.at ?? locateMihomo(parseMihomo(view.state.doc.toString()), reveal.parts)
    if (!range) return
    // Место посчитано по тексту черновика, а прокручиваем буфер редактора: на
    // кадр они расходятся, и диапазон за концом буфера CodeMirror отвергает
    const limit = view.state.doc.length
    if (range.from > limit) return
    view.dispatch({
      selection: { anchor: range.from, head: Math.min(range.to, limit) },
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

// Диагностики CodeMirror по проблемам шаблона: у каждой — своё место в тексте.
// Место ищет locateMihomo по разобранному документу, поэтому ни EditorState, ни
// дерево CodeMirror здесь не нужны — только текст.

import type { Diagnostic } from '@codemirror/lint'
import { locateMihomo, parseMihomo } from '../../entities/mihomo'
import type { ValidationIssue } from '../../entities/xray'

export function mihomoDiagnostics(text: string, issues: ValidationIssue[]): Diagnostic[] {
  const md = parseMihomo(text)
  return issues.map((issue): Diagnostic => {
    const severity = issue.level === 'error' ? 'error' : 'warning'
    const label = issue.path ? `${issue.path}: ${issue.message}` : issue.message
    const range = locateMihomo(md, issue.parts)
    if (!range) {
      // Диапазон обязателен: ставим в начало и честно говорим, что позиция
      // неизвестна — иначе маркер читается как указание на первую строку
      return { from: 0, to: 0, severity, message: `${label} (место в документе не определено)` }
    }
    return { from: range.from, to: range.to, severity, message: label }
  })
}

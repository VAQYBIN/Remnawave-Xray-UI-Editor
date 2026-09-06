// Диагностики CodeMirror по проблемам шаблона: у каждой — своё место в тексте.
// Место ищет locateMihomo по разобранному документу, поэтому ни EditorState, ни
// дерево CodeMirror здесь не нужны — только текст.
//
// Синтаксические ошибки — особый случай: пути у них нет (ValidationIssue носит
// только `parts`), зато у самой ошибки разбора есть точное смещение. Общий тип
// диагностики ради этого не меняем — берём смещение прямо у документа, а
// одноимённые смысловые копии этих же ошибок из списка вычитаем.

import type { Diagnostic } from '@codemirror/lint'
import { locateMihomo, parseMihomo, type MihomoDoc } from '../../entities/mihomo'
import type { ValidationIssue } from '../../entities/xray'

/** Ошибки разбора YAML — на своих местах в тексте */
function syntaxDiagnostics(md: MihomoDoc): Diagnostic[] {
  return md.doc.errors.map((error, index): Diagnostic => {
    // Формулировка живёт в parse.ts и приходит сюда готовой: md.issues идут
    // ровно в порядке md.doc.errors
    const message = md.issues[index]?.message ?? `Синтаксис YAML: ${error.message}`
    const [from, to] = error.pos
    const start = Math.min(Math.max(from, 0), md.text.length)
    const end = Math.min(Math.max(to, start), md.text.length)
    return { from: start, to: end, severity: 'error', message }
  })
}

export function mihomoDiagnostics(text: string, issues: ValidationIssue[]): Diagnostic[] {
  const md = parseMihomo(text)
  const syntax = new Set(md.issues.map((i) => i.message))

  const semantic = issues
    // validateMihomo копирует к себе ошибки разбора — они уже показаны выше, и
    // со своим местом, а не в начале документа
    .filter((issue) => !(issue.parts.length === 0 && syntax.has(issue.message)))
    .map((issue): Diagnostic => {
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

  return [...syntaxDiagnostics(md), ...semantic]
}

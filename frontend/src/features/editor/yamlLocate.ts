// Диагностики CodeMirror по проблемам шаблона: у каждой — своё место в тексте.
// Место ищет locateMihomo по разобранному документу, поэтому ни EditorState, ни
// дерево CodeMirror здесь не нужны — только текст.
//
// Синтаксические ошибки — особый случай: пути у них нет (ValidationIssue носит
// только `parts`), зато у самой ошибки разбора есть точное смещение. Общий тип
// диагностики ради этого не меняем — берём смещение прямо у документа, а
// одноимённые смысловые копии этих же ошибок из списка вычитаем.

import type { Diagnostic } from '@codemirror/lint'
import { locateMihomo, type MihomoDoc } from '../../entities/mihomo'
import type { ValidationIssue } from '../../entities/xray'

/** Ошибки разбора YAML — на своих местах в тексте */
function syntaxDiagnostics(md: MihomoDoc): Diagnostic[] {
  // И текст, и место приходят с самой диагностикой. Раньше место брали у
  // `md.doc.errors` по индексу, полагаясь на то, что диагностики построены из
  // ошибок один в один и в том же порядке; связь двух списков держалась на
  // порядке и молчала бы, если бы он разошёлся
  return md.issues.flatMap((issue): Diagnostic[] =>
    issue.at === undefined
      ? []
      : [{ from: issue.at.from, to: issue.at.to, severity: 'error', message: issue.message }],
  )
}

/** Разбор приходит готовым: линтеру он нужен и для проверок, второй раз документ
 *  такого размера разбирать незачем */
export function mihomoDiagnostics(md: MihomoDoc, issues: ValidationIssue[]): Diagnostic[] {
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

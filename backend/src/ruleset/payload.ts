// Текстовые форматы наборов. Что означает строка, решает `behavior`, а не этот
// модуль: у `domain` это домен, у `ipcidr` — подсеть, у `classical` — правило.
import { parse } from 'yaml'
import { RuleSetError } from './errors.js'

export function parsePayload(text: string, format: 'yaml' | 'text'): string[] {
  return format === 'text' ? fromText(text) : fromYaml(text)
}

function fromYaml(text: string): string[] {
  let doc: unknown
  try {
    doc = parse(text)
  } catch {
    // Текст ошибки библиотеки английский и про синтаксис YAML, а пользователь
    // видит его как состояние набора — говорим своими словами
    throw new RuleSetError('Набор не разбирается как YAML')
  }
  const payload = (doc as { payload?: unknown } | null)?.payload
  if (payload === undefined) throw new RuleSetError('В наборе нет ключа payload')
  if (!Array.isArray(payload)) throw new RuleSetError('Ключ payload в наборе — не список')
  // Нестроковую запись пропускаем молча: приводить её к строке значило бы
  // завести в набор запись «null», которой в нём нет
  return payload.filter((x): x is string => typeof x === 'string')
}

function fromText(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0]!.trim()
    if (line !== '') out.push(line)
  }
  return out
}

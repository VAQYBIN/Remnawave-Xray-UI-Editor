// Разбор текста шаблона. Схема проверяет КАРКАС и ничего больше: у элемента
// outbounds обязателен `type` (без него неизвестно, что это за выход и как его
// рисовать), всё остальное проходит насквозь. Ядро развивается быстрее нашего
// словаря, и строгая схема отвергала бы валидные документы — тот же выбор
// сделан в схеме Xray.

import { z } from 'zod'
import type { PathParts, ValidationIssue } from '../xray/config'
import type { SingboxDoc } from './types'

function issue(parts: PathParts, message: string): ValidationIssue {
  return { parts, path: parts.join('.'), message, level: 'error' }
}

const OutboundSchema = z.looseObject({ type: z.string() })
const InboundSchema = z.looseObject({ type: z.string() })

const DocSchema = z.looseObject({
  inbounds: z.array(InboundSchema).optional(),
  outbounds: z.array(OutboundSchema).optional(),
  route: z.looseObject({}).optional(),
  dns: z.looseObject({}).optional(),
})

export function parseSingbox(text: string): {
  ok: boolean
  doc?: SingboxDoc
  issues: ValidationIssue[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      issues: [issue([], `Некорректный JSON: ${err instanceof Error ? err.message : String(err)}`)],
    }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [issue([], 'Ожидается объект конфигурации sing-box')] }
  }

  const parsed = DocSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => issue(i.path as PathParts, i.message)),
    }
  }

  return { ok: true, doc: parsed.data as SingboxDoc, issues: [] }
}

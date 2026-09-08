// Что именно редактор попросит у бэкенда по каждому набору правил документа.
// Читает документ только фронтенд, поэтому и дескрипторы собирает он.
import { ruleProvidersOf } from './groups'
import type { MihomoDoc } from './parse'

export type RuleSetBehavior = 'domain' | 'ipcidr' | 'classical'
export type RuleSetFormat = 'mrs' | 'yaml' | 'text'

export type RuleSetDescriptor =
  | {
      name: string
      kind: 'http'
      url: string
      behavior: RuleSetBehavior
      format: RuleSetFormat
      intervalSec?: number
      proxy?: string
    }
  | {
      name: string
      kind: 'inline'
      payload: string[]
      behavior: RuleSetBehavior
      format: RuleSetFormat
    }
  /** Набор лежит в файле у клиента — сервер такого файла не видит */
  | { name: string; kind: 'file' }
  /** Вид или формат редактору незнаком; выдумывать их нельзя */
  | { name: string; kind: 'unsupported'; reason: string }

const BEHAVIORS = new Set<string>(['domain', 'ipcidr', 'classical'])
const FORMATS = new Set<string>(['mrs', 'yaml', 'text'])

export function ruleSetDescriptors(md: MihomoDoc): RuleSetDescriptor[] {
  const out: RuleSetDescriptor[] = []
  for (const ref of ruleProvidersOf(md)) {
    const type = ref.type?.trim() ?? 'http'
    if (type === 'file') {
      out.push({ name: ref.name, kind: 'file' })
      continue
    }

    const behavior = ref.behavior?.trim().toLowerCase()
    if (behavior === undefined || !BEHAVIORS.has(behavior)) {
      out.push({
        name: ref.name,
        kind: 'unsupported',
        reason: `вид набора «${ref.behavior ?? 'не указан'}» редактору незнаком`,
      })
      continue
    }
    // Пустое поле формата ядро понимает как yaml: ParseRuleFormat("") → YamlRule
    const format = ref.format?.trim().toLowerCase() ?? 'yaml'
    if (!FORMATS.has(format)) {
      out.push({
        name: ref.name,
        kind: 'unsupported',
        reason: `формат набора «${ref.format}» редактору незнаком`,
      })
      continue
    }

    if (type === 'inline') {
      out.push({
        name: ref.name,
        kind: 'inline',
        payload: ref.payload ?? [],
        behavior: behavior as RuleSetBehavior,
        format: format as RuleSetFormat,
      })
      continue
    }

    const url = ref.url?.trim()
    if (url === undefined || url === '') {
      out.push({ name: ref.name, kind: 'unsupported', reason: 'у набора не указана ссылка' })
      continue
    }
    out.push({
      name: ref.name,
      kind: 'http',
      url,
      behavior: behavior as RuleSetBehavior,
      format: format as RuleSetFormat,
      ...(ref.intervalSec === undefined ? {} : { intervalSec: ref.intervalSec }),
      ...(ref.proxy === undefined ? {} : { proxy: ref.proxy }),
    })
  }
  return out
}

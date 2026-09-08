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

/**
 * Почему набор из файла клиента недоступен. Строка одна на всё приложение:
 * её называет и трассировка, и диалог состояния, и разъехаться они не должны —
 * пользователь прочёл бы про один набор две разные причины.
 */
export const FILE_SET_REASON = 'набор лежит в файле у клиента — серверу такой файл недоступен'

const BEHAVIORS = new Set<string>(['domain', 'ipcidr', 'classical'])
const FORMATS = new Set<string>(['mrs', 'yaml', 'text'])

export function ruleSetDescriptors(md: MihomoDoc): RuleSetDescriptor[] {
  const out: RuleSetDescriptor[] = []
  for (const ref of ruleProvidersOf(md)) {
    const type = ref.type?.trim().toLowerCase() ?? 'http'
    if (type !== 'http' && type !== 'inline' && type !== 'file') {
      // Молчаливо считать незнакомый вид сетевым — значит скачать то, чего
      // документ не просил. Ядро такой документ вовсе отвергает при разборе
      out.push({
        name: ref.name,
        kind: 'unsupported',
        reason: `вид провайдера «${ref.type}» редактору незнаком`,
      })
      continue
    }
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
    // Пустое поле формата ядро понимает как yaml: `ParseRuleFormat("")` отдаёт
    // YamlRule. Здесь `||`, а не `??`: пустая строка — это тоже «не задано», и
    // `??` пропустил бы её мимо умолчания прямо в отказ.
    //
    // С `behavior` выше нарочно иначе, и это не небрежность: `ParseBehavior("")`
    // у ядра валится ошибкой `unsupported behavior type`. Асимметрия здесь
    // повторяет асимметрию ядра.
    const format = ref.format?.trim().toLowerCase() || 'yaml'
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

// Директивы Remnawave в шаблоне подписки. Ядро Xray о них не знает: панель
// подставляет хосты и удаляет объект `remnawave` перед отдачей клиенту.
//
// Главная особенность: инжектируемых outbound'ов в конфиге ФИЗИЧЕСКИ НЕТ, а
// правила и балансеры ссылаются на них по тегу. Поэтому теги предсказываются —
// и предсказать их можно не всегда, см. tagScheme.

import { z } from 'zod'
import type { XrayConfig } from './config'

// type — строка, а НЕ discriminatedUnion: селектор с незнакомым типом должен
// давать ошибку валидации, а не рушить разбор всего конфига. Иначе одна опечатка
// гасит весь граф и пользователь не видит даже того, что уцелело. Тот же приём,
// что у strategy.type в balancers.ts.
export const HostSelectorSchema = z.looseObject({
  type: z.string(),
  values: z.array(z.string()).optional(),
  pattern: z.string().optional(),
})

export type HostSelector = z.infer<typeof HostSelectorSchema>

export const SELECTOR_TYPES = ['uuids', 'remarkRegex', 'tagRegex', 'sameTagAsRecipient'] as const

export const SELECT_FROM = ['HIDDEN', 'NOT_HIDDEN', 'ALL'] as const

// selectFrom — строка, а не z.enum: незнакомое значение из чужого шаблона должно
// давать предупреждение валидации, а не рушить разбор всего конфига. Тот же
// приём, что у strategy.type в balancers.ts.
export const InjectGroupSchema = z.looseObject({
  // selector необязателен на уровне разбора: его отсутствие — ошибка валидации,
  // а не повод отказаться читать документ
  selector: HostSelectorSchema.optional(),
  selectFrom: z.string().optional(),
  tagPrefix: z.string().optional(),
  useHostRemarkAsTag: z.boolean().optional(),
  useHostTagAsTag: z.boolean().optional(),
})

export type InjectGroup = z.infer<typeof InjectGroupSchema>

/**
 * Ключи способа именования. Их ровно три, и одновременно допустим только один —
 * поэтому любая правка одного снимает остальные два. Перечень общий для мутаций
 * графа и формы инспектора: разъехавшись, они позволили бы собрать невозможное.
 */
export const TAG_SCHEME_KEYS = ['tagPrefix', 'useHostRemarkAsTag', 'useHostTagAsTag'] as const

export type TagSchemeKey = (typeof TAG_SCHEME_KEYS)[number]

/** Переключает способ именования, снимая два остальных ключа */
export function withTagScheme(group: InjectGroup, key: TagSchemeKey, prefix = 'proxy'): InjectGroup {
  const next: Record<string, unknown> = { ...group }
  for (const k of TAG_SCHEME_KEYS) delete next[k]
  if (key === 'tagPrefix') next.tagPrefix = group.tagPrefix || prefix
  else next[key] = true
  return next as InjectGroup
}

export const RemnawaveDirectivesSchema = z.looseObject({
  addVirtualHostAsOutbound: z.boolean().optional(),
  injectHosts: z.array(InjectGroupSchema).optional(),
})

/**
 * Сколько тегов предсказываем для префиксной группы. Точное число знает только
 * панель — оно равно числу подошедших хостов. Трёх хватает, чтобы селектор
 * балансера вида ["proxy-"] нашёл хотя бы одного кандидата.
 */
const PREDICTED_COUNT = 3

/**
 * Как группа именует свои outbound'ы:
 * `prefix` — теги предсказуемы (proxy, proxy-2, …), связи выводимы;
 * `panel`  — теги берутся из примечаний или тегов хостов и заранее НЕИЗВЕСТНЫ;
 * `none`   — способ не выбран, это ошибка конфигурации.
 */
export function tagScheme(group: InjectGroup): 'prefix' | 'panel' | 'none' {
  if (group.useHostRemarkAsTag === true || group.useHostTagAsTag === true) return 'panel'
  if (typeof group.tagPrefix === 'string' && group.tagPrefix !== '') return 'prefix'
  return 'none'
}

/** Теги, которые произведёт группа. Для схемы `panel` их не предсказать — пусто. */
export function predictedTags(group: InjectGroup): string[] {
  if (tagScheme(group) !== 'prefix') return []
  const prefix = group.tagPrefix as string
  const tags = [prefix]
  for (let n = 2; n <= PREDICTED_COUNT; n += 1) tags.push(`${prefix}-${n}`)
  return tags
}

export function injectGroupsOf(config: XrayConfig): InjectGroup[] {
  return config.remnawave?.injectHosts ?? []
}

/** Тег → индекс произведшей его группы. Нужно графу: ребро ведёт к узлу inj:<index>. */
export function injectedTagOwners(config: XrayConfig): Map<string, number> {
  const owners = new Map<string, number>()
  injectGroupsOf(config).forEach((group, index) => {
    for (const tag of predictedTags(group)) {
      if (!owners.has(tag)) owners.set(tag, index)
    }
  })
  return owners
}

export function injectedTagsOf(config: XrayConfig): string[] {
  return [...injectedTagOwners(config).keys()]
}

/**
 * Есть ли группа, теги которой знает только панель. Если да — проверки
 * «неизвестный outbound-тег» и «у балансера нет кандидатов» обязаны молчать:
 * на корректном шаблоне они дают ложную тревогу.
 */
export function hasPanelNamedTags(config: XrayConfig): boolean {
  return injectGroupsOf(config).some((g) => tagScheme(g) === 'panel')
}

/** Короткая подпись селектора для карточки узла и списка проблем */
export function describeSelector(group: InjectGroup): string {
  const selector = group.selector
  if (selector === undefined) return 'селектор не задан'
  switch (selector.type) {
    case 'tagRegex':
      return `тег ~ ${selector.pattern ?? ''}`
    case 'remarkRegex':
      return `примечание ~ ${selector.pattern ?? ''}`
    case 'uuids':
      return `по списку: ${selector.values?.length ?? 0}`
    case 'sameTagAsRecipient':
      return 'тег как у получателя'
    default:
      return `неизвестный селектор «${selector.type}»`
  }
}

import { describe, expect, it } from 'vitest'
import { XrayConfigSchema } from '../src/entities/xray/config'
import {
  describeSelector,
  hasPanelNamedTags,
  injectedTagOwners,
  injectedTagsOf,
  injectGroupsOf,
  predictedTags,
  tagScheme,
} from '../src/entities/xray/inject'

const withGroups = (groups: unknown[]) =>
  XrayConfigSchema.parse({
    remnawave: { injectHosts: groups },
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  })

describe('директивы подстановки', () => {
  it('переживают разбор и не теряют незнакомые ключи', () => {
    const config = withGroups([
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'proxy', полеИзБудущего: 1 },
    ])
    expect(injectGroupsOf(config)).toHaveLength(1)
    expect((injectGroupsOf(config)[0] as Record<string, unknown>).полеИзБудущего).toBe(1)
  })

  it('без директив список групп пуст, а не падает', () => {
    const config = XrayConfigSchema.parse({ outbounds: [] })
    expect(injectGroupsOf(config)).toEqual([])
    expect(injectedTagsOf(config)).toEqual([])
    expect(hasPanelNamedTags(config)).toBe(false)
  })

  it('tagScheme различает три случая', () => {
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' })).toBe('prefix')
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true })).toBe('panel')
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' }, useHostRemarkAsTag: true })).toBe('panel')
    expect(tagScheme({ selector: { type: 'sameTagAsRecipient' } })).toBe('none')
  })

  // Панель нумерует со второго: proxy, proxy-2, proxy-3
  it('предсказывает теги префиксной группы', () => {
    expect(predictedTags({ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' })).toEqual([
      'proxy',
      'proxy-2',
      'proxy-3',
    ])
  })

  it('для тегов от панели предсказывать нечего', () => {
    expect(predictedTags({ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true })).toEqual([])
    expect(predictedTags({ selector: { type: 'sameTagAsRecipient' }, tagPrefix: '' })).toEqual([])
  })

  it('владелец тега находится по индексу группы', () => {
    const config = withGroups([
      { selector: { type: 'tagRegex', pattern: '^RU-' }, tagPrefix: 'ru' },
      { selector: { type: 'tagRegex', pattern: '^DE-' }, tagPrefix: 'de' },
    ])
    const owners = injectedTagOwners(config)
    expect(owners.get('ru')).toBe(0)
    expect(owners.get('de-2')).toBe(1)
    expect(owners.get('direct')).toBeUndefined()
    expect(injectedTagsOf(config)).toContain('ru-3')
  })

  it('hasPanelNamedTags поднимается от одной группы с тегами панели', () => {
    expect(hasPanelNamedTags(withGroups([{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p' }]))).toBe(false)
    expect(
      hasPanelNamedTags(
        withGroups([
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p' },
          { selector: { type: 'sameTagAsRecipient' }, useHostRemarkAsTag: true },
        ]),
      ),
    ).toBe(true)
  })

  it('describeSelector даёт короткую подпись для карточки узла', () => {
    expect(describeSelector({ selector: { type: 'tagRegex', pattern: '^RU-' } })).toBe('тег ~ ^RU-')
    expect(describeSelector({ selector: { type: 'remarkRegex', pattern: '^RU' } })).toBe('примечание ~ ^RU')
    expect(describeSelector({ selector: { type: 'uuids', values: ['a', 'b'] } })).toBe('по списку: 2')
    expect(describeSelector({ selector: { type: 'sameTagAsRecipient' } })).toBe('тег как у получателя')
    expect(describeSelector({})).toBe('селектор не задан')
    expect(describeSelector({ selector: { type: 'выдумка' } })).toBe('неизвестный селектор «выдумка»')
  })

  // Сломанный селектор — ошибка ВАЛИДАЦИИ, а не разбора: иначе одна опечатка
  // гасит весь граф и пользователь не видит даже уцелевшего
  it('группа с незнакомым селектором и группа без него всё равно разбираются', () => {
    const config = withGroups([{ selector: { type: 'выдумка' }, tagPrefix: 'p' }, { tagPrefix: 'q' }])
    expect(injectGroupsOf(config)).toHaveLength(2)
    expect(injectedTagsOf(config)).toContain('p')
  })
})

import { describe, expect, it } from 'vitest'
import { blockingInjectPrefix, expandSelector, type XrayConfig } from '../src/entities/xray'

const withGroups = (selector: string[], outbounds: string[]): XrayConfig =>
  ({
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    outbounds: outbounds.map((tag) => ({ tag, protocol: 'freedom' })),
    routing: { balancers: [{ tag: 'bal', selector }], rules: [] },
  }) as unknown as XrayConfig

describe('разворот префикса селектора', () => {
  it('без групп подстановки разворачивает как раньше', () => {
    const config = {
      outbounds: [{ tag: 'eu-1' }, { tag: 'eu-2' }, { tag: 'direct' }],
      routing: { balancers: [{ tag: 'bal', selector: ['eu-'] }], rules: [] },
    } as unknown as XrayConfig
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-1'])
  })

  // Главное: предсказанных proxy/proxy-2/proxy-3 в селекторе появиться не должно
  it('префикс группы сохраняется как префикс', () => {
    const config = withGroups(['proxy', 'eu-'], ['eu-1', 'eu-2'])
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy', 'eu-1'])
  })

  it('выход, который ловит тот же префикс, убрать нельзя — конфиг не меняется', () => {
    const config = withGroups(['proxy'], ['proxy-eu'])
    expect(blockingInjectPrefix(config, 'bal', 'proxy-eu')).toBe('proxy')
    expect(expandSelector(config, 'bal', 'proxy-eu')).toBe(config)
  })

  it('обычный разрыв блокировкой не считается', () => {
    const config = withGroups(['proxy', 'eu-'], ['eu-1', 'eu-2'])
    expect(blockingInjectPrefix(config, 'bal', 'eu-2')).toBeUndefined()
  })

  it('неизвестный балансер возвращает тот же конфиг', () => {
    const config = withGroups(['proxy'], ['eu-1'])
    expect(expandSelector(config, 'нет-такого', 'eu-1')).toBe(config)
  })

  it('пустой префикс в селекторе не блокирует разрыв: группа остаётся своим tagPrefix', () => {
    const config = withGroups([''], ['eu-1', 'eu-2'])
    expect(blockingInjectPrefix(config, 'bal', 'eu-2')).toBeUndefined()
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy', 'eu-1'])
  })

  it('несколько групп: сохраняются префиксы всех пойманных', () => {
    const config = {
      remnawave: {
        injectHosts: [
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'ru' },
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'de' },
        ],
      },
      outbounds: [{ tag: 'eu-1' }, { tag: 'eu-2' }],
      routing: { balancers: [{ tag: 'bal', selector: ['ru', 'de', 'eu-'] }], rules: [] },
    } as unknown as XrayConfig
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['ru', 'de', 'eu-1'])
  })

  it('группа с тегами от панели префикса не имеет и ничего не сохраняет', () => {
    const config = {
      remnawave: { injectHosts: [{ selector: { type: 'tagRegex' }, useHostTagAsTag: true }] },
      outbounds: [{ tag: 'eu-1' }, { tag: 'eu-2' }],
      routing: { balancers: [{ tag: 'bal', selector: ['eu-'] }], rules: [] },
    } as unknown as XrayConfig
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-1'])
  })

  it('частичный префикс группы сохраняется как есть и не расширяет состав кандидатов', () => {
    const config = withGroups(['proxy-', 'eu-'], ['eu-1', 'eu-2'])
    const next = expandSelector(config, 'bal', 'eu-2')
    // Не ['proxy', ...]: 'proxy-' не ловит тег proxy, и подмена добавила бы
    // балансеру лишний выход
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy-', 'eu-1'])
  })

  it('статический выход, накрытый сохранённым префиксом, не дублируется', () => {
    const config = withGroups(['proxy-', 'eu-'], ['proxy-de', 'eu-1', 'eu-2'])
    const next = expandSelector(config, 'bal', 'eu-2')
    // proxy-de уже накрыт префиксом proxy- — второй записи он не заслуживает
    expect(next.routing!.balancers![0]!.selector).toEqual(['proxy-', 'eu-1'])
  })

  it('группа с пустым tagPrefix ничего не сохраняет', () => {
    const config = {
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: '' }] },
      outbounds: [{ tag: 'eu-1' }, { tag: 'eu-2' }],
      routing: { balancers: [{ tag: 'bal', selector: ['eu-'] }], rules: [] },
    } as unknown as XrayConfig
    const next = expandSelector(config, 'bal', 'eu-2')
    expect(next.routing!.balancers![0]!.selector).toEqual(['eu-1'])
  })
})

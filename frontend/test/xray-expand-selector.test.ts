import { describe, expect, it } from 'vitest'
import {
  blockingInjectPrefix,
  expandBlockedByPanelTags,
  expandSelector,
  type XrayConfig,
} from '../src/entities/xray'

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

// Теги такой группы знает ТОЛЬКО панель, поэтому любой префикс селектора может
// поймать их будущие теги — какие именно, редактор не знает по определению.
// Значит разворот неразрешим целиком, пока такая группа есть в документе.
describe('группа с тегами от панели запрещает разворот целиком', () => {
  const panel = (selector: string[], outbounds: string[]): XrayConfig =>
    ({
      remnawave: {
        injectHosts: [{ selector: { type: 'tagRegex', pattern: '^RU-' }, useHostTagAsTag: true }],
      },
      outbounds: outbounds.map((tag) => ({ tag, protocol: 'freedom' })),
      routing: { balancers: [{ tag: 'bal', selector }], rules: [] },
    }) as unknown as XrayConfig

  it('разворот возвращает ТОТ ЖЕ конфиг, а не пустой селектор', () => {
    const config = panel(['RU-'], ['RU-fallback'])
    expect(expandSelector(config, 'bal', 'RU-fallback')).toBe(config)
  })

  it('запрет виден предикатом — диалогу есть чем объяснить причину', () => {
    expect(expandBlockedByPanelTags(panel(['RU-'], ['RU-fallback']), 'bal')).toBe(true)
  })

  it('диалог не показывает кнопку разворота: префикс назван блокирующим', () => {
    const config = panel(['RU-'], ['RU-fallback'])
    expect(blockingInjectPrefix(config, 'bal', 'RU-fallback')).toBe('RU-')
  })

  it('запрет глобальный: он держится и для префикса, не пересекающегося с группой', () => {
    const config = panel(['eu-'], ['eu-1', 'eu-2'])
    expect(expandBlockedByPanelTags(config, 'bal')).toBe(true)
    expect(expandSelector(config, 'bal', 'eu-2')).toBe(config)
  })

  it('пустой селектор разворачивать нечем — запрет не срабатывает', () => {
    expect(expandBlockedByPanelTags(panel([], ['eu-1']), 'bal')).toBe(false)
  })

  it('неизвестный балансер запретом не считается', () => {
    expect(expandBlockedByPanelTags(panel(['RU-'], ['RU-1']), 'нет-такого')).toBe(false)
  })

  it('без панельной группы предикат молчит', () => {
    const config = {
      outbounds: [{ tag: 'eu-1' }, { tag: 'eu-2' }],
      routing: { balancers: [{ tag: 'bal', selector: ['eu-'] }], rules: [] },
    } as unknown as XrayConfig
    expect(expandBlockedByPanelTags(config, 'bal')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { analyzeIntegrity, XrayConfigSchema } from '../src/entities/xray/config'

const parse = (raw: unknown) => XrayConfigSchema.parse(raw)
const messages = (config: ReturnType<typeof parse>) => analyzeIntegrity(config).map((i) => i.message)

const base = {
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

describe('валидации подстановки', () => {
  it('ругается на группу без способа именования тегов', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' } }] } })
    expect(messages(config)).toContain(
      'Не выбран способ именования тегов: нужен ровно один из tagPrefix, useHostRemarkAsTag, useHostTagAsTag',
    )
  })

  it('ругается на два способа именования сразу', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p', useHostTagAsTag: true }] },
    })
    expect(messages(config)).toContain(
      'Задано больше одного способа именования тегов — панель примет только один',
    )
  })

  it('ругается на группу без селектора', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [{ tagPrefix: 'p' }] } })
    expect(messages(config)).toContain('Группа без селектора: непонятно, какие хосты подставлять')
  })

  it('ругается на незнакомый тип селектора, но конфиг при этом читается', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [{ selector: { type: 'выдумка' }, tagPrefix: 'p' }] } })
    expect(messages(config).some((m) => m.startsWith('Неизвестный тип селектора «выдумка»'))).toBe(true)
  })

  it('ругается на нерабочее регулярное выражение', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'tagRegex', pattern: '^[RU' }, tagPrefix: 'p' }] },
    })
    expect(messages(config).some((m) => m.startsWith('Селектор не компилируется'))).toBe(true)
  })

  it('ругается на неизвестный пул выбора', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'p', selectFrom: 'ЛЮБОЙ' }] },
    })
    expect(messages(config)).toContain('Неизвестный пул выбора «ЛЮБОЙ»: ожидается HIDDEN, NOT_HIDDEN или ALL')
  })

  it('предупреждает о пустом списке uuid', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'uuids', values: [] }, tagPrefix: 'p' }] },
    })
    expect(messages(config)).toContain('Список uuid пуст — группа не подставит ни одного хоста')
  })

  it('предупреждает о шаблоне без единой группы подстановки', () => {
    const config = parse({ ...base, remnawave: { injectHosts: [] } })
    expect(messages(config)).toContain(
      'В шаблоне нет ни одной группы подстановки — подписка не получит ни одного сервера',
    )
  })

  // В профиле ноды объекта remnawave нет вовсе: предупреждение не должно вылезать
  it('на конфиге без директив про подстановку молчит', () => {
    expect(messages(parse(base)).some((m) => m.includes('группы подстановки'))).toBe(false)
  })

  it('предупреждает, если предсказанный тег группы перекрывает статический outbound', () => {
    const config = parse({
      ...base,
      outbounds: [{ tag: 'direct', protocol: 'freedom' }, { tag: 'proxy', protocol: 'freedom' }],
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    })
    const matches = messages(config).filter((m) => m.startsWith('Тег «proxy»'))
    expect(matches).toEqual([
      'Тег «proxy» производит и эта группа, и статический outbound: панель вставляет подставленные серверы в начало массива, и ссылки по этому тегу уйдут в них',
    ])
  })

  // Номерной вариант — догадка PREDICTED_COUNT, а не факт: при одном подошедшем
  // хосте панель произведёт только «proxy». Формулировка обязана это признавать
  it('на номерной вариант формулировка условная, а не утверждающая факт', () => {
    const config = parse({
      ...base,
      outbounds: [{ tag: 'direct', protocol: 'freedom' }, { tag: 'proxy-2', protocol: 'freedom' }],
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    })
    const m = messages(config)
    expect(m).toContain(
      'Если панель подставит этой группе больше одного сервера, она произведёт тег «proxy-2» — такой статический outbound уже есть, и ссылки по этому тегу уйдут в подставленный сервер',
    )
    expect(m.some((x) => x.startsWith('Тег «proxy-2» производит'))).toBe(false)
  })

  it('без совпадения тегов группы и статических outbound не ругается', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    })
    expect(messages(config).some((m) => m.includes('производит и эта группа'))).toBe(false)
  })

  it('при тегах от панели проверка перекрытия молчит: предсказанных тегов нет', () => {
    const config = parse({
      ...base,
      outbounds: [{ tag: 'direct', protocol: 'freedom' }, { tag: 'proxy', protocol: 'freedom' }],
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
    })
    expect(messages(config).some((m) => m.includes('производит и эта группа'))).toBe(false)
  })

  it('предупреждает о пустом pattern у tagRegex/remarkRegex', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'tagRegex', pattern: '' }, tagPrefix: 'p' }] },
    })
    expect(messages(config)).toContain('Пустой шаблон подберёт все хосты — уточните выражение или смените тип селектора')
  })

  it('предупреждает об отсутствующем pattern у tagRegex/remarkRegex', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'remarkRegex' }, tagPrefix: 'p' }] },
    })
    expect(messages(config)).toContain('Пустой шаблон подберёт все хосты — уточните выражение или смените тип селектора')
  })

  it('непустой pattern не даёт предупреждения о пустом шаблоне', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'tagRegex', pattern: '^ru-' }, tagPrefix: 'p' }] },
    })
    expect(messages(config).some((m) => m.includes('Пустой шаблон подберёт все хосты'))).toBe(false)
  })

  it('предупреждает о столкновении базовых тегов двух групп', () => {
    const config = parse({
      ...base,
      remnawave: {
        injectHosts: [
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' },
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' },
        ],
      },
    })
    const found = analyzeIntegrity(config).filter((i) => i.message.includes('и группа выше'))
    expect(found.map((i) => i.message)).toEqual([
      'Тег «proxy» производит и группа выше: панель подставит два сервера с одним тегом, и ссылки по нему уйдут в первую группу',
    ])
    // Предупреждение висит на группе с БОЛЬШИМ индексом — теряется её выход
    expect(found[0]?.parts).toEqual(['remnawave', 'injectHosts', 1, 'tagPrefix'])
  })

  // Здесь фактом является только базовый тег второй группы, а «proxy-2» первой —
  // догадка: при одном подошедшем хосте столкновения не будет
  it('на пересечение через номерной вариант формулировка условная', () => {
    const config = parse({
      ...base,
      remnawave: {
        injectHosts: [
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' },
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy-2' },
        ],
      },
    })
    const m = messages(config)
    expect(m).toContain(
      'Если панель подставит достаточно серверов, эта группа и группа выше произведут общий тег «proxy-2» — ссылки по нему уйдут в первую группу',
    )
    expect(m.some((x) => x.startsWith('Тег «proxy-2» производит и группа выше'))).toBe(false)
  })

  it('непересекающиеся группы предупреждения не дают', () => {
    const config = parse({
      ...base,
      remnawave: {
        injectHosts: [
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' },
          { selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy2' },
        ],
      },
    })
    expect(messages(config).some((m) => m.includes('и группа выше'))).toBe(false)
  })

  it('при тегах от панели проверка пересечения групп молчит', () => {
    const config = parse({
      ...base,
      remnawave: {
        injectHosts: [
          { selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true },
          { selector: { type: 'sameTagAsRecipient' }, useHostRemarkAsTag: true },
        ],
      },
    })
    expect(messages(config).some((m) => m.includes('и группа выше'))).toBe(false)
  })

  it('путь проблемы ведёт внутрь injectHosts', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' } }] },
    })
    const found = analyzeIntegrity(config).find((i) => i.message.startsWith('Не выбран способ'))
    expect(found?.parts).toEqual(['remnawave', 'injectHosts', 0])
    expect(found?.path).toBe('remnawave.injectHosts.0')
  })
})

describe('ослабление проверок на предсказанных тегах', () => {
  const withPrefixGroup = {
    ...base,
    remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
    routing: { rules: [{ outboundTag: 'proxy' }], balancers: [{ tag: 'bal', selector: ['proxy'] }] },
  }

  it('правило на предсказанный тег не считается ошибочным', () => {
    expect(messages(parse(withPrefixGroup)).some((m) => m.includes('несуществующий outbound'))).toBe(false)
  })

  it('балансер с предсказанными кандидатами не ругается', () => {
    expect(messages(parse(withPrefixGroup)).some((m) => m.includes('не из чего выбирать'))).toBe(false)
  })

  // Теги от панели неизвестны: обе проверки обязаны замолчать целиком,
  // иначе редактор ругается на корректный шаблон
  it('при тегах от панели обе проверки подавляются', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      routing: { rules: [{ outboundTag: 'что-угодно' }], balancers: [{ tag: 'bal', selector: ['нечто'] }] },
    })
    const m = messages(config)
    expect(m.some((x) => x.includes('несуществующий outbound'))).toBe(false)
    expect(m.some((x) => x.includes('не из чего выбирать'))).toBe(false)
  })

  // А без всякой подстановки проверки обязаны работать как раньше
  it('в обычном профиле проверки не ослаблены', () => {
    const config = parse({ ...base, routing: { rules: [{ outboundTag: 'нет-такого' }] } })
    expect(messages(config).some((m) => m.includes('несуществующий outbound'))).toBe(true)
  })

  it('запасной выход на предсказанный тег не считается ошибочным', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      routing: { rules: [], balancers: [{ tag: 'bal', selector: ['proxy'], fallbackTag: 'proxy-2' }] },
    })
    expect(messages(config).some((m) => m.includes('Запасной выход'))).toBe(false)
  })

  it('при тегах от панели проверка запасного выхода тоже подавляется', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      routing: { rules: [], balancers: [{ tag: 'bal', selector: ['нечто'], fallbackTag: 'тег-от-панели' }] },
    })
    expect(messages(config).some((m) => m.includes('Запасной выход'))).toBe(false)
  })

  // Без подстановки проверка запасного выхода обязана работать в полную силу
  it('в обычном профиле проверка запасного выхода не ослаблена', () => {
    const config = parse({
      ...base,
      routing: { rules: [], balancers: [{ tag: 'bal', selector: ['direct'], fallbackTag: 'нет-такого' }] },
    })
    expect(messages(config).some((m) => m.includes('Запасной выход'))).toBe(true)
  })

  it('dialerProxy на предсказанный тег не считается ошибочным', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy' }] },
      outbounds: [
        {
          tag: 'chain',
          protocol: 'vless',
          streamSettings: { network: 'tcp', sockopt: { dialerProxy: 'proxy' } },
        },
      ],
      routing: { rules: [] },
    })
    expect(messages(config).some((m) => m.includes('dialerProxy'))).toBe(false)
  })

  it('при тегах от панели проверка dialerProxy тоже подавляется', () => {
    const config = parse({
      ...base,
      remnawave: { injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, useHostTagAsTag: true }] },
      outbounds: [
        {
          tag: 'chain',
          protocol: 'vless',
          streamSettings: { network: 'tcp', sockopt: { dialerProxy: 'тег-от-панели' } },
        },
      ],
      routing: { rules: [] },
    })
    expect(messages(config).some((m) => m.includes('dialerProxy'))).toBe(false)
  })

  // Без подстановки проверка dialerProxy обязана работать в полную силу
  it('в обычном профиле проверка dialerProxy не ослаблена', () => {
    const config = parse({
      ...base,
      outbounds: [
        {
          tag: 'chain',
          protocol: 'vless',
          streamSettings: { network: 'tcp', sockopt: { dialerProxy: 'нет-такого' } },
        },
      ],
      routing: { rules: [] },
    })
    expect(messages(config).some((m) => m.includes('dialerProxy'))).toBe(true)
  })
})

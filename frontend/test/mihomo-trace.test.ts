import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { geoKeysOfMihomo, traceMihomo } from '../src/entities/mihomo/trace'
import type { GeoAnswers, TraceTarget } from '../src/entities/xray'
import { mihomoFixture } from './helpers'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const T = (over: Partial<TraceTarget> = {}): TraceTarget => ({
  address: 'a.com',
  port: 443,
  network: 'tcp',
  ...over,
})

function doc(...rules: string[]): ReturnType<typeof parseMihomo> {
  return parseMihomo(['rules:', ...rules.map((r) => `  - ${r}`), ''].join('\n'))
}

describe('трассировка Mihomo', () => {
  it('первое совпавшее правило побеждает', () => {
    const res = traceMihomo(doc('DOMAIN-SUFFIX,b.com,B', 'DOMAIN-SUFFIX,a.com,A', 'MATCH,D'), T(), NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'A' })
    expect(res.verdicts[0]!.state).toBe('no')
    // Проигравший назван проигравшим: без этого «победило любое» прошло бы тоже
    expect(res.verdicts.map((v) => v.state)).toEqual(['no', 'yes'])
    // Правило ниже победителя не выполняется — и в разборе его нет
    expect(res.verdicts).toHaveLength(2)
  })

  it('MATCH ловит всё, если выше не совпало', () => {
    const res = traceMihomo(doc('DOMAIN,zzz.com,Z', 'MATCH,D'), T(), NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('без MATCH и без совпадений победителя нет', () => {
    const res = traceMihomo(doc('DOMAIN,zzz.com,Z'), T(), NO_GEO)
    expect(res.winner?.ruleIndex ?? null).toBeNull()
    expect(res.caveats.join(' ')).toMatch(/MATCH/)
    // Неподошедший трафик ядро отправляет напрямую — цель дефолта названа, а не
    // взята из первого попавшегося правила
    expect(res.winner?.target).toBe('DIRECT')
    expect(res.stopped).toBeUndefined()
  })

  it('порт и сеть учитываются', () => {
    expect(traceMihomo(doc('DST-PORT,443,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    expect(traceMihomo(doc('NETWORK,udp,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
    // Обратные половины той же пары: без них «всегда совпало» и «всегда нет» прошли бы
    expect(traceMihomo(doc('DST-PORT,80,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
    expect(traceMihomo(doc('NETWORK,tcp,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    // Живые шаблоны пишут сеть заглавными — регистр значить не должен
    expect(traceMihomo(doc('NETWORK,TCP,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    // Диапазон портов — тот же формат, что у Xray
    expect(traceMihomo(doc('DST-PORT,440-450,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
  })

  it('IP-CIDR без адреса не вычисляется и останавливает проход', () => {
    const res = traceMihomo(doc('IP-CIDR,10.0.0.0/8,A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.winner).toBeUndefined()
    expect(res.stopped?.reason).toMatch(/адрес/i)
    // Ниже остановки проход не идёт: MATCH в разбор не попал
    expect(res.verdicts).toHaveLength(1)
    expect(res.verdicts[0]!.state).toBe('unknown')
  })

  it('IP-CIDR с адресом вычисляется', () => {
    const res = traceMihomo(doc('IP-CIDR,10.0.0.0/8,A', 'MATCH,D'), T({ ip: '10.1.2.3' }), NO_GEO)
    expect(res.winner?.target).toBe('A')
    // Адрес вне подсети даёт ДРУГОЙ ответ, а не тот же самый
    const outside = traceMihomo(doc('IP-CIDR,10.0.0.0/8,A', 'MATCH,D'), T({ ip: '11.1.2.3' }), NO_GEO)
    expect(outside.winner?.target).toBe('D')
  })

  it('цель-адрес сама становится IP назначения', () => {
    // Пользователь ввёл в строку трассировки адрес, а не имя: требовать от него
    // повторить то же самое в поле «IP назначения» незачем
    const res = traceMihomo(doc('IP-CIDR,10.0.0.0/8,A', 'MATCH,D'), T({ address: '10.1.2.3' }), NO_GEO)
    expect(res.winner?.target).toBe('A')
  })

  it('GEOSITE отвечает по данным базы', () => {
    const geo: GeoAnswers = { loaded: true, answers: { 'geosite:youtube': true }, missing: [] }
    const res = traceMihomo(doc('GEOSITE,youtube,A', 'MATCH,D'), T(), geo)
    expect(res.winner?.target).toBe('A')
    expect(geoKeysOfMihomo(doc('GEOSITE,youtube,A', 'GEOIP,ru,B'))).toEqual([
      'geosite:youtube',
      'geoip:ru',
    ])
  })

  it('отрицательный ответ базы даёт другой маршрут, а отсутствие ответа — остановку', () => {
    const no: GeoAnswers = { loaded: true, answers: { 'geosite:youtube': false }, missing: [] }
    expect(traceMihomo(doc('GEOSITE,youtube,A', 'MATCH,D'), T(), no).winner?.target).toBe('D')
    const res = traceMihomo(doc('GEOSITE,youtube,A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.winner).toBeUndefined()
  })

  it('GEOIP спрашивается по ключу geoip:', () => {
    const geo: GeoAnswers = { loaded: true, answers: { 'geoip:ru': true }, missing: [] }
    const res = traceMihomo(doc('GEOIP,ru,A', 'MATCH,D'), T({ ip: '1.2.3.4' }), geo)
    expect(res.winner?.target).toBe('A')
  })

  it('RULE-SET останавливает проход с объяснением', () => {
    const res = traceMihomo(doc('RULE-SET,ads,REJECT', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/набор правил/i)
  })

  it('правила без данных в цели останавливают проход каждое', () => {
    const kinds = [
      'UID,1000,A',
      'PROCESS-NAME,curl,A',
      'SRC-IP-CIDR,10.0.0.0/8,A',
      'IN-NAME,mixed,A',
      'DSCP,4,A',
      'IP-ASN,13335,A',
      'IP-SUFFIX,8.8.8.8/8,A',
    ]
    for (const raw of kinds) {
      const res = traceMihomo(doc(raw, 'MATCH,D'), T({ ip: '10.1.2.3' }), NO_GEO)
      expect(res.stopped?.index, raw).toBe(0)
      expect(res.winner, raw).toBeUndefined()
    }
  })

  it('незнакомый тип правила не выдаётся за несовпадение', () => {
    const res = traceMihomo(doc('QUANTUM-FLUX,x,A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/QUANTUM-FLUX/)
  })

  it('шаблоны домена различают точное имя, суффикс, подстроку и маску', () => {
    const on = (raw: string, address: string) =>
      traceMihomo(doc(raw, 'MATCH,D'), T({ address }), NO_GEO).winner?.target
    expect(on('DOMAIN,a.com,A', 'a.com')).toBe('A')
    expect(on('DOMAIN,a.com,A', 'x.a.com')).toBe('D')
    expect(on('DOMAIN-SUFFIX,a.com,A', 'x.a.com')).toBe('A')
    // Граница по точке: «xa.com» не входит в «a.com», хотя и оканчивается на него
    expect(on('DOMAIN-SUFFIX,a.com,A', 'xa.com')).toBe('D')
    expect(on('DOMAIN-KEYWORD,goog,A', 'www.google.com')).toBe('A')
    expect(on('DOMAIN-KEYWORD,goog,A', 'www.yandex.ru')).toBe('D')
    // Звёздочка — ровно один сегмент, а не «сколько угодно»
    expect(on('DOMAIN-WILDCARD,*.a.com,A', 'x.a.com')).toBe('A')
    expect(on('DOMAIN-WILDCARD,*.a.com,A', 'y.x.a.com')).toBe('D')
    expect(on('DOMAIN-REGEX,^a\\.com$,A', 'a.com')).toBe('A')
    expect(on('DOMAIN-REGEX,^a\\.com$,A', 'xa.com')).toBe('D')
  })

  it('регулярка, которую JS не понимает, останавливает проход, а не роняет разбор', () => {
    const res = traceMihomo(doc('DOMAIN-REGEX,[,A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
  })

  it('логическое правило вычисляется из вложенных условий', () => {
    const and = 'AND,((DOMAIN-SUFFIX,a.com),(NETWORK,tcp)),A'
    expect(traceMihomo(doc(and, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    const or = 'OR,((DOMAIN,zzz.com),(DST-PORT,443)),A'
    expect(traceMihomo(doc(or, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    const not = 'NOT,((DOMAIN,zzz.com)),A'
    expect(traceMihomo(doc(not, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
  })

  it('логика не вырождается в «совпало хоть что-то»', () => {
    // AND с одним ложным условием не совпадает — иначе это OR
    const and = 'AND,((DOMAIN-SUFFIX,a.com),(NETWORK,udp)),A'
    expect(traceMihomo(doc(and, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
    // OR из двух ложных не совпадает — иначе это «всегда да»
    const or = 'OR,((DOMAIN,zzz.com),(DST-PORT,80)),A'
    expect(traceMihomo(doc(or, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
    // NOT от истины — ложь
    const not = 'NOT,((DOMAIN,a.com)),A'
    expect(traceMihomo(doc(not, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
    // Логика внутри логики разбирается тем же кодом
    const nested = 'AND,((OR,((DOMAIN,zzz.com),(DOMAIN,a.com))),(NETWORK,tcp)),A'
    expect(traceMihomo(doc(nested, 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
  })

  it('непроверяемое вложенное условие останавливает логическое правило целиком', () => {
    const res = traceMihomo(doc('AND,((DOMAIN,a.com),(UID,1000)),A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
  })

  it('точный промах во вложенном условии перевешивает непроверяемое', () => {
    // AND(нет, неизвестно) — это «нет»: правило не совпадёт ни при каком ответе
    const res = traceMihomo(doc('AND,((DOMAIN,zzz.com),(UID,1000)),A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped).toBeUndefined()
    expect(res.winner?.target).toBe('D')
  })

  it('логическое правило со сломанными скобками останавливает проход', () => {
    const res = traceMihomo(doc('AND,(DOMAIN,a.com),A', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
  })

  it('на эталонных шаблонах проход не падает и доходит до вердикта', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      const res = traceMihomo(md, T(), NO_GEO)
      expect(res.verdicts.length, name).toBeGreaterThan(0)
    }
  })
})

describe('трассировка спускается в подсписок правил', () => {
  const SUB = [
    'sub-rules:',
    '  ru:',
    '    - DOMAIN,zzz.com,Z',
    '    - DOMAIN-SUFFIX,a.com,S',
    '    - MATCH,M',
    'rules:',
    '  - DOMAIN,nope.com,N',
    '  - SUB-RULE,(NETWORK,tcp),ru',
    '  - MATCH,D',
    '',
  ].join('\n')

  it('победителем становится правило подсписка, а не первое попавшееся', () => {
    const res = traceMihomo(parseMihomo(SUB), T(), NO_GEO)
    // Правило SUB-RULE стоит вторым, а цель приходит из подсписка
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'S' })
    // Соседние цели победителем не являются
    expect(['Z', 'M', 'D', 'N']).not.toContain(res.winner?.target)
    expect(res.caveats.join(' ')).toMatch(/ru/)
  })

  it('условие SUB-RULE ложно — подсписок не открывается', () => {
    const res = traceMihomo(parseMihomo(SUB.replace('(NETWORK,tcp)', '(NETWORK,udp)')), T(), NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 2, target: 'D' })
  })

  it('подсписок, в котором ничего не совпало, возвращает проход в основной список', () => {
    const text = [
      'sub-rules:',
      '  ru:',
      '    - DOMAIN,zzz.com,Z',
      'rules:',
      '  - SUB-RULE,(NETWORK,tcp),ru',
      '  - MATCH,D',
      '',
    ].join('\n')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
    expect(res.verdicts[0]!.state).toBe('no')
  })

  it('непроверяемое правило внутри подсписка останавливает проход и называет подсписок', () => {
    const text = [
      'sub-rules:',
      '  ru:',
      '    - RULE-SET,ads,REJECT',
      'rules:',
      '  - SUB-RULE,(NETWORK,tcp),ru',
      '  - MATCH,D',
      '',
    ].join('\n')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/ru/)
    expect(res.winner).toBeUndefined()
  })

  it('ссылка на подсписок, которого нет, останавливает проход', () => {
    const res = traceMihomo(doc('SUB-RULE,(NETWORK,tcp),ghost', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/ghost/)
  })

  it('кольцо подсписков останавливает проход, а не стек', () => {
    const text = [
      'sub-rules:',
      '  a:',
      '    - SUB-RULE,(NETWORK,tcp),b',
      '  b:',
      '    - SUB-RULE,(NETWORK,tcp),a',
      'rules:',
      '  - SUB-RULE,(NETWORK,tcp),a',
      '  - MATCH,D',
      '',
    ].join('\n')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.winner).toBeUndefined()
  })
})

describe('geo-ключи шаблона Mihomo', () => {
  it('собираются из вложенных условий и из подсписков, без повторов', () => {
    const text = [
      'sub-rules:',
      '  s:',
      '    - GEOIP,us,A',
      'rules:',
      '  - AND,((GEOSITE,ads),(NETWORK,tcp)),B',
      '  - GEOSITE,ads,C',
      '  - SUB-RULE,(NETWORK,tcp),s',
      '',
    ].join('\n')
    expect(geoKeysOfMihomo(parseMihomo(text))).toEqual(['geosite:ads', 'geoip:us'])
  })

  it('правила без geo ключей не дают', () => {
    expect(geoKeysOfMihomo(doc('DOMAIN,a.com,A', 'MATCH,D'))).toEqual([])
  })
})

describe('оговорки трассировки Mihomo', () => {
  it('о хостах панели говорят условно', () => {
    const res = traceMihomo(doc('DOMAIN,a.com,Нидерланды', 'MATCH,D'), T(), NO_GEO)
    expect(res.winner?.target).toBe('Нидерланды')
    const text = res.caveats.join(' ')
    expect(text).toMatch(/Нидерланды/)
    expect(text).toMatch(/[Вв]озможно/)
    // Утверждать, что хост подставится, редактор права не имеет
    expect(text).not.toMatch(/панель подставит/)
  })

  it('цель, которая есть в документе, оговорки не даёт', () => {
    const text = [
      'proxy-groups:',
      '  - name: VPN',
      '    proxies:',
      '      - DIRECT',
      'rules:',
      '  - DOMAIN,a.com,VPN',
      '',
    ].join('\n')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO)
    expect(res.winner?.target).toBe('VPN')
    expect(res.caveats.join(' ')).not.toMatch(/VPN/)
  })

  it('незагруженная база названа отдельной оговоркой, а без geo-правил её нет', () => {
    const withGeo = traceMihomo(doc('GEOSITE,ads,A', 'MATCH,D'), T(), NO_GEO)
    expect(withGeo.caveats.join(' ')).toMatch(/Geo-базы не загружены/)
    const without = traceMihomo(doc('DOMAIN,a.com,DIRECT'), T(), NO_GEO)
    expect(without.caveats.join(' ')).not.toMatch(/Geo-базы не загружены/)
  })

  it('категория, которой нет в базе, названа поимённо', () => {
    const geo: GeoAnswers = { loaded: true, answers: {}, missing: ['geosite:ads'] }
    const res = traceMihomo(doc('GEOSITE,ads,A', 'MATCH,D'), T(), geo)
    expect(res.caveats.join(' ')).toMatch(/geosite:ads/)
  })
})

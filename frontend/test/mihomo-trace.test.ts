import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { geoKeysOfMihomo, parseClassicalEntry, traceMihomo } from '../src/entities/mihomo/trace'
import type { RuleSetAnswers } from '../src/entities/mihomo/trace'
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
    // Диапазон портов
    expect(traceMihomo(doc('DST-PORT,440-450,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    expect(traceMihomo(doc('DST-PORT,100-200,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
  })

  it('несколько портов перечисляются через «/», а не через запятую', () => {
    // Запятая у mihomo невозможна в принципе: она разделяет поля самого правила
    expect(traceMihomo(doc('DST-PORT,80/443,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    expect(traceMihomo(doc('DST-PORT,80/8080,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('D')
    // Диапазон внутри списка разбирается тем же кодом
    expect(traceMihomo(doc('DST-PORT,80/440-450,A', 'MATCH,D'), T(), NO_GEO).winner?.target).toBe('A')
    // Мусор вместо портов — остановка, а не молчаливое «не совпало»
    const broken = traceMihomo(doc('DST-PORT,http,A', 'MATCH,D'), T(), NO_GEO)
    expect(broken.stopped?.index).toBe(0)
    expect(broken.stopped?.reason).toMatch(/«\/»/)
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
    expect(on('DOMAIN-REGEX,^a\\.com$,A', 'a.com')).toBe('A')
    expect(on('DOMAIN-REGEX,^a\\.com$,A', 'xa.com')).toBe('D')
  })

  it('DOMAIN-WILDCARD знает подстановки ядра, а не clash-form', () => {
    const on = (raw: string, address: string) =>
      traceMihomo(doc(raw, 'MATCH,D'), T({ address }), NO_GEO).winner?.target
    // `*` — ноль или более ЛЮБЫХ символов, точки в том числе. Это прямо
    // оговорено в доках mihomo: подстановки здесь не те, что в списках доменов
    expect(on('DOMAIN-WILDCARD,*.google.com,A', 'a.google.com')).toBe('A')
    expect(on('DOMAIN-WILDCARD,*.google.com,A', 'a.b.google.com')).toBe('A')
    expect(on('DOMAIN-WILDCARD,*.google.com,A', 'google.ru')).toBe('D')
    // `?` — ровно один символ
    expect(on('DOMAIN-WILDCARD,?.a.com,A', 'x.a.com')).toBe('A')
    expect(on('DOMAIN-WILDCARD,?.a.com,A', 'xy.a.com')).toBe('D')
    // `+` здесь обычный символ, а не квантификатор
    expect(on('DOMAIN-WILDCARD,a+.com,A', 'ab.com')).toBe('D')
    expect(on('DOMAIN-WILDCARD,a+.com,A', 'a+.com')).toBe('A')
    // Точка — тоже литерал, а не «любой символ»
    expect(on('DOMAIN-WILDCARD,a.com,A', 'axcom')).toBe('D')
  })

  it('метасимвол в шаблоне домена не роняет трассировку', () => {
    // Трассировка пересчитывается на КАЖДУЮ правку текста, а ErrorBoundary в
    // приложении нет: исключение отсюда — белый экран вместо редактора
    for (const ch of ['[', ']', '{', '}', '\\', '|', '+', '^', '$', '?', '*']) {
      const raw = `DOMAIN-WILDCARD,${ch}zzz.com,A`
      expect(() => traceMihomo(doc(raw, 'MATCH,D'), T(), NO_GEO), raw).not.toThrow()
      const res = traceMihomo(doc(raw, 'MATCH,D'), T(), NO_GEO)
      // Ни падения, ни ложного совпадения: адрес a.com под такой шаблон не подходит
      expect(res.winner?.target, raw).toBe('D')
    }
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

  it('непроверяемое условие проходит наружу через OR и через NOT, а не гасится', () => {
    // Форма OR из двух RULE-SET стоит в обеих эталонных фикстурах: если OR
    // вернёт «нет» вместо «проверить нечем», разбор уверенно уйдёт мимо
    const or = traceMihomo(doc('OR,((RULE-SET,ads),(RULE-SET,ru)),A', 'MATCH,D'), T(), NO_GEO)
    expect(or.stopped?.index).toBe(0)
    expect(or.stopped?.reason).toMatch(/набор правил/i)
    expect(or.winner).toBeUndefined()
    // NOT от неизвестного — тоже неизвестное: отрицать нечего
    const not = traceMihomo(doc('NOT,((RULE-SET,ads)),A', 'MATCH,D'), T(), NO_GEO)
    expect(not.stopped?.index).toBe(0)
    expect(not.winner).toBeUndefined()
    // Точное «да» внутри OR перевешивает непроверяемое — остановки нет
    const hit = traceMihomo(doc('OR,((DOMAIN,a.com),(RULE-SET,ads)),A', 'MATCH,D'), T(), NO_GEO)
    expect(hit.stopped).toBeUndefined()
    expect(hit.winner?.target).toBe('A')
  })

  it('модификатор src останавливает проход: он про источник, а не про назначение', () => {
    // Посчитать `IP-CIDR,…,src` условием по назначению значило бы дать
    // уверенный неверный ответ — данных об источнике в цели трассировки нет
    const res = traceMihomo(
      doc('IP-CIDR,10.0.0.0/8,A,src', 'MATCH,D'),
      T({ ip: '10.1.2.3' }),
      NO_GEO,
    )
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/src/)
    expect(res.winner).toBeUndefined()
    // Без модификатора то же правило вычисляется и побеждает
    const plain = traceMihomo(doc('IP-CIDR,10.0.0.0/8,A', 'MATCH,D'), T({ ip: '10.1.2.3' }), NO_GEO)
    expect(plain.winner?.target).toBe('A')
    // no-resolve модификатором проход не глушит: он про резолв домена ядром
    const noResolve = traceMihomo(
      doc('IP-CIDR,10.0.0.0/8,A,no-resolve', 'MATCH,D'),
      T({ ip: '10.1.2.3' }),
      NO_GEO,
    )
    expect(noResolve.winner?.target).toBe('A')
  })

  it('PASS не объявляется победителем: ветка пропускается, разбор идёт дальше', () => {
    const res = traceMihomo(doc('DOMAIN,a.com,PASS', 'DOMAIN-SUFFIX,a.com,A', 'MATCH,D'), T(), NO_GEO)
    // Правило совпало — но маршрут даёт следующее
    expect(res.verdicts[0]!.state).toBe('yes')
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'A' })
    expect(res.caveats.join(' ')).toMatch(/PASS/)
  })

  it('PASS в конце списка не мешает дефолтному маршруту', () => {
    const res = traceMihomo(doc('DOMAIN,a.com,PASS'), T(), NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: null, target: 'DIRECT' })
    expect(res.stopped).toBeUndefined()
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
    // Открытый впустую подсписок объясняется: без этого «условие совпало, а
    // маршрут дало другое правило» выглядит необъяснимо
    expect(res.caveats.join(' ')).toMatch(/открыло подсписок «ru»/)
  })

  it('PASS внутри подсписка выводит обратно в основной список', () => {
    const text = [
      'sub-rules:',
      '  ru:',
      '    - DOMAIN,a.com,PASS',
      '    - MATCH,M',
      'rules:',
      '  - SUB-RULE,(NETWORK,tcp),ru',
      '  - MATCH,D',
      '',
    ].join('\n')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO)
    // MATCH,M внутри подсписка стоит ниже PASS и до него дело не доходит
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
    // Маршрут тут получается один и тот же, что бы ни решил редактор про PASS
    // внутри подсписка, — отличается ОБЪЯСНЕНИЕ, и оно обязано быть верным:
    // управление вернул подсписок, а цель правила #1 — «ru», а вовсе не PASS
    const text2 = res.caveats.join(' ')
    expect(text2).toMatch(/подсписок «ru»/)
    expect(text2).toMatch(/вернулся в основной список/)
    expect(text2).not.toMatch(/цель — PASS/)
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

// Ядро при `no-resolve` не резолвит домен по прямому указанию документа, и
// правило по IP остаётся с невалидным `DstIP`. Это ОПРЕДЕЛЁННЫЙ промах, а не
// неизвестность: `rules/common/ipcidr.go` возвращает
// `ip.IsValid() && i.ipnet.Contains(...)`, у `geoip.go` — явное
// `if !ip.IsValid() { return false, "" }`, а `rules/provider/rule_set.go` при
// `noResolveIP` зануляет сам колбэк резолва (`helper.ResolveIP = nil`).
describe('трассировка Mihomo: модификатор no-resolve', () => {
  const providers = (...lines: string[]): string =>
    ['rule-providers:', ...lines, ''].join('\n')

  it('IP-CIDR с no-resolve без IP в цели не совпадает, а не останавливает проход', () => {
    const res = traceMihomo(doc('IP-CIDR,::/0,REJECT-DROP,no-resolve', 'MATCH,D'), T(), NO_GEO)
    expect(res.verdicts[0]!.state).toBe('no')
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('без no-resolve то же правило по-прежнему останавливает проход', () => {
    // Ядро здесь домен как раз резолвит — какой выйдет IP, редактор не знает
    const res = traceMihomo(doc('IP-CIDR,::/0,REJECT-DROP', 'MATCH,D'), T(), NO_GEO)
    expect(res.verdicts[0]!.state).toBe('unknown')
    expect(res.stopped?.index).toBe(0)
  })

  it('GEOIP с no-resolve без IP не совпадает даже при незагруженных базах', () => {
    // Ответ не зависит от базы: смотреть в ней нечего, IP нет
    const res = traceMihomo(doc('GEOIP,private,DIRECT,no-resolve', 'MATCH,D'), T(), NO_GEO)
    expect(res.verdicts[0]!.state).toBe('no')
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('RULE-SET с behavior ipcidr и no-resolve не совпадает: скачивать набор незачем', () => {
    const text = [
      providers('  private-ips:', '    behavior: ipcidr', '    format: mrs'),
      doc('RULE-SET,private-ips,DIRECT,no-resolve', 'MATCH,D').text,
    ].join('')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO)
    expect(res.verdicts[0]!.state).toBe('no')
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('RULE-SET с behavior domain и no-resolve по-прежнему останавливает проход', () => {
    // Набор про домены: резолв ему не нужен, и без содержимого файла сказать нечего
    const text = [
      providers('  private-domains:', '    behavior: domain', '    format: mrs'),
      doc('RULE-SET,private-domains,DIRECT,no-resolve', 'MATCH,D').text,
    ].join('')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO)
    expect(res.verdicts[0]!.state).toBe('unknown')
    expect(res.stopped?.index).toBe(0)
  })

  it('RULE-SET на провайдера, которого нет в документе, останавливает проход', () => {
    // behavior взять неоткуда — предполагать ipcidr значило бы соврать «не совпало»
    const res = traceMihomo(doc('RULE-SET,ghost,DIRECT,no-resolve', 'MATCH,D'), T(), NO_GEO)
    expect(res.verdicts[0]!.state).toBe('unknown')
    expect(res.stopped?.index).toBe(0)
  })

  it('при заданном IP назначения no-resolve ничего не меняет', () => {
    const res = traceMihomo(
      doc('IP-CIDR,10.0.0.0/8,VPN,no-resolve', 'MATCH,D'),
      T({ ip: '10.1.2.3' }),
      NO_GEO,
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })
})

const NO_SETS: RuleSetAnswers = { answers: {}, pending: false }
const sets = (answers: RuleSetAnswers['answers'], pending = false): RuleSetAnswers => ({
  answers,
  pending,
})

describe('трассировка Mihomo: наборы правил', () => {
  it('набор ответил «да» — правило побеждает', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      sets({ ads: { state: 'yes', count: 10 } }),
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'REJECT' })
  })

  it('набор ответил «нет» — проход идёт дальше', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      sets({ ads: { state: 'no', count: 10 } }),
    )
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
    expect(res.stopped).toBeUndefined()
  })

  it('недоступный набор останавливает проход и называет причину', () => {
    const res = traceMihomo(
      doc('RULE-SET,ads,REJECT', 'MATCH,D'),
      T(),
      NO_GEO,
      sets({ ads: { state: 'unavailable', reason: 'сервер ответил 404' } }),
    )
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/404/)
    // Прежний текст обещал, что редактор наборы не скачивает, — это стало неправдой
    expect(res.stopped?.reason).not.toMatch(/не скачивает/)
  })

  it('пока ответы едут, причина говорит именно это', () => {
    const res = traceMihomo(doc('RULE-SET,ads,REJECT', 'MATCH,D'), T(), NO_GEO, sets({}, true))
    expect(res.stopped?.reason).toMatch(/загружа/i)
  })

  it('без ответов вообще проход по-прежнему останавливается', () => {
    const res = traceMihomo(doc('RULE-SET,ads,REJECT', 'MATCH,D'), T(), NO_GEO, NO_SETS)
    expect(res.stopped?.index).toBe(0)
  })

  it('no-resolve на ipcidr решает без ответа набора', () => {
    // Проверено в 8adf32e: содержимое файла на ответ не влияет
    const text = [
      'rule-providers:',
      '  p:',
      '    behavior: ipcidr',
      '',
      'rules:',
      '  - RULE-SET,p,DIRECT,no-resolve',
      '  - MATCH,D',
      '',
    ].join('\n')
    const res = traceMihomo(parseMihomo(text), T(), NO_GEO, NO_SETS)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })
})

describe('трассировка Mihomo: набор classical', () => {
  const classical = (lines: string[]) =>
    sets({ c: { state: 'lines', lines, count: lines.length } })

  it('совпавшая строка набора выигрывает правило', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'a.com' }),
      NO_GEO,
      classical(['DOMAIN-SUFFIX,a.com']),
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })

  it('набор — это ИЛИ: точное «да» перевешивает непроверяемую строку', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'a.com' }),
      NO_GEO,
      classical(['PROCESS-NAME,x.exe', 'DOMAIN-SUFFIX,a.com']),
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })

  it('непроверяемая строка без совпадений останавливает проход', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['PROCESS-NAME,x.exe', 'DOMAIN-SUFFIX,a.com']),
    )
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/PROCESS-NAME|процесс/i)
  })

  it('все строки промахнулись — набор не совпал, проход идёт дальше', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['DOMAIN-SUFFIX,a.com', 'DOMAIN,b.com']),
    )
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('строка, запрещённая ядром внутри classical, названа поимённо', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['RULE-SET,other']),
    )
    expect(res.stopped?.reason).toMatch(/RULE-SET/)
  })

  it('названа ПЕРВАЯ непроверяемая строка набора, а не последняя', () => {
    // Порядок здесь не косметика: причину читают, чтобы найти в наборе строку,
    // из-за которой разбор встал, и ищут её сверху вниз — как её читает ядро
    const forbidden = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['RULE-SET,other', 'PROCESS-NAME,x.exe', 'UID,1000']),
    )
    expect(forbidden.stopped?.reason).toMatch(/RULE-SET/)
    expect(forbidden.stopped?.reason).not.toMatch(/PROCESS-NAME/)
    expect(forbidden.stopped?.reason).not.toMatch(/UID/)
    // То же и когда первую неизвестность вернуло вычисление условия, а не разбор
    const judged = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['PROCESS-NAME,x.exe', 'UID,1000']),
    )
    expect(judged.stopped?.reason).toMatch(/PROCESS-NAME/)
    expect(judged.stopped?.reason).not.toMatch(/UID/)
    // И когда обе неизвестности пришли из одной ветки — запрещённых типов...
    const twoForbidden = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['RULE-SET,other', 'SUB-RULE,thing']),
    )
    expect(twoForbidden.stopped?.reason).toMatch(/RULE-SET,other/)
    expect(twoForbidden.stopped?.reason).not.toMatch(/SUB-RULE/)
    // ...и неразбираемых строк
    const twoBroken = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'zzz.com' }),
      NO_GEO,
      classical(['garbage', 'junk']),
    )
    expect(twoBroken.stopped?.reason).toMatch(/garbage/)
    expect(twoBroken.stopped?.reason).not.toMatch(/junk/)
  })

  it('строки classical идут без цели — три поля не требуются', () => {
    // `PROCESS-NAME,uTorrent.exe` — это ДВА поля. Разбор правилом документа
    // вернул бы null и потерял бы всю строку
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'a.com' }),
      NO_GEO,
      classical(['DOMAIN,a.com']),
    )
    expect(res.winner?.ruleIndex).toBe(0)
  })
})

describe('трассировка Mihomo: правила по процессу', () => {
  it('без процесса в цели проход останавливается, как раньше', () => {
    const res = traceMihomo(doc('PROCESS-NAME,chrome.exe,VPN', 'MATCH,D'), T(), NO_GEO)
    expect(res.stopped?.index).toBe(0)
    // Причина названа: остановка без объяснения читается как поломка редактора
    expect(res.stopped?.reason).toMatch(/процесс/i)
  })

  it('точное имя сравнивается без учёта регистра', () => {
    const t = T({ process: 'Chrome.exe' })
    expect(traceMihomo(doc('PROCESS-NAME,chrome.exe,VPN', 'MATCH,D'), t, NO_GEO).winner).toEqual({
      ruleIndex: 0,
      target: 'VPN',
    })
    expect(traceMihomo(doc('PROCESS-NAME,firefox.exe,VPN', 'MATCH,D'), t, NO_GEO).winner).toEqual({
      ruleIndex: 1,
      target: 'D',
    })
  })

  it('точное имя сравнивается ЦЕЛИКОМ, а не по вхождению', () => {
    // EqualFold — это равенство строк: `chrome` не ловит `chrome.exe`
    const t = T({ process: 'chrome.exe' })
    const res = traceMihomo(doc('PROCESS-NAME,chrome,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('REGEX ищет подстроку, а не совпадение целиком', () => {
    // `regexp2.MatchString` не заякорен: правило `discord` ловит и помощника
    const t = T({ process: 'my-discord-helper.exe' })
    const res = traceMihomo(doc('PROCESS-NAME-REGEX,discord,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })

  it('REGEX не учитывает регистр', () => {
    const t = T({ process: 'Discord.exe' })
    expect(
      traceMihomo(doc('PROCESS-NAME-REGEX,discord,VPN', 'MATCH,D'), t, NO_GEO).winner?.ruleIndex,
    ).toBe(0)
  })

  it('REGEX, который не нашёлся, — это промах, а не остановка', () => {
    const t = T({ process: 'chrome.exe' })
    const res = traceMihomo(doc('PROCESS-NAME-REGEX,discord,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'D' })
  })

  it('нерабочее выражение — остановка с причиной, а не промах', () => {
    const t = T({ process: 'x.exe' })
    const res = traceMihomo(doc('PROCESS-NAME-REGEX,[,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/регулярн/i)
  })

  it('подстановки: «*» — сколько угодно, «?» — ровно один', () => {
    const t = T({ process: 'chrome.exe' })
    const yes = (p: string) =>
      traceMihomo(doc(`PROCESS-NAME-WILDCARD,${p},VPN`, 'MATCH,D'), t, NO_GEO).winner?.ruleIndex
    expect(yes('chr*')).toBe(0)
    expect(yes('*.exe')).toBe(0)
    expect(yes('chrome.ex?')).toBe(0)
    expect(yes('chrome.ex??')).toBe(1)
    expect(yes('firefox*')).toBe(1)
    // Совпадение целиком: хвост, не покрытый шаблоном, — это промах
    expect(yes('chrome')).toBe(1)
    expect(yes('*.EXE')).toBe(0)
  })

  it('введён путь — работают оба семейства правил', () => {
    const t = T({ process: 'C:\\Program Files\\Chrome\\chrome.exe' })
    expect(
      traceMihomo(doc('PROCESS-NAME,chrome.exe,VPN', 'MATCH,D'), t, NO_GEO).winner?.ruleIndex,
    ).toBe(0)
    expect(
      traceMihomo(doc('PROCESS-PATH-REGEX,Program Files,VPN', 'MATCH,D'), t, NO_GEO).winner
        ?.ruleIndex,
    ).toBe(0)
  })

  it('имя из пути берётся по последнему разделителю, а путь сравнивается целиком', () => {
    // Правило по ИМЕНИ не должно ловить каталог, а правило по ПУТИ — имя
    const t = T({ process: '/usr/lib/chrome/chrome' })
    expect(traceMihomo(doc('PROCESS-NAME,chrome,VPN', 'MATCH,D'), t, NO_GEO).winner?.ruleIndex).toBe(
      0,
    )
    expect(traceMihomo(doc('PROCESS-NAME,usr,VPN', 'MATCH,D'), t, NO_GEO).winner?.ruleIndex).toBe(1)
    expect(traceMihomo(doc('PROCESS-PATH,chrome,VPN', 'MATCH,D'), t, NO_GEO).winner?.ruleIndex).toBe(
      1,
    )
    expect(
      traceMihomo(doc('PROCESS-PATH,/usr/lib/chrome/chrome,VPN', 'MATCH,D'), t, NO_GEO).winner
        ?.ruleIndex,
    ).toBe(0)
  })

  it('введено имя — правило по ПУТИ остаётся остановкой', () => {
    // Путь из имени не выводится, и подставлять догадку сюда нельзя
    const t = T({ process: 'chrome.exe' })
    const res = traceMihomo(doc('PROCESS-PATH,C:\\x\\chrome.exe,VPN', 'MATCH,D'), t, NO_GEO)
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/путь/i)
  })

  it('введено имя — остановкой остаётся и WILDCARD, и REGEX по пути', () => {
    const t = T({ process: 'chrome.exe' })
    for (const type of ['PROCESS-PATH-WILDCARD', 'PROCESS-PATH-REGEX']) {
      const res = traceMihomo(doc(`${type},*chrome*,VPN`, 'MATCH,D'), t, NO_GEO)
      expect(res.stopped?.index, type).toBe(0)
      expect(res.stopped?.reason, type).toMatch(/путь/i)
    }
  })

  it('пробелы вокруг процесса не считаются значением', () => {
    const res = traceMihomo(
      doc('PROCESS-NAME,chrome.exe,VPN', 'MATCH,D'),
      T({ process: '   ' }),
      NO_GEO,
    )
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/процесс/i)
  })

  it('процесс работает и внутри логического правила, и внутри набора', () => {
    const t = T({ process: 'chrome.exe', address: 'zzz.com' })
    const logical = traceMihomo(
      doc('OR,((DOMAIN,nope.com),(PROCESS-NAME,chrome.exe)),VPN', 'MATCH,D'),
      t,
      NO_GEO,
    )
    expect(logical.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })
})

// Строки набора приезжают из чужого файла: оформление их пользователь не
// контролирует и глазами не видит, поэтому вольности разбора здесь дороже, чем
// в правилах самого документа
describe('трассировка Mihomo: разбор строк набора classical', () => {
  const lines = (...ls: string[]): RuleSetAnswers =>
    sets({ c: { state: 'lines', lines: ls, count: ls.length } })

  it('пробел после запятой не мешает совпадению', () => {
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'google.com' }),
      NO_GEO,
      lines('DOMAIN-SUFFIX, google.com'),
    )
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'VPN' })
  })

  it('модификатор с пробелом остаётся модификатором', () => {
    // Иначе условие по ИСТОЧНИКУ посчиталось бы условием по назначению
    const res = traceMihomo(
      doc('RULE-SET,c,VPN', 'MATCH,D'),
      T({ address: 'a.com' }),
      NO_GEO,
      lines('DOMAIN,a.com, src'),
    )
    expect(res.stopped?.index).toBe(0)
    expect(res.stopped?.reason).toMatch(/src/)
  })

  it('parseClassicalEntry: два поля, лишние запятые, скобки', () => {
    expect(parseClassicalEntry('PROCESS-NAME,uTorrent.exe')).toEqual({
      type: 'PROCESS-NAME',
      payload: 'uTorrent.exe',
      modifiers: [],
    })
    expect(parseClassicalEntry('IP-CIDR,10.0.0.0/8,no-resolve')).toEqual({
      type: 'IP-CIDR',
      payload: '10.0.0.0/8',
      modifiers: ['no-resolve'],
    })
    expect(parseClassicalEntry('AND,((DOMAIN,a.com))')?.payload).toBe('((DOMAIN,a.com))')
    expect(parseClassicalEntry('MATCH')).toBeNull()
    expect(parseClassicalEntry('')).toBeNull()
    expect(parseClassicalEntry(',значение')).toBeNull()
  })
})

describe('трассировка Mihomo: имя набора из чужого документа', () => {
  it('имя, совпадающее с членом Object.prototype, не даёт молчаливого «не совпало»', () => {
    // `answers['toString']` в обычном объекте вернёт функцию, а не undefined
    const res = traceMihomo(doc('RULE-SET,toString,VPN', 'MATCH,D'), T(), NO_GEO, sets({}))
    expect(res.stopped?.index).toBe(0)
    expect(res.winner).toBeUndefined()
  })
})

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

import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { traceSingbox } from '../src/entities/singbox/trace'
import type { SingboxDoc } from '../src/entities/singbox/types'
import type { TraceTarget } from '../src/entities/xray'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

/**
 * Цель трассировки общая на все документы проекта: её заполняет `TraceBar`, и
 * порт с транспортом в ней есть всегда. Помощник задаёт им обычные значения,
 * чтобы тест говорил только о том, о чём он на самом деле.
 */
function t(address: string, extra: Partial<TraceTarget> = {}): TraceTarget {
  return { address, port: 443, network: 'tcp', ...extra }
}

const BASE = '{"type":"direct","tag":"direct"},{"type":"selector","tag":"g","outbounds":null}'

describe('трассировка sing-box', () => {
  it('выигрывает ПЕРВОЕ совпавшее правило, а не любое подходящее', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"domain_suffix":["example.com"],"outbound":"direct"},
      {"domain":"www.example.com","outbound":"g"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, t('www.example.com'))
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('domain_suffix без точки ловит и сам домен, и поддомен, но не соседа', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain_suffix":["example.com"],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, t('example.com')).winner!.target).toBe('direct')
    expect(traceSingbox(d, t('www.example.com')).winner!.target).toBe('direct')
    // Граница метки, а не строковый суффикс
    expect(traceSingbox(d, t('myexample.com')).winner!.target).toBe('g')
  })

  it('domain_suffix с ведущей точкой сам домен не ловит', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain_suffix":[".example.com"],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, t('www.example.com')).winner!.target).toBe('direct')
    expect(traceSingbox(d, t('example.com')).winner!.target).toBe('g')
  })

  it('несколько условий в правиле — это «и»', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"domain":"a.com","port":[443],"outbound":"direct"}
    ],"final":"g"}}`)
    expect(traceSingbox(d, t('a.com')).winner).toEqual({ ruleIndex: 0, target: 'direct' })
    // Домен тот же, порт другой — «и» не выполнено, и это ОПРЕДЕЛЁННЫЙ промах
    const other = traceSingbox(d, t('a.com', { port: 80 }))
    expect(other.stopped).toBeUndefined()
    expect(other.winner).toEqual({ ruleIndex: null, target: 'g' })
  })

  it('нетерминальные действия не выбирают выход и не мешают идти дальше', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"action":"sniff"},
      {"action":"resolve"},
      {"domain":"a.com","outbound":"direct"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, t('a.com'))
    expect(res.winner).toEqual({ ruleIndex: 2, target: 'direct' })
  })

  it('reject — это ответ, а не остановка', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"ads.com","action":"reject"}],"final":"g"}}`,
    )
    const res = traceSingbox(d, t('ads.com'))
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'reject' })
    expect(res.stopped).toBeUndefined()
  })

  it('bypass с outbound называет победителем сам выход, а не действие', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"a.com","action":"bypass","outbound":"direct"}],"final":"g"}}`,
    )
    // Как у buildGraph: с outbound bypass ведёт туда же, куда route, а не в builtin
    expect(traceSingbox(d, t('a.com')).winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('bypass без outbound называет победителем имя действия', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[{"domain":"a.com","action":"bypass"}],"final":"g"}}`)
    expect(traceSingbox(d, t('a.com')).winner).toEqual({ ruleIndex: 0, target: 'bypass' })
  })

  it('rule_set останавливает разбор и называет причину', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"rule_set":["ru"],"outbound":"g"},
      {"domain":"a.com","outbound":"direct"}
    ],"rule_set":[{"tag":"ru"}],"final":"g"}}`)
    const res = traceSingbox(d, t('a.com'))
    expect(res.stopped).toEqual({ index: 0, reason: expect.stringMatching(/набор|rule_set/i) })
    // Правила НИЖЕ остановки в разбор не попадают: они выполняются ровно при
    // условии, что непроверяемое правило не совпало, — а этого мы не знаем
    expect(res.winner).toBeUndefined()
    expect(res.verdicts).toHaveLength(1)
  })

  it('clash_mode останавливает: режим живёт в клиенте', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"clash_mode":"Global","outbound":"g"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, t('a.com')).stopped?.index).toBe(0)
  })

  it('логическое «или»: точное «да» перевешивает неизвестность', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"type":"logical","mode":"or","rules":[{"clash_mode":"Global"},{"domain":"a.com"}],"outbound":"direct"}
    ],"final":"g"}}`)
    expect(traceSingbox(d, t('a.com')).winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('логическое «и»: точное «нет» перевешивает неизвестность', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"type":"logical","mode":"and","rules":[{"clash_mode":"Global"},{"domain":"b.com"}],"outbound":"direct"},
      {"domain":"a.com","outbound":"g"}
    ],"final":"direct"}}`)
    const res = traceSingbox(d, t('a.com'))
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'g' })
  })

  it('invert обращает результат', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"b.com","invert":true,"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, t('a.com')).winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('ни одно правило не совпало — победитель дефолтный выход, и сказано откуда он', () => {
    const withFinal = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"b.com","outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(withFinal, t('a.com')).winner).toEqual({ ruleIndex: null, target: 'g' })

    const noFinal = doc(`{"outbounds":[${BASE}],"route":{"rules":[]}}`)
    const res = traceSingbox(noFinal, t('a.com'))
    expect(res.winner).toEqual({ ruleIndex: null, target: 'direct' })
    expect(res.caveats.join(' ')).toMatch(/final/i)
  })

  it('битый domain_regex не роняет разбор, а останавливает его', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain_regex":["("],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, t('a.com')).stopped?.index).toBe(0)
  })

  it('IP-цель проверяется по ip_cidr, домен без адреса по такому правилу неизвестен', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"ip_cidr":["10.0.0.0/8"],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, t('10.1.2.3')).winner!.target).toBe('direct')
    expect(traceSingbox(d, t('8.8.8.8')).winner!.target).toBe('g')
    expect(traceSingbox(d, t('a.com')).stopped?.index).toBe(0)
  })

  // Ниже — решения, которых в брифе задачи не было; каждое меняет ответ там, где
  // бриф давал остановку, и потому обязано быть закреплено тестом.

  it('домённое правило против IP-цели — определённый промах, пока документ не снифает', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"domain_suffix":["example.com"],"outbound":"direct"},
      {"ip_cidr":["8.8.8.0/24"],"outbound":"g"}
    ],"final":"direct"}}`)
    // Домена у такого запроса у ядра нет, и сравнивать ему нечего: остановка
    // здесь сделала бы трассировку адреса бесполезной на первом же правиле
    const res = traceSingbox(d, t('8.8.8.8'))
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'g' })
  })

  it('сниффинг возвращает остановку: имя из запроса известно только ядру', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"action":"sniff"},
      {"domain_suffix":["example.com"],"outbound":"direct"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, t('8.8.8.8'))
    expect(res.stopped).toEqual({ index: 1, reason: expect.stringMatching(/сниффинг/i) })

    // Старая форма записи — поле у входа, а не действие в правилах
    const legacy = doc(`{"inbounds":[{"type":"mixed","tag":"in","sniff":true}],"outbounds":[${BASE}],
      "route":{"rules":[{"domain_suffix":["example.com"],"outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(legacy, t('8.8.8.8')).stopped?.index).toBe(0)
  })

  it('ip_is_private считает приватным то же, что и ядро, а не только 10/8', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"ip_is_private":true,"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, t('172.20.1.1')).winner!.target).toBe('direct')
    expect(traceSingbox(d, t('169.254.0.7')).winner!.target).toBe('direct')
    expect(traceSingbox(d, t('fd00::1')).winner!.target).toBe('direct')
    expect(traceSingbox(d, t('172.32.1.1')).winner!.target).toBe('g')
    expect(traceSingbox(d, t('8.8.8.8')).winner!.target).toBe('g')
  })

  it('пустая цель — остановка без правила, а не молчаливый дефолтный выход', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"a.com","outbound":"direct"}],"final":"g"}}`,
    )
    const res = traceSingbox(d, t('   '))
    expect(res.winner).toBeUndefined()
    expect(res.stopped?.index).toBeNull()
    expect(res.verdicts).toHaveLength(0)
  })

  // Цель стала общим `TraceTarget` (задача 9): порт, транспорт и адрес
  // назначения в ней есть всегда, и условия по ним обязаны проверяться, а не
  // останавливать проход.

  it('порт проверяется, а не останавливает проход', () => {
    const d = doc(
      '{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port":[443],"outbound":"d"}]}}',
    )
    expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp' }).winner?.target).toBe('d')
    const miss = traceSingbox(d, { address: 'a.com', port: 80, network: 'tcp' })
    expect(miss.stopped).toBeUndefined()
    expect(miss.verdicts[0]!.state).toBe('no')
  })

  it('диапазон портов разбирается в обе стороны и с открытым краем', () => {
    const d = doc(
      '{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port_range":["1000:2000"],"outbound":"d"}]}}',
    )
    expect(traceSingbox(d, { address: 'a.com', port: 1500, network: 'tcp' }).winner).toBeDefined()
    expect(traceSingbox(d, { address: 'a.com', port: 80, network: 'tcp' }).verdicts[0]!.state).toBe(
      'no',
    )

    // Открытый край — обе формы записи ядра
    const lower = doc(
      '{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port_range":[":1000"],"outbound":"d"}]}}',
    )
    expect(traceSingbox(lower, { address: 'a.com', port: 80, network: 'tcp' }).winner).toBeDefined()
    expect(
      traceSingbox(lower, { address: 'a.com', port: 2000, network: 'tcp' }).verdicts[0]!.state,
    ).toBe('no')

    const upper = doc(
      '{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port_range":["1000:"],"outbound":"d"}]}}',
    )
    expect(
      traceSingbox(upper, { address: 'a.com', port: 60000, network: 'tcp' }).winner,
    ).toBeDefined()
    expect(
      traceSingbox(upper, { address: 'a.com', port: 80, network: 'tcp' }).verdicts[0]!.state,
    ).toBe('no')
  })

  it('неразбираемый диапазон портов останавливает, а не считается промахом', () => {
    const d = doc(
      '{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port_range":["хлам"],"outbound":"d"}]}}',
    )
    expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp' }).stopped).toBeDefined()
  })

  it('транспорт проверяется: пользователь его ввёл, и говорить «неизвестен» было бы враньём', () => {
    const d = doc(
      '{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"network":"udp","outbound":"d"}]}}',
    )
    expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'udp' }).winner?.target).toBe('d')
    expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp' }).verdicts[0]!.state).toBe(
      'no',
    )
  })

  it('IP назначения из цели отвечает на ip_cidr при доменной цели', () => {
    // Поле заполняет пользователь: сервер домены не резолвит
    const d = doc(
      '{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"ip_cidr":["10.0.0.0/8"],"outbound":"d"}]}}',
    )
    expect(
      traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp', ip: '10.1.2.3' }).winner,
    ).toBeDefined()
  })

  it('IP назначения из цели отвечает и на ip_is_private при доменной цели', () => {
    const d = doc(
      '{"outbounds":[{"type":"direct","tag":"d"},{"type":"direct","tag":"pub"}],"route":{"rules":[{"ip_is_private":true,"outbound":"d"}],"final":"pub"}}',
    )
    expect(
      traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp', ip: '192.168.1.5' }).winner
        ?.target,
    ).toBe('d')
    expect(
      traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp', ip: '8.8.8.8' }).winner?.target,
    ).toBe('pub')
  })
})

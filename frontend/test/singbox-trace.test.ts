import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { traceSingbox } from '../src/entities/singbox/trace'
import type { SingboxDoc } from '../src/entities/singbox/types'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

const BASE = '{"type":"direct","tag":"direct"},{"type":"selector","tag":"g","outbounds":null}'

describe('трассировка sing-box', () => {
  it('выигрывает ПЕРВОЕ совпавшее правило, а не любое подходящее', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"domain_suffix":["example.com"],"outbound":"direct"},
      {"domain":"www.example.com","outbound":"g"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, 'www.example.com')
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('domain_suffix без точки ловит и сам домен, и поддомен, но не соседа', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain_suffix":["example.com"],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, 'example.com').winner!.target).toBe('direct')
    expect(traceSingbox(d, 'www.example.com').winner!.target).toBe('direct')
    // Граница метки, а не строковый суффикс
    expect(traceSingbox(d, 'myexample.com').winner!.target).toBe('g')
  })

  it('domain_suffix с ведущей точкой сам домен не ловит', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain_suffix":[".example.com"],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, 'www.example.com').winner!.target).toBe('direct')
    expect(traceSingbox(d, 'example.com').winner!.target).toBe('g')
  })

  it('несколько условий в правиле — это «и»', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"domain":"a.com","port":[443],"outbound":"direct"}
    ],"final":"g"}}`)
    // Порт цели не задан, значит условие port проверить нечем
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
  })

  it('нетерминальные действия не выбирают выход и не мешают идти дальше', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"action":"sniff"},
      {"action":"resolve"},
      {"domain":"a.com","outbound":"direct"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, 'a.com')
    expect(res.winner).toEqual({ ruleIndex: 2, target: 'direct' })
  })

  it('reject — это ответ, а не остановка', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"ads.com","action":"reject"}],"final":"g"}}`,
    )
    const res = traceSingbox(d, 'ads.com')
    expect(res.winner).toEqual({ ruleIndex: 0, target: 'reject' })
    expect(res.stopped).toBeUndefined()
  })

  it('rule_set останавливает разбор и называет причину', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"rule_set":["ru"],"outbound":"g"},
      {"domain":"a.com","outbound":"direct"}
    ],"rule_set":[{"tag":"ru"}],"final":"g"}}`)
    const res = traceSingbox(d, 'a.com')
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
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
  })

  it('логическое «или»: точное «да» перевешивает неизвестность', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"type":"logical","mode":"or","rules":[{"clash_mode":"Global"},{"domain":"a.com"}],"outbound":"direct"}
    ],"final":"g"}}`)
    expect(traceSingbox(d, 'a.com').winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('логическое «и»: точное «нет» перевешивает неизвестность', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"type":"logical","mode":"and","rules":[{"clash_mode":"Global"},{"domain":"b.com"}],"outbound":"direct"},
      {"domain":"a.com","outbound":"g"}
    ],"final":"direct"}}`)
    const res = traceSingbox(d, 'a.com')
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'g' })
  })

  it('invert обращает результат', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"b.com","invert":true,"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, 'a.com').winner).toEqual({ ruleIndex: 0, target: 'direct' })
  })

  it('ни одно правило не совпало — победитель дефолтный выход, и сказано откуда он', () => {
    const withFinal = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"b.com","outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(withFinal, 'a.com').winner).toEqual({ ruleIndex: null, target: 'g' })

    const noFinal = doc(`{"outbounds":[${BASE}],"route":{"rules":[]}}`)
    const res = traceSingbox(noFinal, 'a.com')
    expect(res.winner).toEqual({ ruleIndex: null, target: 'direct' })
    expect(res.caveats.join(' ')).toMatch(/final/i)
  })

  it('битый domain_regex не роняет разбор, а останавливает его', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain_regex":["("],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
  })

  it('IP-цель проверяется по ip_cidr, домен по такому правилу неизвестен', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"ip_cidr":["10.0.0.0/8"],"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, '10.1.2.3').winner!.target).toBe('direct')
    expect(traceSingbox(d, '8.8.8.8').winner!.target).toBe('g')
    expect(traceSingbox(d, 'a.com').stopped?.index).toBe(0)
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
    const res = traceSingbox(d, '8.8.8.8')
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 1, target: 'g' })
  })

  it('сниффинг возвращает остановку: имя из запроса известно только ядру', () => {
    const d = doc(`{"outbounds":[${BASE}],"route":{"rules":[
      {"action":"sniff"},
      {"domain_suffix":["example.com"],"outbound":"direct"}
    ],"final":"g"}}`)
    const res = traceSingbox(d, '8.8.8.8')
    expect(res.stopped).toEqual({ index: 1, reason: expect.stringMatching(/сниффинг/i) })

    // Старая форма записи — поле у входа, а не действие в правилах
    const legacy = doc(`{"inbounds":[{"type":"mixed","tag":"in","sniff":true}],"outbounds":[${BASE}],
      "route":{"rules":[{"domain_suffix":["example.com"],"outbound":"direct"}],"final":"g"}}`)
    expect(traceSingbox(legacy, '8.8.8.8').stopped?.index).toBe(0)
  })

  it('ip_is_private считает приватным то же, что и ядро, а не только 10/8', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"ip_is_private":true,"outbound":"direct"}],"final":"g"}}`,
    )
    expect(traceSingbox(d, '172.20.1.1').winner!.target).toBe('direct')
    expect(traceSingbox(d, '169.254.0.7').winner!.target).toBe('direct')
    expect(traceSingbox(d, 'fd00::1').winner!.target).toBe('direct')
    expect(traceSingbox(d, '172.32.1.1').winner!.target).toBe('g')
    expect(traceSingbox(d, '8.8.8.8').winner!.target).toBe('g')
  })

  it('пустая цель — остановка без правила, а не молчаливый дефолтный выход', () => {
    const d = doc(
      `{"outbounds":[${BASE}],"route":{"rules":[{"domain":"a.com","outbound":"direct"}],"final":"g"}}`,
    )
    const res = traceSingbox(d, '   ')
    expect(res.winner).toBeUndefined()
    expect(res.stopped?.index).toBeNull()
    expect(res.verdicts).toHaveLength(0)
  })
})

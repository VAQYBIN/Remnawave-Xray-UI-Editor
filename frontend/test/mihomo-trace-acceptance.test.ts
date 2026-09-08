// Приёмка всей работы по наборам правил: настоящий шаблон из каталога,
// настоящие дескрипторы, ответы той формы, что отдаёт бэкенд. Проверяется не
// отдельная функция, а сквозной результат — куда уйдёт трафик и где проход
// честно встанет.
import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { ruleSetDescriptors } from '../src/entities/mihomo/ruleSets'
import { traceMihomo, type RuleSetAnswers } from '../src/entities/mihomo/trace'
import { rulesOf } from '../src/entities/mihomo/rules'
import type { GeoAnswers, TraceTarget } from '../src/entities/xray'
import { mihomoFixture } from './helpers'

const NO_GEO: GeoAnswers = { loaded: false, answers: {}, missing: [] }
const md = parseMihomo(mihomoFixture('roscomvpn'))

/**
 * Ответы, какие на самом деле вернул бы бэкенд: все наборы промахиваются,
 * classical отдаёт строки, а набор ПОДСЕТЕЙ без IP в цели отвечать отказывается.
 * Последнее принципиально — выдать за него «нет» значило бы построить приёмку на
 * ответе, которого сервис не даёт, и заодно на той самой лжи, ради устранения
 * которой он и правился.
 */
function answersFor(target: TraceTarget): RuleSetAnswers {
  const answers: RuleSetAnswers['answers'] = {}
  for (const set of ruleSetDescriptors(md)) {
    if (set.kind !== 'http' && set.kind !== 'inline') continue
    if (set.behavior === 'classical') {
      answers[set.name] = { state: 'lines', lines: ['PROCESS-NAME,uTorrent.exe'], count: 1 }
    } else if (set.behavior === 'ipcidr' && target.ip === undefined) {
      answers[set.name] = { state: 'unavailable', reason: 'в цели трассировки нет IP назначения' }
    } else {
      answers[set.name] = { state: 'no', count: 0 }
    }
  }
  return { answers, pending: false }
}

const target = (over: Partial<TraceTarget> = {}): TraceTarget => ({
  address: 'example.com',
  port: 443,
  network: 'tcp',
  ...over,
})

describe('приёмка: эталонный шаблон RoscomVPN', () => {
  it('в шаблоне 31 правило', () => {
    expect(rulesOf(md)).toHaveLength(31)
  })

  it('без наборов и без процесса проход встаёт в начале списка', () => {
    // Так это выглядело до всей работы: измеренное состояние, а не догадка
    const res = traceMihomo(md, target(), NO_GEO)
    expect(res.stopped?.index).toBe(3)
  })

  it('наборы отвечают, процесса нет — упирается в правила по процессу', () => {
    const res = traceMihomo(md, target(), NO_GEO, answersFor(target()))
    expect(res.stopped?.index).toBe(24)
  })

  it('наборы и процесс есть, а IP нет — останов на наборе подсетей', () => {
    // Правило #30 — RULE-SET,direct-ips: набор подсетей БЕЗ no-resolve. Ядро
    // здесь домен резолвит и проверяет полученный адрес; какой он выйдет, мы не
    // знаем. Остановка тут — не недоделка, а единственный честный ответ
    const t = target({ process: 'chrome.exe' })
    const res = traceMihomo(md, t, NO_GEO, answersFor(t))
    expect(res.stopped?.index).toBe(29)
    expect(res.stopped?.reason).toMatch(/IP назначения/)
  })

  it('цель задана полностью — проход доходит до MATCH', () => {
    // Ради этой строки всё и делалось
    const t = target({ process: 'chrome.exe', ip: '203.0.113.7' })
    const res = traceMihomo(md, t, NO_GEO, answersFor(t))
    expect(res.stopped).toBeUndefined()
    expect(res.winner).toEqual({ ruleIndex: 30, target: 'PROXY' })
  })

  it('совпавший набор выигрывает раньше и не доходит до конца', () => {
    const answers = answersFor(target())
    answers.answers['whitelist'] = { state: 'yes', count: 100 }
    const res = traceMihomo(
      md,
      target({ address: 'gosuslugi.ru', process: 'chrome.exe' }),
      NO_GEO,
      answers,
    )
    expect(res.winner?.target).toBe('DIRECT')
    expect(res.winner!.ruleIndex).toBeLessThan(30)
  })

  it('один недоступный набор возвращает остановку на нём', () => {
    const answers = answersFor(target())
    answers.answers['category-ads'] = { state: 'unavailable', reason: 'сервер ответил 404' }
    const res = traceMihomo(md, target({ process: 'chrome.exe' }), NO_GEO, answers)
    expect(res.stopped?.reason).toMatch(/404/)
  })
})

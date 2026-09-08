import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo'
import { ruleSetDescriptors } from '../src/entities/mihomo/ruleSets'

const doc = (...lines: string[]) => parseMihomo(['rule-providers:', ...lines, ''].join('\n'))

describe('дескрипторы наборов', () => {
  it('читает набор по ссылке целиком', () => {
    const md = doc(
      '  ads:',
      '    type: http',
      '    behavior: domain',
      '    format: mrs',
      '    url: https://example.com/ads.mrs',
      '    interval: 86400',
    )
    expect(ruleSetDescriptors(md)).toEqual([
      {
        name: 'ads',
        kind: 'http',
        url: 'https://example.com/ads.mrs',
        behavior: 'domain',
        format: 'mrs',
        intervalSec: 86400,
      },
    ])
  })

  it('ЯВНО пустой format — тоже yaml, а не отказ', () => {
    // `ParseRuleFormat("")` у ядра отдаёт YamlRule, поэтому отсутствие ключа и
    // пустая строка обязаны давать одно и то же. Через `??` они расходились:
    // пустая строка проскакивала мимо умолчания прямо в «формат незнаком»
    const md = doc('  a:', '    type: http', '    behavior: domain', '    format: ""', '    url: https://e.com/a')
    expect(ruleSetDescriptors(md)[0]).toMatchObject({ kind: 'http', format: 'yaml' })
  })

  it('пустой behavior — отказ: ядро его тоже не принимает', () => {
    // Асимметрия с format намеренная: `ParseBehavior("")` валится ошибкой
    const md = doc('  a:', '    type: http', '    behavior: ""', '    url: https://e.com/a')
    expect(ruleSetDescriptors(md)[0]).toMatchObject({ kind: 'unsupported' })
  })

  it('пустой format означает yaml — так его понимает ядро', () => {
    const md = doc('  a:', '    type: http', '    behavior: classical', '    url: https://e.com/a')
    expect(ruleSetDescriptors(md)[0]).toMatchObject({ format: 'yaml' })
  })

  it('inline берёт payload из документа и не имеет ссылки', () => {
    const md = doc(
      '  local:',
      '    type: inline',
      '    behavior: domain',
      '    payload:',
      '      - "+.example.com"',
    )
    expect(ruleSetDescriptors(md)[0]).toMatchObject({
      name: 'local',
      kind: 'inline',
      payload: ['+.example.com'],
    })
  })

  it('type: file недоступен редактору и помечается этим, а не пропадает', () => {
    const md = doc('  f:', '    type: file', '    behavior: domain', '    path: ./x.mrs')
    const [d] = ruleSetDescriptors(md)
    expect(d).toMatchObject({ name: 'f', kind: 'file' })
  })

  it('поле proxy сохраняется — на нём держится оговорка трассы', () => {
    const md = doc(
      '  a:',
      '    type: http',
      '    behavior: domain',
      '    url: https://e.com/a',
      '    proxy: Авто',
    )
    expect(ruleSetDescriptors(md)[0]).toMatchObject({ proxy: 'Авто' })
  })

  it('незнакомый behavior или format не выдумывается', () => {
    const md = doc('  a:', '    type: http', '    behavior: странное', '    url: https://e.com/a')
    const [d] = ruleSetDescriptors(md)
    // Подставить «domain» значило бы ответить не на тот вопрос
    expect(d).toMatchObject({ kind: 'unsupported' })
  })

  it('незнакомый вид провайдера не считается сетевым', () => {
    // Иначе редактор скачал бы то, чего документ не просил
    const md = doc('  a:', '    type: htpt', '    behavior: domain', '    url: https://e.com/a')
    expect(ruleSetDescriptors(md)[0]).toMatchObject({ kind: 'unsupported' })
  })

  it('на документе без секции возвращает пусто', () => {
    expect(ruleSetDescriptors(parseMihomo('rules:\n  - MATCH,DIRECT\n'))).toEqual([])
  })
})

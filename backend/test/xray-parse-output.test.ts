import { describe, expect, it } from 'vitest'
import { parseXrayOutput, parseXrayWarnings, versionOf } from '../src/xray/parseOutput.js'

const OK =
  'Xray 26.6.27 (Xray, Penetrates Everything.) Custom (go1.24.4 linux/amd64)\nConfiguration OK.\n'

describe('versionOf', () => {
  it('достаёт версию из первой строки', () => {
    expect(versionOf(OK)).toBe('26.6.27')
  })

  it('нет строки Xray — undefined', () => {
    expect(versionOf('что-то другое')).toBeUndefined()
  })
})

describe('parseXrayOutput', () => {
  it('успешный прогон — ни одной ошибки', () => {
    expect(parseXrayOutput(OK, '/data/tmp/x.json')).toEqual([])
  })

  it('пустые clients — подсказка про пользователей', () => {
    const out =
      'Failed to start: main: failed to load config: [/data/tmp/x.json] > infra/conf: failed to build config > proxy/vless/inbound: empty clients'
    const errors = parseXrayOutput(out, '/data/tmp/x.json')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.hint).toMatch(/пользовател/i)
  })

  it('путь к временному файлу не утекает в сообщение', () => {
    const out =
      'Failed to start: main: failed to load config: [/data/tmp/xray-test-abc.json] > infra/conf: bad'
    const errors = parseXrayOutput(out, '/data/tmp/xray-test-abc.json')
    expect(errors[0]!.message).not.toContain('/data/tmp')
    expect(errors[0]!.message).not.toContain('xray-test-abc.json')
  })

  it('отсутствие geo-баз помечается кодом geo', () => {
    const out =
      'Failed to start: main: failed to load config: [/x.json] > infra/conf: failed to build config > failed to open file: geosite.dat'
    const errors = parseXrayOutput(out, '/x.json')
    expect(errors[0]!.code).toBe('geo')
    expect(errors[0]!.hint).toMatch(/Geo-базы/)
  })

  it('битый тег outbound — своя подсказка', () => {
    const out =
      'Failed to start: main: failed to load config: [/x.json] > app/router: unable to find outbound tag: proxy'
    expect(parseXrayOutput(out, '/x.json')[0]!.hint).toMatch(/outbound/i)
  })

  it('номер строки достаётся, если ядро его назвало', () => {
    const out =
      'Failed to start: main: failed to load config: [/x.json] > json: invalid character at line 12'
    expect(parseXrayOutput(out, '/x.json')[0]!.line).toBe(12)
  })

  it('незнакомый текст показывается как есть, без подсказки', () => {
    const errors = parseXrayOutput('Failed to start: something entirely new', '/x.json')
    expect(errors[0]!.message).toBe('something entirely new')
    expect(errors[0]!.hint).toBeUndefined()
  })

  it('panic тоже попадает в ошибки', () => {
    expect(parseXrayOutput('panic: runtime error: index out of range', '/x.json')).toHaveLength(1)
  })

  it('вывод без вердикта и без Failed — одна ошибка с исходным текстом', () => {
    const errors = parseXrayOutput('какая-то мусорная строка', '/x.json')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('мусорная')
  })

  // Строки ниже сняты с настоящего Xray 26.6.27 (прогон в докере, 2026-07-25):
  // шаблоны подсказок обязаны совпадать с тем, что ядро пишет на самом деле
  describe('на реальном выводе ядра', () => {
    it('нет geo-баз', () => {
      const out =
        'Failed to start: main: failed to load config files: [/cfg/injected.json] > infra/conf: failed to build routing configuration > infra/conf: invalid field rule > common/geodata: illegal domain rule: geosite:category-ads-all > common/geodata: failed to open geosite.dat > stat /usr/local/bin/geosite.dat: no such file or directory'
      const err = parseXrayOutput(out, '/cfg/injected.json')[0]!
      expect(err.code).toBe('geo')
      expect(err.message).not.toContain('/cfg/')
    })

    it('неизвестный протокол ядро называет unknown config id', () => {
      const out =
        'Failed to start: main: failed to load config files: [/x.json] > infra/conf: failed to build inbound config with tag TROJAN-IN > infra/conf: failed to load inbound detour config for protocol vmesss > infra/conf: unknown config id: vmesss'
      expect(parseXrayOutput(out, '/x.json')[0]!.hint).toMatch(/протокол/i)
    })

    it('Reality без serverNames — кавычки в тексте не мешают', () => {
      const out =
        'Failed to start: main: failed to load config files: [/x.json] > infra/conf: Failed to build REALITY config. > infra/conf: empty "serverNames"'
      expect(parseXrayOutput(out, '/x.json')[0]!.hint).toMatch(/serverNames/)
    })

    // Дословный ответ ядра v26.6.27 на leastPing без observatory: ни имени
    // балансера, ни имени секции — без подсказки текст ничего не говорит.
    it('стратегия балансера без секции измерений — ядро отвечает про зависимости', () => {
      const out = 'Failed to start: main: failed to create server > core: not all dependencies are resolved.'
      expect(parseXrayOutput(out, '/x.json')[0]!.hint).toMatch(/observatory/)
    })
  })
})

describe('parseXrayWarnings', () => {
  it('достаёт предупреждения ядра — они приходят и при успешной проверке', () => {
    const out =
      'Xray 26.6.27\n2026/07/25 15:39:15.299055 [Warning] common/errors: The feature Trojan (with no Flow, etc.) is deprecated.\nConfiguration OK.\n'
    expect(parseXrayWarnings(out)).toEqual([
      'common/errors: The feature Trojan (with no Flow, etc.) is deprecated.',
    ])
  })

  it('строки Info не считаются предупреждениями — там путь к временному файлу', () => {
    const out = '2026/07/25 15:39:14 [Info] infra/conf/serial: Reading config: &{Name:/tmp/x.json}'
    expect(parseXrayWarnings(out)).toEqual([])
  })

  it('предупреждений нет — пустой список', () => {
    expect(parseXrayWarnings('Configuration OK.')).toEqual([])
  })
})

describe('запреты ядра v26.7.28', () => {
  it('запрет VLESS без шифрования получает русскую подсказку', () => {
    const out =
      'Failed to start: main: failed to load config: vless without TLS or other encryption is prohibited unless the server address is a private IP or domain'
    const errors = parseXrayOutput(out, '/data/tmp/x.json')
    expect(errors[0]!.hint).toContain('encryption')
    expect(errors[0]!.hint).toContain('26.7.28')
  })

  it('запрет Trojan без TLS получает свою подсказку', () => {
    const out =
      'Failed to start: main: failed to load config: trojan without TLS is prohibited unless the server address is a private IP or domain'
    const errors = parseXrayOutput(out, '/data/tmp/x.json')
    expect(errors[0]!.hint).toContain('TLS')
    expect(errors[0]!.hint).toContain('Trojan')
  })
})

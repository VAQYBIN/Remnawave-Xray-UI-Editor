import { describe, expect, it } from 'vitest'
import { parseXrayOutput, versionOf } from '../src/xray/parseOutput.js'

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
})

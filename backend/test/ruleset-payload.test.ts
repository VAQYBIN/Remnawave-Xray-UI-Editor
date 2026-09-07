import { describe, expect, it } from 'vitest'
import { parsePayload } from '../src/ruleset/payload.js'
import { RuleSetError } from '../src/ruleset/errors.js'

describe('формат yaml', () => {
  it('берёт список из ключа payload', () => {
    const text = ['payload:', '  - "+.example.com"', '  - other.org', ''].join('\n')
    expect(parsePayload(text, 'yaml')).toEqual(['+.example.com', 'other.org'])
  })

  it('строки правил classical проходят как есть', () => {
    const text = ['payload:', '  - PROCESS-NAME,uTorrent.exe', '  - DOMAIN-SUFFIX,x.com', ''].join('\n')
    expect(parsePayload(text, 'yaml')).toEqual(['PROCESS-NAME,uTorrent.exe', 'DOMAIN-SUFFIX,x.com'])
  })

  it('пустой payload — пустой список, а не отказ', () => {
    expect(parsePayload('payload: []\n', 'yaml')).toEqual([])
  })

  it('без ключа payload — отказ, и он говорит именно про ключ', () => {
    // Проверяем ТЕКСТ, а не класс: соседняя ветка «не список» бросает тот же
    // класс, и на одном `toThrow(RuleSetError)` перепутанные ветки прошли бы
    expect(() => parsePayload('other: 1\n', 'yaml')).toThrow(RuleSetError)
    expect(() => parsePayload('other: 1\n', 'yaml')).toThrow(/нет ключа payload/)
  })

  it('payload не списком — отказ, и он говорит именно про список', () => {
    expect(() => parsePayload('payload: строка\n', 'yaml')).toThrow(/не список/)
  })

  it('битый YAML — RuleSetError, а не исключение библиотеки', () => {
    expect(() => parsePayload('payload:\n  - [a\n', 'yaml')).toThrow(RuleSetError)
    // Текст обязан быть наш и русский: сообщение библиотеки английское и про
    // синтаксис YAML, а пользователь читает его как состояние набора
    expect(() => parsePayload('payload:\n  - [a\n', 'yaml')).toThrow(/не разбирается как YAML/)
  })

  it('нестроковые записи пропускаются, а не превращаются в «null»', () => {
    const text = ['payload:', '  - ok.com', '  - 42', '  - [a, b]', ''].join('\n')
    expect(parsePayload(text, 'yaml')).toEqual(['ok.com'])
  })
})

describe('формат text', () => {
  it('строка на запись', () => {
    expect(parsePayload('a.com\nb.com\n', 'text')).toEqual(['a.com', 'b.com'])
  })

  it('комментарии и пустые строки отбрасываются', () => {
    const text = ['# заголовок', '', 'a.com  # хвостовой комментарий', '   ', 'b.com'].join('\n')
    expect(parsePayload(text, 'text')).toEqual(['a.com', 'b.com'])
  })
})

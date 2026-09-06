import { describe, expect, it } from 'vitest'
import { decodeYaml, decodeYamlOrNull, encodeYaml } from '../src/shared/lib/base64'

describe('base64 для YAML-шаблонов', () => {
  it('круг сохраняет текст', () => {
    const text = 'proxy-groups:\n  - name: 🌍 VPN\n    type: select\n'
    expect(decodeYaml(encodeYaml(text))).toBe(text)
  })

  it('кириллица и эмодзи не роняют кодирование', () => {
    // btoa на этом бросает InvalidCharacterError — и бросил бы при сохранении,
    // когда работа уже сделана
    expect(() => encodeYaml('name: Основная 🌍')).not.toThrow()
  })

  it('декодирование понимает то, что кодирует панель', () => {
    // base64 от "a: б" в utf-8
    expect(decodeYaml('YTog0LE=')).toBe('a: б')
  })

  // Отдельно от круга: круг зелен и при «кодировании» в UTF-16 самим собой.
  // Панель считает хэш по байтам, и лишний байт здесь — расхождение с ней
  it('кодирует ровно те байты, что даёт utf-8', () => {
    expect(encodeYaml('a: б')).toBe('YTog0LE=')
  })
})

describe('decodeYamlOrNull', () => {
  it('пустой шаблон панели — пустой документ, а не поломка', () => {
    expect(decodeYamlOrNull(null)).toBe('')
    // Поля может не прийти вовсе: панель нам его наличия не обещала
    expect(decodeYamlOrNull(undefined)).toBe('')
  })

  it('нечитаемое содержимое возвращает null, а не бросает', () => {
    // atob бросает InvalidCharacterError, а ErrorBoundary в приложении нет —
    // без этой ветки открытие шаблона давало бы белый экран
    expect(() => decodeYaml('не base64 ¡')).toThrow()
    expect(decodeYamlOrNull('не base64 ¡')).toBeNull()
  })

  it('нормальное содержимое отдаётся как обычно', () => {
    expect(decodeYamlOrNull(encodeYaml('a: б'))).toBe('a: б')
  })
})

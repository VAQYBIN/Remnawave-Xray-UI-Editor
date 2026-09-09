import { describe, expect, it } from 'vitest'
import {
  parseMihomo,
  rangeOf,
  sectionNode,
  YAML_SYNTAX_PREFIX,
} from '../src/entities/mihomo/parse'
import { mihomoFixture } from './helpers'

describe('разбор шаблона Mihomo', () => {
  it('читает секции всех трёх эталонных шаблонов', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      expect(md.issues, `${name}: неожиданные ошибки разбора`).toEqual([])
      expect(sectionNode(md, 'proxy-groups')).toBeDefined()
      expect(sectionNode(md, 'rules')).toBeDefined()
    }
  })

  it('диапазон узла указывает на текст значения, без хвостового комментария', () => {
    // Хвостовой комментарий — третий элемент тройки node.range (конец узла), а не второй
    // (конец значения). Правки в следующих задачах режут документ сплайсами по диапазону
    // значения: захват комментария означал бы порчу пользовательского файла.
    const md = parseMihomo('rules:\n  - MATCH,DIRECT # хвост\n')
    const item = md.doc.getIn(['rules', 0], true)
    const range = rangeOf(item)
    expect(range).not.toBeNull()
    const slice = md.text.slice(range!.from, range!.to)
    expect(slice).toBe('MATCH,DIRECT')
    expect(slice).not.toContain('хвост')
  })

  it('у синтаксической ошибки есть место, хотя пути нет', () => {
    // Путь у неё пуст и быть иным не может — документ на этом месте и не
    // разобрался. Раньше из ошибки брали только текст, и клик по ней в списке
    // проблем не вёл никуда: список навигирует по пути
    const text = 'mode: rule\ndns:\n  enable: [\nlog-level: info\n'
    const md = parseMihomo(text)
    const syntax = md.issues.filter((i) => i.message.startsWith(YAML_SYNTAX_PREFIX))
    expect(syntax.length).toBeGreaterThan(0)
    for (const issue of syntax) {
      expect(issue.parts).toEqual([])
      expect(issue.at).toBeDefined()
      // Не начало документа: именно это и было прежним поведением списка
      expect(issue.at!.from).toBeGreaterThan(0)
      expect(issue.at!.to).toBeLessThanOrEqual(text.length)
      expect(issue.at!.to).toBeGreaterThanOrEqual(issue.at!.from)
    }
  })

  it('смещения ошибки не выходят за текст: за концом их отвергает редактор', () => {
    // Библиотека ставит конец ошибки за последним символом на незакрытой
    // конструкции, а CodeMirror на диапазоне вне документа бросает
    const text = 'proxy-groups: ['
    const md = parseMihomo(text)
    const syntax = md.issues.filter((i) => i.at !== undefined)
    expect(syntax.length).toBeGreaterThan(0)
    for (const issue of syntax) {
      expect(issue.at!.to).toBeLessThanOrEqual(text.length)
    }
  })

  it('у смысловой проверки места нет: его ищет резолвер по пути', () => {
    // Поле не «на всякий случай»: оно ровно для тех диагностик, которым путь
    // назвать нечем. У остальных второе описание места разошлось бы с первым
    const md = parseMihomo('mode: rule\n')
    expect(md.issues).toEqual([])
  })

  it('синтаксическая ошибка становится диагностикой, а не исключением', () => {
    const md = parseMihomo('proxy-groups:\n  - name: a\n   type: select\n')
    expect(md.issues.length).toBeGreaterThan(0)
    expect(md.issues[0]!.level).toBe('error')
  })

  it('незакрытая структура не гасит уже разобранное', () => {
    const md = parseMihomo('rules:\n  - MATCH,DIRECT\nproxy-groups:\n  - name: "a\n')
    expect(sectionNode(md, 'rules')).toBeDefined()
  })

  it('json — снимок значений с развёрнутыми алиасами и слияниями; у пустого текста — {}', () => {
    const md = parseMihomo('x:\n  b: &b\n    k: 1\ny:\n  <<: *b\n  z: *b\n')
    expect(md.json).toEqual({ x: { b: { k: 1 } }, y: { k: 1, z: { k: 1 } } })
    expect(parseMihomo('').json).toEqual({})
  })
})

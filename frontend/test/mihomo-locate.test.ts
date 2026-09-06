import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { locateMihomo, pathAt } from '../src/entities/mihomo/locate'
import { searchMihomo } from '../src/entities/mihomo/search'
import {
  mihomoIssueCounts,
  mihomoNodeIdForPath,
} from '../src/entities/graph/mihomo/locate'
import { validateMihomo } from '../src/entities/mihomo/validate'
import { mihomoFixture } from './helpers'

const DOC = [
  'proxy-groups:',
  '  - name: Основная',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'proxy-providers:',
  '  main:',
  '    type: inline',
  'rules:',
  '  - MATCH,Основная',
  '',
].join('\n')

describe('адресация Mihomo', () => {
  it('путь ведёт к месту в тексте', () => {
    const md = parseMihomo(DOC)
    const range = locateMihomo(md, ['proxy-groups', 0, 'type'])
    expect(range).not.toBeNull()
    expect(DOC.slice(range!.from, range!.to)).toBe('select')
  })

  it('оборвавшийся путь отдаёт глубочайшего найденного предка', () => {
    const md = parseMihomo(DOC)
    const range = locateMihomo(md, ['proxy-groups', 0, 'нет-такого-ключа'])
    expect(DOC.slice(range!.from, range!.to)).toMatch(/^name: Основная/)
  })

  it('ненайденный первый сегмент — null, а не весь документ', () => {
    const md = parseMihomo(DOC)
    expect(locateMihomo(md, ['несуществующая-секция'])).toBeNull()
    expect(locateMihomo(md, [])).toBeNull()
  })

  it('смещение в тексте ведёт к пути', () => {
    const md = parseMihomo(DOC)
    expect(pathAt(md, DOC.indexOf('select'))).toEqual(['proxy-groups', 0, 'type'])
    expect(pathAt(md, DOC.indexOf('inline'))).toEqual(['proxy-providers', 'main', 'type'])
  })

  it('путь и смещение — обратные операции на всех трёх эталонных шаблонах', () => {
    for (const name of ['default', 'simple', 'bundle'] as const) {
      const md = parseMihomo(mihomoFixture(name))
      const range = locateMihomo(md, ['proxy-groups', 0, 'name'])
      if (range === null) continue
      expect(pathAt(md, range.from), name).toEqual(['proxy-groups', 0, 'name'])
    }
  })

  it('путь диагностики ведёт к узлу графа', () => {
    const md = parseMihomo(DOC)
    expect(mihomoNodeIdForPath(['proxy-groups', 0, 'type'], md)).toBe('group:Основная')
    expect(mihomoNodeIdForPath(['rules', 0], md)).toBe('rule:0')
    expect(mihomoNodeIdForPath(['proxy-providers', 'main'], md)).toBe('provider:main')
    expect(mihomoNodeIdForPath(['rule-providers', 'нет'], md)).toBeNull()
  })

  it('счётчики проблем садятся на узлы', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    type: select', 'rules:', '  - MATCH,Нет', ''].join('\n'),
    )
    const counts = mihomoIssueCounts(validateMihomo(md), md)
    expect(counts['rule:0']?.warnings).toBeGreaterThan(0)
  })

  it('поиск находит группы, правила и провайдеров и объясняет совпадение', () => {
    const md = parseMihomo(DOC)
    const hits = searchMihomo(md, 'основ')
    expect(hits.map((h) => h.nodeId)).toContain('group:Основная')
    expect(hits.find((h) => h.nodeId === 'group:Основная')?.matchedOn).toBe('имя')
    expect(searchMihomo(md, 'main').map((h) => h.nodeId)).toContain('provider:main')
    expect(searchMihomo(md, 'MATCH').map((h) => h.nodeId)).toContain('rule:0')
    expect(searchMihomo(md, '')).toEqual([])
  })
})

// Подсписок правил рисуется одной карточкой (`subrule:<имя>`), отдельных узлов
// у его правил нет — значит и диагностика внутри подсписка обязана вести на неё.
describe('подсписки правил в резолвере узлов', () => {
  const SUB = [
    'sub-rules:',
    '  block:',
    '    - MATCH,REJECT',
    'rules:',
    '  - SUB-RULE,(NETWORK,udp),block',
    '',
  ].join('\n')

  it('путь любой глубины внутри подсписка ведёт на его карточку', () => {
    const md = parseMihomo(SUB)
    expect(mihomoNodeIdForPath(['sub-rules', 'block'], md)).toBe('subrule:block')
    expect(mihomoNodeIdForPath(['sub-rules', 'block', 0], md)).toBe('subrule:block')
    expect(mihomoNodeIdForPath(['sub-rules', 'нет такого'], md)).toBeNull()
    // Уровень всей секции узла не имеет — то же решение, что у proxy-groups:
    // показать проблему на первом попавшемся подсписке значит соврать про место
    expect(mihomoNodeIdForPath(['sub-rules'], md)).toBeNull()
  })

  it('счётчик проблем садится на узел подсписка', () => {
    // validateMihomo пока не проверяет СОДЕРЖИМОЕ подсписков (единственная его
    // диагностика про них — висячая ссылка, и она лежит на правиле-источнике),
    // поэтому диагностику собираем руками: здесь проверяется резолвер, а не
    // набор проверок. Появится проверка внутри подсписка — значок уже сядет.
    const md = parseMihomo(SUB)
    const counts = mihomoIssueCounts(
      [
        {
          parts: ['sub-rules', 'block', 0],
          path: 'sub-rules.block[0]',
          message: 'проба',
          level: 'warning',
        },
      ],
      md,
    )
    expect(counts['subrule:block']).toEqual({ errors: 0, warnings: 1 })
  })
})

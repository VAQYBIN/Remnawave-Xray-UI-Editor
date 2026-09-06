import { describe, expect, it } from 'vitest'
import { hoverAt } from '../src/features/editor/mihomoIntellisense/hover'
import { renderHoverTooltip } from '../src/features/editor/hoverTooltipDom'

/** Позиция середины первого вхождения подстроки */
function inside(text: string, needle: string): number {
  const at = text.indexOf(needle)
  if (at < 0) throw new Error(`нет «${needle}» в тексте`)
  return at + Math.floor(needle.length / 2)
}

const DOC = [
  'dns:',
  '  enhanced-mode: fake-ip',
  '  что-то-своё: 1',
  'proxy-groups:',
  '  - name: A',
  '    interval: 300',
  '    remnawave:',
  '      include-proxies: false',
  'remnawave:',
  '  includeHiddenHosts: true',
  '',
].join('\n')

describe('наведение на YAML-вкладке', () => {
  it('известный ключ отдаёт описание из словаря', () => {
    const found = hoverAt(DOC, inside(DOC, 'enhanced-mode'))
    expect(found?.key).toBe('enhanced-mode')
    expect(found?.field.doc).toContain('Режим работы DNS')
    expect(DOC.slice(found!.from, found!.to)).toBe('enhanced-mode')
  })

  it('наведение на значение показывает описание его ключа', () => {
    const found = hoverAt(DOC, inside(DOC, 'fake-ip\n'))
    expect(found?.key).toBe('enhanced-mode')
    expect(DOC.slice(found!.from, found!.to)).toBe('fake-ip')
  })

  it('незнакомый ключ ничего не показывает', () => {
    expect(hoverAt(DOC, inside(DOC, 'что-то-своё'))).toBeNull()
  })

  it('ключ вложенной секции берёт описание из своей секции', () => {
    const found = hoverAt(DOC, inside(DOC, 'include-proxies'))
    expect(found?.field.doc).toContain('У ГРУППЫ')
  })

  it('одноимённый ключ в другой секции описан по-своему', () => {
    const group = hoverAt(DOC, inside(DOC, 'interval'))
    expect(group?.field.doc).toContain('проверки живости')
  })

  it('строка без ключа не даёт тултипа', () => {
    const text = 'rules:\n  - MATCH,DIRECT\n'
    expect(hoverAt(text, inside(text, 'MATCH'))).toBeNull()
  })

  it('разметка тултипа несёт ключ, описание и значения', () => {
    const found = hoverAt(DOC, inside(DOC, 'enhanced-mode'))
    const dom = renderHoverTooltip(found!.key, found!.field)
    expect(dom.querySelector('.cm-xray-hover-key')?.textContent).toContain('enhanced-mode')
    expect(dom.querySelector('.cm-xray-hover-doc')?.textContent).toContain('Режим работы DNS')
    expect([...dom.querySelectorAll('.cm-xray-hover-enum-row code')].map((n) => n.textContent)).toEqual(
      ['fake-ip', 'redir-host'],
    )
  })
})

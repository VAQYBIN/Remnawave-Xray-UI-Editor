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
  '  nameserver:',
  '    - 1.1.1.1',
  'proxies:',
  '  - name: сервер',
  '    port: 443',
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

  it('ключ записи proxies не описывается корнем', () => {
    // корневой `port` — «Порт HTTP-входа», и для порта сервера это враньё
    expect(hoverAt(DOC, inside(DOC, 'port: 443'))).toBeNull()
    expect(hoverAt(DOC, inside(DOC, 'name: сервер'))).toBeNull()
    // а тот же ключ `name` в группе описан
    expect(hoverAt(DOC, inside(DOC, 'name: A'))?.field.doc).toContain('Имя группы')
  })

  it('строка без ключа тултипа не даёт, соседняя с ключом — даёт', () => {
    expect(hoverAt(DOC, inside(DOC, '1.1.1.1'))).toBeNull()
    expect(hoverAt(DOC, inside(DOC, 'nameserver:'))?.field.doc).toContain('DNS-серверы')
  })

  it('список с нулевым отступом наводится так же, как с отступом', () => {
    // тот же документ, но дефисы стоят в колонке ключа — валидный и частый стиль
    const flat = [
      'proxy-groups:',
      '- name: A',
      '  interval: 300',
      'proxies:',
      '- name: сервер',
      '  port: 443',
      '',
    ].join('\n')
    expect(hoverAt(flat, inside(flat, 'name: A'))?.field.doc).toContain('Имя группы')
    expect(hoverAt(flat, inside(flat, 'interval'))?.field.doc).toContain('проверки живости')
    // и молчание там же, где при отступе: запись сервера словарь не описывает
    expect(hoverAt(flat, inside(flat, 'port: 443'))).toBeNull()
    expect(hoverAt(flat, inside(flat, 'name: сервер'))).toBeNull()
  })

  it('ключ строки с flow-значением описан, а внутренность скобок молчит', () => {
    // обе стороны на одной фикстуре: стиль массовый, и терять на нём описание
    // ключа нельзя, но внутри скобок стоят имена, которых словарь не знает
    const flow = [
      'dns:',
      '  nameserver: [1.1.1.1, 8.8.8.8]',
      'proxy-groups:',
      '  - name: A',
      '    proxies: [DIRECT]',
      '',
    ].join('\n')
    expect(hoverAt(flow, inside(flow, 'nameserver'))?.field.doc).toContain('DNS-серверы')
    expect(hoverAt(flow, inside(flow, 'proxies:'))?.field.doc).toContain('Участники')
    expect(hoverAt(flow, inside(flow, '1.1.1.1'))).toBeNull()
    expect(hoverAt(flow, inside(flow, '8.8.8.8'))).toBeNull()
    expect(hoverAt(flow, inside(flow, 'DIRECT'))).toBeNull()
  })

  it('внутри flow-отображения молчание сохраняется', () => {
    const flow = 'dns: {enhanced-mode: fake-ip}\n'
    expect(hoverAt(flow, inside(flow, 'enhanced-mode'))).toBeNull()
    expect(hoverAt(flow, inside(flow, 'fake-ip'))).toBeNull()
  })

  /**
   * Ключи-контейнеры молчали, и молчали хуже всего: `dns`, `rules`, `proxies` —
   * самые крупные слова документа, и читатель чужого шаблона упирался ровно в
   * них. Причина была не в незнании: `fieldFor` ищет ключ СРЕДИ ПОЛЕЙ секции, а
   * `dns` — имя самой секции, поля с таким именем в ней нет и быть не может.
   * Подсказка при наборе эти же ключи описывала — то есть редактор их знал и
   * забывал, стоило их написать.
   */
  it('ключи-контейнеры корня описаны', () => {
    const text = [
      'proxies:',
      '  - name: A',
      'proxy-groups: []',
      'rules:',
      '  - MATCH,DIRECT',
      'sub-rules:',
      '  ru:',
      '    - MATCH,DIRECT',
      'rule-providers: {}',
      'proxy-providers: {}',
      'dns:',
      '  enable: true',
      'tun:',
      '  enable: true',
      'sniffer:',
      '  enable: true',
      'profile:',
      '  store-selected: true',
      '',
    ].join('\n')
    for (const key of [
      'proxies:',
      'proxy-groups:',
      'rules:',
      'sub-rules:',
      'rule-providers:',
      'proxy-providers:',
      'dns:',
      'tun:',
      'sniffer:',
      'profile:',
    ]) {
      const found = hoverAt(text, inside(text, key))
      expect(found?.key, key).toBe(key.slice(0, -1))
      expect(found?.field.doc.length ?? 0, key).toBeGreaterThan(20)
    }
  })

  it('вложенный ключ секции описан по-своему, а не описанием контейнера', () => {
    // `dns` внутри группы — не секция DNS документа: одноимённый ключ на другом
    // уровне обязан либо описываться своим словарём, либо молчать
    const text = ['dns:', '  enable: true', 'proxy-groups:', '  - name: A', '    dns: 1', ''].join('\n')
    expect(hoverAt(text, inside(text, 'dns:\n'))?.field.doc).toContain('резолвер')
    expect(hoverAt(text, inside(text, 'dns: 1'))).toBeNull()
  })

  it('вложенное отображение составного ключа описано так же, как в подсказке', () => {
    const text = ['remnawave:', '  includeHiddenHosts: true', ''].join('\n')
    const found = hoverAt(text, inside(text, 'remnawave'))
    expect(found?.field.doc).toContain('includeHiddenHosts')
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

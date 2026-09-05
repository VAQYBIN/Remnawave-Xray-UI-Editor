import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadJson, exportFileName, parseImported } from '../src/features/editor/configFile'

const DATE = new Date('2026-07-25T12:00:00.000Z')

describe('exportFileName', () => {
  it('приводит имя к слагу и добавляет дату', () => {
    expect(exportFileName('Germany DE', DATE)).toBe('germany-de-2026-07-25.json')
  })

  it('кириллица сохраняется, служебные символы схлопываются', () => {
    expect(exportFileName('Германия / основной', DATE)).toBe('германия-основной-2026-07-25.json')
  })

  it('имя без пригодных символов вырождается в config', () => {
    expect(exportFileName('!!!', DATE)).toBe('config-2026-07-25.json')
  })
})

describe('parseImported', () => {
  it('объект конфига переформатируется в два пробела', () => {
    const result = parseImported('{"inbounds":[]}')
    expect(result).toEqual({ text: '{\n  "inbounds": []\n}' })
  })

  it('файл бэкапа с profile.config разворачивается', () => {
    const raw = JSON.stringify({ savedAt: 'x', profile: { name: 'p', config: { inbounds: [] } } })
    expect(parseImported(raw)).toEqual({ text: '{\n  "inbounds": []\n}' })
  })

  it('обёртка {config} тоже разворачивается', () => {
    expect(parseImported('{"config":{"inbounds":[]}}')).toEqual({ text: '{\n  "inbounds": []\n}' })
  })

  it('файл бэкапа шаблона с template.templateJson разворачивается', () => {
    const raw = JSON.stringify({
      savedAt: 'x',
      template: {
        uuid: 'u1',
        name: 'Xray Default',
        templateType: 'XRAY_JSON',
        templateJson: { inbounds: [] },
        encodedTemplateYaml: null,
      },
    })
    expect(parseImported(raw)).toEqual({ text: '{\n  "inbounds": []\n}' })
  })

  it('бэкап YAML-шаблона отвергается с объяснением, а не кладёт обёртку в черновик', () => {
    const raw = JSON.stringify({
      savedAt: 'x',
      template: {
        uuid: 'u1',
        name: 'Mihomo',
        templateType: 'MIHOMO',
        templateJson: null,
        encodedTemplateYaml: 'cHJveGllczoge30=',
      },
    })
    const result = parseImported(raw)
    expect('error' in result && result.error).toMatch(/не в templateJson/)
  })

  it('посторонний объект под ключом template обёрткой не считается', () => {
    // Отличие от бэкапа — отсутствие templateType внутри: без этого признака
    // отказ выше съел бы обычный конфиг со своим ключом `template`
    const raw = JSON.stringify({ inbounds: [], template: { foo: 1 } })
    expect(parseImported(raw)).toEqual({
      text: '{\n  "inbounds": [],\n  "template": {\n    "foo": 1\n  }\n}',
    })
  })

  it('строка под ключом template обёрткой не считается', () => {
    const raw = JSON.stringify({ inbounds: [], template: 'что-то своё' })
    expect(parseImported(raw)).toEqual({
      text: '{\n  "inbounds": [],\n  "template": "что-то своё"\n}',
    })
  })

  it('не JSON — понятная ошибка', () => {
    const result = parseImported('не json')
    expect('error' in result && result.error).toMatch(/не разбирается как JSON/)
  })

  it('массив вместо объекта — отказ', () => {
    const result = parseImported('[1,2]')
    expect('error' in result && result.error).toMatch(/массив/)
  })

  it('строка вместо объекта — отказ', () => {
    const result = parseImported('"hello"')
    expect('error' in result && result.error).toMatch(/строка/)
  })
})

describe('downloadJson', () => {
  const createObjectURL = vi.fn(() => 'blob:x')
  const revokeObjectURL = vi.fn()

  // jsdom этих методов не реализует: присваиваем их напрямую, а не подменяем весь
  // класс URL через stubGlobal — иначе сломается конструктор `new URL()`
  beforeEach(() => {
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
  })
  afterEach(() => vi.clearAllMocks())

  it('создаёт ссылку с именем файла и освобождает URL', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadJson('{"a":1}', 'cfg.json')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })
})

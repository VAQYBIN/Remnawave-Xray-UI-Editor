import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VersionsDialog } from '../src/features/editor/VersionsDialog'
import { encodeYaml } from '../src/shared/lib/base64'

const docUuid = 'u1'

const backups = [
  { file: 'a.json', savedAt: '2026-07-20T10:00:00.000Z', profileName: 'Germany' },
  { file: 'b.json', savedAt: '2026-07-19T10:00:00.000Z', profileName: 'Germany' },
]

const fileData = {
  savedAt: '2026-07-20T10:00:00.000Z',
  profile: {
    uuid: docUuid,
    viewPosition: 0,
    name: 'Germany',
    config: { inbounds: [] },
    inbounds: [],
    nodes: [],
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
  },
}

const MIHOMO_YAML = 'proxy-groups:\n  - name: Основная\n    type: select\n'

/**
 * Бэкап шаблона Mihomo: содержимое — base64 YAML в encodedTemplateYaml, а
 * templateJson у него `null`. Ровно то, что бэкенд кладёт в файл.
 */
const mihomoFileData = {
  savedAt: '2026-07-20T10:00:00.000Z',
  template: {
    uuid: docUuid,
    viewPosition: 0,
    name: 'Mihomo',
    templateType: 'MIHOMO',
    templateJson: null,
    encodedTemplateYaml: encodeYaml(MIHOMO_YAML),
  },
}

// Бэкап шаблона: содержимое лежит в template.templateJson, а не в profile.config
const templateFileData = {
  savedAt: '2026-07-20T10:00:00.000Z',
  template: {
    uuid: docUuid,
    viewPosition: 0,
    name: 'Xray Default',
    templateType: 'XRAY_JSON',
    templateJson: { outbounds: [{ tag: 'direct', protocol: 'freedom' }] },
    encodedTemplateYaml: null,
  },
}

function stubFetch(list: unknown[] = backups, data: unknown = fileData) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/backups')) {
        return new Response(JSON.stringify({ backups: list }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/backups/')) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

function renderDialog(
  props: Partial<{
    kind: 'profiles' | 'templates'
    format: 'json' | 'yaml'
    currentText: string
    onRestore: (t: string) => void
    onClose: () => void
  }> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onRestore = props.onRestore ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  const utils = render(
    <QueryClientProvider client={qc}>
      <VersionsDialog
        open
        kind={props.kind ?? 'profiles'}
        // Проп подаётся ТОЛЬКО когда его просили: иначе умолчание `json`, от
        // которого зависит весь путь Xray, не исполнялось бы ни одним тестом
        {...(props.format === undefined ? {} : { format: props.format })}
        docUuid={docUuid}
        docName="Germany"
        currentText={props.currentText ?? '{\n  "inbounds": []\n}'}
        onRestore={onRestore}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onRestore, onClose }
}

afterEach(() => vi.unstubAllGlobals())

/**
 * Перехват выгрузки целиком: тип Blob и имя файла — единственное, что человек
 * получает на диск. Подпись кнопки о них не говорит НИЧЕГО: «Скачать YAML» над
 * вызовом downloadJson выглядит правильно и отдаёт .json с типом
 * application/json. Поэтому утверждаем то и другое, а не надпись.
 */
function spyDownload() {
  const blobs: Blob[] = []
  const names: string[] = []
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob)
    return 'blob:x'
  }) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  return { blobs, names, restore: () => click.mockRestore() }
}

describe('VersionsDialog', () => {
  it('вкладка бэкапов открыта первой и показывает записи', async () => {
    stubFetch()
    renderDialog()
    expect(await screen.findAllByText('Germany')).toHaveLength(2)
    expect(await screen.findAllByRole('button', { name: 'В черновик' })).toHaveLength(2)
  })

  it('пустой список — текст «Бэкапов пока нет.»', async () => {
    stubFetch([])
    renderDialog()
    expect(await screen.findByText('Бэкапов пока нет.')).toBeInTheDocument()
  })

  it('«В черновик» отдаёт конфиг бэкапа и закрывает диалог', async () => {
    stubFetch()
    const user = userEvent.setup()
    const { onRestore, onClose } = renderDialog()
    const buttons = await screen.findAllByRole('button', { name: 'В черновик' })
    await user.click(buttons[0]!)
    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith(JSON.stringify(fileData.profile.config, null, 2)),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('«Сравнить» переводит диалог в режим сравнения с кнопкой возврата', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderDialog()
    const buttons = await screen.findAllByRole('button', { name: 'Сравнить' })
    await user.click(buttons[0]!)
    expect(await screen.findByRole('button', { name: '← К списку' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сравнить' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '← К списку' }))
    expect(await screen.findAllByRole('button', { name: 'Сравнить' })).toHaveLength(2)
  })

  it('вкладка «Файл»: скачивание отдаёт текущий текст файлом .json', async () => {
    stubFetch()
    // Присваиваем методы напрямую: stubGlobal('URL', …) снёс бы конструктор new URL()
    const dl = spyDownload()
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    await user.click(screen.getByRole('button', { name: /Скачать JSON/ }))
    expect(dl.blobs).toHaveLength(1)
    expect(dl.blobs[0]!.type).toBe('application/json')
    expect(dl.names[0]).toMatch(/\.json$/)
    dl.restore()
  })

  it('вкладка «Файл»: корректный файл уходит в черновик', async () => {
    stubFetch()
    const user = userEvent.setup()
    const { onRestore } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    const file = new File(['{"outbounds":[]}'], 'cfg.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Файл конфига'), file)
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith('{\n  "outbounds": []\n}'))
  })

  // Шаблонная ветка: и путь запроса, и поле с содержимым у шаблона свои
  it('kind=templates ходит в /api/templates и берёт содержимое из template.templateJson', async () => {
    stubFetch(backups, templateFileData)
    const user = userEvent.setup()
    const { onRestore } = renderDialog({ kind: 'templates' })
    const buttons = await screen.findAllByRole('button', { name: 'В черновик' })
    await user.click(buttons[0]!)
    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith(
        JSON.stringify(templateFileData.template.templateJson, null, 2),
      ),
    )
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    )
    expect(urls).toContain(`/api/templates/${docUuid}/backups`)
    expect(urls).toContain(`/api/templates/${docUuid}/backups/a.json`)
  })

  /**
   * Самая дорогая ошибка этой ветки, если её не поймать: у шаблона Mihomo
   * templateJson === null, и «В черновик» подменяло бы ВЕСЬ YAML-документ
   * строкой «null». Бэкап при этом цел — данные просто берутся из другого поля.
   */
  it('format=yaml берёт документ из encodedTemplateYaml, а не печатает templateJson', async () => {
    stubFetch(backups, mihomoFileData)
    const user = userEvent.setup()
    const { onRestore } = renderDialog({ kind: 'templates', format: 'yaml' })
    const buttons = await screen.findAllByRole('button', { name: 'В черновик' })
    await user.click(buttons[0]!)
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(MIHOMO_YAML))
    // Строка «null» — ровно то, что уходило бы в черновик из templateJson
    expect(onRestore).not.toHaveBeenCalledWith('null')
  })

  it('format=yaml: нечитаемое содержимое бэкапа объясняется, а не молча портит черновик', async () => {
    stubFetch(backups, {
      ...mihomoFileData,
      template: { ...mihomoFileData.template, encodedTemplateYaml: 'не base64 ¡' },
    })
    const user = userEvent.setup()
    const { onRestore } = renderDialog({ kind: 'templates', format: 'yaml' })
    const buttons = await screen.findAllByRole('button', { name: 'В черновик' })
    await user.click(buttons[0]!)
    expect(await screen.findByText(/не base64/)).toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('format=yaml: на диск уходит YAML — и по типу, и по расширению', async () => {
    stubFetch(backups, mihomoFileData)
    const dl = spyDownload()
    const user = userEvent.setup()
    renderDialog({ kind: 'templates', format: 'yaml', currentText: MIHOMO_YAML })
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    // Подпись кнопки — то, что человек видит ДО выгрузки; тип и расширение —
    // то, что он получает. Утверждаем и то, и другое: подпись при вызове
    // downloadJson осталась бы правильной, а файл ушёл бы чужим
    expect(screen.getByRole('button', { name: /Скачать YAML/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Скачать JSON/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Скачать YAML/ }))
    expect(dl.blobs).toHaveLength(1)
    expect(dl.blobs[0]!.type).toBe('application/yaml')
    expect(await dl.blobs[0]!.text()).toBe(MIHOMO_YAML)
    expect(dl.names[0]).toMatch(/\.yaml$/)
    dl.restore()
  })

  it('format=yaml: загрузка принимает сам документ', async () => {
    stubFetch(backups, mihomoFileData)
    const user = userEvent.setup()
    const { onRestore } = renderDialog({ kind: 'templates', format: 'yaml' })
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    const file = new File([MIHOMO_YAML], 'tpl.yaml', { type: 'application/yaml' })
    await user.upload(screen.getByLabelText('Файл конфига'), file)
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(MIHOMO_YAML))
  })

  /**
   * Умолчание `format = 'json'` — то, на чём стоит весь путь Xray, и подаётся
   * оно ровно нигде: и хелпер выше, и EditorShell всегда передают проп явно.
   * Переворот умолчания на 'yaml' иначе прошёл бы незамеченным.
   */
  it('без пропа format диалог ведёт себя как json-документ', async () => {
    stubFetch(backups, templateFileData)
    const user = userEvent.setup()
    const { onRestore } = renderDialog({ kind: 'templates' })
    const buttons = await screen.findAllByRole('button', { name: 'В черновик' })
    await user.click(buttons[0]!)
    // Содержимое взято из templateJson и напечатано JSON'ом
    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith(
        JSON.stringify(templateFileData.template.templateJson, null, 2),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    expect(screen.getByRole('button', { name: /Скачать JSON/ })).toBeInTheDocument()
  })

  it('вкладка «Файл»: битый файл показывает ошибку и не трогает черновик', async () => {
    stubFetch()
    const user = userEvent.setup()
    const { onRestore } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    const file = new File(['не json'], 'cfg.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Файл конфига'), file)
    expect(await screen.findByText(/не разбирается как JSON/)).toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VersionsDialog } from '../src/features/editor/VersionsDialog'

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

function stubFetch(list: unknown[] = backups) {
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
        return new Response(JSON.stringify(fileData), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

function renderDialog(props: Partial<{ onRestore: (t: string) => void; onClose: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onRestore = props.onRestore ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  const utils = render(
    <QueryClientProvider client={qc}>
      <VersionsDialog
        open
        kind="profiles"
        docUuid={docUuid}
        docName="Germany"
        currentText={'{\n  "inbounds": []\n}'}
        onRestore={onRestore}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onRestore, onClose }
}

afterEach(() => vi.unstubAllGlobals())

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

  it('вкладка «Файл»: скачивание отдаёт текущий текст', async () => {
    stubFetch()
    const createObjectURL = vi.fn(() => 'blob:x')
    // Присваиваем методы напрямую: stubGlobal('URL', …) снёс бы конструктор new URL()
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Файл' }))
    await user.click(screen.getByRole('button', { name: /Скачать JSON/ }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    click.mockRestore()
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

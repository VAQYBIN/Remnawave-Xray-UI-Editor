import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BackupsDialog } from '../src/features/editor/BackupsDialog'

const profileUuid = 'u1'

const backups = [
  { file: 'a.json', savedAt: '2026-07-20T10:00:00.000Z', profileName: 'Germany' },
  { file: 'b.json', savedAt: '2026-07-19T10:00:00.000Z', profileName: 'Germany' },
]

const fileData = {
  savedAt: '2026-07-20T10:00:00.000Z',
  profile: {
    uuid: profileUuid,
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

function renderDialog(props: Partial<{ open: boolean; onRestore: (t: string) => void; onClose: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onRestore = props.onRestore ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  const utils = render(
    <QueryClientProvider client={qc}>
      <BackupsDialog
        open={props.open ?? true}
        profileUuid={profileUuid}
        onRestore={onRestore}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onRestore, onClose }
}

afterEach(() => vi.unstubAllGlobals())

describe('BackupsDialog', () => {
  it('open=true — грузит список бэкапов и показывает имя профиля и обе записи', async () => {
    stubFetch()
    renderDialog({ open: true })

    expect(await screen.findAllByText('Germany')).toHaveLength(2)
    expect(await screen.findAllByRole('button', { name: 'В черновик' })).toHaveLength(2)
  })

  it('пустой список — текст «Бэкапов пока нет.»', async () => {
    stubFetch([])
    renderDialog({ open: true })

    expect(await screen.findByText('Бэкапов пока нет.')).toBeInTheDocument()
  })

  it('клик «В черновик» — грузит файл бэкапа, вызывает onRestore с конфигом и закрывает диалог', async () => {
    stubFetch()
    const user = userEvent.setup()
    const { onRestore, onClose } = renderDialog({ open: true })

    const buttons = await screen.findAllByRole('button', { name: 'В черновик' })
    await user.click(buttons[0]!)

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(JSON.stringify(fileData.profile.config, null, 2)))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

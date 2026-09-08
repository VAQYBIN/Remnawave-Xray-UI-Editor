import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SingboxCheckDialog } from '../src/features/diagnostics/SingboxCheckDialog'

const JSON_TEXT = JSON.stringify({ outbounds: [{ type: 'direct', tag: 'direct' }] })
let bodies: string[] = []

function mockCheck(status: number, body: unknown) {
  bodies = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderDialog(text = JSON_TEXT, open = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <SingboxCheckDialog open={open} text={text} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('отчёт проверки ядром sing-box', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('нет бинаря — сказано, что о шаблоне не сказано ничего', async () => {
    mockCheck(200, { available: false, ok: false, errors: [] })
    renderDialog()
    expect(await screen.findByText(/Проверка ядром недоступна/)).toBeInTheDocument()
    expect(screen.getByText(/SINGBOX_BIN/)).toBeInTheDocument()
    expect(screen.queryByText(/ядро отклонило/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Ядро приняло шаблон/)).not.toBeInTheDocument()
  })

  it('успех несёт оговорку про подменённые серверы', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog()
    expect(await screen.findByText(/Ядро приняло шаблон/)).toBeInTheDocument()
    expect(screen.getByText(/фиктивн/i)).toBeInTheDocument()
    expect(screen.getByText(/remnawave/)).toBeInTheDocument()
    expect(screen.queryByText(/Ядро отклонило шаблон/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Проверка ядром недоступна/)).not.toBeInTheDocument()
  })

  it('отказ несёт ТУ ЖЕ оговорку: там она нужнее', async () => {
    mockCheck(200, {
      available: true,
      ok: false,
      errors: ['outbound[3]: unknown tag "proxy-1"'],
    })
    renderDialog()
    expect(await screen.findByText('outbound[3]: unknown tag "proxy-1"')).toBeInTheDocument()
    expect(screen.getByText(/Ядро отклонило шаблон/)).toBeInTheDocument()
    // Ядро могло назвать имя или позицию, которых в файле пользователя нет,
    // и без оговорки он пойдёт искать у себя то, чего не писал
    expect(screen.getByText(/фиктивн/i)).toBeInTheDocument()
    expect(screen.getByText(/remnawave/)).toBeInTheDocument()
    expect(screen.queryByText(/Ядро приняло шаблон/)).not.toBeInTheDocument()
  })

  it('при отсутствующем бинаре оговорки нет: ядро не запускалось', async () => {
    mockCheck(200, { available: false, ok: false, errors: [] })
    renderDialog()
    await screen.findByText(/Проверка ядром недоступна/)
    expect(screen.queryByText(/фиктивн/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/remnawave/)).not.toBeInTheDocument()
  })

  it('неразбираемый черновик объясняется до запроса, а не 400-м с сервера', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog('{ outbounds: [')
    expect(await screen.findByText(/не разбирается как JSON/)).toBeInTheDocument()
    // Кнопку жмут именно тогда, когда с документом что-то не так — до сервера
    // дело дойти не должно
    expect(bodies).toHaveLength(0)
  })

  it('проверка запускается на ОТКРЫТИЕ, а не на монтирование', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog(JSON_TEXT, false)
    // Мутация react-query стартует не синхронно: проверка сразу после render
    // прошла бы и со сломанным гейтом — сначала даём очереди опустеть
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(bodies).toHaveLength(0)
    expect(screen.queryByText(/Ядро приняло шаблон/)).not.toBeInTheDocument()
  })
})

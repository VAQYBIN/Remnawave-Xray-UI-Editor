import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MihomoCheckDialog } from '../src/features/diagnostics/MihomoCheckDialog'
import { encodeYaml } from '../src/shared/lib/base64'

const YAML = 'rules:\n  - MATCH,DIRECT\n'
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

function renderDialog(text = YAML, open = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MihomoCheckDialog open={open} text={text} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('отчёт проверки ядром Mihomo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('нет бинаря — инструмент недоступен, а не шаблон плохой', async () => {
    mockCheck(200, { available: false, ok: false, errors: [] })
    renderDialog()
    expect(await screen.findByText(/Проверка ядром недоступна/)).toBeInTheDocument()
    expect(screen.getByText(/MIHOMO_BIN/)).toBeInTheDocument()
    expect(screen.queryByText(/ядро отклонило/i)).not.toBeInTheDocument()
    // Третье состояние обязано отличаться и от успеха: «недоступно» — не «принято»
    expect(screen.queryByText(/Ядро приняло шаблон/)).not.toBeInTheDocument()
  })

  it('успех сопровождается оговоркой про фиктивные серверы', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog()
    expect(await screen.findByText(/Ядро приняло шаблон/)).toBeInTheDocument()
    // Требование спеки: в отчёте прямо сказано, ЧТО именно проверено
    expect(screen.getByText(/фиктивн/i)).toBeInTheDocument()
    expect(screen.queryByText(/Ядро отклонило шаблон/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Проверка ядром недоступна/)).not.toBeInTheDocument()
  })

  it('ошибки ядра показаны построчно', async () => {
    mockCheck(200, {
      available: true,
      ok: false,
      errors: ['proxy 0: unsupported type', 'rules[2]: invalid rule'],
    })
    renderDialog()
    expect(await screen.findByText('proxy 0: unsupported type')).toBeInTheDocument()
    expect(screen.getByText('rules[2]: invalid rule')).toBeInTheDocument()
    // Отказ обязан читаться отказом, а не успехом с приложенным списком
    expect(screen.getByText(/Ядро отклонило шаблон/)).toBeInTheDocument()
    expect(screen.queryByText(/Ядро приняло шаблон/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Проверка ядром недоступна/)).not.toBeInTheDocument()
  })

  it('невалидный YAML показывает русский текст бэкенда, а не «неизвестная ошибка»', async () => {
    mockCheck(400, { message: 'Не удалось разобрать шаблон как YAML' })
    renderDialog('proxy-groups: [')
    expect(await screen.findByText('Не удалось разобрать шаблон как YAML')).toBeInTheDocument()
  })

  it('шаблон уходит на проверку в base64', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog()
    await screen.findByText(/Ядро приняло шаблон/)
    expect(JSON.parse(bodies[0]!).encodedTemplateYaml).toBe(encodeYaml(YAML))
  })

  // Диалог смонтирован всегда, а ядро запускает процесс: пока его не открыли,
  // запроса быть не должно
  it('закрытый диалог ядро не дергает', async () => {
    mockCheck(200, { available: true, ok: true, errors: [] })
    renderDialog(YAML, false)
    // Мутация react-query стартует не синхронно: проверка сразу после render
    // прошла бы и со сломанным гейтом — сначала даём очереди опустеть
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(bodies).toHaveLength(0)
    expect(screen.queryByText(/Ядро приняло шаблон/)).not.toBeInTheDocument()
  })
})

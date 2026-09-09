import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from '../src/features/templates/TemplateEditorPage'
import { EDITABLE } from '../src/features/templates/TemplatesPage'
import { CreateTemplateDialog } from '../src/features/templates/CreateTemplateDialog'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'
import { optionLabels, selectOption } from './helpers'

/** Документ панели: разбирается и ошибок не даёт — см. singbox-draft.test.tsx */
const PANEL = {
  outbounds: [
    { type: 'selector', tag: 'выбор', outbounds: null },
    { type: 'direct', tag: 'direct' },
  ],
  route: { rules: [{ domain: 'a.com', outbound: 'direct' }] },
}

/** Тот же документ с правкой: черновик обязан отличаться от версии панели */
const EDITED = {
  ...PANEL,
  route: { rules: [{ domain: 'b.com', outbound: 'direct' }] },
}

/**
 * Документ с ОШИБКОЙ и без синтаксической поломки: две группы ссылаются друг на
 * друга. Битый JSON здесь не годится — он проверял бы блокировку по разбору, а
 * речь именно про смысловую ошибку, которую панель не починит.
 */
const RING = JSON.stringify(
  {
    outbounds: [
      { type: 'selector', tag: 'a', outbounds: ['b'] },
      { type: 'selector', tag: 'b', outbounds: ['a'] },
    ],
  },
  null,
  2,
)

const HASH = 'h'.repeat(64)
/** Хэш версии панели: приходит в теле 409 */
const PANEL_HASH = 'x'.repeat(64)

function template(over: Record<string, unknown> = {}) {
  return {
    uuid: 'u-1',
    viewPosition: 0,
    name: 'Мой Sing-box',
    templateType: 'SINGBOX',
    templateJson: PANEL,
    encodedTemplateYaml: null,
    ...over,
  }
}

let calls: { url: string; init?: RequestInit }[] = []

type Reply = { status: number; body: unknown }

/** Ответы: один на все запросы этого адреса либо очередь (последний залипает) */
function mockApi(responses: Record<string, Reply | Reply[]>) {
  calls = []
  const queues = new Map<string, Reply[]>()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`
      const planned = responses[key]
      let res: Reply = { status: 200, body: {} }
      if (Array.isArray(planned)) {
        const queue = queues.get(key) ?? [...planned]
        queues.set(key, queue)
        res = queue.length > 1 ? queue.shift()! : queue[0]!
      } else if (planned !== undefined) {
        res = planned
      }
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/templates/u-1']}>
        <Routes>
          <Route path="/templates/:uuid" element={<TemplateEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function patchBodies(): Record<string, unknown>[] {
  return calls
    .filter((c) => c.init?.method === 'PATCH')
    .map((c) => JSON.parse(String(c.init?.body ?? '{}')) as Record<string, unknown>)
}

function patchBody(): Record<string, unknown> {
  return patchBodies()[0] ?? {}
}

describe('страница шаблона sing-box', () => {
  beforeEach(() => {
    localStorage.clear()
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
    })
  })
  // stubGlobal снимает только unstubAllGlobals: restoreAllMocks оставил бы
  // подменённый fetch жить между файлами
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('шаблон SINGBOX открывается в редакторе, а не ведёт в панель', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Мой Sing-box' })).toBeInTheDocument()
    expect(screen.queryByText(/Откройте его в панели/)).not.toBeInTheDocument()
    // «Конфиг валиден» здесь соврало бы: документ — клиентская подписка, а не
    // конфиг ядра ноды
    expect(screen.getByText('Документ разбирается, замечаний нет')).toBeInTheDocument()
    expect(screen.queryByText('Конфиг валиден')).not.toBeInTheDocument()
  })

  // docFormat у документа один — 'singbox-json', и подпись вкладки обязана
  // остаться JSON: это диалект JSON, а не третий формат
  it('текстовая вкладка подписана JSON', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Sing-box' })
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'YAML' })).not.toBeInTheDocument()
  })

  // Содержимое приходит ровно одним полем: YAML-поле на JSON-шаблоне бэкенд
  // отвергает четырёхсотым, и слать оба значило бы спрятать эту защиту
  it('сохранение шлёт templateJson и expectedHash', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'PATCH /api/templates/u-1': {
        status: 200,
        body: { template: template(), hash: 'n'.repeat(64) },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Sing-box' })
    useDraftStore.getState().setDraft('template:u-1', JSON.stringify(EDITED, null, 2), HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Сохранить( всё равно)?$/ }))
    await waitFor(() => expect(patchBody().expectedHash).toBe(HASH))
    expect(patchBody().templateJson).toEqual(EDITED)
    expect(patchBody().encodedTemplateYaml).toBeUndefined()
  })

  it('конфликт по хэшу предлагает выбор, а не решает сам', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'PATCH /api/templates/u-1': [
        {
          status: 409,
          body: { message: 'конфликт', current: template(), hash: PANEL_HASH },
        },
        { status: 200, body: { template: template(), hash: 'n'.repeat(64) } },
      ],
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Sing-box' })
    useDraftStore.getState().setDraft('template:u-1', JSON.stringify(EDITED, null, 2), HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Сохранить( всё равно)?$/ }))
    expect(await screen.findByText('Конфликт версий')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Загрузить версию панели' })).toBeInTheDocument()

    // «Перезаписать» уходит с хэшем ПАНЕЛИ: повтори он базу черновика —
    // конфликт не разрешился бы уже никогда
    await userEvent.click(screen.getByRole('button', { name: 'Перезаписать' }))
    await waitFor(() => expect(patchBodies()).toHaveLength(2))
    expect(patchBodies()[0]!.expectedHash).toBe(HASH)
    expect(patchBodies()[1]!.expectedHash).toBe(PANEL_HASH)
  })

  // Все ошибки sing-box — дефекты, которые панель не починит, и сохранять их
  // значит отдать клиенту заведомо сломанную подписку
  it('сохранение заблокировано, пока в документе есть ошибки', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Sing-box' })
    useDraftStore.getState().setDraft('template:u-1', JSON.stringify(EDITED, null, 2), HASH)
    // Без этой половины проверка зеленела бы и на кнопке, запертой всегда
    expect(await screen.findByRole('button', { name: 'Сохранить в панель' })).toBeEnabled()

    useDraftStore.getState().setDraft('template:u-1', RING, HASH)
    expect(await screen.findByText(/ошибок: 1/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить в панель' })).toBeDisabled(),
    )
  })

  /**
   * Диалог версий монтирует хром, и формат документа доходит до него пропом.
   * Без этой проверки `docFormat` можно было бы не передать вовсе: разбор
   * файла покрыт своим тестом (singbox-config-file), но тот зовёт функцию
   * напрямую и разрыв проводки не ловит — конфиг Xray молча стал бы черновиком.
   */
  it('загрузка файла разбирается как sing-box, а не как Xray', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Sing-box' })
    await userEvent.click(screen.getByRole('button', { name: 'Версии' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Файл' }))
    // Подпись вкладки и тип файла у диалекта те же, что у JSON
    expect(screen.getByRole('button', { name: /Скачать JSON/ })).toBeInTheDocument()
    const xray = new File(
      [JSON.stringify({ inbounds: [], outbounds: [], routing: { rules: [] } })],
      'xray.json',
      { type: 'application/json' },
    )
    await userEvent.upload(screen.getByLabelText('Файл конфига'), xray)
    expect(await screen.findByText(/Похоже на конфиг Xray/)).toBeInTheDocument()
    // Черновик остался нетронутым: отвергнутый файл в документ не попал
    expect(useDraftStore.getState().drafts['template:u-1']).toBeUndefined()
  })

  // Рецепты правят черновик через тот же writeDraft, что и импорт: план
  // применяется к разобранной модели, а не к панели напрямую
  it('кнопка «Рецепты» открывает диалог, а применённый рецепт меняет черновик', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Sing-box' })
    await userEvent.click(screen.getByRole('button', { name: 'Рецепты' }))
    expect(await screen.findByRole('heading', { name: 'Рецепты' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Локальный вход/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']?.text).toContain('mixed-in'),
    )
  })

  it('в список редактируемых типов добавлен SINGBOX', () => {
    expect([...EDITABLE]).toContain('SINGBOX')
  })

  // Прежний onChange сводил всё, что не MIHOMO, к XRAY_JSON тернарником — с
  // третьим типом это молча ломается
  it('диалог создания предлагает три типа и не сводит третий ко второму', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        }
        return new Response(JSON.stringify({ template: { uuid: 'new-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/templates']}>
          <CreateTemplateDialog open onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await optionLabels('Тип шаблона')).toEqual([
      'Xray (JSON)',
      'Mihomo (YAML)',
      'Sing-box (JSON)',
    ])
    await userEvent.type(screen.getByLabelText('Имя шаблона'), 'My Singbox')
    await selectOption('Тип шаблона', 'SINGBOX')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ name: 'My Singbox', templateType: 'SINGBOX' })
  })
})

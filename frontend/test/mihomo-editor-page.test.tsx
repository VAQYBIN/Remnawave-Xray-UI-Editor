import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from '../src/features/templates/TemplateEditorPage'
import { encodeYaml } from '../src/shared/lib/base64'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'

const YAML = [
  'proxy-groups:',
  '  - name: Основная',
  '    type: select',
  '    proxies: # LEAVE THIS LINE!',
  'rules:',
  '  - MATCH,Основная',
  '',
].join('\n')

const HASH = 'h'.repeat(64)

function template(over: Record<string, unknown> = {}) {
  return {
    uuid: 'u-1',
    viewPosition: 0,
    name: 'Мой Mihomo',
    templateType: 'MIHOMO',
    templateJson: null,
    encodedTemplateYaml: encodeYaml(YAML),
    ...over,
  }
}

/** Записанные запросы: тело PATCH — главное, что проверяют тесты ниже */
let calls: { url: string; init?: RequestInit }[] = []

function mockApi(responses: Record<string, { status: number; body: unknown }>) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`
      // Диалог geo-баз монтируется вместе с оболочкой и на пустом ответе падает
      // внутри useEffect — умолчание обязано быть формы GeoStatus
      const fallback = url.includes('/api/geo')
        ? { geosite: { url: '', present: false }, geoip: { url: '', present: false } }
        : {}
      const res = responses[key] ?? { status: 200, body: fallback }
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

function patchBody(): Record<string, unknown> {
  const call = calls.find((c) => c.init?.method === 'PATCH')
  return JSON.parse(String(call?.init?.body ?? '{}')) as Record<string, unknown>
}

describe('страница редактора Mihomo', () => {
  beforeEach(() => {
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

  it('шаблон MIHOMO открывается в редакторе, а не отправляет в панель', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Мой Mihomo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument()
    expect(screen.queryByText(/Откройте его в панели/)).not.toBeInTheDocument()
  })

  // «Конфиг валиден» здесь соврало бы: документ — клиентская подписка, а не
  // конфиг ядра ноды. Подпись задаёт сборка, а не хром
  it('в статус-баре не обещает валидность конфига', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    expect(screen.queryByText('Конфиг валиден')).not.toBeInTheDocument()
    expect(screen.getByText('Документ разбирается, замечаний нет')).toBeInTheDocument()
  })

  it('правка через инспектор делает документ черновиком', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    // fireEvent, а не userEvent: полная цепочка pointer/mouse будит d3-drag
    // внутри React Flow, а в jsdom у события нет `view` — обработчик падает.
    // onNodeClick React Flow слушает обычный click, и его достаточно
    fireEvent.click(screen.getByText('Основная'))
    await userEvent.click(await screen.findByRole('button', { name: /Ещё поля/ }))
    await userEvent.type(screen.getByLabelText('filter'), 'RU')
    expect(await screen.findByText('черновик')).toBeInTheDocument()
  })

  it('сохранение шлёт encodedTemplateYaml и expectedHash, а не templateJson', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'PATCH /api/templates/u-1': {
        status: 200,
        body: { template: template(), hash: 'n'.repeat(64) },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    // Правка идёт текстом: так тест не зависит от разметки форм
    const draftKey = 'template:u-1'
    useDraftStore.getState().setDraft(draftKey, `${YAML}mode: rule\n`, HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(patchBody().expectedHash).toBe(HASH))
    expect(patchBody().templateJson).toBeUndefined()
    expect(String(patchBody().encodedTemplateYaml)).toBe(encodeYaml(`${YAML}mode: rule\n`))
  }, 30_000)

  it('конфликт по хэшу предлагает загрузить версию панели или перезаписать', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'PATCH /api/templates/u-1': {
        status: 409,
        body: { message: 'конфликт', current: template(), hash: 'x'.repeat(64) },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore.getState().setDraft('template:u-1', `${YAML}mode: rule\n`, HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Конфликт версий')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Загрузить версию панели' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Перезаписать' })).toBeInTheDocument()
  }, 30_000)

  it('битый YAML блокирует сохранение, а предупреждения — нет', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    // MATCH ведёт в имя, которого нет среди групп — это предупреждение
    useDraftStore.getState().setDraft('template:u-1', 'rules:\n  - MATCH,Неизвестная\n', HASH)
    expect(await screen.findByRole('button', { name: 'Сохранить в панель' })).toBeEnabled()
    useDraftStore.getState().setDraft('template:u-1', 'proxy-groups:\n  - [\n', HASH)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить в панель' })).toBeDisabled(),
    )
  })

  // Отдельно от предыдущего: там обе ветки различают синтаксис и ПРЕДУПРЕЖДЕНИЕ,
  // и точно так же прошла бы блокировка по `hasErrors`, как у Xray. Здесь
  // документ разбирается, но содержит смысловую ОШИБКУ (имя группы повторяется).
  // Такой шаблон панель примет, а подписка от него не сломается — блокировать
  // сохранение на нём нельзя
  it('смысловая ошибка (не синтаксис) сохранение не блокирует', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore
      .getState()
      .setDraft(
        'template:u-1',
        'proxy-groups:\n  - name: A\n    type: select\n  - name: A\n    type: select\n',
        HASH,
      )
    // Ошибка действительно есть: без неё проверка зеленела бы на пустом месте
    expect(await screen.findByText(/ошибок: 1/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить в панель' })).toBeEnabled()
  })

  // Пустой шаблон панели: encodedTemplateYaml приходит null. Открыть его как
  // текст «null» было бы враньём, а промолчать — оставить пустой холст без
  // объяснения
  it('пустой шаблон панели открывается пустым документом и говорит об этом', async () => {
    mockApi({
      'GET /api/templates/u-1': {
        status: 200,
        body: { template: template({ encodedTemplateYaml: null }), hash: HASH },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    expect(screen.getByText(/Шаблон в панели пуст/)).toBeInTheDocument()
  })

  it('шаблон другого YAML-типа по-прежнему ведёт в панель', async () => {
    mockApi({
      'GET /api/templates/u-1': {
        status: 200,
        body: { template: template({ templateType: 'CLASH' }), hash: HASH },
      },
    })
    renderPage()
    expect(await screen.findByText(/Откройте его в панели/)).toBeInTheDocument()
  })
})

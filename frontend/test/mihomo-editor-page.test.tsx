import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
/** Хэш версии панели: приходит в теле 409 и обязан уйти в «Перезаписать» */
const PANEL_HASH = 'x'.repeat(64)

/** Что «скачали» из каталога: документ заведомо другой, чем YAML выше */
const IMPORTED = ['mode: rule', 'rules:', '  - MATCH,DIRECT', ''].join('\n')

/**
 * Документ ровно с одной ОШИБКОЙ и без единого предупреждения: имя группы
 * повторяется. Пустые группы дали бы вдобавок «панель ничего не положит», и
 * проверки ниже перестали бы отличать ошибку от предупреждения — а именно это
 * различие они и стерегут.
 */
const DUP_NAMES = [
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  '  - name: A',
  '    type: select',
  '    proxies:',
  '      - DIRECT',
  'rules:',
  '  - MATCH,A',
  '',
].join('\n')

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

type Reply = { status: number; body: unknown }

/**
 * Ответы задаются либо одним `Reply` (повторяется на каждый запрос), либо
 * очередью: она нужна сценарию конфликта, где первый PATCH отвечает 409, а
 * второй — успехом. Последний элемент очереди залипает, чтобы лишний запрос
 * (например, перечитывание после invalidateQueries) не ронял тест.
 */
function mockApi(responses: Record<string, Reply | Reply[]>) {
  calls = []
  const queues = new Map<string, Reply[]>()
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
      const planned = responses[key]
      let res: Reply = { status: 200, body: fallback }
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

  /**
   * Обе кнопки были заперты, пока диалогов за ними не было (задачи 13 и 14).
   * Теперь диалоги есть, и проверка «кнопка не disabled» сама по себе ничего не
   * стоила бы: ниже — что каждая открывает СВОЙ диалог и что в него уходит.
   */
  it('«Проверить ядром» и «Импорт» больше не заперты', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    expect(screen.getByRole('button', { name: 'Проверить ядром' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Импорт' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Geo-базы' })).toBeEnabled()
  })

  // Панель «Документ» (задачи 13-14) заменила диалог секций — вход к ней теперь
  // только через псевдоузел `doc:settings` и кнопку «Документ» в доке графа, а не
  // через топбар, поэтому в топбаре кнопки «Секции документа» больше нет
  it('в топбаре нет кнопки «Секции документа»', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    expect(screen.queryByRole('button', { name: 'Секции документа' })).not.toBeInTheDocument()
  })

  // Кнопка «Рецепты» открывает обобщённый диалог рецептов (RecipesDialog)
  // поверх модели документа, а не другой диалог — так же, как проверяется
  // проводка «Секции документа» → MihomoSectionsDialog была устроена прежде
  it('«Рецепты» открывает диалог рецептов', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    const dialog = () => document.querySelector('dialog[aria-label="Рецепты"]') as HTMLDialogElement | null
    expect(dialog()?.open).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Рецепты' }))
    await waitFor(() => expect(dialog()?.open).toBe(true))
    expect(within(dialog()!).getByRole('button', { name: /Разделить трафик по наборам правил/ })).toBeInTheDocument()
  })

  // Применение рецепта — правка ЧЕРНОВИКА с записью в историю (как импорт),
  // а не запись в панель: результат обязан появиться в тексте и быть отменяем
  it('применение рецепта пишет черновик с историей и его можно отменить', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отменить' })).toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: 'Рецепты' }))
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']?.text).toContain(
        'RULE-SET,geosite-category-ads-all,REJECT',
      ),
    )
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']?.text ?? YAML).not.toContain('REJECT'),
    )
  })

  // Рецепт может вставить и сдвинуть правила по индексу — как импорт и
  // отмена/возврат, применение снимает выбор узла (минорная находка ревью):
  // старый id адресует уже не ту запись документа.
  it('применение рецепта снимает выбор узла', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    await userEvent.click(screen.getByRole('button', { name: '+ Правило' }))
    await waitFor(() => expect(document.querySelector('aside.wb-inspector')).not.toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Рецепты' }))
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']?.text).toContain(
        'RULE-SET,geosite-category-ads-all,REJECT',
      ),
    )
    expect(document.querySelector('aside.wb-inspector')).toBeNull()
  })

  // Пустой шаблон панели (encodedTemplateYaml: null) — законная точка старта
  // «с нуля»: холст обязан рисоваться с кнопкой «+ Добавить», а не гаснуть
  // пустым состоянием — адаптер отдаёт модель всегда, даже у пустого документа
  it('пустой шаблон панели рисует холст с «+ Добавить», а не пустое состояние', async () => {
    mockApi({
      'GET /api/templates/u-1': {
        status: 200,
        body: { template: template({ encodedTemplateYaml: null }), hash: HASH },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    expect(screen.getByRole('button', { name: '+ Добавить' })).toBeInTheDocument()
    expect(screen.queryByText('Документ пуст')).not.toBeInTheDocument()
  })

  // Ядру уходит ТЕКСТ черновика: печатать документ модели обратно нельзя, а
  // проверять что-то, кроме того, что уедет в панель, бессмысленно
  it('«Проверить ядром» отдаёт ядру текст черновика и показывает вердикт', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'POST /api/tools/mihomo-test': {
        status: 200,
        body: { available: true, ok: true, errors: [] },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore.getState().setDraft('template:u-1', `${YAML}mode: rule\n`, HASH)
    await userEvent.click(screen.getByRole('button', { name: 'Проверить ядром' }))
    expect(await screen.findByText(/Ядро приняло шаблон/)).toBeInTheDocument()
    const call = calls.find((c) => c.url.includes('/api/tools/mihomo-test'))
    expect(JSON.parse(String(call?.init?.body)).encodedTemplateYaml).toBe(
      encodeYaml(`${YAML}mode: rule\n`),
    )
  })

  // Импорт правит ЧЕРНОВИК: в панель ничего не уходит, решение сохранять
  // остаётся за пользователем
  it('«Импорт» подставляет шаблон каталога в черновик, а не в панель', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'GET /api/catalog/templates': {
        status: 200,
        body: {
          templates: [
            {
              name: 'mihomo-default',
              type: 'MIHOMO',
              author: 'remnawave',
              url: 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml',
            },
          ],
        },
      },
      'GET /api/catalog/template': { status: 200, body: { content: IMPORTED } },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    // Правило выбрано заранее: документ заменяется целиком, а правила
    // адресуются ПОЗИЦИЕЙ — rule:0 есть и в новом документе, и без снятия
    // выбора инспектор молча показал бы чужое правило под прежним номером
    fireEvent.click(screen.getByText('MATCH'))
    expect(await screen.findByText('rule:0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Импорт' }))
    await userEvent.click(await screen.findByText('mihomo-default'))
    // Ждём содержимое: до его загрузки кнопка импорта заперта
    await screen.findByText(/MATCH,DIRECT/)
    await userEvent.click(screen.getByRole('button', { name: 'Импортировать в редактор' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']?.text).toBe(IMPORTED),
    )
    expect(patchBodies()).toHaveLength(0)
    expect(screen.queryByText('rule:0')).not.toBeInTheDocument()
  })

  // Импорт кладётся в историю (`{ history: true }`): диалог подтверждения прямо
  // обещает, что вернуть прежний текст можно через Ctrl+Z, и обещание обязано
  // быть проверено, а не просто написано
  it('импорт отменяется через «Отменить»', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'GET /api/catalog/templates': {
        status: 200,
        body: {
          templates: [
            {
              name: 'mihomo-default',
              type: 'MIHOMO',
              author: 'remnawave',
              url: 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml',
            },
          ],
        },
      },
      'GET /api/catalog/template': { status: 200, body: { content: IMPORTED } },
    })
    const before = `${YAML}mode: rule\n`
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore.getState().setDraft('template:u-1', before, HASH)
    // Пока ничего не импортировано, отменять нечего: иначе тест зеленел бы на
    // кнопке, доступной и без записи в историю
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Отменить' })).toBeDisabled(),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Импорт' }))
    await userEvent.click(await screen.findByText('mihomo-default'))
    await screen.findByText(/MATCH,DIRECT/)
    // Черновик изменён — импорт сперва спрашивает
    await userEvent.click(screen.getByRole('button', { name: 'Импортировать в редактор' }))
    await userEvent.click(screen.getByRole('button', { name: 'Затереть и импортировать' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']?.text).toBe(IMPORTED),
    )

    expect(screen.getByRole('button', { name: 'Отменить' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']?.text).toBe(before),
    )
  })

  // Каталог живёт на GitHub и ходят к нему через наш бэкенд: пока диалог не
  // открыли, запроса быть не должно
  it('закрытый диалог импорта каталог не грузит', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    expect(calls.some((c) => c.url.includes('/api/catalog'))).toBe(false)
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
  })

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
  })

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
        DUP_NAMES,
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

  // Кнопки конфликта проверялись только на присутствие, а разрешают конфликт
  // они по-разному, и обе легко сломать незаметно. Здесь — что делает каждая
  it('«Перезаписать» уходит с хэшем ПАНЕЛИ, а не с устаревшей базой черновика', async () => {
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
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore.getState().setDraft('template:u-1', `${YAML}mode: rule\n`, HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Сохранить( всё равно)?$/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Перезаписать' }))

    await waitFor(() => expect(patchBodies()).toHaveLength(2))
    // Первый ушёл с базой черновика, второй обязан уйти с хэшем из тела 409:
    // повтори он первый — конфликт не разрешился бы уже НИКОГДА
    expect(patchBodies()[0]!.expectedHash).toBe(HASH)
    expect(patchBodies()[1]!.expectedHash).toBe(PANEL_HASH)
  })

  it('«Загрузить версию панели» отбрасывает черновик и возвращает документ панели', async () => {
    mockApi({
      'GET /api/templates/u-1': { status: 200, body: { template: template(), hash: HASH } },
      'PATCH /api/templates/u-1': {
        status: 409,
        body: { message: 'конфликт', current: template(), hash: PANEL_HASH },
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore.getState().setDraft('template:u-1', `${YAML}mode: rule\n`, HASH)
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить в панель' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Сохранить( всё равно)?$/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить версию панели' }))

    // Черновик действительно отброшен: и в хранилище, и в шапке редактора
    await waitFor(() =>
      expect(useDraftStore.getState().drafts['template:u-1']).toBeUndefined(),
    )
    expect(screen.queryByText('черновик')).not.toBeInTheDocument()
    // И повторных PATCH после отказа от своей версии нет
    expect(patchBodies()).toHaveLength(1)
  })

  // Ошибка у Mihomo сохранение не блокирует (см. тест выше), поэтому диалог
  // обязан её показать: спрятав ошибки и оставив только предупреждения, он
  // умолчал бы ровно о том, что ломает подписку
  it('диалог сохранения перечисляет ошибки и называет кнопку честно', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    useDraftStore
      .getState()
      .setDraft(
        'template:u-1',
        DUP_NAMES,
        HASH,
      )
    // Предупреждений у этого документа нет ни одного — значит «всё равно» на
    // кнопке может взяться только из ОШИБКИ
    expect(await screen.findByText(/ошибок: 1/)).toBeInTheDocument()
    expect(screen.queryByText(/предупреждений/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить в панель' }))
    expect(await screen.findByText(/Имя группы «A» повторяется/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить всё равно' })).toBeInTheDocument()
  })

  /**
   * Диалог версий монтирует хром, и формат документа доходит до него пропом.
   * Без этой проверки `docFormat` можно было бы не передать вовсе: сам диалог
   * покрыт своим тестом, но тот подаёт проп напрямую и разрыв проводки не ловит.
   */
  it('диалог версий знает, что документ — YAML', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    await userEvent.click(screen.getByRole('button', { name: 'Версии' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Файл' }))
    expect(screen.getByRole('button', { name: /Скачать YAML/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Скачать JSON/ })).not.toBeInTheDocument()
  })

  /**
   * ErrorBoundary в приложении нет: исключение из рендера — белый экран. Панель
   * поле `encodedTemplateYaml` нам ничем не гарантирует, а `atob` бросает на
   * всём, что не base64.
   */
  it('нечитаемое содержимое объясняется, а не роняет страницу', async () => {
    mockApi({
      'GET /api/templates/u-1': {
        status: 200,
        body: { template: template({ encodedTemplateYaml: 'не base64 ¡' }), hash: HASH },
      },
    })
    renderPage()
    expect(await screen.findByText(/не является base64/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Шаблоны' })).toBeInTheDocument()
  })

  /**
   * Трассировка живёт в доке графа: кнопка раскрывает строку цели, а разбор
   * появляется, когда ввод затих. Ждём его настоящим временем (пауза 600 мс):
   * подменять таймеры посреди react-query дороже, чем подождать один раз.
   */
  it('«Куда пойдёт трафик» раскрывает строку цели и показывает разбор', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Мой Mihomo' })
    // До нажатия инструмента в доке нет: строка ввода не занимает место зря
    expect(screen.queryByLabelText('Адрес')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Куда пойдёт трафик' }))
    fireEvent.change(screen.getByLabelText('Адрес'), { target: { value: 'a.com' } })
    const summary = await screen.findByLabelText('Итог трассировки', {}, { timeout: 3000 })
    // В шаблоне одно правило — MATCH,Основная: победить обязано оно
    expect(within(summary).getByText(/правило #1/i)).toBeInTheDocument()
    expect(within(summary).getByText('Основная')).toBeInTheDocument()
  }, 10_000)

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

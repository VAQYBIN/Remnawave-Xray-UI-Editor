import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from '../src/features/templates/TemplateEditorPage'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'
import { docStorageKey } from '../src/shared/lib/docKey'
import { selectOption } from './helpers'

const UUID = 'a0000000-0000-4000-8000-000000000001'
const UUID2 = 'a0000000-0000-4000-8000-000000000002'

const TEMPLATE_JSON = {
  remnawave: {
    addVirtualHostAsOutbound: false,
    injectHosts: [{ selector: { type: 'sameTagAsRecipient' }, tagPrefix: 'proxy', selectFrom: 'HIDDEN' }],
  },
  log: { loglevel: 'warning' },
  inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: {} }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
}

function templatePayload(uuid: string, name: string, type: string, hash: string) {
  return {
    template: {
      uuid,
      viewPosition: 0,
      name,
      templateType: type,
      templateJson: type === 'XRAY_JSON' ? TEMPLATE_JSON : null,
      encodedTemplateYaml: null,
    },
    hash,
  }
}

/**
 * Шаблон панели, у которого XRAY_JSON, но содержимого нет: `templateJson`
 * подставляется явно (`null`, `[]` и т.п.) — в отличие от `templatePayload`,
 * которая привязывает `null` к типу, отличному от XRAY_JSON.
 */
function emptyTemplatePayload(uuid: string, name: string, hash: string, templateJson: unknown) {
  return {
    template: {
      uuid,
      viewPosition: 0,
      name,
      templateType: 'XRAY_JSON',
      templateJson,
      encodedTemplateYaml: null,
    },
    hash,
  }
}

const HASH1 = 'b'.repeat(64)
const HASH2 = 'c'.repeat(64)
const HASH3 = 'd'.repeat(64)
const HASH_PANEL = 'e'.repeat(64)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Ответ панели на PATCH: либо новый хэш, либо конфликт с версией панели */
type PatchReply = { hash: string } | { conflictHash: string | null; name: string }

/**
 * Панель в миниатюре: GET отдаёт то, что установил последний успешный PATCH,
 * поэтому цепочка «сохранил → перечитал → сохранил снова» ведёт себя как в жизни.
 * Возвращает массив разобранных тел PATCH-запросов.
 */
function mockPanel(type = 'XRAY_JSON', patch: PatchReply[] = []) {
  const bodies: Record<string, unknown>[] = []
  const queue = [...patch]
  const state = { name: 'Xray Default', hash: HASH1 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PATCH') {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        const reply = queue.shift()
        if (reply === undefined) throw new Error(`неожиданный PATCH: ${url}`)
        if ('hash' in reply) {
          state.hash = reply.hash
          return json(templatePayload(UUID, state.name, 'XRAY_JSON', state.hash))
        }
        // 409 роута шаблонов: сообщение, текущий шаблон и его хэш рядом
        return json(
          {
            message: 'Шаблон изменён в панели',
            current: templatePayload(UUID, reply.name, 'XRAY_JSON', '').template,
            ...(reply.conflictHash === null ? {} : { hash: reply.conflictHash }),
          },
          409,
        )
      }
      const body = url.includes('/api/panel/token')
        ? { expiresAt: null, daysLeft: null, expired: false, expiringSoon: false }
        : // Диалог geo-баз монтируется вместе с оболочкой и падал бы на чужом ответе
          url.includes('/api/geo')
          ? {
              geosite: { url: '', present: false },
              geoip: { url: '', present: false },
            }
          : url.includes(UUID2)
            ? templatePayload(UUID2, 'Второй шаблон', 'XRAY_JSON', HASH2)
            : templatePayload(UUID, state.name, type, state.hash)
      return json(body)
    }),
  )
  return bodies
}

/**
 * Панель с шаблоном XRAY_JSON без содержимого: `templateJson` — то, что передали
 * (`null`, `[]`…). В отличие от `mockPanel`, тип не привязан к содержимому — так
 * можно смоделировать ровно ту панель, что заводит пустой XRAY_JSON-шаблон.
 */
function mockEmptyPanel(templateJson: unknown, patch: PatchReply[] = []) {
  const bodies: Record<string, unknown>[] = []
  const queue = [...patch]
  // templateJson тоже часть состояния «панели»: успешный PATCH обязан сдвинуть
  // его, иначе последующий GET (его дёргает invalidateQueries после сохранения)
  // вернёт прежний пустой шаблон, и сообщение «шаблон пуст» не исчезнет
  const state = { name: 'Пустой шаблон', hash: HASH1, templateJson }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        bodies.push(body)
        const reply = queue.shift()
        if (reply === undefined) throw new Error(`неожиданный PATCH: ${url}`)
        if ('hash' in reply) {
          state.hash = reply.hash
          state.templateJson = body.templateJson
          return json(emptyTemplatePayload(UUID, state.name, state.hash, state.templateJson))
        }
        return json(
          {
            message: 'Шаблон изменён в панели',
            current: emptyTemplatePayload(UUID, reply.name, '', state.templateJson).template,
            ...(reply.conflictHash === null ? {} : { hash: reply.conflictHash }),
          },
          409,
        )
      }
      const body = url.includes('/api/panel/token')
        ? { expiresAt: null, daysLeft: null, expired: false, expiringSoon: false }
        : url.includes('/api/geo')
          ? { geosite: { url: '', present: false }, geoip: { url: '', present: false } }
          : emptyTemplatePayload(UUID, state.name, state.hash, state.templateJson)
      return json(body)
    }),
  )
  return bodies
}

// stubGlobal снимается только unstubAllGlobals: restoreAllMocks оставил бы
// подменённый fetch жить между тестами файла. Черновики persist'ятся в
// localStorage — иначе они бы перетекали между тестами по одному docKey
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useDraftStore.getState().clearDraft(docStorageKey('template', UUID))
})

/** Правка через «Настройки конфига» — самый короткий путь сделать черновик грязным */
async function editLogLevel(user: UserEvent, level: string) {
  await user.click(screen.getByRole('button', { name: 'Настройки конфига' }))
  await selectOption('Уровень лога (loglevel)', level)
  await user.click(screen.getByRole('button', { name: 'Закрыть настройки' }))
}

async function saveToPanel(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Сохранить в панель' }))
  await user.click(await screen.findByRole('button', { name: /^Сохранить( всё равно)?$/ }))
}

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/templates/${UUID}`]}>
        <Routes>
          <Route path="/templates/:uuid" element={<TemplateEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('редактор шаблона', () => {
  it('открывает шаблон в общей оболочке', async () => {
    mockPanel()
    renderEditor()
    expect(await screen.findByRole('heading', { name: 'Xray Default' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Топология' })).toBeInTheDocument()
  })

  // Ровно то, чего в шаблоне быть не должно
  it('в топбаре нет проверки ядром и рецептов', async () => {
    mockPanel()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })
    expect(screen.queryByRole('button', { name: 'Проверить конфиг' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Рецепт/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Куда пойдёт трафик' })).toBeInTheDocument()
  })

  // MIHOMO с приходом своего редактора из этой ветки ушёл: здесь остались типы,
  // содержимое которых редактор не разбирает вовсе
  it('YAML-шаблон не открывается, а объясняет почему и даёт вернуться', async () => {
    mockPanel('CLASH')
    renderEditor()
    expect(await screen.findByText(/умеет шаблоны XRAY_JSON и MIHOMO/)).toBeInTheDocument()
    // Тупик без выхода: сюда попадают по прямой ссылке, «назад» браузера увёл бы
    // из приложения — кнопка обязана быть и вести в список
    expect(screen.getByRole('button', { name: '← Шаблоны' })).toBeInTheDocument()
  })

  it('ошибка загрузки тоже даёт вернуться в список', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Шаблон не найден' }, 404)),
    )
    renderEditor()
    expect(await screen.findByText('Шаблон не найден')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Шаблоны' })).toBeInTheDocument()
  })

  // Между двумя закэшированными шаблонами переход идёт без промежуточной загрузки:
  // без key на внутреннем компоненте состояние (вкладка, выбранный узел, цель
  // трассировки) пережило бы смену документа, а позиционные id указывали бы не туда
  it('переход на другой закэшированный шаблон перемонтирует редактор', async () => {
    mockPanel()
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Второй шаблон уже в кэше: переход пройдёт без промежуточной загрузки,
    // на которой редактор перемонтировался бы и без key
    qc.setQueryData(
      ['templates', UUID2],
      templatePayload(UUID2, 'Второй шаблон', 'XRAY_JSON', 'c'.repeat(64)),
    )
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/templates/${UUID}`]}>
          <Link to={`/templates/${UUID2}`}>ко второму</Link>
          <Routes>
            <Route path="/templates/:uuid" element={<TemplateEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByRole('heading', { name: 'Xray Default' })
    await user.click(screen.getByRole('button', { name: 'JSON' }))
    expect(screen.getByRole('button', { name: 'JSON' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('link', { name: 'ко второму' }))

    expect(await screen.findByRole('heading', { name: 'Второй шаблон' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Топология' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  // Хэш клиент не считает — он его только возвращает. Значит, база черновика обязана
  // переехать на хэш из ответа панели, иначе второе сохранение упрётся в 409
  it('второе сохранение уходит с хэшем, который вернуло первое', async () => {
    const bodies = mockPanel('XRAY_JSON', [{ hash: HASH2 }, { hash: HASH3 }])
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })

    await editLogLevel(user, 'debug')
    await saveToPanel(user)
    await waitFor(() => expect(bodies).toHaveLength(1))

    await editLogLevel(user, 'info')
    await saveToPanel(user)
    await waitFor(() => expect(bodies).toHaveLength(2))

    expect(bodies[0]!.expectedHash).toBe(HASH1)
    expect(bodies[1]!.expectedHash).toBe(HASH2)
    expect((bodies[1]!.templateJson as { log: { loglevel: string } }).log.loglevel).toBe('info')
    // Дважды смонтированный MergeView в SaveDialog не укладывается в дефолтные 5 с,
    // когда полный прогон идёт под нагрузкой
  }, 30_000)

  // Ловушка формы данных: у шаблона в кэше лежит пара {template, hash}, а не голый
  // шаблон, как у профиля. Ошибка здесь уронила бы страницу на undefined
  it('«Загрузить версию панели» кладёт в кэш пару {template, hash}', async () => {
    mockPanel('XRAY_JSON', [{ conflictHash: HASH_PANEL, name: 'Версия из панели' }])
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })

    await editLogLevel(user, 'debug')
    await saveToPanel(user)

    await user.click(await screen.findByRole('button', { name: 'Загрузить версию панели' }))

    expect(await screen.findByRole('heading', { name: 'Версия из панели' })).toBeInTheDocument()
    // Черновик отброшен вместе с конфликтом: осталась версия панели
    expect(screen.queryByText('черновик')).not.toBeInTheDocument()
  }, 30_000)

  // Шаблон, заведённый в панели и ни разу не заполненный вторым шагом создания:
  // templateJson === null. Редактор обязан открыть пустой документ, а не текст
  // «null», и честно сказать пользователю, что происходит
  it('пустой шаблон панели (templateJson: null) открывается как {}, а не как текст null', async () => {
    mockEmptyPanel(null)
    const user = userEvent.setup()
    renderEditor()

    expect(await screen.findByRole('heading', { name: 'Пустой шаблон' })).toBeInTheDocument()
    expect(screen.getByText(/Шаблон в панели пуст/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'JSON' }))
    expect(document.querySelector('.cm-content')?.textContent).toBe('{}')
  })

  // Массив — тоже не конфиг Xray, и открывать его как документ так же бессмысленно,
  // как и null. Дешёвая проверка: то же поведение, другой примитив на входе
  it('templateJson: [] тоже открывается как пустой документ', async () => {
    mockEmptyPanel([])
    renderEditor()

    expect(await screen.findByRole('heading', { name: 'Пустой шаблон' })).toBeInTheDocument()
    expect(screen.getByText(/Шаблон в панели пуст/)).toBeInTheDocument()
  })

  // Защита от того, чтобы плашка «шаблон пуст» не висела на каждом шаблоне —
  // у обычного, заполненного, её быть не должно
  it('у обычного шаблона с содержимым сообщение о пустом шаблоне не появляется', async () => {
    mockPanel()
    renderEditor()

    await screen.findByRole('heading', { name: 'Xray Default' })
    expect(screen.queryByText(/Шаблон в панели пуст/)).not.toBeInTheDocument()
  })

  // Пустой документ не блокирует работу: пользователь собирает шаблон с нуля,
  // и сохранение уходит обычным путём с тем, что он тут насобирал. {} валиден,
  // но панель не примет конфиг без outbounds, а «Настройки конфига» их не
  // редактирует — черновик с собранным документом заводим напрямую, как
  // profiles-page.test.tsx, а не вводом в CodeMirror (незачем гонять реальный
  // ввод текста ради шага, который тут не проверяется)
  it('сохранение пустого шаблона отправляет собранный документ', async () => {
    const bodies = mockEmptyPanel(null, [{ hash: HASH2 }])
    useDraftStore
      .getState()
      .setDraft(
        docStorageKey('template', UUID),
        JSON.stringify({ outbounds: [{ tag: 'direct', protocol: 'freedom' }] }),
        HASH1,
      )
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Пустой шаблон' })

    await saveToPanel(user)

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]!.expectedHash).toBe(HASH1)
    expect(
      (bodies[0]!.templateJson as { outbounds: Array<{ tag: string }> }).outbounds[0]!.tag,
    ).toBe('direct')
    // Сообщение о пустом шаблоне исчезает: панель после сохранения отдаёт
    // уже заполненный templateJson
    expect(screen.queryByText(/Шаблон в панели пуст/)).not.toBeInTheDocument()
  }, 30_000)
})

/**
 * Импорт из каталога у Xray-шаблона. Сам диалог покрыт своим тестом
 * (`import-template-dialog.test.tsx`), здесь — ровно проводка страницы: чем
 * открывается, какой `docType` уходит внутрь, куда попадает скачанное и откуда
 * берётся `dirty`. У Mihomo та же проводка живёт в `mihomo-editor-page`, и без
 * этих проверок половина её (Xray) держалась бы только на типах.
 */
const CATALOG_XRAY_URL = 'https://raw.githubusercontent.com/remnawave/templates/main/xray.json'
const CATALOG_MIHOMO_URL = 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml'
/**
 * Что «скачали»: документ заведомо другой, чем TEMPLATE_JSON панели. Правило в
 * нём есть НАМЕРЕННО: узел `rule:0` обязан существовать и после замены
 * документа, иначе проверка «импорт снял выбор» зеленела бы сама собой — узел
 * исчез бы вместе с документом (ровно та ловушка, что уже ловилась на группе
 * в редакторе Mihomo).
 */
const IMPORTED_XRAY = JSON.stringify(
  {
    outbounds: [{ tag: 'imported', protocol: 'freedom' }],
    routing: { rules: [{ type: 'field', outboundTag: 'imported', domain: ['example.org'] }] },
  },
  null,
  2,
)

/** Шаблон панели с одной диагностикой на узле `rule:0`: правило ведёт в никуда */
const ISSUE_TEMPLATE_JSON = {
  log: { loglevel: 'warning' },
  inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: {} }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [{ type: 'field', outboundTag: 'нет-такого', domain: ['example.com'] }] },
}

/**
 * Панель плюс каталог. Отдельно от `mockPanel`: тот на адреса каталога отвечает
 * шаблоном панели, и список записей вышел бы пустым. Документ параметризован —
 * одному из тестов нужен шаблон с диагностикой; умолчание оставляет прежний.
 */
function mockPanelWithCatalog(templateJson: unknown = TEMPLATE_JSON) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/api/catalog/template?')) return json({ content: IMPORTED_XRAY })
      if (url.includes('/api/catalog/templates')) {
        return json({
          templates: [
            { name: 'xray-default', type: 'XRAY_JSON', author: 'remnawave', url: CATALOG_XRAY_URL },
            {
              name: 'mihomo-default',
              type: 'MIHOMO',
              author: 'remnawave',
              url: CATALOG_MIHOMO_URL,
            },
          ],
        })
      }
      if (url.includes('/api/panel/token')) {
        return json({ expiresAt: null, daysLeft: null, expired: false, expiringSoon: false })
      }
      if (url.includes('/api/geo')) {
        return json({ geosite: { url: '', present: false }, geoip: { url: '', present: false } })
      }
      return json({
        template: {
          uuid: UUID,
          viewPosition: 0,
          name: 'Xray Default',
          templateType: 'XRAY_JSON',
          templateJson,
          encodedTemplateYaml: null,
        },
        hash: HASH1,
      })
    }),
  )
  return calls
}

describe('импорт из каталога в редакторе Xray-шаблона', () => {
  // Фильтр по умолчанию — тип ОТКРЫТОГО документа: подставь страница чужой
  // docType, и в списке оказались бы шаблоны, которые сюда не лезут
  it('«Импорт» открывает каталог и по умолчанию показывает XRAY_JSON', async () => {
    const calls = mockPanelWithCatalog()
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })
    // Пока диалог не открыли, на GitHub через бэкенд никто не ходит
    expect(calls.some((c) => c.url.includes('/api/catalog'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Импорт' }))

    expect(await screen.findByText('xray-default')).toBeInTheDocument()
    expect(screen.queryByText('mihomo-default')).not.toBeInTheDocument()
  }, 30_000)

  it('импорт кладёт скачанное в черновик, а в панель ничего не шлёт', async () => {
    const calls = mockPanelWithCatalog()
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })

    await user.click(screen.getByRole('button', { name: 'Импорт' }))
    await user.click(await screen.findByText('xray-default'))
    // Ждём содержимое: до его загрузки кнопка импорта заперта
    await screen.findByText(/imported/)
    await user.click(screen.getByRole('button', { name: 'Импортировать в редактор' }))

    await waitFor(() =>
      expect(useDraftStore.getState().drafts[docStorageKey('template', UUID)]?.text).toBe(
        IMPORTED_XRAY,
      ),
    )
    // Решение сохранять остаётся за пользователем: ни одного PATCH
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false)
  }, 30_000)

  // `dirty` обязан приходить из черновика: с зашитым `false` импорт молча затёр
  // бы чужую работу, с зашитым `true` спрашивал бы там, где затирать нечего
  it('поверх изменённого черновика импорт спрашивает подтверждение', async () => {
    mockPanelWithCatalog()
    useDraftStore
      .getState()
      .setDraft(
        docStorageKey('template', UUID),
        JSON.stringify({ outbounds: [{ tag: 'моя правка', protocol: 'freedom' }] }),
        HASH1,
      )
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })

    await user.click(screen.getByRole('button', { name: 'Импорт' }))
    await user.click(await screen.findByText('xray-default'))
    await screen.findByText(/imported/)
    await user.click(screen.getByRole('button', { name: 'Импортировать в редактор' }))

    expect(screen.getByText(/затрёт ваши правки/)).toBeInTheDocument()
    // До подтверждения черновик не тронут
    expect(useDraftStore.getState().drafts[docStorageKey('template', UUID)]?.text).not.toBe(
      IMPORTED_XRAY,
    )

    await user.click(screen.getByRole('button', { name: 'Затереть и импортировать' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts[docStorageKey('template', UUID)]?.text).toBe(
        IMPORTED_XRAY,
      ),
    )
  }, 30_000)

  // Импорт кладётся в историю (`{ history: true }`): диалог подтверждения прямо
  // обещает возврат через Ctrl+Z, и обещание обязано быть проверено
  it('импорт отменяется через «Отменить»', async () => {
    mockPanelWithCatalog()
    useHistoryStore.setState({ stacks: {} })
    const before = JSON.stringify({ outbounds: [{ tag: 'до импорта', protocol: 'freedom' }] })
    useDraftStore.getState().setDraft(docStorageKey('template', UUID), before, HASH1)
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })
    // Пока ничего не импортировано, отменять нечего: иначе тест зеленел бы на
    // кнопке, доступной и без записи в историю
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Импорт' }))
    await user.click(await screen.findByText('xray-default'))
    await screen.findByText(/imported/)
    await user.click(screen.getByRole('button', { name: 'Импортировать в редактор' }))
    await user.click(screen.getByRole('button', { name: 'Затереть и импортировать' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts[docStorageKey('template', UUID)]?.text).toBe(
        IMPORTED_XRAY,
      ),
    )

    expect(screen.getByRole('button', { name: 'Отменить' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Отменить' }))
    await waitFor(() =>
      expect(useDraftStore.getState().drafts[docStorageKey('template', UUID)]?.text).toBe(before),
    )
  }, 30_000)

  // Документ заменяется целиком, а id узлов считаются по тегам и позициям
  // правил. Выбор берём не с канваса, а из списка проблем в статус-баре
  // (`selectIssue`), и ведёт он в `rule:0` — узел, который есть и в
  // импортируемом документе: исчезни он вместе с документом, проверка зеленела
  // бы и без снятия выбора
  it('импорт снимает выбранный узел', async () => {
    mockPanelWithCatalog(ISSUE_TEMPLATE_JSON)
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'Xray Default' })

    // Диагностика здесь предупреждение, а не ошибка: узел у неё есть, а больше
    // для выбора ничего не нужно
    await user.click(screen.getByRole('button', { name: /предупреждений/ }))
    // По роли, а не по тексту: тот же список проблем рендерит и закрытый диалог
    // сохранения, а из дерева доступности закрытый <dialog> выпадает
    await user.click(await screen.findByRole('button', { name: /несуществующий outbound/ }))
    expect(screen.getByRole('button', { name: 'Удалить узел' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Импорт' }))
    await user.click(await screen.findByText('xray-default'))
    await screen.findByText(/imported/)
    await user.click(screen.getByRole('button', { name: 'Импортировать в редактор' }))

    await waitFor(() =>
      expect(useDraftStore.getState().drafts[docStorageKey('template', UUID)]?.text).toBe(
        IMPORTED_XRAY,
      ),
    )
    expect(screen.queryByRole('button', { name: 'Удалить узел' })).not.toBeInTheDocument()
  }, 30_000)
})

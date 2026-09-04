import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from '../src/features/templates/TemplateEditorPage'
import { useDraftStore } from '../src/features/editor/draftStore'
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

// stubGlobal снимается только unstubAllGlobals: restoreAllMocks оставил бы
// подменённый fetch жить между тестами файла. Черновики persist'ятся в
// localStorage — иначе они бы перетекали между тестами по одному docKey
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useDraftStore.getState().clearDraft(UUID)
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

  it('YAML-шаблон не открывается, а объясняет почему и даёт вернуться', async () => {
    mockPanel('MIHOMO')
    renderEditor()
    expect(await screen.findByText(/только шаблоны XRAY_JSON/)).toBeInTheDocument()
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
})

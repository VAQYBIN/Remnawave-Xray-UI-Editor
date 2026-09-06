import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportTemplateDialog } from '../src/features/templates/ImportTemplateDialog'
import { selectOption } from './helpers'

const MIHOMO_URL = 'https://raw.githubusercontent.com/remnawave/templates/main/a.yaml'
const CONTENT = 'mode: rule\nrules:\n  - MATCH,DIRECT\n'

const CATALOG = {
  templates: [
    { name: 'mihomo-default', type: 'MIHOMO', author: 'remnawave', url: MIHOMO_URL },
    { name: 'xray-default', type: 'XRAY_JSON', author: 'remnawave', url: 'https://raw.githubusercontent.com/remnawave/templates/main/b.json' },
    // Каталог опережает контракт панели: этого типа в SUBSCRIPTION_TEMPLATE_TYPE нет
    { name: 'singbox-legacy', type: 'SINGBOX_LEGACY', author: 'someone', url: 'https://raw.githubusercontent.com/remnawave/templates/main/c.json' },
  ],
}

/** Адреса запросов: по ним видно, что ссылка на содержимое взята из индекса */
let urls: string[] = []

function mockCatalog(over: { list?: { status: number; body: unknown } } = {}) {
  urls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url))
      const hit = String(url).includes('/api/catalog/template?')
        ? { status: 200, body: { content: CONTENT } }
        : (over.list ?? { status: 200, body: CATALOG })
      return new Response(JSON.stringify(hit.body), {
        status: hit.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

/** Шпион закрытия: отдельной переменной, чтобы renderDialog по-прежнему возвращал onImport */
let onClose = vi.fn()

function renderDialog(props: Partial<Parameters<typeof ImportTemplateDialog>[0]> = {}) {
  const onImport = vi.fn()
  onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ImportTemplateDialog open docType="MIHOMO" dirty={false} onImport={onImport} onClose={onClose} {...props} />
    </QueryClientProvider>,
  )
  return onImport
}

describe('импорт шаблона из каталога', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('по умолчанию показывает шаблоны типа открытого документа', async () => {
    mockCatalog()
    renderDialog()
    expect(await screen.findByText('mihomo-default')).toBeInTheDocument()
    expect(screen.queryByText('xray-default')).not.toBeInTheDocument()
    expect(screen.queryByText('singbox-legacy')).not.toBeInTheDocument()
  })

  // Тот же фильтр, но у другого редактора: умолчание берётся из открытого
  // документа, а не зашито в диалог
  it('у Xray-документа по умолчанию видны шаблоны XRAY_JSON', async () => {
    mockCatalog()
    renderDialog({ docType: 'XRAY_JSON' })
    expect(await screen.findByText('xray-default')).toBeInTheDocument()
    expect(screen.queryByText('mihomo-default')).not.toBeInTheDocument()
  })

  it('переключение фильтра показывает все, включая незнакомый тип', async () => {
    mockCatalog()
    renderDialog()
    await screen.findByText('mihomo-default')
    await selectOption('Тип', 'all')
    expect(screen.getByText('xray-default')).toBeInTheDocument()
    // Незнакомый тип обязан попасть в список, а не уронить его
    expect(screen.getByText('singbox-legacy')).toBeInTheDocument()
  })

  it('незнакомый тип помечен и импортировать его нельзя', async () => {
    mockCatalog()
    const onImport = renderDialog()
    await screen.findByText('mihomo-default')
    await selectOption('Тип', 'all')
    await userEvent.click(screen.getByText('singbox-legacy'))
    expect(screen.getByText(/не поддерживается редактором/)).toBeInTheDocument()
    // И причина запертой кнопки названа отдельно от пометки в списке
    expect(screen.getByText(/Тип SINGBOX_LEGACY редактор не открывает/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Импортировать в редактор' })).toBeDisabled()
    expect(onImport).not.toHaveBeenCalled()
  })

  // Тип знакомый, но чужой открытому документу: смотреть можно, импортировать
  // нельзя — и причина у этого другая, чем у незнакомого типа
  it('шаблон чужого типа виден и читается, но импорт у него заперт', async () => {
    mockCatalog()
    renderDialog()
    await screen.findByText('mihomo-default')
    await selectOption('Тип', 'all')
    await userEvent.click(screen.getByText('xray-default'))
    expect(await screen.findByText(/MATCH,DIRECT/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Импортировать в редактор' })).toBeDisabled()
    expect(screen.getByText(/только шаблон типа MIHOMO/)).toBeInTheDocument()
    // Причина именно чужой тип, а не незнакомый: XRAY_JSON редактор знает
    expect(screen.queryByText(/редактор не открывает/)).not.toBeInTheDocument()
  })

  it('выбор записи подгружает содержимое в предпросмотр', async () => {
    mockCatalog()
    renderDialog()
    await userEvent.click(await screen.findByText('mihomo-default'))
    expect(await screen.findByText(/MATCH,DIRECT/)).toBeInTheDocument()
    // Ссылка на содержимое — ровно та, что пришла в индексе: собранный на
    // клиенте адрес бэкенд отвергает (защита от SSRF)
    expect(urls.some((u) => u === `/api/catalog/template?url=${encodeURIComponent(MIHOMO_URL)}`)).toBe(true)
  })

  it('импорт отдаёт содержимое наружу, а не сохраняет в панель', async () => {
    mockCatalog()
    const onImport = renderDialog()
    await userEvent.click(await screen.findByText('mihomo-default'))
    await userEvent.click(await screen.findByRole('button', { name: 'Импортировать в редактор' }))
    expect(onImport).toHaveBeenCalledWith(CONTENT)
    // Ни одного PATCH: решение сохранять остаётся за пользователем
    expect(
      (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.some(
        ([, init]) => init?.method === 'PATCH',
      ),
    ).toBe(false)
  })

  // Без закрытия диалог остаётся висеть поверх редактора — с прежним выбором и
  // кнопкой, готовой импортировать во второй раз
  it('после импорта диалог закрывается', async () => {
    mockCatalog()
    renderDialog()
    await userEvent.click(await screen.findByText('mihomo-default'))
    await userEvent.click(await screen.findByRole('button', { name: 'Импортировать в редактор' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // Выбор пережил бы смену фильтра — и в предпросмотре осталась бы запись,
  // которой в списке уже нет
  it('смена фильтра снимает выбор', async () => {
    mockCatalog()
    renderDialog()
    await screen.findByText('mihomo-default')
    await selectOption('Тип', 'all')
    await userEvent.click(screen.getByText('xray-default'))
    expect(await screen.findByText(/MATCH,DIRECT/)).toBeInTheDocument()

    await selectOption('Тип', 'MIHOMO')

    expect(screen.queryByText('xray-default')).not.toBeInTheDocument()
    expect(screen.queryByText(/MATCH,DIRECT/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Импортировать в редактор' })).toBeDisabled()
  })

  it('поверх черновика спрашивает подтверждение', async () => {
    mockCatalog()
    const onImport = renderDialog({ dirty: true })
    await userEvent.click(await screen.findByText('mihomo-default'))
    await userEvent.click(await screen.findByRole('button', { name: 'Импортировать в редактор' }))
    expect(onImport).not.toHaveBeenCalled()
    expect(screen.getByText(/затрёт ваши правки/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Затереть и импортировать' }))
    expect(onImport).toHaveBeenCalledOnce()
    expect(onImport).toHaveBeenCalledWith(CONTENT)
  })

  /**
   * Пустой список приходит двумя путями, и совет у них разный. Под фильтром
   * типа «переключите на все типы» — рабочий выход; на «всех типах» переключать
   * уже некуда, и тот же совет отправлял бы пользователя туда, где он стоит.
   */
  it('пустой список под фильтром типа советует переключиться на «все типы»', async () => {
    mockCatalog({ list: { status: 200, body: { templates: [] } } })
    renderDialog()
    expect(await screen.findByText(/переключите фильтр на «все типы»/)).toBeInTheDocument()
  })

  it('пустой список на «всех типах» не советует переключать фильтр', async () => {
    mockCatalog({ list: { status: 200, body: { templates: [] } } })
    renderDialog()
    await screen.findByText('Ничего не нашлось')
    await selectOption('Тип', 'Все типы')
    expect(screen.getByText(/Каталог не вернул ни одной записи/)).toBeInTheDocument()
    expect(screen.queryByText(/переключите фильтр/)).not.toBeInTheDocument()
  })

  it('недоступность GitHub показывает русский текст, а не пустой список', async () => {
    mockCatalog({ list: { status: 502, body: { message: 'Каталог шаблонов недоступен: GitHub ответил 503' } } })
    renderDialog()
    expect(await screen.findByText(/Каталог шаблонов недоступен/)).toBeInTheDocument()
  })

  // Диалог смонтирован вместе со страницей: без гейта каждый открытый редактор
  // ходил бы на GitHub через наш бэкенд
  it('закрытый диалог каталог не грузит', async () => {
    mockCatalog()
    renderDialog({ open: false })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(urls).toHaveLength(0)
    expect(screen.queryByText('mihomo-default')).not.toBeInTheDocument()
  })

  // Закрытие обязано забыть выбор: иначе следующее открытие показывает
  // предпросмотр чужого шаблона и активную кнопку импорта
  it('закрытие сбрасывает выбор и подтверждение', async () => {
    mockCatalog()
    renderDialog({ dirty: true })
    await userEvent.click(await screen.findByText('mihomo-default'))
    await userEvent.click(await screen.findByRole('button', { name: 'Импортировать в редактор' }))
    expect(screen.getByText(/затрёт ваши правки/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByText(/затрёт ваши правки/)).not.toBeInTheDocument()
    expect(screen.queryByText(/MATCH,DIRECT/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Импортировать в редактор' })).toBeDisabled()
  })
})

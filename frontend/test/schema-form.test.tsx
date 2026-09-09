import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SchemaForm } from '../src/features/inspector/schema/SchemaForm'
import type { FieldSchema } from '../src/shared/schema'
import { optionLabels, selectOption, selectedValue } from './helpers'
import { makeWriter } from './schemaHelpers'

const FIELDS: FieldSchema[] = [
  { key: 'tag', doc: 'Имя.', kind: 'string' },
  {
    key: 'type',
    doc: 'Тип.',
    kind: 'enum',
    enum: [{ value: 'direct' }, { value: 'vless' }, { value: 'block', deprecated: { since: '1.13.0', replacement: 'reject' } }],
  },
  { key: 'server_port', doc: 'Порт.', kind: 'number', min: 1 },
  { key: 'tcp_fast_open', doc: 'TFO.', kind: 'boolean' },
  { key: 'uuid', doc: 'UUID.', kind: 'string', when: { key: 'type', in: ['vless'] } },
  { key: 'detour', doc: 'Через.', kind: 'string', ref: 'outbound' },
  { key: 'alpn', doc: 'ALPN.', kind: 'list', item: { kind: 'string' } },
  { key: 'port', doc: 'Порты.', kind: 'list', item: { kind: 'number' } },
  { key: 'headers', doc: 'Заголовки.', kind: 'map' },
  {
    key: 'tls',
    doc: 'TLS.',
    kind: 'object',
    fields: [{ key: 'enabled', doc: 'Вкл.', kind: 'boolean' }, { key: 'server_name', doc: 'SNI.', kind: 'string' }],
  },
  {
    key: 'peers',
    doc: 'Пиры.',
    kind: 'list',
    item: {
      kind: 'object',
      fields: [{ key: 'address', doc: 'Адрес.', kind: 'string' }],
      label: (v) => `пир ${(v as { address?: string }).address ?? '?'}`,
      starter: () => ({ address: '' }),
    },
  },
  { key: 'remnawave', doc: 'Панель.', kind: 'object', panelKey: true, fields: [{ key: 'includeProxies', doc: 'Ключ.', kind: 'boolean' }] },
  { key: 'old', doc: 'Старое.', kind: 'string', deprecated: { since: '1.11.0', replacement: 'new' } },
]

const PATH = ['outbounds', 0]

describe('SchemaForm: раскладка', () => {
  it('заполненные поля сверху, незаполненные под «Ещё поля (N)»', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a', type: 'direct' }} path={PATH} writer={writer} />)
    expect(screen.getByLabelText('tag')).toHaveValue('a')
    // uuid скрыт условием, remnawave — ключ панели: оба не считаются
    expect(screen.getByRole('button', { name: /Ещё поля \(9\)/ })).toBeInTheDocument()
  })

  it('skip убирает поля, нарисованные вызывающим', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a' }} path={PATH} writer={writer} skip={['tag']} />)
    expect(screen.queryByLabelText('tag')).toBeNull()
  })

  it('условное поле становится доступным вместе со значением соседа, а не подскакивает наверх', async () => {
    const { writer } = makeWriter()
    const moreToggle = () => screen.getByRole('button', { name: /^Ещё поля/ })
    const { rerender } = render(<SchemaForm fields={FIELDS} value={{ type: 'direct' }} path={PATH} writer={writer} />)

    // Условие не выполнено (type: direct) — uuid отсутствует в списке полей вовсе, крышка ни при чём
    expect(screen.queryByText('uuid')).toBeNull()
    const titleBefore = moreToggle().textContent

    rerender(<SchemaForm fields={FIELDS} value={{ type: 'vless' }} path={PATH} writer={writer} />)
    // Условие выполнилось — uuid стал ДОСТУПЕН (появился в списке полей), но остаётся
    // незаполненным: он должен быть под той же крышкой «Ещё поля», что и остальные пустые
    // поля, — НЕ подскакивать наверх сам по себе только из-за того, что стал видимым.
    expect(screen.queryByText('uuid')).toBeNull()
    await userEvent.click(moreToggle())
    expect(screen.getByText('uuid')).toBeInTheDocument()
    expect(moreToggle().textContent).not.toBe(titleBefore)
  })
})

describe('SchemaForm: операции', () => {
  it('строка пишет set, пустая строка — remove', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a' }} path={PATH} writer={writer} />)
    await userEvent.type(screen.getByLabelText('tag'), 'b')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tag'], value: 'ab' })
    await userEvent.clear(screen.getByLabelText('tag'))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['outbounds', 0, 'tag'] })
  })

  it('тристейт пишет явное false', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tcp_fast_open: true }} path={PATH} writer={writer} />)
    await userEvent.click(screen.getByRole('button', { name: 'нет' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tcp_fast_open'], value: false })
  })

  it('перечисление: чужое значение проходит сквозь, устаревшее объяснено, «(не задано)» снимает ключ', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ type: 'block' }} path={PATH} writer={writer} />)
    expect(selectedValue('type')).toBe('block')
    expect(await optionLabels('type')).toContain('block')
    expect(screen.getByText(/1\.13\.0.*reject/)).toBeInTheDocument()
    await selectOption('type', '(не задано)')
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['outbounds', 0, 'type'] })
  })

  it('устаревшее значение перечисления не предлагается заново, но проходит текущим', async () => {
    const { writer } = makeWriter()
    // type: 'direct' — устаревший 'block' сейчас не выбран, и его не должно быть
    // среди вариантов вовсе (спека: «удалённые проходят сквозь» — только текущим)
    render(<SchemaForm fields={FIELDS} value={{ type: 'direct' }} path={PATH} writer={writer} />)
    expect(await optionLabels('type')).not.toContain('block')
    // а вот когда 'block' и есть текущее значение — он обязан остаться выбранным (см. тест выше)
  })

  it('ссылка предлагает теги документа плюс текущее значение', async () => {
    const { ops, writer } = makeWriter()
    render(
      <SchemaForm fields={FIELDS} value={{ detour: 'gone' }} path={PATH} writer={writer} refs={{ outbound: ['direct', 'proxy'] }} />,
    )
    expect(await optionLabels('detour')).toEqual(['(не задано)', 'gone', 'direct', 'proxy'])
    await selectOption('detour', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'detour'], value: 'proxy' })
  })

  it('список чисел пишет числа, а не строки', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ port: [80] }} path={PATH} writer={writer} />)
    await userEvent.type(screen.getByLabelText('port'), '\n443')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'port'], value: [80, 443] })
  })

  it('скаляр списка строк читается как список из одного элемента, правка пишет список', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ alpn: 'h2' }} path={PATH} writer={writer} />)
    expect(screen.getByLabelText('alpn')).toHaveValue('h2')
    await userEvent.type(screen.getByLabelText('alpn'), '\nh3')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'alpn'], value: ['h2', 'h3'] })
  })

  it('вложенный объект пишет по полному пути и заводится записью, когда его нет', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{}} path={PATH} writer={writer} />)
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    const tlsToggle = screen.getByRole('button', { name: 'tls' })
    await userEvent.click(tlsToggle)
    // У вложенного объекта своя крышка «Ещё поля» (I4): tls только что открыт и
    // ещё пуст, поэтому server_name — тоже под ней, ровно как поля корня.
    // Ищем крышку внутри тела tls (а не screen целиком) — на странице их теперь
    // две, и вторая, верхнего уровня, тоже подходит под /Ещё поля/
    const tlsBody = tlsToggle.parentElement as HTMLElement
    await userEvent.click(within(tlsBody).getByRole('button', { name: /Ещё поля/ }))
    await userEvent.type(within(tlsBody).getByLabelText('server_name'), 'x')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tls', 'server_name'], value: 'x' })
  })

  it('у вложенного объекта своя крышка «Ещё поля»: заполненное поле видно сразу, пустое — под ней', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tls: { server_name: 'x.com' } }} path={PATH} writer={writer} />)
    // tls заполнен — он сам в числе видимых полей корня (правило 1) и открыт по
    // умолчанию (defaultOpen), server_name виден без единого клика
    expect(screen.getByLabelText('server_name')).toHaveValue('x.com')
    // enabled — единственное незаполненное поле tls — спрятан под собственной крышкой,
    // а не показан рядом с server_name
    expect(screen.queryByText('enabled')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ещё поля (1)' })).toBeInTheDocument()
  })

  it('список объектов: добавить, переставить, удалить — операции по индексу', async () => {
    const { ops, writer } = makeWriter()
    render(
      <SchemaForm fields={FIELDS} value={{ peers: [{ address: 'a' }, { address: 'b' }] }} path={PATH} writer={writer} />,
    )
    const list = screen.getByRole('group', { name: 'peers' })
    expect(within(list).getByText('пир a')).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: '+ Добавить' }))
    expect(ops.at(-1)).toEqual({ op: 'insert', path: ['outbounds', 0, 'peers'], index: 2, value: { address: '' } })
    await userEvent.click(within(list).getByRole('button', { name: 'Переместить элемент 2 выше' }))
    expect(ops.at(-1)).toEqual({ op: 'move', path: ['outbounds', 0, 'peers'], from: 1, to: 0 })
    await userEvent.click(within(list).getByRole('button', { name: 'Удалить элемент 1' }))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['outbounds', 0, 'peers', 0] })
  })

  it('карта строк пишет объект', async () => {
    const { ops, writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ headers: { Host: 'a' } }} path={PATH} writer={writer} />)
    const host = screen.getAllByPlaceholderText('Значение')[0]!
    await userEvent.type(host, 'b')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'headers'], value: { Host: 'ab' } })
  })
})

describe('SchemaForm: чтение вместо порчи', () => {
  it('неизвестный ключ виден на чтение и никогда не скрыт', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ mystery: { a: 1 } }} path={PATH} writer={writer} />)
    const field = screen.getByLabelText('mystery')
    expect(field).toHaveAttribute('readonly')
    expect(field).toHaveValue('{"a":1}')
    expect(screen.getByText(/неизвестен словарю/)).toBeInTheDocument()
  })

  it('значение не той формы показано на чтение с объяснением', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ tls: 'oops', tag: { x: 1 } }} path={PATH} writer={writer} />)
    expect(screen.getByLabelText('tag')).toHaveAttribute('readonly')
    expect(screen.getAllByText(/развёрнут|не той формы/i).length).toBeGreaterThan(0)
  })

  it('замок писателя показывает причину и запрещает правку', () => {
    const { writer } = makeWriter([{ path: ['outbounds', 0, 'tag'], reason: 'Заполняет панель.' }])
    render(<SchemaForm fields={FIELDS} value={{ tag: 'a' }} path={PATH} writer={writer} />)
    expect(screen.getByLabelText('tag')).toHaveAttribute('readonly')
    expect(screen.getByText('Заполняет панель.')).toBeInTheDocument()
  })

  it('устаревший ключ несёт подсказку с версией и заменой', () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={FIELDS} value={{ old: 'v' }} path={PATH} writer={writer} />)
    expect(screen.getByText(/1\.11\.0.*new/)).toBeInTheDocument()
  })

  it('ключ панели рисуется только по просьбе', () => {
    const { writer } = makeWriter()
    const { rerender } = render(<SchemaForm fields={FIELDS} value={{ remnawave: { includeProxies: false } }} path={PATH} writer={writer} />)
    expect(screen.queryByRole('button', { name: 'remnawave' })).toBeNull()
    rerender(<SchemaForm fields={FIELDS} value={{ remnawave: { includeProxies: false } }} path={PATH} writer={writer} showPanelKeys />)
    expect(screen.getByRole('button', { name: 'remnawave' })).toBeInTheDocument()
  })
})

// Список строк-ссылок (item.kind: 'string', item.ref задан) — теги другой записи документа
// (rule_set у sing-box правил, outbounds у групп и т.п.). Собственный список полей, не общий
// FIELDS: тот фиксирует счётчик «Ещё поля (N)» в других тестах, добавление сюда сдвинуло бы его.
const REF_LIST_FIELDS: FieldSchema[] = [
  { key: 'members', doc: 'Участники.', kind: 'list', item: { kind: 'string', ref: 'outbound' } },
]

describe('SchemaForm: список ссылок', () => {
  it('сквозной пропуск текущих тегов вне справочника, выбор дописывает в конец', async () => {
    const { ops, writer } = makeWriter()
    render(
      <SchemaForm
        fields={REF_LIST_FIELDS}
        value={{ members: ['b', 'zzz'] }}
        path={PATH}
        writer={writer}
        refs={{ outbound: ['a', 'b'] }}
      />,
    )
    const field = screen.getByText('members').closest<HTMLElement>('.field')!
    expect(within(field).getByRole('button', { name: 'a' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(field).getByRole('button', { name: 'b' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(field).getByRole('button', { name: 'zzz' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(within(field).getByRole('button', { name: 'a' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'members'], value: ['b', 'zzz', 'a'] })
  })

  it('без справочника и без значения — обычный текстовый список', async () => {
    const { writer } = makeWriter()
    render(<SchemaForm fields={REF_LIST_FIELDS} value={{}} path={PATH} writer={writer} />)
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    const field = screen.getByLabelText('members')
    expect(field.tagName).toBe('TEXTAREA')
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SingboxDnsServerForm } from '../src/features/inspector/SingboxDnsServerForm'
import { SingboxInboundForm } from '../src/features/inspector/SingboxInboundForm'
import { SingboxOutboundForm } from '../src/features/inspector/SingboxOutboundForm'
import { SingboxRuleForm } from '../src/features/inspector/SingboxRuleForm'
import { SingboxRuleSetForm } from '../src/features/inspector/SingboxRuleSetForm'
import { applyOps, valueAt, type DocOp, type SchemaPath } from '../src/shared/schema'
import { optionLabels, selectOption, selectedValue } from './helpers'
import { makeWriter } from './schemaHelpers'

const REFS = { outbound: ['direct', 'proxy'], inbound: [], 'dns-server': ['dns-local'], 'rule-set': [] }

/**
 * Прогоняет операции писателя так, как это делает приложение: не поверх
 * самого значения (пути в `ops` абсолютные, от корня документа), а поверх
 * документа, в котором это значение лежит по `path`, — и возвращает срез
 * обратно. Тест воспроизводит цикл «writer → документ → перерисовка формы
 * новым value», а не подделывает его локальным состоянием компонента.
 */
function applyAt<T>(value: T, path: SchemaPath, ops: DocOp[]): T {
  let doc: unknown = value
  for (let i = path.length - 1; i >= 0; i -= 1) {
    doc = typeof path[i] === 'number' ? [doc] : { [path[i]]: doc }
  }
  const next = applyOps(doc, ops)
  return valueAt(next, path) as T
}

describe('форма выхода sing-box', () => {
  it('у группы список участников показан на чтение, пока его заполняет панель', () => {
    const { writer } = makeWriter([{ path: ['outbounds', 0, 'outbounds'], reason: 'Список заполняет панель.' }])
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: null }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Участники (список заполняет панель)')).toHaveAttribute('readonly')
    expect(screen.getByText(/Панель перезапишет его целиком/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Участники')).toBeNull()
  })

  it('кнопка закрепления ставит ключ панели одной операцией', async () => {
    const { ops, writer } = makeWriter([{ path: ['outbounds', 0, 'outbounds'], reason: 'x' }])
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: null }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Закрепить список' }))
    expect(ops).toEqual([{ op: 'set', path: ['outbounds', 0, 'remnawave'], value: { includeProxies: false } }])
  })

  it('обратная кнопка снимает ключ целиком, а не ставит true', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: [], remnawave: { includeProxies: false } }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Открепить список' }))
    expect(ops).toEqual([{ op: 'remove', path: ['outbounds', 0, 'remnawave'] }])
  })

  it('закреплённая группа правит участников списком строк', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'selector', tag: 'g', outbounds: ['direct'], remnawave: { includeProxies: false } }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    // outbounds — в skip: без него SchemaForm нарисовал бы тот же список ещё раз своим полем `outbounds`
    expect(screen.queryByText('outbounds')).toBeNull()
    await userEvent.type(screen.getByLabelText('Участники'), '\nproxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'outbounds'], value: ['direct', 'proxy'] })
  })

  it('у сервера показаны адрес и порт, протокольные поля приходят из схемы', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'vless', tag: 's', server: '1.2.3.4', server_port: 443, uuid: 'u' }} path={['outbounds', 2]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Сервер')).toHaveValue('1.2.3.4')
    expect(screen.getByLabelText('Порт сервера')).toHaveValue('443')
    expect(screen.getByLabelText('uuid')).toHaveValue('u')
    expect(screen.queryByLabelText('Участники')).toBeNull()
    await userEvent.type(screen.getByLabelText('Сервер'), '5')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 2, 'server'], value: '1.2.3.45' })
    // tls, transport, multiplex и dial-поля — под «Ещё поля»: они не заполнены,
    // а `when` сам по себе наверх не поднимает (правило 1 — заполненность)
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    expect(screen.getByRole('button', { name: 'tls' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'transport' })).toBeInTheDocument()
  })

  it('смена типа — одна операция; удалённый тип остаётся выбранным и объяснён', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'block', tag: 'b' }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    expect(selectedValue('Тип')).toBe('block')
    expect(screen.getByText(/1\.13\.0/)).toBeInTheDocument()
    await selectOption('Тип', 'direct')
    expect(ops).toEqual([{ op: 'set', path: ['outbounds', 0, 'type'], value: 'direct' }])
  })

  it('устаревшие типы выхода не предлагаются заново', async () => {
    const { writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'direct', tag: 'd' }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    const labels = await optionLabels('Тип')
    expect(labels).not.toContain('block')
    expect(labels).not.toContain('dns')
    expect(labels).not.toContain('wireguard')
  })

  it('пустой тег уходит писателю как set с пустой строкой — отказ объясняет инспектор', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxOutboundForm value={{ type: 'direct', tag: 'd' }} path={['outbounds', 0]} writer={writer} refs={REFS} />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['outbounds', 0, 'tag'], value: '' })
  })

  it('конечная точка: типы wireguard/tailscale, пиры списком, полей сервера нет', async () => {
    const { ops, writer } = makeWriter()
    render(
      <SingboxOutboundForm value={{ type: 'wireguard', tag: 'wg', address: ['10.0.0.2/32'], peers: [{ public_key: 'k' }] }} path={['endpoints', 0]} writer={writer} refs={REFS} isEndpoint />,
    )
    expect(await optionLabels('Тип')).toEqual(['wireguard', 'tailscale'])
    expect(screen.queryByLabelText('Сервер')).toBeNull()
    expect(screen.getByRole('group', { name: 'peers' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
    expect(ops.at(-1)?.op).toBe('insert')
    expect(ops.at(-1)?.path).toEqual(['endpoints', 0, 'peers'])
  })
})

describe('форма правила sing-box', () => {
  const RULE_REFS = { outbound: ['direct', 'proxy'], inbound: ['tun-in'], 'dns-server': ['dns-local'], 'rule-set': ['ads'] }

  it('действие route показывает выход и пишет его одной операцией', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxRuleForm value={{ domain: ['a.com'], outbound: 'direct' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(selectedValue('Действие')).toBe('route')
    await selectOption('Выход', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'rules', 0, 'outbound'], value: 'proxy' })
  })

  it('смена действия на нетерминальное снимает выход', async () => {
    const { ops, writer } = makeWriter()
    const path: SchemaPath = ['route', 'rules', 0]
    const initial = { outbound: 'direct' }
    const { rerender } = render(<SingboxRuleForm value={initial} path={path} writer={writer} refs={RULE_REFS} />)
    await selectOption('Действие', 'sniff')
    expect(ops).toEqual([
      { op: 'set', path: ['route', 'rules', 0, 'action'], value: 'sniff' },
      { op: 'remove', path: ['route', 'rules', 0, 'outbound'] },
    ])
    // Форма — чистая функция value: поле не имеет права исчезнуть само по
    // себе сразу после клика (value ещё не изменился); проверяем результат
    // после того, как приложение прогонит те же операции через документ и
    // перерисует форму новым срезом — как это происходит на самом деле
    rerender(<SingboxRuleForm value={applyAt(initial, path, ops)} path={path} writer={writer} refs={RULE_REFS} />)
    expect(screen.queryByLabelText('Выход')).toBeNull()
    // И обратно: документ снова маршрутный — поле возвращается
    rerender(<SingboxRuleForm value={{ action: 'route', outbound: 'direct' }} path={path} writer={writer} refs={RULE_REFS} />)
    expect(screen.getByLabelText('Выход')).toBeInTheDocument()
  })

  it('поля действия приходят из схемы: у sniff — sniffer, у reject — method', async () => {
    const { writer } = makeWriter()
    const { rerender } = render(<SingboxRuleForm value={{ action: 'sniff' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    // Незаполненные поля схемы лежат под «Ещё поля» (правило 1 SchemaForm) — открываем крышку, как это делает тест формы выхода
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    expect(screen.getByText('sniffer')).toBeInTheDocument()
    rerender(<SingboxRuleForm value={{ action: 'reject' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(screen.getByText('method')).toBeInTheDocument()
  })

  it('порт назначения пишется числами, пустой список снимает ключ', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxRuleForm value={{ port: [443] }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    await userEvent.type(screen.getByLabelText('Порт назначения'), '\n80')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'rules', 0, 'port'], value: [443, 80] })
    await userEvent.clear(screen.getByLabelText('Порт назначения'))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['route', 'rules', 0, 'port'] })
  })

  it('домен-скаляр читается как список из одного элемента, правка пишет список', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxRuleForm value={{ domain: 'example.com' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(screen.getByLabelText('Домен (точное совпадение)')).toHaveValue('example.com')
    await userEvent.type(screen.getByLabelText('Домен (точное совпадение)'), '\nb.com')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'rules', 0, 'domain'], value: ['example.com', 'b.com'] })
  })

  it('наборы правил — чипы из документа плюс битая ссылка', async () => {
    const { writer } = makeWriter()
    render(<SingboxRuleForm value={{ rule_set: ['gone'] }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(screen.getByText('gone')).toBeInTheDocument()
    expect(screen.getByText('ads')).toBeInTheDocument()
  })

  it('незнакомое действие остаётся выбранным, а не сбрасывает селект в пустоту', () => {
    const { writer } = makeWriter()
    render(<SingboxRuleForm value={{ action: 'future' }} path={['route', 'rules', 0]} writer={writer} refs={RULE_REFS} />)
    expect(selectedValue('Действие')).toBe('future')
    // data-value отражает проп value всегда — сам факт, что «future» ЕСТЬ среди
    // вариантов (а не просто передан селекту молча), виден только в подписи:
    // без опции для текущего значения там осталось бы «Не выбрано» (как у
    // inbound-form.test.tsx для того же случая с протоколом)
    expect(screen.getByLabelText('Действие')).toHaveTextContent('future')
  })
})

describe('форма входа sing-box', () => {
  it('тег и тип руками, остальное по типу из схемы', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxInboundForm value={{ type: 'tun', tag: 'tun-in', auto_route: true }} path={['inbounds', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Тег')).toHaveValue('tun-in')
    expect(screen.queryByText('listen_port')).toBeNull()
    expect(screen.getByRole('button', { name: 'нет' })).toBeInTheDocument()
    await selectOption('Тип', 'mixed')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['inbounds', 0, 'type'], value: 'mixed' })
  })
})

describe('форма набора правил sing-box', () => {
  it('удалённый набор: ссылка и выход загрузки; встроенный — правила списком', async () => {
    const { ops, writer } = makeWriter()
    const { rerender } = render(<SingboxRuleSetForm value={{ type: 'remote', tag: 'ads', format: 'binary', url: 'u' }} path={['route', 'rule_set', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Ссылка')).toHaveValue('u')
    await selectOption('Скачивать через выход', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'rule_set', 0, 'download_detour'], value: 'proxy' })
    rerender(<SingboxRuleSetForm value={{ type: 'inline', tag: 'mine', rules: [{ domain: ['a'] }] }} path={['route', 'rule_set', 0]} writer={writer} refs={REFS} />)
    expect(screen.queryByLabelText('Ссылка')).toBeNull()
    // Внутри самого правила набора у логического правила своя вложенная rules —
    // тот же aria-label встречается дважды, интересует внешний список набора
    expect(screen.getAllByRole('group', { name: 'rules' })[0]).toBeInTheDocument()
    expect(screen.getByText('правило #1')).toBeInTheDocument()
  })
})

describe('форма DNS-сервера sing-box', () => {
  it('tls-сервер: адрес, выход и объект tls из схемы; legacy address виден с пометкой', async () => {
    const { ops, writer } = makeWriter()
    const { rerender } = render(<SingboxDnsServerForm value={{ type: 'tls', tag: 'r', server: '1.1.1.1' }} path={['dns', 'servers', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('Адрес')).toHaveValue('1.1.1.1')
    await selectOption('Через выход', 'proxy')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['dns', 'servers', 0, 'detour'], value: 'proxy' })
    rerender(<SingboxDnsServerForm value={{ tag: 'old', address: 'tls://1.1.1.1' }} path={['dns', 'servers', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('address')).toHaveValue('tls://1.1.1.1')
    expect(screen.getByText(/1\.12\.0/)).toBeInTheDocument()
    // Легаси-документ (без type) не знает про NET_SERVERS — ручное поле «Адрес» не рисуется само по себе
    expect(screen.queryByLabelText('Адрес')).toBeNull()
  })
})

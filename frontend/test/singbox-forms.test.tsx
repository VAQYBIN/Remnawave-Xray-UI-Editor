import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SingboxExtraFields } from '../src/features/inspector/SingboxExtraFields'
import { SingboxOutboundForm } from '../src/features/inspector/SingboxOutboundForm'
import { SingboxRuleForm } from '../src/features/inspector/SingboxRuleForm'
import { optionLabels, selectOption, selectedValue } from './helpers'
import { makeWriter } from './schemaHelpers'

const REFS = { outbound: ['direct', 'proxy'], inbound: [], 'dns-server': ['dns-local'], 'rule-set': [] }

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
  it('правит условие и не теряет незнакомые ключи', () => {
    const onChange = vi.fn()
    render(
      <SingboxRuleForm
        value={{ domain_suffix: ['a.com'], outbound: 'direct', brand_new: 1 }}
        outboundTags={['direct', 'proxy']}
        ruleSetTags={[]}
        onChange={onChange}
      />,
    )
    screen.getByLabelText('Суффикс домена')
    // Схема сквозная: ключ, которого форма не знает, обязан пережить правку
    expect(onChange).not.toHaveBeenCalled()
  })

  it('смена действия на reject убирает поле выхода', async () => {
    const onChange = vi.fn()
    render(
      <SingboxRuleForm
        value={{ domain: ['a.com'], outbound: 'direct' }}
        outboundTags={['direct']}
        ruleSetTags={[]}
        onChange={onChange}
      />,
    )
    await selectOption('Действие', 'reject')
    const next = onChange.mock.calls.at(-1)![0]
    expect(next.action).toBe('reject')
    // Ядро при action: reject поле outbound игнорирует, и держать его в
    // документе значит показывать связь, которой нет
    expect(next.outbound).toBeUndefined()
  })
})

describe('блок «Ещё поля»', () => {
  it('показывает незаполненные ключи секции и не дублирует заполненные', () => {
    render(
      <SingboxExtraFields
        section="route"
        value={{ final: 'direct' }}
        skip={['final', 'rules', 'rule_set']}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('final')).toBeNull()
    expect(screen.getByText(/Ещё поля/)).toBeInTheDocument()
  })

  it('составной ключ панели в список не попадает — его показывает своя форма', () => {
    // Тест плана проверял это на секции route, где составных ключей нет вовсе;
    // единственный такой ключ живёт в group, поэтому проверка стоит здесь
    render(<SingboxExtraFields section="group" value={{}} skip={['outbounds']} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Ещё поля (5)' })).toBeInTheDocument()
  })

  it('значение, которое форма выразить не может, показано на чтение с причиной', () => {
    render(
      <SingboxExtraFields
        section="route"
        value={{ default_domain_resolver: { server: 'dns-local' } }}
        skip={[]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/вкладке JSON/i)).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SingboxExtraFields } from '../src/features/inspector/SingboxExtraFields'
import { SingboxOutboundForm } from '../src/features/inspector/SingboxOutboundForm'
import { SingboxRuleForm } from '../src/features/inspector/SingboxRuleForm'
import { optionLabels, selectOption, selectedValue } from './helpers'

describe('форма выхода sing-box', () => {
  it('у группы список участников показан на чтение, пока его заполняет панель', () => {
    const onChange = vi.fn()
    render(
      <SingboxOutboundForm
        value={{ type: 'selector', tag: 'g', outbounds: null }}
        knownTags={['direct']}
        onChange={onChange}
      />,
    )
    // `\S`, а не `\w` из брифа: JS-класс `\w` — это [A-Za-z0-9_], и по-русски
    // такой шаблон не совпал бы ни с каким текстом вообще
    expect(screen.getByText(/заполн\S+ панел/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Участники')).toBeNull()
  })

  it('кнопка закрепления ставит ключ панели и открывает список', async () => {
    const onChange = vi.fn()
    render(
      <SingboxOutboundForm
        value={{ type: 'selector', tag: 'g', outbounds: null }}
        knownTags={['direct']}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /закрепить/i }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ remnawave: { includeProxies: false } }),
    )
  })

  it('обратная кнопка снимает ключ целиком, а не ставит true', () => {
    // includeProxies: true — не «как было»: осмысленное значение у ключа ровно
    // одно, и оставлять его в документе значит хранить след правки
    const onChange = vi.fn()
    render(
      <SingboxOutboundForm
        value={{ type: 'selector', tag: 'g', outbounds: [], remnawave: { includeProxies: false } }}
        knownTags={['direct']}
        onChange={onChange}
      />,
    )
    screen.getByRole('button', { name: /открепить/i }).click()
    expect(onChange).toHaveBeenCalledWith(expect.not.objectContaining({ remnawave: expect.anything() }))
  })

  it('у сервера показаны адрес и порт, а списка участников нет', () => {
    render(
      <SingboxOutboundForm
        value={{ type: 'shadowsocks', tag: 's', server: '1.2.3.4', server_port: 443 }}
        knownTags={[]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Сервер')).toHaveValue('1.2.3.4')
    expect(screen.queryByText(/заполн\S+ панел/i)).toBeNull()
  })

  it('удалённый в 1.13 тип остаётся выбранным и объяснён', async () => {
    // Словарь такой тип больше не предлагает, но в чужом шаблоне он уже стоит:
    // выпади он из списка — открытие любого другого варианта показало бы выбор,
    // которого в списке нет, а сам тип потерялся бы при первой же правке
    render(
      <SingboxOutboundForm
        value={{ type: 'block', tag: 'block' }}
        knownTags={[]}
        onChange={vi.fn()}
      />,
    )
    expect(selectedValue('Тип')).toBe('block')
    expect(await optionLabels('Тип')).toContain('block')
    expect(screen.getByText(/удал[её]н.*1\.13/i)).toBeInTheDocument()
    expect(screen.getByText(/reject/)).toBeInTheDocument()
  })

  it('у живого типа подсказки про удаление нет', () => {
    render(
      <SingboxOutboundForm value={{ type: 'direct', tag: 'direct' }} knownTags={[]} onChange={vi.fn()} />,
    )
    expect(screen.queryByText(/удал[её]н.*1\.13/i)).toBeNull()
  })

  it('у конечной точки свои типы, а полей сервера нет', async () => {
    // Запись лежит в endpoints: адрес там задаётся пирами, а тип vless ядро в
    // этом списке не примет вовсе
    render(
      <SingboxOutboundForm
        value={{ type: 'wireguard', tag: 'wg' }}
        knownTags={[]}
        isEndpoint
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/конечная точка/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Сервер')).toBeNull()
    expect(screen.queryByLabelText('Порт сервера')).toBeNull()
    // Тег правится по-прежнему: узел на холсте адресуется именно им
    expect(screen.getByLabelText('Тег')).toHaveValue('wg')
    const options = await optionLabels('Тип')
    expect(options).toEqual(['wireguard', 'tailscale'])
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

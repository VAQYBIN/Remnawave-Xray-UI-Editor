import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SingboxExtraFields } from '../src/features/inspector/SingboxExtraFields'
import { SingboxOutboundForm } from '../src/features/inspector/SingboxOutboundForm'
import { SingboxRuleForm } from '../src/features/inspector/SingboxRuleForm'
import { selectOption } from './helpers'

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

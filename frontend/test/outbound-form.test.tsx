import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OutboundForm, WARP_TEMPLATE } from '../src/features/inspector/OutboundForm'

describe('OutboundForm', () => {
  it('freedom: смена domainStrategy, посторонние поля сохраняются', async () => {
    const onChange = vi.fn()
    render(
      <OutboundForm value={{ tag: 'direct', protocol: 'freedom', settings: {}, custom: 1 }} onChange={onChange} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Стратегия доменов'), 'UseIP')
    expect(onChange).toHaveBeenLastCalledWith({
      tag: 'direct',
      protocol: 'freedom',
      settings: { domainStrategy: 'UseIP' },
      custom: 1,
    })
  })

  it('wireguard: кнопка WARP заполняет шаблон', async () => {
    const onChange = vi.fn()
    render(<OutboundForm value={{ tag: 'warp', protocol: 'wireguard' }} onChange={onChange} />)
    await userEvent.click(screen.getByText('Заполнить шаблон WARP'))
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'warp', protocol: 'wireguard', settings: WARP_TEMPLATE })
  })

  it('wireguard: правка publicKey пира не трогает остальное', async () => {
    const onChange = vi.fn()
    render(
      <OutboundForm
        value={{
          tag: 'warp',
          protocol: 'wireguard',
          settings: { secretKey: 'sk', peers: [{ publicKey: 'pk', endpoint: 'e:1', keepAlive: 25 }] },
        }}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Публичный ключ пира'), 'X')
    const next = onChange.mock.lastCall![0] as { settings: { peers: Record<string, unknown>[] } }
    expect(next.settings.peers[0]).toEqual({ publicKey: 'pkX', endpoint: 'e:1', keepAlive: 25 })
  })

  it('для socks показывает подсказку про JSON', () => {
    render(<OutboundForm value={{ tag: 's', protocol: 'socks' }} onChange={vi.fn()} />)
    expect(screen.getByText(/редактируются на вкладке JSON/)).toBeInTheDocument()
  })
})

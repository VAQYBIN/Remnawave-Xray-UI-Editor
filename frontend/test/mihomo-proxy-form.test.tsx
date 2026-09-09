import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MihomoProxyForm } from '../src/features/inspector/MihomoProxyForm'
import { makeWriter } from './schemaHelpers'

describe('MihomoProxyForm', () => {
  it('тип меняет набор полей: у vless есть uuid, у direct — нет server', async () => {
    const { writer } = makeWriter()
    const { rerender } = render(<MihomoProxyForm value={{ name: 's', type: 'direct' }} path={['proxies', 0]} writer={writer} refs={{}} name="s" onRename={() => null} />)
    expect(screen.queryByLabelText('server')).toBeNull()
    rerender(<MihomoProxyForm value={{ name: 's', type: 'vless', server: 'h', port: 443, uuid: 'u' }} path={['proxies', 0]} writer={writer} refs={{}} name="s" onRename={() => null} />)
    expect(screen.getByLabelText('server')).toHaveValue('h')
    expect(screen.getByLabelText('uuid')).toHaveValue('u')
  })

  it('замок с действием у значения-ссылки', async () => {
    const { writer } = makeWriter([{ path: ['proxies', 0, 'server'], reason: 'Через якорь.' }])
    render(<MihomoProxyForm value={{ name: 's', type: 'socks5', server: 'h' }} path={['proxies', 0]} writer={writer} refs={{}} name="s" onRename={() => null} />)
    expect(screen.getByText('Через якорь.')).toBeInTheDocument()
  })
})

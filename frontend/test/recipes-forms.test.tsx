import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ChainForm } from '../src/features/recipes/forms/ChainForm'
import { TorrentForm } from '../src/features/recipes/forms/TorrentForm'
import { CHAIN_DEFAULTS, TORRENT_DEFAULTS, type ChainParams } from '../src/entities/xray'
import { selectOption } from './helpers'

// Контролируемые поля требуют stateful-обёртки: без неё userEvent.type теряет символы
function ChainHarness({ onValue }: { onValue: (v: ChainParams) => void }) {
  const [value, setValue] = useState<ChainParams>(CHAIN_DEFAULTS)
  return (
    <ChainForm
      value={value}
      outboundTags={['direct', 'block']}
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

describe('ChainForm', () => {
  it('адрес и протокол уходят наверх', async () => {
    const onValue = vi.fn()
    render(<ChainHarness onValue={onValue} />)

    await userEvent.type(screen.getByLabelText('Адрес сервера'), 'node2.example.com')
    expect(onValue.mock.calls.at(-1)![0].address).toBe('node2.example.com')

    await selectOption('Протокол', 'trojan')
    expect(onValue.mock.calls.at(-1)![0].protocol).toBe('trojan')
  })

  it('поля протокола переключаются: у trojan — пароль, у vless — UUID', async () => {
    const onValue = vi.fn()
    render(<ChainHarness onValue={onValue} />)
    expect(screen.getByLabelText('UUID пользователя')).toBeInTheDocument()
    await selectOption('Протокол', 'trojan')
    expect(screen.queryByLabelText('UUID пользователя')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument()
  })
})

describe('TorrentForm', () => {
  it('пустой выбор inbound’ов подписан как «все»', () => {
    render(
      <TorrentForm value={TORRENT_DEFAULTS} inboundTags={['vless-in', 'ss-in']} onChange={() => {}} />,
    )
    expect(screen.getByText(/пусто — все/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'vless-in' })).toBeInTheDocument()
  })
})

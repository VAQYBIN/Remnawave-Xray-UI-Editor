import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ClientsEditor } from '../src/features/inspector/ClientsEditor'

describe('ClientsEditor', () => {
  it('vless: выбор flow добавляет поле, пустой flow удаляет ключ', async () => {
    const onChange = vi.fn()
    render(
      <ClientsEditor
        protocol="vless"
        clients={[{ id: 'u-1', email: 'a@b', extra: 42 }]}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'xtls-rprx-vision')
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'u-1', email: 'a@b', extra: 42, flow: 'xtls-rprx-vision' },
    ])
  })

  it('vless: сброс flow в «нет» удаляет ключ, неизвестные поля сохраняются', async () => {
    const onChange = vi.fn()
    render(
      <ClientsEditor
        protocol="vless"
        clients={[{ id: 'u-1', flow: 'xtls-rprx-vision', extra: 42 }]}
        onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Flow'), '')
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'u-1', extra: 42 }])
  })

  it('добавляет клиента с готовым UUID (vless)', async () => {
    const onChange = vi.fn()
    render(<ClientsEditor protocol="vless" clients={[]} onChange={onChange} />)
    await userEvent.click(screen.getByText('+ Клиент'))
    const arg = onChange.mock.calls[0]![0] as Record<string, unknown>[]
    expect(arg).toHaveLength(1)
    expect(arg[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('удаляет клиента', async () => {
    const onChange = vi.fn()
    render(
      <ClientsEditor protocol="trojan" clients={[{ password: 'p1' }, { password: 'p2' }]} onChange={onChange} />,
    )
    await userEvent.click(screen.getByLabelText('Удалить клиента 1'))
    expect(onChange).toHaveBeenCalledWith([{ password: 'p2' }])
  })

  it('trojan: показывает поле пароля', () => {
    render(<ClientsEditor protocol="trojan" clients={[{ password: 'p1' }]} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Пароль')).toHaveValue('p1')
  })
})

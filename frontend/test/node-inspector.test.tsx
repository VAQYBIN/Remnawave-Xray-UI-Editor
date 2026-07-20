import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NodeInspector } from '../src/features/topology/NodeInspector'

const config = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless' }],
  outbounds: [],
}

describe('NodeInspector', () => {
  it('показывает JSON выбранного узла', () => {
    render(
      <NodeInspector config={config} nodeId="in:vless-in" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByText('in:vless-in')).toBeInTheDocument()
  })

  it('кнопка «Удалить узел» запрашивает подтверждение и вызывает onRemove', async () => {
    const onRemove = vi.fn()
    render(
      <NodeInspector config={config} nodeId="in:vless-in" onApply={() => {}} onRemove={onRemove} onClose={() => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Удалить узел' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})

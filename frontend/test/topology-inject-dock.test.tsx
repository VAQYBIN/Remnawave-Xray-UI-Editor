import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { TopologyView } from '../src/features/topology/TopologyView'
import { XrayConfigSchema } from '../src/entities/xray/config'

const config = XrayConfigSchema.parse({
  inbounds: [{ tag: 'socks', port: 1080, protocol: 'socks', settings: {} }],
  outbounds: [{ tag: 'direct', protocol: 'freedom' }],
  routing: { rules: [] },
})

function renderDock(allowInject?: boolean) {
  const onChangeConfig = vi.fn()
  render(
    <ReactFlowProvider>
      <TopologyView
        docKey="profile:doc"
        config={config}
        ctx={{}}
        selectedId={null}
        onSelect={() => {}}
        onChangeConfig={onChangeConfig}
        allowInject={allowInject}
      />
    </ReactFlowProvider>,
  )
  return onChangeConfig
}

describe('кнопка «+ Подстановка» в доке холста', () => {
  // Секции remnawave в конфиге профиля нет — кнопке там нечего делать
  it('без allowInject кнопки нет, остальные на месте', () => {
    renderDock()
    expect(screen.queryByRole('button', { name: '+ Подстановка' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Балансер' })).toBeInTheDocument()
  })

  it('с allowInject кнопка появляется и заводит первую группу', async () => {
    const user = userEvent.setup()
    const onChangeConfig = renderDock(true)
    await user.click(screen.getByRole('button', { name: '+ Подстановка' }))
    const next = onChangeConfig.mock.calls[0]![0]
    expect(next.remnawave?.injectHosts).toHaveLength(1)
    expect(next).not.toBe(config)
    expect(config.remnawave).toBeUndefined()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NodeInspector } from '../src/features/topology/NodeInspector'

// jsdom не реализует layout, поэтому у Range нет getClientRects/getBoundingClientRect —
// CodeMirror вызывает их асинхронно (rAF) после фокуса/выделения, что валит процесс
// необработанным исключением уже после завершения теста. Заглушки решают только это.
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }) as DOMRect
}

// Вкладка «Форма» для in:/out: узлов рендерит InboundForm/OutboundForm → StreamForm,
// которому нужен react-query context (useRealityKeypair/useRealityPublicKey)
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const config = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless' }],
  outbounds: [],
}

// CodeMirror в jsdom не поддерживает реальный ввод в contenteditable — правим документ через
// его собственную команду «выделить всё» (не зависит от нативного выделения в jsdom) и paste-событие,
// которое CodeMirror обрабатывает напрямую через clipboardData.
async function setNodeJsonText(text: string) {
  const content = document.querySelector('.cm-content') as HTMLElement
  content.focus()
  await userEvent.keyboard('{Control>}a{/Control}')
  fireEvent.paste(content, { clipboardData: { getData: () => text } })
}

describe('NodeInspector', () => {
  it('показывает JSON выбранного узла', () => {
    wrap(
      <NodeInspector config={config} nodeId="in:vless-in" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByText('in:vless-in')).toBeInTheDocument()
  })

  it('кнопка «Удалить узел» запрашивает подтверждение и вызывает onRemove', async () => {
    const onRemove = vi.fn()
    wrap(
      <NodeInspector config={config} nodeId="in:vless-in" onApply={() => {}} onRemove={onRemove} onClose={() => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Удалить узел' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('для in:/out: узлов по умолчанию открыта вкладка «Форма»', () => {
    wrap(
      <NodeInspector config={config} nodeId="in:vless-in" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByLabelText('Тег')).toBeInTheDocument()
    expect(screen.queryByText('Форма')).toBeInTheDocument()
    expect(screen.queryByText('JSON узла')).toBeInTheDocument()
  })

  it('для rule:/dns узлов вкладок нет — сразу JSON', () => {
    const dnsConfig = { ...config, dns: { servers: ['8.8.8.8'] } }
    wrap(
      <NodeInspector config={dnsConfig} nodeId="dns" onApply={() => {}} onRemove={() => {}} onClose={() => {}} />,
    )
    expect(screen.queryByText('Форма')).not.toBeInTheDocument()
    expect(screen.queryByText('JSON узла')).not.toBeInTheDocument()
    expect(document.querySelector('.cm-content')).toBeInTheDocument()
  })

  it('отклоняет не-объект: «Применить» показывает ошибку и не вызывает onApply', async () => {
    const onApply = vi.fn()
    wrap(
      <NodeInspector config={config} nodeId="in:vless-in" onApply={onApply} onRemove={() => {}} onClose={() => {}} />,
    )
    await userEvent.click(screen.getByText('JSON узла'))
    await setNodeJsonText('123')
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText('Узел должен быть JSON-объектом')).toBeInTheDocument()
  })

  it('смена тега inbound со сквадами требует подтверждения', async () => {
    const onApply = vi.fn()
    wrap(
      <NodeInspector
        config={config}
        nodeId="in:vless-in"
        inboundSquads={{ 'vless-in': ['squad-1'] }}
        onApply={onApply}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByText('JSON узла'))
    await setNodeJsonText(JSON.stringify({ tag: 'renamed', port: 443, protocol: 'vless' }))
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText('Смена тега inbound')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Сменить тег' }))
    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply).toHaveBeenCalledWith({ tag: 'renamed', port: 443, protocol: 'vless' })
  })

  it('смена тега без сквадов применяется без подтверждения', async () => {
    const onApply = vi.fn()
    wrap(
      <NodeInspector
        config={config}
        nodeId="in:vless-in"
        inboundSquads={{}}
        onApply={onApply}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByText('JSON узла'))
    await setNodeJsonText(JSON.stringify({ tag: 'renamed', port: 443, protocol: 'vless' }))
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(onApply).toHaveBeenCalledWith({ tag: 'renamed', port: 443, protocol: 'vless' })
  })
})

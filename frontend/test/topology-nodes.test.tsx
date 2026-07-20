import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { nodeTypes } from '../src/features/topology/nodes'

const InboundNode = nodeTypes.inbound
const OutboundNode = nodeTypes.outbound
const RuleNode = nodeTypes.rule

function wrap(ui: React.ReactNode) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('узлы топологии', () => {
  it('inbound показывает тег, порт и security', () => {
    wrap(
      <InboundNode
        data={{ kind: 'inbound', index: 0, tag: 'vless-in', protocol: 'vless', port: 443, network: 'tcp', security: 'reality', squadsCount: 2 }}
        selected={false}
      />,
    )
    expect(screen.getByText('vless-in')).toBeInTheDocument()
    expect(screen.getByText(':443')).toBeInTheDocument()
    expect(screen.getByText('reality')).toBeInTheDocument()
    expect(screen.getByText('сквадов: 2')).toBeInTheDocument()
  })

  it('outbound с isDefault показывает бейдж default', () => {
    wrap(
      <OutboundNode
        data={{ kind: 'outbound', index: 0, tag: 'direct', protocol: 'freedom', isDefault: true }}
        selected={false}
      />,
    )
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('rule показывает summary и «все inbound»', () => {
    wrap(
      <RuleNode
        data={{ kind: 'rule', index: 1, summary: ['домены: 3'], allInbounds: true }}
        selected={false}
      />,
    )
    expect(screen.getByText('домены: 3')).toBeInTheDocument()
    expect(screen.getByText('все inbound')).toBeInTheDocument()
  })
})

import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { nodeTypes } from '../src/features/topology/nodes'
import { edgeHues, isDashedEdge } from '../src/features/topology/edges'
import type {
  BalancerNodeData, InboundNodeData, ObservatoryNodeData, OutboundNodeData, RuleNodeData,
} from '../src/entities/graph/types'

const InboundNode = nodeTypes.inbound as unknown as ComponentType<{ data: InboundNodeData; selected?: boolean }>
const OutboundNode = nodeTypes.outbound as unknown as ComponentType<{ data: OutboundNodeData; selected?: boolean }>
const RuleNode = nodeTypes.rule as unknown as ComponentType<{ data: RuleNodeData; selected?: boolean }>

function wrap(ui: React.ReactNode) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('узлы топологии', () => {
  it('inbound показывает тег, порт и security', () => {
    wrap(
      <InboundNode
        data={{ kind: 'inbound' as const, index: 0, tag: 'vless-in', protocol: 'vless', port: 443, network: 'tcp', security: 'reality', squadsCount: 2 }}
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
        data={{ kind: 'outbound' as const, index: 0, tag: 'direct', protocol: 'freedom', isDefault: true }}
        selected={false}
      />,
    )
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('rule показывает summary и «все inbound»', () => {
    wrap(
      <RuleNode
        data={{ kind: 'rule' as const, index: 1, summary: ['домены: 3'], allInbounds: true }}
        selected={false}
      />,
    )
    expect(screen.getByText('домены: 3')).toBeInTheDocument()
    expect(screen.getByText('все inbound')).toBeInTheDocument()
  })
})

describe('узел правила: вердикт трассировки', () => {
  it('rule показывает вердикт трассировки', () => {
    wrap(
      <RuleNode
        data={{ kind: 'rule' as const, index: 0, summary: [], allInbounds: true, traceState: 'winner' }}
        selected={false}
      />,
    )
    expect(screen.getByText('маршрут')).toBeInTheDocument()
  })

  it('rule без трассировки вердикт не показывает', () => {
    wrap(
      <RuleNode
        data={{ kind: 'rule' as const, index: 0, summary: [], allInbounds: true }}
        selected={false}
      />,
    )
    expect(screen.queryByText('маршрут')).not.toBeInTheDocument()
  })
})

const BalancerNode = nodeTypes.balancer as unknown as ComponentType<{ data: BalancerNodeData; selected?: boolean }>
const ObservatoryNode = nodeTypes.observatory as unknown as ComponentType<{ data: ObservatoryNodeData; selected?: boolean }>

describe('узлы балансера и обсерватории', () => {
  it('узел балансера показывает стратегию и число кандидатов', () => {
    wrap(
      <BalancerNode
        data={{ kind: 'balancer' as const, index: 0, tag: 'bal-eu', strategy: 'leastPing', candidates: 2 }}
        selected={false}
      />,
    )
    expect(screen.getByText('bal-eu')).toBeInTheDocument()
    expect(screen.getByText('leastPing')).toBeInTheDocument()
    expect(screen.getByText('кандидатов: 2')).toBeInTheDocument()
  })

  it('балансер без стратегии показывает подразумеваемый random', () => {
    wrap(<BalancerNode data={{ kind: 'balancer' as const, index: 0, tag: 'b', candidates: 0 }} selected={false} />)
    expect(screen.getByText('random')).toBeInTheDocument()
  })

  it('узел обсерватории показывает включённые секции', () => {
    wrap(
      <ObservatoryNode
        data={{ kind: 'observatory' as const, hasObservatory: true, hasBurst: false, subjectsCount: 1 }}
        selected={false}
      />,
    )
    expect(screen.getByText('observatory')).toBeInTheDocument()
    expect(screen.getByText('целей: 1')).toBeInTheDocument()
  })
})

describe('кабели балансеров', () => {
  it('правило → балансер стальной, балансер → выход уходит в янтарь', () => {
    expect(edgeHues('e:rule:0->bal:bal-eu')).toEqual(['var(--cable-steel)', 'var(--cable-steel)'])
    expect(edgeHues('e:bal:bal-eu->out:proxy-de')).toEqual(['var(--cable-steel)', 'var(--ember)'])
  })

  it('fallback и зависимость обсерватории рисуются пунктиром', () => {
    expect(isDashedEdge('e:bal:bal-eu->fb:direct')).toBe(true)
    expect(isDashedEdge('e:obs->bal:bal-eu')).toBe(true)
    expect(isDashedEdge('e:bal:bal-eu->out:proxy-de')).toBe(false)
  })
})

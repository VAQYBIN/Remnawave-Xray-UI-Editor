import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Chip } from '../../shared/ui'
import type {
  DnsNodeData, InboundNodeData, OutboundNodeData, RuleNodeData, SquadNodeData,
} from '../../entities/graph/types'

function frame(kind: string, selected: boolean | undefined): string {
  return [
    'fnode',
    kind === 'inbound' ? 'fnode-in' : '',
    kind === 'outbound' ? 'fnode-out' : '',
    selected ? 'fnode-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function InboundNode({ data, selected }: { data: InboundNodeData; selected?: boolean }) {
  return (
    <div className={frame('inbound', selected)}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-title">{data.tag}</div>
      <div className="fnode-sub">{data.protocol}</div>
      <div className="row-wrap">
        {data.port != null && <Chip dir="in">:{String(data.port)}</Chip>}
        {data.network && <Chip dir="none">{data.network}</Chip>}
        {data.security && data.security !== 'none' && <Chip dir="in">{data.security}</Chip>}
      </div>
      {(data.squadsCount ?? 0) > 0 && <div className="fnode-rows">сквадов: {data.squadsCount}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function OutboundNode({ data, selected }: { data: OutboundNodeData; selected?: boolean }) {
  return (
    <div className={frame('outbound', selected)}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-title">{data.tag}</div>
      <div className="fnode-sub">{data.protocol}</div>
      {data.isDefault && <Chip dir="none">default</Chip>}
    </div>
  )
}

function RuleNode({ data, selected }: { data: RuleNodeData; selected?: boolean }) {
  return (
    <div className={frame('rule', selected)}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-title">правило #{data.index + 1}</div>
      <div className="fnode-rows">
        {data.allInbounds && <span>все inbound</span>}
        {data.summary.map((s, i) => (
          <span key={i}>{s}</span>
        ))}
        {data.summary.length === 0 && !data.allInbounds && <span className="muted">без условий</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function DnsNode({ data, selected }: { data: DnsNodeData; selected?: boolean }) {
  return (
    <div className={frame('dns', selected)}>
      <div className="fnode-title">DNS</div>
      <div className="fnode-sub">серверов: {data.serversCount}</div>
    </div>
  )
}

function SquadNode({ data, selected }: { data: SquadNodeData; selected?: boolean }) {
  return (
    <div className={frame('squad', selected)}>
      <div className="fnode-title">{data.name}</div>
      <div className="fnode-sub">сквад</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const nodeTypes = {
  inbound: InboundNode,
  outbound: OutboundNode,
  rule: RuleNode,
  dns: DnsNode,
  squad: SquadNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>

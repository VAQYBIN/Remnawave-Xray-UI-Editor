import { Handle, Position, type NodeProps } from '@xyflow/react'
import type {
  DnsNodeData, InboundNodeData, OutboundNodeData, RuleNodeData, SquadNodeData,
} from '../../entities/graph/types'

function frame(kind: string, selected: boolean | undefined): string {
  return [
    'fnode',
    kind === 'inbound' ? 'fnode-in' : '',
    kind === 'outbound' ? 'fnode-out' : '',
    kind === 'squad' ? 'fnode-squad' : '',
    selected ? 'fnode-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Ячейка приборного ряда: одна строка целиком, без разбивки на ключ/значение */
function Metric({ children, accent }: { children: string; accent?: boolean }) {
  return <span className={accent ? 'fnode-metric fnode-metric-accent' : 'fnode-metric'}>{children}</span>
}

function InboundNode({ data, selected }: { data: InboundNodeData; selected?: boolean }) {
  const squads = data.squadsCount ?? 0
  return (
    <div className={frame('inbound', selected)}>
      {/* Рёбра «сквад → inbound» приходят из панели: гнездо нужно только как якорь */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.protocol}</span>
      </div>
      <div className="fnode-title">{data.tag}</div>
      <div className="fnode-metrics">
        {data.port != null && <Metric accent>{`:${data.port}`}</Metric>}
        {data.network && <Metric>{data.network}</Metric>}
        {data.security && data.security !== 'none' && <Metric accent>{data.security}</Metric>}
        {squads > 0 && <Metric>{`сквадов: ${squads}`}</Metric>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function OutboundNode({ data, selected }: { data: OutboundNodeData; selected?: boolean }) {
  return (
    <div className={frame('outbound', selected)}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.protocol}</span>
        <span className="spacer" />
        {data.isDefault && <span className="fnode-flag">default</span>}
      </div>
      <div className="fnode-title">{data.tag}</div>
    </div>
  )
}

function RuleNode({ data, selected }: { data: RuleNodeData; selected?: boolean }) {
  const empty = data.summary.length === 0 && !data.allInbounds
  return (
    <div className={frame('rule', selected)}>
      <Handle type="target" position={Position.Left} />
      {/* Правила срабатывают сверху вниз — номер несёт порядок, а не украшает */}
      <span className="fnode-priority" aria-hidden="true">
        {data.index + 1}
      </span>
      <div className="fnode-head">
        <span className="fnode-kind">правило</span>
      </div>
      <div className="fnode-conds">
        {data.allInbounds && <span className="fnode-cond fnode-cond-all">все inbound</span>}
        {data.summary.map((s, i) => (
          <span key={i} className="fnode-cond">
            {s}
          </span>
        ))}
        {empty && <span className="fnode-cond">без условий</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function DnsNode({ data, selected }: { data: DnsNodeData; selected?: boolean }) {
  return (
    <div className={frame('dns', selected)}>
      <div className="fnode-head">
        <span className="fnode-kind">резолвер</span>
      </div>
      <div className="fnode-title">DNS</div>
      <div className="fnode-metrics">
        <Metric>{`серверов: ${data.serversCount}`}</Metric>
      </div>
    </div>
  )
}

function SquadNode({ data, selected }: { data: SquadNodeData; selected?: boolean }) {
  return (
    <div className={frame('squad', selected)}>
      <div className="fnode-head">
        <span className="fnode-kind">сквад</span>
      </div>
      <div className="fnode-title">{data.name}</div>
      {/* Привязку сквадов задаёт панель Remnawave, не редактор — гнездо не коммутируется */}
      <Handle type="source" position={Position.Right} isConnectable={false} />
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

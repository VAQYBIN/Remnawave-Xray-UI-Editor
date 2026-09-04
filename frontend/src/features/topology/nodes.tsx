import { Handle, Position, type NodeProps } from '@xyflow/react'
import type {
  BalancerNodeData, DnsNodeData, InboundNodeData, InjectNodeData, IssueCount, ObservatoryNodeData,
  OutboundNodeData, RuleNodeData, SquadNodeData,
} from '../../entities/graph/types'

function frame(kind: string, selected: boolean | undefined): string {
  return [
    'fnode',
    kind === 'inbound' ? 'fnode-in' : '',
    kind === 'outbound' ? 'fnode-out' : '',
    kind === 'squad' ? 'fnode-squad' : '',
    kind === 'balancer' ? 'fnode-bal' : '',
    kind === 'inject' ? 'fnode-inj' : '',
    selected ? 'fnode-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// Узлы появляются волной слева направо — в порядке движения сигнала по патчбею.
// Задержку отдаём CSS-переменной, саму анимацию держит .fnode в tokens.css.
const ENTER_DELAY: Record<string, number> = {
  squad: 0, inbound: 70, dns: 70, rule: 140, balancer: 210, observatory: 210, outbound: 280, inject: 280,
}
function enter(kind: string): React.CSSProperties {
  return { '--enter-delay': `${ENTER_DELAY[kind] ?? 0}ms` } as React.CSSProperties
}

/** Значок проблем: текст лежит в статус-баре, поэтому здесь только счёт */
function IssueBadge({ count }: { count?: IssueCount }) {
  if (!count) return null
  const total = count.errors + count.warnings
  if (total === 0) return null
  const error = count.errors > 0
  return (
    <span
      className={`node-issue node-issue-${error ? 'error' : 'warn'}`}
      aria-label={
        error ? `проблем: ${total}, из них ошибок: ${count.errors}` : `предупреждений: ${total}`
      }
    >
      {error ? '!' : '?'}
      {total > 1 ? ` ${total}` : ''}
    </span>
  )
}

/** Ячейка приборного ряда: одна строка целиком, без разбивки на ключ/значение */
function Metric({ children, accent }: { children: string; accent?: boolean }) {
  return <span className={accent ? 'metric metric-accent' : 'metric'}>{children}</span>
}

function InboundNode({ data, selected }: { data: InboundNodeData; selected?: boolean }) {
  const squads = data.squadsCount ?? 0
  return (
    <div className={frame('inbound', selected)} style={enter('inbound')}>
      {/* Рёбра «сквад → inbound» приходят из панели: гнездо нужно только как якорь */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.protocol}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.tag}</div>
      <div className="metrics">
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
    <div className={frame('outbound', selected)} style={enter('outbound')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.protocol}</span>
        <span className="spacer" />
        {data.isDefault && <span className="fnode-flag">default</span>}
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.tag}</div>
    </div>
  )
}

function RuleNode({ data, selected }: { data: RuleNodeData; selected?: boolean }) {
  const empty = data.summary.length === 0 && !data.allInbounds
  return (
    <div className={frame('rule', selected)} style={enter('rule')}>
      <Handle type="target" position={Position.Left} />
      {/* Правила срабатывают сверху вниз — номер несёт порядок, а не украшает */}
      <span className="fnode-priority" aria-hidden="true">
        {data.index + 1}
      </span>
      <div className="fnode-head">
        <span className="fnode-kind">правило</span>
        <IssueBadge count={data.issueCount} />
      </div>
      {data.traceState && (
        <span className={`trace-badge trace-badge-${data.traceState}`}>
          {data.traceState === 'winner'
            ? 'маршрут'
            : data.traceState === 'yes'
              ? 'совпало'
              : data.traceState === 'no'
                ? 'не совпало'
                : 'нет данных'}
        </span>
      )}
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
    <div className={frame('dns', selected)} style={enter('dns')}>
      <div className="fnode-head">
        <span className="fnode-kind">резолвер</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">DNS</div>
      <div className="metrics">
        <Metric>{`серверов: ${data.serversCount}`}</Metric>
      </div>
    </div>
  )
}

function SquadNode({ data, selected }: { data: SquadNodeData; selected?: boolean }) {
  return (
    <div className={frame('squad', selected)} style={enter('squad')}>
      <div className="fnode-head">
        <span className="fnode-kind">сквад</span>
      </div>
      <div className="fnode-title">{data.name}</div>
      {/* Привязку сквадов задаёт панель Remnawave, не редактор — гнездо не коммутируется */}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function BalancerNode({ data, selected }: { data: BalancerNodeData; selected?: boolean }) {
  return (
    <div className={frame('balancer', selected)} style={enter('balancer')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">балансер</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.tag}</div>
      <div className="metrics">
        {/* Стратегии по умолчанию в конфиге нет — ядро берёт random */}
        <Metric accent>{data.strategy ?? 'random'}</Metric>
        <Metric>{`кандидатов: ${data.candidates}`}</Metric>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function ObservatoryNode({ data, selected }: { data: ObservatoryNodeData; selected?: boolean }) {
  return (
    <div className={frame('observatory', selected)} style={enter('observatory')}>
      <div className="fnode-head">
        <span className="fnode-kind">проверка живости</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">Обсерватория</div>
      <div className="metrics">
        {data.hasObservatory && <Metric>observatory</Metric>}
        {data.hasBurst && <Metric>burst</Metric>}
        <Metric>{`целей: ${data.subjectsCount}`}</Metric>
      </div>
      {/* Связь с балансером выводится из его стратегии, кабелем её не задают */}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function InjectNode({ data, selected }: { data: InjectNodeData; selected?: boolean }) {
  return (
    <div className={frame('inject', selected)} style={enter('inject')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">подстановка</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.selector}</div>
      <div className="metrics">
        {/* Пул по умолчанию задаёт панель, а не документ */}
        <Metric accent>{data.selectFrom ?? 'HIDDEN'}</Metric>
        {data.scheme === 'prefix' && <Metric>{data.tags.join(', ')}</Metric>}
        {data.scheme === 'panel' && <Metric>теги задаст панель</Metric>}
        {data.scheme === 'none' && <Metric>способ именования не задан</Metric>}
      </div>
      {/* Гнезда-источника нет: из группы никуда не ведут — её выходы создаст панель */}
    </div>
  )
}

export const nodeTypes = {
  inbound: InboundNode,
  outbound: OutboundNode,
  rule: RuleNode,
  dns: DnsNode,
  squad: SquadNode,
  balancer: BalancerNode,
  observatory: ObservatoryNode,
  inject: InjectNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>

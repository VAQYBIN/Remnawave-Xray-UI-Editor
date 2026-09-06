// Карточки узлов графа Mihomo. Разметка и классы — те же, что у карточек Xray
// (`nodes.tsx`): один патчбей, одна дизайн-система, новых стилей не заводим.

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type {
  MihomoBuiltinNodeData, MihomoGroupNodeData, MihomoHostsNodeData,
  MihomoProviderNodeData, MihomoRuleNodeData, MihomoSubRuleNodeData,
} from '../../entities/graph/mihomo/types'
import type { IssueCount } from '../../entities/graph/types'

function frame(kind: string, selected: boolean | undefined): string {
  return [
    'fnode',
    kind === 'group' ? 'fnode-bal' : '',
    kind === 'provider' ? 'fnode-out' : '',
    kind === 'hosts' ? 'fnode-inj' : '',
    kind === 'builtin' ? 'fnode-out' : '',
    selected ? 'fnode-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// Узлы появляются волной слева направо — как у графа Xray, в порядке движения
// сигнала: правило → группа → выход
const ENTER_DELAY: Record<string, number> = {
  rule: 0, subrule: 0, group: 90, provider: 180, hosts: 180, builtin: 180,
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

/**
 * Подписи вердикта трассировки. 'unknown' у Mihomo значит не «данных нет
 * где-то», а «на этом правиле проход остановлен» — отсюда своя формулировка, а
 * не заимствованная у Xray «нет данных».
 */
const TRACE_LABEL: Record<string, string> = {
  winner: 'маршрут',
  yes: 'совпало',
  no: 'не совпало',
  unknown: 'проверить нечем',
}

function MihomoRuleNode({ data, selected }: { data: MihomoRuleNodeData; selected?: boolean }) {
  return (
    <div className={frame('rule', selected)} style={enter('rule')}>
      <div className="fnode-head">
        <span className="fnode-kind">{data.type}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      {data.traceState && (
        <span className={`trace-badge trace-badge-${data.traceState}`}>
          {TRACE_LABEL[data.traceState]}
        </span>
      )}
      {data.payload && <div className="fnode-title">{data.payload}</div>}
      <div className="metrics">
        {data.target && <Metric accent>{`→ ${data.target}`}</Metric>}
        {data.modifiers.map((m) => (
          <Metric key={m}>{m}</Metric>
        ))}
      </div>
      {/* Гнезда-цели у правила нет: в правило кабель не входит */}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function MihomoSubRuleNode({ data, selected }: { data: MihomoSubRuleNodeData; selected?: boolean }) {
  return (
    <div className={frame('subrule', selected)} style={enter('subrule')}>
      {/* В подсписок ведёт правило SUB-RULE, из подсписка — цели его правил.
          Кабелем это не задаётся: обе стороны — строки правил, которые правит
          инспектор, поэтому оба гнезда служат только якорями рёбер */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="fnode-head">
        <span className="fnode-kind">подсписок</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.name}</div>
      <div className="metrics">
        <Metric>{`правил: ${data.count}`}</Metric>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function MihomoGroupNode({ data, selected }: { data: MihomoGroupNodeData; selected?: boolean }) {
  return (
    <div className={frame('group', selected)} style={enter('group')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.type ?? 'select'}</span>
        <span className="spacer" />
        {data.hidden && <span className="fnode-flag">скрыта</span>}
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.name}</div>
      <div className="metrics">
        {data.manual > 0 && <Metric>{`вручную: ${data.manual}`}</Metric>}
        {/* Условная формулировка обязательна ровно в одной ветке. «Панель
            подставит хосты» — обещание, которого никто не давал: под `filter`
            может не подойти ни один хост, и группа останется пустой. Вторая
            ветка безусловна законно — она следует из ключей самого документа
            (`groupGetsHosts`), а не из того, что сделает панель. */}
        <Metric accent={data.getsHosts}>
          {data.getsHosts ? 'если панель подставит хосты — сюда' : 'хостов от панели не будет'}
        </Metric>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function MihomoProviderNode({ data, selected }: { data: MihomoProviderNodeData; selected?: boolean }) {
  return (
    <div className={frame('provider', selected)} style={enter('provider')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.type ?? 'provider'}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.name}</div>
      {data.dialerProxy && (
        <div className="metrics">
          <Metric>{`через ${data.dialerProxy}`}</Metric>
        </div>
      )}
      {/* Гнезда-источника нет: содержимое провайдера приходит из его файла */}
    </div>
  )
}

function MihomoHostsNode({ data, selected }: { data: MihomoHostsNodeData; selected?: boolean }) {
  const pick =
    data.pick === 'random' ? 'один случайный' : data.pick === 'shuffled' ? 'все вперемешку' : 'все'
  return (
    <div className={frame('hosts', selected)} style={enter('hosts')}>
      {/* Оба гнезда закрыты: содержимое узла создаёт панель, кабелем его не
          задают — ребро сюда рисует граф по факту маркера подстановки */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="fnode-head">
        <span className="fnode-kind">подстановка</span>
      </div>
      <div className="fnode-title">хосты панели</div>
      <div className="metrics">
        {data.filter && <Metric>{`фильтр: ${data.filter}`}</Metric>}
        {data.excludeFilter && <Metric>{`исключение: ${data.excludeFilter}`}</Metric>}
        <Metric accent>{pick}</Metric>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function MihomoBuiltinNode({ data, selected }: { data: MihomoBuiltinNodeData; selected?: boolean }) {
  return (
    <div className={frame('builtin', selected)} style={enter('builtin')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">встроенная</span>
      </div>
      <div className="fnode-title">{data.name}</div>
      {/* Гнезда-источника нет: встроенная цель — конец маршрута */}
    </div>
  )
}

export const mihomoNodeTypes = {
  mihomoRule: MihomoRuleNode,
  mihomoSubRule: MihomoSubRuleNode,
  mihomoGroup: MihomoGroupNode,
  mihomoProvider: MihomoProviderNode,
  mihomoHosts: MihomoHostsNode,
  mihomoBuiltin: MihomoBuiltinNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>

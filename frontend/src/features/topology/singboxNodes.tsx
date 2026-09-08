// Карточки узлов графа sing-box. Разметка и классы — те же, что у карточек Xray
// (`nodes.tsx`) и Mihomo (`mihomoNodes.tsx`): один патчбей, одна дизайн-система,
// новых стилей не заводим.

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { IssueCount } from '../../entities/graph/types'
import type {
  SingboxBuiltinNodeData, SingboxGroupNodeData, SingboxHostsNodeData,
  SingboxInboundNodeData, SingboxOutNodeData, SingboxRuleNodeData,
} from '../../entities/graph/singbox/types'

function frame(kind: string, selected: boolean | undefined): string {
  return [
    'fnode',
    // Вход — ingress, и он индиго: тем же цветом граф красит и кабель `e:sbin:`.
    // Без класса карточка была бы стальной, а кабель из неё — индиговым
    kind === 'inbound' ? 'fnode-in' : '',
    kind === 'group' ? 'fnode-bal' : '',
    kind === 'out' || kind === 'builtin' ? 'fnode-out' : '',
    kind === 'hosts' ? 'fnode-inj' : '',
    selected ? 'fnode-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// Узлы появляются волной слева направо — как у обоих прежних графов, в порядке
// движения сигнала: вход → правило → группа → выход
const ENTER_DELAY: Record<string, number> = {
  inbound: 0, rule: 90, group: 180, out: 270, hosts: 270, builtin: 270,
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
 * Подписи вердикта трассировки. 'unknown' здесь про САМО правило: его условие
 * проверить нечем. Остановка прохода — следствие такого вердикта, а не его
 * смысл (правила ниже выполняются ровно при условии, которого мы не знаем), и
 * подпись обязана говорить о причине, а не о последствии.
 */
const TRACE_LABEL: Record<string, string> = {
  winner: 'маршрут',
  yes: 'совпало',
  no: 'не совпало',
  unknown: 'проверить нечем',
}

function SingboxInboundNode({
  data,
  selected,
}: {
  data: SingboxInboundNodeData
  selected?: boolean
}) {
  return (
    <div className={frame('inbound', selected)} style={enter('inbound')}>
      <div className="fnode-head">
        <span className="fnode-kind">{data.type}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.tag}</div>
      {data.port !== undefined && (
        <div className="metrics">
          <Metric>{`порт ${data.port}`}</Metric>
        </div>
      )}
      {/* Гнезда-цели у входа нет: в него кабель не входит. Гнездо-источник —
          только якорь ребра: связь «вход → правило» задаёт поле inbound самого
          правила, а не кабель */}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function SingboxRuleNode({ data, selected }: { data: SingboxRuleNodeData; selected?: boolean }) {
  return (
    <div className={frame('rule', selected)} style={enter('rule')}>
      {/* Гнездо-цель — якорь ребра от входа, коммутации через него нет */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="fnode-head">
        <span className="fnode-kind">{`правило #${data.index + 1}`}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      {data.traceState && (
        <span className={`trace-badge trace-badge-${data.traceState}`}>
          {TRACE_LABEL[data.traceState]}
        </span>
      )}
      <div className="fnode-title">
        {data.summary.join(' · ') || 'без условий — совпадает со всем'}
      </div>
      <div className="metrics">
        {data.target && <Metric accent>{`→ ${data.target}`}</Metric>}
        {/* Действие показываем, только когда оно не 'route': маршрутное действие
            и так видно по цели, а лишняя строка на каждой карточке — шум */}
        {data.action !== 'route' && <Metric>{`действие: ${data.action}`}</Metric>}
        {data.ruleSets.length > 0 && <Metric>{`наборы: ${data.ruleSets.join(', ')}`}</Metric>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function SingboxGroupNode({ data, selected }: { data: SingboxGroupNodeData; selected?: boolean }) {
  return (
    <div className={frame('group', selected)} style={enter('group')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.type}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.tag}</div>
      <div className="metrics">
        {/* Про заполняемую панелью группу нельзя сказать, сколько в ней будет
            имён: список из документа она затрёт целиком, а сколько серверов
            отдаст подписка, знает только панель */}
        <Metric accent={data.panelFills}>
          {data.panelFills ? 'список заполнит панель' : `закреплён, имён: ${data.listed}`}
        </Metric>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function SingboxOutNode({ data, selected }: { data: SingboxOutNodeData; selected?: boolean }) {
  return (
    <div className={frame('out', selected)} style={enter('out')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode-head">
        <span className="fnode-kind">{data.type}</span>
        <span className="spacer" />
        {/* Дефолтный маршрут задаётся либо route.final, либо ПОЗИЦИЕЙ первого
            элемента — второе глазами в документе не видно, и подпись здесь
            единственное место, где это сказано */}
        {data.isDefault && <span className="fnode-flag">по умолчанию</span>}
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-title">{data.tag}</div>
      {/* `direct` исключён: он и не должен попадать в группы, и оговорка про
          него читалась бы как поломка. Смысл она несёт у выходов, похожих на
          серверы, — их панель в списки групп всё равно не добавит */}
      {!data.panelPicks && data.type !== 'direct' && (
        <div className="metrics">
          <Metric>панель не добавит в группы</Metric>
        </div>
      )}
      {/* Гнезда-источника нет: выход — конец маршрута */}
    </div>
  )
}

function SingboxHostsNode({ data }: { data: SingboxHostsNodeData; selected?: boolean }) {
  return (
    <div className={frame('hosts', false)} style={enter('hosts')}>
      {/* Оба гнезда закрыты: содержимое узла создаёт панель, кабелем его не
          задают — ребро сюда рисует граф по факту заполнения группы */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="fnode-head">
        <span className="fnode-kind">подстановка</span>
      </div>
      <div className="fnode-title">серверы подписки</div>
      <div className="metrics">
        <Metric accent>{`их подставит панель, групп: ${data.groups}`}</Metric>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function SingboxBuiltinNode({
  data,
  selected,
}: {
  data: SingboxBuiltinNodeData
  selected?: boolean
}) {
  return (
    <div className={frame('builtin', selected)} style={enter('builtin')}>
      {/* Гнездо-цель — якорь ребра от правила: встроенное действие не запись
          документа, а узел, нарисованный по действию, и кабелем не задаётся */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="fnode-head">
        <span className="fnode-kind">встроенное</span>
      </div>
      <div className="fnode-title">{data.action}</div>
      <div className="metrics">
        <Metric>исход маршрута, а не выход</Metric>
      </div>
      {/* Гнезда-источника нет: встроенное действие — конец маршрута */}
    </div>
  )
}

export const singboxNodeTypes = {
  singboxInbound: SingboxInboundNode,
  singboxRule: SingboxRuleNode,
  singboxGroup: SingboxGroupNode,
  singboxOut: SingboxOutNode,
  singboxHosts: SingboxHostsNode,
  singboxBuiltin: SingboxBuiltinNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>

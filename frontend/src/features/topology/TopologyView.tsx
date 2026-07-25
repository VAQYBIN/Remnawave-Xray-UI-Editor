import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  applyEdgeChanges, applyNodeChanges, Background, Controls, Panel, ReactFlow, useReactFlow, ViewportPortal,
  type Edge, type EdgeChange, type NodeChange, type Connection, type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { TraceResult, XrayConfig } from '../../entities/xray'
import { buildGraph, COLUMN_X, layoutColumns } from '../../entities/graph/buildGraph'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import {
  addInbound, addOutbound, addRule, attachInboundToRule, connectRule, disconnectEdge, setRuleOutbound,
} from '../../entities/graph/mutations'
import { Button } from '../../shared/ui'
import { edgeTypes } from './edges'
import { nodeTypes } from './nodes'
import { usePositionsStore } from './positionsStore'

interface Props {
  profileUuid: string
  config: XrayConfig
  ctx: GraphContext
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  onChangeConfig: (next: XrayConfig) => void
  /** Результат трассировки: вердикты на узлах правил и подсветка победившего пути */
  trace?: TraceResult
  /** Дополнительные контролы в доке (строка трассировки) */
  dockExtra?: ReactNode
  /** Счётчики проблем по id узла — рисуются значком */
  issues?: Record<string, IssueCount>
  /** Запрос центрирования на узле (из поиска) */
  focus?: { nodeId: string; nonce: number } | null
}

// Индекс правила, зашитый в id ребра (`rule:{i}`), для сортировки перед батч-удалением.
// Рёбра без индекса правила (например squad->inbound) сохраняют относительный порядок в конце.
const RULE_INDEX = /rule:(\d+)/

function ruleIndexOf(edgeId: string): number {
  const m = RULE_INDEX.exec(edgeId)
  return m ? Number(m[1]) : -1
}

// Пересборка графа заменяет объекты рёбер — переносим флаг выделения по id
export function resyncEdges(prev: Edge[], next: Edge[]): Edge[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id))
  return next.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e))
}

/**
 * Что можно коммутировать: inbound уходит в правило или напрямую в outbound
 * (тогда правило создаётся само), правило — только в outbound. Гнёзда сквадов
 * закрыты: привязку сквадов задаёт панель Remnawave, не редактор.
 */
export function isValidConnection(conn: { source?: string | null; target?: string | null }): boolean {
  const source = conn.source ?? ''
  const target = conn.target ?? ''
  if (source === target) return false
  if (source.startsWith('in:')) return target.startsWith('rule:') || target.startsWith('out:')
  if (source.startsWith('rule:')) return target.startsWith('out:')
  return false
}

/** Применяет протянутый кабель к конфигу. Недопустимая пара возвращает ТОТ ЖЕ config. */
export function applyConnection(
  config: XrayConfig,
  conn: { source?: string | null; target?: string | null },
): XrayConfig {
  const source = conn.source ?? ''
  const target = conn.target ?? ''
  if (source.startsWith('in:') && target.startsWith('out:')) {
    return connectRule(config, source.slice(3), target.slice(4))
  }
  if (source.startsWith('in:') && target.startsWith('rule:')) {
    return attachInboundToRule(config, source.slice(3), Number(target.slice(5)))
  }
  if (source.startsWith('rule:') && target.startsWith('out:')) {
    return setRuleOutbound(config, Number(source.slice(5)), target.slice(4))
  }
  return config
}

/** Ширина инспектора; держится в паре с --inspector-w в tokens.css */
export function inspectorWidth(viewportWidth: number): number {
  return Math.min(440, viewportWidth * 0.92)
}

/**
 * Инспектор выезжает поверх канваса, поэтому без компенсации правая колонка узлов
 * оказалась бы под ним и стала недоступной для клика. Сдвигаем вьюпорт ровно на
 * ширину панели — граф не перекомпоновывается, но «выталкивается» из-под неё.
 * Между двумя выбранными узлами сдвиг не меняется, так что дёргается только
 * открытие и закрытие.
 */
function ViewportShift({ shift }: { shift: number }) {
  const { getViewport, setViewport } = useReactFlow()
  const applied = useRef(0)

  useEffect(() => {
    const delta = shift - applied.current
    if (delta === 0) return
    applied.current = shift
    const vp = getViewport()
    setViewport({ ...vp, x: vp.x - delta }, { duration: 180 })
  }, [shift, getViewport, setViewport])

  return null
}

/** Центрирование на узле по запросу поиска; nonce позволяет вернуться к тому же узлу повторно */
function FocusNode({ request }: { request?: { nodeId: string; nonce: number } | null }) {
  const { getNode, setCenter } = useReactFlow()

  useEffect(() => {
    if (!request) return
    const node = getNode(request.nodeId)
    if (!node) return
    const width = node.measured?.width ?? 220
    const height = node.measured?.height ?? 90
    setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1,
      duration: 320,
    })
  }, [request, getNode, setCenter])

  return null
}

const COLUMNS = [
  { kind: 'squad', title: 'сквады', x: COLUMN_X.squad },
  { kind: 'inbound', title: 'inbound', x: COLUMN_X.inbound },
  { kind: 'rule', title: 'правила', x: COLUMN_X.rule },
  { kind: 'outbound', title: 'outbound', x: COLUMN_X.outbound },
] as const

/** Состояние правила для бейджа на узле: победитель отделён от обычного совпадения */
export function traceStateOf(
  result: TraceResult | undefined,
  ruleIndex: number,
): 'yes' | 'no' | 'unknown' | 'winner' | undefined {
  if (!result) return undefined
  const shown = result.ipVerdicts ?? result.verdicts
  const verdict = shown.find((v) => v.index === ruleIndex)
  if (!verdict) return undefined
  return result.winner?.ruleIndex === ruleIndex ? 'winner' : verdict.state
}

/** Значок проблем на узле: ошибка перевешивает предупреждения, счёт — общий */
export function issueBadgeOf(
  issues: Record<string, IssueCount> | undefined,
  nodeId: string,
): { level: 'error' | 'warn'; total: number } | undefined {
  const count = issues?.[nodeId]
  if (!count) return undefined
  const total = count.errors + count.warnings
  if (total === 0) return undefined
  return { level: count.errors > 0 ? 'error' : 'warn', total }
}

/** Кабели победившего пути: входы → правило → выход. Дефолтный маршрут правил не задействует. */
export function tracedEdgeIds(result: TraceResult | undefined, config: XrayConfig): Set<string> {
  const ids = new Set<string>()
  const index = result?.winner?.ruleIndex
  if (index === undefined || index === null) return ids
  const rule = config.routing?.rules?.[index]
  if (!rule) return ids
  const inboundTags = (config.inbounds ?? []).map((i) => i.tag)
  const scope = rule.inboundTag?.length
    ? rule.inboundTag.filter((t) => inboundTags.includes(t))
    : inboundTags
  for (const tag of scope) ids.add(`e:in:${tag}->rule:${index}`)
  if (rule.outboundTag) ids.add(`e:rule:${index}->out:${rule.outboundTag}`)
  return ids
}

export function TopologyView({
  profileUuid,
  config,
  ctx,
  selectedId,
  onSelect,
  onChangeConfig,
  trace,
  dockExtra,
  issues,
  focus,
}: Props) {
  const saved = usePositionsStore((s) => s.positions[profileUuid])
  const setPosition = usePositionsStore((s) => s.setPosition)
  const resetPositions = usePositionsStore((s) => s.resetPositions)

  // Граф пересобирается только от конфига и контекста панели. Трассировка сюда
  // не входит намеренно: иначе каждый символ в строке адреса создавал бы все узлы
  // заново, а вместе с ними перезапускалась бы анимация появления (узлы мигали
  // и не успевали проявиться).
  const graph = useMemo(() => {
    const g = buildGraph(config, ctx)
    return { nodes: layoutColumns(g.nodes), edges: g.edges }
  }, [config, ctx])

  const computed = useMemo(() => {
    const traced = tracedEdgeIds(trace, config)
    const laid = graph.nodes.map((n) => {
      const traceState = n.data.kind === 'rule' ? traceStateOf(trace, n.data.index as number) : undefined
      const issueCount = issues?.[n.id]
      // Ссылку на data сохраняем, когда доклеивать нечего: React Flow сравнивает
      // объекты по ссылке, и новый объект на каждый ввод — лишняя перерисовка
      const data =
        traceState === undefined && issueCount === undefined
          ? n.data
          : {
              ...n.data,
              ...(traceState === undefined ? {} : { traceState }),
              ...(issueCount === undefined ? {} : { issueCount }),
            }
      return {
        ...n,
        deletable: false,
        position: saved?.[n.id] ?? n.position,
        selected: n.id === selectedId,
        data,
      }
    })
    // Кабели, касающиеся выбранного узла или лежащие на трассе, подсвечиваются
    // бегущим пунктиром — видно весь путь трафика от входа до выхода
    const wired = graph.edges.map((e) => ({
      ...e,
      type: 'signal',
      data: {
        active:
          traced.has(e.id) ||
          (selectedId !== null && (e.source === selectedId || e.target === selectedId)),
      },
    }))
    return { nodes: laid, edges: wired }
  }, [graph, config, saved, selectedId, trace, issues])

  // controlled-режим: drag применяется к локальному стейту, ресинк при пересборке графа
  const [nodes, setNodes] = useState<Node[]>(computed.nodes)
  useEffect(() => setNodes(computed.nodes), [computed.nodes])
  const [edges, setEdges] = useState<Edge[]>(computed.edges)
  useEffect(() => setEdges((prev) => resyncEdges(prev, computed.edges)), [computed.edges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds))
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          setPosition(profileUuid, change.id, change.position)
        }
      }
    },
    [profileUuid, setPosition],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      const next = applyConnection(config, conn)
      if (next !== config) onChangeConfig(next)
    },
    [config, onChangeConfig],
  )

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      // Id узлов/рёбер правил позиционные (`rule:{i}`), а disconnectEdge для ребра
      // rule->out делает splice по индексу правила. При батч-удалении нескольких рёбер
      // за один вызов последовательные splice сдвигают индексы оставшихся правил, поэтому
      // сортируем по индексу правила по убыванию — тогда более поздние правила удаляются
      // первыми и не смещают индексы ещё не обработанных.
      // При равном индексе правила сперва обрабатываем e:in:...->rule:i (просто фильтрует
      // inboundTag, индексы не смещает), и только потом e:rule:i->out:... (делает splice)
      // — тег должен вычиститься до splice правила.
      const isRuleOut = (id: string) => (id.startsWith('e:rule:') ? 1 : 0)
      const sorted = [...deleted].sort((a, b) => {
        const byIndex = ruleIndexOf(b.id) - ruleIndexOf(a.id)
        if (byIndex !== 0) return byIndex
        return isRuleOut(a.id) - isRuleOut(b.id)
      })
      let next = config
      for (const edge of sorted) next = disconnectEdge(next, edge.id)
      if (next !== config) onChangeConfig(next)
    },
    [config, onChangeConfig],
  )

  const filledColumns = useMemo(() => {
    const kinds = new Set(computed.nodes.map((n) => n.data.kind))
    return COLUMNS.filter((c) => kinds.has(c.kind))
  }, [computed.nodes])

  const noRules = (config.routing?.rules?.length ?? 0) === 0

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode="dark"
      fitView
      fitViewOptions={{ padding: 0.22 }}
      minZoom={0.25}
      maxZoom={1.75}
      proOptions={{ hideAttribution: true }}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node: Node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onEdgesDelete={onEdgesDelete}
    >
      <Background gap={22} size={1} />
      <Controls showInteractive={false} position="bottom-right" />
      <ViewportShift shift={selectedId === null ? 0 : inspectorWidth(window.innerWidth)} />
      <FocusNode request={focus} />

      {/* Подписи колонок живут в координатах канваса и едут вместе с узлами */}
      <ViewportPortal>
        {filledColumns.map((c) => (
          <div
            key={c.kind}
            className="column-label"
            style={{ position: 'absolute', transform: `translate(${c.x}px, -52px)` }}
          >
            {c.title}
          </div>
        ))}
      </ViewportPortal>

      {noRules && (
        <Panel position="top-center">
          <p className="canvas-hint">
            Правил пока нет. Протяните кабель от гнезда inbound к outbound — правило создастся само.
          </p>
        </Panel>
      )}

      <Panel position="bottom-center">
        <div className="wb-dock">
          <Button onClick={() => onChangeConfig(addInbound(config))}>+ Inbound</Button>
          <Button onClick={() => onChangeConfig(addOutbound(config))}>+ Outbound</Button>
          <Button onClick={() => onChangeConfig(addRule(config))}>+ Правило</Button>
          <span className="wb-dock-sep" aria-hidden="true" />
          {dockExtra}
          {dockExtra && <span className="wb-dock-sep" aria-hidden="true" />}
          <Button variant="ghost" onClick={() => resetPositions(profileUuid)}>
            Сбросить расположение
          </Button>
        </div>
      </Panel>
    </ReactFlow>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  applyEdgeChanges, applyNodeChanges, Background, Controls, Panel, ReactFlow, useConnection,
  useReactFlow, useStore, useUpdateNodeInternals, ViewportPortal,
  type Connection, type Edge, type EdgeChange, type EdgeTypes, type Node, type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { Button } from '../../shared/ui'
import { usePositionsStore } from './positionsStore'

interface Props {
  /**
   * Ключ документа в хранилище позиций: `<вид>:<uuid>`, а не голый uuid —
   * uuid профиля и шаблона могут совпасть, и узлы двух графов смешались бы
   * в одной записи (см. shared/lib/docKey).
   */
  docKey: string
  /** Узлы и рёбра документа; канвас держит свою копию ради drag'а и ресинкает её */
  nodes: Node[]
  edges: Edge[]
  nodeTypes: Record<string, ComponentType<NodeProps>>
  edgeTypes: EdgeTypes
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  /** Правила коммутации документа: канвас про них ничего не знает, только спрашивает */
  isValidConnection: (conn: { source?: string | null; target?: string | null }) => boolean
  onConnect: (conn: Connection) => void
  onEdgesDelete?: (deleted: Edge[]) => void
  /** Колонки, куда вообще можно воткнуть кабель. Ключ — префикс id узла. */
  targetKinds: readonly string[]
  /** Подписи колонок: `kind` — тип узла, `x` — координата в системе канваса */
  columns: readonly { kind: string; title: string; x: number }[]
  /** Подсказка поверх пустого графа; показывается, только когда её передали */
  hint?: ReactNode
  /** Кнопки документа в первой строке дока («+ Inbound», «+ Правило», …) */
  dockActions?: ReactNode
  /** Дополнительные контролы в первой строке дока (поиск, тумблеры инструментов) */
  dockExtra?: ReactNode
  /** Раскрытый инструмент — вторая строка дока, чтобы он не растил его вширь */
  dockRow?: ReactNode
  /** Запрос центрирования на узле (из поиска) */
  focus?: { nodeId: string; nonce: number } | null
  /** Диалоги документа: живут внутри канваса, потому что вызываются из его же событий */
  children?: ReactNode
}

// Пересборка графа заменяет объекты рёбер — переносим флаг выделения по id
export function resyncEdges(prev: Edge[], next: Edge[]): Edge[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id))
  return next.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e))
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

/**
 * Гнёзда живут внутри масштабируемого вьюпорта: на отдалении 12px-джек
 * превращается в пять экранных пикселей, и попасть в него мышью нечем. Кладём
 * зум в CSS-переменную — хит-зона делится на него и остаётся постоянной на
 * экране, каким бы ни был масштаб.
 *
 * Второй атрибут говорит, куда сейчас можно воткнуть тянущийся кабель. Набор
 * колонок выводится из isValidConnection, а не переписывается в CSS: правила
 * коммутации должны жить в одном месте. Подсветка тогда — чистый CSS, без
 * перерисовки узлов на каждое движение мыши.
 */
function PatchbayState({
  targetKinds,
  isValidConnection,
}: {
  targetKinds: readonly string[]
  isValidConnection: (conn: { source?: string | null; target?: string | null }) => boolean
}) {
  const dom = useStore((s) => s.domNode)
  const zoom = useStore((s) => s.transform[2])
  const connection = useConnection()
  const from = connection.inProgress ? (connection.fromHandle?.nodeId ?? null) : null

  const accepts = useMemo(() => {
    if (from === null) return null
    return targetKinds
      .filter((kind) => isValidConnection({ source: from, target: `${kind}:probe` }))
      .join(' ')
  }, [from, targetKinds, isValidConnection])

  useEffect(() => {
    dom?.style.setProperty('--rf-zoom', String(zoom))
  }, [dom, zoom])

  useEffect(() => {
    if (!dom) return
    if (accepts === null) delete dom.dataset.accepts
    else dom.dataset.accepts = accepts
  }, [dom, accepts])

  return null
}

/**
 * Входная анимация `.fnode` сдвигает карточку на 8px вниз (`node-enter`), а React Flow
 * снимает позиции гнёзд как раз в это время — и все рёбра остаются на 8px ниже своих
 * гнёзд до первой перерисовки, которую раньше вызывало только перетаскивание узла.
 * По окончании анимации просим пересчитать внутренности узла.
 *
 * Живёт отдельным узлом внутри `<ReactFlow>`: хук требует контекста провайдера, который
 * создаёт сам канвас, — снаружи он падает с ошибкой 001.
 */
function RemeasureOnEnter() {
  const updateNodeInternals = useUpdateNodeInternals()

  useEffect(() => {
    function onAnimationEnd(event: AnimationEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.classList.contains('fnode')) return
      const id = target.closest('.react-flow__node')?.getAttribute('data-id')
      if (id) updateNodeInternals(id)
    }
    document.addEventListener('animationend', onAnimationEnd, true)
    return () => document.removeEventListener('animationend', onAnimationEnd, true)
  }, [updateNodeInternals])

  return null
}

/**
 * Обвязка React Flow, общая для всех графов редактора: позиции узлов, фокус по
 * запросу поиска, патчбей, подписи колонок и док. Что за узлы в графе и что
 * значит кабель между ними, канвас не знает — это дело документа, который его
 * рисует (топология Xray, топология Mihomo).
 */
export function GraphCanvas({
  docKey,
  nodes: graphNodes,
  edges: graphEdges,
  nodeTypes,
  edgeTypes,
  selectedId,
  onSelect,
  isValidConnection,
  onConnect,
  onEdgesDelete,
  targetKinds,
  columns,
  hint,
  dockActions,
  dockExtra,
  dockRow,
  focus,
  children,
}: Props) {
  const setPosition = usePositionsStore((s) => s.setPosition)
  const resetPositions = usePositionsStore((s) => s.resetPositions)

  // controlled-режим: drag применяется к локальному стейту, ресинк при пересборке графа
  const [nodes, setNodes] = useState<Node[]>(graphNodes)
  useEffect(() => setNodes(graphNodes), [graphNodes])
  const [edges, setEdges] = useState<Edge[]>(graphEdges)
  useEffect(() => setEdges((prev) => resyncEdges(prev, graphEdges)), [graphEdges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds))
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          setPosition(docKey, change.id, change.position)
        }
      }
    },
    [docKey, setPosition],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  )

  // Считаем по узлам из пропса, а не по локальному состоянию: на первом рендере
  // оно ещё не догнало документ через useEffect, и подписи мигнули бы.
  // Колонку с узлом роднит `data.kind` — семантический вид узла, а не `type`:
  // тот всего лишь ключ компонента-рендерера, и у графа Mihomo эти два имени
  // намеренно разные (`type: 'mihomoGroup'` при `kind: 'mihomo-group'`).
  const filledColumns = useMemo(() => {
    const kinds = new Set(graphNodes.map((n) => n.data.kind))
    return columns.filter((c) => kinds.has(c.kind))
  }, [graphNodes, columns])

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
      <RemeasureOnEnter />
      <PatchbayState targetKinds={targetKinds} isValidConnection={isValidConnection} />

      {/* Подписи колонок живут в координатах канваса и едут вместе с узлами.
          Ключ — вид ВМЕСТЕ с координатой: у Xray колонка каждого вида ровно
          одна, а у Mihomo колонок вида `mihomo-group` бывает несколько (их
          число зависит от глубины ссылок документа). По одному только виду
          React считал бы их одним и тем же ребёнком и рисовал ПЕРВУЮ, молча
          теряя подписи всех остальных колонок групп. */}
      <ViewportPortal>
        {filledColumns.map((c) => (
          <div
            key={`${c.kind}:${c.x}`}
            className="column-label"
            style={{ position: 'absolute', transform: `translate(${c.x}px, -52px)` }}
          >
            {c.title}
          </div>
        ))}
      </ViewportPortal>

      {hint && (
        <Panel position="top-center">
          <div className="canvas-hint">{hint}</div>
        </Panel>
      )}

      <Panel position="bottom-center">
        {/* Раскрытый инструмент уезжает во вторую строку: в одной он растягивал
            док почти во всю ширину окна и накрывал правую колонку узлов */}
        <div className={dockRow ? 'wb-dock wb-dock-stacked' : 'wb-dock'}>
          <div className="wb-dock-row">
            {dockActions}
            {dockActions && <span className="wb-dock-sep" aria-hidden="true" />}
            {dockExtra}
            {dockExtra && <span className="wb-dock-sep" aria-hidden="true" />}
            <Button variant="ghost" onClick={() => resetPositions(docKey)}>
              Сбросить расположение
            </Button>
          </div>
          {dockRow && <div className="wb-dock-row wb-dock-row-2">{dockRow}</div>}
        </div>
      </Panel>

      {children}
    </ReactFlow>
  )
}

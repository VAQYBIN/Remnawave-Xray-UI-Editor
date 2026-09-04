import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  applyEdgeChanges, applyNodeChanges, Background, Controls, Panel, ReactFlow, useConnection,
  useReactFlow, useStore, useUpdateNodeInternals, ViewportPortal,
  type Edge, type EdgeChange, type NodeChange, type Connection, type Node,
} from '@xyflow/react'
import { blockingInjectPrefix, expandSelector, type TraceResult, type XrayConfig } from '../../entities/xray'
import { buildGraph, COLUMN_X, layoutColumns } from '../../entities/graph/buildGraph'
import { edgeId, outboundTargets } from '../../entities/graph/edgeIds'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import {
  addBalancer, addInbound, addOutbound, addRule, attachInboundToRule, attachInjectGroupToBalancer,
  attachOutboundToBalancer, connectRule, disconnectEdge, setRuleBalancer, setRuleInjectGroup,
  setRuleOutbound,
} from '../../entities/graph/mutations'
import { Button, Dialog } from '../../shared/ui'
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
  /** Дополнительные контролы в первой строке дока (поиск, тумблеры инструментов) */
  dockExtra?: ReactNode
  /** Раскрытый инструмент — вторая строка дока, чтобы он не растил его вширь */
  dockRow?: ReactNode
  /** Счётчики проблем по id узла — рисуются значком */
  issues?: Record<string, IssueCount>
  /** Запрос центрирования на узле (из поиска) */
  focus?: { nodeId: string; nonce: number } | null
  /** Открыть библиотеку рецептов; кнопка появляется только когда обработчик передан */
  onOpenRecipes?: () => void
}

// Индекс правила, зашитый в id ребра (`rule:{i}`), для сортировки перед батч-удалением.
// Рёбра без индекса правила (например squad->inbound) сохраняют относительный порядок в конце.
const RULE_INDEX = /rule:(\d+)/
const EDGE_BAL_OUT = /^e:bal:(.+)->out:(.+)$/

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
 * (тогда правило создаётся само), правило — в балансер либо в outbound, балансер —
 * в outbound. Гнёзда сквадов и обсерватории закрыты: привязку сквадов задаёт панель
 * Remnawave, а связь обсерватории с балансером выводится из его стратегии.
 * Группы подстановки — такие же выходы, только их outbound'ы создаст панель,
 * поэтому вести в них можно из правил и балансеров, а выходить из них нельзя.
 */
export function isValidConnection(conn: { source?: string | null; target?: string | null }): boolean {
  const source = conn.source ?? ''
  const target = conn.target ?? ''
  if (source === target) return false
  if (source.startsWith('in:')) return target.startsWith('rule:') || target.startsWith('out:')
  if (source.startsWith('rule:')) {
    return target.startsWith('out:') || target.startsWith('bal:') || target.startsWith('inj:')
  }
  if (source.startsWith('bal:')) return target.startsWith('out:') || target.startsWith('inj:')
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
  if (source.startsWith('rule:') && target.startsWith('bal:')) {
    return setRuleBalancer(config, Number(source.slice(5)), target.slice(4))
  }
  if (source.startsWith('bal:') && target.startsWith('out:')) {
    return attachOutboundToBalancer(config, source.slice(4), target.slice(4))
  }
  if (source.startsWith('rule:') && target.startsWith('inj:')) {
    return setRuleInjectGroup(config, Number(source.slice(5)), Number(target.slice(4)))
  }
  if (source.startsWith('bal:') && target.startsWith('inj:')) {
    return attachInjectGroupToBalancer(config, source.slice(4), Number(target.slice(4)))
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

/** Колонки, куда вообще можно воткнуть кабель. Ключ — префикс id узла. */
const TARGET_KINDS = ['rule', 'out', 'bal', 'inj'] as const

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
function PatchbayState() {
  const dom = useStore((s) => s.domNode)
  const zoom = useStore((s) => s.transform[2])
  const connection = useConnection()
  const from = connection.inProgress ? (connection.fromHandle?.nodeId ?? null) : null

  const accepts = useMemo(() => {
    if (from === null) return null
    return TARGET_KINDS.filter((kind) =>
      isValidConnection({ source: from, target: `${kind}:probe` }),
    ).join(' ')
  }, [from])

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

const COLUMNS = [
  { kind: 'squad', title: 'сквады', x: COLUMN_X.squad },
  { kind: 'inbound', title: 'inbound', x: COLUMN_X.inbound },
  { kind: 'rule', title: 'правила', x: COLUMN_X.rule },
  { kind: 'balancer', title: 'балансеры', x: COLUMN_X.balancer },
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
  // Тот же резолвер, что у buildGraph: иначе подсветка целится в узел, которого нет
  const targetFor = outboundTargets(config)
  const inboundTags = (config.inbounds ?? []).map((i) => i.tag)
  const scope = rule.inboundTag?.length
    ? rule.inboundTag.filter((t) => inboundTags.includes(t))
    : inboundTags
  for (const tag of scope) ids.add(edgeId(`in:${tag}`, `rule:${index}`))
  if (rule.outboundTag) {
    const target = targetFor(rule.outboundTag)
    if (target !== undefined) ids.add(edgeId(`rule:${index}`, target))
  }
  if (rule.balancerTag) {
    ids.add(edgeId(`rule:${index}`, `bal:${rule.balancerTag}`))
    // Победителя среди кандидатов редактор не знает — подсвечиваем всех.
    // Set сам схлопывает несколько предсказанных тегов одной группы в одно ребро.
    for (const tag of result?.winner?.balancerCandidates ?? []) {
      const target = targetFor(tag)
      if (target !== undefined) ids.add(edgeId(`bal:${rule.balancerTag}`, target))
    }
  }
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
  dockRow,
  issues,
  focus,
  onOpenRecipes,
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

  // Запрос на разворот префикса selector — ставится при разрыве префиксного ребра
  const [expand, setExpand] = useState<{ balancerTag: string; outboundTag: string } | null>(null)

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
      // Ребро балансер → выход, кандидат которого пришёл из префикса, disconnectEdge
      // не трогает: убрать одного, не переписав selector, нельзя. Спрашиваем разрешение.
      let pending: { balancerTag: string; outboundTag: string } | null = null
      let next = config
      for (const edge of sorted) {
        const before = next
        next = disconnectEdge(next, edge.id)
        const m = EDGE_BAL_OUT.exec(edge.id)
        if (next === before && m) pending = { balancerTag: m[1]!, outboundTag: m[2]! }
      }
      if (next !== config) onChangeConfig(next)
      if (pending) setExpand(pending)
    },
    [config, onChangeConfig],
  )

  const filledColumns = useMemo(() => {
    const kinds = new Set(computed.nodes.map((n) => n.data.kind))
    return COLUMNS.filter((c) => kinds.has(c.kind))
  }, [computed.nodes])

  const noRules = (config.routing?.rules?.length ?? 0) === 0

  // Если префикс держит и кандидата, и группу подстановки, expandSelector вернёт тот же
  // конфиг — кнопка «Развернуть префикс» в диалоге ниже обманывала бы пользователя
  const blocked = expand
    ? blockingInjectPrefix(config, expand.balancerTag, expand.outboundTag)
    : undefined

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
      <PatchbayState />

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
        {/* Раскрытый инструмент уезжает во вторую строку: в одной он растягивал
            док почти во всю ширину окна и накрывал правую колонку узлов */}
        <div className={dockRow ? 'wb-dock wb-dock-stacked' : 'wb-dock'}>
          <div className="wb-dock-row">
            <Button onClick={() => onChangeConfig(addInbound(config))}>+ Inbound</Button>
            <Button onClick={() => onChangeConfig(addOutbound(config))}>+ Outbound</Button>
            <Button onClick={() => onChangeConfig(addRule(config))}>+ Правило</Button>
            <Button onClick={() => onChangeConfig(addBalancer(config))}>+ Балансер</Button>
            {onOpenRecipes && <Button onClick={onOpenRecipes}>+ Рецепт</Button>}
            <span className="wb-dock-sep" aria-hidden="true" />
            {dockExtra}
            {dockExtra && <span className="wb-dock-sep" aria-hidden="true" />}
            <Button variant="ghost" onClick={() => resetPositions(profileUuid)}>
              Сбросить расположение
            </Button>
          </div>
          {dockRow && <div className="wb-dock-row wb-dock-row-2">{dockRow}</div>}
        </div>
      </Panel>

      <Dialog open={expand !== null} title="Убрать выход из балансера" onClose={() => setExpand(null)}>
        {blocked !== undefined ? (
          <>
            <p>
              Префикс «{blocked}» ловит и выход «{expand?.outboundTag}», и группу подстановки.
              Развернуть его в точные теги нельзя: сколько серверов подставит панель, знает только
              она — в селекторе замёрзли бы три предсказанных тега.
            </p>
            <p className="muted">
              Переименуйте выход так, чтобы он не попадал под префикс, либо правьте селектор в форме
              балансера.
            </p>
            <div className="row">
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setExpand(null)}>
                Понятно
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Кандидат «{expand?.outboundTag}» попал в балансер «{expand?.balancerTag}» по префиксу.
              Чтобы убрать только его, селектор придётся переписать точными тегами остальных
              кандидатов.
            </p>
            <div className="row">
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setExpand(null)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (expand) {
                    onChangeConfig(expandSelector(config, expand.balancerTag, expand.outboundTag))
                  }
                  setExpand(null)
                }}
              >
                Развернуть префикс
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </ReactFlow>
  )
}

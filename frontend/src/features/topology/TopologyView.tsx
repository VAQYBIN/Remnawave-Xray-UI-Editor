import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyEdgeChanges, applyNodeChanges, Background, Controls, Panel, ReactFlow,
  type Edge, type EdgeChange, type NodeChange, type Connection, type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { XrayConfig } from '../../entities/xray'
import { buildGraph, layoutColumns } from '../../entities/graph/buildGraph'
import type { GraphContext } from '../../entities/graph/types'
import { addInbound, addOutbound, addRule, connectRule, disconnectEdge } from '../../entities/graph/mutations'
import { Button } from '../../shared/ui'
import { nodeTypes } from './nodes'
import { usePositionsStore } from './positionsStore'

interface Props {
  profileUuid: string
  config: XrayConfig
  ctx: GraphContext
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  onChangeConfig: (next: XrayConfig) => void
}

// Индекс правила, зашитый в id ребра (`rule:{i}`), для сортировки перед батч-удалением.
// Рёбра без индекса правила (например squad->inbound) сохраняют относительный порядок в конце.
const RULE_INDEX = /rule:(\d+)/

function ruleIndexOf(edgeId: string): number {
  const m = RULE_INDEX.exec(edgeId)
  return m ? Number(m[1]) : -1
}

export function TopologyView({ profileUuid, config, ctx, selectedId, onSelect, onChangeConfig }: Props) {
  const saved = usePositionsStore((s) => s.positions[profileUuid])
  const setPosition = usePositionsStore((s) => s.setPosition)
  const resetPositions = usePositionsStore((s) => s.resetPositions)

  const computed = useMemo(() => {
    const g = buildGraph(config, ctx)
    const laid = layoutColumns(g.nodes).map((n) => ({
      ...n,
      deletable: false,
      position: saved?.[n.id] ?? n.position,
      selected: n.id === selectedId,
    }))
    return { nodes: laid, edges: g.edges }
  }, [config, ctx, saved, selectedId])

  // controlled-режим: drag применяется к локальному стейту, ресинк при пересборке графа
  const [nodes, setNodes] = useState<Node[]>(computed.nodes)
  useEffect(() => setNodes(computed.nodes), [computed.nodes])
  const [edges, setEdges] = useState<Edge[]>(computed.edges)
  useEffect(() => setEdges(computed.edges), [computed.edges])

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
      if (conn.source?.startsWith('in:') && conn.target?.startsWith('out:')) {
        onChangeConfig(connectRule(config, conn.source.slice(3), conn.target.slice(4)))
      }
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

  return (
    <div style={{ height: 'calc(100vh - 190px)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitView
        proOptions={{ hideAttribution: true }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node: Node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
      >
        <Background />
        <Controls />
        <Panel position="top-left">
          <div className="row">
            <Button onClick={() => onChangeConfig(addInbound(config))}>+ Inbound</Button>
            <Button onClick={() => onChangeConfig(addOutbound(config))}>+ Outbound</Button>
            <Button onClick={() => onChangeConfig(addRule(config))}>+ Правило</Button>
            <Button variant="ghost" onClick={() => resetPositions(profileUuid)}>
              Сбросить расположение
            </Button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}

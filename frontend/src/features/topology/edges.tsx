import { BaseEdge, getBezierPath, type EdgeProps, type EdgeTypes } from '@xyflow/react'

const FLUX = 'var(--flux)'
const EMBER = 'var(--ember)'
const STEEL = 'var(--cable-steel)'

/**
 * Кабель окрашивается градиентом от цвета источника к цвету приёмника: индиго на
 * входе, сталь у правила (правило — переключатель, а не источник сигнала), янтарь
 * на выходе. Тип определяется по id ребра, который строит buildGraph.
 */
export function edgeHues(id: string): [string, string] {
  if (id.startsWith('e:squad:')) return [FLUX, FLUX]
  if (id.startsWith('e:rule:')) return [STEEL, EMBER]
  if (id.startsWith('e:in:')) return [FLUX, id.includes('->out:') ? EMBER : STEEL]
  return [STEEL, STEEL]
}

/** id ребра содержит `:`, `>` и точки — в id градиента их держать нельзя */
export function gradientId(edgeId: string): string {
  return `sig-${edgeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function SignalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const [from, to] = edgeHues(id)
  const gid = gradientId(id)
  // Подсветка потока: ребро выделено само либо касается выбранного узла
  const active = selected || data?.active === true

  return (
    <>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          {/* stop-color задаём стилем: var() не раскрывается в презентационном атрибуте */}
          <stop offset="0%" style={{ stopColor: from }} />
          <stop offset="100%" style={{ stopColor: to }} />
        </linearGradient>
      </defs>
      {/* Гало-подложка — вес кабеля на почти-чёрном фоне */}
      <path className="edge-halo" d={path} style={{ stroke: `url(#${gid})` }} data-active={active || undefined} />
      <BaseEdge id={id} path={path} style={{ stroke: `url(#${gid})`, opacity: active ? 1 : 0.85 }} />
      {/* Бегущая искра только по активному пути; currentColor красит и её свечение */}
      {active && <path className="edge-flow" d={path} style={{ stroke: to, color: to }} />}
    </>
  )
}

export const edgeTypes = { signal: SignalEdge } as unknown as EdgeTypes

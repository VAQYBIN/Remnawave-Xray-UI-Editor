import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { docStorageKey, LEGACY_DOC_KIND } from '../../shared/lib/docKey'

type NodePositions = Record<string, { x: number; y: number }>

export interface PositionsState {
  /** Ключ — не голый uuid, а `<вид>:<uuid>` (см. shared/lib/docKey) */
  positions: Record<string, NodePositions>
  setPosition: (docKey: string, nodeId: string, pos: { x: number; y: number }) => void
  resetPositions: (docKey: string) => void
}

/**
 * v0 → v1: позиции лежали по голому uuid, а uuid профиля и шаблона могут
 * совпасть — тогда узлы двух разных графов оказались бы в одной записи.
 * Все существующие записи созданы редактором профилей (шаблоны появились уже
 * с префиксом), поэтому им достаётся `profile:`.
 *
 * Экспортируется ради теста — как и `migrateDraftState`.
 */
export function migratePositionsState(state: unknown, version: number): PositionsState {
  const base = (state ?? {}) as PositionsState
  if (version >= 1) return base
  const source = (state as { positions?: unknown } | null)?.positions
  const old =
    typeof source === 'object' && source !== null ? (source as Record<string, unknown>) : {}
  const positions: Record<string, NodePositions> = {}
  // Данные из localStorage мы не контролируем: битую запись пропускаем, иначе
  // одна такая унесла бы расположение узлов всех документов. Координаты
  // просеиваем поштучно: значение отсюда уходит прямо в position узла React
  // Flow, и нечисловая пара развалила бы весь граф, а не одну карточку.
  for (const [uuid, nodes] of Object.entries(old)) {
    if (typeof nodes !== 'object' || nodes === null) continue
    const clean: NodePositions = {}
    for (const [nodeId, pos] of Object.entries(nodes as Record<string, unknown>)) {
      const p = pos as { x?: unknown; y?: unknown } | null
      if (typeof p !== 'object' || p === null) continue
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
      clean[nodeId] = { x: p.x as number, y: p.y as number }
    }
    positions[docStorageKey(LEGACY_DOC_KIND, uuid)] = clean
  }
  return { ...base, positions }
}

export const usePositionsStore = create<PositionsState>()(
  persist(
    (set) => ({
      positions: {},
      setPosition: (docKey, nodeId, pos) =>
        set((s) => ({
          positions: {
            ...s.positions,
            [docKey]: { ...(s.positions[docKey] ?? {}), [nodeId]: pos },
          },
        })),
      resetPositions: (docKey) =>
        set((s) => {
          const { [docKey]: _removed, ...rest } = s.positions
          return { positions: rest }
        }),
    }),
    { name: 'xui-positions', version: 1, migrate: migratePositionsState },
  ),
)

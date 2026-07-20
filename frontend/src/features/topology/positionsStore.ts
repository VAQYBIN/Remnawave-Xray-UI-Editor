import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PositionsState {
  positions: Record<string, Record<string, { x: number; y: number }>>
  setPosition: (profileUuid: string, nodeId: string, pos: { x: number; y: number }) => void
  resetPositions: (profileUuid: string) => void
}

export const usePositionsStore = create<PositionsState>()(
  persist(
    (set) => ({
      positions: {},
      setPosition: (profileUuid, nodeId, pos) =>
        set((s) => ({
          positions: {
            ...s.positions,
            [profileUuid]: { ...(s.positions[profileUuid] ?? {}), [nodeId]: pos },
          },
        })),
      resetPositions: (profileUuid) =>
        set((s) => {
          const { [profileUuid]: _removed, ...rest } = s.positions
          return { positions: rest }
        }),
    }),
    { name: 'xui-positions' },
  ),
)
